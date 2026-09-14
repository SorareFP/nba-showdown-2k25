// The AI's lineup pick, judged against the cadence the fatigue maths was
// designed for. The regression: raw attributes with a flat deduction kept a
// −6 star ahead of every fresh bench player, so the AI never rested anyone.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, restMinutes, REST_RECOVERY, fatigueForMinutes } from './engine.js';
import { CARDS } from './cards.js';
import { aiDraftPick, lineupValue, expectedOutput } from './ai.js';

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

  it('rides the star through the last section of a half, whatever his legs say', () => {
    // Nothing comes after it that minutes could be saved for, so the plan is
    // simply "who scores most now" — which is the greedy answer, correctly.
    for (const minutes of [4, 8, 12]) {
      expect(pick([STAR, BENCH], [{ id: 'star', minutes }], LAST_OF_HALF), `${minutes} min`).toBe('star');
    }
  });

  it('sits him at 8 minutes when there is a half left to spend them over', () => {
    // One rest takes 8 back to 4, which is a clean zero (restMinutes), and
    // there are five more sections to use him in. The greedy played him here
    // and paid for it two sections later.
    expect(pick([STAR, BENCH], [{ id: 'star', minutes: 8 }])).toBe('bench');
  });

  it('RESTS the star at 12 minutes (−6) for a fresh bench player', () => {
    expect(pick([STAR, BENCH], [{ id: 'star', minutes: 12 }])).toBe('bench');
  });

  it('plays a −6 star who is carrying three hot markers', () => {
    // The user, 2026-09-14: "sometimes it's worth playing a player tired if
    // they have a hot marker". +6 of markers cancels the −6, and the bench
    // clears them for good (benchRest), which the plan prices.
    expect(pick([STAR, BENCH], [{ id: 'star', minutes: 12, hot: 3 }])).toBe('star');
  });

  it('benches a cold star before his legs go', () => {
    // And the other half of the same note: "worth benching them before being
    // tired if they have a cold marker." A cold marker never wears off while
    // he plays; only the bench clears it.
    expect(pick([STAR, BENCH], [{ id: 'star', minutes: 4, cold: 2 }])).toBe('bench');
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

describe('rest', () => {
  it('recovers one section of minutes per section on the bench, not a quarter', () => {
    expect(REST_RECOVERY).toBe(4);
    expect(restMinutes(12)).toBe(8);
    expect(restMinutes(8)).toBe(4);
    expect(restMinutes(4)).toBe(0);
    expect(restMinutes(0)).toBe(0);
  });

  it('so three straight sections then one rest still leaves a −2', () => {
    expect(fatigueForMinutes(restMinutes(12))).toBe(-2);
  });
});
