// "Top tier" means the last row of the chart, reached by the final roll.
import { describe, it, expect } from 'vitest';
import { hitsTopTier } from './engine.js';

// Oso Ighodaro's actual shape: three rows paying one point each.
const OSO = { chart: [
  { lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 }, { lo: 3, hi: 8, pts: 0, reb: 0, ast: 0 },
  { lo: 9, hi: 17, pts: 1, reb: 1, ast: 0 }, { lo: 18, hi: 23, pts: 1, reb: 1, ast: 1 },
  { lo: 24, hi: 99, pts: 1, reb: 2, ast: 1 },
] };

describe('hitsTopTier', () => {
  it('is the last row, not the most points — a 9 on Ighodaro is not top tier', () => {
    // The regression: three rows pay 1 pt, so "scored the max" was true from 9.
    expect(hitsTopTier(OSO, 9)).toBe(false);
    expect(hitsTopTier(OSO, 23)).toBe(false);
    expect(hitsTopTier(OSO, 24)).toBe(true);
    expect(hitsTopTier(OSO, 40)).toBe(true);
  });

  it('counts the bonuses, because it reads the FINAL roll', () => {
    // A 20 on the die with +4 is a 24 — top tier; a 20 with −1 is not.
    expect(hitsTopTier(OSO, 20 + 4)).toBe(true);
    expect(hitsTopTier(OSO, 20 - 1)).toBe(false);
  });

  it('never fires on a chart whose top row pays nothing, or on no chart', () => {
    expect(hitsTopTier({ chart: [{ lo: 1, hi: 99, pts: 0, reb: 0, ast: 0 }] }, 30)).toBe(false);
    expect(hitsTopTier({}, 30)).toBe(false);
  });
});
