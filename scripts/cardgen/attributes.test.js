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

describe('positional SHARES inside the split', () => {
  const oneHot = pos => Object.fromEntries(A.POSITIONS.map(p => [p, p === pos ? 100 : 0]));

  it('is the old rule exactly when the shares are all on one position', () => {
    for (const pos of A.POSITIONS) {
      expect(A.speedShare('DH', null, { positionShares: oneHot(pos) })).toBeCloseTo(
        A.POSITION_SPEED_SHARE[pos],
        12
      );
    }
  });

  it('is the old rule exactly when no shares are supplied', () => {
    for (const pos of A.POSITIONS) {
      expect(A.speedShare(pos, null, { positionShares: null })).toBeCloseTo(
        A.POSITION_SPEED_SHARE[pos],
        12
      );
    }
  });

  // The case the change exists for. James Harden's label says PG; his minutes
  // say 46% PG / 52% SG / 2% SF, and the blend lands between the two centres
  // instead of on the guard end of them.
  it('lands a combo guard between the two positions he actually played', () => {
    const blended = A.speedShare('PG', null, { positionShares: { PG: 46, SG: 52, SF: 2, PF: 0, C: 0 } });
    expect(blended).toBeLessThan(A.POSITION_SPEED_SHARE.PG);
    expect(blended).toBeGreaterThan(A.POSITION_SPEED_SHARE.SF);
    expect(blended).toBeCloseTo(
      (46 * A.POSITION_SPEED_SHARE.PG + 52 * A.POSITION_SPEED_SHARE.SG + 2 * A.POSITION_SPEED_SHARE.SF) /
        100,
      12
    );
  });

  // The rows are whole percents and total 99 to 102, so a blend that trusted
  // the sum would scale every centre by up to 2% in one direction.
  it('normalizes a row that does not total 100', () => {
    const under = A.speedShare('SF', null, { positionShares: { PG: 0, SG: 0, SF: 50, PF: 49, C: 0 } });
    const exact = A.speedShare('SF', null, { positionShares: { PG: 0, SG: 0, SF: 50 / 99, PF: 49 / 99, C: 0 } });
    expect(under).toBeCloseTo(exact, 12);
  });

  // The half of this that is not a refinement: the size term is a deviation
  // from a position's average BUILD, and with shares that baseline is the same
  // blend as the centre. A stretch big who is exactly the average of the two
  // builds he splits his minutes between gets no size adjustment at all.
  it('blends the SIZE baseline as well as the centre', () => {
    const shares = { PG: 0, SG: 0, SF: 0, PF: 50, C: 50 };
    const build = {
      inches: (A.POSITION_SIZE.PF.inches + A.POSITION_SIZE.C.inches) / 2,
      weight: (A.POSITION_SIZE.PF.weight + A.POSITION_SIZE.C.weight) / 2,
    };
    expect(A.speedShare('PF', build, { positionShares: shares })).toBeCloseTo(
      (A.POSITION_SPEED_SHARE.PF + A.POSITION_SPEED_SHARE.C) / 2,
      12
    );
    // The label-only rule has to measure the same player against a power
    // forward's build ALONE, so it reads a perfectly ordinary PF/C build as
    // oversized and docks him for it — from a power forward's centre, which is
    // the wrong origin to dock him from. It lands between the two answers and
    // agrees with neither: too big to be a PF, and credited as one anyway.
    const labelOnly = A.speedShare('PF', build);
    expect(labelOnly).toBeLessThan(A.POSITION_SPEED_SHARE.PF);
    expect(labelOnly).toBeGreaterThan((A.POSITION_SPEED_SHARE.PF + A.POSITION_SPEED_SHARE.C) / 2);
  });

  it('still sums to exactly the budget for every blend', () => {
    const blends = [
      { PG: 100, SG: 0, SF: 0, PF: 0, C: 0 },
      { PG: 46, SG: 52, SF: 2, PF: 0, C: 0 },
      { PG: 20, SG: 20, SF: 20, PF: 20, C: 20 },
      { PG: 0, SG: 0, SF: 1, PF: 40, C: 60 },
    ];
    for (let total = 2; total <= 40; total += 1) {
      for (const positionShares of blends) {
        for (const size of [null, { inches: 68, weight: 160 }, { inches: 88, weight: 300 }]) {
          const { speed, power } = A.splitSpeedPower(total, 'SF', A.POSITION_SPEED_SHARE, {
            positionShares,
            size,
          });
          expect(speed + power).toBe(total);
          expect(speed).toBeGreaterThanOrEqual(1);
          expect(power).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  // Every degradation path, because three sets depend on one of them: the WNBA
  // has no play-by-play page at all, and any player the table misses has to
  // keep producing the card he produced before.
  it('DEGRADES to the label for empty, zeroed or unusable shares', () => {
    const labelOnly = A.splitSpeedPower(22, 'SG');
    for (const positionShares of [
      null,
      undefined,
      {},
      { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 },
      { PG: NaN, SG: NaN, SF: NaN, PF: NaN, C: NaN },
      { GUARD: 100 },
    ]) {
      expect(A.splitSpeedPower(22, 'SG', A.POSITION_SPEED_SHARE, { positionShares })).toEqual(
        labelOnly
      );
    }
  });

  // A blend beats a missing label: a player with no recognised position but a
  // real measurement should be split on the measurement, not on 50/50.
  it('uses the shares even when the label is unrecognised', () => {
    expect(A.speedShare('DH', null, { positionShares: { PG: 0, SG: 0, SF: 0, PF: 0, C: 100 } })).toBeCloseTo(
      A.POSITION_SPEED_SHARE.C,
      12
    );
    expect(A.speedShare('DH', null)).toBe(A.DEFAULT_SPEED_SHARE);
  });

  it('falls back to the un-sized centre when a weighted position has no measured build', () => {
    const shares = { PG: 0, SG: 0, SF: 0, PF: 50, C: 50 };
    const centre = (A.POSITION_SPEED_SHARE.PF + A.POSITION_SPEED_SHARE.C) / 2;
    expect(
      A.speedShare('PF', { inches: 84, weight: 260 }, {
        positionShares: shares,
        positionSize: { PF: A.POSITION_SIZE.PF },
      })
    ).toBeCloseTo(centre, 12);
  });
});

describe('splitFromCalibration — the one entry point generation uses', () => {
  const SIZE = { inches: 80, weight: 230 };
  const SHARES = { PG: 46, SG: 52, SF: 2, PF: 0, C: 0 };
  const CAL = {
    positionSpeedShare: A.POSITION_SPEED_SHARE,
    positionSize: A.POSITION_SIZE,
    sizeSpeedShare: A.SIZE_SPEED_SHARE,
    sharePositionSpeedShare: A.SHARE_POSITION_SPEED_SHARE,
    sharePositionSize: A.SHARE_POSITION_SIZE,
    shareSizeSpeedShare: A.SHARE_SIZE_SPEED_SHARE,
  };

  // The failure this entry point exists to make impossible: the label constants
  // and the share constants are different numbers for the same idea, and a call
  // site that mixed them would compress or stretch the whole set's distribution
  // of splits without erroring anywhere.
  it('pairs each rule with its OWN fitted constants', () => {
    const label = A.splitFromCalibration(28, {
      pos: 'PG', size: SIZE, positionShares: SHARES, calibration: CAL, rule: A.SPLIT_RULES.labelSize,
    });
    const shares = A.splitFromCalibration(28, {
      pos: 'PG', size: SIZE, positionShares: SHARES, calibration: CAL, rule: A.SPLIT_RULES.sharesSize,
    });
    expect(label).toEqual(
      A.splitSpeedPower(28, 'PG', A.POSITION_SPEED_SHARE, {
        size: SIZE,
        positionSize: A.POSITION_SIZE,
        sizeModel: A.SIZE_SPEED_SHARE,
      })
    );
    expect(shares).toEqual(
      A.splitSpeedPower(28, 'PG', A.SHARE_POSITION_SPEED_SHARE, {
        size: SIZE,
        positionShares: SHARES,
        positionSize: A.SHARE_POSITION_SIZE,
        sizeModel: A.SHARE_SIZE_SPEED_SHARE,
      })
    );
  });

  it('ignores the inputs a rule does not declare', () => {
    for (const rule of [A.SPLIT_RULES.label, A.SPLIT_RULES.shares]) {
      const withSize = A.splitFromCalibration(28, { pos: 'PG', size: SIZE, positionShares: SHARES, calibration: CAL, rule });
      const without = A.splitFromCalibration(28, { pos: 'PG', positionShares: SHARES, calibration: CAL, rule });
      expect(withSize).toEqual(without);
    }
    for (const rule of [A.SPLIT_RULES.label, A.SPLIT_RULES.labelSize]) {
      const withShares = A.splitFromCalibration(28, { pos: 'PG', size: SIZE, positionShares: SHARES, calibration: CAL, rule });
      const without = A.splitFromCalibration(28, { pos: 'PG', size: SIZE, calibration: CAL, rule });
      expect(withShares).toEqual(without);
    }
  });

  // Three independent degradations, and the WNBA depends on two of them at once.
  it('degrades one step at a time', () => {
    for (const rule of Object.values(A.SPLIT_RULES)) {
      for (const calibration of [null, CAL, {}]) {
        for (const size of [null, SIZE]) {
          for (const positionShares of [null, SHARES]) {
            const { speed, power } = A.splitFromCalibration(24, { pos: 'SG', size, positionShares, calibration, rule });
            expect(speed + power).toBe(24);
            expect(speed).toBeGreaterThanOrEqual(1);
            expect(power).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });

  it('falls back to this file s constants when there is no calibration file', () => {
    expect(A.splitFromCalibration(28, { pos: 'PG', size: SIZE, calibration: null, rule: A.SPLIT_RULES.labelSize }))
      .toEqual(A.splitSpeedPower(28, 'PG', A.POSITION_SPEED_SHARE, { size: SIZE }));
  });

  // Conservation is what makes any of this a flavour change: the matchup matrix
  // established that Net Edge equals Speed+Power minus the field mean, so a
  // rule that redistributed the budget by even one point would be a balance
  // change wearing a flavour change's clothes.
  it('conserves the budget under every rule, for every input', () => {
    for (const rule of Object.values(A.SPLIT_RULES)) {
      for (let total = 2; total <= 40; total += 1) {
        const a = A.splitFromCalibration(total, { pos: 'C', size: SIZE, positionShares: SHARES, calibration: CAL, rule });
        const b = A.splitFromCalibration(total, { pos: 'C', calibration: CAL, rule });
        expect(a.speed + a.power).toBe(total);
        expect(b.speed + b.power).toBe(total);
      }
    }
  });

  it('declares an active rule that is one of the four on the menu', () => {
    expect(Object.values(A.SPLIT_RULES)).toContain(A.SPLIT_RULE);
    expect(A.SPLIT_RULES[A.SPLIT_RULE.name]).toBe(A.SPLIT_RULE);
  });

  // The share-fitted centres are WIDER at the wings than the label-fitted ones,
  // and they have to be: blending pulls every real player toward the middle, so
  // centres that were not spread by that much would compress the whole set.
  it('keeps the share-fitted centres wider than the label-fitted ones', () => {
    const labelSpread = A.POSITION_SPEED_SHARE.PG - A.POSITION_SPEED_SHARE.C;
    const shareSpread = A.SHARE_POSITION_SPEED_SHARE.PG - A.SHARE_POSITION_SPEED_SHARE.C;
    expect(shareSpread).toBeGreaterThan(labelSpread);
    for (const p of A.POSITIONS) {
      expect(A.SHARE_POSITION_SIZE[p]).toBeTruthy();
      expect(A.SHARE_POSITION_SPEED_SHARE[p]).toBeGreaterThan(A.SPEED_SHARE_BOUNDS.min);
      expect(A.SHARE_POSITION_SPEED_SHARE[p]).toBeLessThan(A.SPEED_SHARE_BOUNDS.max);
    }
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

  it('floors a negative or unusable salary, and no longer caps a large one', () => {
    expect(A.roundSalary(-500)).toBe(A.SALARY_MIN);
    expect(A.roundSalary(NaN)).toBe(A.SALARY_MIN);
    // NO CEILING. Salary is meant to represent what a card can do, and a cap
    // makes it stop doing that exactly where the differences matter -- the six
    // best cards all printed 1500 and became indistinguishable on price. The
    // 5500 ROSTER cap is the real constraint and is untouched.
    expect(A.SALARY_MAX).toBe(Infinity);
    expect(A.roundSalary(99999)).toBe(100000);
    expect(A.roundSalary(1930)).toBe(1930);
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
