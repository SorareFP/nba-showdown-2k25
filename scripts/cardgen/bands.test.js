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

  it('reproduces the real published Jokic 2023-24 chart values exactly (pinned regression)', () => {
    // Task 3's calibrate.js established these as the exact real values from
    // Final Cards.csv. The 2026-09-03 EV-preserving rounding briefly departed
    // from them because EV drift was the primary objective; the 2026-09-03
    // (later same day) fix made per-band DEVIATION primary and EV the
    // tiebreak, which brings Jokic back to a byte-for-byte match with the
    // published values. Bands still round together (so a role player's
    // 3:1.3:1 ratios do not collapse to a flat 1p1r1a row), but the
    // deviation-first ordering means a chart never drifts from the raw
    // ladder just to trim EV by a hundredth. See shooting.js? No — see
    // bands.js's evRoundValues.
    expect(computeStatBands(jokicGames, 'pts').map(b => b.value)).toEqual([2, 3, 3, 4, 4]);
    expect(computeStatBands(jokicGames, 'reb').map(b => b.value)).toEqual([1, 1, 1, 2, 2]);
    expect(computeStatBands(jokicGames, 'ast').map(b => b.value)).toEqual([1, 1, 1, 1, 2]);
  });

  it('treats "MM:SS" string minutes the same as the equivalent decimal number', () => {
    const gamesString = Array.from({ length: 40 }, (_, i) => ({ minutes: '30:00', pts: i % 31 }));
    const gamesNumeric = Array.from({ length: 40 }, (_, i) => ({ minutes: 30, pts: i % 31 }));
    expect(computeStatBands(gamesString, 'pts')).toEqual(computeStatBands(gamesNumeric, 'pts'));
  });
});
