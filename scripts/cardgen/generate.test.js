import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./sources/basketballReference.js', () => ({
  fetchGameLog: vi.fn(),
}));
vi.mock('./bands.js', () => ({
  computeStatBands: vi.fn(),
}));

import { reconcileBands, toRawCardFormat, generatePlayerChart } from './generate.js';
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
    const overridesMap = { testplayer: { chart: { 1: { pts: 99 } } } };
    const result = await generatePlayerChart('testplayer', 2024, overridesMap);
    // Tier 1 (index 1, the non-zero-floored tier) should reflect the override.
    expect(result[1][2]).toBe(99); // pts overridden
    expect(result[1][3]).toBe(6); // reb untouched by the override
    expect(result[1][4]).toBe(3); // ast untouched by the override
  });

  it('produces a valid [lo, hi, pts, reb, ast] tuple array, with the zero floor and 99-cap applied', async () => {
    const result = await generatePlayerChart('testplayer', 2024, {});
    expect(result).toEqual([
      [1, 3, 0, 0, 0], // natural-1 tier hard-floored to zero
      [4, 99, 8, 6, 3], // last tier's hi capped at 99
    ]);
    for (const tuple of result) {
      expect(tuple).toHaveLength(5);
      for (const n of tuple) expect(typeof n).toBe('number');
    }
  });
});
