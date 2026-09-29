import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { computeStatBands, conditionalStatValues } from './bands.js';

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

  it('keeps the cut each band was made from, so a game can be placed in a band again', () => {
    const games = Array.from({ length: 40 }, (_, i) => ({ minutes: 30, pts: i % 31 }));
    const bands = computeStatBands(games, 'pts');
    for (let i = 1; i < bands.length; i++) expect(bands[i].threshold).toBeGreaterThanOrEqual(bands[i - 1].threshold);
  });
});

// WHAT HE DID ALONGSIDE THOSE POINTS (the user, 2026-09-29): each points
// band's rebounds and assists are the average over the games that landed in
// it, not a rung of the stat's own ladder.
describe('conditionalStatValues', () => {
  // A passer whose assists FALL as his points rise: quiet nights 6-10 pts with
  // 14 assists, big nights 24-30 pts with 1. Rebounds flat at 8 throughout
  // (8 in 34 minutes is 1.0 on the chart's scale, so a flat stat has a flat
  // integer answer).
  const nash = Array.from({ length: 60 }, (_, i) => {
    const big = i % 2 === 0;
    return { minutes: 34, pts: big ? 24 + (i % 7) : 6 + (i % 5), ast: big ? 1 : 14, reb: 8 };
  });

  it('gives the low-points bands the high assists that happened there, and lets the ladder fall', () => {
    const pts = computeStatBands(nash, 'pts');
    const ast = conditionalStatValues(nash, pts, 'ast');
    expect(ast).toHaveLength(5);
    expect(ast[0].value).toBeGreaterThan(ast[4].value);         // 12 on the quiet nights beats 6 on the big ones
    expect(ast.every(b => b.games > 0)).toBe(true);
    // The per-stat ladder the old reconcile read would have said the reverse.
    const ladder = computeStatBands(nash, 'ast').map(b => b.value);
    expect(ladder[4]).toBeGreaterThanOrEqual(ladder[0]);
  });

  it('keeps a flat stat flat, and preserves the expected value', () => {
    const pts = computeStatBands(nash, 'pts');
    const reb = conditionalStatValues(nash, pts, 'reb');
    expect(reb.map(b => b.value)).toEqual([1, 1, 1, 1, 1]);
    const slots = pts.map(b => b.slots);
    const total = slots.reduce((a, b) => a + b, 0);
    const ev = reb.reduce((s, b, i) => s + b.value * slots[i], 0) / total;
    const raw = reb.reduce((s, b, i) => s + b.raw * slots[i], 0) / total;
    expect(Math.abs(ev - raw)).toBeLessThan(1);
  });

  it('is null when no game carries both stats, so the caller can fall back', () => {
    const pts = computeStatBands(nash, 'pts');
    expect(conditionalStatValues(nash.map(({ minutes, pts: p }) => ({ minutes, pts: p })), pts, 'ast')).toBeNull();
    expect(conditionalStatValues(nash, pts.map(({ threshold, ...b }) => b), 'ast')).toBeNull();   // bands without their cuts
  });
});
