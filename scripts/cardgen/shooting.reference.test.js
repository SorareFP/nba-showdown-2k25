// A special set's three line is measured on the base set's scale, not its own.
import { describe, it, expect } from 'vitest';
import { buildShootingLayer } from './shooting.js';

const target = { mean: 15, sd: 1.4, min: 12, max: 18 };
const shooter = (threePct, tsPct = 0.56) => ({
  tsPct, paintPct: 0.62, threePct, paintAttempts: 300, threeAttempts: 300, threeRate: 6,
});
// Twelve base rows around a league-average .360, then twelve poor shooters.
const base = [0.33, 0.34, 0.35, 0.35, 0.36, 0.36, 0.36, 0.37, 0.37, 0.38, 0.39, 0.41].map(p => shooter(p));
// Rookies shoot worse from everywhere: .50 TS against the base rows' .56.
const rookies = [0.24, 0.26, 0.28, 0.29, 0.30, 0.31, 0.31, 0.32, 0.33, 0.34, 0.347, 0.36].map(p => shooter(p, 0.50));
const opts = { shotLineTarget: target, paint: {}, three: { targetSd: 1.4 } };

describe('three.referenceCount', () => {
  it('gives a season the three line the same percentage earns in the base pool', () => {
    const baseOnly = buildShootingLayer(base, opts);
    const pooled = buildShootingLayer([...base, ...rookies], opts);
    const anchored = buildShootingLayer([...base, ...rookies], {
      ...opts, three: { ...opts.three, referenceCount: base.length },
    });
    // The anchored map IS the base-only map.
    expect(anchored.threeShape.lineMap.poolMean).toBeCloseTo(baseOnly.threeShape.lineMap.poolMean, 9);
    expect(anchored.threeShape.lineMap.scale).toBeCloseTo(baseOnly.threeShape.lineMap.scale, 9);
    // And the union map is not: the rookies moved it.
    expect(pooled.threeShape.lineMap.poolMean).not.toBeCloseTo(baseOnly.threeShape.lineMap.poolMean, 3);
  });

  it('leaves the base rows themselves where they were', () => {
    const baseOnly = buildShootingLayer(base, opts);
    const anchored = buildShootingLayer([...base, ...rookies], {
      ...opts, three: { ...opts.three, referenceCount: base.length },
    });
    for (let i = 0; i < base.length; i += 1) {
      expect(anchored.players[i].raw.threeLine).toBe(baseOnly.players[i].raw.threeLine);
    }
  });
});

describe('referenceCount for the whole layer', () => {
  it('fits the Shot Line map on the base rows, so they come out as in their own run', () => {
    const baseOnly = buildShootingLayer(base, opts);
    const anchored = buildShootingLayer([...base, ...rookies], { ...opts, referenceCount: base.length });
    const pooled = buildShootingLayer([...base, ...rookies], opts);
    expect(anchored.map.poolMean).toBeCloseTo(baseOnly.map.poolMean, 9);
    expect(anchored.map.scale).toBeCloseTo(baseOnly.map.scale, 9);
    for (let i = 0; i < base.length; i += 1) {
      expect(anchored.players[i].shotLine).toBe(baseOnly.players[i].shotLine);
    }
    // The three layer follows the same reference when it is not narrowed itself.
    expect(anchored.threeShape.lineMap.poolMean).toBeCloseTo(baseOnly.threeShape.lineMap.poolMean, 9);
    // And the union fit is a different map — the rookies moved it.
    expect(Math.abs(pooled.map.poolMean - baseOnly.map.poolMean)).toBeGreaterThan(1e-6);
  });
});
