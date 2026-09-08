// A WHOLE GAME, PLAYED BY THE AI, WITH NO UI — the thing a season needs when
// you finish your own fixture and the other three in the round have to
// resolve before the standings can move.
//
// ── WHY THIS IS A PORT AND NOT A NEW LOOP ───────────────────────────────────
//
// scripts/analysis/runStratAudit.js has driven the engine headlessly for a
// thousand games a run since the balance work: draft, placement, the two card
// windows, the rolls, the spends, the crunch timeout. That loop is the tested
// one, so this is it, lifted verbatim in structure and turned into a function.
// The audit keeps its own copy because it also tallies per-card statistics and
// takes CLI flags; if the two ever disagree about how a game is played, this
// one is wrong, because that one is measured against the shipped balance.
//
// ── DETERMINISM ─────────────────────────────────────────────────────────────
//
// The engine rolls with Math.random. A caller that wants a repeatable season
// (tests, or a "replay this round" button) passes `rng`, which is installed
// over Math.random for the duration of the game and restored afterwards. That
// is a blunt instrument, but the alternative is threading a generator through
// every engine function, and the engine's purity is worth more than that.
import {
  newGame, doRoll, endSection, applyMatchups, spendAssist, spendReboundBonus, STARTERS,
  spendTimeout, endTimeout,
} from '../engine.js';
import { execCard, resolvePendingShotCheck } from '../execCard.js';
import * as defaultBrain from '../ai.js';

// ── TWO BRAINS ──────────────────────────────────────────────────────────────
// Every AI decision goes through `brainFor(key)`, which is the shipped ai.js
// unless the caller hands in another module for one side (scripts/analysis/
// runAiDuel.js plays the current AI against the last commit's). A brain is
// any object with ai.js's exports.
const brainOf = (brains, key) => brains?.[key] ?? defaultBrain;
import { CLUTCH_DICE } from '../clutchAwards.js';
import { boxScoreFor } from '../boxScore.js';

const SECTIONS = 12;

function safeResolve(g) {
  const pend = g.pendingShotCheck;
  if (!pend) return g;
  const target = (pend.teamKey === 'A' ? g.teamA : g.teamB).starters[pend.playerIdx];
  if (!target) return { ...g, pendingShotCheck: null };
  try { return resolvePendingShotCheck(g); }
  catch { return { ...g, pendingShotCheck: null }; }
}

function tryPlay(g, teamKey, action, brains = null) {
  let r;
  try { r = execCard(g, teamKey, action.cardId, action.opts || {}); }
  catch { return { g, played: false }; }
  if (!r.ok) return { g, played: false };
  let ng = r.game;
  // A card that opens a shot check hands the DEFENCE its reaction window
  // before the die is cast.
  if (ng.pendingShotCheck) {
    const defKey = ng.pendingShotCheck.teamKey === 'A' ? 'B' : 'A';
    const react = brainOf(brains, defKey).aiReactionDecision(ng, defKey, 'shot_check');
    if (react?.type === 'play_card') {
      const rr = execCard(ng, defKey, react.cardId, react.opts || {});
      if (rr.ok) ng = rr.game;
    }
    ng = safeResolve(ng);
  }
  return { g: ng, played: true };
}

function spendAll(g, key, brains = null) {
  let ng = g;
  for (let guard = 0; guard < 12; guard += 1) {
    const spend = brainOf(brains, key).aiSpendDecision(ng, key);
    if (!spend) break;
    const r = spend.type === 'spend_assist'
      ? spendAssist(ng, key, spend.spendType, spend.playerIdx)
      : spendReboundBonus(ng, key, spend.rebType, spend.playerIdx);
    if (!r.ok) break;
    ng = r.game;
  }
  return ng;
}

/** Draft five starters for each side out of the ten-card rosters. */
/**
 * THE PLACEMENT SNAKE IS THE MATCHUP ASSIGNMENT (see the rule in ai.js): the
 * five each side has picked go down one at a time, A-B-B-A-A-B-B-A-A-B, and
 * the row a player lands in is his pairing for the section. Run for EVERY
 * section, as the live game does — the simulator used to run it only for the
 * opening five and pair the later sections by rotation order, which made a
 * placement brain worth a twelfth of what it is worth at the table.
 */
function runSnake(g, brains) {
  g.draft.aPicks = g.teamA.starters.map(p => p.id);
  g.draft.bPicks = g.teamB.starters.map(p => p.id);
  g.teamA.starters = [];
  g.teamB.starters = [];
  g.placementStep = 0;
  g.phase = 'matchup_strats';
  const order = g.placementOrder;
  for (let step = 0; step < 10; step += 1) {
    const key = order[step];
    const pick = brainOf(brains, key).aiPlacementPick(g, key);
    if (!pick) break;
    const team = key === 'A' ? g.teamA : g.teamB;
    team.starters.push((team.roster || []).find(r => r.id === pick.playerId));
    g.placementStep = step + 1;
  }
  // A brain that stopped short leaves the picks in pick order, as before.
  for (const key of ['A', 'B']) {
    const team = key === 'A' ? g.teamA : g.teamB;
    const picks = key === 'A' ? g.draft.aPicks : g.draft.bPicks;
    if (team.starters.length < picks.length) {
      const down = new Set(team.starters.map(p => p.id));
      for (const id of picks) if (!down.has(id)) team.starters.push((team.roster || []).find(r => r.id === id));
    }
  }
  g.placementStep = 10;
  return g;
}

function draftStarters(g, brains = null) {
  for (const key of ['A', 'B']) {
    for (let i = 0; i < STARTERS; i += 1) {
      const a = brainOf(brains, key).aiDraftPick(g, key);
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
  return runSnake(g, brains);
}

/** One section: the matchup window, the scoring window, the rolls, the spends. */
function playSection(g, sectionIndex, brains = null) {
  // Rotate the five least-used players in after the opening section, the way
  // the audit does, so fatigue means something across a whole game.
  if (sectionIndex > 0) {
    for (const key of ['A', 'B']) {
      const team = key === 'A' ? g.teamA : g.teamB;
      const byId = new Map(team.stats.map(p => [p.id, p]));
      team.starters = team.roster
        .map(c => ({ c, min: byId.get(c.id)?.minutes ?? 0, sal: c.salary ?? 0 }))
        .sort((x, y) => x.min - y.min || y.sal - x.sal)
        .slice(0, STARTERS)
        .map(o => o.c);
    }
    g = runSnake(g, brains);
  }

  g.phase = 'matchup_strats';
  g.matchupTurn = 'A';
  g.matchupPasses = 0;
  for (let guard = 0; guard < 24 && g.matchupPasses < 2; guard += 1) {
    const key = g.matchupTurn;
    const action = brainOf(brains, key).aiTurn(g, key);
    if (action?.type === 'set_matchups') { g = applyMatchups(g, key, action.matchups); continue; }
    if (action?.type === 'play_card') {
      const res = tryPlay(g, key, action, brains);
      g = res.g;
      if (res.played) { g.matchupPasses = 0; g.matchupTurn = key === 'A' ? 'B' : 'A'; continue; }
    }
    g.matchupPasses += 1;
    g.matchupTurn = key === 'A' ? 'B' : 'A';
  }

  g.phase = 'scoring';
  g.rollResults = { A: [], B: [] };
  g.scoringTurn = 'B';
  g.scoringPasses = 0;
  for (let guard = 0; guard < 24 && g.scoringPasses < 2; guard += 1) {
    const key = g.scoringTurn;
    const action = brainOf(brains, key).aiScoringDecision(g, key);
    if (action?.type === 'play_card') {
      const res = tryPlay(g, key, action, brains);
      g = res.g;
      if (res.played) { g.scoringPasses = 0; g.scoringTurn = key === 'A' ? 'B' : 'A'; continue; }
    }
    g.scoringPasses += 1;
    g.scoringTurn = key === 'A' ? 'B' : 'A';
  }

  for (let r = 0; r < STARTERS * 2; r += 1) {
    const key = r % 2 === 0 ? 'A' : 'B';
    const brain = brainOf(brains, key);
    if (brain.aiCrunchDecision(g, key)?.type === 'timeout') {
      const to = spendTimeout(g, key);
      if (to.ok) {
        g = to.game;
        const reset = brain.aiSetMatchups(g, key);
        if (reset?.matchups) g = applyMatchups(g, key, reset.matchups);
        for (let played = 0; played < 4; played += 1) {
          const rider = brain.aiScoringDecision(g, key);
          if (rider?.type !== 'play_card') break;
          const res = tryPlay(g, key, rider, brains);
          g = res.g;
          if (!res.played) break;
        }
        g = endTimeout(g);
      }
    }
    const cardAction = brain.aiScoringDecision(g, key);
    if (cardAction?.type === 'play_card') g = tryPlay(g, key, cardAction, brains).g;
    const action = brain.aiRollDecision(g, key);
    if (action?.playerIdx != null) {
      g = doRoll(g, key, action.playerIdx, { clutch: action.clutch });
      if (g.pendingShotCheck) g = safeResolve(g);
    }
  }

  // Anyone the AI left unrolled still rolls: a section is five rolls a side.
  for (const key of ['A', 'B']) {
    for (let i = 0; i < STARTERS; i += 1) {
      if ((key === 'A' ? g.rollResults.A : g.rollResults.B)[i] == null && !g.blockedRolls?.[key]?.[i]) {
        g = doRoll(g, key, i);
        if (g.pendingShotCheck) g = safeResolve(g);
      }
    }
  }

  for (const key of ['B', 'A']) {
    const action = brainOf(brains, key).aiScoringDecision(g, key);
    if (action?.type === 'play_card') g = tryPlay(g, key, action, brains).g;
  }
  for (const key of ['A', 'B']) g = spendAll(g, key, brains);
  g = endSection(g);
  for (const key of ['A', 'B']) g = spendAll(g, key, brains);
  return g;
}

/**
 * Play a full game between two ten-card rosters and return the result.
 *
 * `rosterA`/`rosterB` are card objects. `deckA`/`deckB` are deck configs
 * (null = the default deck). Returns
 * `{ scoreA, scoreB, winner: 'A'|'B', boxA, boxB, sections, game }`.
 */
export function simulateGame(rosterA, rosterB, { deckA = null, deckB = null, rng = null, keepGame = false, brains = null } = {}) {
  const realRandom = Math.random;
  if (rng) Math.random = rng;
  try {
    let g = newGame(rosterA, rosterB, deckA, deckB, { clutchDice: CLUTCH_DICE });
    g = draftStarters(g, brains);
    for (let s = 0; s < SECTIONS && !g.done; s += 1) g = playSection(g, s, brains);
    const scoreA = g.teamA.score;
    const scoreB = g.teamB.score;
    return {
      scoreA,
      scoreB,
      winner: scoreA === scoreB ? null : (scoreA > scoreB ? 'A' : 'B'),
      boxA: boxScoreFor(g, 'A'),
      boxB: boxScoreFor(g, 'B'),
      sections: SECTIONS,
      game: keepGame ? g : null,
    };
  } finally {
    Math.random = realRandom;
  }
}

/**
 * A fixture's result in the shape standingsFrom reads.
 * `rosters` maps a team id to its ten cards.
 */
export function simulateFixture(fixture, rosters, opts = {}) {
  const home = rosters[fixture.home];
  const away = rosters[fixture.away];
  if (!home || !away) throw new Error(`simulate: no roster for ${!home ? fixture.home : fixture.away}`);
  const r = simulateGame(home, away, opts);
  return {
    fixtureId: fixture.id,
    home: fixture.home,
    away: fixture.away,
    homeScore: r.scoreA,
    awayScore: r.scoreB,
    winner: r.winner === 'A' ? fixture.home : fixture.away,
    simulated: true,
  };
}
