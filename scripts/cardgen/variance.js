// Turning a season MEAN into a per-game DISTRIBUTION.
//
// THE PROBLEM THIS SOLVES. memory/provisional_chart_data_idea.md verified half
// of the provisional-chart idea and left the other half open. The verified half:
// at NBA pace a 4-minute section is 100 * 4/48 = 8.33 possessions, so
// `per_4min = per_100 * 0.0833`, and that lands essentially on real published
// cards (Jokic REB 1.43 modeled vs 1.40 actual). The open half, quoted:
// "**mean is not a distribution** ... Percentiles cannot be derived from a mean
// without assuming a distribution shape — that's a modeling decision, not a
// lookup, and it hasn't been made yet."
//
// The decision made here is: DO NOT ASSUME A SHAPE, MEASURE ONE. Real
// Basketball-Reference game logs for a sample of players spanning the minutes
// range are read, the spread of their normalized per-game values is measured
// relative to their own season mean, and that measured relationship is what
// every pool player's synthetic distribution is drawn from. Nothing here picks
// a Poisson, a normal, or any other named distribution.
//
// WHAT IS MEASURED, EXACTLY. bands.js's normalization is
// `normalize(stat, m) = stat * 36 / m^2` and a band's magnitude is
// `ROUNDDOWN(percentile * 4, 1)` rounded to an integer, so the only quantity the
// chart ever sees is
//
//     v = 4 * stat * 36 / m^2
//
// per game. That is what gets modeled — v itself, not the raw box score. Two
// factors are separated:
//
//   LEVEL   `level`: how big the chart is — the mean of v as a multiple of the
//           player's per-4-minute rate T. These are NOT the same number, and
//           that is the whole reason this factor exists.
//
//           THIS IS THE OPEN QUESTION IN memory/scoring_chart_methodology.md,
//           and it has now been measured. bands.js divides by each game's
//           minutes TWICE, which loads v with a factor near 36/MPG: fitted
//           against 30 real 2024-25 game logs, mean(v)/T comes out as
//           (36/MPG)^1.33 — a 12-minute reserve's chart lands over FOUR TIMES
//           his per-4-minute rate. The memory flags that double division as
//           unconfirmed and says, in as many words, do not silently replicate it
//           and do not silently fix it.
//
//           So neither is done. The level is fitted instead against the thing
//           that is not in doubt: the 283 FINISHED CARDS. For every reference
//           player, the target is the expected value per roll their published
//           card actually produces, against the per-100 rate the same player
//           posted. Whatever the original pipeline did to low-minute players —
//           and the published cards say it did NOT inflate them the way the raw
//           formula does — that is what gets reproduced. `calibrateAttributes.js`
//           prints both fits side by side so the gap stays visible rather than
//           being resolved by this file's opinion.
//
//   SHAPE   `shape`: the quantile curve of v / mean(v) — unit-mean, so pure
//           spread. Fitted against the log of the player's per-36 production,
//           because relative spread depends on how big the counts are: a big
//           man averaging 1.5 assists a night has a wildly wider relative spread
//           than a guard averaging 9. Pooled across PTS, REB and AST, since this
//           is a property of counting statistics rather than of which statistic.
//
// HOW THE SYNTHESIS FEEDS bands.js. Rather than re-deriving percentiles, the
// fitted quantile curve is turned back into a synthetic 36-minute game log and
// handed to the REAL `computeStatBands`, untouched. Synthesizing at a constant
// 36 minutes is an ENCODING, not a modeling claim: at m = 36,
// `4 * stat * 36 / 36^2` is exactly `stat / 9`, so setting a pseudo-game's stat
// to `9 * v` makes bands.js's own normalize() reproduce precisely the v that was
// fitted. All the minutes behaviour is already inside the fitted numbers,
// measured from real logs with real minutes.
//
// Counts are rounded to integers before being handed over, because a real game
// log holds integers and the ties that creates are what give the band WIDTHS
// any variety at all — a perfectly smooth sample would hand every player in the
// pool the same roll ranges.

import { computeStatBands } from './bands.js';

/** bands.js's normalization, times 4 — the number a band's magnitude rounds from. */
export function normalizedValue(stat, minutes) {
  return (4 * stat * 36) / (minutes * minutes);
}

export function minutesToDecimal(mp) {
  if (typeof mp === 'number') return mp;
  const [m, s] = String(mp).split(':').map(Number);
  return m + (s || 0) / 60;
}

/** Per-4-minute production over a whole log — the quantity `per_100 / 12` estimates. */
export function per4MinFromLog(games, statKey) {
  let stat = 0;
  let minutes = 0;
  for (const g of games) {
    const m = minutesToDecimal(g.minutes);
    if (!(m > 0)) continue;
    stat += g[statKey];
    minutes += m;
  }
  return minutes > 0 ? (4 * stat) / minutes : 0;
}

/** The verified anchor: a 4-minute section is 8.33 possessions at NBA pace. */
export const PER_100_TO_PER_4MIN = 4 / 48;
export const per4MinFromPer100 = per100 => (per100 ?? 0) * PER_100_TO_PER_4MIN;
/** Per-36 production from the same per-100 rate — the shape model's level covariate. */
export const per36FromPer100 = per100 => (per100 ?? 0) * (36 / 48);

/** Type-7 quantile (the plain linear-interpolation one), clamped at both ends. */
export function quantile(sortedValues, u) {
  const n = sortedValues.length;
  if (n === 0) return NaN;
  if (n === 1) return sortedValues[0];
  const h = (n - 1) * Math.min(Math.max(u, 0), 1);
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sortedValues[lo] + (h - lo) * (sortedValues[hi] - sortedValues[lo]);
}

/** Weighted least squares for `y = a + b*x`. */
export function weightedLinearFit(points) {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const { x, y, w = 1 } of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sw += w;
    sx += w * x;
    sy += w * y;
    sxx += w * x * x;
    sxy += w * x * y;
  }
  if (sw === 0) return { a: 0, b: 0, r2: 0, n: 0 };
  const meanX = sx / sw;
  const meanY = sy / sw;
  const varX = sxx / sw - meanX * meanX;
  const covXY = sxy / sw - meanX * meanY;
  const b = varX > 1e-12 ? covXY / varX : 0;
  const a = meanY - b * meanX;
  let ssRes = 0;
  let ssTot = 0;
  let n = 0;
  for (const { x, y, w = 1 } of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    ssRes += w * (y - (a + b * x)) ** 2;
    ssTot += w * (y - meanY) ** 2;
    n += 1;
  }
  return { a, b, r2: ssTot > 1e-12 ? 1 - ssRes / ssTot : 0, n };
}

const evalFit = (fit, x) => fit.a + fit.b * x;

/** The quantile grid the shape curve is fitted on. Dense enough to interpolate. */
export const SHAPE_GRID = Array.from({ length: 41 }, (_, i) => 0.01 + (i * 0.98) / 40);

export const CHART_STATS = ['pts', 'reb', 'ast'];

/**
 * SHAPE. The unit-mean quantile curve of v, fitted from real game logs.
 *
 * This is the half that only a real per-game distribution can supply, and it is
 * the reason the game logs are fetched at all.
 *
 * @param samples Array of `{ playerId, mpg, games: [{minutes, pts, reb, ast}] }`.
 * @returns `{ grid, coef, players, rawLevel }` — `coef[i]` is the fit of the
 *          i-th grid quantile against log per-36 production. `rawLevel` is the
 *          level the raw formula implies, fitted here only so it can be REPORTED
 *          next to the level actually used; nothing consumes it.
 */
export function fitSpreadShape(samples) {
  const shapePoints = SHAPE_GRID.map(() => []);
  const rawLevelPoints = [];
  let players = 0;

  for (const sample of samples) {
    const played = sample.games.filter(g => minutesToDecimal(g.minutes) > 0);
    if (played.length < 10) continue;
    players += 1;
    const mpg = played.reduce((s, g) => s + minutesToDecimal(g.minutes), 0) / played.length;

    for (const statKey of CHART_STATS) {
      const T = per4MinFromLog(played, statKey);
      if (!(T > 0)) continue;
      const values = played
        .map(g => normalizedValue(g[statKey], minutesToDecimal(g.minutes)))
        .sort((p, q) => p - q);
      const meanV = values.reduce((s, v) => s + v, 0) / values.length;
      if (!(meanV > 0)) continue;

      rawLevelPoints.push({ x: Math.log(36 / mpg), y: Math.log(meanV / T), w: played.length });

      const x = Math.log(Math.max(9 * T, 0.05));
      SHAPE_GRID.forEach((u, i) => {
        shapePoints[i].push({ x, y: quantile(values, u) / meanV, w: played.length });
      });
    }
  }

  return {
    grid: SHAPE_GRID,
    coef: shapePoints.map(pts => weightedLinearFit(pts)),
    players,
    rawLevel: weightedLinearFit(rawLevelPoints),
  };
}

/**
 * LEVEL. How big the chart should be, fitted against the finished cards.
 *
 * @param points Array of `{ mpg, ratio }` where `ratio` is a published card's
 *        expected value per roll divided by that player's per-4-minute rate.
 */
export function fitLevel(points) {
  return weightedLinearFit(
    points
      .filter(p => p.mpg > 0 && p.ratio > 0)
      .map(p => ({ x: Math.log(36 / p.mpg), y: Math.log(p.ratio), w: p.weight ?? 1 }))
  );
}

/**
 * The fitted chart size as a multiple of the per-4-minute rate, for a given MPG.
 *
 * MPG is clamped before the log-log fit is evaluated. The reference players span
 * roughly 11 to 38 minutes a night, and extrapolating a power law past its data
 * is how a six-minute-a-night injury case ends up with a bigger chart than a
 * starter.
 */
export function predictInflation(fit, mpg, { minMpg = 11, maxMpg = 38 } = {}) {
  const clamped = Math.min(Math.max(mpg ?? 24, minMpg), maxMpg);
  return Math.exp(evalFit(fit.level, Math.log(36 / clamped)));
}

/**
 * The fitted unit-mean quantile curve at a given production level.
 *
 * Forced non-negative and non-decreasing: a fitted quantile curve is fitted
 * pointwise, so nothing in the regression guarantees either property, and a
 * quantile curve that dips is not a distribution.
 */
export function predictShape(fit, per36) {
  const x = Math.log(Math.max(per36, 0.05));
  let running = 0;
  return fit.shape.coef.map(c => {
    running = Math.max(running, Math.max(evalFit(c, x), 0));
    return running;
  });
}

/** The five percentile cuts bands.js takes its magnitudes from. */
export const BAND_CUTS = [0.1, 0.33, 0.5, 0.66, 0.9];

/**
 * The mean of the SYNTHESIZED sample per unit of `T * inflation`.
 *
 * Needed because the fitted shape curve is only unit-mean over the whole
 * quantile grid, and synthesis reads it on a coarser grid and then rounds each
 * count to an integer — both of which move the mean off 1. Dividing by this
 * keeps `predictInflation` meaning what the level fit says it means, so the fit
 * and the output agree instead of drifting apart by a silent constant.
 */
export function shapeGridMean(fit, per36, n) {
  const curve = predictShape(fit, per36);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += shapeAt(fit.shape.grid, curve, (i + 0.5) / n);
  return sum / n;
}

/** Linear interpolation into a fitted shape curve at an arbitrary quantile. */
export function shapeAt(grid, curve, u) {
  if (u <= grid[0]) return curve[0];
  const last = grid.length - 1;
  if (u >= grid[last]) return curve[last];
  let i = 1;
  while (i < last && grid[i] < u) i += 1;
  const span = grid[i] - grid[i - 1];
  const t = span > 0 ? (u - grid[i - 1]) / span : 0;
  return curve[i - 1] + t * (curve[i] - curve[i - 1]);
}

/** bands.js needs at least this many games for PERCENTILE.EXC at p=0.1 and p=0.9. */
export const MIN_SYNTHETIC_GAMES = 20;

/**
 * A synthetic 36-minute game log whose normalized distribution is the fitted one.
 *
 * `per100` maps are `{ pts, reb, ast }` per 100 possessions. The returned array
 * is exactly the shape `computeStatBands` consumes, and is handed to it unchanged.
 */
export function synthesizeGames({ per100, mpg, games, fit }) {
  const n = Math.max(Math.round(games ?? 0), MIN_SYNTHETIC_GAMES);
  const inflation = predictInflation(fit, mpg);
  const columns = {};
  for (const statKey of CHART_STATS) {
    const rate = per100?.[statKey] ?? 0;
    const T = per4MinFromPer100(rate);
    const per36 = per36FromPer100(rate);
    const curve = predictShape(fit, per36);
    const gridMean = shapeGridMean(fit, per36, n) || 1;
    columns[statKey] = Array.from({ length: n }, (_, i) => {
      const u = (i + 0.5) / n;
      const v = (T * inflation * shapeAt(fit.shape.grid, curve, u)) / gridMean;
      // 9 * v is the count in a 36-minute game; a real log holds integers.
      return Math.max(Math.round(9 * v), 0);
    });
  }
  return Array.from({ length: n }, (_, i) => ({
    minutes: 36,
    pts: columns.pts[i],
    reb: columns.reb[i],
    ast: columns.ast[i],
  }));
}

/** Convenience: synthetic log -> the three stats' bands, via the real band logic. */
export function synthesizeBands(input) {
  const games = synthesizeGames(input);
  return {
    games,
    pts: computeStatBands(games, 'pts'),
    reb: computeStatBands(games, 'reb'),
    ast: computeStatBands(games, 'ast'),
  };
}
