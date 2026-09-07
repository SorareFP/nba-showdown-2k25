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

function draft(pool, stats) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  g.draft.bPool = pool;
  getTeam(g, 'B').stats = stats;
  return g;
}
const pick = (pool, stats) => aiDraftPick(draft(pool, stats), 'B').playerId;

describe('expectedOutput', () => {
  it('falls as the roll modifier falls, which is what fatigue does to a chart', () => {
    expect(expectedOutput(STAR, 0)).toBeGreaterThan(expectedOutput(STAR, -6));
    expect(expectedOutput(STAR, -6)).toBeGreaterThan(expectedOutput(STAR, -12));
  });
});

describe('aiDraftPick', () => {
  it('plays the fresh star over the fresh bench player', () => {
    expect(pick([STAR, BENCH], [])).toBe('star');
  });

  it('still plays the star at 4 and 8 minutes', () => {
    expect(pick([STAR, BENCH], [{ id: 'star', minutes: 4 }])).toBe('star');
    expect(pick([STAR, BENCH], [{ id: 'star', minutes: 8 }])).toBe('star');
  });

  it('RESTS the star at 12 minutes (−6) for a fresh bench player', () => {
    // The Kawhi case. Play him now and he is at −12 next section; rest him and
    // he is fresh. Half that swing is more than the gap in this section's output.
    expect(pick([STAR, BENCH], [{ id: 'star', minutes: 12 }])).toBe('bench');
  });

  it('plays a −6 star who is carrying three hot markers', () => {
    // +6 of markers cancels the −6, and resting would throw the markers away.
    expect(pick([STAR, BENCH], [{ id: 'star', minutes: 12, hot: 3 }])).toBe('star');
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
