import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  BLANK_TIER_HI,
  enforceZeroFloor,
  enforceZeroTiers,
  foldNoScoringTier,
  isBlankTier,
} from './zeroFloor.js';

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
  // second tier where they don't score." Widened since to rolls 1-2, because
  // engine.js already marks a player cold on a die of 1 OR 2.
  it('puts a blank tier on rolls 1-2 and nothing else', () => {
    const [blank] = enforceZeroTiers([tier(1, 3, 2, 1, 1), tier(4, 25, 3, 1, 1)]);
    expect(blank).toEqual({ lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 });
  });

  it('agrees with the engine about which rolls are the bad ones', () => {
    // The blank tier is 1-2 BECAUSE the cold marker is. If that ever moves,
    // the chart has to move with it or the card and the game disagree about
    // what a bad roll is.
    const engine = readFileSync(new URL('../../src/game/engine.js', import.meta.url), 'utf8');
    expect(engine).toContain('if (r.die <= 2) ps.cold');
    expect(BLANK_TIER_HI).toBe(2);
  });

  it('makes the second tier no-scoring while KEEPING its rebounds and assists', () => {
    // The distinction that makes it a second tier rather than a wider first
    // one: a board on a possession the player never shot on still counts.
    const [, noScoring] = enforceZeroTiers([tier(1, 3, 2, 1, 1), tier(4, 25, 3, 1, 1)]);
    expect(noScoring).toEqual({ lo: 3, hi: 3, pts: 0, reb: 1, ast: 1 });
  });

  it('starts the no-scoring tier at roll 3, carving rolls 1-2 out of the bottom band', () => {
    const chart = enforceZeroTiers([tier(1, 4, 2, 0, 0), tier(5, 25, 3, 1, 1)]);
    expect(chart.map(t => [t.lo, t.hi])).toEqual([
      [1, 2],
      [3, 4],
      [5, 25],
    ]);
  });

  it('leaves the bands ABOVE the bottom one exactly where the percentiles put them', () => {
    // The carve is what keeps the chart's expected value on the player's real
    // per-4-minute rate. Re-apportioning all five bands into rolls 3..25 would
    // shift every boundary up by two and push the top band past roll 20, out of
    // a d20's reach — measured at 13-14% of every chart's output.
    const bands = [
      tier(1, 3, 1, 0, 0),
      tier(4, 9, 2, 0, 0),
      tier(10, 14, 3, 1, 0),
      tier(15, 19, 4, 1, 1),
      tier(20, 25, 5, 2, 1),
    ];
    expect(enforceZeroTiers(bands).slice(2).map(t => [t.lo, t.hi])).toEqual([
      [4, 9],
      [10, 14],
      [15, 19],
      [20, 25],
    ]);
  });

  it('leaves every tier above the floor completely untouched', () => {
    const top = tier(4, 25, 3, 1, 1);
    expect(enforceZeroTiers([tier(1, 3, 2, 1, 1), top])[2]).toEqual(top);
  });

  it('adds exactly one tier, so a five-band chart arrives at the row cap with six', () => {
    const bands = [
      tier(1, 3, 1, 0, 0),
      tier(4, 9, 2, 0, 0),
      tier(10, 14, 3, 1, 0),
      tier(15, 19, 4, 1, 1),
      tier(20, 25, 5, 2, 1),
    ];
    expect(enforceZeroTiers(bands)).toHaveLength(6);
  });

  it('drops a bottom band the carve consumes rather than colliding with its neighbour', () => {
    // Rolls 1-2 were ALL of that band. Promoting the band above it to
    // no-scoring is the only reading that keeps the roll ranges contiguous and
    // disjoint.
    const chart = enforceZeroTiers([tier(1, 2, 2, 0, 0), tier(3, 25, 3, 1, 1)]);
    expect(chart).toEqual([tier(1, 2, 0, 0, 0), tier(3, 25, 0, 1, 1)]);
    const narrower = enforceZeroTiers([tier(1, 1, 2, 0, 0), tier(2, 25, 3, 1, 1)]);
    expect(narrower).toEqual([tier(1, 2, 0, 0, 0), tier(2, 25, 0, 1, 1)]);
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
    expect(isBlankTier({ lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 })).toBe(true);
  });

  it('rejects a WIDER all-zero bottom tier — 168 shipped cards have one, and they print it', () => {
    expect(isBlankTier({ lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 })).toBe(false);
  });

  it('rejects the one-roll tier this module used to emit', () => {
    expect(isBlankTier({ lo: 1, hi: 1, pts: 0, reb: 0, ast: 0 })).toBe(false);
  });

  it('rejects a 1-2 tier that actually produces something', () => {
    expect(isBlankTier({ lo: 1, hi: 2, pts: 0, reb: 1, ast: 0 })).toBe(false);
  });

  it('rejects nothing at all', () => {
    expect(isBlankTier(undefined)).toBe(false);
  });
});

describe('foldNoScoringTier', () => {
  const tier = (lo, hi, pts, reb, ast) => ({ lo, hi, pts, reb, ast });
  const blank = tier(1, 2, 0, 0, 0);

  it('hands the no-scoring tier UPWARD, so the blank tier stays 1-2', () => {
    // The shape the finished 2025-26 set already prints: a 1-2 blank running
    // straight into a scoring band (Sam Hauser, Vit Krejci, Trae Young).
    const folded = foldNoScoringTier([blank, tier(3, 3, 0, 1, 0), tier(4, 25, 2, 1, 1)]);
    expect(folded).toEqual([blank, tier(3, 25, 2, 1, 1)]);
  });

  it('keeps the rebound rather than widening the blank over it', () => {
    // Everything reaching this function rebounds or assists — a no-scoring
    // tier reading 0/0/0 was already merged into the blank one. Widening the
    // blank across it would delete the board the tier exists to record.
    const folded = foldNoScoringTier([blank, tier(3, 4, 0, 2, 1), tier(5, 25, 2, 2, 1)]);
    expect(folded[0]).toEqual(blank);
    expect(folded[1]).toMatchObject({ lo: 3, reb: 2, ast: 1 });
  });

  it('never hands them upward across the shot-line break', () => {
    // Moving that band down to roll 3 would delete the break the arrow sits on
    // — silently. A blank tier wider than asked for is the visible cost, and
    // the one worth paying.
    const folded = foldNoScoringTier([blank, tier(3, 5, 0, 1, 0), tier(6, 25, 2, 1, 1)], {
      keepBoundaryAt: 6,
    });
    expect(folded).toEqual([tier(1, 5, 0, 0, 0), tier(6, 25, 2, 1, 1)]);
  });

  it('leaves a chart alone when there is nothing under it to fold', () => {
    const two = [blank, tier(3, 25, 2, 1, 1)];
    expect(foldNoScoringTier(two)).toEqual(two);
    // ...and when the bottom tier is not the structural blank one at all.
    const noBlank = [tier(1, 3, 2, 0, 0), tier(4, 9, 2, 1, 0), tier(10, 25, 3, 1, 1)];
    expect(foldNoScoringTier(noBlank)).toEqual(noBlank);
  });

  it('does not mutate the chart it was given', () => {
    const chart = [blank, tier(3, 3, 0, 1, 0), tier(4, 25, 2, 1, 1)];
    const copy = JSON.parse(JSON.stringify(chart));
    foldNoScoringTier(chart);
    expect(chart).toEqual(copy);
  });
});
