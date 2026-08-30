import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  FEATURES,
  FEATURE_SETS,
  GAME_MINUTES,
  RIDGE_LAMBDA,
  TEAM_CONTEXT_FEATURES,
  WIN_SHARE_FEATURES,
  applyModel,
  centredFeatures,
  centringBasis,
  fitRidge,
  positionGroup,
  predict,
  rSquared,
  rmse,
  weightedMean,
} from './bpmModel.js';

const MODEL = JSON.parse(
  readFileSync(new URL('../../../card-data/generated/wnba-bpm-model.json', import.meta.url), 'utf8')
);

describe('positionGroup', () => {
  it('collapses to the three positions the WNBA lists, and only three', () => {
    // The NBA has five and the WNBA has three, so the NBA side of the fit is
    // collapsed to match. A model that learned a PG/SG distinction could never
    // evaluate it on a WNBA row.
    expect(['PG', 'SG', 'G', 'G-F', 'PG-SG'].map(positionGroup)).toEqual(['G', 'G', 'G', 'G', 'G']);
    expect(['C', 'C-F'].map(positionGroup)).toEqual(['C', 'C']);
    expect(['F', 'SF', 'PF', 'F-C', 'F-G'].map(positionGroup)).toEqual(['F', 'F', 'F', 'F', 'F']);
  });

  it('answers F for anything it does not recognise, rather than throwing', () => {
    expect(positionGroup(null)).toBe('F');
    expect(positionGroup('')).toBe('F');
  });
});

describe('GAME_MINUTES', () => {
  it('knows a WNBA game is forty minutes and an NBA game is forty-eight', () => {
    expect(GAME_MINUTES.wnba).toBe(40);
    expect(GAME_MINUTES.nba).toBe(48);
  });
});

describe('weightedMean', () => {
  it('weights by minutes, so a ten-minute cup of coffee barely counts', () => {
    const rows = [
      { v: 10, minutes: 2000 },
      { v: 0, minutes: 20 },
    ];
    expect(weightedMean(rows, r => r.v)).toBeCloseTo(9.9, 1);
  });

  it('ignores rows with no value and rows with no weight', () => {
    const rows = [
      { v: 4, minutes: 100 },
      { v: null, minutes: 100 },
      { v: 99, minutes: 0 },
    ];
    expect(weightedMean(rows, r => r.v)).toBe(4);
    expect(weightedMean([], r => r.v)).toBe(0);
  });
});

describe('the league centring', () => {
  const keys = ['per', 'tsPct'];
  const league = [
    { per: 10, tsPct: 0.5, minutes: 1000 },
    { per: 20, tsPct: 0.6, minutes: 1000 },
  ];

  it('puts the league average at zero, which is where BPM defines its own', () => {
    const basis = centringBasis(league, keys);
    expect(basis.per).toBe(15);
    expect(centredFeatures(league[0], basis, keys)[0]).toBe(-5);
  });

  it('gives two players in DIFFERENT leagues the same features when they are equally above their own', () => {
    // The whole transfer rests on this. A slow, low-scoring league and a fast
    // one produce different raw numbers for the same relative standing.
    const slow = [
      { per: 10, tsPct: 0.4, minutes: 1000 },
      { per: 20, tsPct: 0.5, minutes: 1000 },
    ];
    const fast = [
      { per: 14, tsPct: 0.5, minutes: 1000 },
      { per: 24, tsPct: 0.6, minutes: 1000 },
    ];
    const a = centredFeatures(slow[1], centringBasis(slow, keys), keys);
    const b = centredFeatures(fast[1], centringBasis(fast, keys), keys);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12));
  });

  it('reads a missing input as the league average rather than as zero', () => {
    const basis = centringBasis(league, keys);
    expect(centredFeatures({ per: null, tsPct: 0.55 }, basis, keys)[0]).toBe(0);
  });
});

describe('fitRidge', () => {
  it('recovers a known linear relationship', () => {
    const X = [[1, 2], [2, 1], [3, 4], [4, 3], [5, 7], [6, 5], [7, 9], [8, 6]];
    const y = X.map(r => 1 + 2 * r[0] - 0.5 * r[1]);
    const model = fitRidge(X, y, null, 1e-6);
    expect(model.intercept).toBeCloseTo(1, 2);
    expect(model.coef[0]).toBeCloseTo(2, 2);
    expect(model.coef[1]).toBeCloseTo(-0.5, 2);
  });

  it('returns coefficients in RAW units, so nothing about the target league leaks in', () => {
    // The same relationship with one column rescaled by 100 must come back with
    // that column's coefficient divided by 100 — i.e. the fit is standardised
    // internally and unstandardised on the way out. If the stored model were in
    // standardised units, applying it to the WNBA would divide WNBA features by
    // NBA standard deviations.
    const X = [[1, 2], [2, 1], [3, 4], [4, 3], [5, 7], [6, 5], [7, 9], [8, 6]];
    const y = X.map(r => 1 + 2 * r[0] - 0.5 * r[1]);
    const scaled = X.map(r => [r[0], r[1] * 100]);
    const a = fitRidge(X, y, null, 1e-9);
    const b = fitRidge(scaled, y, null, 1e-9);
    expect(b.coef[0]).toBeCloseTo(a.coef[0], 3);
    expect(b.coef[1] * 100).toBeCloseTo(a.coef[1], 3);
  });

  it('shrinks toward the mean as λ grows, instead of blowing up on collinearity', () => {
    // Two exactly duplicated columns — the shape trb100/orb100/drb100 and
    // ws/ows/dws actually have in the real design.
    const X = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]];
    const y = X.map(r => 3 * r[0]);
    const loose = fitRidge(X, y, null, 0.01);
    const tight = fitRidge(X, y, null, 100);
    expect(Number.isFinite(loose.coef[0])).toBe(true);
    const size = m => Math.abs(m.coef[0]) + Math.abs(m.coef[1]);
    expect(size(tight)).toBeLessThan(size(loose));
  });

  it('weights rows', () => {
    const X = [[0], [1], [1]];
    const y = [0, 1, 1];
    expect(fitRidge(X, y, [1, 1, 1], 1e-9).coef[0]).toBeCloseTo(1, 3);
    // A row weighted to nothing should not move the fit.
    const withNoise = fitRidge([...X, [2]], [...y, 100], [1, 1, 1, 1e-9], 1e-9);
    expect(withNoise.coef[0]).toBeCloseTo(1, 2);
  });

  it('has no opinion about an empty design', () => {
    expect(fitRidge([], [], null, 1)).toBeNull();
  });
});

describe('rSquared / rmse', () => {
  it('scores a perfect prediction at 1 and no error', () => {
    expect(rSquared([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    expect(rmse([1, 2, 3], [1, 2, 3])).toBeCloseTo(0, 6);
  });

  it('scores predicting the mean at 0', () => {
    expect(rSquared([1, 2, 3], [2, 2, 2])).toBeCloseTo(0, 6);
  });

  it('goes NEGATIVE for a prediction worse than the mean, rather than clamping', () => {
    expect(rSquared([1, 2, 3], [10, 10, 10])).toBeLessThan(0);
  });
});

describe('the feature sets', () => {
  it('never includes an input the WNBA pages do not carry', () => {
    // The entry requirement for FEATURES. DRB% is the one to watch: the NBA
    // advanced table has it, the WNBA's does not, and it would be very easy to
    // add without noticing.
    const all = new Set(Object.keys(FEATURES));
    expect(all.has('drbPct')).toBe(false);
    expect(all.has('vorp')).toBe(false);
    expect(all.has('bpm')).toBe(false);
    for (const keys of Object.values(FEATURE_SETS)) {
      for (const key of keys) expect(all.has(key), key).toBe(true);
    }
  });

  it('can build a set with no Win Shares in it, so its contribution is measurable', () => {
    for (const key of WIN_SHARE_FEATURES) {
      expect(FEATURE_SETS.noWinShares).not.toContain(key);
      expect(FEATURE_SETS.full).toContain(key);
    }
  });

  it('isolates team context, which is the only proxy for BPM\'s team adjustment', () => {
    for (const key of TEAM_CONTEXT_FEATURES) {
      expect(FEATURE_SETS.boxScore).not.toContain(key);
      expect(FEATURE_SETS.boxScoreTeam).toContain(key);
    }
    // Otherwise identical, so the gap between them measures exactly that.
    expect(FEATURE_SETS.boxScoreTeam).toEqual([
      ...FEATURE_SETS.boxScore,
      ...TEAM_CONTEXT_FEATURES,
    ]);
  });
});

describe('the fitted model that ships', () => {
  it('generalises out of sample well enough to prefer over a hand-made blend', () => {
    // The number the whole "fit a BPM equivalent" decision rests on, held out
    // on two NBA seasons the model never saw.
    expect(MODEL.targets.bpm.heldOutSeasonsR2).toBeGreaterThan(0.9);
    expect(MODEL.targets.obpm.heldOutSeasonsR2).toBeGreaterThan(0.9);
    // The defensive half is the weak one, and it is weak because the defensive
    // half of BPM is where the team adjustment does the most work.
    expect(MODEL.targets.dbpm.heldOutSeasonsR2).toBeGreaterThan(0.8);
    expect(MODEL.targets.dbpm.heldOutSeasonsR2).toBeLessThan(
      MODEL.targets.bpm.heldOutSeasonsR2
    );
  });

  it('beats the PER-plus-Win-Shares fallback it was measured against', () => {
    const fitted = MODEL.validation.byFeatureSet.full.bpm.heldOutSeasons.r2;
    const fallback = MODEL.validation.byFeatureSet.perWinShares.bpm.heldOutSeasons.r2;
    expect(fitted).toBeGreaterThan(fallback);
  });

  it('records what real BPM uses that it cannot', () => {
    expect(MODEL.missingVsRealBpm.join(' ')).toMatch(/team adjustment/i);
    expect(MODEL.missingVsRealBpm.join(' ')).toMatch(/DRB%/);
  });

  it('carries one coefficient per declared feature, per target', () => {
    for (const target of ['bpm', 'obpm', 'dbpm']) {
      expect(MODEL.targets[target].coef).toHaveLength(MODEL.features.length);
      expect(MODEL.targets[target].coef.every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(MODEL.targets[target].intercept)).toBe(true);
    }
  });

  it('was fitted with the λ the module declares', () => {
    expect(MODEL.fittedOn.ridgeLambda).toBe(RIDGE_LAMBDA);
  });
});

describe('applyModel', () => {
  const model = {
    features: ['per'],
    targets: {
      bpm: { intercept: 0, coef: [1] },
      obpm: { intercept: 0, coef: [0.5] },
      dbpm: { intercept: 0, coef: [0.5] },
    },
  };

  it('rates a row against the league it is given, not against itself', () => {
    const league = [
      { per: 10, minutes: 1000 },
      { per: 20, minutes: 1000 },
    ];
    const pool = [{ per: 20, minutes: 1000 }];
    // Against the whole league (mean 15) she is +5.
    expect(applyModel(model, pool, { basisRows: league })[0].bpm).toBe(5);
    // Against only herself she is average, which is the mistake basisRows exists
    // to prevent: "league average" has to mean the league.
    expect(applyModel(model, pool)[0].bpm).toBe(0);
  });

  it('predicts all three targets from one centring pass', () => {
    const out = applyModel(model, [{ per: 20, minutes: 1 }], {
      basisRows: [{ per: 10, minutes: 1 }, { per: 20, minutes: 1 }],
    });
    expect(out[0]).toEqual({ bpm: 5, obpm: 2.5, dbpm: 2.5 });
  });
});

describe('predict', () => {
  it('is an intercept plus a dot product, and tolerates a short vector', () => {
    expect(predict({ intercept: 1, coef: [2, 3] }, [1, 1])).toBe(6);
    expect(predict({ intercept: 1, coef: [2, 3] }, [1])).toBe(3);
  });
});
