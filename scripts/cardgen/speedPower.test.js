import { describe, it, expect } from 'vitest';
import {
  REFERENCE_TOTALS,
  buildSpeedPowerTotals,
  compositeScores,
  mapToReferenceScale,
  measureReferenceTotals,
} from './speedPower.js';
import { zScorer } from './attributes.js';

const player = (name, epmOff, epmDef, ewinsPerGame) => ({
  name,
  epm: epmOff + epmDef,
  epmOff,
  epmDef,
  ewinsPerGame,
});

/** A pool wide enough that z-scores mean something. */
const pool = [
  player('Star', 5, 4, 0.25),
  player('Good', 2, 1, 0.13),
  player('Average', 0, 0, 0.05),
  player('Below', -2, -1, 0.02),
  player('Fringe', -4, -2, -0.01),
];

describe('zScorer', () => {
  it('centres and scales by the pool', () => {
    const z = zScorer([1, 2, 3]);
    expect(z(2)).toBeCloseTo(0, 10);
    expect(z(3)).toBeGreaterThan(0);
  });

  it('returns 0 rather than dividing by zero on a flat pool', () => {
    expect(zScorer([4, 4, 4])(4)).toBe(0);
    expect(zScorer([1, 2, 3])(null)).toBe(0);
  });
});

describe('compositeScores', () => {
  it('orders players the way their impact does', () => {
    const scores = compositeScores(pool);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  // The OFF/DEF term used to up-weight defence inside the budget. It is gone on
  // purpose: a defence-first player is compensated through Def Boost, which is
  // derived from the same DEF number, so paying him inside the budget as well
  // paid him twice. Two players with the same EPM and the same playing time now
  // get the same budget however that EPM is split.
  it('does not separate two players whose EPM is split differently', () => {
    const split = [
      player('Offence', 4, 0, 0.12),
      player('Defence', 0, 4, 0.12),
      player('Nobody', 0, 0, 0.02),
      player('Spread', -4, -4, -0.01),
    ];
    const scores = compositeScores(split);
    expect(scores[0]).toBeCloseTo(scores[1], 10);
  });

  it('separates two players with equal EPM by playing time', () => {
    const same = [
      player('Starter', 2, 1, 0.2),
      player('Reserve', 2, 1, 0.05),
      player('Anchor', 0, 0, 0.05),
      player('Floor', -3, -2, 0),
    ];
    const scores = compositeScores(same);
    expect(scores[0]).toBeGreaterThan(scores[1]);
  });

  it('weight 0 reduces the composite to EPM alone', () => {
    const scores = compositeScores(pool, { weight: 0 });
    const z = zScorer(pool.map(p => p.epm));
    expect(scores).toEqual(pool.map(p => z(p.epm)));
  });
});

describe('mapToReferenceScale', () => {
  const reference = { mean: 17.7951, sd: 4.0808, min: 10, max: 28 };

  it('lands the pool on the reference mean and spread', () => {
    const composites = Array.from({ length: 200 }, (_, i) => (i - 100) / 40);
    const totals = mapToReferenceScale(composites, reference);
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    expect(mean).toBeCloseTo(reference.mean, 0);
    expect(Math.min(...totals)).toBeGreaterThanOrEqual(reference.min);
    expect(Math.max(...totals)).toBeLessThanOrEqual(reference.max);
  });

  // The user rejected rank/quantile mapping precisely because it collapsed real
  // gaps: two players with visibly different composites were forced into the
  // same bucket because only so many top slots existed. A magnitude map keeps
  // the ratio of the gaps.
  it('preserves the ratio of gaps between players', () => {
    const totals = mapToReferenceScale([-2, 0, 1, 4], reference);
    // -2 -> 0 is twice 0 -> 1, and 0 -> 1 is a third of 1 -> 4, before rounding.
    expect(totals[1] - totals[0]).toBeGreaterThan(totals[2] - totals[1]);
    expect(totals[3] - totals[2]).toBeGreaterThan(totals[2] - totals[1]);
  });

  // A z-map is scale-invariant, so only a SKEWED pool can push anyone past the
  // ends — one outlier against a tight field, which is exactly the shape the
  // real EPM distribution has at the top.
  it('clips rather than leaving the scale the finished set used', () => {
    const flat = Array.from({ length: 20 }, () => 0);
    expect(Math.max(...mapToReferenceScale([...flat, 12], reference))).toBe(28);
    expect(Math.min(...mapToReferenceScale([...flat, -12], reference))).toBe(10);
  });

  it('does not divide by zero when every composite is identical', () => {
    expect(mapToReferenceScale([1, 1, 1], reference)).toEqual([18, 18, 18]);
  });

  describe('the tapered tail', () => {
    // knee 22, ceiling 28, and one card in twenty allowed to reach the ceiling.
    const shaped = { ...reference, p90: 22, ceilingShare: 0.01 };
    // A dense body plus a thin string of outliers — the shape the EPM curve has.
    const body = Array.from({ length: 200 }, (_, i) => (i - 100) / 100);
    const composites = [...body, 1.6, 1.9, 2.3, 2.8, 3.4, 4.4];

    it('stops the clamp swallowing every outlier into the ceiling', () => {
      const clipped = mapToReferenceScale(composites, reference);
      const tapered = mapToReferenceScale(composites, shaped);
      const atCeiling = totals => totals.filter(t => t === reference.max).length;
      expect(atCeiling(clipped)).toBeGreaterThan(atCeiling(tapered));
      expect(atCeiling(tapered)).toBeGreaterThan(0);
    });

    it('leaves every card below the knee exactly where it was', () => {
      const clipped = mapToReferenceScale(composites, reference);
      const tapered = mapToReferenceScale(composites, shaped);
      clipped.forEach((v, i) => {
        if (v < shaped.p90) expect(tapered[i]).toBe(v);
      });
    });

    // The complaint the taper exists for: Curry one step below Shai despite
    // sitting with the body of the league. A clamp flattens the outliers into
    // each other; the taper keeps daylight between them and the cluster.
    it('leaves daylight between the outliers and the top of the cluster', () => {
      const tapered = mapToReferenceScale(composites, shaped);
      const clipped = mapToReferenceScale(composites, reference);
      const clusterTop = totals => Math.max(...totals.slice(0, body.length));
      expect(Math.max(...tapered) - clusterTop(tapered)).toBeGreaterThan(
        Math.max(...clipped) - clusterTop(clipped)
      );
    });

    it('keeps the tail monotone and ordered by composite', () => {
      const tail = mapToReferenceScale(composites, shaped).slice(-6);
      expect(tail).toEqual([...tail].sort((a, b) => a - b));
      expect(tail[5]).toBeGreaterThan(tail[0]);
    });

    it('never stretches a tail that already fits inside the ceiling', () => {
      const tight = Array.from({ length: 40 }, (_, i) => (i - 20) / 40);
      const totals = mapToReferenceScale(tight, shaped);
      expect(Math.max(...totals)).toBeLessThan(reference.max);
    });
  });
});

describe('measureReferenceTotals', () => {
  it('measures speed+power off finished cards', () => {
    const measured = measureReferenceTotals([
      { speed: 10, power: 10 },
      { speed: 5, power: 5 },
      { speed: 8, power: 7 },
    ]);
    expect(measured).toMatchObject({ min: 10, max: 20, n: 3 });
    expect(measured.mean).toBeCloseTo(15, 4);
  });

  // The gitignored CSV is absent in a public checkout; the caller falls back to
  // the committed constants, so this has to say "nothing" rather than zeros.
  it('returns null when there are no cards to measure', () => {
    expect(measureReferenceTotals(null)).toBeNull();
    expect(measureReferenceTotals([])).toBeNull();
  });

  it('agrees with the committed fallback constants', () => {
    const measured = measureReferenceTotals([
      { speed: 18, power: 10 },
      { speed: 7, power: 20 },
    ]);
    expect(Object.keys(measured)).toEqual(expect.arrayContaining(Object.keys(REFERENCE_TOTALS)));
  });
});

describe('buildSpeedPowerTotals', () => {
  const poolPlayers = [
    { name: 'Star', team: 'AAA', pos: 'PG' },
    { name: 'Average', team: 'BBB', pos: 'C' },
    { name: 'Fringe', team: 'CCC', pos: 'SF' },
    { name: 'Ron Holland', team: 'DET', pos: 'SG' },
  ];
  const actual = [...pool, player('Ronald Holland II', 1, 0, 0.06)];

  it('gives every pool player a budget inside the reference range', () => {
    const { records } = buildSpeedPowerTotals({ pool: poolPlayers, actual });
    expect(records).toHaveLength(4);
    for (const r of records) {
      expect(r.speedPowerTotal).toBeGreaterThanOrEqual(REFERENCE_TOTALS.min);
      expect(r.speedPowerTotal).toBeLessThanOrEqual(REFERENCE_TOTALS.max);
    }
  });

  // A fuzzy matcher that guesses wrong hands a player somebody else's stat line
  // and nothing downstream notices, so the alias list is explicit.
  it('resolves the one name the stat source spells differently', () => {
    const { records, missing } = buildSpeedPowerTotals({ pool: poolPlayers, actual });
    expect(missing).toEqual([]);
    expect(records.find(r => r.name === 'Ron Holland').epm).toBe(1);
  });

  it('reports a player with no stat line instead of silently dropping him', () => {
    const { records, missing } = buildSpeedPowerTotals({
      pool: [...poolPlayers, { name: 'Nobody At All', team: 'ZZZ', pos: 'PF' }],
      actual,
    });
    expect(missing).toEqual(['Nobody At All']);
    expect(records).toHaveLength(5);
    expect(records.find(r => r.name === 'Nobody At All').epm).toBeNull();
  });

  it('keeps the row covering the most games when a player was traded', () => {
    const traded = [
      { ...player('Star', 1, 1, 0.1), games: 20 },
      { ...player('Star', 5, 4, 0.25), games: 70 },
      ...actual.slice(1),
    ];
    const { records } = buildSpeedPowerTotals({ pool: poolPlayers, actual: traded });
    expect(records.find(r => r.name === 'Star').epm).toBe(9);
  });

  it('sorts by composite, best first', () => {
    const { records } = buildSpeedPowerTotals({ pool: poolPlayers, actual });
    expect(records.map(r => r.name)).toEqual(['Star', 'Ron Holland', 'Average', 'Fringe']);
  });
});
