import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./sources/basketballReference.js', () => ({
  fetchGameLog: vi.fn(),
}));
vi.mock('./bands.js', () => ({
  computeStatBands: vi.fn(),
}));

import {
  reconcileBands,
  toRawCardFormat,
  generatePlayerChart,
  mergeIdenticalTiers,
  shapeChart,
} from './generate.js';
import * as basketballReference from './sources/basketballReference.js';
import { computeStatBands } from './bands.js';

describe('reconcileBands', () => {
  it('combines independently-computed PTS/REB/AST bands onto one roll-range table using the PTS ranges as the shared spine', () => {
    const pts = [{ lo: 1, hi: 3, value: 0 }, { lo: 4, hi: 25, value: 3 }];
    const reb = [{ lo: 1, hi: 5, value: 0 }, { lo: 6, hi: 25, value: 1 }];
    const ast = [{ lo: 1, hi: 2, value: 0 }, { lo: 3, hi: 25, value: 1 }];
    const chart = reconcileBands({ pts, reb, ast });
    expect(chart).toHaveLength(2);
    expect(chart[0]).toMatchObject({ lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 });
    expect(chart[1]).toMatchObject({ lo: 4, hi: 25, pts: 3, reb: 1, ast: 1 });
  });
});

describe('toRawCardFormat', () => {
  it('matches the [lo, hi, pts, reb, ast] tuple shape rawCards.js uses, capping the last tier at 99', () => {
    const chart = [{ lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 }, { lo: 4, hi: 25, pts: 3, reb: 1, ast: 1 }];
    expect(toRawCardFormat(chart)).toEqual([[1, 3, 0, 0, 0], [4, 99, 3, 1, 1]]);
  });
});

describe('generatePlayerChart', () => {
  // Distinct values per stat/tier so a transposed or misspelled stat key
  // would be caught by the assertions below (rather than accidentally
  // producing the "right" numbers for the wrong reason).
  const bandsByStat = {
    pts: [{ lo: 1, hi: 3, value: 9 }, { lo: 4, hi: 25, value: 8 }],
    reb: [{ lo: 1, hi: 3, value: 5 }, { lo: 4, hi: 25, value: 6 }],
    ast: [{ lo: 1, hi: 3, value: 2 }, { lo: 4, hi: 25, value: 3 }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    basketballReference.fetchGameLog.mockResolvedValue([{ minutes: '30:00', pts: 20, reb: 8, ast: 5 }]);
    computeStatBands.mockImplementation((games, statKey) => bandsByStat[statKey]);
  });

  it('calls computeStatBands with the un-transposed stat keys pts/reb/ast, in that order', async () => {
    await generatePlayerChart('testplayer', 2024, {});
    const statKeysUsed = computeStatBands.mock.calls.map(call => call[1]);
    expect(statKeysUsed).toEqual(['pts', 'reb', 'ast']);
  });

  it('threads an override for the player through to the final output', async () => {
    // Index 2 is the first SCORING tier — index 0 is the blank natural-1 tier
    // and index 1 is the no-scoring one, both of which the floor owns.
    const overridesMap = { testplayer: { chart: { 2: { pts: 99 } } } };
    const result = await generatePlayerChart('testplayer', 2024, overridesMap);
    expect(result[2][2]).toBe(99); // pts overridden
    expect(result[2][3]).toBe(6); // reb untouched by the override
    expect(result[2][4]).toBe(3); // ast untouched by the override
  });

  it('produces a valid [lo, hi, pts, reb, ast] tuple array, with the two-tier floor and 99-cap applied', async () => {
    const result = await generatePlayerChart('testplayer', 2024, {});
    expect(result).toEqual([
      [1, 1, 0, 0, 0], // blank: a natural 1, and only a natural 1
      [2, 3, 0, 5, 2], // no scoring, but the REB/AST the statistics produced
      [4, 99, 8, 6, 3], // last tier's hi capped at 99
    ]);
    for (const tuple of result) {
      expect(tuple).toHaveLength(5);
      for (const n of tuple) expect(typeof n).toBe('number');
    }
  });
});

describe('mergeIdenticalTiers', () => {
  const tier = (lo, hi, pts, reb, ast) => ({ lo, hi, pts, reb, ast });

  it('collapses adjacent tiers that print the same three numbers into one', () => {
    const merged = mergeIdenticalTiers([
      tier(1, 3, 2, 1, 1),
      tier(4, 9, 3, 1, 1),
      tier(10, 20, 3, 1, 1),
      tier(21, 99, 4, 1, 1),
    ]);
    expect(merged).toEqual([
      tier(1, 3, 2, 1, 1),
      tier(4, 20, 3, 1, 1),
      tier(21, 99, 4, 1, 1),
    ]);
  });

  it('leaves a chart with no repeated outcome exactly as it was', () => {
    const chart = [tier(1, 3, 0, 0, 0), tier(4, 9, 2, 0, 0), tier(10, 99, 3, 1, 1)];
    expect(mergeIdenticalTiers(chart)).toEqual(chart);
  });

  it('merges on ALL THREE stats, not just points', () => {
    // Same points, different rebounds: two different rows on the card.
    const chart = [tier(1, 9, 2, 0, 0), tier(10, 99, 2, 1, 0)];
    expect(mergeIdenticalTiers(chart)).toEqual(chart);
  });

  it('collapses a run of three identical tiers down to one', () => {
    expect(
      mergeIdenticalTiers([tier(1, 3, 1, 0, 0), tier(4, 9, 1, 0, 0), tier(10, 99, 1, 0, 0)])
    ).toEqual([tier(1, 99, 1, 0, 0)]);
  });

  it('holds the leading fixed tiers out of the merge', () => {
    // The blank natural-1 tier and a no-scoring tier that also reads 0/0/0 are
    // the same three numbers. Merging them would delete the second tier the
    // whole floor exists to create, and hide the printed chart's first row.
    const chart = [tier(1, 1, 0, 0, 0), tier(2, 3, 0, 0, 0), tier(4, 99, 2, 1, 0)];
    expect(mergeIdenticalTiers(chart, { fixedTiers: 1 })).toEqual(chart);
    expect(mergeIdenticalTiers(chart)).toHaveLength(2); // without the guard
  });

  it('does not mutate the chart it was given', () => {
    const chart = [tier(1, 3, 1, 0, 0), tier(4, 99, 1, 0, 0)];
    const copy = JSON.parse(JSON.stringify(chart));
    mergeIdenticalTiers(chart);
    expect(chart).toEqual(copy);
  });
});

describe('shapeChart', () => {
  const tier = (lo, hi, pts, reb, ast) => ({ lo, hi, pts, reb, ast });

  it('floors before it merges, so duplicates the floor CREATES are collapsed too', () => {
    // Tier 2's points are about to be zeroed, which makes it identical to
    // tier 3. A merge that ran first would not see that and would leave a
    // redundant row on the card.
    const shaped = shapeChart([tier(1, 3, 1, 0, 0), tier(4, 20, 0, 0, 0), tier(21, 99, 2, 1, 0)]);
    expect(shaped).toEqual([
      tier(1, 1, 0, 0, 0),
      tier(2, 20, 0, 0, 0),
      tier(21, 99, 2, 1, 0),
    ]);
  });

  it('caps the card at six tiers — blank, no-scoring, and up to four scoring', () => {
    const shaped = shapeChart([
      tier(1, 3, 1, 0, 0),
      tier(4, 9, 2, 0, 0),
      tier(10, 14, 3, 1, 0),
      tier(15, 19, 4, 1, 1),
      tier(20, 99, 5, 2, 1),
    ]);
    expect(shaped).toHaveLength(6);
    expect(shaped.filter(t => t.pts > 0)).toHaveLength(4);
  });
});
