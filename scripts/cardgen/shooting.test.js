import { describe, it, expect } from 'vitest';
import { shotCheck } from '../../src/game/engine.js';
import {
  LINE_CEIL,
  LINE_FLOOR,
  attemptsFromPer75,
  buildShootingLayer,
  compressBoost,
  compressShotLine,
  fitLinearMap,
  fitShrinkage,
  lineForSuccessRate,
  missRateForLine,
  rawLines,
  successRateForLine,
} from './shooting.js';

describe('the d20 line arithmetic', () => {
  // The engine is the authority: src/game/engine.js resolves `total >= line`,
  // so a 15 hits on 15..20. The rulebook's "beat your Shot Line" would be one
  // roll harder — a flat 5 points on every shot check in the game. These two
  // tests pin the file to the engine rather than to the prose.
  it('counts the same faces the engine counts as hits', () => {
    for (const line of [8, 12, 15, 18]) {
      const player = { shotLine: line, threePtBoost: 0, paintBoost: 0 };
      // Roll until every face has been seen, then ask which ones the ENGINE
      // called a hit. No bonus, so the total is the face.
      const hitting = new Set();
      const seen = new Set();
      for (let i = 0; i < 2000; i += 1) {
        const check = shotCheck(player, '3pt', 0, {});
        seen.add(check.die);
        if (check.hit) hitting.add(check.die);
      }
      expect(seen.size).toBe(20);
      expect(successRateForLine(line)).toBeCloseTo(hitting.size / 20, 10);
      expect(missRateForLine(line)).toBeCloseTo(1 - hitting.size / 20, 10);
      expect(Math.min(...hitting)).toBe(line);
    }
  });

  it('predicts the hit rate the engine actually produces', () => {
    const player = { shotLine: 15, threePtBoost: 0, paintBoost: 0 };
    // Drive the engine and compare the observed hit rate to the formula. A
    // mismatched convention shows up as a 5-point gap, outside this tolerance.
    let hits = 0;
    const trials = 40000;
    for (let i = 0; i < trials; i += 1) if (shotCheck(player, '3pt', 0, {}).hit) hits += 1;
    expect(hits / trials).toBeCloseTo(successRateForLine(15), 1.5);
  });

  it('turns a real conversion rate into the roll it starts hitting at', () => {
    // Wembanyama, 2025-26 actual: TS% 62.55, rim 73.12, three 34.86.
    expect(lineForSuccessRate(0.625489)).toBe(8);
    expect(lineForSuccessRate(0.731235)).toBe(6);
    expect(lineForSuccessRate(0.348571)).toBe(14);
  });

  it('round-trips a line through its own miss rate', () => {
    for (let line = LINE_FLOOR; line <= LINE_CEIL; line += 1) {
      expect(lineForSuccessRate(successRateForLine(line))).toBe(line);
    }
  });

  it('clamps a percentage outside [0, 1] instead of leaving the d20', () => {
    expect(lineForSuccessRate(1)).toBe(LINE_FLOOR);
    expect(lineForSuccessRate(0)).toBe(LINE_CEIL);
    expect(lineForSuccessRate(1.4)).toBe(LINE_FLOOR);
    expect(lineForSuccessRate(-0.2)).toBe(LINE_CEIL);
  });

  it('returns null for a missing percentage rather than a line of 21', () => {
    // A missing 3P% and a genuine 0% are different facts. Collapsing them makes
    // every player who never attempted a three the worst shooter in the league.
    expect(lineForSuccessRate(null)).toBeNull();
    expect(lineForSuccessRate(undefined)).toBeNull();
    expect(lineForSuccessRate(NaN)).toBeNull();
  });
});

describe('rawLines', () => {
  it('reproduces the worked Wembanyama example exactly', () => {
    const lines = rawLines({ tsPct: 0.625489, paintPct: 0.731235, threePct: 0.348571 });
    expect(lines).toMatchObject({ shotLine: 8, paintLine: 6, threeLine: 14 });
    expect(lines.paintGap).toBe(2);
    expect(lines.threeGap).toBe(-6);
  });

  it('leaves a gap null when either side of it is missing', () => {
    const lines = rawLines({ tsPct: 0.6, paintPct: 0.7, threePct: null });
    expect(lines.paintGap).toBe(2);
    expect(lines.threeGap).toBeNull();
    expect(lines.exactThreeStrength).toBeNull();
  });

  // The 3PT signal must not know anything about TS%: that is exactly the
  // self-cancelling the boost used to suffer from, since TS% contains the threes.
  it('reads three-point strength off the three-point line alone', () => {
    const shooter = rawLines({ tsPct: 0.45, paintPct: 0.5, threePct: 0.42 });
    const complete = rawLines({ tsPct: 0.68, paintPct: 0.75, threePct: 0.42 });
    expect(shooter.exactThreeStrength).toBeCloseTo(complete.exactThreeStrength, 10);
    // ...and it rises with the percentage, so a better shooter scores higher.
    expect(rawLines({ tsPct: 0.5, paintPct: 0.5, threePct: 0.44 }).exactThreeStrength).toBeGreaterThan(
      shooter.exactThreeStrength
    );
  });
});

describe('attemptsFromPer75', () => {
  it('scales a per-75 rate by the possessions the minutes imply', () => {
    // 1865.74 minutes at 99 possessions per 48 is 3848 possessions; 6.71 threes
    // per 75 of them is about 344 attempts.
    expect(attemptsFromPer75(6.71184, 1865.74)).toBeCloseTo(344.4, 0);
  });

  it('returns zero rather than NaN for a player with no minutes or no rate', () => {
    expect(attemptsFromPer75(6.7, 0)).toBe(0);
    expect(attemptsFromPer75(null, 1000)).toBe(0);
    expect(attemptsFromPer75(6.7, null)).toBe(0);
  });
});

describe('fitShrinkage', () => {
  /** A pool with a known true spread, sampled at a known volume. */
  const pool = (trueSpread, n, count = 200) =>
    Array.from({ length: count }, (_, i) => ({
      pct: 0.35 + trueSpread * ((i / (count - 1)) * 2 - 1),
      n,
    }));

  it('shrinks a noisier stat harder than a stabler one', () => {
    const noisy = fitShrinkage(pool(0.02, 200));
    const stable = fitShrinkage(pool(0.12, 200));
    expect(noisy.k).toBeGreaterThan(stable.k);
  });

  it('pulls a low-volume outlier most of the way back to the league mean', () => {
    const fit = fitShrinkage([...pool(0.06, 300), { pct: 0.0, n: 5 }]);
    const adjusted = fit.apply(0.0, 5);
    expect(adjusted).toBeGreaterThan(0.3);
    expect(adjusted).toBeLessThan(fit.mean);
  });

  it('barely moves a high-volume player', () => {
    const fit = fitShrinkage(pool(0.06, 300));
    expect(fit.apply(0.44, 600)).toBeCloseTo(0.44, 1);
  });

  // A player with no attempts has no evidence at all, so the only defensible
  // answer is the league mean. Returning his 0-for-0 "percentage" would make
  // every non-shooter the worst shooter in the league.
  it('returns the league mean for a player with no attempts', () => {
    const fit = fitShrinkage(pool(0.06, 300));
    expect(fit.apply(0, 0)).toBeCloseTo(fit.mean, 10);
    expect(fit.apply(null, 0)).toBeCloseTo(fit.mean, 10);
  });

  it('does not divide by zero when sampling noise explains the whole spread', () => {
    const fit = fitShrinkage(Array.from({ length: 100 }, () => ({ pct: 0.35, n: 60 })));
    expect(Number.isFinite(fit.k)).toBe(true);
    expect(fit.k).toBeGreaterThan(0);
  });

  it('weights the league mean by attempts, not by player', () => {
    // One 1-for-1 must not drag the mean the way a 400-attempt shooter can.
    const fit = fitShrinkage([{ pct: 1, n: 1 }, { pct: 0.3, n: 399 }]);
    expect(fit.mean).toBeCloseTo(0.3018, 3);
  });
});

describe('fitLinearMap', () => {
  const target = { mean: 15.265, sd: 1.288, min: 12, max: 18 };

  it('maps the pool mean to the target mean and one pool sd to one target sd', () => {
    const map = fitLinearMap([8, 9, 9, 10, 11], target);
    expect(map.apply(map.poolMean)).toBeCloseTo(target.mean, 10);
    expect(map.apply(map.poolMean + map.poolSd)).toBeCloseTo(target.mean + target.sd, 10);
  });

  // The whole reason for an affine map rather than a rank/quantile one: the
  // user rejected rank mapping for the Speed/Power budget because it discarded
  // real gaps between players.
  it('preserves relative spacing between players', () => {
    const map = fitLinearMap([5, 8, 9, 10, 12], target);
    const [a, b, c] = [5, 9, 12].map(v => map.apply(v));
    expect((b - a) / (c - b)).toBeCloseTo((9 - 5) / (12 - 9), 10);
  });

  it('does not divide by zero on a pool with no spread', () => {
    const map = fitLinearMap([9, 9, 9], target);
    expect(map.apply(9)).toBe(target.mean);
    expect(map.scale).toBe(0);
  });
});

describe('compressShotLine', () => {
  const map = fitLinearMap([5, 7, 8, 9, 9, 10, 11, 12], {
    mean: 15.265,
    sd: 1.288,
    min: 12,
    max: 18,
  });

  it('keeps the ordering of the raw lines', () => {
    const lines = [5, 8, 9, 11, 12].map(v => compressShotLine(v, map));
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
  });

  it('lands inside the finished set is own range', () => {
    for (let raw = 1; raw <= 21; raw += 1) {
      const line = compressShotLine(raw, map);
      expect(line).toBeGreaterThanOrEqual(12);
      expect(line).toBeLessThanOrEqual(18);
    }
  });
});

describe('compressBoost', () => {
  const shape = { scale: 1.2, poolMean: -4.5, deadband: 1, min: -5, max: 5 };

  // The systematic offset is the whole problem: every player in the league
  // shoots worse from three than his own TS%, so an uncentred gap would give the
  // entire pool the same large negative boost, which is a rule change and not a
  // modifier.
  it('gives a league-average shooter no boost at all', () => {
    expect(compressBoost(-4.5, shape)).toBe(0);
  });

  it('rewards a player better than the league at that spot, and vice versa', () => {
    expect(compressBoost(-1.5, shape)).toBeGreaterThan(0);
    expect(compressBoost(-8, shape)).toBeLessThan(0);
  });

  it('holds the deadband open so a legitimate +1 can still exist', () => {
    // A deadband applied after the scaling instead of before would leave a hole
    // where +1 should be — nothing lands between the band edge and 1.
    const wide = { ...shape, deadband: 0.6 };
    const produced = new Set(
      Array.from({ length: 200 }, (_, i) => compressBoost(-6.5 + i * 0.02, wide))
    );
    expect(produced.has(1)).toBe(true);
    expect(produced.has(-1)).toBe(true);
  });

  it('clamps to the bounds the finished set actually used', () => {
    expect(compressBoost(20, shape)).toBe(5);
    expect(compressBoost(-40, shape)).toBe(-5);
  });

  it('returns no modifier for a missing gap', () => {
    expect(compressBoost(null, shape)).toBe(0);
    expect(compressBoost(NaN, shape)).toBe(0);
  });
});

describe('buildShootingLayer — the 3PT boost', () => {
  const shotLineTarget = { mean: 15.2624, sd: 1.289, min: 12, max: 18 };
  /** Enough volume that the shrinkage barely moves anybody. */
  const shooter = (tsPct, threePct) => ({
    tsPct,
    paintPct: 0.6,
    threePct,
    paintAttempts: 400,
    threeAttempts: 500,
  });

  // The four players from the bug report, with their real 2025-26 numbers. The
  // old rule handed Herbert Jones +2 on 30.9% and Stephen Curry -1 on 39.3%,
  // because Curry's threes inflated the TS% his own baseline was built from.
  const pool = [
    shooter(0.647, 0.393), // Curry
    shooter(0.636, 0.417), // Duncan Robinson
    shooter(0.547, 0.383), // Klay Thompson
    shooter(0.49, 0.309), // Herbert Jones
    // Filler, so the pool has a league to be measured against.
    ...Array.from({ length: 40 }, (_, i) => shooter(0.5 + i * 0.005, 0.3 + i * 0.004)),
  ];

  const build = () =>
    buildShootingLayer(pool, { shotLineTarget, three: { targetSd: 1.5118, deadband: 1.35 } });

  it('puts the better three-point shooters above the worse one', () => {
    const [curry, robinson, klay, jones] = build().players.map(p => p.threePtBoost);
    expect(curry).toBeGreaterThan(jones);
    expect(robinson).toBeGreaterThan(jones);
    expect(robinson).toBeGreaterThanOrEqual(curry);
    expect(klay).toBeGreaterThan(jones);
  });

  it('gives the same 3P% the same EFFECTIVE three-point line, whatever the TS%', () => {
    // THE INVARIANT MOVED, and it moved to the right quantity. It used to be
    // "same 3P% -> same boost", which sounds like independence and is not: the
    // number that decides a three-point check is `shotLine - boost`, and
    // holding the BOOST equal while the Shot Lines differ makes the better
    // finisher the better three-point shooter. That is exactly how Jakob
    // Poeltl -- .644 TS% on dunks, 0.4 threes per 100 -- ended up converting
    // threes as often as Stephen Curry.
    //
    // So the boost is now sized to land the effective line where 3P% says it
    // belongs, and these two must differ in BOOST by exactly what they differ
    // in Shot Line.
    const twins = [shooter(0.68, 0.4), shooter(0.47, 0.4), ...pool];
    const built = buildShootingLayer(twins, {
      shotLineTarget,
      three: { targetSd: 1.5118, deadband: 1.35 },
    });
    const [a, b] = built.players;
    expect(a.shotLine).toBeLessThan(b.shotLine); // still a better overall shooter
    expect(a.shotLine - a.threePtBoost).toBe(b.shotLine - b.threePtBoost);
  });

  it('scales the boost to the finished set’s own spread, not the Shot Line’s', () => {
    const built = build();
    expect(built.threeShape.scale).toBeCloseTo(1.5118 / built.threeStrengthSd, 6);
    expect(built.threeShape.scale).not.toBeCloseTo(built.map.scale, 3);
  });

  it('falls back to the Shot Line scale when no target spread is calibrated', () => {
    const built = buildShootingLayer(pool, { shotLineTarget });
    expect(built.threeShape.scale).toBeCloseTo(built.map.scale, 10);
  });

  it('leaves the paint boost on the Shot Line scale', () => {
    const built = build();
    expect(built.paintShape.scale).toBeCloseTo(built.map.scale, 10);
  });
});
