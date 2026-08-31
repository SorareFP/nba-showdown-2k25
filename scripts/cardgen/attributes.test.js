import { describe, it, expect } from 'vitest';
import * as A from './attributes.js';

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

describe('size inside the split', () => {
  // The share moves by SIZE_SPEED_SHARE per inch and per pound AWAY from the
  // position's own average build, so the sign is the one the methodology states:
  // bigger is more Power.
  const pgCentre = A.POSITION_SIZE.PG;

  it('leaves a player of exactly his position\'s build on the positional share', () => {
    expect(A.speedShare('PG', { ...pgCentre })).toBeCloseTo(A.POSITION_SPEED_SHARE.PG, 12);
  });

  it('gives a TALLER player of the same position less Speed', () => {
    const tall = A.speedShare('PG', { inches: pgCentre.inches + 4, weight: pgCentre.weight });
    expect(tall).toBeLessThan(A.POSITION_SPEED_SHARE.PG);
    expect(tall).toBeCloseTo(A.POSITION_SPEED_SHARE.PG + 4 * A.SIZE_SPEED_SHARE.inches, 12);
  });

  it('gives a HEAVIER player of the same position less Speed', () => {
    const heavy = A.speedShare('C', { inches: A.POSITION_SIZE.C.inches, weight: A.POSITION_SIZE.C.weight + 30 });
    expect(heavy).toBeLessThan(A.POSITION_SPEED_SHARE.C);
  });

  it('gives a SMALLER player of the same position more Speed', () => {
    expect(
      A.speedShare('C', { inches: A.POSITION_SIZE.C.inches - 3, weight: A.POSITION_SIZE.C.weight - 20 })
    ).toBeGreaterThan(A.POSITION_SPEED_SHARE.C);
  });

  // The requirement the matrix work turns on: the split may move, the BUDGET
  // may not. Net Edge is a function of speed + power alone, so conservation is
  // what keeps a flavour change from becoming a balance change.
  it('still sums to exactly the budget at every size', () => {
    for (let total = 2; total <= 40; total += 1) {
      for (const inches of [66, 72, 78, 84, 90]) {
        for (const weight of [150, 200, 250, 320]) {
          for (const pos of ['PG', 'SG', 'SF', 'PF', 'C', null]) {
            const { speed, power } = A.splitSpeedPower(total, pos, A.POSITION_SPEED_SHARE, {
              size: { inches, weight },
            });
            expect(speed + power).toBe(total);
            expect(speed).toBeGreaterThanOrEqual(1);
            expect(power).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });

  // Every set without biometrics — the WNBA, and any player the archive misses —
  // has to keep producing the card it produced before.
  it('DEGRADES to position-only for a missing, partial or unparseable size', () => {
    const positionOnly = A.splitSpeedPower(22, 'SG');
    for (const size of [
      null,
      undefined,
      {},
      { inches: 76 },
      { weight: 200 },
      { inches: null, weight: 200 },
      { inches: 76, weight: NaN },
      { inches: '76', weight: '200' },
    ]) {
      expect(A.splitSpeedPower(22, 'SG', A.POSITION_SPEED_SHARE, { size })).toEqual(positionOnly);
    }
  });

  it('leaves an unrecognised position on the even split whatever the size', () => {
    expect(
      A.splitSpeedPower(20, 'DH', A.POSITION_SPEED_SHARE, { size: { inches: 88, weight: 300 } })
    ).toEqual({ speed: 10, power: 10 });
  });

  it('clamps an absurd build well short of a card with 0 on one side', () => {
    expect(A.speedShare('C', { inches: 200, weight: 900 })).toBe(A.SPEED_SHARE_BOUNDS.min);
    expect(A.speedShare('PG', { inches: 10, weight: 10 })).toBe(A.SPEED_SHARE_BOUNDS.max);
  });

  it('takes its centres and slopes from the calibration when given them', () => {
    const flat = A.speedShare('PG', { inches: 90, weight: 300 }, {
      sizeModel: { inches: 0, weight: 0 },
    });
    expect(flat).toBeCloseTo(A.POSITION_SPEED_SHARE.PG, 12);
  });

  // The 2026-27 pool's biggest mover, worked by hand: Luka Doncic is a 6'8",
  // 230lb point guard, 4.85 inches and 34.3 pounds above the average PG build.
  //   share = 0.6269 + (-0.004393 * 4.85) + (-0.000754 * 34.3) = 0.5798
  //   speed = round(28 * 0.5798) = 16, power = 28 - 16 = 12
  // against the position-only round(28 * 0.6269) = 18 / 10.
  it('reproduces the pool\'s biggest mover by hand', () => {
    expect(A.splitSpeedPower(28, 'PG')).toEqual({ speed: 18, power: 10 });
    expect(
      A.splitSpeedPower(28, 'PG', A.POSITION_SPEED_SHARE, { size: { inches: 80, weight: 230 } })
    ).toEqual({ speed: 16, power: 12 });
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
  // way into every card in the set as blank stats. It has to fail loudly instead.
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
