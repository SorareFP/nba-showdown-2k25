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
import { indexBiometrics, loadBiometrics } from './biometrics.js';
import { normalizeShares } from './positionShares.js';
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

/**
 * The reference season's play-by-play position estimates, by name.
 *
 * BY NAME, not by Basketball-Reference id, and that is safe HERE for the reason
 * it is not safe in the archive: this is one season's table joined to one
 * season's cards, and a normalized name is unique inside a single season. The
 * father/son collisions history.js warns about only exist across seasons.
 *
 * Calibration is allowed to read the gitignored cache directly — it already
 * needs the gitignored reference CSV, so it can never run from a bare checkout.
 * GENERATION may not, which is why card-data/generated/position-shares.json is
 * a committed file.
 */
export function indexShares(playByPlay) {
  const m = new Map();
  for (const row of playByPlay ?? []) {
    const shares = normalizeShares(row.pct);
    if (!shares) continue;
    const key = normalizeName(row.name);
    const prev = m.get(key);
    if (!prev || (row.games ?? 0) > (prev.games ?? 0)) m.set(key, { ...shares, games: row.games ?? 0 });
  }
  // The games count was only a tiebreak; the consumers want five numbers.
  for (const [k, v] of m) {
    const { games, ...shares } = v;
    m.set(k, shares);
  }
  return m;
}

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

/**
 * ── FOUR RULES FOR ONE SPLIT, MEASURED AGAINST THE FINISHED CARDS ───────────
 *
 * The Speed/Power split has been stated four different ways, and this measures
 * all four against the same 283 real cards so the choice between them is made
 * on a number rather than on a preference:
 *
 *   label       the position LABEL's own average share. The original rule.
 *   labelSize   that, bent by height and weight away from the average BUILD of
 *               the label's position. What ships today.
 *   shares      the player as a weighted blend of all five positional centres,
 *               weighted by the share of his minutes he really spent at each —
 *               Basketball-Reference's play-by-play position estimates.
 *   sharesSize  that, bent by size away from the blend of those five builds.
 *
 * ── AND MEASURED HELD OUT, WHICH IS THE ONLY MEASUREMENT THAT SETTLES IT ────
 *
 * Every one of these rules is FITTED on the cards it is then scored against, so
 * in-sample error falls monotonically as parameters are added whether or not the
 * added parameter is real. `shares` has the same five parameters as `label` but
 * spends them on a richer predictor; `sharesSize` has two more. Ranking them on
 * in-sample RMSE would therefore reward complexity for its own sake.
 *
 * So each rule is also re-fitted with a fifth of the cards withheld, scored on
 * that fifth, and the five folds pooled — and it is the HELD-OUT number that
 * decides. The folds are deterministic — every fifth card of a name-sorted list
 * — so the answer does not move between runs and cannot be reshuffled until it
 * flatters a preference.
 *
 * AND IT IS RE-RUN LEAVE-ONE-OUT, which is not belt and braces. At two folds
 * `labelSize` scores 0.943, better than its own in-sample 0.967, which is not a
 * thing a real out-of-sample error does; it is the luck of one particular half.
 * Leave-one-out has no such freedom, and reporting both is what stops a future
 * reader from picking whichever k flatters the rule they already liked. The
 * ORDER of the four is identical at k = 2, 3, 5, 10, 25 and n.
 *
 * This exists because the last change here had an honest negative result: size
 * did NOT reproduce the finished cards better than the label, and shipped anyway
 * on an argument about resolution. That number is still printed on every run.
 * Whatever this one says, it gets the same treatment.
 */
export const SPEED_SHARE_FOLDS = 5;

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Per-position means of a value, over the points whose LABEL is that position. */
function labelMeans(points, valueOf) {
  const out = {};
  for (const pos of A.POSITIONS) {
    const g = points.filter(p => p.pos === pos);
    if (g.length) out[pos] = { value: mean(g.map(valueOf)), n: g.length };
  }
  return out;
}

/**
 * The five positional centres implied by fractional shares.
 *
 * A blend is `share = Σ w_p c_p`, which is a linear model in the five weights
 * with NO intercept — the weights already sum to 1, so a constant would make the
 * design singular. The recovered coefficients are the answer to "what would a
 * player who was 100% this position get", which is the same quantity `label`
 * measures as a group mean, so the two are directly comparable.
 */
function shareCentres(points, valueOf) {
  const fit = A.fitLeastSquares(
    points,
    valueOf,
    A.POSITIONS.map(p => r => r.shares[p]),
    { intercept: false }
  );
  if (!fit) return null;
  return Object.fromEntries(A.POSITIONS.map((p, i) => [p, fit.coef[i]]));
}

/** The size slopes, from residuals that already have their own baseline removed. */
function sizeSlopes(points, centreOf, buildOf) {
  const centred = points.map(p => {
    const build = buildOf(p);
    return {
      ds: p.share - centreOf(p),
      di: p.inches - build.inches,
      dw: p.weight - build.weight,
    };
  });
  const fit = A.fitLeastSquares(centred, r => r.ds, [r => r.di, r => r.dw]);
  if (!fit) return null;
  return { inches: fit.coef[1], weight: fit.coef[2], r2: fit.r2 };
}

/**
 * The four rules, each as `fit(trainingPoints) -> splitSpeedPower options`.
 *
 * Every one returns the exact option bag `A.splitSpeedPower` takes, so scoring a
 * rule runs the SHIPPING code path rather than a re-implementation of it. A rule
 * that cannot be fitted (too few points, a singular system) returns null and is
 * reported as unavailable instead of silently scoring as its simpler cousin.
 */
export const SPEED_SHARE_RULES = {
  label: points => {
    const m = labelMeans(points, p => p.share);
    return { shares: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.value])) };
  },

  labelSize: points => {
    const shareBy = labelMeans(points, p => p.share);
    const inchBy = labelMeans(points, p => p.inches);
    const lbBy = labelMeans(points, p => p.weight);
    const shares = Object.fromEntries(Object.entries(shareBy).map(([k, v]) => [k, v.value]));
    const positionSize = Object.fromEntries(
      A.POSITIONS.filter(p => inchBy[p]).map(p => [
        p,
        { inches: inchBy[p].value, weight: lbBy[p].value, n: inchBy[p].n },
      ])
    );
    const usable = points.filter(p => shares[p.pos] !== undefined && positionSize[p.pos]);
    const sizeModel = sizeSlopes(usable, p => shares[p.pos], p => positionSize[p.pos]);
    if (!sizeModel) return null;
    return { shares, positionSize, sizeModel, useSize: true };
  },

  shares: points => {
    const shares = shareCentres(points, p => p.share);
    return shares ? { shares, useShares: true } : null;
  },

  sharesSize: points => {
    const shares = shareCentres(points, p => p.share);
    const inches = shareCentres(points, p => p.inches);
    const weight = shareCentres(points, p => p.weight);
    if (!shares || !inches || !weight) return null;
    const positionSize = Object.fromEntries(
      A.POSITIONS.map(p => [p, { inches: inches[p], weight: weight[p] }])
    );
    const blend = (p, of) => A.POSITIONS.reduce((s, q) => s + p.shares[q] * of(q), 0);
    const sizeModel = sizeSlopes(
      points,
      p => blend(p, q => shares[q]),
      p => ({
        inches: blend(p, q => positionSize[q].inches),
        weight: blend(p, q => positionSize[q].weight),
      })
    );
    if (!sizeModel) return null;
    return { shares, positionSize, sizeModel, useShares: true, useSize: true };
  },
};

/** Runs a fitted rule on one card, through the same code generation uses. */
export function applySpeedShareRule(rule, point) {
  return A.splitSpeedPower(point.total, point.pos, rule.shares, {
    positionSize: rule.positionSize ?? null,
    sizeModel: rule.useSize ? rule.sizeModel : null,
    size: rule.useSize ? { inches: point.inches, weight: point.weight } : null,
    positionShares: rule.useShares ? point.shares : null,
  });
}

/** RMSE in whole printed Speed points, plus how often the rule lands exactly. */
function scoreSpeed(pairs) {
  if (pairs.length === 0) return null;
  const se = pairs.reduce((s, [got, want]) => s + (got - want) ** 2, 0);
  const exact = pairs.filter(([got, want]) => got === want).length;
  return {
    rmse: Number(Math.sqrt(se / pairs.length).toFixed(3)),
    exactPct: Number(((100 * exact) / pairs.length).toFixed(1)),
  };
}

/**
 * In-sample and held-out error for every rule, on ONE common set of cards.
 *
 * The common set matters: a rule scored on more cards than its rival is not
 * being compared with it. Only cards carrying a printed split, a height and
 * weight, AND a play-by-play share row are used, and how many were dropped to
 * get there is reported.
 */
export function compareSpeedShareRules(points, { folds = SPEED_SHARE_FOLDS } = {}) {
  const ordered = points.slice().sort((a, b) => a.name.localeCompare(b.name));

  const crossValidate = (fit, k) => {
    const pairs = [];
    for (let f = 0; f < k; f += 1) {
      const trained = fit(ordered.filter((_, i) => i % k !== f));
      if (!trained) return null;
      for (const p of ordered.filter((_, i) => i % k === f)) {
        pairs.push([applySpeedShareRule(trained, p).speed, p.speed]);
      }
    }
    return scoreSpeed(pairs);
  };

  const out = {};
  for (const [name, fit] of Object.entries(SPEED_SHARE_RULES)) {
    const whole = fit(ordered);
    if (!whole) {
      out[name] = { available: false };
      continue;
    }
    out[name] = {
      available: true,
      inSample: scoreSpeed(ordered.map(p => [applySpeedShareRule(whole, p).speed, p.speed])),
      heldOut: crossValidate(fit, folds),
      // Leave-one-out: the same measurement with no freedom left in how the
      // cards were divided up. See SPEED_SHARE_FOLDS.
      leaveOneOut: crossValidate(fit, ordered.length),
    };
  }
  return out;
}

/**
 * Everything the split needs, fitted, plus the four-way comparison behind it.
 *
 * Two families of constant come out of here and they are NOT interchangeable:
 *
 *   `positionSize` / `sizeSpeedShare` — the LABEL rule's centres and slopes,
 *     unchanged, still what a caller with no share data applies.
 *   `sharePositionSpeedShare` / `sharePositionSize` / `shareSizeSpeedShare` —
 *     the same three quantities re-fitted against the SHARES.
 *
 * Re-fitting is not optional. Blending label-fitted centres with weights that
 * are only mostly one-hot pulls every player toward the middle, so the set's
 * whole distribution of splits would compress — and the finished 306-card set,
 * the four other sets and the REFERENCE_TOTALS scale are all priced against the
 * current level. The share-fitted centres are wider by exactly enough to undo
 * that, because they are what a 100%-one-position player is measured to get.
 *
 * `quality` is reported honestly whichever way it falls. See
 * SPEED_SHARE_RULES above for why the held-out column is the one that decides.
 */
export function measureSpeedShareRules(rows, biometrics, shareIndex) {
  const points = [];
  let noSize = 0;
  let noShares = 0;
  for (const row of rows) {
    const total = (row.card.speed ?? 0) + (row.card.power ?? 0);
    const pos = A.basePosition(row.pos);
    if (!pos || !total) continue;
    const size = biometrics?.get(normalizeName(row.card.name));
    const hasSize = Number.isFinite(size?.inches) && Number.isFinite(size?.weight);
    const shares = shareIndex?.get(normalizeName(row.card.name)) ?? null;
    if (!hasSize) noSize += 1;
    if (!shares) noShares += 1;
    if (!hasSize || !shares) continue;
    points.push({
      name: row.card.name,
      pos,
      total,
      speed: row.card.speed,
      share: row.card.speed / total,
      shares,
      ...size,
    });
  }
  if (points.length === 0) return null;

  const label = SPEED_SHARE_RULES.labelSize(points);
  const shares = SPEED_SHARE_RULES.sharesSize(points);
  if (!label || !shares) return null;

  const round = (o, d) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v.toFixed(d))]));
  const roundBuilds = o =>
    Object.fromEntries(
      Object.entries(o).map(([k, v]) => [
        k,
        { inches: Number(v.inches.toFixed(2)), weight: Number(v.weight.toFixed(1)), ...(v.n ? { n: v.n } : {}) },
      ])
    );

  return {
    positionSize: roundBuilds(label.positionSize),
    sizeSpeedShare: {
      inches: Number(label.sizeModel.inches.toFixed(6)),
      weight: Number(label.sizeModel.weight.toFixed(6)),
    },
    sharePositionSpeedShare: round(shares.shares, 4),
    sharePositionSize: roundBuilds(shares.positionSize),
    shareSizeSpeedShare: {
      inches: Number(shares.sizeModel.inches.toFixed(6)),
      weight: Number(shares.sizeModel.weight.toFixed(6)),
    },
    quality: {
      n: points.length,
      folds: SPEED_SHARE_FOLDS,
      droppedNoSize: noSize,
      droppedNoShares: noShares,
      labelSizeR2: Number(label.sizeModel.r2.toFixed(4)),
      shareSizeR2: Number(shares.sizeModel.r2.toFixed(4)),
      rules: compareSpeedShareRules(points),
    },
  };
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

export function buildCalibration({
  cards,
  perGame,
  perPoss,
  advanced,
  playByPlay,
  sample,
  gameLogs,
  biometrics,
}) {
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
  // Null when either input is absent — card-data/generated/player-biometrics.json
  // for the size term, the cached play-by-play table for the shares. The
  // calibration is still complete without it and generation falls back to the
  // constants in attributes.js, so a missing table costs those two terms and
  // nothing else.
  const split = measureSpeedShareRules(rows, biometrics, indexShares(playByPlay));
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
    positionSize: split?.positionSize ?? null,
    sizeSpeedShare: split?.sizeSpeedShare ?? null,
    // The same three quantities re-fitted against the positional SHARES rather
    // than the label. Separate keys, never a silent replacement: the two sets
    // are not interchangeable, and a checkout that reads one while applying the
    // other would compress every split toward the middle.
    sharePositionSpeedShare: split?.sharePositionSpeedShare ?? null,
    sharePositionSize: split?.sharePositionSize ?? null,
    shareSizeSpeedShare: split?.shareSizeSpeedShare ?? null,
    speedShareQuality: split?.quality ?? null,
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
    playByPlay: readCache(`bbref-${REFERENCE_STATS_SEASON}-playByPlay`),
    sample,
    gameLogs,
    biometrics: indexBiometrics(loadBiometrics()),
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
  if (c.speedShareQuality) {
    const q = c.speedShareQuality;
    log('');
    log('THE SPLIT, BY LABEL AND BY POSITIONAL SHARES');
    log('  centres a 100%-one-position player is measured to get:');
    log('       label   shares      mean build (label)      mean build (shares)');
    for (const pos of A.POSITIONS) {
      const lb = c.positionSize[pos];
      const sb = c.sharePositionSize[pos];
      log(
        `  ${pos.padEnd(3)} ${c.positionSpeedShare[pos].toFixed(4)}  ` +
          `${c.sharePositionSpeedShare[pos].toFixed(4)}    ` +
          `${lb ? `${lb.inches}" ${lb.weight} lb (n=${lb.n})` : '—'}`.padEnd(26) +
          `${sb ? `${sb.inches}" ${sb.weight} lb` : '—'}`
      );
    }
    log(
      `  size slope per inch / per pound: label ${c.sizeSpeedShare.inches} / ` +
        `${c.sizeSpeedShare.weight} (r2 ${q.labelSizeR2})  |  shares ` +
        `${c.shareSizeSpeedShare.inches} / ${c.shareSizeSpeedShare.weight} (r2 ${q.shareSizeR2})`
    );
    log('');
    log(
      `  REPRODUCING THE PRINTED SPEED — ${q.n} cards with a build AND a share row ` +
        `(${q.droppedNoShares} had no shares, ${q.droppedNoSize} no build)`
    );
    log(
      `  rule         in-sample rmse  exact%    ${q.folds}-fold rmse  exact%    leave-one-out rmse`
    );
    for (const [name, r] of Object.entries(q.rules)) {
      if (!r.available) {
        log(`  ${name.padEnd(12)} unavailable — could not be fitted on this sample`);
        continue;
      }
      log(
        `  ${name.padEnd(12)} ${String(r.inSample.rmse).padStart(13)}  ${String(r.inSample.exactPct).padStart(6)}   ` +
          `${String(r.heldOut?.rmse ?? '—').padStart(12)}  ${String(r.heldOut?.exactPct ?? '—').padStart(6)}   ` +
          `${String(r.leaveOneOut?.rmse ?? '—').padStart(17)}`
      );
    }
    const ranked = Object.entries(q.rules)
      .filter(([, r]) => r.available && r.leaveOneOut)
      .sort((a, b) => a[1].leaveOneOut.rmse - b[1].leaveOneOut.rmse);
    if (ranked.length) {
      log('  ^ HELD OUT is the column that decides. Every rule is fitted on the cards it is then');
      log('    scored against, so in-sample error falls as parameters are added whether or not the');
      log('    parameter is real. Ranked by leave-one-out:');
      log(`      ${ranked.map(([n, r]) => `${n} ${r.leaveOneOut.rmse}`).join('  <  ')}`);
      log(`    ACTIVE RULE: ${A.SPLIT_RULE.name}.`);
      if (ranked[0][0] !== A.SPLIT_RULE.name) {
        log(
          `    The active rule is NOT the best-fitting one — ${ranked[0][0]} is, by ` +
            `${(q.rules[A.SPLIT_RULE.name].leaveOneOut.rmse - ranked[0][1].leaveOneOut.rmse).toFixed(3)} ` +
            'of a Speed point.'
        );
        log('    See SPLIT_RULE in attributes.js for what it is applied for instead, and how to');
        log('    change it back. One line.');
      }
    }
  } else {
    log('');
    log('THE SPLIT: label only — no biometrics and/or no cached play-by-play table.');
    log('  run `node --env-file=.env.local scripts/cardgen/biometrics.js` and');
    log('      `node scripts/cardgen/positionShares.js`.');
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
