import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./sources/basketballReference.js', () => ({
  fetchGameLog: vi.fn(),
}));
// Only computeStatBands is stubbed (generatePlayerChart's tests); the
// conditional averaging and rounding run for real.
vi.mock('./bands.js', async importOriginal => ({
  ...(await importOriginal()),
  computeStatBands: vi.fn(),
}));

import {
  reconcileBands,
  reconcileConditional,
  roundTogether,
  neverWorseUpward,
  rowValue,
  ROW_VALUE,
  toRawCardFormat,
  generatePlayerChart,
  mergeIdenticalTiers,
  forceBandBoundary,
  shapeChart,
  MAX_CHART_TIERS,
  MAX_PRINTED_ROWS,
} from './generate.js';
import * as basketballReference from './sources/basketballReference.js';
import { computeStatBands } from './bands.js';

// ROWS THAT SAY WHAT HAPPENED TOGETHER (the user, 2026-09-29): the points
// spine as ever, rebounds and assists per band from the games in it.
describe('reconcileConditional', () => {
  const pts = [{ lo: 1, hi: 4, value: 0, slots: 4, threshold: 0.5 }, { lo: 5, hi: 12, value: 2, slots: 10, threshold: 2 }, { lo: 13, hi: 25, value: 3, slots: 11, threshold: 9 }];
  const reb = [{ lo: 1, hi: 5, value: 0 }, { lo: 6, hi: 15, value: 1 }, { lo: 16, hi: 25, value: 2 }];
  const ast = [{ lo: 1, hi: 2, value: 0 }, { lo: 3, hi: 20, value: 1 }, { lo: 21, hi: 25, value: 3 }];

  it('falls back to the per-stat ladders read by roll when there are no joint rows', () => {
    const expected = reconcileConditional({ pts, reb, ast, games: null });
    expect(expected.map(t => [t.pts, t.reb, t.ast])).toEqual([[0, 0, 0], [2, 1, 1], [3, 2, 3]]);   // reconcileBandsByRoll's reading, probed at each tier's midpoint
    expect(reconcileConditional({ pts, reb, ast, games: [{ minutes: 30, pts: 4 }] })).toEqual(expected);   // no rebounds or assists on the rows: the same fallback
  });
});

// A HIGHER ROW IS NEVER WORSE (the user, 2026-09-30, on De'Anthony Melton's
// 16-19: 3/1/0 over 20+: 3/0/0): every roll bonus has to be good news.
describe('a higher row is never worth less than the row below it', () => {
  it('prices a row at its points plus 0.2 a rebound and 0.3 an assist, the engine\'s prices at even odds', () => {
    expect(ROW_VALUE).toEqual({ reb: 0.2, ast: 0.3 });
    expect(rowValue({ pts: 3, reb: 1, ast: 0 })).toBeCloseTo(3.2, 12);
    expect(rowValue({ pts: 3, reb: 0, ast: 0 })).toBe(3);
  });

  it('lifts a row the shave left short to the row below it, and the pair then merges (Melton)', () => {
    // As cut: 16-19 3/1/0 under a top row of 4/0/0 — worth more. The shave
    // takes the top row to 3/0/0, worth less than 3/1/0.
    const cut = [
      { lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 }, { lo: 3, hi: 3, pts: 1, reb: 0, ast: 1 },
      { lo: 4, hi: 8, pts: 1, reb: 1, ast: 1 }, { lo: 9, hi: 15, pts: 2, reb: 1, ast: 1 },
      { lo: 16, hi: 19, pts: 3, reb: 1, ast: 0 }, { lo: 20, hi: 25, pts: 4, reb: 0, ast: 0 },
    ];
    const chart = shapeChart(cut, { shotLine: 16, ceilingDelay: 0 });
    expect(chart.map(t => `${t.lo}-${t.hi}: ${t.pts}/${t.reb}/${t.ast}`)).toEqual([
      '1-2: 0/0/0', '3-3: 0/0/1', '4-8: 1/1/1', '9-15: 2/1/1', '16-25: 3/1/0',
    ]);
    for (let i = 1; i < chart.length; i += 1) expect(rowValue(chart[i])).toBeGreaterThanOrEqual(rowValue(chart[i - 1]));
  });

  it('leaves a trade that is worth more alone: a point for an assist climbs', () => {
    const chart = [{ lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 }, { lo: 3, hi: 9, pts: 2, reb: 1, ast: 1 }, { lo: 10, hi: 25, pts: 3, reb: 1, ast: 0 }];
    expect(neverWorseUpward(chart)).toEqual(chart);
  });

  it('rounds rebounds and assists together to keep every band climbing, at the least cost to the averages', () => {
    // Equal points in the top two bands; alone, each stat rounds its top band
    // down (1.4 -> 1, 0.6 -> 1 and 0.4 -> 0) and the top band ends worth less.
    const ptsValues = [0, 2, 3, 3];
    const slots = [4, 8, 7, 6];
    const rebRaws = [0.9, 1.1, 1.6, 1.4];
    const astRaws = [0.6, 0.9, 0.6, 0.4];
    const { reb, ast } = roundTogether(ptsValues, rebRaws, astRaws, slots);
    const rows = ptsValues.map((p, i) => ({ pts: p, reb: reb[i], ast: ast[i] }));
    for (let i = 1; i < rows.length; i += 1) expect(rowValue(rows[i])).toBeGreaterThanOrEqual(rowValue(rows[i - 1]) - 1e-9);
    // Still the player's own numbers: every value is its average's floor or ceiling.
    rebRaws.forEach((v, i) => expect([Math.floor(v), Math.ceil(v)]).toContain(reb[i]));
    astRaws.forEach((v, i) => expect([Math.floor(v), Math.ceil(v)]).toContain(ast[i]));
  });
});

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
      [1, 2, 0, 0, 0], // blank: a natural 1 or 2, and nothing else
      [3, 5, 0, 5, 2], // no scoring, but the REB/AST the statistics produced
      // Ceiling suppressed: opens TOP_TIER_DELAY later, and pays TWO less rather
      // than one because the shave GROWS above TOP_TIER_SOFT_CAP — this tier was
      // an 8, which is the band that produced 64-point sections.
      [6, 99, 6, 6, 3],
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

  it('holds the leading fixed tiers out of the merge when asked', () => {
    const chart = [tier(1, 2, 0, 0, 0), tier(3, 3, 0, 0, 0), tier(4, 99, 2, 1, 0)];
    expect(mergeIdenticalTiers(chart, { fixedTiers: 1 })).toEqual(chart);
    expect(mergeIdenticalTiers(chart)).toHaveLength(2); // without the guard
  });

  it('lets the blank tier absorb a no-scoring tier that also reads 0/0/0', () => {
    // The default, and what shapeChart uses. Both tiers are PRINTED now, so
    // leaving them apart puts two rows on the card saying the same nothing.
    const chart = [tier(1, 2, 0, 0, 0), tier(3, 3, 0, 0, 0), tier(4, 99, 2, 1, 0)];
    expect(mergeIdenticalTiers(chart)).toEqual([tier(1, 3, 0, 0, 0), tier(4, 99, 2, 1, 0)]);
  });

  it('never merges across the shot line, however identical the two rows read', () => {
    // "collapse identical deciles UNLESS needed for a shot chart" — the chart
    // has to break at the shot line so the arrow has a rule to sit on, and a
    // merge is the one thing that could quietly take that rule away again.
    const chart = [tier(1, 2, 0, 0, 0), tier(3, 13, 2, 1, 0), tier(14, 99, 2, 1, 0)];
    expect(mergeIdenticalTiers(chart, { keepBoundaryAt: 14 })).toEqual(chart);
    expect(mergeIdenticalTiers(chart, { keepBoundaryAt: 15 })).toHaveLength(2);
    expect(mergeIdenticalTiers(chart)).toHaveLength(2);
  });

  it('does not mutate the chart it was given', () => {
    const chart = [tier(1, 3, 1, 0, 0), tier(4, 99, 1, 0, 0)];
    const copy = JSON.parse(JSON.stringify(chart));
    mergeIdenticalTiers(chart);
    expect(chart).toEqual(copy);
  });
});

describe('forceBandBoundary', () => {
  const tier = (lo, hi, pts, reb, ast) => ({ lo, hi, pts, reb, ast });
  const chart = () => [
    tier(1, 2, 0, 0, 0),
    tier(3, 3, 0, 1, 0),
    tier(4, 9, 2, 1, 0),
    tier(10, 14, 3, 1, 1),
    tier(15, 19, 4, 2, 1),
    tier(20, 99, 5, 2, 1),
  ];

  it('reports the chart already breaking there, and changes nothing', () => {
    const out = forceBandBoundary(chart(), 15, { firstMovable: 2 });
    expect(out.moved).toBe(0);
    expect(out.chart).toEqual(chart());
  });

  it('moves the NEAREST boundary onto the roll, taking a roll off its neighbour', () => {
    // 14 is one below the 15 boundary and four above the 10 one.
    const out = forceBandBoundary(chart(), 14, { firstMovable: 2 });
    expect(out).toMatchObject({ moved: -1, from: 15 });
    expect(out.chart.map(t => [t.lo, t.hi])).toEqual([
      [1, 2], [3, 3], [4, 9], [10, 13], [14, 19], [20, 99],
    ]);
  });

  it('keeps every magnitude the percentile cuts produced', () => {
    const out = forceBandBoundary(chart(), 12, { firstMovable: 2 });
    expect(out.chart.map(t => [t.pts, t.reb, t.ast])).toEqual(
      chart().map(t => [t.pts, t.reb, t.ast])
    );
  });

  it('refuses to move a boundary onto the structural floor', () => {
    // firstMovable protects the blank tier's start and the roll the statistics
    // resume at. Nothing below tier 2 may become the shot line.
    const out = forceBandBoundary(chart(), 3, { firstMovable: 2 });
    expect(out.moved).toBe(null);
    expect(out.chart).toEqual(chart());
  });

  it('leaves the chart untouched rather than collapsing a band to nothing', () => {
    // Roll 100 is past every band's end, so no boundary can reach it.
    const out = forceBandBoundary(chart(), 100, { firstMovable: 2 });
    expect(out.moved).toBe(null);
    expect(out.chart).toEqual(chart());
  });

  it('does nothing at all without a shot line', () => {
    for (const line of [null, undefined, NaN]) {
      expect(forceBandBoundary(chart(), line).chart).toEqual(chart());
    }
  });

  it('does not mutate the chart it was given', () => {
    const original = chart();
    forceBandBoundary(original, 14, { firstMovable: 2 });
    expect(original).toEqual(chart());
  });
});

describe('shapeChart', () => {
  const tier = (lo, hi, pts, reb, ast) => ({ lo, hi, pts, reb, ast });
  const fiveBands = () => [
    tier(1, 3, 1, 0, 0),
    tier(4, 9, 2, 0, 0),
    tier(10, 14, 3, 1, 0),
    tier(15, 19, 4, 1, 1),
    tier(20, 99, 5, 2, 1),
  ];

  it('floors before it merges, so duplicates the floor CREATES are collapsed too', () => {
    // The floor zeroes the 3-3 tier's points, which makes it identical to the
    // 4-20 band above. A merge that ran first would not see that and would
    // leave a redundant row on the card.
    const shaped = shapeChart([tier(1, 3, 1, 1, 0), tier(4, 20, 0, 1, 0), tier(21, 99, 2, 1, 0)]);
    expect(shaped).toEqual([
      tier(1, 2, 0, 0, 0), // the blank tier, carved out and never merged into
      tier(3, 22, 0, 1, 0), // the zeroed 3-3 tier, collapsed into 4-20
      tier(23, 99, 1, 1, 0), // ceiling suppressed by TOP_TIER_DELAY / TOP_TIER_SHAVE
    ]);
  });

  it('never merges the blank tier away, so every card keeps a no-scoring row', () => {
    // The blank tier is not printed, so swallowing an equally blank no-scoring
    // tier would save no row — it would delete the second tier the two-tier
    // floor exists to create and start the printed chart at roll 4.
    const shaped = shapeChart([tier(1, 3, 1, 0, 0), tier(4, 20, 2, 1, 0), tier(21, 99, 3, 1, 0)]);
    expect(shaped[0]).toEqual(tier(1, 2, 0, 0, 0));
    expect(shaped[1]).toEqual(tier(3, 3, 0, 0, 0)); // the no-scoring row, kept
  });

  it('breaks the chart at the shot line', () => {
    const shaped = shapeChart(fiveBands(), { shotLine: 12 });
    expect(shaped.some(t => t.lo === 12)).toBe(true);
    // ...and between two PRINTED rows, never at the top of the table.
    expect(shaped.findIndex(t => t.lo === 12)).toBeGreaterThan(0);
  });

  it('never lets the merge undo the break it just forced', () => {
    // Bands 3 and 4 print the same three numbers, and the shot line falls
    // between them. The merge has to leave that one pair alone.
    const bands = [
      tier(1, 3, 1, 0, 0),
      tier(4, 9, 2, 0, 0),
      tier(10, 14, 3, 1, 1),
      tier(15, 19, 3, 1, 1),
      tier(20, 99, 5, 2, 1),
    ];
    const shaped = shapeChart(bands, { shotLine: 15 });
    expect(shaped.some(t => t.lo === 15)).toBe(true);
    expect(shaped.filter(t => t.pts === 3 && t.reb === 1 && t.ast === 1)).toHaveLength(2);
    // Without a shot line there is nothing to protect and they collapse.
    expect(shapeChart(bands)).toHaveLength(5);
  });

  it('never hands the card more rows than the table can print', () => {
    // Five percentile bands plus the blank tier is the whole budget, and the
    // blank one is not printed — so the worst case is exactly five ROWS. This
    // holds by construction: nothing downstream of computeStatBands adds a
    // tier, so there is no clamp here to go wrong.
    const shaped = shapeChart(fiveBands(), { shotLine: 15 });
    expect(shaped.length).toBeLessThanOrEqual(MAX_CHART_TIERS);
    expect(MAX_PRINTED_ROWS).toBe(5);
    expect(MAX_CHART_TIERS).toBe(6);
    expect(shaped[0]).toMatchObject({ lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 });
    expect(shaped.length - 1).toBeLessThanOrEqual(MAX_PRINTED_ROWS);
    expect(shaped.some(t => t.lo === 15)).toBe(true); // the break survives it
  });

  it('leaves rolls 1-2 producing nothing on every chart it shapes', () => {
    for (const shotLine of [12, 13, 14, 15, 16, 17, 18]) {
      const shaped = shapeChart(fiveBands(), { shotLine });
      expect(shaped[0]).toMatchObject({ lo: 1, pts: 0, reb: 0, ast: 0 });
      expect(shaped[0].hi).toBeGreaterThanOrEqual(2);
    }
  });
});
