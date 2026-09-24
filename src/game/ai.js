// src/game/ai.js
// NBA Showdown 2026 — AI Decision Engine
// Pure functions: takes game state + team key, returns an action object.
// No React, no side effects. Used by tutorial, solo mode, sim-to-end.

import { getTeam, getOpp, getPS, calcAdv, matchupAdv, isGhosted, getFatigue, fatigueForMinutes, restMinutes, MAX_STRAIGHT_MINUTES, pickablePool, SPEND_COSTS, REBOUND_RULES, reboundCheckOpen, reboundCheckBonus, clutchAvailable, clutchEligible, burnedSlots, satOutLast, canRollSlot, extraRollPending, checkNeed, crunchSearchOptions } from './engine.js';
import { lookupChart } from './cards.js';
import { canPlayCard, burstTargets, helpTargets, staggerPair, myHouseTargets, foulTroubleTargets, clampTargets, kickOutTargets, REBOUND_CARD_COST } from './canPlay.js';
import { getStrat, STRATS, TIMEOUT_RIDERS } from './strats.js';
import { DEFAULT_ORDER } from './placement.js';

/**
 * AI action types:
 *   { type: 'draft_pick', playerId }
 *   { type: 'set_matchups', matchups: [defIdx, ...] }
 *   { type: 'play_card', cardId, opts }
 *   { type: 'pass' }
 *   { type: 'roll', playerIdx }
 *   { type: 'end_section' }
 *   { type: 'spend_assist', spendType, playerIdx }
 *   { type: 'spend_rebound', rebType, playerIdx }
 */

// ── Draft Decision ──────────────────────────────────────────────────────────
//
// ── WHAT A LINEUP PICK IS WORTH ─────────────────────────────────────────────
//
// The old score was raw attributes with a flat fatigue deduction. A star's
// attributes run to forty-odd, so a star at −6 still beat a fresh bench player
// on paper and the AI played Kawhi through it. A −6 on a d20 is a third of the
// die; on most charts it is a whole tier.
//
// So a pick is valued by what the CHART pays at the roll the player would
// carry — fatigue and markers summed exactly as doRoll sums them, so three hot
// markers cancel a −6 here as they do there. Output alone is not enough,
// though: calibrated against real cards, a star at −6 still out-produces a
// $350 bench player THIS section. What a coach weighs is the next one too.
// Play him now and he is at −12 next section; rest him now and he is fresh —
// but resting clears his hot markers, which the engine does on the bench. So
// the score carries half of that difference. Against real cards that lands the
// cadence the minute maths was built for: a star plays at 0, 4 and (barely) 8
// minutes, rests at 12, and plays at 12 if he is carrying three hot markers.
//
// Attributes still count, at a small fraction: speed and power decide matchup
// advantage, which is a roll bonus the chart cannot see because the opponent's
// lineup is not known yet.

/** Average points a card pays over a d20 carrying `mod`; rebounds and assists at half. */
export function expectedOutput(card, mod = 0) {
  if (!Array.isArray(card?.chart) || card.chart.length === 0) return 0;
  let total = 0;
  for (let die = 1; die <= 20; die += 1) {
    const t = lookupChart(card, die + mod);
    total += (t.pts || 0) + 0.5 * (t.reb || 0) + 0.5 * (t.ast || 0);
  }
  return total / 20;
}

// ── SHOT CHECKS AND THE CONTEST (2026-09-23) ────────────────────────────────
//
// The user: "Shot checks are what really drive scoring, so it should probably
// try and do a lot to stop them." A defender's Defensive Bonus comes off every
// 3PT and paint check the man he guards takes — 5% of make chance a point —
// and the matchup brain never priced it: the chart was the whole of a row's
// value. What a contest is worth depends on how many checks that man takes,
// and that is steep in how good a shooter he is, because the coach and the
// cards route checks to the best chance on the floor. Measured, not guessed
// (scripts/analysis/checkVolume.mjs, 400 AI-vs-AI games): contested checks a
// section by the shooter's own uncontested make chance.
export const CHECK_RATE = {
  '3pt': [[0.05, 0.016], [0.15, 0.022], [0.30, 0.136], [0.45, 0.594]],
  paint: [[0.15, 0.009], [0.20, 0.023], [0.25, 0.024], [0.30, 0.042], [0.35, 0.089], [0.40, 0.166], [0.45, 0.245]],
};
const CHECK_POINTS = { '3pt': 3, paint: 2 };

/** A rate off a measured table: straight lines between the points, the end slopes carried on, never below 0 or past 1. */
export function rateAt(table, p) {
  const [first] = table;
  const last = table[table.length - 1];
  if (p <= first[0]) return Math.max(0, first[1] * (p / first[0]));
  for (let i = 1; i < table.length; i += 1) {
    const [x1, y1] = table[i];
    if (p <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((y1 - y0) * (p - x0)) / (x1 - x0);
    }
  }
  const [x0, y0] = table[table.length - 2];
  return Math.min(1, last[1] + ((last[1] - y0) * (p - last[0])) / (last[0] - x0));
}

/** A shooter's make chance on one kind of check at a modifier (markers, fatigue, minus a contest). */
function checkHit(shooter, type, mod = 0) {
  const boost = type === '3pt' ? (shooter?.threePtBoost || 0) : (shooter?.paintBoost || 0);
  const need = (shooter?.shotLine ?? 99) - boost - mod;
  return Math.min(1, Math.max(0, (21 - need) / 20));
}

/** A defender's contest, as matchupContest rolls it: his Defensive Bonus (with Defensive Anchor's), one more in Crunch Time. */
export function contestOf(game, def, defKey = null, defIdx = null) {
  const extra = defKey != null ? (game?.tempDefEff?.[defKey]?.[defIdx]?.dbExtra || 0) : 0;
  const base = Math.max(0, (def?.defBoost || 0) + extra);
  return base > 0 && game?.crunch?.active ? base + 1 : base;
}

/**
 * What a shooter's 3PT and paint checks pay a section against a contest:
 * how many he takes (CHECK_RATE, at his uncontested chance) times the points
 * times his chance with the contest taken off. The difference between two
 * defenders is the points the better one denies.
 */
export function checkPoints(shooter, contest = 0, mod = 0) {
  let total = 0;
  for (const type of ['3pt', 'paint']) {
    const rate = rateAt(CHECK_RATE[type], checkHit(shooter, type, mod));
    total += rate * CHECK_POINTS[type] * checkHit(shooter, type, mod - contest);
  }
  return total;
}

// ── PLAYING THE SCORE (2026-09-23) ──────────────────────────────────────────
//
// The coach weighed every row by its average and nothing else: a 10% shot at
// a big tier counted exactly at its mean whether it was up twenty or down ten
// with a section left. The user: "We can pull some levers here." What a coach
// wants is not the most points but the best chance of winning, and when the
// margin is roughly normal that is Φ((lead + μ) / σ) — so near the current
// board, a point of spread is worth −lead / (2σ²) points of average, σ² being
// what the rest of the game can still move the margin. Behind, spread is
// worth having (a long shot is how a deficit closes); ahead, it is a cost.
// Early, σ² is large and the weight is near nothing; it grows as the game
// shortens. Rows are weighed by average + weight × (the spread of both
// charts in the row), and the switch re-deal the same way.
export const RISK_AWARE = true;
/** Spread of a section's margin, from the same 400 games: a final margin's sd of 20.1 over twelve sections. */
export const SECTION_MARGIN_SD = 5.8;
export const RISK_CAP = 0.25;

/** Sections left in the game, the one about to be played included. */
export function sectionsLeftInGame(game) {
  if (game?.overtime) return 1;
  const q = game?.quarter ?? 1;
  const sec = game?.section ?? 1;
  return Math.max(1, (4 - q) * 3 + (3 - sec) + 1);
}

/** Points of average one point of margin variance is worth to `teamKey` right now. */
export function riskWeight(game, teamKey) {
  if (!RISK_AWARE || !game?.teamA || !game?.teamB) return 0;
  const lead = (getTeam(game, teamKey)?.score ?? 0) - (getOpp(game, teamKey)?.score ?? 0);
  const k = -lead / (2 * sectionsLeftInGame(game) * SECTION_MARGIN_SD ** 2);
  return Math.max(-RISK_CAP, Math.min(RISK_CAP, k));
}

/** The variance of what a chart pays over a d20 carrying `mod`, in expectedOutput's units. */
export function outputVariance(card, mod = 0) {
  if (!Array.isArray(card?.chart) || card.chart.length === 0) return 0;
  let s = 0;
  let s2 = 0;
  for (let die = 1; die <= 20; die += 1) {
    const t = lookupChart(card, die + mod);
    const v = (t.pts || 0) + 0.5 * (t.reb || 0) + 0.5 * (t.ast || 0);
    s += v;
    s2 += v * v;
  }
  const m = s / 20;
  return Math.max(0, s2 / 20 - m * m);
}

const SECTION_MINUTES = 4;
const HORIZON = 0.5;
/** Points a section charged per point of fatigue penalty beyond −6 — see lineupValue. */
const WORN_PER_POINT = 0.15;
/** How far a card's value can wobble before the sort — see aiScoringDecision. */
const CARD_JITTER = 0.3;

/**
 * A DECISION PLAYED BADLY — the difficulty ladder's shape (aiLevels.js).
 * With probability `iq` the coach does the considered thing; the rest of the
 * time a beginner's version of it. The first lever was the placement snake
 * (aiPlacementPick); these are the same dial on the cards it plays, the
 * checks it answers and the assists it spends. Math.random is the stream the
 * sim harness seeds, so audits stay reproducible, and iq 1 (every simulator,
 * the audit and the tutorial) never takes these branches at all.
 */
function misplays(iq = 1) {
  return iq < 1 && Math.random() >= iq;
}
/** Expected points a spend check is worth taking at once (a 30% three), and at a doubled surplus — see aiSpendDecision. */
const SPEND_GOOD = 0.9;
const SPEND_FLOOR = 0.45;
/** What the cards that spend assists need — the coach keeps that much back. */
const ASSIST_COST = { cross_court_dime: 3, pick_and_pop: 2, anticipate_pass: 1, crash_and_kick: 1, three_point_barrage: 1 };
/** What the cards that spend rebounds cost, for the same reserve on an open rebound check. */
const REBOUND_COST = REBOUND_CARD_COST;

/** The pick's score: this section's output, half of next section's swing, a little body. */
export function lineupValue(player, ps) {
  const min = ps?.minutes || 0;
  const markers = ps ? ((ps.hot || 0) - (ps.cold || 0)) * 2 : 0;

  const now = expectedOutput(player, fatigueForMinutes(min) + markers);
  const nextIfPlayed = expectedOutput(player, fatigueForMinutes(min + SECTION_MINUTES) + markers);
  const nextIfRested = expectedOutput(player, fatigueForMinutes(restMinutes(min))); // markers gone

  const body = 0.05 * (player.speed + player.power + (player.defBoost || 0));
  const shoot = 0.1 * ((player.threePtBoost || 0) + (player.paintBoost || 0));

  // A COLD MARKER DOES NOT WEAR OFF; ONLY THE BENCH CLEARS IT. Fatigue is a
  // curve the next section moves along, but a cold player stays cold for
  // every section he keeps playing, so the swing between "play him" and "rest
  // him" is not half of one section, it is at least a whole one. Jalen Suggs
  // took the floor at -2 and cold when a section on the bench would have
  // cleared both (the user, 2026-09-07: "resting would have ... likely been a
  // longer-term smart play"). Weighting the lookahead fully when a cold marker
  // is on him is what makes the pick see that.
  // DEEP FATIGUE IS A COST THE CHART CANNOT SHOW. Past −12 a d20 lands on
  // the chart's bottom row almost every time, so `now`, `nextIfPlayed` and
  // `nextIfRested` all sit on the same floor and the swing reads as nothing
  // — one more section looked free, and a star's attributes (`body`,
  // `shoot`) kept him on the floor for a whole half (the user, 2026-09-09:
  // "Giannis has played the entire 20 minutes … the AI keeps playing him").
  // Two answers: the lookahead is weighted in full once he is that tired,
  // as it is for a cold marker, and every point of penalty beyond −6 is
  // charged directly, so the deeper he goes the more a fresh body wins.
  const fatNow = fatigueForMinutes(min);
  const horizon = (ps?.cold || 0) > 0 || fatNow <= -12 ? 1 : HORIZON;
  const worn = WORN_PER_POINT * Math.max(0, -fatNow - 6);
  return now + horizon * (nextIfPlayed - nextIfRested) + body + shoot - worn;
}

// ── THE ROTATION: planning the half instead of the next four minutes ────────
//
// The user, 2026-09-14, on aiDraftPick: "no notion of the five as a unit, and
// no 12-section minutes budget. A human rests Giannis in S2 and S5 so he's
// fresh for crunch."
//
// WHAT THE LADDER DOES TO A PLAYER WHO NEVER SITS. Minutes on the tracker at
// the start of each section of a half, and the roll they carry:
//
//     never sits    0 / 0    4 / 0    8 / -2   12 / -6   16 / -12  20 / -18
//     planned       0 / 0    4 / 0    8 / rest  4 / 0     8 / rest  4 / 0
//
// Six sections, and the difference in the LAST one — the section with Crunch
// Time and the Clutch Possession in it — is eighteen points of roll. The
// planned half plays four of six and arrives fresh. lineupValue's one-section
// lookahead cannot see that: it weighs this section against the next, decides
// at -6 that one more is nearly free, and walks a star down the ladder.
//
// SO PLAN THE WHOLE HALF. For one player the problem is small enough to solve
// exactly — minutes are a multiple of four, the choice is play or sit, and
// halftime wipes the tracker, so the horizon is at most six sections and the
// state is (minutes, markers, sections left). What the pick wants is not the
// value of playing him, but the MARGINAL value: the best plan that plays him
// now, less the best plan that sits him now. A star three sections in scores
// well and still ranks below a fresh body, which is the whole point.
//
// The five-as-a-unit half of the note is NOT solved here: the pick is still
// greedy over the marginal values, and the constraint that exactly five play
// is handled by taking the top five. A joint search over lineups is a
// different and much larger problem.

/** Sections left in this half, the one about to be played included. */
export function sectionsLeftInHalf(game) {
  // An overtime is a single section that re-arms at Q4 S3 (engine.js), and
  // nothing follows it that can be planned for.
  if (game?.overtime) return 1;
  const q = game?.quarter ?? 1;
  const sec = game?.section ?? 1;
  const lastOfHalf = q <= 2 ? 2 : 4;
  return Math.max(1, (lastOfHalf - q) * 3 + (3 - sec) + 1);
}

/**
 * The best total a card can pay over `left` sections from here, playing or
 * sitting as it likes. `mark` is hot minus cold, worth two to the roll each;
 * a section on the bench clears them (benchRest) and no plan can get them
 * back, so the state is only "has them or does not".
 */
function planValue(card, min, mark, left, memo, exemptWithin = 0) {
  if (left <= 0) return 0;
  const key = `${min}|${mark}|${left}`;
  const seen = memo.get(key);
  if (seen !== undefined) return seen;
  // THE REST RULE, inside the plan: at twelve on the tracker he cannot play
  // the next section unless it is one the rule lifts for - the last
  // `exemptWithin` of the half (three when that half ends in Q4). A plan that
  // walks him to twelve outside those has to sit him there, which is what a
  // real rotation looks like.
  const allowed = min < MAX_STRAIGHT_MINUTES || left <= exemptWithin;
  const play = allowed
    ? expectedOutput(card, fatigueForMinutes(min) + mark * 2)
      + planValue(card, min + SECTION_MINUTES, mark, left - 1, memo, exemptWithin)
    : -Infinity;
  const sit = planValue(card, restMinutes(min), 0, left - 1, memo, exemptWithin);
  const best = Math.max(play, sit);
  memo.set(key, best);
  return best;
}

/**
 * What playing this player THIS section is worth, given the rest of the half.
 *
 * `body` and `shoot` are carried over from lineupValue unchanged: speed and
 * power decide matchup advantage, which is a roll bonus no chart can show
 * because the opponent's lineup is not known when the pick is made. Keeping
 * them identical is deliberate — it leaves the planner as the only thing that
 * changed, so a duel can attribute the result to it.
 */
export function rotationValue(player, ps, left = 1, edge = null, { exemptWithin = 0 } = {}) {
  const min = ps?.minutes || 0;
  const mark = ps ? (ps.hot || 0) - (ps.cold || 0) : 0;
  // Twelve straight is the limit (engine.js MAX_STRAIGHT_MINUTES): if he may
  // not play this section, playing him is not on the menu at all.
  if (!(min < MAX_STRAIGHT_MINUTES || left <= exemptWithin)) return -Infinity;
  const memo = new Map();
  const play = expectedOutput(player, fatigueForMinutes(min) + mark * 2)
    + planValue(player, min + SECTION_MINUTES, mark, left - 1, memo, exemptWithin);
  const sit = planValue(player, restMinutes(min), 0, left - 1, memo, exemptWithin);
  // `edge` is what this player is worth against the five they will actually
  // face (matchupEdge). Without it, the standing proxy: speed and power decide
  // matchup advantage, and a chart cannot show it.
  const standing = edge === null
    ? 0.05 * (player.speed + player.power + (player.defBoost || 0))
      + 0.1 * ((player.threePtBoost || 0) + (player.paintBoost || 0))
    : edge;
  return (play - sit) + standing;
}

// ── WHO THEY WILL PUT ON THE FLOOR, AND WHAT THAT DOES TO THE PICK ──────────
//
// The user, 2026-09-14: "There is logic to keeping certain players on the
// floor to match up better, even if they're tired."
//
// The proxy above cannot see that. speed + power + defBoost is the same number
// whoever the opponent fields, so a slow centre and a quick guard with equal
// totals score identically — when one of them is about to be hunted all
// section and the other is about to do the hunting.
//
// This is the same replacement the placement search made one decision later
// (placementChoices): a guess that is one lineup becomes an average over the
// lineups that could actually show up. The weight is not a free parameter —
// pairValue is points a section and so is the planner's own output, so the
// matchup term REPLACES the proxy rather than being added on top of it with a
// coefficient nobody tuned.
//
// MEASURED over three independent runs, 8,800 games an arm
// (scripts/analysis/runLeverLab.js, seeds 20260914 and 88117): +1.95 points of
// win rate (z 2.6) and +1.25 points of margin (z 5.5) over the proxy, and
// ahead of the control on both columns in all three runs.
export const ROTATION_SAMPLES = 8;

/**
 * A repeatable stream for one pick. The draw must not wander between two calls
 * on the SAME position — aiHiddenLineup.test.js checks that what the coach
 * cannot see does not move its pick, and a Math.random sample would make that
 * test flap rather than fail. Seeded from the position itself, so it is stable
 * for a given board and different for the next one.
 */
function seededFrom(parts) {
  let h = 0x811c9dc5;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return (h % 1e6) / 1e6;
  };
}

/** `n` lineups they might field, each five cards drawn weighted by lineupValue. */
function likelyFives(game, key, n, rand) {
  const t = getTeam(game, key);
  const roster = (t?.roster || []).filter(Boolean);
  if (roster.length <= 5) return [roster];
  const weights = roster.map(r => lineupValue(r, getPS(game, key, r.id)));
  const floor = Math.min(...weights);
  const out = [];
  for (let s = 0; s < n; s += 1) {
    const pool = roster.map((r, i) => ({ r, w: weights[i] - floor + 0.5 }));
    const five = [];
    while (five.length < 5 && pool.length) {
      const total = pool.reduce((acc, x) => acc + x.w, 0);
      let hit = rand() * total;
      let idx = 0;
      for (; idx < pool.length - 1; idx += 1) { hit -= pool[idx].w; if (hit <= 0) break; }
      five.push(pool[idx].r);
      pool.splice(idx, 1);
    }
    out.push(five);
  }
  return out;
}

/** What this player is worth a section against the fives they are likely to field. */
function matchupEdge(game, teamKey, player, fives) {
  let total = 0;
  let n = 0;
  for (const five of fives) {
    for (const them of five) { total += pairValue(game, teamKey, player, them, {}, 0); n += 1; }
  }
  return n ? total / n : 0;
}

/**
 * LEVER FIVE ON THE DIFFICULTY LADDER — and until 2026-09-14 the rotation was
 * not on it at all: aiDraftPick took no `iq`, so Settler and Deity filled the
 * floor the same considered way. A lower rung now sends out a body it simply
 * likes the look of.
 */
export function aiDraftPick(game, teamKey, { iq = 1 } = {}) {
  const whole = teamKey === 'A' ? game.draft.aPool : game.draft.bPool;
  if (!whole || whole.length === 0) return null;
  // The rest rule is a RULE, not a judgement: every rung obeys it, Settler
  // included, and a five can always be named (pickablePool bends before the
  // game breaks).
  const pool = pickablePool(game, teamKey, whole);
  if (misplays(iq)) {
    return { type: 'draft_pick', playerId: pool[Math.floor(Math.random() * pool.length)].id };
  }

  const left = sectionsLeftInHalf(game);
  // The last three sections of the second half are the fourth quarter, where
  // the rest rule lifts; an overtime is one lifted section. The first half
  // has no such window.
  const exemptWithin = (game.overtime || (game.quarter ?? 1) >= 3) ? 3 : 0;
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  // The rung decides how many of their lineups are weighed, as it does for the
  // placement search: one at Settler, all eight at Deity.
  const passes = Math.max(1, Math.round(1 + (ROTATION_SAMPLES - 1) * Math.max(0, Math.min(1, iq))));
  const rand = seededFrom([teamKey, game.quarter, game.section, game.overtime || 0, pool.length]);
  const fives = likelyFives(game, oppKey, passes, rand);
  const scored = pool.map(player => ({
    player,
    score: rotationValue(player, getPS(game, teamKey, player.id), left, matchupEdge(game, teamKey, player, fives), { exemptWithin }),
  }));
  scored.sort((a, b) => b.score - a.score);
  return { type: 'draft_pick', playerId: scored[0].player.id };
}

// ── Matchup Assignment ──────────────────────────────────────────────────────
// Assign defenders to minimize opponent's total roll bonus.
// Greedy: for each opponent starter, assign the best available defender.
/**
 * ASSIGN THE DEFENCE — every assignment scored by what it actually does.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 *
 * The old version ranked the opponent by threat and, for each, took the
 * defender with the best `speed + power + 3·defBoost`. The opponent's own
 * numbers were subtracted in the score but were the same for every candidate
 * defender, so they never changed the choice: it was a sorted pairing, best
 * remaining body onto biggest remaining threat, blind to FIT. A fast guard and
 * a slow centre with the same total were interchangeable to it. And when a
 * draft leaves both rosters in rough strength order, sorted pairing IS the
 * identity — which is why the AI looked like it never moved anyone.
 *
 * ── WHAT THIS DOES ──────────────────────────────────────────────────────────
 *
 * `calcAdv` is the engine's own verdict on one attacker against one defender:
 * the die modifier that roll will carry, temporary boosts on both sides
 * included. Five against five is 120 assignments, cheap enough to score every
 * one and keep the best — the one that gives the opponent the smallest total
 * modifier, weighted by salary so a +2 handed to their star costs more than a
 * +2 handed to their twelfth man. A penalty (negative modifier) is a gain.
 * Ties break toward the smaller worst case, so two equal totals prefer the
 * one without a blowout.
 *
 * Returns `matchups[i]` = index of MY starter guarding THEIR attacker in slot
 * i, the shape applyMatchups writes and doRoll reads.
 */
/**
 * cost[a][d]: what the opponent's attacker in slot `a` gets against my
 * defender `d`, star-weighted — the currency every assignment decision in
 * this file is priced in. `effOverride` lets a caller ask the question under
 * a DIFFERENT set of temporary effects, which is how Switch Everything gets
 * priced against its own doubling below.
 */
function matchupCosts(game, teamKey, effOverride = null) {
  const myT = getTeam(game, teamKey);
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const oppT = getTeam(game, oppKey);
  const attackers = oppT?.starters || [];
  const defenders = myT?.starters || [];
  const n = Math.min(attackers.length, defenders.length);
  if (n === 0) return null;

  const tempEff = effOverride ?? (game.tempEff?.[oppKey] || {});
  const tempDefEff = game.tempDefEff?.[teamKey] ?? null;
  // IN POINTS SINCE 2026-09-23, the snake's own currency. It was the roll
  // bonus conceded, weighted by the attacker's salary — a proxy that never
  // read a chart or a contest. The user: "I think the AI should act
  // optimally when it knows what players are already on the board." Every
  // player is on the board here, so the cost is what the attacker's chart
  // pays at the bonus this defender gives him, plus his checks against this
  // defender's contest, less the score's worth of his spread (riskWeight).
  const kappa = riskWeight(game, teamKey);
  const cost = attackers.slice(0, n).map((att, a) => {
    const ghosted = isGhosted(game, oppKey, a);
    const mod = carriedMod(game, oppKey, att);
    return defenders.slice(0, n).map((def, d) => {
      if (!att || !def) return 0;
      // A man Ghost Screen freed has no defender: no edge, no contest, whoever is assigned.
      const bonus = ghosted ? 0 : calcAdv(att, def, tempEff, a, tempDefEff, d).rollBonus;
      const contest = ghosted ? 0 : contestOf(game, def, teamKey, d);
      return expectedOutput(att, bonus + mod) + checkPoints(att, contest, mod) - kappa * outputVariance(att, bonus + mod);
    });
  });
  return { n, cost };
}

/** The total that permutation `perm` concedes, in the same currency. */
function assignmentTotal(m, perm) {
  if (!m || !perm) return Infinity;
  let t = 0;
  for (let a = 0; a < m.n; a += 1) t += m.cost[a]?.[perm[a] ?? a] ?? 0;
  return t;
}

/** The permutation that concedes least, and what it concedes. */
function bestAssignment(game, teamKey, effOverride = null) {
  const m = matchupCosts(game, teamKey, effOverride);
  if (!m) return null;
  const { n, cost } = m;

  let best = null;
  let bestTotal = Infinity;
  let bestWorst = Infinity;
  const perm = new Array(n);
  const used = new Array(n).fill(false);
  const walk = (a, total, worst) => {
    if (a === n) {
      if (total < bestTotal - 1e-9 || (Math.abs(total - bestTotal) < 1e-9 && worst < bestWorst)) {
        best = perm.slice();
        bestTotal = total;
        bestWorst = worst;
      }
      return;
    }
    for (let d = 0; d < n; d += 1) {
      if (used[d]) continue;
      used[d] = true;
      perm[a] = d;
      walk(a + 1, total + cost[a][d], Math.max(worst, cost[a][d]));
      used[d] = false;
    }
  };
  walk(0, 0, -Infinity);

  return { matchups: best, total: bestTotal, costs: m };
}

export function aiSetMatchups(game, teamKey) {
  const r = bestAssignment(game, teamKey);
  return r?.matchups ? { type: 'set_matchups', matchups: r.matchups } : null;
}

// ── Placement: which player takes the floor next ────────────────────────────
//
// THE SNAKE IS A SMALL GAME AND THE AI PLAYS IT OUT. Ten placements,
// A-B-B-A-A-B-B-A-A-B, and the row a player lands in is the pairing he
// keeps all section. The old pick scored one row at a time — its edge minus
// theirs in roll bonus — and so answered a scrub with its best defender if
// that pairing scored highest, leaving the star that came next to whoever was
// left. It also valued a +3 the same on every chart, when a +3 is worth a
// point a section to a star and next to nothing to a bench body.
//
// Now every remaining way the rows can fall is searched: the AI picks to
// maximise the sum of pairValue over the five rows, the opponent is assumed
// to pick to minimise it, and what a pairing is worth is POINTS — each side's
// chart read at the roll it would carry, fatigue and markers included. At
// most one row is ever open (the snake alternates lead and answer), so the
// state is two bitmasks and the open player: a few hundred positions, memoised.

/** The roll a player carries into this section from fatigue and markers, as doRoll adds them. */
function carriedMod(game, teamKey, player) {
  const ps = getPS(game, teamKey, player?.id);
  const min = ps?.minutes || 0;
  const markers = ps ? ((ps.hot || 0) - (ps.cold || 0)) * 2 : 0;
  return fatigueForMinutes(min) + markers;
}

/**
 * What one row is worth to `myKey`, in points a section: my player's chart at
 * the bonus he carries against theirs, less their chart at the bonus they
 * carry against mine. A hair of the raw bonus difference breaks ties between
 * flat charts — the bonus also gates cards (Mismatch Hunter, Unethical Hoops)
 * and decides the shot-check contest, which the chart cannot show.
 */
export function pairValue(game, myKey, mine, theirs, tempEff = {}, myIdx = 0, kappa = 0) {
  if (!mine || !theirs) return 0;
  const oppKey = myKey === 'A' ? 'B' : 'A';
  const myAdv = calcAdv(mine, theirs, tempEff, myIdx);
  const theirAdv = calcAdv(theirs, mine, {}, 0);
  const myMod = carriedMod(game, myKey, mine);
  const theirMod = carriedMod(game, oppKey, theirs);
  // The chart at the bonus each carries, and each shooter's checks against
  // the other's contest (2026-09-23): the row guards both ways.
  const myPts = expectedOutput(mine, myAdv.rollBonus + myMod) + checkPoints(mine, contestOf(game, theirs), myMod);
  const theirPts = expectedOutput(theirs, theirAdv.rollBonus + theirMod) + checkPoints(theirs, contestOf(game, mine), theirMod);
  // Playing the score (riskWeight): the spread of both charts, weighed by
  // what spread is worth to this side at this margin and this late.
  const spread = kappa
    ? kappa * (outputVariance(mine, myAdv.rollBonus + myMod) + outputVariance(theirs, theirAdv.rollBonus + theirMod))
    : 0;
  return myPts - theirPts + spread + 0.05 * (myAdv.rollBonus - theirAdv.rollBonus);
}


/**
 * Every remaining placement for `teamKey`, scored by the search: the value of
 * the whole snake from here if this player takes the floor now and both
 * sides play the rest out. Sorted best first. Exported so the tutorial can
 * say why the coach chose what it chose.
 */
export function placementChoices(game, teamKey, { samples = 1, rng = Math.random } = {}) {
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const myT = getTeam(game, teamKey);
  const oppT = getTeam(game, oppKey);
  const remainingFor = key => {
    const t = getTeam(game, key);
    const picks = key === 'A' ? game.draft?.aPicks ?? [] : game.draft?.bPicks ?? [];
    const placed = new Set((t.starters || []).map(pl => pl.id));
    return picks.filter(id => !placed.has(id)).map(id => (t.roster || []).find(r => r.id === id)).filter(Boolean);
  };
  // WHAT THE OTHER BENCH HAS NOT SHOWN. The lineup pick is secret, so a coach
  // placing against you knows who is on the floor and your roster, and not
  // which five you picked. The search used to read the opponent's actual
  // unplaced picks (the user, 2026-09-10: "When doing the matchup
  // calculations, does the CPU already know my five players? They
  // technically should not."). The rows it has not seen are now GUESSED from
  // the roster: the players likeliest to have been picked, scored the way a
  // coach picks its own five (lineupValue: fatigue, markers, attributes).
  // Each real placement replaces a guess with the truth as the snake goes.
  const guessRemaining = key => {
    const t = getTeam(game, key);
    const placed = new Set((t.starters || []).map(pl => pl.id));
    const count = Math.max(0, 5 - placed.size);
    return (t.roster || [])
      .filter(r => r && !placed.has(r.id))
      .map(r => ({ r, v: lineupValue(r, getPS(game, key, r.id)) }))
      .sort((a, b) => b.v - a.v || String(a.r.id).localeCompare(String(b.r.id)))
      .slice(0, count)
      .map(x => x.r);
  };
  /**
   * THE FIVE THEY HAVE NOT SHOWN YET, DRAWN RATHER THAN ASSUMED.
   *
   * guessRemaining above takes the top `count` by lineupValue and treats them
   * as certain, which is one good guess and an overconfident one: the snake is
   * the whole game (the user, 2026-09-14: "deep knowledge of the other team,
   * who may or may not be coming next, and optimizing matchups — that's the
   * name of the entire game"), and a coach who is sure about a lineup it
   * cannot see will place against a team that never takes the floor.
   *
   * Sampling instead. Weight every unplaced card by lineupValue — the same
   * reading the coach uses to pick its OWN five — and draw `count` of them
   * without replacement. Run the search against several such lineups and
   * average what each of my cards is worth across them, so a placement that
   * is merely good against one guess loses to one that holds up across the
   * lineups they are actually likely to field.
   *
   * At samples = 1 this is exactly the old single guess, because the first
   * draw of a weighted sample with no randomness is the top of the list.
   */
  const drawRemaining = key => {
    const t = getTeam(game, key);
    const placed = new Set((t.starters || []).map(pl => pl.id));
    const count = Math.max(0, 5 - placed.size);
    const pool = (t.roster || [])
      .filter(r => r && !placed.has(r.id))
      .map(r => ({ r, v: lineupValue(r, getPS(game, key, r.id)) }));
    if (pool.length <= count) return pool.map(x => x.r);
    // Shift so the weakest card still has some chance of being played: a
    // negative lineupValue would otherwise be impossible rather than unlikely.
    const floor = Math.min(...pool.map(x => x.v));
    const weights = pool.map(x => Math.max(0.01, x.v - floor + 0.5));
    const out = [];
    const left = [...pool.keys()];
    for (let n = 0; n < count && left.length; n += 1) {
      let total = left.reduce((t2, i) => t2 + weights[i], 0);
      let roll = rng() * total;
      let pick = left[left.length - 1];
      for (const i of left) { roll -= weights[i]; if (roll <= 0) { pick = i; break; } }
      out.push(pool[pick].r);
      left.splice(left.indexOf(pick), 1);
    }
    return out;
  };

  const mine = remainingFor(teamKey);
  if (!mine.length) return [];
  // The score, read once for the whole search (riskWeight).
  const kappa = riskWeight(game, teamKey);
  /** Every one of my cards scored against ONE possible opponent lineup. */
  const scoreAgainst = theirs => {
    // `theirs` is the lineup this pass is played against.
    const order = game.placementOrder || DEFAULT_ORDER;
    const step = game.placementStep ?? (myT.starters.length + oppT.starters.length);
    // The steps after this one. The first must be mine for the scores to mean
    // "if I place this now"; a caller asking out of turn is scored as if it were.
    const ahead = order.slice(step);
    const steps = ahead.length && ahead[0] === teamKey ? ahead.slice(1) : ahead;

    // Pairing values, from my chair, for every remaining pair — and for the
    // row the opponent has already led, if they are a player ahead of me.
    const val = mine.map(m => theirs.map(o => pairValue(game, teamKey, m, o, {}, 0, kappa)));
    const openOpp = oppT.starters.length > myT.starters.length ? oppT.starters[myT.starters.length] : null;
    const openVal = openOpp ? mine.map(m => pairValue(game, teamKey, m, openOpp, {}, 0, kappa)) : null;

    const memo = new Map();
    const bits = mask => { const out = []; for (let i = 0; mask >> i; i += 1) if (mask & (1 << i)) out.push(i); return out; };
    const solve = (si, mMask, oMask, open) => {
      if (si >= steps.length) return 0;
      const key = `${si}|${mMask}|${oMask}|${open ? open.side + open.idx : '-'}`;
      if (memo.has(key)) return memo.get(key);
      const mover = steps[si];
      let best;
      if (mover === teamKey) {
        const cands = bits(mMask);
        if (!cands.length) best = solve(si + 1, mMask, oMask, open);
        else {
          best = -Infinity;
          for (const m of cands) {
            const answering = open && open.side === 'opp';
            const gain = answering ? (open.idx === -1 ? openVal[m] : val[m][open.idx]) : 0;
            const v = gain + solve(si + 1, mMask & ~(1 << m), oMask, answering ? null : { side: 'me', idx: m });
            if (v > best) best = v;
          }
        }
      } else {
        const cands = bits(oMask);
        if (!cands.length) best = solve(si + 1, mMask, oMask, open);
        else {
          best = Infinity;
          for (const o of cands) {
            const answering = open && open.side === 'me';
            const gain = answering ? val[open.idx][o] : 0;
            const v = gain + solve(si + 1, mMask, oMask & ~(1 << o), answering ? null : { side: 'opp', idx: o });
            if (v < best) best = v;
          }
        }
      }
      memo.set(key, best);
      return best;
    };

    const mMask0 = (1 << mine.length) - 1;
    const oMask0 = (1 << theirs.length) - 1;
    const answering = Boolean(openOpp);
    const out = mine.map((player, m) => {
      const gain = answering ? openVal[m] : 0;
      const v = gain + solve(0, mMask0 & ~(1 << m), oMask0, answering ? null : { side: 'me', idx: m });
      return { player, value: v, rowValue: answering ? openVal[m] : null, answering };
    });
    return out;
  };

  // One pass is the old behaviour exactly; more are averaged, so a placement
  // that only works against one guessed five cannot win.
  const passes = Math.max(1, Math.trunc(samples));
  const lineups = passes === 1 ? [guessRemaining(oppKey)]
    : Array.from({ length: passes }, () => drawRemaining(oppKey));
  const tallies = lineups.map(scoreAgainst);
  const out = mine.map((player, i) => ({
    player,
    value: tallies.reduce((t, pass) => t + pass[i].value, 0) / tallies.length,
    rowValue: tallies[0][i].rowValue,
    answering: tallies[0][i].answering,
  }));
  out.sort((a, b) => b.value - a.value);
  return out;
}

/**
 * `iq` (0..1, default 1) is the difficulty's first lever (aiLevels.js): the
 * chance this placement is the search's best answer; otherwise it is any
 * remaining player. Math.random, so the sims' seeded rng reproduces it.
 */
/**
 * HOW MANY OPPONENT LINEUPS THE COACH WEIGHS BEFORE IT PLACES, at the top rung.
 *
 * The placement snake is the game — the user, 2026-09-14: "deep knowledge of
 * the other team, who may or may not be coming next, and optimizing matchups.
 * That's the name of the entire game" — and the coach used to answer it with
 * ONE guess: the top five by lineupValue, held as certain.
 *
 * MEASURING THIS TOOK TWO HARNESSES AND NEARLY WENT WRONG TWICE.
 *
 * runAiDuel says the distribution LOSES, 47.8% over 800 games. It is right and
 * it is measuring the wrong thing: aiDraftPick takes the top five by
 * lineupValue and guessRemaining predicts the top five by lineupValue, so in
 * AI-vs-AI the guess is not a guess, it is the truth, and sampling can only
 * add noise to a perfect prediction. A human does not pick that way.
 *
 * Against an opponent choosing its five OFF the coach's own ordering, 2,200
 * games an arm, with the control (same brain both sides) at 49.4% / +0.16:
 *
 *      4 lineups   50.5%   +0.64
 *      8 lineups   51.7%   +0.68
 *     16 lineups   53.1%   +1.21
 *
 * Monotonic, and 53.1% clears the +/-2.1 interval at that n. At 500 games the
 * same arms read 51.2 / 50.4 / 51.0 / 51.0 against a control of +0.93 — all
 * noise, and a default of 1 was nearly shipped on the strength of it. The
 * ladder's own warning applies to its levers too: enough games or none.
 */
export const PLACEMENT_SAMPLES = 16;

/**
 * Foresight is the rung. Settler weighs one lineup and then usually ignores
 * the answer (misplays below); Deity weighs all sixteen. This is the ladder's
 * fifth lever and, unlike the four misplays dials, it has no ceiling at
 * "never do the dumb thing" — a better search just keeps being better.
 */
export const samplesFor = iq => Math.max(1, Math.round(1 + (PLACEMENT_SAMPLES - 1) * Math.max(0, Math.min(1, iq))));

export function aiPlacementPick(game, teamKey, { iq = 1, samples = samplesFor(iq) } = {}) {
  const choices = placementChoices(game, teamKey, { samples });
  if (!choices.length) return null;
  const pick = iq >= 1 || Math.random() < iq
    ? choices[0]
    : choices[Math.floor(Math.random() * choices.length)];
  return { type: 'place_player', playerId: pick.player.id, value: pick.value, best: pick === choices[0] };
}

// ── Conversion spends ───────────────────────────────────────────────────────
//
// The sim harness proved the value (the conversion channel is ~10% of all
// scoring) and the live AI never touched it — no spendAssist caller existed
// anywhere in this file. One decision per call, greedy: threes ahead of paint
// by the best boost in the lineup, rebound paint-checks when the section
// published one. The caller loops until null.
export function aiSpendDecision(game, teamKey, opts = {}) {
  const team = getTeam(game, teamKey);
  if (!team?.starters?.length) return null;
  // Any player may take a spend check now (2026-09-09); the AI nominates the
  // best CHANCE on the floor — checkNeed's reading of bonus, contest and
  // markers against the Shot Line — and spends only when the check is
  // worth the currency: about a point of expected scoring per five spent.
  const bestChanceWith = (type, needOpts) => {
    let out = null;
    team.starters.forEach((p, i) => {
      if (!p) return;
      const n = checkNeed(game, teamKey, i, type, needOpts);
      if (!out || n.pHit > out.pHit) out = { idx: i, pHit: n.pHit };
    });
    return out;
  };
  const bestChance = type => bestChanceWith(type);
  // ASSISTS ARE WORTH NOTHING IN THE BANK. The first cut of this spent only
  // on a ≥30% three or a ≥45% paint check; against real lineups the paint
  // bar was never met and a third of lineups never met the three bar, so a
  // coach with poor shooters sat on eleven assists all game (the user,
  // 2026-09-09). Now: the best check by expected points, taken whenever it
  // is worth a modest floor — and at twice the cost, taken regardless. An
  // assist to spare beyond the cost is banked as a +1 on that player first.
  // BUT ASSISTS FUND CARDS TOO. Cross-Court Dime costs three, Pick-and-Pop
  // two, Anticipate the Pass, Crash and Kick and Three-Point Barrage's extra
  // check one each — and a 600-game duel of a spend-everything policy lost
  // 45% to the hoarder, because those plays are worth more per assist than
  // a weak check. So: keep what the cards in hand need, and spend what is
  // left in tiers — a good check at once, a fair one when the surplus is
  // twice the cost, anything at three times, so nothing sits forever.
  const ast = team.assists ?? 0;
  const reserve = Math.max(0, ...(team.hand || []).map(id => ASSIST_COST[id] || 0));
  const surplus = ast - reserve;
  const three = bestChance('3pt');
  const paint = bestChance('paint');
  const choices = [];
  if (three) choices.push({ spendType: '3pt', idx: three.idx, ev: three.pHit * 3, cost: SPEND_COSTS.assistThree });
  if (paint) choices.push({ spendType: 'paint', idx: paint.idx, ev: paint.pHit * 2, cost: SPEND_COSTS.assistPaint });
  choices.sort((a, b) => b.ev - a.ev);
  // LEVER FOUR — THE CURRENCY. A lower level spends the moment it can afford
  // anything, keeping nothing back for the cards in its hand.
  if (misplays(opts.iq)) {
    const any = choices.find(c => ast >= c.cost);
    if (any) return { type: 'spend_assist', spendType: any.spendType, playerIdx: any.idx };
  }
  const best = choices.find(c => ast >= c.cost);
  if (best) {
    const floor = surplus >= 3 * best.cost ? 0 : surplus >= 2 * best.cost ? SPEND_FLOOR : SPEND_GOOD;
    if (surplus >= best.cost && best.ev >= floor) return { type: 'spend_assist', spendType: best.spendType, playerIdx: best.idx };
  }
  if (paint && reboundCheckOpen(game, teamKey)) {
    // GATED, it is a reward for winning the glass: always worth taking. OPEN
    // (REBOUND_RULES.paintGate 0), the bank is a currency like the assists:
    // keep what the cards in hand need, and spend the rest in the same tiers.
    // The shooter is chosen on the check this spend takes: its own bonus, no banked assist.
    const best = bestChanceWith('paint', { extra: reboundCheckBonus(game, teamKey), banked: false });
    if (REBOUND_RULES.paintGate > 0) return { type: 'spend_rebound', rebType: 'paint_check', playerIdx: best.idx };
    const reb = team.rebounds ?? 0;
    const rebReserve = Math.max(0, ...(team.hand || []).map(id => REBOUND_COST[id] || 0));
    const rebSurplus = reb - rebReserve;
    const cost = SPEND_COSTS.reboundPaint;
    const ev = best.pHit * 2;
    const floor = rebSurplus >= 3 * cost ? 0 : rebSurplus >= 2 * cost ? SPEND_FLOOR : SPEND_GOOD;
    if (misplays(opts.iq) || (rebSurplus >= cost && ev >= floor)) return { type: 'spend_rebound', rebType: 'paint_check', playerIdx: best.idx };
  }
  return null;
}

// ── Scoring Phase: Card or Pass ─────────────────────────────────────────────
// Evaluate all playable cards in hand, score them, play the best one or pass.
export function aiScoringDecision(game, teamKey, opts = {}) {
  const team = getTeam(game, teamKey);
  const hand = team.hand || [];

  // Find all playable cards with their value
  const playable = [];

  for (const cardId of hand) {
    const check = canPlayCard(game, teamKey, cardId);
    if (!check.canPlay) continue;

    const strat = getStrat(cardId);
    if (!strat) continue;

    // Only consider cards for the current game context
    const value = evaluateCard(game, teamKey, cardId, strat, opts);
    if (value > 0) {
      playable.push({ cardId, value, strat });
    }
  }

  if (playable.length === 0) return { type: 'pass' };

  // LEVER TWO — CARD JUDGEMENT. A lower level knows what it can play and not
  // which is worth playing: any legal card, chosen at random.
  if (misplays(opts.iq)) {
    const wild = playable[Math.floor(Math.random() * playable.length)];
    return { type: 'play_card', cardId: wild.cardId, opts: aiBuildCardOpts(game, teamKey, wild.cardId) };
  }

  // A MIXED STRATEGY. evaluateCard is very nearly a fixed table, so with a
  // straight sort the AI played the same card from the same hand every time
  // and a player could read its whole sequence after two games (the user,
  // 2026-09-07: "playing cards in the same order no matter what"). Each value
  // is jittered by up to ±15% before the sort: cards within a few points of
  // each other trade places game to game, a clearly better card still wins.
  // Math.random here is the same stream the sim harness seeds, so audits stay
  // reproducible.
  for (const c of playable) c.value *= 1 + (Math.random() - 0.5) * CARD_JITTER;
  playable.sort((a, b) => b.value - a.value);
  const best = playable[0];

  // Build opts for the chosen card
  const cardOpts = aiBuildCardOpts(game, teamKey, best.cardId);

  return { type: 'play_card', cardId: best.cardId, opts: cardOpts };
}

// ── Card Value Evaluation ───────────────────────────────────────────────────
/**
 * Would Switch Everything actually MOVE anybody? The AI sets its defence at
 * the start of every section (aiSetMatchups), so the "best" assignment the
 * card would apply is usually the one already on the floor — and the card's
 * cost, doubling every opponent advantage, is paid either way. The 600-game
 * audit had it played 400 times, nearly all for nothing. It is worth playing
 * only when the opponent's screen or a mid-section boost has left the current
 * assignment behind.
 */
export function switchEverythingChanges(game, teamKey) {
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const best = aiSetMatchups(game, teamKey)?.matchups;
  if (!best) return false;
  const now = game.offMatchups?.[oppKey] || [0, 1, 2, 3, 4];
  return best.some((d, i) => d !== now[i]);
}

/**
 * WHAT SWITCH EVERYTHING IS WORTH, net of what it costs.
 *
 * "Does anybody move?" was the wrong question, and it is the one the coach
 * used to ask (the user, 2026-09-12: "AI also seems to play Switch Everything
 * in a way that gives me massive advantages"). The card reassigns the whole
 * defence AND doubles every advantage the offence holds, so a reassignment
 * that gains a little while the doubling costs a lot is a gift. Worse, the
 * assignment it applied was the optimum computed WITHOUT the doubling, so it
 * was not even the best answer under the card's own terms.
 *
 * Both halves are fixed here by pricing the two boards in one currency:
 *
 *   now      what they get off the floor as it stands, undoubled
 *   after    what they get off the best assignment WITH doubling counted
 *
 * The gain is now − after, and the card is worth a turn only when that clears
 * SWITCH_FLOOR, the same bar High Screen & Roll and the cancellers answer to.
 * Measured over 150 simulated games the old rule played it 100 times, one in
 * six of them for a net LOSS, the worst at −8.1 of weighted roll bonus.
 */
export function switchEverythingValue(game, teamKey) {
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const plain = game.tempEff?.[oppKey] || {};
  const m = matchupCosts(game, teamKey, plain);
  if (!m) return { gain: 0, matchups: null };
  const now = assignmentTotal(m, game.offMatchups?.[oppKey] || [0, 1, 2, 3, 4]);
  // Already doubled (a second copy in the same segment): the price is paid,
  // so the reassignment is all upside and is judged on its own.
  const after = bestAssignment(game, teamKey, { ...plain, doubleAdv: true });
  if (!after?.matchups) return { gain: 0, matchups: null };
  return { gain: now - after.total, matchups: after.matchups };
}

/**
 * THE SCREEN AND ITS CANCELLERS ARE JUDGED IN POINTS, not from a table.
 *
 * High Screen & Roll used to be a flat 6 with a fallback swap of slots 0 and
 * 1 when no swap gained — the AI played a switch against itself. Go Under,
 * Fight Over and Veer Switch were a flat 7/6/6 whenever the opponent had
 * switched at all, so the coach cancelled switches that had cost it nothing
 * and paid Go Under's free three for the privilege. Both now read the
 * pairings before and after through pairValue's arithmetic:
 *
 *   bestScreen        the swap of two of MY attackers' defenders that gains
 *                     the most points a section; nothing → the card is not
 *                     worth a turn
 *   switchCancelValue what THEIR screen bought them, and what each canceller
 *                     would take back net of its price (Fight Over's +2 to
 *                     the faster attacker, Go Under's 3PT check at +2,
 *                     Veer's keep-or-trade)
 *
 * `opts.demo` (the tutorial) makes a canceller always worth playing, so the
 * lesson that shows one lands every time.
 */
const CANCELLERS = ['go_under', 'fight_over', 'veer_switch'];
/** What a canceller is worth to the tutorial's coach (opts.demo): more than any card's table value can jitter to. */
const DEMO_CANCEL_VALUE = 20;
/** Points a section a switch (or its cancel) must be worth before a card goes on it. */
const SWITCH_FLOOR = 0.4;
const pointsFor = (game, offKey, p, slot, def, extra = 0) => {
  if (!p || !def) return 0;
  const mod = carriedMod(game, offKey, p);
  // A ghosted man has no defender to switch (Ghost Screen): no edge either way, no contest.
  if (isGhosted(game, offKey, slot)) return expectedOutput(p, mod + extra) + checkPoints(p, 0, mod);
  const eff = game.tempEff?.[offKey] || {};
  // His checks against this defender's contest count too (2026-09-23): a
  // screen that trades a good contester off a shooter is worth what it frees.
  return expectedOutput(p, calcAdv(p, def, eff, slot).rollBonus + mod + extra) + checkPoints(p, contestOf(game, def), mod);
};

/** My best High Screen & Roll: the two of my attackers whose defenders, traded, pay most. */
export function bestScreen(game, teamKey) {
  const myT = getTeam(game, teamKey);
  const oppT = getOpp(game, teamKey);
  const starters = myT.starters || [];
  const mu = game.offMatchups?.[teamKey] || [0, 1, 2, 3, 4];
  let best = null;
  for (let i = 0; i < starters.length; i += 1) {
    for (let j = i + 1; j < starters.length; j += 1) {
      const di = mu[i] ?? i, dj = mu[j] ?? j;
      const now = pointsFor(game, teamKey, starters[i], i, oppT.starters[di]) + pointsFor(game, teamKey, starters[j], j, oppT.starters[dj]);
      const swapped = pointsFor(game, teamKey, starters[i], i, oppT.starters[dj]) + pointsFor(game, teamKey, starters[j], j, oppT.starters[di]);
      const delta = swapped - now;
      if (!best || delta > best.delta) best = { i, j, delta };
    }
  }
  return best;
}

/**
 * The 3PT check Go Under hands the offence — and THE OFFENCE CHOOSES who
 * takes it (2026-09-09), so its price to the defence is the BETTER shooter's
 * expected points. The check is at +2 less the restored defender's contest.
 * Returns the offence's best slot and what it is worth.
 */
export function goUnderPrice(game, offKey, slots, defs) {
  const offT = getTeam(game, offKey);
  let best = null;
  slots.forEach((slot, k) => {
    const p = offT.starters[slot];
    if (!p) return;
    const def = defs[k];
    const contest = Math.max(0, (def?.defBoost || 0)) + ((def?.defBoost || 0) > 0 && game.crunch?.active ? 1 : 0);
    const ps = getPS(game, offKey, p.id);
    const bonus = 2 - contest + (p.threePtBoost || 0) + (ps ? ((ps.hot || 0) - (ps.cold || 0)) * 2 : 0);
    const need = (p.shotLine || 99) - bonus;             // the die it takes
    const pHit = Math.min(1, Math.max(0, (21 - need) / 20));
    const pts = 3 * pHit;
    if (!best || pts > best.pts) best = { slot, pts };
  });
  return best ?? { slot: slots[0], pts: 0 };
}

/** The offence's answer to a waiting Go Under: the shooter with the best chance, by checkNeed. */
export function aiGoUnderChoice(game, teamKey) {
  const pc = game.pendingChoice;
  if (!pc || pc.kind !== 'go_under' || pc.teamKey !== teamKey) return null;
  let best = null;
  for (const slot of pc.slots) {
    const n = checkNeed(game, teamKey, slot, '3pt');
    const pHit = Math.min(1, Math.max(0, (21 - (n.need - pc.extra)) / 20));
    if (!best || pHit > best.pHit) best = { slot, pHit };
  }
  return best ? best.slot : pc.slots[0];
}

/**
 * From the defence's chair: what the offence's screen bought them (`gain`)
 * and what this canceller takes back net of its price (`saved`), both in
 * points a section. Zero when there is nothing to answer.
 */
export function switchCancelValue(game, teamKey, cardId) {
  const lc = game.lastMatchupCard;
  if (!lc?.opts || lc.teamKey === teamKey) return { gain: 0, saved: 0 };
  const offKey = lc.teamKey;
  const offT = getTeam(game, offKey);
  const myT = getTeam(game, teamKey);
  const { swapSlot1: s1, swapSlot2: s2, origD1: d1, origD2: d2 } = lc.opts;
  const p1 = offT.starters[s1], p2 = offT.starters[s2];
  const D1 = myT.starters[d1], D2 = myT.starters[d2];
  if (!p1 || !p2 || !D1 || !D2) return { gain: 0, saved: 0 };
  const before = pointsFor(game, offKey, p1, s1, D1) + pointsFor(game, offKey, p2, s2, D2);   // as placed
  const after = pointsFor(game, offKey, p1, s1, D2) + pointsFor(game, offKey, p2, s2, D1);    // after their screen
  const gain = after - before;
  let left = before;
  if (cardId === 'fight_over') {
    const fast = (p1.speed || 0) >= (p2.speed || 0) ? [p1, s1, D1] : [p2, s2, D2];
    left = before - pointsFor(game, offKey, ...fast) + pointsFor(game, offKey, ...fast, 2);
  } else if (cardId === 'go_under') {
    left = before + goUnderPrice(game, offKey, [s1, s2], [D1, D2]).pts;
  } else if (cardId === 'veer_switch') {
    left = Math.min(before, after);
  }
  return { gain, saved: after - left };
}

function evaluateCard(game, teamKey, cardId, strat, opts = {}) {
  const phase = game.phase;
  if (cardId === 'switch_everything') {
    const { gain } = switchEverythingValue(game, teamKey);
    return gain >= SWITCH_FLOOR ? Math.min(10, 3 + 2 * gain) : 0;
  }
  if (cardId === 'high_screen_roll') {
    if (phase !== 'matchup_strats') return 0;
    const sc = bestScreen(game, teamKey);
    return sc && sc.delta >= SWITCH_FLOOR ? Math.min(10, 3 + 2 * sc.delta) : 0;
  }
  if (CANCELLERS.includes(cardId)) {
    // Above anything the ±15% jitter can lift another card to (2026-09-18):
    // at a flat 7 the tutorial's coach answered your switch with its own High
    // Screen & Roll (up to 10) in 8% of tutorials, and the cancel lesson that
    // opts.demo exists for never came.
    if (opts.demo) return DEMO_CANCEL_VALUE;
    const { saved } = switchCancelValue(game, teamKey, cardId);
    return saved >= SWITCH_FLOOR ? Math.min(10, 3 + 2 * saved) : 0;
  }
  // COACH'S CHALLENGE RE-ROLLS THE OTHER SIDE'S LAST CHECK. A re-roll of a
  // miss can only turn it into a make (the user, 2026-09-09: "AI played
  // coach's challenge on my miss, which converted into a make"). Only a make
  // is worth challenging, and a three more than a two.
  if (cardId === 'coaches_challenge') {
    const lsc = game.lastShotCheck;
    if (!lsc || lsc.teamKey === teamKey || !lsc.result?.hit) return 0;
    return 4 + (lsc.pts || 0);
  }

  // Phase gating — matchup cards only in matchup phase, etc.
  if (strat.phase === 'matchup' && phase !== 'matchup_strats') return 0;
  if (strat.phase === 'scoring' && phase !== 'scoring') return 0;
  if (strat.phase === 'pre_roll' && phase !== 'scoring') return 0;
  if (strat.phase === 'post_roll' && phase !== 'scoring') return 0;
  if (strat.phase === 'reaction') {
    // Reactions are ordinary plays on your own turn when their state
    // condition holds (canPlayCard already said yes before this runs) — the
    // old hard zero here is why the audit found the entire canceller economy
    // dead even after switch cards came alive.
    const reactionValues = {
      go_under: 7, fight_over: 6, veer_switch: 6, burned_switch: 5,
      offensive_foul: 5, beat_to_the_spot: 5, verticality: 7, cold_spell: 6, anticipate_pass: 5, overhelp: 5,
      offensive_board: 5, rebound_tap_out: 5, coaches_challenge: 6, close_out: 6,
      // Wave one (2026-09-06)
      find_the_open_man: 7, putback_specialist: 6, rim_protector: 7, drop_coverage: 5,
      smothering_defense: 5, denial: 4, hustle_play: 5, glass_cleaner: 6, box_out: 6,
      help_defender: 7,
      // Wave two twins (2026-09-23): Box Out's price, for assists.
      passing_lane: 6,
      // The glass (2026-09-23): Putback Specialist's price for its twin;
      // the transition bucket a touch under, the shooter is not chosen.
      kick_out_three: 6, rebound_and_push: 5,
    };
    return reactionValues[cardId] ?? 4;
  }

  // THE FORFEIT FAMILY IS PRICED BY WHAT IT GIVES UP. A card that would net
  // nobody above zero is not played — the table value below is what it is
  // worth when there IS a player it pays on (forfeitNet).
  if (FORFEIT_CARDS[cardId]) {
    const best = bestForfeitTarget(game, teamKey, cardId);
    if (!best || best.net <= 0) return 0;
  }

  // Base values by card type
  const values = {
    // Matchup phase
    high_screen_roll: 6,
    stagger_action: 7,
    second_wind: 5,
    chip_on_shoulder: 6,
    defensive_stopper: 7,
    pick_up_full_court: 5,

    // Pre-roll
    ghost_screen: 5,
    you_stand_over_there: 7,
    putback_dunk: 8,
    pin_down_screen: 6,
    turnover: 4,
    // Wave two twins (2026-09-23): priced as the cards they mirror.
    feeling_it: 4, clamp_the_reserve: 5, point_god: 6, blow_by: 7,
    // The glass (2026-09-23): two checks for 5 REB against one; the
    // exchange is a small edge, played when nothing better is.
    own_the_glass: 8, grab_and_go: 3,

    // Scoring
    green_light: 8,
    from_way_downtown: 4,
    catch_and_shoot: 5,
    elevator_doors: 6,
    bully_ball: 7,
    power_move: 4,
    and_one: 6,
    rimshaker: 7,
    drive_the_lane: 5,
    uncontested_layup: 8,
    back_to_basket: 5,
    cross_court_dime: 7,
    energy_injection: 4,
    crowd_favorite: 4,   // fires now (was 5+ with no reader)
    switch_everything: 6,   // unreachable: priced in points above, net of the doubling
    this_is_my_house: 8,
    delayed_slip: 4,
    double_team: 6,

    // Crunch Time (canPlay gates them to the window; riders to the timeout)
    desperation_press: 8,
    second_closer: 7,
    ato_masterpiece: 8,
    fresh_legs: 6,
    ice_the_hot_hand: 7,
    reset: 6,
    // Priced on the swing it actually buys, which the opts builder measures
    // per target: a roll taken away, minus the free throws handed over.
    hack_a: 7,
    // A whole section without their best defender, but only next section.
    foul_trouble: 6,

    // Wave one (2026-09-06)
    spain_pick_roll: 6, mismatch_hunter: 6, strength_in_numbers: 8, energizer: 5,
    defensive_identity: 6, defensive_anchor: 6, swarming_defense: 5,
    five_out: 6, hammer_set: 4, iso_heavy: 5, three_point_barrage: 8, crash_and_kick: 5,
    pick_and_pop: 5, extra_pass: 4, lob_city: 8, stretch_five: 6, post_domination: 6,
    unsung_hero: 6, transition_outlet: 5,
    // Wave two (2026-09-07). Outside Pick costs a card, so it is priced under
    // the free threes; Maestro is high because a 5+ mismatch is the best paint
    // check in the game; Inside-Out is a free three off a bucket you already
    // have; Short-Roll is a slow burn that only pays if the big scores inside.
    outside_pick: 6, pick_and_roll_maestro: 8, inside_out: 7, short_roll_playmaker: 5,
    // The standing pair are worth more than one play, because they are not one
    // play — they come back every period until a big sits down.
    run_the_floor: 9, twin_towers: 9,
    // Two near-certain points in the section that decides the game.
    unethical_hoops: 8,
    // Post-roll
    heat_check: 7,
    burst_of_momentum: 6,
    flare_screen: 7,

    // Defensive scoring
    dogged: 4,
    offensive_board: 5,
    rebound_tap_out: 5,
  };

  // A called timeout exists FOR its riders: while your own window is open
  // they outrank everything else in hand, or the window closes unspent.
  if (game.timeoutActive === teamKey
    && TIMEOUT_RIDERS.includes(cardId)) {
    return (values[cardId] || 3) + 4;
  }
  return values[cardId] || 3;
}

// ── Build Card Options ──────────────────────────────────────────────────────
// For cards that need player selection, pick the best target.
// ── THE FORFEIT FAMILY: cards that replace a scoring roll with shot checks ──
//
// The user, 2026-09-16: "I think the AI just used 'You Stand Over There' on
// Shai on Deity difficulty. His ability to score 4 is so accessible and
// getting rebounds and assists makes that kind of a low-EV play."
//
// It did, and at Deity that was the coach's CONSIDERED choice, because two
// things were wrong with how it read these cards. The target was "the best
// 3PT shooter who has not rolled" — which never subtracts the roll it is
// throwing away, and Shai has a good 3PT bonus AND the chart that makes the
// roll worth keeping. And the card's value was a flat number from a table (7),
// the same whoever played it, so a losing play looked as good as a winning one.
//
// Four cards do this: Green Light (three 3PT checks), You Stand Over There
// (two), Five-Out Offense (two at +1, needs a 3PT bonus), Cross-Court Dime (a
// paint check and a 3PT check, for three assists). What each is worth on a
// given player is the same sum every time:
//
//     what the checks pay          points per hit x the chance of a hit, the
//                                  engine's own arithmetic (checkNeed: assist
//                                  boost, the defender's contest, the shooting
//                                  bonus, hot and cold)
//   - what the roll would have     expectedOutput at the roll bonus he carries
//                                  — points, and rebounds and assists at half,
//                                  which is exactly the part the old pick
//                                  never saw
//   - what the card costs          three assists for the Dime, at roughly what
//                                  an assist buys back on a check
//
// The coach plays the card on the player for whom that NET is largest, and
// does not play it at all when no player nets above zero. The same function
// is what a coach tip reads off for a human about to make the Shai play.
export const FORFEIT_CARDS = {
  green_light:          { checks: [{ type: '3pt', bonus: 0 }, { type: '3pt', bonus: 0 }, { type: '3pt', bonus: 0 }] },
  you_stand_over_there: { checks: [{ type: '3pt', bonus: 0 }, { type: '3pt', bonus: 0 }] },
  five_out:             { checks: [{ type: '3pt', bonus: 1 }, { type: '3pt', bonus: 1 }], needsThree: true },
  cross_court_dime:     { checks: [{ type: 'paint', bonus: 0 }, { type: '3pt', bonus: 0 }], assists: 3 },
};
/** What a made check scores (SPEND_COSTS' own reading: a three is 3, a paint bucket 2). */
const CHECK_PTS = { '3pt': 3, paint: 2 };
/** Roughly what one banked assist buys back — a +1 on a check, or a fifth of a three. */
const ASSIST_WORTH = 0.3;

/**
 * What playing `cardId` on the player in slot `idx` is worth, net of the roll
 * he gives up — or null when he is not a legal target (already rolled,
 * blocked, or short of the card's condition).
 */
export function forfeitNet(game, teamKey, idx, cardId) {
  const spec = FORFEIT_CARDS[cardId];
  if (!spec) return null;
  const myT = getTeam(game, teamKey);
  const oppT = getOpp(game, teamKey);
  const p = myT?.starters?.[idx];
  if (!p) return null;
  if ((game.rollResults?.[teamKey] || [])[idx] != null) return null;
  if ((game.blockedRolls?.[teamKey] || {})[idx]) return null;
  if (spec.needsThree && !((p.threePtBoost || 0) > 0)) return null;
  let checks = 0;
  for (const c of spec.checks) {
    const { need } = checkNeed(game, teamKey, idx, c.type);
    const pHit = Math.min(1, Math.max(0, (21 - (need - c.bonus)) / 20));
    checks += CHECK_PTS[c.type] * pHit;
  }
  // The roll given up is priced at the matchup the dice would use (matchupAdv:
  // Ghost Screen, a defender's own boosts), not a bare calcAdv.
  const adv = matchupAdv(game, teamKey, idx) || { rollBonus: 0 };
  const ps = getPS(game, teamKey, p.id) || {};
  const roll = expectedOutput(p, adv.rollBonus + getFatigue(game, teamKey, idx) + ((ps.hot || 0) - (ps.cold || 0)) * 2);
  const cost = (spec.assists || 0) * ASSIST_WORTH;
  return { idx, player: p, checks, roll, cost, net: checks - roll - cost };
}

/** The legal target that nets the most for `cardId`, or null when nobody is legal. */
export function bestForfeitTarget(game, teamKey, cardId) {
  const n = getTeam(game, teamKey)?.starters?.length || 0;
  let best = null;
  for (let i = 0; i < n; i += 1) {
    const r = forfeitNet(game, teamKey, i, cardId);
    if (r && (!best || r.net > best.net)) best = r;
  }
  return best;
}

export function aiBuildCardOpts(game, teamKey, cardId) {
  const myT = getTeam(game, teamKey);
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const oppT = getOpp(game, teamKey);
  const starters = myT.starters || [];
  const rolls = game.rollResults[teamKey] || [];
  // A shut-out slot (This Is My House) is never a target for a roll-replacer.
  const blocked = game.blockedRolls?.[teamKey] || {};

  if (!starters.length) return {};

  switch (cardId) {
    case 'high_screen_roll': {
      // THE OPTS CONTRACT IS swapSlot1/swapSlot2 — playerIdx was a drift that
      // made every AI attempt fail at execCard, which is why the audit found
      // the game's flagship switch card at zero plays and the whole
      // canceller economy dead behind it. And rather than blindly swapping
      // the two worst matchups, evaluate every pair: the swap that gains the
      // most total roll bonus is the one a coach would call.
      // The swap is chosen in POINTS (bestScreen) — the same reading that
      // decided the card was worth playing. If nothing gains, evaluateCard
      // already priced the card at zero; the fallback here is for a caller
      // that forces it.
      const best = bestScreen(game, teamKey);
      if (!best || best.delta <= 0) return { swapSlot1: 0, swapSlot2: 1 };
      return { swapSlot1: best.i, swapSlot2: best.j };
    }

    case 'go_under':
      // The offence names the shooter now (resolveGoUnder); nothing to pick here.
      return {};

    case 'stagger_action': {
      // The pair canPlay found: a Speed-13 player and a DIFFERENT positive
      // shooter (the "Murray & Murray" and the "Brunson as a shooter" cases
      // both came from fallbacks here). No pair, no play — execCard refuses.
      const pair = staggerPair(starters);
      if (!pair) return { playerIdx: 0, player2Idx: 0 };
      return { playerIdx: pair.fast, player2Idx: pair.shooter };
    }

    case 'veer_switch': {
      // Keep the pair or trade it — the only two arrangements the card allows.
      // Trade when it lowers what the two screened attackers get, in total.
      const lc = game.lastMatchupCard;
      if (!lc?.opts) return {};
      const offT = getOpp(game, teamKey);
      const a1 = offT.starters[lc.opts.swapSlot1];
      const a2 = offT.starters[lc.opts.swapSlot2];
      const d1 = starters[lc.opts.origD1];
      const d2 = starters[lc.opts.origD2];
      if (!a1 || !a2 || !d1 || !d2) return {};
      // In points, not bonus: what the two attackers would score kept as
      // placed against traded — trade only when it holds them lower.
      const keep = pointsFor(game, lc.teamKey, a1, lc.opts.swapSlot1, d1) + pointsFor(game, lc.teamKey, a2, lc.opts.swapSlot2, d2);
      const trade = pointsFor(game, lc.teamKey, a1, lc.opts.swapSlot1, d2) + pointsFor(game, lc.teamKey, a2, lc.opts.swapSlot2, d1);
      return { veerSwap: trade < keep };
    }

    case 'overhelp': {
      // The +3 goes to the best attacker still to roll; salary is the price
      // the game puts on a chart, so it is the ranking used here.
      const rolled = game.rollResults?.[teamKey] || [];
      let best = -1;
      let bestSal = -1;
      starters.forEach((p, i) => {
        if (rolled[i] == null && (p?.salary || 0) > bestSal) { best = i; bestSal = p?.salary || 0; }
      });
      return { playerIdx: best >= 0 ? best : 0 };
    }

    case 'burned_switch': {
      // The slot the switch actually burned — the engine refuses any other.
      return { playerIdx: burnedSlots(game, game.lastDefSwitch)[0] ?? 0 };
    }

    case 'second_wind': {
      const worst = starters.reduce((best, p, i) => {
        const fat = getFatigue(game, teamKey, i);
        return fat < (best.fat || 0) ? { idx: i, fat } : best;
      }, { idx: 0, fat: 0 });
      return { playerIdx: worst.idx };
    }

    case 'chip_on_shoulder': {
      const cheapIdx = starters.findIndex(p => p.salary <= 250);
      return { playerIdx: cheapIdx >= 0 ? cheapIdx : 0 };
    }

    case 'defensive_stopper': {
      const freshIdx = starters.findIndex(p => satOutLast(game, teamKey, p));
      return { playerIdx: freshIdx >= 0 ? freshIdx : 0 };
    }

    case 'ghost_screen': {
      // Pick a Speed 12+ player with the worst penalty who hasn't rolled
      const candidates = starters.map((p, i) => {
        if (rolls[i] != null) return null;
        if (p.speed < 12) return null;
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return null;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        if (!adv.hasPenalty) return null;
        return { idx: i, penalty: adv.rollBonus };
      }).filter(Boolean).sort((a, b) => a.penalty - b.penalty);
      return { playerIdx: candidates.length ? candidates[0].idx : 0 };
    }

    case 'green_light':
    case 'you_stand_over_there':
    case 'five_out':
    case 'cross_court_dime': {
      // WHO GIVES UP THE LEAST — see forfeitNet. The old pick took the best 3PT
      // shooter, which on a good team is the player whose roll is worth most.
      const best = bestForfeitTarget(game, teamKey, cardId);
      return { playerIdx: best ? best.idx : 0 };
    }

    case 'from_way_downtown':
    case 'catch_and_shoot':
    case 'elevator_doors': {
      // Pick best 3PT shooter who hasn't rolled — and is not shut out.
      const best = starters.reduce((b, p, i) => {
        if (rolls[i] != null && !rolls[i]?.isReplaced) return b;
        if (blocked[i]) return b;
        const tpb = p.threePtBoost || 0;
        return tpb > (b.boost || -99) ? { idx: i, boost: tpb } : b;
      }, { idx: 0, boost: -99 });
      return { playerIdx: best.idx };
    }

    case 'bully_ball': {
      // execCard re-checks the CHOSEN player's power ADVANTAGE, so picking by
      // raw power can nominate a star who is out-muscled in his matchup and
      // fail at the door (canPlay only asks whether SOMEONE has an edge).
      const best = starters.reduce((b, p, i) => {
        const di = (game.offMatchups?.[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return b;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        return adv.powerAdv > (b.adv || 0) ? { idx: i, adv: adv.powerAdv } : b;
      }, { idx: 0, adv: 0 });
      return { playerIdx: best.idx };
    }

    case 'back_to_basket': {
      // execCard needs the chosen player at Power 13+ WITH a Paint Bonus.
      const cand = starters.findIndex((p, i) => (rolls[i] == null && !blocked[i]) && p.power >= 13 && (p.paintBoost || 0) > 0);
      if (cand >= 0) return { playerIdx: cand };
      const any = starters.findIndex(p => p.power >= 13 && (p.paintBoost || 0) > 0);
      return { playerIdx: any >= 0 ? any : 0 };
    }

    case 'power_move': {
      // Pure buff, no exec gate — highest power still waiting to roll.
      const best = starters.reduce((b, p, i) => {
        if (rolls[i] != null) return b;
        return p.power > (b.pwr || 0) ? { idx: i, pwr: p.power } : b;
      }, { idx: 0, pwr: 0 });
      return { playerIdx: best.idx };
    }

    case 'and_one': {
      // Pick player with biggest advantage
      const best = starters.reduce((b, p, i) => {
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return b;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        const maxAdv = Math.max(adv.speedAdv, adv.powerAdv);
        return maxAdv > (b.adv || 0) ? { idx: i, adv: maxAdv } : b;
      }, { idx: 0, adv: 0 });
      return { playerIdx: best.idx };
    }

    case 'drive_the_lane': {
      const best = starters.reduce((b, p, i) => {
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return b;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        return adv.speedAdv > (b.adv || 0) ? { idx: i, adv: adv.speedAdv } : b;
      }, { idx: 0, adv: 0 });
      return { playerIdx: best.idx };
    }

    case 'uncontested_layup': {
      const candidate = starters.findIndex((p, i) => {
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return false;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        return adv.speedAdv >= 2 && adv.powerAdv >= 2;
      });
      return { playerIdx: candidate >= 0 ? candidate : 0 };
    }

    case 'rimshaker': {
      const hotPwr = starters.findIndex(p => {
        const ps = getPS(game, teamKey, p.id);
        return p.power >= 13 && (ps?.hot || 0) > 0;
      });
      return { playerIdx: hotPwr >= 0 ? hotPwr : 0 };
    }
    case 'blow_by': {
      // Rimshaker's Speed twin (2026-09-23).
      const hotSpd = starters.findIndex(p => {
        const ps = getPS(game, teamKey, p.id);
        return p.speed >= 13 && (ps?.hot || 0) > 0;
      });
      return { playerIdx: hotSpd >= 0 ? hotSpd : 0 };
    }
    case 'feeling_it': {
      // Like Turnover: the condition is the team's, nothing to choose.
      return {};
    }
    case 'kick_out_three': {
      // The best three on the kick-out, as the check will read it — the shared list.
      const cand = kickOutTargets(game, teamKey)
        .map(t => ({ ...t, pHit: checkNeed(game, teamKey, t.origIdx, '3pt').pHit }))
        .sort((u, v) => v.pHit - u.pHit);
      return { playerIdx: cand[0]?.origIdx ?? 0 };
    }
    case 'own_the_glass': {
      // Two paint checks at +1 by one player: the best finisher on the floor.
      const cand = starters.map((p, i) => ({ i, pHit: p ? checkNeed(game, teamKey, i, 'paint', { extra: 1 }).pHit : -1 }))
        .sort((u, v) => v.pHit - u.pHit);
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'grab_and_go': case 'rebound_and_push': {
      // Nothing to choose: the exchange, and the defender already on the shooter.
      return {};
    }
    case 'clamp_the_reserve': {
      // Unsung Hero's mirror: the best producer among the opponent's cheap
      // men still to roll — the shared list, so the engine takes the pick.
      const cand = clampTargets(game, teamKey).sort((u, v) => expectedOutput(v.p) - expectedOutput(u.p));
      return { targetIdx: cand[0]?.origIdx ?? 0 };
    }

    case 'heat_check': {
      const topRoller = rolls.findIndex(r => r?.isTop);
      return { playerIdx: topRoller >= 0 ? topRoller : 0 };
    }

    case 'burst_of_momentum': {
      // Once per player per section: the first who has not had one.
      const [first] = burstTargets(game, teamKey);
      return { playerIdx: first ?? 0 };
    }

    case 'flare_screen': {
      const nat20 = rolls.findIndex(r => r?.die === 20);
      return { playerIdx: nat20 >= 0 ? nat20 : 0 };
    }

    case 'energy_injection': {
      const cheap = starters.reduce((acc, p, i) => {
        if (p.salary < 400) acc.push(i);
        return acc;
      }, []);
      return { playerIdx: cheap[0] || 0, player2Idx: cheap[1] || 1 };
    }

    case 'crowd_favorite': {
      const cheapIdx = starters.findIndex(p => p.salary <= 350);
      return { playerIdx: cheapIdx >= 0 ? cheapIdx : 0 };
    }

    case 'switch_everything': {
      // The assignment that is best UNDER THE DOUBLING, not the one that
      // would be best if the card were free — see switchEverythingValue.
      const { matchups } = switchEverythingValue(game, teamKey);
      return matchups ? { assignments: matchups } : {};
    }

    case 'hack_a': {
      // WHICH MAN TO FOUL is the whole card. For every opponent still to roll,
      // weigh the roll he loses (expectedOutput over his chart, matchup bonus
      // in) against the four free throws he gains: d20 + 10 against his shot
      // line, markers counted. The biggest swing is the hack.
      const hkOpp = teamKey === 'A' ? 'B' : 'A';
      const hkOppT = getOpp(game, teamKey);
      const hkRolls = game.rollResults?.[hkOpp] || [];
      const hkBlocked = game.blockedRolls?.[hkOpp] || {};
      let best = null;
      (hkOppT.starters || []).forEach((p, i) => {
        if (!p || hkRolls[i] != null || hkBlocked[i]) return;
        const dp = starters[(game.offMatchups?.[hkOpp] || [])[i] ?? i];
        const a = dp ? calcAdv(p, dp, game.tempEff?.[hkOpp] || {}, i) : { rollBonus: 0 };
        const ps = getPS(game, hkOpp, p.id) || {};
        const marker = ((ps.hot || 0) - (ps.cold || 0)) * 2;
        const ftHit = Math.min(1, Math.max(0, (21 - ((p.shotLine || 99) - 10 - marker)) / 20));
        const swing = expectedOutput(p, (a.rollBonus || 0) + marker) - 4 * ftHit;
        if (!best || swing > best.swing) best = { i, swing };
      });
      return { targetIdx: best ? best.i : 0 };
    }

    case 'foul_trouble': {
      // Bench the best of the men we can foul: what he pays his team over a
      // section is his chart plus what he takes away at the other end.
      const ftList = foulTroubleTargets(game, teamKey);
      if (!ftList.length) return {};
      const worth = t => expectedOutput(t.def) + (t.def.defBoost || 0) * 0.5;
      const pick = ftList.slice().sort((a, b) => worth(b) - worth(a))[0];
      return { defIdx: pick.defIdx };
    }

    case 'this_is_my_house': {
      // The same list the picker offers and the engine accepts (canPlay.js),
      // Defense and card effects counted. It used to compare the raw printed
      // numbers, which let Kyrie Irving (P5, Defense -1) shut out a P4.
      const target = myHouseTargets(game, teamKey)[0];
      return { playerIdx: target ? target.offSlot : 0 };
    }

    case 'dogged': {
      // A fatigued opponent, at any depth (2026-09-17): the most tired man
      // on the floor, and among equals the best producer.
      const oppStarters = oppT.starters || [];
      const cand = oppStarters.map((p, i) => ({ p, i, fat: getFatigue(game, oppKey, i) })).filter(({ p, fat }) => p && fat < 0)
        .sort((u, v) => u.fat - v.fat || expectedOutput(v.p) - expectedOutput(u.p));
      return { playerIdx: cand[0]?.i ?? 0 };
    }

    case 'pin_down_screen': {
      // Discard worst card, pick best 3PT shooter
      const bestShooter = starters.reduce((b, p, i) => {
        return (p.threePtBoost || 0) > (b.boost || -99) ? { idx: i, boost: p.threePtBoost || 0 } : b;
      }, { idx: 0, boost: -99 });
      return { playerIdx: bestShooter.idx, discardIdx: 0 };
    }

    case 'putback_dunk': {
      const pwr14 = starters.findIndex(p => p.power >= 14);
      return { playerIdx: pwr14 >= 0 ? pwr14 : 0 };
    }

    case 'delayed_slip': {
      const eligible = starters.findIndex((p, i) => {
        if ((p.speed || 0) < 12 || (p.power || 0) < 10) return false;
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return false;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        return adv.rollBonus <= 0 && !adv.hasPenalty;
      });
      return { playerIdx: eligible >= 0 ? eligible : 0 };
    }

    case 'offensive_board': {
      // The second roll goes to the rolled player whose chart pays most at −2
      // against his defender — a steep chart, not the biggest body.
      let best = null;
      starters.forEach((p, i) => {
        if (!p || (rolls[i] == null && !blocked[i]) || extraRollPending(game, teamKey, i)) return;
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        const bonus = dp ? calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i).rollBonus : 0;
        const v = expectedOutput(p, bonus + carriedMod(game, teamKey, p) - 2);
        if (!best || v > best.v) best = { idx: i, v };
      });
      return { playerIdx: best ? best.idx : 0 };
    }

    case 'rebound_tap_out': {
      const tpIdx = starters.findIndex(p => (p.threePtBoost || 0) > 0);
      return { playerIdx: tpIdx >= 0 ? tpIdx : 0 };
    }

    case 'turnover': {
      // Just needs to be played — targets cold opponent automatically
      return {};
    }

    case 'ato_masterpiece': {
      // Best converter, best channel: 3PT beats paint when both boosts exist.
      let bestAto = { i: 0, v: -99, type: '3pt' };
      starters.forEach((p, i) => {
        const t3 = (p.threePtBoost || 0) * 3;
        const tp = (p.paintBoost || 0) * 2;
        const v = Math.max(t3, tp);
        if (v > bestAto.v) bestAto = { i, v, type: t3 >= tp ? '3pt' : 'paint' };
      });
      return { playerIdx: bestAto.i, checkType: bestAto.type };
    }

    case 'fresh_legs': {
      const byMin = starters
        .map((p, i) => ({ i, min: getPS(game, teamKey, p.id)?.minutes || 0 }))
        .sort((a, b) => b.min - a.min);
      return { playerIdx: byMin[0]?.i ?? 0, player2Idx: byMin[1]?.i };
    }

    case 'ice_the_hot_hand': {
      let bestIce = { i: 0, hot: -1 };
      (oppT.starters || []).forEach((p, i) => {
        const hot = getPS(game, oppKey, p.id)?.hot || 0;
        if (hot > bestIce.hot) bestIce = { i, hot };
      });
      return { targetIdx: bestIce.i };
    }

    case 'reset': {
      let bestReset = { i: 0, cold: -1 };
      starters.forEach((p, i) => {
        const cold = getPS(game, teamKey, p.id)?.cold || 0;
        if (cold > bestReset.cold) bestReset = { i, cold };
      });
      return { playerIdx: bestReset.i };
    }

    case 'desperation_press':
    case 'second_closer': {
      return {};
    }

    case 'pick_up_full_court': {
      // Hound the star with the most tired legs: minutes weigh double so the
      // press pushes someone over a fatigue threshold, chart ceiling breaks ties.
      let best = { i: 0, score: -1 };
      (oppT.starters || []).forEach((p, i) => {
        if (!p) return;
        const ps = getPS(game, oppKey, p.id);
        const min = ps?.minutes || 0;
        const top = p.chart?.length ? p.chart[p.chart.length - 1].pts : 0;
        const score = min * 2 + top;
        if (score > best.score) best = { i, score };
      });
      return { targetIdx: best.i };
    }

    case 'double_team': {
      // Trap the biggest remaining threat — chart ceiling plus the roll
      // bonus they carry right now. The open man is the opponent's to find.
      const oppRolls = game.rollResults[oppKey] || [];
      const myMu = game.offMatchups?.[oppKey] || [];
      let best = { i: 0, threat: -99 };
      (oppT.starters || []).forEach((p, i) => {
        if (!p || oppRolls[i] != null) return;
        const dIdx = myMu[i] ?? i;
        const myDef = (getTeam(game, teamKey).starters || [])[dIdx];
        const rb = myDef ? calcAdv(p, myDef, game.tempEff?.[oppKey] || {}, i).rollBonus : 0;
        const top = p.chart?.length ? p.chart[p.chart.length - 1].pts : 0;
        if (top + rb > best.threat) best = { i, threat: top + rb };
      });
      return { targetIdx: best.i };
    }

    case 'coaches_challenge': {
      // Target opponent's highest-scoring roll
      const oppRolls = game.rollResults[oppKey] || [];
      let bestIdx = 0, bestPts = 0;
      oppRolls.forEach((r, i) => {
        if (r && (r.pts || 0) > bestPts) { bestPts = r.pts; bestIdx = i; }
      });
      return { playerIdx: bestIdx };
    }

    case 'anticipate_pass': {
      return {};
    }

    case 'cold_spell': {
      const oppRolls = game.rollResults[oppKey] || [];
      const target = oppRolls.findIndex(r => r && (r.die === 1 || r.die === 2) && !r.coldSpellUsed);
      return { playerIdx: target >= 0 ? target : 0 };
    }

    // ═══ WAVE ONE (2026-09-06) — pick the player the engine will accept ═══════
    case 'spain_pick_roll': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => {
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        return p && dp && p.speed > dp.speed;
      }).sort((u, v) => v.p.speed - u.p.speed);
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'mismatch_hunter': {
      const best = starters.reduce((b, p, i) => {
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        if (!p || !dp) return b;
        const a = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        const m = Math.max(a.speedAdv, a.powerAdv);
        return m > b.m ? { idx: i, m } : b;
      }, { idx: 0, m: -99 });
      return { playerIdx: best.idx };
    }
    case 'energizer': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.salary || 0) < 250)
        .sort((u, v) => ((v.p.defBoost || 0) - (u.p.defBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'defensive_anchor': {
      // The anchor with the biggest bonus, guarding the attacker with the
      // largest positive matchup bonus if there is one.
      const guards = game.offMatchups?.[oppKey] || [];
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => (p?.defBoost || 0) >= 1);
      const scored = cand.map(({ p, i }) => {
        const offSlot = guards.indexOf(i);
        const off = oppT.starters[offSlot];
        const rb = off ? calcAdv(off, p, game.tempEff?.[oppKey] || {}, offSlot).rollBonus : 0;
        return { i, rb };
      }).sort((u, v) => v.rb - u.rb);
      return { playerIdx: scored[0]?.i ?? cand[0]?.i ?? 0 };
    }
    case 'hammer_set': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => {
        if (!p || (p.threePtBoost || 0) > 0) return false;
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        return dp && calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i).speedAdv > 0;
      }).sort((u, v) => (u.p.shotLine ?? 18) - (v.p.shotLine ?? 18));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'iso_heavy': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && (rolls[i] == null && !blocked[i]))
        .sort((u, v) => expectedOutput(v.p) - expectedOutput(u.p));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'three_point_barrage': {
      // The extra check goes to the best shooter if an assist is spare.
      const shooters = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.threePtBoost || 0) > 0)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return myT.assists >= 2 && shooters[0] ? { extraShooterIdx: shooters[0].i } : {};
    }
    case 'crash_and_kick': case 'extra_pass': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0, checkType: '3pt' };
    }
    case 'pick_and_pop': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.threePtBoost || 0) > 0)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'lob_city': case 'denial': {
      const others = (myT.hand || []).filter(id => id !== cardId);
      return { discardId: others[others.length - 1] };
    }

    // ═══ WAVE TWO (2026-09-07) ═══════════════════════════════════════════════
    case 'outside_pick': {
      // The best shooter takes it; the cheapest card in hand pays for it.
      const shooters = starters.map((p, i) => ({ p, i })).filter(({ p }) => p)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      const others = (myT.hand || []).filter(id => id !== cardId);
      return { playerIdx: shooters[0]?.i ?? 0, discardId: others[others.length - 1] };
    }
    case 'short_roll_playmaker': {
      // Of the players who clear 8/8, the one most likely to score inside.
      const cand = starters.map((p, i) => ({ p, i }))
        .filter(({ p }) => p && (p.speed || 0) >= 8 && (p.power || 0) >= 8)
        .sort((u, v) => ((v.p.paintBoost || 0) - (u.p.paintBoost || 0)) || (v.p.power - u.p.power));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'pick_and_roll_maestro': {
      // The fastest qualifying handler, then the swap that buys the biggest
      // gap — the card is that choice, so the AI makes it properly.
      const mu = game.offMatchups?.[teamKey] || [];
      const fast = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.speed || 0) >= 14)
        .sort((u, v) => v.p.speed - u.p.speed);
      const who = fast[0];
      if (!who) return { playerIdx: 0 };
      const mate = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && i !== who.i)
        .map(({ i }) => ({ i, gap: (who.p.speed || 0) - (oppT.starters[mu[i] ?? i]?.speed || 0) }))
        .sort((u, v) => v.gap - u.gap);
      return { playerIdx: who.i, player2Idx: mate[0]?.i ?? (who.i === 0 ? 1 : 0) };
    }
    case 'unethical_hoops': {
      // The biggest edge on the floor takes the free throws.
      const mu = game.offMatchups?.[teamKey] || [];
      const best = starters.map((p, i) => ({ p, i })).filter(({ p }) => p)
        .map(({ p, i }) => { const dp = oppT.starters[mu[i] ?? i]; const a = dp ? calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i) : null; return { i, edge: a ? Math.max(a.speedAdv, a.powerAdv) : -99 }; })
        .sort((u, v) => v.edge - u.edge)[0];
      return { playerIdx: best?.i ?? 0 };
    }
    case 'inside_out': {
      // Anyone but the man who just scored inside; the best shooter of them.
      const scorer = game.lastPaintScore?.playerIdx;
      const mates = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && i !== scorer)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return { playerIdx: scorer ?? 0, player2Idx: mates[0]?.i ?? 0 };
    }
    case 'stretch_five': {
      const big = starters.map((p, i) => ({ p, i })).find(({ p }) => p && String(p.pos || '').split(/[-/]/).some(t => t === 'C' || t === 'PF') && ((p.shotLine ?? 18) - (p.threePtBoost || 0)) <= 14);
      const mate = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && i !== big?.i)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.paintBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.paintBoost || 0)));
      return { playerIdx: big?.i ?? 0, player2Idx: mate[0]?.i ?? 1 };
    }
    case 'post_domination': {
      // The matchup door (2026-09-16): a Power edge over his defender, still
      // to roll; the best producer among them.
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => {
        if (!p || rolls[i] != null || blocked[i]) return false;
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        return dp && calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i).powerAdv > 0;
      }).sort((u, v) => expectedOutput(v.p) - expectedOutput(u.p));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'unsung_hero': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && (rolls[i] == null && !blocked[i]) && (p.salary || 0) <= 400)
        .sort((u, v) => expectedOutput(v.p) - expectedOutput(u.p));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'point_god': {
      // Post Domination's Speed twin (2026-09-23): a Speed edge over his
      // defender, still to roll; the best producer among them.
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => {
        if (!p || rolls[i] != null || blocked[i]) return false;
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        return dp && calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i).speedAdv > 0;
      }).sort((u, v) => expectedOutput(v.p) - expectedOutput(u.p));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'transition_outlet': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => {
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        return p && dp && calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i).speedAdv > 0;
      }).sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0, checkType: '3pt' };
    }
    case 'help_defender': {
      // Send help at the worst mismatch, from the defender guarding the
      // attacker with least to gain — the man you leave open should be the
      // one who punishes it least.
      const targets = helpTargets(game, teamKey);
      if (!targets.length) return {};
      const worst = targets.reduce((b, t) => (t.adv > b.adv ? t : b), targets[0]);
      const guards = game.offMatchups?.[oppKey] || [];
      const cost = starters
        .map((p, i) => ({ i, slot: guards.indexOf(i) }))
        .filter(({ i, slot }) => i !== worst.defIdx && slot >= 0)
        .map(({ i, slot }) => ({ i, value: expectedOutput(oppT.starters[slot]) }))
        .sort((u, v) => u.value - v.value);
      return { targetIdx: worst.offSlot, helperIdx: cost[0]?.i ?? starters.findIndex((_, i) => i !== worst.defIdx) };
    }

    case 'find_the_open_man': {
      const dt = game.lastDoubleTeam;
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && (rolls[i] == null && !blocked[i]) && i !== dt?.targetIdx)
        .sort((u, v) => expectedOutput(v.p) - expectedOutput(u.p));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'putback_specialist': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.paintBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.paintBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'hustle_play': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.salary || 0) < 400 && (p.defBoost || 0) > 0)
        .sort((u, v) => (v.p.defBoost || 0) - (u.p.defBoost || 0));
      return { playerIdx: cand[0]?.i ?? 0 };
    }

    default:
      return {};
  }
}

// ── Rolling Decision ────────────────────────────────────────────────────────
// Pick the next player to roll, prioritizing best matchups first.
// ── CYCLING A DEAD HAND: IT DEPENDS ENTIRELY ON THE DECK, SO IT IS NOT HERE ──
//
// Built twice, measured four times, and shipped neither time. The whole story
// is here because every part of it was informative.
//
// THE PROBLEM IS REAL (scripts/analysis/runHandSilt.js, 60 games):
//
//     sec    hand    playable   a reaction   wrong phase   STUCK
//     S 1    4.10      0.57        2.19         0.31        1.03
//     S12    7.22      0.23        5.31         0.27        1.41
//
// By the last section the coach holds seven cards and can play a fifth of one.
// endSection refills to SEVEN, so a hand already there draws nothing and what
// it cannot play never leaves; card plays fall from 382 in section one to 98
// in section nine (runCardValues.js). Three cards are 74% of the real silt —
// Rimshaker 32.1%, Putback Dunk 22.5%, Back to the Basket 19.6% — never
// refused, just never legal. That is the answer to the oldest question asked
// of this AI (the user: "the AI is not playing obvious cards like Putback Dunk
// when available"). It was never card judgement. The card was not legal.
//
// FIRST ATTEMPT, WRONG POLICY. It skipped reaction cards and cycled anything
// else it could not play, which swept up MATCHUP-phase cards — illegal during
// the scoring window by definition, legal again next section. About one cycle
// in five threw away a live card and the policy measured as a wash. RULE:
// classify by phase before calling a card dead.
//
// SECOND ATTEMPT, RIGHT POLICY, AND THE RUNS DISAGREED. 3,000 games said
// 51.5% / +1.05 against a coach that does not cycle (control 49.4% / -0.17);
// 4,000 more at another seed said 50.0% / +0.47 against 50.7% / +0.17. Pooled,
// the win rate says nothing (z 0.59) and the margin is borderline (z 2.74).
//
// AND THE DISAGREEMENT WAS THE ANSWER. The runs drew different rosters, and
// the AI plays the same fifty whatever it fields. Split by archetype, 2,500
// games each:
//
//     FAST roster (Back to the Basket 0% legal)      cycling +1.9 win, +0.68
//     BIG  roster (Back to the Basket 100% legal)    cycling -1.8 win, -1.26
//
// A 3.7-point swing. Cycling helps exactly as much as the deck misfits the
// roster, and HURTS a roster the deck already suits — there it bottoms cards
// that would have come good. Averaged over random rosters the two cancel,
// which is the borderline pooled number.
//
// SO IT IS NOT A LEVER OF ITS OWN. It is the deck-fit problem wearing a
// different hat, and a mid-game clean-up is the wrong place to fix it: build
// the deck to the roster and there is nothing to cycle. See runDeckFit.js —
// legality swings a hundred points between archetypes, twelve cards have a
// 15-point spread, and every AI team in every mode plays the same fifty.
//
// The lab keeps `cycling_fixed` and the inert hook in simulate.js so this
// stays reproducible when the deck work lands.

export function aiRollDecision(game, teamKey) {
  const myT = getTeam(game, teamKey);
  const oppT = getOpp(game, teamKey);
  const rolls = game.rollResults[teamKey] || [];
  const blocked = game.blockedRolls?.[teamKey] || {};

  const candidates = (myT.starters || []).map((p, i) => {
    if (!canRollSlot(game, teamKey, i)) return null;
    const di = (game.offMatchups[teamKey] || [])[i] ?? i;
    const dp = oppT.starters[di];
    if (!dp) return { idx: i, bonus: 0 };
    const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
    const fat = getFatigue(game, teamKey, i);
    const ps = getPS(game, teamKey, p.id) || {};
    const mrkB = ((ps.hot || 0) - (ps.cold || 0)) * 2;
    return { idx: i, bonus: adv.rollBonus + fat + mrkB };
  }).filter(Boolean);

  if (candidates.length === 0) return null;

  // Roll best matchups first
  candidates.sort((a, b) => b.bonus - a.bonus);
  const pick = candidates[0];

  // CLUTCH POSSESSION: in crunch, spend it on the best remaining chart —
  // extra dice are worth most where the top tiers are worth most — as long
  // as that player is the one rolling now and his legs allow it.
  if (clutchAvailable(game, teamKey) > 0) {
    const ceiling = i => {
      const ch = myT.starters[i]?.chart;
      return ch?.length ? ch[ch.length - 1].pts + (game.clutchDice?.[myT.starters[i].id] || 0) * 2 : 0;
    };
    const bestCeiling = Math.max(...candidates.map(c => ceiling(c.idx)));
    if (ceiling(pick.idx) >= bestCeiling && clutchEligible(game, teamKey, pick.idx)) {
      return { type: 'roll', playerIdx: pick.idx, clutch: true };
    }
  }
  return { type: 'roll', playerIdx: pick.idx };
}

/**
 * The Crunch Time timeout brain: call the one timeout as soon as the rules
 * allow it — see below for why there is no "right moment" to wait for — then
 * the caller re-sets the defense, searches the deck, plays the best rider,
 * and resumes.
 */
export function aiCrunchDecision(game, teamKey) {
  if (!game.crunch?.active || game.phase !== 'scoring') return null;
  if (game.crunch.timeoutUsed?.[teamKey] || game.timeoutActive) return null;
  // CALL IT THE MOMENT IT IS LEGAL. The user, 2026-09-14: "the way the timeout
  // works, it makes the most sense to play it ASAP because you get to reset
  // the defense right away. It's a free 'switch everything' without the roll
  // bonus." That is right, and the mechanics make it more one-sided still:
  //
  //   THE ASSIGNMENT IT REPLACES CAME FROM THE SNAKE. Placement sets the
  //   matchups, and the snake is a compromise — you never get the free
  //   optimum from it. The timeout hands you exactly that (spendTimeout, then
  //   applyMatchups), so it is worth something the instant crunch arms, not
  //   only once a screen has left the assignment stale.
  //   SWITCH EVERYTHING PAYS FOR THE SAME THING. That card reassigns the
  //   defence too, and doubles every opponent offensive advantage to do it.
  //   The timeout doubles nothing.
  //   EARLIER COVERS MORE ROLLS. The re-set holds for the rest of the
  //   section, so every roll after the call is played at the better pairing.
  //   HOLDING IT FOR OVERTIME BUYS NOTHING. endSection rebuilds crunch at
  //   every Q4S3, overtime included, with a fresh timeoutUsed — so an OT
  //   comes with its own timeout and this one cannot be saved for it.
  //
  // Unused, it is simply wasted. The old condition — trailing, or holding a
  // rider, or a crunch card still in the deck — was true almost always, and
  // the "almost" was the bug: ahead, no rider, nothing left to search, the
  // coach passed and threw the re-set away.
  return { type: 'timeout' };
}

/**
 * What to search the deck for during our timeout: the crunch card the open
 * window values most (riders carry the timeout's +4), or null when there is
 * nothing to take.
 */
export function aiCrunchSearch(game, teamKey) {
  const options = crunchSearchOptions(game, teamKey);
  if (!options.length) return null;
  let best = null;
  for (const id of options) {
    const strat = getStrat(id);
    if (!strat) continue;
    const v = evaluateCard(game, teamKey, id, strat);
    if (!best || v > best.v) best = { id, v };
  }
  return best ? best.id : options[0];
}

// ── Reaction Card Decision ──────────────────────────────────────────────────
// Check if AI should play a reaction card in response to opponent's action.
export function aiReactionDecision(game, teamKey, trigger, opts = {}) {
  // LEVER THREE — THE ANSWER. A lower level watches the check go by.
  if (misplays(opts.iq)) return null;
  const team = getTeam(game, teamKey);
  const hand = team.hand || [];

  // An announced shot check: one answer, the strongest legal one. Paint
  // checks have their own answers (Rim Protector, Drop Coverage); Close Out
  // is the three-point one; the rest answer either.
  if (trigger === 'shot_check') {
    const psc = game.pendingShotCheck;
    if (!psc || psc.reacted) return null;
    const order = psc.type === 'paint'
      ? ['rim_protector', 'drop_coverage', 'smothering_defense', 'hustle_play', 'denial']
      : ['close_out', 'smothering_defense', 'hustle_play', 'denial'];
    for (const cardId of order) {
      if (!hand.includes(cardId)) continue;
      if (canPlayCard(game, teamKey, cardId).canPlay) {
        return { type: 'play_card', cardId, opts: aiBuildCardOpts(game, teamKey, cardId) };
      }
    }
  }

  // Cold Spell: always play on natural 1-2
  if (trigger === 'cold_roll' && hand.includes('cold_spell')) {
    const check = canPlayCard(game, teamKey, 'cold_spell');
    if (check.canPlay) {
      const opts = aiBuildCardOpts(game, teamKey, 'cold_spell');
      return { type: 'play_card', cardId: 'cold_spell', opts };
    }
  }

  // Screen reactions: the canceller that takes back the most, if any is worth it.
  if (trigger === 'screen_card') {
    let best = null;
    for (const cardId of CANCELLERS) {
      if (!hand.includes(cardId) || !canPlayCard(game, teamKey, cardId).canPlay) continue;
      const { saved } = switchCancelValue(game, teamKey, cardId);
      if (saved >= SWITCH_FLOOR && (!best || saved > best.saved)) best = { cardId, saved };
    }
    if (best) return { type: 'play_card', cardId: best.cardId, opts: aiBuildCardOpts(game, teamKey, best.cardId) };
  }

  // Coach's Challenge: only a make is worth re-rolling
  if (trigger === 'opp_scored' && hand.includes('coaches_challenge') && game.lastShotCheck?.result?.hit && game.lastShotCheck.teamKey !== teamKey) {
    const check = canPlayCard(game, teamKey, 'coaches_challenge');
    if (check.canPlay) {
      const opts = aiBuildCardOpts(game, teamKey, 'coaches_challenge');
      return { type: 'play_card', cardId: 'coaches_challenge', opts };
    }
  }

  return null; // No reaction
}

// ── Master AI Turn ──────────────────────────────────────────────────────────
// Given the current game state, decide what action to take.
// Returns an action object or null if no action needed.
export function aiTurn(game, teamKey, opts = {}) {
  const phase = game.phase;

  if (phase === 'draft') {
    return aiDraftPick(game, teamKey);
  }

  if (phase === 'matchup_strats') {
    // THE PLACEMENT SNAKE IS THE MATCHUP ASSIGNMENT. Row by row, A places and
    // B answers in the same row (or the other way round), and the pairing
    // that leaves is the matchup — the AI's defensive choice is made in
    // aiPlacementPick, when it counters what just took the floor. Only a
    // switching card (or the crunch-time timeout re-set) moves anyone after
    // that. For four days the AI also re-dealt every pairing here through
    // aiSetMatchups; the user, reading the log on 2026-09-06: "the AI is just
    // setting the defense after the matchups have been laid down... Only
    // switching cards can change that." aiSetMatchups stays for the cards.
    //
    // A matchup card, otherwise pass.
    return aiScoringDecision(game, teamKey, opts);
  }

  if (phase === 'scoring') {
    const scoringPasses = game.scoringPasses || 0;
    const rollingOpen = scoringPasses >= 99;

    if (rollingOpen) {
      // In rolling phase — roll next player
      return aiRollDecision(game, teamKey);
    }

    // In card-play phase — play a card or pass
    if (game.scoringTurn === teamKey) return aiScoringDecision(game, teamKey, opts);
  }

  return null;
}
