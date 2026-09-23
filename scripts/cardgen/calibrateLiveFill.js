// The Live Series' synthetic-fill level — card-data/generated/live-fill-calibration.json.
//
//   node scripts/cardgen/calibrateLiveFill.js
//
// ── WHY A SECOND CHART LEVEL EXISTS ──────────────────────────────────────────
//
// A live card's chart is cut from this season's real games topped up to 82
// with synthetic games from dunksandthrees' expected per-100 rates
// (generateCards.js, fillGames). The synthetic games come from variance.js,
// whose LEVEL — how big a chart is as a multiple of the per-4-minute rate —
// was fitted against the PUBLISHED 2025-26 cards (calibrateAttributes.js,
// card-calibration.json). The base set's charts, though, are cut from REAL
// last-82 game logs through realGames.js, whose opponent adjustment, minutes
// damp and winsorization define their own level. Measured on the 2025-26 pool
// (2026-09-23), the two are not the same scale: pure-synthetic charts came out
// 1.26x the real-log charts on points, 1.65x on rebounds and 2.03x on assists,
// and worst at low minutes. A Live Series on that level would print stronger
// cards than the base set it is played beside for the whole of October.
//
// So the fill is calibrated to the real-log path directly, on the game rows
// themselves: for every pool player with a full window, the minutes-weighted
// mean of bands.js's normalized value over his REAL rows (as realGames.js
// hands them to computeStatBands), divided by the per-4-minute rate his
// predicted per-100 line implies, is the level the synthetic rows have to
// reproduce. Fitted as the same log-log line in 36/MPG the variance model
// uses (fitLevel), one line per stat, so predictInflation reads it unchanged.
// Everything downstream — band cuts, CDF placement, the usage gate, the
// spine — is then identical for a real row and a synthetic one.
//
// Re-run after any change to realGames.js's adjustment tail or to the base
// set's windows; the file records what it was fitted on.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, readCache } from './cache.js';
import { loadAllRealGames } from './realGames.js';
import { computeStatBands } from './bands.js';
import * as V from './variance.js';
import { CURRENT_STATS_SEASON } from './fetchCalibrationData.js';
import { indexByName, STAT_NAME_ALIASES } from './generateCards.js';
import { normalizeName } from './resolveTeams.js';
import { playerIdFromName } from '../../src/cards/playerId.js';
import { trb100 } from './sources/dunksAndThrees.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, 'live-fill-calibration.json');
export const POOL_FILE = path.join(GEN_DIR, 'player-pool-2026.json');
/** A window this short says more about the window than about the level. */
export const MIN_WINDOW_GAMES = 40;
/** Below this per-4-minute rate the ratio is a rounding artefact (a centre's assists). */
export const MIN_RATE = 0.05;

const lookup = (index, name) =>
  index.get(normalizeName(STAT_NAME_ALIASES[name] ?? name)) ?? index.get(normalizeName(name)) ?? null;

/**
 * One point per player per stat: `{ mpg, ratio, weight }`, where ratio is the
 * minutes-weighted mean normalized value of his real rows over the
 * per-4-minute rate of his predicted per-100 line. Minutes-weighted because
 * computeStatBands weights its percentiles by minutes, so that is the mean
 * the synthetic rows — all at 36 minutes — have to land on.
 */
export function levelPoints({ realGamesById, rates, pool, minGames = MIN_WINDOW_GAMES }) {
  const rateIndex = indexByName(rates);
  const points = Object.fromEntries(V.CHART_STATS.map(s => [s, []]));
  let players = 0;
  for (const p of pool) {
    const rows = realGamesById.get(playerIdFromName(p.name));
    const rate = lookup(rateIndex, p.name);
    if (!rows || rows.length < minGames || !rate) continue;
    players += 1;
    const per100 = { pts: rate.pts100 ?? 0, reb: trb100(rate), ast: rate.ast100 ?? 0 };
    let minutes = 0;
    for (const g of rows) minutes += V.minutesToDecimal(g.minutes);
    const mpg = minutes / rows.length;
    for (const stat of V.CHART_STATS) {
      const T = V.per4MinFromPer100(per100[stat]);
      if (!(T > MIN_RATE)) continue;
      let weighted = 0;
      for (const g of rows) {
        const m = V.minutesToDecimal(g.minutes);
        weighted += m * V.normalizedValue(g[stat], m);
      }
      const ratio = weighted / minutes / T;
      if (ratio > 0) points[stat].push({ name: p.name, mpg, ratio, weight: rows.length });
    }
  }
  return { points, players };
}

/**
 * The real windows as fitSpreadShape's samples, for the SHAPE: the unit-mean
 * quantile curve of the normalized value, against per-36 production. The
 * published-set shape (card-calibration.json) was fitted on thirty RAW
 * 2024-25 logs and the section model synthesizes a fatter top than the
 * damped, winsorized rows the base set is cut from — measured 2026-09-23,
 * one or two extra printed rows on 137 of 348 cards and a top tier a point
 * higher on 189 — so the fill takes its spread from the same rows it takes
 * its level from.
 */
export function shapeSamples({ realGamesById, pool, minGames = MIN_WINDOW_GAMES }) {
  const samples = [];
  for (const p of pool) {
    const id = playerIdFromName(p.name);
    const rows = realGamesById.get(id);
    if (!rows || rows.length < minGames) continue;
    samples.push({ playerId: id, games: rows });
  }
  return samples;
}

/** The per-stat log-log line in 36/MPG, the shape predictInflation reads. */
export function fitFillLevels(points) {
  return Object.fromEntries(V.CHART_STATS.map(s => [s, V.fitLevel(points[s])]));
}

export const LEVEL_SCALE_ITERATIONS = 4;

/** A raw band set's expected value per slot — the same measure on both sides of the match below. */
export const bandsEv = bands =>
  bands.reduce((s, b) => s + b.value * b.slots, 0) / bands.reduce((s, b) => s + b.slots, 0);

/**
 * The row-level fit lands the MEAN of the normalized values; the chart is cut
 * from percentiles of them and rounded, and with the fitted spread that
 * rounding sat 9% light on rebounds and 14% on assists (2026-09-23). So, as
 * calibrateAttributes.js does for the published set, each stat's level is
 * then scaled until the synthetic rows' bands carry the same expected value
 * as the real rows' bands, player for player through computeStatBands. The
 * scale folds into the intercept: exp(a) multiplies the whole power law.
 */
export function scaleLevelsToBands({
  realGamesById,
  rates,
  pool,
  levels,
  shape,
  minGames = MIN_WINDOW_GAMES,
  iterations = LEVEL_SCALE_ITERATIONS,
  games = 82,
}) {
  const rateIndex = indexByName(rates);
  const players = [];
  for (const p of pool) {
    const rows = realGamesById.get(playerIdFromName(p.name));
    const rate = lookup(rateIndex, p.name);
    if (!rows || rows.length < minGames || !rate) continue;
    let minutes = 0;
    for (const g of rows) minutes += V.minutesToDecimal(g.minutes);
    players.push({
      rows,
      mpg: minutes / rows.length,
      per100: { pts: rate.pts100 ?? 0, reb: trb100(rate), ast: rate.ast100 ?? 0 },
    });
  }
  const want = Object.fromEntries(V.CHART_STATS.map(s => [s, 0]));
  for (const p of players) for (const s of V.CHART_STATS) want[s] += bandsEv(computeStatBands(p.rows, s));
  const scale = Object.fromEntries(V.CHART_STATS.map(s => [s, 1]));
  for (let pass = 0; pass < iterations; pass += 1) {
    const got = Object.fromEntries(V.CHART_STATS.map(s => [s, 0]));
    for (const p of players) {
      for (const s of V.CHART_STATS) {
        const fit = { level: { ...levels[s], a: levels[s].a + Math.log(scale[s]) }, shape };
        const synthetic = V.synthesizeGames({ per100: { [s]: p.per100[s] }, mpg: p.mpg, games, fit, sections: false });
        got[s] += bandsEv(computeStatBands(synthetic, s));
      }
    }
    for (const s of V.CHART_STATS) if (got[s] > 0) scale[s] *= want[s] / got[s];
  }
  const scaled = Object.fromEntries(
    V.CHART_STATS.map(s => [s, { ...levels[s], a: levels[s].a + Math.log(scale[s]) }])
  );
  return { levels: scaled, scale, players: players.length };
}

/** What the fitted level predicts at a few minute loads, for the report. */
export function levelTable(levels, mpgs = [12, 18, 24, 30, 36]) {
  return Object.fromEntries(
    V.CHART_STATS.map(s => [s, Object.fromEntries(mpgs.map(m => [m, Number(V.predictInflation({ level: levels[s] }, m).toFixed(3))]))])
  );
}

export function main({ log = console.log } = {}) {
  const rates = readCache(`dunksandthrees-epm-${CURRENT_STATS_SEASON}`);
  if (!rates) throw new Error(`no cached dunksandthrees rates for ${CURRENT_STATS_SEASON} — run scripts/cardgen/fetchCalibrationData.js first.`);
  const pool = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
  const realGamesById = loadAllRealGames();
  const { points, players } = levelPoints({ realGamesById, rates, pool });
  const rowLevels = fitFillLevels(points);
  const shape = V.fitSpreadShape(shapeSamples({ realGamesById, pool }));
  const { levels, scale } = scaleLevelsToBands({ realGamesById, rates, pool, levels: rowLevels, shape });
  const body = {
    generatedAt: new Date().toISOString(),
    basis:
      `the ${CURRENT_STATS_SEASON - 1}-${String(CURRENT_STATS_SEASON % 100).padStart(2, '0')} pool: each player's real ` +
      'last-82 window as realGames.js hands it to computeStatBands (opponent-adjusted, minutes-damped, ' +
      "winsorized), against the per-4-minute rate of dunksandthrees' predicted per-100 line",
    minWindowGames: MIN_WINDOW_GAMES,
    players,
    // The row-level fit, then the band-matched scale folded into it (the
    // `levels` the fill reads).
    rowLevels,
    levelScale: scale,
    levels,
    predicted: levelTable(levels),
    // The spread, from the same rows (variance.js, fitSpreadShape) — read by
    // synthesizeGames with `sections: false`.
    shape,
  };
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(body, null, 1)}\n`);
  log(`Live fill level: ${players} players with ${MIN_WINDOW_GAMES}+ real games -> ${path.relative(REPO_ROOT, OUTPUT_FILE)}`);
  log(`  shape: ${shape.players} players' windows, ${shape.grid.length}-point quantile curve`);
  for (const s of V.CHART_STATS) {
    const f = levels[s];
    log(`  ${s}: ${points[s].length} points, rows exp(${rowLevels[s].a.toFixed(3)}) x scale ${scale[s].toFixed(3)} ` +
      `-> ratio = exp(${f.a.toFixed(3)}) x (36/MPG)^${f.b.toFixed(3)}, r2 ${f.r2.toFixed(3)}; ` +
      `at 12/24/36 mpg ${body.predicted[s][12]} / ${body.predicted[s][24]} / ${body.predicted[s][36]}`);
  }
  return body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
