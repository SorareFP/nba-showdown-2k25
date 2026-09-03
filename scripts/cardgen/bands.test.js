import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { computeStatBands } from './bands.js';

const jokicGames = JSON.parse(
  readFileSync(new URL('../../card-data/fixtures/jokic-2023-24-gamelog.json', import.meta.url))
);

describe('computeStatBands', () => {
  it('produces 5 bands whose slot widths sum to 25', () => {
    // 40 synthetic games, points ranging 0-30, enough spread for all 5 percentile cuts to resolve
    const games = Array.from({ length: 40 }, (_, i) => ({ minutes: 30, pts: i % 31 }));
    const bands = computeStatBands(games, 'pts');
    expect(bands).toHaveLength(5);
    const totalSlots = bands.reduce((sum, b) => sum + b.slots, 0);
    expect(totalSlots).toBe(25);
  });

  it('produces non-decreasing magnitude values across bands', () => {
    const games = Array.from({ length: 40 }, (_, i) => ({ minutes: 30, pts: i % 31 }));
    const bands = computeStatBands(games, 'pts');
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].value).toBeGreaterThanOrEqual(bands[i - 1].value);
    }
  });

  it('sums slot widths to exactly 25 even when most values are zero (regression)', () => {
    // 96 zero-value games, 3 games at 1, 1 game at 2 — a shape typical of a
    // low-usage box-score stat (e.g. blocks/steals for a non-specialist).
    // At least one percentile bucket floors to a raw weight of 0 here, which
    // previously caused the old `slots[i] || 1` fallback to inflate the total
    // width past TOTAL_SLOTS (29 observed instead of 25) without deducting a
    // slot elsewhere.
    const games = [
      ...Array.from({ length: 96 }, () => ({ minutes: 20, blk: 0 })),
      ...Array.from({ length: 3 }, () => ({ minutes: 20, blk: 1 })),
      { minutes: 20, blk: 2 },
    ];
    const bands = computeStatBands(games, 'blk');
    const totalSlots = bands.reduce((sum, b) => sum + b.slots, 0);
    expect(totalSlots).toBe(25);
  });

  it('produces Jokic 2023-24 chart values under the widened lower cuts', () => {
    // Task 3's calibrate.js established the published Final Cards.csv values
    // as [2,3,3,4,4]/[1,1,1,2,2]/[1,1,1,1,2] under cuts [0.10,0.33,0.50,0.66,
    // 0.90]. Cuts widened 2026-09-03 to [0.05,0.20,0.40,0.66,0.90] to bring
    // team scoring from ~128 back to the rebuild's original ~120 target —
    // the ceilings (p66, p90) are untouched, so a boom scorer's top row
    // stays where his data earns it, but the lower bands now sample deeper
    // into each player's worst games. Jokic's ceiling and boards are
    // unchanged; his floor pts and assists both drop by one, reflecting
    // that even elite scorers have bad games and the chart should say so.
    expect(computeStatBands(jokicGames, 'pts').map(b => b.value)).toEqual([2, 2, 3, 3, 4]);
    expect(computeStatBands(jokicGames, 'reb').map(b => b.value)).toEqual([1, 1, 1, 2, 2]);
    expect(computeStatBands(jokicGames, 'ast').map(b => b.value)).toEqual([0, 1, 1, 1, 2]);
  });

  it('treats "MM:SS" string minutes the same as the equivalent decimal number', () => {
    const gamesString = Array.from({ length: 40 }, (_, i) => ({ minutes: '30:00', pts: i % 31 }));
    const gamesNumeric = Array.from({ length: 40 }, (_, i) => ({ minutes: 30, pts: i % 31 }));
    expect(computeStatBands(gamesString, 'pts')).toEqual(computeStatBands(gamesNumeric, 'pts'));
  });
});
