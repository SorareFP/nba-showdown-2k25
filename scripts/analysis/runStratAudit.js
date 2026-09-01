/**
 * The strategy-card audit: AI vs AI, full rules, every card counted.
 *
 *   node scripts/analysis/runStratAudit.js [games]
 *
 * runChannelSplit measures the SCORING engine with no cards in it; this
 * drives the whole game the way the AI actually plays it — blind fives,
 * the placement snake, the matchup and scoring card phases through aiTurn,
 * shot-check reactions through aiReactionDecision, conversion spends, and
 * endSection's rotation — and counts what every strategy card actually did:
 * how often it was held, how often the AI chose it, and how the games it was
 * played in came out.
 *
 * TWO GAPS THIS AUDIT EXPOSED BEFORE IT RAN, wired here so the measurement
 * reflects a competent table rather than the current UI's blind spots:
 *   - the AI never spends assists/rebounds in live games (no spendAssist
 *     caller in ai.js) — here both sides spend greedily, as runChannelSplit
 *     established;
 *   - aiReactionDecision has NO caller in any component, so reaction cards
 *     are dead weight in real solo games. Here the shot-check window offers
 *     the defence its reaction, which is the minimum wiring for Close Out
 *     to mean anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cardgen/cache.js';
import {
  newGame, doRoll, endSection, applyMatchups, spendAssist, spendReboundBonus, STARTERS,
} from '../../src/game/engine.js';
import { execCard, resolvePendingShotCheck } from '../../src/game/execCard.js';
import { STRATS, getStrat } from '../../src/game/strats.js';
import {
  aiDraftPick, aiPlacementPick, aiTurn, aiScoringDecision, aiRollDecision, aiReactionDecision,
} from '../../src/game/ai.js';

const GAMES = Number(process.argv[2] ?? 400);
const SECTIONS = 12;
const SET = path.join(REPO_ROOT, 'card-data', 'generated', 'cards-2026-27.json');
const CARDS = JSON.parse(fs.readFileSync(SET, 'utf8')).cards;

// Deterministic-ish RNG so runs are comparable.
let seed = 20260901;
const rng = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

const stats = new Map(STRATS.map(s => [s.id, {
  id: s.id, name: s.name, phase: s.phase, held: 0, plays: 0, winsWhenPlayed: 0, gamesPlayed: 0,
}]));

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

/** Count every card id in both hands once per game (held = ever in hand). */
function tallyHands(g, heldThisGame) {
  for (const key of ['A', 'B']) {
    for (const id of (key === 'A' ? g.teamA : g.teamB).hand ?? []) heldThisGame.add(`${key}|${id}`);
  }
}

function safeResolve(g) {
  // The AI occasionally opens a check on a target the engine cannot find
  // (an opts edge the UI's pickers would have prevented). The audit clears
  // it rather than crashing four hundred games on one decision.
  const pend = g.pendingShotCheck;
  if (!pend) return g;
  const target = (pend.teamKey === 'A' ? g.teamA : g.teamB).starters[pend.playerIdx];
  if (!target) { const ng = { ...g, pendingShotCheck: null }; return ng; }
  try { return resolvePendingShotCheck(g); }
  catch { return { ...g, pendingShotCheck: null }; }
}

function tryPlay(g, teamKey, action, playedThisGame) {
  let r;
  try { r = execCard(g, teamKey, action.cardId, action.opts || {}); }
  catch { return { g, played: false }; }
  if (!r.ok) return { g, played: false };
  playedThisGame.add(`${teamKey}|${action.cardId}`);
  let ng = r.game;
  // A card that opens a shot check hands the DEFENCE its reaction window
  // before the die is cast — the wiring live solo games are missing.
  if (ng.pendingShotCheck) {
    const defKey = ng.pendingShotCheck.teamKey === 'A' ? 'B' : 'A';
    const react = aiReactionDecision(ng, defKey, 'shot_check');
    if (react?.type === 'play_card') {
      const rr = execCard(ng, defKey, react.cardId, react.opts || {});
      if (rr.ok) { ng = rr.game; playedThisGame.add(`${defKey}|${react.cardId}`); }
    }
    ng = safeResolve(ng);
  }
  return { g: ng, played: true };
}

function spendAll(g, key) {
  let ng = g;
  for (let guard = 0; guard < 12; guard += 1) {
    const team = key === 'A' ? ng.teamA : ng.teamB;
    const best = boost => {
      let bi = -1, bv = -Infinity;
      team.starters.forEach((p, i) => {
        const v = (p?.[boost] ?? 0);
        if (p && v > bv) { bv = v; bi = i; }
      });
      return bi;
    };
    let acted = false;
    const three = best('threePtBoost');
    if (team.assists >= 5 && three >= 0) {
      const r = spendAssist(ng, key, 'three', three);
      if (r.ok) { ng = r.game; acted = true; }
    }
    const paint = best('paintBoost');
    if (!acted && team.assists >= 5 && paint >= 0) {
      const r = spendAssist(ng, key, 'paint', paint);
      if (r.ok) { ng = r.game; acted = true; }
    }
    const bonuses = ng.reboundBonuses?.[key];
    if (!acted && team.rebounds >= 5 && bonuses?.paintCheck && paint >= 0) {
      const r = spendReboundBonus(ng, key, 'paint_check', paint);
      if (r.ok) { ng = r.game; acted = true; }
    }
    if (!acted) break;
  }
  return ng;
}

let simmed = 0;
let aWins = 0;
const margins = [];
for (let n = 0; n < GAMES; n += 1) {
  const taken = new Set();
  const rosterA = draftRoster(taken);
  const rosterB = draftRoster(taken);
  if (rosterA.length < 10 || rosterB.length < 10) continue;

  // --full deals every card its printed copies instead of the default deck's
  // first-fifty truncation, so the nineteen unreachable cards get to exist.
  const FULL = process.argv.includes('--full');
  // `locked` marks deck-editor staples, not exclusions — every card deals.
  const cfg = FULL ? Object.fromEntries(STRATS.map(s => [s.id, s.copies || 2])) : null;
  let g = newGame(rosterA, rosterB, cfg, cfg);
  const heldThisGame = new Set();
  const playedThisGame = new Set();

  // Blind fives, then the placement snake — the same flow solo now runs.
  for (const key of ['A', 'B']) {
    for (let i = 0; i < 5; i += 1) {
      const a = aiDraftPick(g, key);
      if (!a) break;
      const team = key === 'A' ? g.teamA : g.teamB;
      const pool = key === 'A' ? g.draft.aPool : g.draft.bPool;
      const idx = pool.findIndex(p => p.id === a.playerId);
      if (idx < 0) break;
      team.starters.push(pool[idx]);
      if (key === 'A') g.draft.aPool = pool.filter((_, j) => j !== idx);
      else g.draft.bPool = pool.filter((_, j) => j !== idx);
    }
  }
  g.draft.aPicks = g.teamA.starters.map(p => p.id);
  g.draft.bPicks = g.teamB.starters.map(p => p.id);
  g.teamA.starters = []; g.teamB.starters = [];
  g.placementStep = 0;
  g.phase = 'matchup_strats';
  const order = g.placementOrder;
  for (let step = 0; step < 10; step += 1) {
    const key = order[step];
    const pick = aiPlacementPick(g, key);
    if (!pick) break;
    const team = key === 'A' ? g.teamA : g.teamB;
    team.starters.push((team.roster || []).find(r => r.id === pick.playerId));
    g.placementStep = step + 1;
  }

  for (let s = 0; s < SECTIONS && !g.done; s += 1) {
    tallyHands(g, heldThisGame);

    // endSection clears starters; every section after the first re-picks five
    // by rest-then-salary, exactly as runChannelSplit rotates. Without this,
    // sections two through twelve rolled nobody — the first cut of this
    // harness measured one-section games without noticing.
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

    // ── Matchup phase: alternate aiTurn until both pass ──
    // endSection resets the phase to 'draft' for the next lineup pick; the
    // harness re-picks starters itself, so it must restore the phase too —
    // without this, every section after the first had NO matchup phase and
    // the matchup-only cards could exist for one section per game.
    g.phase = 'matchup_strats';
    g.matchupTurn = 'A'; g.matchupPasses = 0;
    for (let guard = 0; guard < 24 && g.matchupPasses < 2; guard += 1) {
      const key = g.matchupTurn;
      const action = aiTurn(g, key);
      if (action?.type === 'set_matchups') {
        g = applyMatchups(g, key, action.matchups);
        continue; // same team keeps its turn after assigning, as the UI allows
      }
      if (action?.type === 'play_card') {
        const res = tryPlay(g, key, action, playedThisGame);
        g = res.g;
        if (res.played) { g.matchupPasses = 0; g.matchupTurn = key === 'A' ? 'B' : 'A'; continue; }
      }
      g.matchupPasses += 1;
      g.matchupTurn = key === 'A' ? 'B' : 'A';
    }

    // ── Scoring card phase ──
    g.phase = 'scoring';
    g.rollResults = { A: [], B: [] };
    g.scoringTurn = 'B'; g.scoringPasses = 0;
    for (let guard = 0; guard < 24 && g.scoringPasses < 2; guard += 1) {
      const key = g.scoringTurn;
      const action = aiScoringDecision(g, key);
      if (action?.type === 'play_card') {
        const res = tryPlay(g, key, action, playedThisGame);
        g = res.g;
        if (res.played) { g.scoringPasses = 0; g.scoringTurn = key === 'A' ? 'B' : 'A'; continue; }
      }
      g.scoringPasses += 1;
      g.scoringTurn = key === 'A' ? 'B' : 'A';
    }

    // ── Rolls (AI order), then conversions ──
    for (let r = 0; r < STARTERS * 2; r += 1) {
      const key = r % 2 === 0 ? 'A' : 'B';
      const action = aiRollDecision(g, key);
      if (action?.playerIdx != null) {
        g = doRoll(g, key, action.playerIdx);
        if (g.pendingShotCheck) g = safeResolve(g);
      }
    }
    // Anyone the alternation missed still rolls.
    for (const key of ['A', 'B']) {
      for (let i = 0; i < STARTERS; i += 1) {
        if ((key === 'A' ? g.rollResults.A : g.rollResults.B)[i] == null && !g.blockedRolls?.[key]?.[i]) {
          g = doRoll(g, key, i);
          if (g.pendingShotCheck) g = safeResolve(g);
        }
      }
    }
    // Post-roll card window — heat checks and momentum plays live here.
    for (const key of ['B', 'A']) {
      const action = aiScoringDecision(g, key);
      if (action?.type === 'play_card') {
        const res = tryPlay(g, key, action, playedThisGame);
        g = res.g;
      }
    }
    for (const key of ['A', 'B']) g = spendAll(g, key);
    g = endSection(g);
    for (const key of ['A', 'B']) g = spendAll(g, key);
  }

  const aWon = g.teamA.score > g.teamB.score;
  if (aWon) aWins += 1;
  margins.push(Math.abs(g.teamA.score - g.teamB.score));
  for (const entry of heldThisGame) {
    const [, id] = entry.split('|');
    const st = stats.get(id);
    if (st) st.held += 1;
  }
  for (const entry of playedThisGame) {
    const [key, id] = entry.split('|');
    const st = stats.get(id);
    if (!st) continue;
    st.plays += 1;
    st.gamesPlayed += 1;
    const won = key === 'A' ? aWon : !aWon;
    if (won) st.winsWhenPlayed += 1;
  }
  simmed += 1;
}

const rows = [...stats.values()].sort((a, b) => b.plays - a.plays);
console.log(`\n${simmed} AI-vs-AI games on the base set (team A wins ${(100 * aWins / simmed).toFixed(1)}%, median margin ${margins.sort((a, b) => a - b)[Math.floor(margins.length / 2)]})\n`);
console.log('  card                        phase      held  played  play%   win% when played');
for (const r of rows) {
  const playPct = r.held ? (100 * r.plays / r.held).toFixed(0) : '—';
  const winPct = r.gamesPlayed ? (100 * r.winsWhenPlayed / r.gamesPlayed).toFixed(0) : '—';
  console.log(`  ${r.name.padEnd(26)}${r.phase.padEnd(10)}${String(r.held).padStart(5)}${String(r.plays).padStart(7)}${String(playPct).padStart(7)}%${String(winPct).padStart(8)}%`);
}
const dead = rows.filter(r => r.held > simmed * 0.2 && r.plays === 0);
console.log(`\nDEAD IN AI HANDS (held often, never played): ${dead.map(r => r.id).join(', ') || 'none'}`);
