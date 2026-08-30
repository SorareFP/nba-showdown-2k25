import { describe, it, expect } from 'vitest';
import { enforceZeroFloor, enforceZeroTiers, isBlankTier } from './zeroFloor.js';

describe('enforceZeroFloor', () => {
  it('forces the first tier to 0/0/0 regardless of input', () => {
    const chart = [
      { lo: 1, hi: 3, pts: 2, reb: 1, ast: 0 },
      { lo: 4, hi: 11, pts: 3, reb: 1, ast: 1 },
    ];
    const result = enforceZeroFloor(chart);
    expect(result[0]).toMatchObject({ pts: 0, reb: 0, ast: 0 });
  });

  it('leaves roll ranges (lo/hi) untouched', () => {
    const chart = [
      { lo: 1, hi: 3, pts: 2, reb: 1, ast: 0 },
      { lo: 4, hi: 11, pts: 3, reb: 1, ast: 1 },
    ];
    const result = enforceZeroFloor(chart);
    expect(result[0]).toMatchObject({ lo: 1, hi: 3 });
    expect(result[1]).toMatchObject({ lo: 4, hi: 11 });
  });

  it('does not touch tiers beyond the first', () => {
    const chart = [
      { lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 },
      { lo: 4, hi: 11, pts: 3, reb: 1, ast: 1 },
    ];
    const result = enforceZeroFloor(chart);
    expect(result[1]).toMatchObject({ pts: 3, reb: 1, ast: 1 });
  });
});

describe('enforceZeroTiers', () => {
  const tier = (lo, hi, pts, reb, ast) => ({ lo, hi, pts, reb, ast });

  // The founding requirement, in the user's own words: "every card should have
  // at least a natural 1 result in 0pts, 0reb, 0ast, and then we can have a
  // second tier where they don't score."
  it('puts a blank tier on roll 1 and only roll 1', () => {
    const [blank] = enforceZeroTiers([tier(1, 3, 2, 1, 1), tier(4, 25, 3, 1, 1)]);
    expect(blank).toEqual({ lo: 1, hi: 1, pts: 0, reb: 0, ast: 0 });
  });

  it('makes the second tier no-scoring while KEEPING its rebounds and assists', () => {
    // The distinction that makes it a second tier rather than a wider first
    // one: a board on a possession the player never shot on still counts.
    const [, noScoring] = enforceZeroTiers([tier(1, 3, 2, 1, 1), tier(4, 25, 3, 1, 1)]);
    expect(noScoring).toEqual({ lo: 2, hi: 3, pts: 0, reb: 1, ast: 1 });
  });

  it('starts the no-scoring tier at roll 2, carving roll 1 out of the bottom band', () => {
    const chart = enforceZeroTiers([tier(1, 4, 2, 0, 0), tier(5, 25, 3, 1, 1)]);
    expect(chart.map(t => [t.lo, t.hi])).toEqual([
      [1, 1],
      [2, 4],
      [5, 25],
    ]);
  });

  it('leaves every tier above the floor completely untouched', () => {
    const top = tier(4, 25, 3, 1, 1);
    expect(enforceZeroTiers([tier(1, 3, 2, 1, 1), top])[2]).toEqual(top);
  });

  it('adds exactly one tier, so a five-band chart becomes a six-tier card', () => {
    const bands = [
      tier(1, 3, 1, 0, 0),
      tier(4, 9, 2, 0, 0),
      tier(10, 14, 3, 1, 0),
      tier(15, 19, 4, 1, 1),
      tier(20, 25, 5, 2, 1),
    ];
    expect(enforceZeroTiers(bands)).toHaveLength(6);
  });

  it('drops a one-roll bottom band rather than colliding with its neighbour', () => {
    // Roll 1 was ALL of that band. Promoting the band above it to no-scoring
    // is the only reading that keeps the roll ranges contiguous and disjoint.
    const chart = enforceZeroTiers([tier(1, 1, 2, 0, 0), tier(2, 25, 3, 1, 1)]);
    expect(chart).toEqual([tier(1, 1, 0, 0, 0), tier(2, 25, 0, 1, 1)]);
  });

  it('does not mutate the chart it was given', () => {
    const bands = [tier(1, 3, 2, 1, 1), tier(4, 25, 3, 1, 1)];
    const copy = JSON.parse(JSON.stringify(bands));
    enforceZeroTiers(bands);
    expect(bands).toEqual(copy);
  });

  it('returns an empty chart unchanged rather than inventing a card', () => {
    expect(enforceZeroTiers([])).toEqual([]);
  });
});

describe('isBlankTier', () => {
  it('recognises the structural blank tier', () => {
    expect(isBlankTier({ lo: 1, hi: 1, pts: 0, reb: 0, ast: 0 })).toBe(true);
  });

  it('rejects a WIDER all-zero bottom tier — 168 shipped cards have one, and they print it', () => {
    expect(isBlankTier({ lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 })).toBe(false);
  });

  it('rejects a roll-1 tier that actually produces something', () => {
    expect(isBlankTier({ lo: 1, hi: 1, pts: 0, reb: 1, ast: 0 })).toBe(false);
  });

  it('rejects nothing at all', () => {
    expect(isBlankTier(undefined)).toBe(false);
  });
});
