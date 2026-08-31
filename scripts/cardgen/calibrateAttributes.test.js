import { describe, it, expect } from 'vitest';
import {
  SPEED_SHARE_RULES,
  applySpeedShareRule,
  compareSpeedShareRules,
  indexShares,
} from './calibrateAttributes.js';
import * as A from './attributes.js';

/**
 * A synthetic card set whose split really IS a blend of positional shares.
 *
 * The point of these tests is not that the four-way comparison prefers one rule
 * — it is that the comparison CAN prefer the right one. On the real finished
 * cards it reports that shares fit worse than the label, and that verdict is
 * only worth anything if the machinery would have said otherwise had the shares
 * been what drove the cards. So here they are what drove the cards.
 */
function syntheticPoints({ n = 200, centres, driver }) {
  const points = [];
  // A deterministic spread of positional mixes, from pure PG to pure C, so the
  // sample contains both one-hot players and genuinely split ones.
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const raw = A.POSITIONS.map((_, k) => Math.max(0, 1 - Math.abs(t * 4 - k)));
    const sum = raw.reduce((a, b) => a + b, 0);
    const shares = Object.fromEntries(A.POSITIONS.map((p, k) => [p, raw[k] / sum]));
    const pos = A.POSITIONS[raw.indexOf(Math.max(...raw))];
    // Height and weight both rise with the positional mix but are NOT collinear
    // with each other — a perfectly proportional pair makes the size regression
    // singular, and `fitLeastSquares` correctly refuses to fit it.
    const inches = 74 + t * 9 + ((i % 5) - 2) * 0.4;
    const weight = 190 + t * 60 + ((i % 7) - 3) * 9;
    const total = 18 + (i % 13);
    const share = driver({ shares, pos, inches, weight, centres });
    points.push({
      name: `Player ${String(i).padStart(3, '0')}`,
      pos,
      total,
      inches,
      weight,
      shares,
      share,
      speed: Math.min(Math.max(Math.round(total * share), 1), total - 1),
    });
  }
  return points;
}

const CENTRES = { PG: 0.66, SG: 0.6, SF: 0.5, PF: 0.42, C: 0.34 };
const blend = (shares, of) => A.POSITIONS.reduce((s, p) => s + shares[p] * of(p), 0);

describe('the four-way split comparison', () => {
  it('picks the SHARES rule out when the shares are what generated the cards', () => {
    const points = syntheticPoints({
      centres: CENTRES,
      driver: ({ shares }) => blend(shares, p => CENTRES[p]),
    });
    const result = compareSpeedShareRules(points, { folds: 5 });
    expect(result.shares.heldOut.rmse).toBeLessThan(result.label.heldOut.rmse);
    expect(result.shares.heldOut.rmse).toBeLessThan(result.labelSize.heldOut.rmse);
  });

  it('picks the LABEL rule out when the label is what generated the cards', () => {
    const points = syntheticPoints({
      centres: CENTRES,
      driver: ({ pos }) => CENTRES[pos],
    });
    const result = compareSpeedShareRules(points, { folds: 5 });
    expect(result.label.heldOut.rmse).toBeLessThan(result.shares.heldOut.rmse);
  });

  // The card really is withheld, demonstrated rather than asserted: one wildly
  // wrong card is partly absorbed by a fit that contains it, and cannot be
  // absorbed at all by a fit that does not. So it must cost the held-out score
  // MORE than the in-sample one. If the folds leaked, the two would move
  // together and this whole comparison would be in-sample error twice over.
  it('genuinely withholds a card from the fit that predicts it', () => {
    const clean = syntheticPoints({ centres: CENTRES, driver: ({ pos }) => CENTRES[pos] });
    const withOutlier = clean.map((p, i) =>
      i === 0 ? { ...p, share: 0.95, speed: Math.round(p.total * 0.95) } : p
    );
    const before = compareSpeedShareRules(clean, { folds: 5 });
    const after = compareSpeedShareRules(withOutlier, { folds: 5 });
    const inSampleCost = after.label.inSample.rmse - before.label.inSample.rmse;
    const heldOutCost = after.label.heldOut.rmse - before.label.heldOut.rmse;
    expect(heldOutCost).toBeGreaterThan(inSampleCost);
  });

  it('reports leave-one-out beside the k-fold number, so neither can be cherry-picked', () => {
    const points = syntheticPoints({ centres: CENTRES, driver: ({ pos }) => CENTRES[pos] });
    const result = compareSpeedShareRules(points, { folds: 5 });
    for (const name of Object.keys(SPEED_SHARE_RULES)) {
      expect(result[name].leaveOneOut).toBeTruthy();
      expect(result[name].leaveOneOut.rmse).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic — the same cards give the same answer every run', () => {
    const points = syntheticPoints({ centres: CENTRES, driver: ({ shares }) => blend(shares, p => CENTRES[p]) });
    const a = compareSpeedShareRules(points, { folds: 5 });
    const b = compareSpeedShareRules(points.slice().reverse(), { folds: 5 });
    expect(a).toEqual(b);
  });
});

describe('the fitted rules', () => {
  const points = syntheticPoints({ centres: CENTRES, driver: ({ shares }) => blend(shares, p => CENTRES[p]) });

  // The five weights sum to 1, so an intercept would make the design singular.
  // Recovering the generating centres is the check that the no-intercept fit is
  // doing what it claims.
  it('recovers the generating positional centres from fractional shares alone', () => {
    const fit = SPEED_SHARE_RULES.shares(points);
    for (const p of A.POSITIONS) expect(fit.shares[p]).toBeCloseTo(CENTRES[p], 6);
  });

  it('scores a rule through splitSpeedPower itself, not a re-implementation', () => {
    const fit = SPEED_SHARE_RULES.sharesSize(points);
    const p = points[7];
    expect(applySpeedShareRule(fit, p)).toEqual(
      A.splitSpeedPower(p.total, p.pos, fit.shares, {
        positionSize: fit.positionSize,
        sizeModel: fit.sizeModel,
        size: { inches: p.inches, weight: p.weight },
        positionShares: p.shares,
      })
    );
  });

  it('fits a build centre for every position, so no blend is a partial sum', () => {
    const fit = SPEED_SHARE_RULES.sharesSize(points);
    for (const p of A.POSITIONS) {
      expect(Number.isFinite(fit.positionSize[p].inches)).toBe(true);
      expect(Number.isFinite(fit.positionSize[p].weight)).toBe(true);
    }
  });
});

describe('indexShares', () => {
  const rows = [
    { playerId: 'aa01', name: 'Split Guy', games: 70, pct: { PG: 46, SG: 52, SF: 2, PF: 0, C: 0 } },
    { playerId: 'aa01', name: 'Split Guy', games: 30, pct: { PG: 100, SG: 0, SF: 0, PF: 0, C: 0 } },
    { playerId: 'bb02', name: 'Empty Guy', games: 3, pct: { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } },
  ];

  it('normalizes and keeps the row covering the most games', () => {
    const index = indexShares(rows);
    expect(index.get('splitguy').SG).toBeCloseTo(52 / 100, 12);
    expect(Object.values(index.get('splitguy')).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('drops a row with no measurement rather than storing an even blend', () => {
    expect(indexShares(rows).has('emptyguy')).toBe(false);
    expect(indexShares(null).size).toBe(0);
  });

  it('leaves nothing but the five positions on the stored value', () => {
    expect(Object.keys(indexShares(rows).get('splitguy')).sort()).toEqual(
      A.POSITIONS.slice().sort()
    );
  });
});
