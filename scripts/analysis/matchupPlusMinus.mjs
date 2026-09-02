// The user's stat: direct plus-minus between a player and their defensive
// matchup, measured across whole simulated games — the tuning instrument for
// Defensive Bonus. Runs N games with the passive contest ON and the same N
// (same seed) with it OFF, then reports:
//   1. chart points conceded per roll defended, by the DEFENDER's defBoost
//   2. team points conceded per game, by the team's total defBoost
// Usage: node scripts/analysis/matchupPlusMinus.mjs [games]
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cardgen/cache.js';
import {
  newGame, doRoll, endSection, applyMatchups, spendAssist, spendReboundBonus, STARTERS,
  contestConfig,
} from '../../src/game/engine.js';
import { execCard, resolvePendingShotCheck } from '../../src/game/execCard.js';
import {
  aiDraftPick, aiPlacementPick, aiTurn, aiScoringDecision, aiRollDecision, aiReactionDecision,
  aiSpendDecision,
} from '../../src/game/ai.js';

const GAMES = Number(process.argv[2] ?? 400);
const SECTIONS = 12;
const SET = path.join(REPO_ROOT, 'card-data', 'generated', 'cards-2026-27.json');
const CARDS = JSON.parse(fs.readFileSync(SET, 'utf8')).cards;

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
  catch { return { g, played: false }; }
  if (!r.ok) return { g, played: false };
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
  return { g: ng, played: true };
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

// tier accumulators: pts conceded on chart rolls the defender was assigned to
function runBatch(games, contested) {
  contestConfig.enabled = contested;
  seed = 20260901; // identical rosters and dice stream either way
  const tier = new Map(); // defDb -> { pts, rolls }
  const teamRows = []; // { defSum, conceded } per team-game
  for (let n = 0; n < games; n += 1) {
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

    const recordRolls = (gg, key) => {
      for (const r of gg.rollResults[key] || []) {
        if (!r) continue;
        const k = r.defDb ?? 0;
        if (!tier.has(k)) tier.set(k, { pts: 0, rolls: 0 });
        const t = tier.get(k);
        t.pts += r.pts;
        t.rolls += 1;
      }
    };

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
          const res = tryPlay(g, key, action);
          g = res.g;
          if (res.played) { g.matchupPasses = 0; g.matchupTurn = key === 'A' ? 'B' : 'A'; continue; }
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
          const res = tryPlay(g, key, action);
          g = res.g;
          if (res.played) { g.scoringPasses = 0; g.scoringTurn = key === 'A' ? 'B' : 'A'; continue; }
        }
        g.scoringPasses += 1;
        g.scoringTurn = key === 'A' ? 'B' : 'A';
      }
      for (let r = 0; r < STARTERS * 2; r += 1) {
        const key = r % 2 === 0 ? 'A' : 'B';
        const cardAction = aiScoringDecision(g, key);
        if (cardAction?.type === 'play_card') g = tryPlay(g, key, cardAction).g;
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
        if (action?.type === 'play_card') g = tryPlay(g, key, action).g;
      }
      for (const key of ['A', 'B']) g = spendAll(g, key);
      recordRolls(g, 'A');
      recordRolls(g, 'B');
      g = endSection(g);
      for (const key of ['A', 'B']) g = spendAll(g, key);
    }

    const defSum = t => t.roster.reduce((s, c) => s + Math.max(0, c.defBoost || 0), 0);
    teamRows.push({ defSum: defSum(g.teamA), conceded: g.teamB.score });
    teamRows.push({ defSum: defSum(g.teamB), conceded: g.teamA.score });
  }
  return { tier, teamRows };
}

const fmt = x => x.toFixed(2);
const label = c => (c ? 'contest ON ' : 'contest OFF');
const results = {};
for (const contested of [false, true]) {
  results[contested] = runBatch(GAMES, contested);
}
contestConfig.enabled = true;

console.log(`${GAMES} games per arm, identical seeds\n`);
console.log('chart pts conceded per roll defended, by DEFENDER defBoost:');
console.log('  db    OFF     ON     delta');
const tiers = [...new Set([...results[false].tier.keys(), ...results[true].tier.keys()])].sort((a, b) => a - b);
for (const k of tiers) {
  const off = results[false].tier.get(k) || { pts: 0, rolls: 0 };
  const on = results[true].tier.get(k) || { pts: 0, rolls: 0 };
  const offR = off.rolls ? off.pts / off.rolls : 0;
  const onR = on.rolls ? on.pts / on.rolls : 0;
  console.log(`  ${String(k).padStart(3)}  ${fmt(offR)}  ${fmt(onR)}   ${fmt(onR - offR)}  (n=${on.rolls})`);
}

console.log('\nteam pts conceded per game, by roster total defBoost (positives only):');
for (const contested of [false, true]) {
  const rows = results[contested].teamRows;
  const buckets = new Map();
  for (const r of rows) {
    const b = Math.min(12, 2 * Math.floor(r.defSum / 2));
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(r.conceded);
  }
  const line = [...buckets.keys()].sort((a, b) => a - b)
    .map(b => `${b}-${b + 1}: ${fmt(buckets.get(b).reduce((s, v) => s + v, 0) / buckets.get(b).length)}`)
    .join('  ');
  console.log(`  ${label(contested)} ${line}`);
}
