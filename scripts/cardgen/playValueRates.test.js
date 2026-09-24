// THE SALARY MODEL PRICES A REBOUND AND AN ASSIST AT WHAT THEY BUY (2026-09-23).
// Its rates were constants for an economy that had moved on (4 AST a three,
// 2 REB a putback), so it priced a rebound above an assist while the game
// paid an assist nearly twice a rebound. They now read the engine's own
// SPEND_COSTS; these tests hold them there.
import { describe, it, expect } from 'vitest';
import { astRate, rebRate, computePlayValue } from './playValue.js';
import { SPEND_COSTS } from '../../src/game/engine.js';

describe('the currency rates', () => {
  it('price a unit at the check it buys, at the engine\'s prices', () => {
    expect(rebRate(0.5)).toBeCloseTo((2 * 0.5) / SPEND_COSTS.reboundPaint, 12);
    expect(astRate(0.4, 0.5)).toBeCloseTo(Math.max((3 * 0.4) / SPEND_COSTS.assistThree, (2 * 0.5) / SPEND_COSTS.assistPaint), 12);
    // An assist can buy the paint check a rebound buys, and a three besides.
    for (const [p3, pp] of [[0.2, 0.5], [0.4, 0.45], [0.55, 0.3]]) {
      expect(astRate(p3, pp)).toBeGreaterThanOrEqual(rebRate(pp) * (SPEND_COSTS.reboundPaint / SPEND_COSTS.assistPaint) - 1e-12);
    }
  });

  it('value a rebound below an assist for a typical shooter, as play does', () => {
    expect(rebRate(0.45)).toBeLessThan(astRate(0.4, 0.45));
  });
});

describe('a rebound-only chart against an assist-only chart', () => {
  const mk = (id, row) => ({
    id, name: id, speed: 10, power: 10, defBoost: 0, shotLine: 14, threePtBoost: 1, paintBoost: 1,
    chart: [{ lo: 1, hi: 99, pts: 2, ...row }],
  });
  it('pays the assist more, the same volume of each', () => {
    const field = Array.from({ length: 12 }, (_, i) => mk(`f${i}`, { reb: 0, ast: 0 }));
    const glass = mk('glass', { reb: 2, ast: 0 });
    const dimes = mk('dimes', { reb: 0, ast: 2 });
    const { conv } = computePlayValue([glass, dimes], { field });
    expect(conv[1]).toBeGreaterThan(conv[0]);
  });
});
