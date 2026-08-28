import { describe, it, expect } from 'vitest';
import { computeStatBands } from './bands.js';

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
});
