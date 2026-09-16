// The AI's lineup pick, judged against the cadence the fatigue maths was
// designed for. The regression: raw attributes with a flat deduction kept a
// −6 star ahead of every fresh bench player, so the AI never rested anyone.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, restMinutes, REST_RECOVERY, REST_CLEARS_AT, fatigueForMinutes } from './engine.js';
import { CARDS } from './cards.js';
import { aiDraftPick, lineupValue, rotationValue, expectedOutput } from './ai.js';

// Charts shaped like real ones — a ZERO tier at the bottom, which is what a
// roll penalty actually bites into — so the test does not depend on the set
// but does behave like it. Star averages 1.85 a roll fresh, bench 1.1; the
// star at −6 pays 0.75, at −12 pays 0.2.
const tiers = rows => rows.map(([lo, hi, pts]) => ({ lo, hi, pts, reb: 0, ast: 0 }));
const STAR = {
  ...CARDS[0], id: 'star', name: 'Star', speed: 15, power: 15, defBoost: 0, salary: 1500,
  chart: tiers([[1, 4, 0], [5, 9, 1], [10, 14, 2], [15, 18, 3], [19, 99, 5]]),
};
const BENCH = {
  ...CARDS[1], id: 'bench', name: 'Bench', speed: 9, power: 9, defBoost: 0, salary: 350,
  chart: tiers([[1, 6, 0], [7, 13, 1], [14, 19, 2], [20, 99, 3]]),
};

// `when` is the section about to be played: the planner's horizon is the rest
// of the HALF, because halftime wipes the tracker (engine.js), so Q1 S1 leaves
// six sections to spread minutes over and Q2 S3 leaves one.
function draft(pool, stats, when = { quarter: 1, section: 1 }) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  g.draft.bPool = pool;
  getTeam(g, 'B').stats = stats;
  return { ...g, ...when };
}
const pick = (pool, stats, when) => aiDraftPick(draft(pool, stats, when), 'B').playerId;
const LAST_OF_HALF = { quarter: 2, section: 3 };
const Q4 = { quarter: 4, section: 1 };

describe('expectedOutput', () => {
  it('falls as the roll modifier falls, which is what fatigue does to a chart', () => {
    expect(expectedOutput(STAR, 0)).toBeGreaterThan(expectedOutput(STAR, -6));
    expect(expectedOutput(STAR, -6)).toBeGreaterThan(expectedOutput(STAR, -12));
  });
});

// THE ROTATION PLANS THE HALF (2026-09-14). aiDraftPick used to take the best
// player by lineupValue with one section of lookahead, which walks a star down
// the fatigue ladder: playing every section of a half puts him at 0, 0, −2,
// −6, −12, −18, so he arrives in the section that holds Crunch Time and the
// Clutch Possession eighteen points of roll worse than he started. The planner
// solves the half exactly — minutes are multiples of four, the choice is play
// or sit, halftime wipes the tracker — and scores the MARGINAL value: the best
// plan that plays him now, less the best plan that sits him now.
//
// MEASURED, 2,400 games (scripts/analysis/runLeverLab.js): the old greedy
// scores 45.8% ±2.0 and −2.24 a game against the planner, with the control at
// 50.7%/+0.33. Worth about 2.6 points a game — more than half of what the
// entire difficulty ladder is worth (aiLevels.js: 4.70, Settler to Deity).
describe('aiDraftPick plans the half', () => {
  it('plays the fresh star over the fresh bench player', () => {
    expect(pick([STAR, BENCH], [])).toBe('star');
  });

  it('rides the star through the fourth quarter, whatever his legs say', () => {
    // The rest rule lifts for the last twelve minutes (engine.js
    // restRuleLifted), so the plan is simply "who scores most now" — which is
    // the greedy answer, correctly. At the end of the FIRST half the same
    // twelve-minute star must sit: twelve straight is the limit.
    for (const minutes of [4, 8, 12]) {
      expect(pick([STAR, BENCH], [{ id: 'star', minutes }], Q4), `${minutes} min`).toBe('star');
    }
    expect(pick([STAR, BENCH], [{ id: 'star', minutes: 12 }], LAST_OF_HALF)).toBe('bench');
  });

  it('plays a −6 star who is carrying three hot markers, where the rule allows it', () => {
    // The user, 2026-09-14: "sometimes it's worth playing a player tired if
    // they have a hot marker". +6 of markers cancels the −6, and the bench
    // clears them for good (benchRest), which the plan prices. In the fourth
    // quarter, that is; in the first half twelve minutes is twelve minutes.
    expect(pick([STAR, BENCH], [{ id: 'star', minutes: 12, hot: 3 }], Q4)).toBe('star');
    expect(pick([STAR, BENCH], [{ id: 'star', minutes: 12, hot: 3 }])).toBe('bench');
  });

  it('is on the difficulty ladder now — a low rung fills the floor at random', () => {
    // Until 2026-09-14 aiDraftPick took no `iq` at all, so Settler and Deity
    // picked their fives the same considered way.
    const g = draft([STAR, BENCH], []);
    const picks = new Set();
    for (let i = 0; i < 60; i += 1) picks.add(aiDraftPick(g, 'B', { iq: 0 }).playerId);
    expect(picks.size).toBe(2);
    expect(aiDraftPick(g, 'B', { iq: 1 }).playerId).toBe('star');
  });

  it('values a cold, tired star below a fresh bench player', () => {
    expect(lineupValue(STAR, { minutes: 12, cold: 1 })).toBeLessThan(lineupValue(BENCH, undefined));
  });
});

// ── THE PLAN ITSELF, WITHOUT THE MATCHUP ON TOP ─────────────────────────────
//
// These were written against aiDraftPick and had to move down a level when the
// matchup edge shipped, and the reason is worth keeping: `matchupEdge` is
// points a section and the planner's marginal is a fraction of one, so on a
// fixture as lopsided as a 15/15 star against a 9/9 bench body the edge simply
// drowns the plan and the star plays through anything.
//
// That is not the planner failing. The 2x2 (runLeverLab.js, 3,000 games a
// corner) prices each half against a brain holding both: dropping the planner
// costs 1.91 points a game, dropping the edge costs 1.23, dropping both costs
// 3.82. Sub-additive — they overlap — but neither is redundant, so both ship
// and the resting rules are tested where they live, on rotationValue.
describe('rotationValue plans the minutes', () => {
  const left = 6;   // a whole half to spend them over
  const fresh = () => rotationValue(BENCH, undefined, left);

  it('sits a star at 8 minutes when there is a half left', () => {
    // One rest takes 8 back to 0 (restMinutes clears at or under eight), and
    // there are five more sections to use him in.
    expect(rotationValue(STAR, { minutes: 8 }, left)).toBeLessThan(fresh());
  });

  it('sits him at 12 minutes (−6) for a fresh bench player', () => {
    expect(rotationValue(STAR, { minutes: 12 }, left)).toBeLessThan(fresh());
  });

  it('benches a cold star before his legs go', () => {
    // The user, 2026-09-14: "worth benching them before being tired if they
    // have a cold marker." It never wears off while he plays; only the bench
    // clears it.
    expect(rotationValue(STAR, { minutes: 4, cold: 2 }, left)).toBeLessThan(fresh());
  });

  it('rides him through the fourth quarter whatever his legs say', () => {
    // Nothing follows that minutes could be saved for, and the rest rule
    // lifts for the last twelve minutes - so the plan collapses to "who
    // scores most now", the greedy answer, correctly.
    const q4 = { exemptWithin: 3 };
    expect(rotationValue(STAR, { minutes: 12 }, 1, null, q4)).toBeGreaterThan(rotationValue(BENCH, undefined, 1, null, q4));
  });

  it('cannot play him at twelve minutes in the first half - twelve straight is the limit', () => {
    // The user, 2026-09-16: "Guys will play 12 minutes straight max." At
    // twelve on the tracker with no fourth quarter ahead, playing is not on
    // the menu, whatever the section.
    expect(rotationValue(STAR, { minutes: 12 }, 1)).toBe(-Infinity);
    expect(rotationValue(STAR, { minutes: 12 }, 6)).toBe(-Infinity);
    expect(rotationValue(STAR, { minutes: 8 }, 6)).toBeGreaterThan(-Infinity);
  });

  it('rates the same legs higher the less half there is left to spend', () => {
    // At four minutes: 3.35 with one section left, 2.85 with two, 1.50 with
    // three — and then FLAT to six. That plateau is the twelve-minute rule:
    // once a forced rest is coming anyway, playing now costs the same
    // whichever section it comes in, so the far horizon stops mattering.
    const legs = l => rotationValue(STAR, { minutes: 4 }, l);
    expect(legs(1)).toBeGreaterThan(legs(2));
    expect(legs(2)).toBeGreaterThan(legs(3));
    expect(legs(3)).toBeGreaterThanOrEqual(legs(6));
  });
});

describe('rest', () => {
  it('clears the tracker at or under eight minutes and takes four off above it (the original rule, 2026-09-16)', () => {
    expect(REST_RECOVERY).toBe(4);
    expect(REST_CLEARS_AT).toBe(8);
    expect(restMinutes(16)).toBe(12);
    expect(restMinutes(12)).toBe(8);
    expect(restMinutes(8)).toBe(0);
    expect(restMinutes(4)).toBe(0);
    expect(restMinutes(0)).toBe(0);
  });

  it('so two sections then one rest is fresh again, and three straight then one rest still leaves a −2', () => {
    expect(fatigueForMinutes(restMinutes(8))).toBe(0);
    expect(fatigueForMinutes(restMinutes(12))).toBe(-2);    // 12 → 8
  });
});
