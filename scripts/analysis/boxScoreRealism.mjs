// The user's check: play sim games on the rebuilt set and see whether the
// box scores look like basketball. Ground truth is each player's OWN raw
// last-82 log (no opponent adjustment, no damp) — per-36 sim production vs
// per-36 real production, name by name.
// Usage: node scripts/analysis/boxScoreRealism.mjs [games]
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache } from '../cardgen/cache.js';
import {
  newGame, doRoll, endSection, applyMatchups, spendAssist, spendReboundBonus, STARTERS,
} from '../../src/game/engine.js';
import { execCard, resolvePendingShotCheck } from '../../src/game/execCard.js';
import {
  aiDraftPick, aiTurn, aiScoringDecision, aiRollDecision, aiReactionDecision, aiSpendDecision,
} from '../../src/game/ai.js';
import { minutesToDecimal } from '../cardgen/realGames.js';

const GAMES = Number(process.argv[2] ?? 300);
const SECTIONS = 12;
const GEN = path.join(REPO_ROOT, 'card-data', 'generated');
const CARDS = JSON.parse(fs.readFileSync(path.join(GEN, 'cards-2026-27.json'), 'utf8')).cards;
const IDX = JSON.parse(fs.readFileSync(path.join(GEN, 'pool-gamelogs-index.json'), 'utf8')).players;

let seed = 20260901;
const rng = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

function draftRoster(taken = new Set()) {
  const pool = CARDS.filter(c => !taken.has(c.id));
  const picks = [];
  while (picks.length < 10 && pool.length) {
    const i = Math.floor(rng() * pool.length);
    picks.push(pool.splice(i, 1)[0]);
  }
  for (const p of picks) taken.add(p.id);
  return picks;
}

function safeResolve(g) {
  const pend = g.pendingShotCheck;
  if (!pend) return g;
  const target = (pend.teamKey === 'A' ? g.teamA : g.teamB).starters[pend.playerIdx];
  if (!target) return { ...g, pendingShotCheck: null };
  try { return resolvePendingShotCheck(g); }
  catch { return { ...g, pendingShotCheck: null }; }
}

function tryPlay(g, teamKey, action) {
  let r;
  try { r = execCard(g, teamKey, action.cardId, action.opts || {}); }
  catch { return g; }
  if (!r.ok) return g;
  let ng = r.game;
  if (ng.pendingShotCheck) {
    const defKey = ng.pendingShotCheck.teamKey === 'A' ? 'B' : 'A';
    const react = aiReactionDecision(ng, defKey, 'shot_check');
    if (react?.type === 'play_card') {
      const rr = execCard(ng, defKey, react.cardId, react.opts || {});
      if (rr.ok) ng = rr.game;
    }
    ng = safeResolve(ng);
  }
  return ng;
}

function spendAll(g, key) {
  let ng = g;
  for (let guard = 0; guard < 12; guard += 1) {
    const spend = aiSpendDecision(ng, key);
    if (!spend) break;
    const r = spend.type === 'spend_assist'
      ? spendAssist(ng, key, spend.spendType, spend.playerIdx)
      : spendReboundBonus(ng, key, spend.rebType, spend.playerIdx);
    if (!r.ok) break;
    ng = r.game;
  }
  return ng;
}

const acc = new Map(); // card id -> { min, pts, reb, ast }
function harvest(g) {
  for (const key of ['A', 'B']) {
    for (const ps of (key === 'A' ? g.teamA : g.teamB).stats) {
      if (!(ps.totalMinutes > 0)) continue;
      const cardId = (key === 'A' ? g.teamA : g.teamB).roster.find(c => c.id === ps.id)?.id ?? ps.id;
      if (!acc.has(cardId)) acc.set(cardId, { min: 0, pts: 0, reb: 0, ast: 0, games: 0 });
      const a = acc.get(cardId);
      a.min += ps.totalMinutes;
      a.pts += ps.pts;
      a.reb += ps.reb;
      a.ast += ps.ast;
      a.games += 1;
    }
  }
}

for (let n = 0; n < GAMES; n += 1) {
  const taken = new Set();
  const rosterA = draftRoster(taken);
  const rosterB = draftRoster(taken);
  if (rosterA.length < 10 || rosterB.length < 10) continue;
  let g = newGame(rosterA, rosterB);
  for (const key of ['A', 'B']) {
    const team = key === 'A' ? g.teamA : g.teamB;
    while (team.starters.length < STARTERS) {
      const pick = aiDraftPick(g, key);
      if (!pick) break;
      team.starters.push(team.roster.find(r => r.id === pick.playerId));
    }
  }
  for (let s = 0; s < SECTIONS && !g.done; s += 1) {
    if (s > 0) {
      for (const key of ['A', 'B']) {
        const team = key === 'A' ? g.teamA : g.teamB;
        const byId = new Map(team.stats.map(p => [p.id, p]));
        team.starters = team.roster
          .map(c => ({ c, min: byId.get(c.id)?.minutes ?? 0, sal: c.salary ?? 0 }))
          .sort((x, y) => x.min - y.min || y.sal - x.sal)
          .slice(0, STARTERS)
          .map(o => o.c);
      }
    }
    g.phase = 'matchup_strats';
    g.matchupTurn = 'A'; g.matchupPasses = 0;
    for (let guard = 0; guard < 24 && g.matchupPasses < 2; guard += 1) {
      const key = g.matchupTurn;
      const action = aiTurn(g, key);
      if (action?.type === 'set_matchups') { g = applyMatchups(g, key, action.matchups); continue; }
      if (action?.type === 'play_card') {
        const before = g;
        g = tryPlay(g, key, action);
        if (g !== before) { g.matchupPasses = 0; g.matchupTurn = key === 'A' ? 'B' : 'A'; continue; }
      }
      g.matchupPasses += 1;
      g.matchupTurn = key === 'A' ? 'B' : 'A';
    }
    g.phase = 'scoring';
    g.rollResults = { A: [], B: [] };
    g.scoringTurn = 'B'; g.scoringPasses = 0;
    for (let guard = 0; guard < 24 && g.scoringPasses < 2; guard += 1) {
      const key = g.scoringTurn;
      const action = aiScoringDecision(g, key);
      if (action?.type === 'play_card') {
        const before = g;
        g = tryPlay(g, key, action);
        if (g !== before) { g.scoringPasses = 0; g.scoringTurn = key === 'A' ? 'B' : 'A'; continue; }
      }
      g.scoringPasses += 1;
      g.scoringTurn = key === 'A' ? 'B' : 'A';
    }
    for (let r = 0; r < STARTERS * 2; r += 1) {
      const key = r % 2 === 0 ? 'A' : 'B';
      const cardAction = aiScoringDecision(g, key);
      if (cardAction?.type === 'play_card') g = tryPlay(g, key, cardAction);
      const action = aiRollDecision(g, key);
      if (action?.playerIdx != null) {
        g = doRoll(g, key, action.playerIdx);
        if (g.pendingShotCheck) g = safeResolve(g);
      }
    }
    for (const key of ['A', 'B']) {
      for (let i = 0; i < STARTERS; i += 1) {
        if ((key === 'A' ? g.rollResults.A : g.rollResults.B)[i] == null && !g.blockedRolls?.[key]?.[i]) {
          g = doRoll(g, key, i);
          if (g.pendingShotCheck) g = safeResolve(g);
        }
      }
    }
    for (const key of ['B', 'A']) {
      const action = aiScoringDecision(g, key);
      if (action?.type === 'play_card') g = tryPlay(g, key, action);
    }
    for (const key of ['A', 'B']) g = spendAll(g, key);
    g = endSection(g);
    for (const key of ['A', 'B']) g = spendAll(g, key);
  }
  harvest(g);
}

// ground truth: raw per-36 from each player's own cached logs (no adjustment)
function realPer36(entry) {
  let min = 0, pts = 0, reb = 0, ast = 0;
  for (const season of [2026, 2025]) {
    if (!entry.seasons?.[season]) continue;
    const log = readCache(`gamelog-full-${entry.playerId}-${season}`);
    if (!log) continue;
    for (const phase of ['reg', 'post']) {
      for (const gm of log[phase] ?? []) {
        const m = minutesToDecimal(gm.minutes);
        if (!(m >= 2)) continue;
        min += m; pts += gm.pts; reb += gm.reb; ast += gm.ast;
      }
    }
  }
  if (min < 200) return null;
  return { pts: (pts / min) * 36, reb: (reb / min) * 36, ast: (ast / min) * 36 };
}

const rows = [];
for (const [cardId, entry] of Object.entries(IDX)) {
  const sim = acc.get(cardId);
  const real = realPer36(entry);
  if (!sim || !real || sim.min < 200) continue;
  rows.push({
    name: entry.name,
    simPts: (sim.pts / sim.min) * 36, realPts: real.pts,
    simReb: (sim.reb / sim.min) * 36, realReb: real.reb,
    simAst: (sim.ast / sim.min) * 36, realAst: real.ast,
  });
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
console.log(`${rows.length} players with 200+ sim minutes over ${GAMES} games`);
console.log(`league per-36 means — sim pts ${mean(rows.map(r => r.simPts)).toFixed(1)} vs real ${mean(rows.map(r => r.realPts)).toFixed(1)}` +
  ` | reb ${mean(rows.map(r => r.simReb)).toFixed(1)} vs ${mean(rows.map(r => r.realReb)).toFixed(1)}` +
  ` | ast ${mean(rows.map(r => r.simAst)).toFixed(1)} vs ${mean(rows.map(r => r.realAst)).toFixed(1)}`);

rows.forEach(r => { r.d = r.simPts - r.realPts; });
rows.sort((a, b) => a.d - b.d);
const show = r => `  ${r.name.padEnd(24)} sim ${r.simPts.toFixed(1)}/${r.simReb.toFixed(1)}/${r.simAst.toFixed(1)}  real ${r.realPts.toFixed(1)}/${r.realReb.toFixed(1)}/${r.realAst.toFixed(1)}`;
console.log('\nmost UNDER-produced (sim pts/36 below real):');
rows.slice(0, 10).forEach(r => console.log(show(r)));
console.log('\nmost OVER-produced:');
rows.slice(-10).reverse().forEach(r => console.log(show(r)));
for (const n of ['Cason Wallace', 'Nikola Jokić', 'Shai Gilgeous-Alexander', 'Giannis Antetokounmpo', 'Alex Caruso']) {
  const r = rows.find(x => x.name === n);
  if (r) console.log('CHECK' + show(r).slice(1));
}
