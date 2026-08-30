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
// target than any principle argued from first principles.
//
// WHAT IS AND IS NOT FITTED HERE, because the two halves make different claims:
//
//   The chart level and salary are REFITS. They reproduce the finished cards by
//   regression, and their error against those cards is the honest measure of
//   them; it is printed on every run and stored in the output.
//
//   The shooting layer is NOT. scripts/cardgen/shooting.js states a rule — a
//   player's Shot Line is the roll at which he misses at his real TS% miss rate
//   — and what is fitted here is only the SCALE that rule is expressed on: the
//   Shot Line range the finished set occupies, and how large a relative strength
//   has to be before it earns a modifier. Its agreement with the finished cards
//   is therefore reported rather than optimised, and it is lower than the
//   regression it replaced. That is the point: the old fit reproduced what a
//   card of a player's SORT looked like, and the rule says what the player did.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { loadReferenceCards, chartExpectedValue } from './referenceCards.js';
import { reconcileBands } from './generate.js';
import * as V from './variance.js';
import * as A from './attributes.js';
import * as S from './shooting.js';
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
      // Season TOTAL minutes, which the attempt counts behind the shrinkage
      // weights are reconstructed from. `mpg * games` would round differently
      // for every player; the per-100 table carries the real figure.
      minutes: p.minutes,
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
//
// NOT a regression any more. scripts/cardgen/shooting.js states the rule — a
// player's Shot Line is the roll at which he misses at his real TS% miss rate,
// and a boost is the distance from that line to what he really shoots at a
// location — and what is fitted here is only the three things the rule leaves
// open, all of them measured off the finished cards:
//
//   1. The TARGET DISTRIBUTION for the Shot Line. Raw TS% puts the median player
//      on a line of 9, which converts 60% of his shot checks against 30% on the
//      finished cards. So the finished set supplies mean, spread and range, and
//      TS% supplies the ordering.
//   2. The DEADBAND on each boost, i.e. how big a relative strength has to be
//      before the card carries a modifier at all. 90% of real Paint Boosts and
//      64% of real 3PT Boosts are exactly 0; that is a design rule about what a
//      modifier is FOR, and nothing in the shooting data implies it.
//   3. The BOUNDS on each boost, taken as the finished set's own min and max, so
//      a regenerated card can never carry a boost the game has never issued.
//   4. The TARGET SPREAD of the 3PT Boost. The Paint Boost is a distance in Shot
//      Line units and so inherits the Shot Line's scale; the 3PT Boost measures
//      absolute three-point ability instead (scripts/cardgen/shooting.js has the
//      argument) and so needs its own, and the finished set's own 3PT Boost
//      spread is what supplies it.
//
// The reference season is 2024-25 Basketball-Reference, which has no rim FG%, so
// overall 2P% stands in for the paint signal HERE ONLY. That is defensible
// because everything the fit produces is pool-relative — the deadband is applied
// to a value already centred on its own pool's mean and scaled by its own pool's
// spread — so a systematic difference between "2P%" and "rim%" cancels. The
// generated set uses rim%, which is the better signal and the one the user asked
// for; the transfer is checked by reporting both pools' spreads on every run.

/** The finished set's own Shot Line distribution — the target of the compression. */
export function measureShotLineTarget(cards) {
  const lines = (cards ?? []).map(c => c.shotLine).filter(Number.isFinite);
  if (lines.length === 0) return null;
  const { mean, sd } = A.meanSd(lines);
  return {
    mean: Number(mean.toFixed(4)),
    sd: Number(sd.toFixed(4)),
    min: Math.min(...lines),
    max: Math.max(...lines),
    n: lines.length,
  };
}

/**
 * A reference row in the shape scripts/cardgen/shooting.js reads.
 *
 * Attempts are reconstructed from the per-100 rate and season minutes, because
 * Basketball-Reference's per-100 table reports no raw counts. They feed the
 * shrinkage weight and nothing else.
 */
export function referenceShootingInput(row) {
  return {
    tsPct: row.tsPct,
    paintPct: row.fgPct2,
    threePct: row.fgPct3,
    paintAttempts: S.attemptsFromPer100(row.fg2a100, row.minutes),
    threeAttempts: S.attemptsFromPer100(row.fg3a100, row.minutes),
  };
}

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

/**
 * Deadbands searched in twentieths of a roll, out to a full roll and a half.
 *
 * Finer than the eye can use, but the search is over a few hundred rows and runs
 * once, and a coarse grid would quantise the zero share it is trying to hit.
 */
export const DEADBAND_SEARCH = Array.from({ length: 61 }, (_, i) => i * 0.025);

/**
 * Picks the deadband whose produced histogram is closest to the real one.
 *
 * Distribution matching, NOT error minimisation, and the distinction is the
 * whole point. 90% of real Paint Boosts are 0, so a rule returning 0 for
 * everybody "agrees" 90% of the time while saying nothing at all, and any
 * accuracy metric would happily choose it. Agreement rates are still reported —
 * they are just not what is being optimised.
 */
export function fitDeadband(gaps, shape, reals) {
  const min = Math.min(...reals);
  const max = Math.max(...reals);
  let best = null;
  for (const deadband of DEADBAND_SEARCH) {
    const values = gaps.map(g => S.compressBoost(g, { ...shape, deadband, min, max }));
    const distance = histogramDistance(values, reals);
    if (!best || distance < best.distance) best = { deadband, distance, values };
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
    deadband: Number(best.deadband.toFixed(3)),
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

/**
 * The finished set's own 3PT Boost spread — the target the boost is scaled to.
 *
 * The Paint Boost borrows the Shot Line's scale because it IS a distance in Shot
 * Line units. The 3PT Boost is not (see scripts/cardgen/shooting.js), so it
 * needs a target of its own, and the finished set is the only thing that can
 * supply one. Measuring the spread rather than fitting a free parameter is
 * deliberate: a joint search over scale and deadband was run and converged on
 * a scale within 1% of this, so the extra freedom bought nothing.
 */
export function measureThreePtTarget(cards) {
  const values = (cards ?? []).map(c => c.threePtBoost).filter(Number.isFinite);
  if (values.length === 0) return null;
  const { mean, sd } = A.meanSd(values);
  return { mean: Number(mean.toFixed(4)), sd: Number(sd.toFixed(4)), n: values.length };
}

export function fitShootingLayer(rows) {
  const cards = rows.map(r => r.card);
  const shotLineTarget = measureShotLineTarget(cards);
  const threeTarget = measureThreePtTarget(cards);
  const inputs = rows.map(referenceShootingInput);

  // Pass one: no deadbands, purely to get the compression scales and the pool
  // means the boosts are centred on. Those depend only on the pool, not on the
  // deadband, so one pass is enough before the search.
  const layer = S.buildShootingLayer(inputs, {
    shotLineTarget,
    three: { targetSd: threeTarget?.sd },
  });

  let slExact = 0;
  let slWithin1 = 0;
  layer.players.forEach((p, i) => {
    const want = cards[i].shotLine;
    if (p.shotLine === want) slExact += 1;
    if (Math.abs(p.shotLine - want) <= 1) slWithin1 += 1;
  });

  const paint = fitDeadband(
    layer.players.map(p => p.raw.exactPaintGap),
    layer.paintShape,
    cards.map(c => c.paintBoost)
  );
  const three = fitDeadband(
    layer.players.map(p => p.raw.exactThreeStrength),
    layer.threeShape,
    cards.map(c => c.threePtBoost)
  );

  return {
    shotLine: {
      target: shotLineTarget,
      referencePool: {
        rawMean: Number(layer.map.poolMean.toFixed(4)),
        rawSd: Number(layer.map.poolSd.toFixed(4)),
        scale: Number(layer.map.scale.toFixed(4)),
      },
      quality: {
        exactPct: (100 * slExact) / rows.length,
        within1Pct: (100 * slWithin1) / rows.length,
      },
    },
    shrinkage: {
      paint: { mean: Number(layer.shrink.paint.mean.toFixed(4)), k: Number(layer.shrink.paint.k.toFixed(1)) },
      three: { mean: Number(layer.shrink.three.mean.toFixed(4)), k: Number(layer.shrink.three.k.toFixed(1)) },
    },
    paintBoost: {
      ...paint,
      referenceGapSd: Number(A.meanSd(layer.players.map(p => p.raw.exactPaintGap)).sd.toFixed(4)),
    },
    threePtBoost: {
      ...three,
      // The spread the generated pool's own three-point ability is rescaled ONTO
      // — generateCards.js divides its own pool spread into this, exactly as the
      // Shot Line target is applied, so a season's or a provider's systematic
      // difference cancels on both sides.
      targetSd: threeTarget?.sd ?? null,
      referenceStrengthSd: Number(
        A.meanSd(layer.players.map(p => p.raw.exactThreeStrength)).sd.toFixed(4)
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
    shrinkage: shooting.shrinkage,
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
  log('SHOOTING LAYER — the stated probability rule, compressed onto the finished set');
  const t = c.shotLine.target;
  const rp = c.shotLine.referencePool;
  log(`  shot line target (finished cards) : mean ${t.mean} sd ${t.sd} range [${t.min}, ${t.max}] n=${t.n}`);
  log(`  reference pool raw TS%% lines      : mean ${rp.rawMean} sd ${rp.rawSd} -> compression x${rp.scale}`);
  log(`  reproduces the real lines         : exact ${c.shotLine.quality.exactPct.toFixed(0)}% within1 ${c.shotLine.quality.within1Pct.toFixed(0)}%`);
  log(`  volume gate (shrink toward league mean, k = imaginary league-average attempts)`);
  log(`    paint  mean ${c.shrinkage.paint.mean} k ${c.shrinkage.paint.k}`);
  log(`    three  mean ${c.shrinkage.three.mean} k ${c.shrinkage.three.k}`);
  for (const key of ['threePtBoost', 'paintBoost']) {
    const b = c[key];
    log(
      `  ${key.padEnd(13)} deadband ${b.deadband} bounds [${b.min}, ${b.max}] | ` +
        `reference signal sd ${b.referenceGapSd ?? b.referenceStrengthSd}` +
        (b.targetSd == null ? '' : ` -> target boost sd ${b.targetSd}`)
    );
    log(`              exact ${b.quality.exactPct.toFixed(0)}% within1 ${b.quality.within1Pct.toFixed(0)}% | zeros ${b.quality.zeroPct.toFixed(0)}% (real ${b.quality.realZeroPct.toFixed(0)}%) | histogram distance ${b.quality.histogramDistance}`);
  }
  log(`  salary      r2 ${c.salary.model.r2.toFixed(3)} | median |err| ${c.salary.quality.medianAbsError} p90 ${c.salary.quality.p90AbsError}`);
  log('');
  log(`wrote ${path.relative(REPO_ROOT, CALIBRATION_FILE)}`);
  return calibration;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
