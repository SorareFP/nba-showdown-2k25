import { describe, it, expect } from 'vitest';
import * as A from './attributes.js';

describe('the D20 probability calibration', () => {
  // The one verified fact in the whole shooting layer
  // (memory/shooting_attributes_methodology.md): Curry's Shot Line 13 with a
  // 3PT Boost of +2 gives an effective line of 11, and 11 is what ~45% from
  // three is worth. Everything else in that layer is a refit hanging off this.
  it('reproduces the verified real-card examples', () => {
    expect(A.successProbability(13 - 2)).toBeCloseTo(0.45, 10); // Curry
    expect(A.successProbability(13 - 1)).toBeCloseTo(0.4, 10); // Haliburton
    expect(A.successProbability(14 - 2)).toBeCloseTo(0.4, 10); // Pritchard, Edwards
    expect(A.successProbability(12 - 0)).toBeCloseTo(0.4, 10); // Jokic
  });

  it('inverts', () => {
    for (const line of [11, 12, 13, 14, 15, 16, 17]) {
      expect(A.impliedLine(A.successProbability(line))).toBeCloseTo(line, 10);
    }
  });
});

describe('basePosition', () => {
  it('reduces every spelling the two sources use', () => {
    expect(A.basePosition('PG')).toBe('PG');
    // Basketball-Reference's hyphenated secondary position.
    expect(A.basePosition('SF-PF')).toBe('SF');
    // dunksandthrees writes one-letter groups, which have no single slot — they
    // map to the middle of their group rather than to a guess.
    expect(A.basePosition('F-C')).toBe('SF');
    expect(A.basePosition('G')).toBe('SG');
    expect(A.basePosition('c')).toBe('C');
  });

  it('returns null rather than guessing at an unknown position', () => {
    expect(A.basePosition('')).toBe(null);
    expect(A.basePosition(undefined)).toBe(null);
    expect(A.basePosition('DH')).toBe(null);
  });
});

describe('splitSpeedPower', () => {
  // Step 4 of memory/speed_power_methodology.md: "Force the split to sum exactly
  // to the budget... total player strength is conserved."
  it('always sums to exactly the budget, across every budget and position', () => {
    for (let total = 2; total <= 40; total += 1) {
      for (const pos of ['PG', 'SG', 'SF', 'PF', 'C', null]) {
        const { speed, power } = A.splitSpeedPower(total, pos);
        expect(speed + power).toBe(total);
        expect(speed).toBeGreaterThanOrEqual(1);
        expect(power).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('skews guards to Speed and bigs to Power', () => {
    const pg = A.splitSpeedPower(28, 'PG');
    const c = A.splitSpeedPower(28, 'C');
    expect(pg.speed).toBeGreaterThan(pg.power);
    expect(c.power).toBeGreaterThan(c.speed);
    // The two real anchors quoted in the methodology: SGA's 28 became 21/7 and
    // Jokic's 28 became 7/21. The measured positional shares are gentler than
    // those two individual cards, but the ORDER has to hold.
    expect(pg.speed).toBeGreaterThan(c.speed);
  });

  it('splits an unknown position evenly rather than defaulting to a guard', () => {
    expect(A.splitSpeedPower(20, 'DH')).toEqual({ speed: 10, power: 10 });
  });
});

describe('defBoostFromEpm', () => {
  // The rounding rule the user asked for, spelled out in
  // memory/speed_power_methodology.md: "-0.5 down to -1".
  it('rounds half AWAY from zero, symmetrically', () => {
    expect(A.defBoostFromEpm(0.5)).toBe(1);
    expect(A.defBoostFromEpm(-0.5)).toBe(-1);
    expect(A.defBoostFromEpm(2.4)).toBe(2);
    expect(A.defBoostFromEpm(-2.4)).toBe(-2);
  });

  it('never returns negative zero, which would print as "-0" on a card', () => {
    expect(Object.is(A.defBoostFromEpm(-0.2), -0)).toBe(false);
    expect(A.defBoostFromEpm(-0.2)).toBe(0);
  });

  it('treats a missing EPM as neutral', () => {
    expect(A.defBoostFromEpm(undefined)).toBe(0);
    expect(A.defBoostFromEpm(NaN)).toBe(0);
  });
});

describe('shapeBoost', () => {
  const shaping = { spread: 1.2, mean: 0.5, deadband: 1.05, min: -5, max: 5 };

  it('zeroes anything inside the deadband', () => {
    expect(A.shapeBoost(1.0, shaping)).toBe(0);
    expect(A.shapeBoost(-1.0, shaping)).toBe(0);
  });

  // The regression this test exists for: applying the deadband AFTER the spread
  // made every +1 unreachable, because nothing could land between the band edge
  // and 1.5. A whole tier disappeared from the set and no error metric noticed.
  it('can still produce a +1, the tier a post-spread deadband deleted', () => {
    const values = [];
    for (let x = -4; x <= 4; x += 0.01) values.push(A.shapeBoost(x, shaping));
    expect(values).toContain(1);
    expect(values).toContain(-1);
  });

  it('clamps to the bounds it is given', () => {
    expect(A.shapeBoost(100, { ...shaping, min: -1, max: 3 })).toBe(3);
    expect(A.shapeBoost(-100, { ...shaping, min: -1, max: 3 })).toBe(-1);
  });

  it('is monotone in the prediction outside the deadband', () => {
    let previous = -Infinity;
    for (let x = 1.05; x <= 6; x += 0.05) {
      const value = A.shapeBoost(x, shaping);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('shotLineFromScore', () => {
  it('clamps into the range the finished set actually occupies', () => {
    expect(A.shotLineFromScore(3)).toBe(A.SHOT_LINE_MIN);
    expect(A.shotLineFromScore(40)).toBe(A.SHOT_LINE_MAX);
    expect(A.shotLineFromScore(15.4)).toBe(15);
    expect(A.shotLineFromScore(15.6)).toBe(16);
  });
});

describe('roundSalary', () => {
  it('lands on a round ten, like every salary in the finished set', () => {
    expect(A.roundSalary(823)).toBe(820);
    expect(A.roundSalary(826)).toBe(830);
  });

  it('clamps rather than emitting a negative or absurd salary', () => {
    expect(A.roundSalary(-500)).toBe(A.SALARY_MIN);
    expect(A.roundSalary(99999)).toBe(A.SALARY_MAX);
    expect(A.roundSalary(NaN)).toBe(A.SALARY_MIN);
  });
});

describe('fitLeastSquares', () => {
  it('recovers a known linear relationship exactly', () => {
    const rows = [0, 1, 2, 3, 4, 5].map(x => ({ x, y: 7 + 3 * x }));
    const fit = A.fitLeastSquares(rows, r => r.y, [r => r.x]);
    expect(fit.coef[0]).toBeCloseTo(7, 8);
    expect(fit.coef[1]).toBeCloseTo(3, 8);
    expect(fit.r2).toBeCloseTo(1, 8);
  });

  // A singular system used to produce NaN coefficients, which then rode all the
  // way into 331 cards as blank stats. It has to fail loudly instead.
  it('returns null on a singular system rather than NaN coefficients', () => {
    const rows = [1, 2, 3].map(x => ({ x, y: x }));
    expect(A.fitLeastSquares(rows, r => r.y, [r => r.x, r => r.x])).toBe(null);
    expect(A.fitLeastSquares(rows, r => r.y, [() => 1])).toBe(null);
  });

  it('returns null when any input is not finite', () => {
    const rows = [{ x: 1, y: 1 }, { x: NaN, y: 2 }];
    expect(A.fitLeastSquares(rows, r => r.y, [r => r.x])).toBe(null);
  });
});

describe('zScorer', () => {
  it('centres and scales', () => {
    const z = A.zScorer([1, 2, 3, 4, 5]);
    expect(z(3)).toBeCloseTo(0, 10);
    expect(z(5)).toBeGreaterThan(0);
  });

  it('returns 0 for a constant pool instead of dividing by zero', () => {
    const z = A.zScorer([4, 4, 4]);
    expect(z(4)).toBe(0);
    expect(Number.isFinite(z(9))).toBe(true);
  });
});
