import { describe, it, expect } from 'vitest';
import * as V from './variance.js';
import { computeStatBands } from './bands.js';

/** A deterministic stand-in fit: flat level, a straight unit-mean shape curve. */
function stubFit({ levelB = 0, levelA = 0, low = 0.2, high = 1.8 } = {}) {
  const grid = V.SHAPE_GRID;
  return {
    level: { a: levelA, b: levelB },
    shape: {
      grid,
      // A linear ramp from `low` to `high` with mean 1, independent of level:
      // coefficient b is 0 so the curve does not move with production.
      coef: grid.map(u => ({ a: low + (high - low) * ((u - grid[0]) / (grid[grid.length - 1] - grid[0])), b: 0 })),
    },
  };
}

describe('the verified per-100 anchor', () => {
  // memory/provisional_chart_data_idea.md: at NBA pace a 4-minute section is
  // 100 * 4/48 = 8.33 possessions, checked against Jokic's real card
  // (REB 1.43 modeled vs 1.40 actual).
  it('turns a per-100 rate into per-4-minute production', () => {
    expect(V.PER_100_TO_PER_4MIN).toBeCloseTo(0.08333, 5);
    expect(V.per4MinFromPer100(17.2)).toBeCloseTo(1.433, 3); // Jokic REB
    expect(V.per4MinFromPer100(35.5)).toBeCloseTo(2.958, 3); // Jokic PTS
    expect(V.per4MinFromPer100(12.8)).toBeCloseTo(1.067, 3); // Jokic AST
  });

  it('and into per-36 production, the shape model\'s level covariate', () => {
    expect(V.per36FromPer100(35.5)).toBeCloseTo(26.625, 3);
    // Nine four-minute sections make 36 minutes; the two must agree.
    expect(V.per36FromPer100(35.5)).toBeCloseTo(9 * V.per4MinFromPer100(35.5), 8);
  });
});

describe('normalizedValue', () => {
  it('is bands.js\'s own normalization times four', () => {
    // bands.js: normalize(stat, m) = stat * 36 / m^2, magnitude = ROUNDDOWN(t*4).
    expect(V.normalizedValue(26, 36)).toBeCloseTo((4 * 26 * 36) / (36 * 36), 10);
  });

  it('reduces to plain per-4-minutes at exactly 36 minutes', () => {
    // This identity is what makes the synthesis encoding work: a pseudo-game at
    // 36 minutes with stat 9*v round-trips through bands.js back to v.
    for (const stat of [1, 7, 26, 40]) {
      expect(V.normalizedValue(stat, 36)).toBeCloseTo(stat / 9, 10);
    }
  });
});

describe('per4MinFromLog', () => {
  it('is total production over total minutes, not the mean of per-game rates', () => {
    const games = [
      { minutes: '36:00', pts: 27 },
      { minutes: '12:00', pts: 3 },
    ];
    // 30 points in 48 minutes = 2.5 per 4 minutes. Averaging the two games'
    // rates would give 2.0, weighting the 12-minute night as heavily.
    expect(V.per4MinFromLog(games, 'pts')).toBeCloseTo(2.5, 10);
  });

  it('ignores games with no minutes', () => {
    const games = [{ minutes: '36:00', pts: 18 }, { minutes: 0, pts: 0 }];
    expect(V.per4MinFromLog(games, 'pts')).toBeCloseTo(2, 10);
  });
});

describe('quantile', () => {
  it('interpolates linearly between order statistics', () => {
    const v = [0, 10, 20, 30, 40];
    expect(V.quantile(v, 0)).toBe(0);
    expect(V.quantile(v, 1)).toBe(40);
    expect(V.quantile(v, 0.5)).toBe(20);
    expect(V.quantile(v, 0.125)).toBeCloseTo(5, 10);
  });

  it('clamps outside [0,1] rather than throwing, unlike PERCENTILE.EXC', () => {
    expect(V.quantile([1, 2, 3], -1)).toBe(1);
    expect(V.quantile([1, 2, 3], 2)).toBe(3);
  });
});

describe('weightedLinearFit', () => {
  it('recovers a known line and reports r2 of 1', () => {
    const fit = V.weightedLinearFit([0, 1, 2, 3].map(x => ({ x, y: 2 + 5 * x })));
    expect(fit.a).toBeCloseTo(2, 8);
    expect(fit.b).toBeCloseTo(5, 8);
    expect(fit.r2).toBeCloseTo(1, 8);
  });

  it('lets weight decide, so a 79-game log outvotes a 20-game one', () => {
    const points = [
      { x: 0, y: 0, w: 100 },
      { x: 1, y: 1, w: 100 },
      { x: 2, y: 10, w: 0.0001 },
    ];
    expect(V.weightedLinearFit(points).b).toBeCloseTo(1, 2);
  });

  it('survives a degenerate x with a zero slope rather than a division by zero', () => {
    const fit = V.weightedLinearFit([{ x: 3, y: 1 }, { x: 3, y: 5 }]);
    expect(fit.b).toBe(0);
    expect(Number.isFinite(fit.a)).toBe(true);
  });
});

describe('predictInflation', () => {
  const fit = stubFit({ levelB: 1 }); // inflation = 36/mpg exactly

  it('follows the fitted power law inside the sampled range', () => {
    expect(V.predictInflation(fit, 36)).toBeCloseTo(1, 8);
    expect(V.predictInflation(fit, 18)).toBeCloseTo(2, 8);
  });

  // Extrapolating a power law past its data is how a six-minute-a-night injury
  // case ends up with a bigger chart than a starter.
  it('clamps minutes to the sampled range at both ends', () => {
    expect(V.predictInflation(fit, 2)).toBeCloseTo(V.predictInflation(fit, 11), 8);
    expect(V.predictInflation(fit, 48)).toBeCloseTo(V.predictInflation(fit, 38), 8);
  });

  it('treats a missing minutes figure as a mid-rotation player', () => {
    expect(V.predictInflation(fit, undefined)).toBeCloseTo(V.predictInflation(fit, 24), 8);
  });
});

describe('predictShape', () => {
  it('never dips — a quantile curve that decreases is not a distribution', () => {
    // Coefficients chosen so the raw pointwise fits WOULD dip in the middle.
    const grid = V.SHAPE_GRID;
    const fit = {
      shape: { grid, coef: grid.map((u, i) => ({ a: i === 10 ? -3 : u, b: 0 })) },
    };
    const curve = V.predictShape(fit, 20);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
    }
    expect(Math.min(...curve)).toBeGreaterThanOrEqual(0);
  });
});

describe('synthesizeGames', () => {
  const fit = stubFit();
  const input = { per100: { pts: 30, reb: 12, ast: 6 }, mpg: 30, games: 70, fit };

  it('produces one pseudo-game per real game, at a constant 36 minutes', () => {
    const games = V.synthesizeGames(input);
    expect(games).toHaveLength(70);
    expect(games.every(g => g.minutes === 36)).toBe(true);
  });

  it('holds integer counts, the way a real box score does', () => {
    for (const g of V.synthesizeGames(input)) {
      for (const stat of V.CHART_STATS) expect(Number.isInteger(g[stat])).toBe(true);
      expect(g.pts).toBeGreaterThanOrEqual(0);
    }
  });

  it('never emits fewer games than PERCENTILE.EXC can take a 0.1 cut from', () => {
    // bands.js computes PERCENTILE.EXC at p=0.1 and p=0.9, which needs n >= 9.
    const games = V.synthesizeGames({ ...input, games: 3 });
    expect(games.length).toBeGreaterThanOrEqual(V.MIN_SYNTHETIC_GAMES);
    expect(() => computeStatBands(games, 'pts')).not.toThrow();
  });

  it('is deterministic — the same inputs give byte-identical output', () => {
    expect(V.synthesizeGames(input)).toEqual(V.synthesizeGames(input));
  });

  // THE CENTRAL CONTRACT. The synthesis targets the distribution of v, and the
  // 36-minute encoding exists so bands.js's own normalize() reproduces exactly
  // that v. If this drifts, every chart in the set is silently mis-scaled.
  it('lands its mean on the per-4-minute rate times the fitted inflation', () => {
    const flat = stubFit({ levelB: 0, levelA: 0 }); // inflation === 1
    const games = V.synthesizeGames({ per100: { pts: 30 }, mpg: 30, games: 400, fit: flat });
    const meanV = games.reduce((s, g) => s + V.normalizedValue(g.pts, 36), 0) / games.length;
    // WITHIN 1%, NOT EXACTLY, and the gap is a property of the section model
    // rather than slack. That model is DISCRETE — points arrive in twos, threes
    // and free throws — so the `round(9 * v)` integer encoding cannot land the
    // mean perfectly the way the old smooth game-log curve could. The sample is
    // already re-centred on its realised mean inside synthesizeGames; what is
    // left, about 0.6%, is the rounding itself. Tightening this back to two
    // decimals would only be possible by giving up the lumpiness that lets a
    // chart show a real single-basket tier.
    const target = V.per4MinFromPer100(30);
    expect(Math.abs(meanV - target) / target).toBeLessThan(0.01);
  });

  it('re-centres the discrete sample so the level does not quietly shrink', () => {
    // Without the re-centring the same call came in 0.8% light, and every chart
    // in the set would have been scaled down by that much for free.
    const flat = stubFit({ levelB: 0, levelA: 0 });
    for (const per100 of [8, 18, 30, 44]) {
      const games = V.synthesizeGames({ per100: { pts: per100 }, mpg: 30, games: 400, fit: flat });
      const meanV = games.reduce((s, g) => s + V.normalizedValue(g.pts, 36), 0) / games.length;
      const target = V.per4MinFromPer100(per100);
      expect(Math.abs(meanV - target) / target, `per100 ${per100}`).toBeLessThan(0.02);
    }
  });

  it('scales with the fitted inflation', () => {
    const doubled = stubFit({ levelB: 1 }); // 36/mpg, so 2x at 18 minutes
    const flat = stubFit({ levelB: 0 });
    const mean = f => {
      const games = V.synthesizeGames({ per100: { pts: 30 }, mpg: 18, games: 400, fit: f });
      return games.reduce((s, g) => s + g.pts, 0) / games.length;
    };
    expect(mean(doubled) / mean(flat)).toBeCloseTo(2, 1);
  });

  it('gives a player with no production at all a column of zeros, not NaN', () => {
    const games = V.synthesizeGames({ per100: { pts: 0, reb: 0, ast: 0 }, mpg: 14, games: 40, fit });
    expect(games.every(g => g.pts === 0 && g.reb === 0 && g.ast === 0)).toBe(true);
    expect(() => computeStatBands(games, 'pts')).not.toThrow();
  });
});

describe('synthesizeBands', () => {
  it('hands the real computeStatBands five bands covering all 25 roll slots', () => {
    const { pts, reb, ast } = V.synthesizeBands({
      per100: { pts: 30, reb: 12, ast: 6 },
      mpg: 30,
      games: 70,
      fit: stubFit(),
    });
    for (const bands of [pts, reb, ast]) {
      expect(bands).toHaveLength(5);
      expect(bands.reduce((s, b) => s + b.slots, 0)).toBe(25);
      expect(bands[0].lo).toBe(1);
      // Band magnitudes rise with the roll.
      for (let i = 1; i < bands.length; i += 1) {
        expect(bands[i].value).toBeGreaterThanOrEqual(bands[i - 1].value);
      }
    }
  });
});
