// Fits every generation parameter against the FINISHED card set, and writes them
// to card-data/generated/card-calibration.json.
//
//   node scripts/cardgen/calibrateAttributes.js
//
// WHY THIS IS A SEPARATE STEP FROM GENERATION. Calibration needs
// `card-data/source-recovered/Final Cards.csv`, which is gitignored — the repo is
// public and that spreadsheet is not. Generation must not need it. So the fit
// runs here, its output is committed, and generateCards.js reads the committed
// numbers. A checkout without the CSV can still regenerate every card; it just
// cannot re-fit.
//
// WHAT "FIT AGAINST THE FINISHED SET" BUYS. Every parameter below has the same
// ground truth: 283 real cards a person made and shipped. That is a much better
// target than any principle argued from first principles, and it is the only
// honest way to approach the layer memory/shooting_attributes_methodology.md says
// was hand-calibrated and is not recoverable. Nothing here claims to have found
// the original rules. What it claims is a measured error against them, printed
// on every run and stored in the output.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { loadReferenceCards, chartExpectedValue } from './referenceCards.js';
import { reconcileBands } from './generate.js';
import { enforceZeroFloor } from './zeroFloor.js';
import * as V from './variance.js';
import * as A from './attributes.js';
import { REFERENCE_STATS_SEASON } from './fetchCalibrationData.js';

export const CALIBRATION_FILE = path.join(
  REPO_ROOT,
  'card-data',
  'generated',
  'card-calibration.json'
);

const CHART_STATS = V.CHART_STATS;

/** Indexes rows by matching key, keeping the row covering the most games. */
function indexByName(rows) {
  const m = new Map();
  for (const r of rows ?? []) {
    const k = normalizeName(r.name);
    const prev = m.get(k);
    if (!prev || (r.games ?? 0) > (prev.games ?? 0)) m.set(k, r);
  }
  return m;
}

/**
 * Joins finished cards to the season stats of the players who earned them.
 *
 * The reference season is 2024-25 — the season BEFORE the set they produced, the
 * same one-season offset src/cards/sets.js documents for the set being built now.
 */
export function joinReferenceRows({ cards, perGame, perPoss, advanced }) {
  const pg = indexByName(perGame);
  const pp = indexByName(perPoss);
  const ad = indexByName(advanced);
  const rows = [];
  for (const card of cards) {
    const k = normalizeName(card.name);
    const g = pg.get(k);
    const p = pp.get(k);
    const a = ad.get(k);
    if (!g || !p || !a) continue;
    const row = {
      card,
      pos: g.pos,
      mpg: g.mpg,
      games: g.games,
      pts100: p.pts100,
      trb100: p.trb100,
      ast100: p.ast100,
      fg3a100: p.fg3a100,
      fg2a100: p.fg2a100,
      fta100: p.fta100,
      fgPct3: p.fgPct3,
      fgPct2: p.fgPct2,
      ftPct: p.ftPct,
      tsPct: a.tsPct,
      usgPct: a.usgPct,
      fg3aRate: a.fg3aRate,
      dbpm: a.dbpm,
    };
    // A missing rate is a zero here, not a dropped player: the alternative is
    // silently narrowing the fit sample to the players with complete rows.
    for (const key of Object.keys(row)) {
      if (key !== 'card' && key !== 'pos' && !Number.isFinite(row[key])) row[key] = 0;
    }
    rows.push(row);
  }
  return rows;
}

// --- chart level ------------------------------------------------------------

const per100Of = row => ({ pts: row.pts100, reb: row.trb100, ast: row.ast100 });

/**
 * A generated chart's tiers, in the open-topped shape chartExpectedValue reads.
 *
 * DELIBERATELY WITHOUT the zero floor, even though the shipped cards get it.
 *
 * The floor is a DESIGN RULE laid on top of the statistics (design doc section
 * 3: a natural 1 is unconditionally 0/0/0), not part of the derivation. Fitting
 * the level against floored charts makes the level quietly compensate for it —
 * the three lowest rolls stop scoring, so every other band gets inflated until
 * the total comes back. Measured, that was +0.83 points on the bottom band and a
 * set whose top tiers ran a full notch above the printed ones. The floor is
 * meant to COST the card something; a calibration that hands the cost straight
 * back has quietly repealed the rule while appearing to apply it.
 *
 * So the statistical target is the unfloored chart, and the floor is applied
 * afterwards, where its effect is real and visible.
 */
function toComparableChart(bands) {
  return reconcileBands(bands).map((t, i, all) => ({
    lo: t.lo,
    hi: i === all.length - 1 ? null : t.hi,
    pts: t.pts,
    reb: t.reb,
    ast: t.ast,
  }));
}

/**
 * Fits the chart LEVEL, then corrects it.
 *
 * Two stages because the relationship is not linear. Stage one fits
 * `publishedEV / T` against minutes as a power law — that sets the SLOPE, how
 * chart size varies with playing time. Stage two corrects the per-stat scale by
 * iteration, because two things bend the mapping from "mean of v" to "expected
 * value per roll" and neither has a closed form:
 *
 *  - Five band magnitudes are rounded to integers. At Jokic's scoring level that
 *    is a rounding error; at a centre's 1.5 assists a night it is the difference
 *    between a chart of zeros and a chart of ones.
 *  - bands.js lays five bands across 25 roll slots, while the printed cards lay
 *    them across 20 with an open "21+" top tier a d20 cannot reach unaided. So a
 *    generated chart puts real probability on its top tier where a printed one
 *    puts none. (memory/scoring_chart_methodology.md records that the original
 *    boundary rule was never reproduced; this is that gap showing up as a
 *    number.) The per-stat scale absorbs it.
 *
 * The correction targets zero BIAS rather than a median ratio: a median ratio
 * leaves a systematic overshoot on the low-count stats, where the distribution
 * of ratios is strongly skewed, and a whole pool of assist charts reading one
 * notch high is exactly the kind of error that is invisible per card and obvious
 * across a set.
 */
export const LEVEL_SCALE_ITERATIONS = 4;

export function fitChartLevel(rows, shape) {
  const usable = rows.filter(r => r.card.chart.length === 5 && r.mpg > 0);
  const points = [];
  for (const row of usable) {
    const per100 = per100Of(row);
    for (const stat of CHART_STATS) {
      const T = V.per4MinFromPer100(per100[stat]);
      const ev = chartExpectedValue(row.card.chart, stat);
      if (T > 0 && ev > 0) points.push({ mpg: row.mpg, ratio: ev / T });
    }
  }
  const level = V.fitLevel(points);

  const levelScale = Object.fromEntries(CHART_STATS.map(s => [s, 1]));
  for (let pass = 0; pass < LEVEL_SCALE_ITERATIONS; pass += 1) {
    const got = Object.fromEntries(CHART_STATS.map(s => [s, 0]));
    const want = Object.fromEntries(CHART_STATS.map(s => [s, 0]));
    for (const row of usable) {
      for (const stat of CHART_STATS) {
        const fit = { level: { ...level, a: level.a + Math.log(levelScale[stat]) }, shape };
        const bands = V.synthesizeBands({
          per100: per100Of(row),
          mpg: row.mpg,
          games: row.games,
          fit,
        });
        got[stat] += chartExpectedValue(toComparableChart(bands), stat) ?? 0;
        want[stat] += chartExpectedValue(row.card.chart, stat) ?? 0;
      }
    }
    for (const stat of CHART_STATS) {
      if (got[stat] > 0) levelScale[stat] *= want[stat] / got[stat];
    }
  }
  return { level, levelScale, points: points.length };
}

// --- positional split -------------------------------------------------------

export function measurePositionSpeedShare(rows) {
  const buckets = {};
  for (const row of rows) {
    const total = (row.card.speed ?? 0) + (row.card.power ?? 0);
    const pos = A.basePosition(row.pos);
    if (!pos || !total) continue;
    (buckets[pos] ??= []).push(row.card.speed / total);
  }
  const shares = {};
  const counts = {};
  for (const [pos, arr] of Object.entries(buckets)) {
    shares[pos] = Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(4));
    counts[pos] = arr.length;
  }
  return { shares, counts };
}

// --- shooting layer ---------------------------------------------------------

/**
 * The feature vectors, defined ONCE so calibration and generation cannot drift.
 *
 * Every input is either z-scored WITHIN ITS OWN POOL or expressed in units that
 * mean the same thing in both. That matters because the two pools come from
 * different providers — the fit reads Basketball-Reference's 2024-25 tables, and
 * generation reads dunksandthrees' 2025-26 payload — and a provider's systematic
 * offset in, say, usage would otherwise ride straight into every card.
 *
 * `pool` carries the pool-level constants a feature needs: the z-scorers and the
 * pool's mean 3P%/2P%, so "efficiency" always means "relative to this pool".
 */
export const shotLineFeatures = (p, pool) => [
  pool.z.ts(p.ts),
  pool.z.pts100(p.pts100),
  pool.z.usg(p.usg),
  pool.z.mpg(p.mpg),
];

export const threePtFeatures = (p, pool) => [
  // The verified anchor, in line units: how far the player's own 3-point
  // conversion sits from the line his card already asks him to beat.
  p.shotLine - A.impliedLine(p.fg3),
  p.fg3a100,
  p.fg3aRate,
  p.fg3a100 * (p.fg3 - pool.meanFg3),
];

export const paintFeatures = (p, pool) => [
  p.shotLine - A.impliedLine(p.fg2),
  p.fg2a100,
  p.fta100,
  p.fg2a100 * (p.fg2 - pool.meanFg2),
];

/**
 * Fits a boost's SHAPING — the deadband, the spread correction, and the bounds.
 *
 * Both corrections aim at reproducing the real DISTRIBUTION, not at minimising
 * error, and the objective says so: the pair is chosen to minimise the total
 * variation distance between the produced histogram and the real one.
 *
 * Error minimisation is a trap for this quantity. 90% of real Paint Boosts are
 * 0, so a model returning 0 for everybody "agrees" 90% of the time while saying
 * nothing at all, and a least-squares fit under-disperses by construction — its
 * job is to predict close to the mean when the target is noisy. Optimised that
 * way the first version of this produced 3PT Boosts running -1 to +2 where the
 * real set runs -5 to +5, sanding every specialist down into an average shooter.
 * That is the "player identity" pillar of the design philosophy being quietly
 * deleted, and no error metric would have flagged it.
 *
 *   deadband  How close to zero a prediction has to be to become no modifier at
 *             all. Applied to the raw prediction.
 *   spread    How far the survivors are pushed out from the mean.
 *
 * Bounds are the real set's own observed min and max, so a refit can never issue
 * a boost the game has never had. Agreement rates are still reported — they just
 * are not what is being optimised.
 */
export const DEADBAND_SEARCH = Array.from({ length: 41 }, (_, i) => i * 0.05);
export const SPREAD_SEARCH = Array.from({ length: 41 }, (_, i) => 0.6 + i * 0.05);

/** Sum of |produced share - real share| over every value. 0 is a perfect match. */
export function histogramDistance(produced, real) {
  const counts = values => values.reduce((h, v) => h.set(v, (h.get(v) ?? 0) + 1), new Map());
  const a = counts(produced);
  const b = counts(real);
  let distance = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    distance += Math.abs((a.get(key) ?? 0) / produced.length - (b.get(key) ?? 0) / real.length);
  }
  return distance;
}

export function fitBoostShaping(rows, predict, actual) {
  const preds = rows.map(predict);
  const reals = rows.map(actual);
  const mean = A.meanSd(reals).mean;
  const min = Math.min(...reals);
  const max = Math.max(...reals);

  let best = null;
  for (const deadband of DEADBAND_SEARCH) {
    for (const spread of SPREAD_SEARCH) {
      const values = preds.map(p => A.shapeBoost(p, { spread, mean, deadband, min, max }));
      const distance = histogramDistance(values, reals);
      if (!best || distance < best.distance) best = { deadband, spread, distance, values };
    }
  }

  const { values } = best;
  let exact = 0;
  let within1 = 0;
  const hist = {};
  values.forEach((v, i) => {
    hist[v] = (hist[v] ?? 0) + 1;
    if (v === reals[i]) exact += 1;
    if (Math.abs(v - reals[i]) <= 1) within1 += 1;
  });
  return {
    spread: Number(best.spread.toFixed(4)),
    mean: Number(mean.toFixed(4)),
    deadband: Number(best.deadband.toFixed(2)),
    min,
    max,
    quality: {
      exactPct: (100 * exact) / values.length,
      within1Pct: (100 * within1) / values.length,
      zeroPct: (100 * values.filter(v => v === 0).length) / values.length,
      realZeroPct: (100 * reals.filter(v => v === 0).length) / reals.length,
      histogramDistance: Number(best.distance.toFixed(4)),
      histogram: hist,
      realHistogram: reals.reduce((h, v) => ({ ...h, [v]: (h[v] ?? 0) + 1 }), {}),
    },
  };
}

/** Pool-level constants the feature builders need. */
export function poolContext(players) {
  return {
    z: {
      ts: A.zScorer(players.map(p => p.ts)),
      pts100: A.zScorer(players.map(p => p.pts100)),
      usg: A.zScorer(players.map(p => p.usg)),
      mpg: A.zScorer(players.map(p => p.mpg)),
    },
    meanFg3: A.meanSd(players.map(p => p.fg3)).mean,
    meanFg2: A.meanSd(players.map(p => p.fg2)).mean,
  };
}

/** The shape every feature builder consumes, from a reference row. */
const toShootingInput = row => ({
  ts: row.tsPct,
  pts100: row.pts100,
  usg: row.usgPct,
  mpg: row.mpg,
  fg3: row.fgPct3,
  fg3a100: row.fg3a100,
  fg3aRate: row.fg3aRate,
  fg2: row.fgPct2,
  fg2a100: row.fg2a100,
  fta100: row.fta100,
  shotLine: row.card.shotLine,
});

export function fitShootingLayer(rows) {
  const inputs = rows.map(toShootingInput);
  const pool = poolContext(inputs);
  const paired = rows.map((row, i) => ({ row, input: inputs[i] }));

  const shotLine = A.fitLeastSquares(
    paired,
    p => p.row.card.shotLine,
    [0, 1, 2, 3].map(i => p => shotLineFeatures(p.input, pool)[i])
  );
  let slExact = 0;
  let slWithin1 = 0;
  for (const p of paired) {
    const got = A.shotLineFromScore(A.applyModel(shotLine, shotLineFeatures(p.input, pool)));
    if (got === p.row.card.shotLine) slExact += 1;
    if (Math.abs(got - p.row.card.shotLine) <= 1) slWithin1 += 1;
  }

  const threePt = A.fitLeastSquares(
    paired,
    p => p.row.card.threePtBoost,
    [0, 1, 2, 3].map(i => p => threePtFeatures(p.input, pool)[i])
  );
  const paint = A.fitLeastSquares(
    paired,
    p => p.row.card.paintBoost,
    [0, 1, 2, 3].map(i => p => paintFeatures(p.input, pool)[i])
  );

  return {
    shotLine: {
      model: shotLine,
      quality: {
        exactPct: (100 * slExact) / paired.length,
        within1Pct: (100 * slWithin1) / paired.length,
      },
    },
    threePtBoost: {
      model: threePt,
      ...fitBoostShaping(
        paired,
        p => A.applyModel(threePt, threePtFeatures(p.input, pool)),
        p => p.row.card.threePtBoost
      ),
    },
    paintBoost: {
      model: paint,
      ...fitBoostShaping(
        paired,
        p => A.applyModel(paint, paintFeatures(p.input, pool)),
        p => p.row.card.paintBoost
      ),
    },
  };
}

// --- salary -----------------------------------------------------------------

export function fitSalary(rows) {
  const withEv = rows
    .filter(r => Number.isFinite(r.card.salary) && r.card.chart.length > 0)
    .map(r => ({
      card: r.card,
      ev: Object.fromEntries(CHART_STATS.map(s => [s, chartExpectedValue(r.card.chart, s) ?? 0])),
    }));
  const arity = A.salaryFeatures({}, {}).length;
  const model = A.fitLeastSquares(
    withEv,
    r => r.card.salary,
    Array.from({ length: arity }, (_, i) => r => A.salaryFeatures(r.card, r.ev)[i])
  );
  const errs = withEv
    .map(r => Math.abs(A.roundSalary(A.applyModel(model, A.salaryFeatures(r.card, r.ev))) - r.card.salary))
    .sort((a, b) => a - b);
  return {
    model,
    quality: {
      n: withEv.length,
      medianAbsError: errs[Math.floor(errs.length / 2)] ?? 0,
      p90AbsError: errs[Math.floor(errs.length * 0.9)] ?? 0,
    },
  };
}

// --- orchestration ----------------------------------------------------------

export function buildCalibration({ cards, perGame, perPoss, advanced, sample, gameLogs }) {
  const rows = joinReferenceRows({ cards, perGame, perPoss, advanced });
  const shape = V.fitSpreadShape(
    sample.map(s => ({ playerId: s.playerId, mpg: s.mpg, games: gameLogs[s.playerId] ?? [] }))
  );
  const { level, levelScale, points } = fitChartLevel(rows, shape);
  // The scalar correction folds into the intercept: exp(a) multiplies the whole
  // power law, so a per-stat scale is a per-stat intercept shift, and synthesis
  // needs no extra term.
  const scaledLevels = Object.fromEntries(
    CHART_STATS.map(s => [s, { ...level, a: level.a + Math.log(levelScale[s]) }])
  );
  const chartQuality = scoreChartFitPerStat(rows, scaledLevels, shape);

  const position = measurePositionSpeedShare(rows);
  const shooting = fitShootingLayer(rows);
  const salary = fitSalary(rows);

  return {
    generatedAt: new Date().toISOString(),
    provisional: true,
    referenceSeason: REFERENCE_STATS_SEASON,
    referenceCards: rows.length,
    chart: {
      level,
      levelScale,
      levels: scaledLevels,
      shape,
      levelPoints: points,
      quality: chartQuality,
    },
    positionSpeedShare: position.shares,
    positionCounts: position.counts,
    shotLine: shooting.shotLine,
    threePtBoost: shooting.threePtBoost,
    paintBoost: shooting.paintBoost,
    salary,
  };
}

/** Chart fit quality with each stat evaluated on its own corrected level. */
export function scoreChartFitPerStat(rows, scaledLevels, shape) {
  const usable = rows.filter(r => r.card.chart.length === 5 && r.mpg > 0);
  const out = {};
  for (const stat of CHART_STATS) {
    let exact = 0;
    let within1 = 0;
    let total = 0;
    const evErr = [];
    for (const row of usable) {
      const fit = { level: scaledLevels[stat], shape };
      const bands = V.synthesizeBands({ per100: per100Of(row), mpg: row.mpg, games: row.games, fit });
      const chart = toComparableChart(bands);
      const published = row.card.chart.map(t => t[stat]);
      for (let i = 0; i < 5; i += 1) {
        total += 1;
        if (bands[stat][i].value === published[i]) exact += 1;
        if (Math.abs(bands[stat][i].value - published[i]) <= 1) within1 += 1;
      }
      const got = chartExpectedValue(chart, stat);
      const want = chartExpectedValue(row.card.chart, stat);
      if (Number.isFinite(got) && Number.isFinite(want)) evErr.push(got - want);
    }
    const abs = evErr.map(Math.abs).sort((a, b) => a - b);
    out[stat] = {
      bandValues: total,
      exactPct: total ? (100 * exact) / total : 0,
      within1Pct: total ? (100 * within1) / total : 0,
      evBias: evErr.reduce((a, b) => a + b, 0) / (evErr.length || 1),
      evMae: abs.reduce((a, b) => a + b, 0) / (abs.length || 1),
    };
  }
  return out;
}

export function main({ log = console.log } = {}) {
  const cards = loadReferenceCards();
  if (!cards) {
    throw new Error(
      'card-data/source-recovered/Final Cards.csv is missing. Calibration needs it; generation ' +
        'does not — run scripts/cardgen/generateCards.js against the committed calibration file.'
    );
  }
  const sample = readCache('calibration-sample');
  if (!sample) throw new Error('No cached calibration sample — run scripts/cardgen/fetchCalibrationData.js first.');
  const gameLogs = {};
  for (const s of sample) {
    const games = readCache(`gamelog-${s.playerId}-${REFERENCE_STATS_SEASON}`);
    if (games) gameLogs[s.playerId] = games;
  }

  const calibration = buildCalibration({
    cards,
    perGame: readCache(`bbref-${REFERENCE_STATS_SEASON}-perGame`),
    perPoss: readCache(`bbref-${REFERENCE_STATS_SEASON}-perPoss`),
    advanced: readCache(`bbref-${REFERENCE_STATS_SEASON}-advanced`),
    sample,
    gameLogs,
  });

  fs.mkdirSync(path.dirname(CALIBRATION_FILE), { recursive: true });
  fs.writeFileSync(CALIBRATION_FILE, `${JSON.stringify(calibration, null, 1)}\n`);

  const c = calibration;
  log(`reference cards joined to stats : ${c.referenceCards}`);
  log(`game logs behind the spread fit : ${c.chart.shape.players}`);
  log('');
  log('CHART LEVEL — chart size as a multiple of the per-4-minute rate');
  log(`  fitted against finished cards : (36/mpg)^${c.chart.level.b.toFixed(3)} x ${Math.exp(c.chart.level.a).toFixed(3)}  r2 ${c.chart.level.r2.toFixed(3)} (n=${c.chart.levelPoints})`);
  log(`  what the RAW formula implies  : (36/mpg)^${c.chart.shape.rawLevel.b.toFixed(3)} x ${Math.exp(c.chart.shape.rawLevel.a).toFixed(3)}  r2 ${c.chart.shape.rawLevel.r2.toFixed(3)}`);
  log('  ^ the gap between those two IS the unconfirmed double-division question.');
  for (const stat of CHART_STATS) {
    const q = c.chart.quality[stat];
    log(`  ${stat}: scale x${c.chart.levelScale[stat].toFixed(3)} | band values exact ${q.exactPct.toFixed(0)}% within1 ${q.within1Pct.toFixed(0)}% | EV bias ${q.evBias >= 0 ? '+' : ''}${q.evBias.toFixed(3)} MAE ${q.evMae.toFixed(3)}`);
  }
  log('');
  log('POSITIONAL SPEED SHARE (speed / (speed+power))');
  for (const [pos, share] of Object.entries(c.positionSpeedShare).sort()) {
    log(`  ${pos.padEnd(3)} ${share.toFixed(4)}  (n=${c.positionCounts[pos]})`);
  }
  log('');
  log('SHOOTING LAYER — refits, not recovered formulas');
  log(`  shot line   r2 ${c.shotLine.model.r2.toFixed(3)} | exact ${c.shotLine.quality.exactPct.toFixed(0)}% within1 ${c.shotLine.quality.within1Pct.toFixed(0)}%`);
  for (const key of ['threePtBoost', 'paintBoost']) {
    const b = c[key];
    log(`  ${key.padEnd(13)} r2 ${b.model.r2.toFixed(3)} | spread x${b.spread} deadband ${b.deadband} bounds [${b.min}, ${b.max}]`);
    log(`              exact ${b.quality.exactPct.toFixed(0)}% within1 ${b.quality.within1Pct.toFixed(0)}% | zeros ${b.quality.zeroPct.toFixed(0)}% (real ${b.quality.realZeroPct.toFixed(0)}%)`);
  }
  log(`  salary      r2 ${c.salary.model.r2.toFixed(3)} | median |err| ${c.salary.quality.medianAbsError} p90 ${c.salary.quality.p90AbsError}`);
  log('');
  log(`wrote ${path.relative(REPO_ROOT, CALIBRATION_FILE)}`);
  return calibration;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
