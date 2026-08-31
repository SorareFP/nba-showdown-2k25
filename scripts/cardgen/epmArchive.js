// THE ABSOLUTE SPEED+POWER REFERENCE — every cardable NBA season since 2002.
//
//   node --env-file=.env.local scripts/cardgen/epmArchive.js
//
// Writes card-data/generated/epm-archive.json, which is COMMITTED and is the
// one yardstick every card in every set is priced against.
//
// ── THE PROBLEM THIS FILE EXISTS TO FIX ─────────────────────────────────────
//
// Speed+Power used to be calibrated WITHIN THE POOL BEING CARDED. `compositeScores`
// z-scored EPM and Estimated Wins against the 2025-26 pool's own mean and spread,
// and `mapToReferenceScale` then z-scored the composite against that same pool
// again. Every historical set did the same thing with the current pool standing
// in as the basis. The consequence is structural rather than incidental:
//
//   WHOEVER LEADS A SEASON GETS THE TOP OF THE SCALE BY CONSTRUCTION. A weak
//   year's best player and a genuine all-time peak both land on the ceiling,
//   because each is measured only against the people he happened to play with.
//
// The user's words: "seeing as we have all this EPM data, I think we can use it
// across all years and distribute power/speed based on the entire data set. It
// shouldn't just be a 'this guy was the best by EPM this season so he
// automatically gets 34 power+speed' thing. It should be relative to the whole
// dataset."
//
// So the basis is no longer a pool. It is every cardable player-season
// dunksandthrees has, 2002 through 2026 — 7,773 of them — and a 2026-27 card, a
// 2009 Super Season card and a WNBA card are all placed on it.
//
// WHAT THAT ACTUALLY BUYS, measured (see the run report, and card-data/analysis):
// the number of players reaching the printed ceiling now varies by season the
// way the seasons themselves do. 2002 puts NOBODY on it; 2004, 2005, 2007 and
// 2011 put exactly one; 2017 and 2019 put seven. Under per-pool calibration
// every one of those seasons produced the same two or three ceiling cards,
// because the ceiling was a property of the scale rather than of the players.
//
// ── WHY IT IS NOT SIMPLY "z AGAINST 25 SEASONS INSTEAD OF ONE" ──────────────
//
// It nearly is, and it is worth saying exactly how little of the change is in
// the LEVEL, because that is the part people expect to move and it does not.
// EPM is re-centred every season at source: the mean EPM of the cardable players
// in a season runs between -0.35 and -0.13 across all 25, and the mean COMPOSITE
// between -0.07 and +0.07. So pooling the seasons barely moves the middle of the
// distribution, and a current player's card is not systematically demoted.
//
// The two things that DO move are the two that matter:
//
//   SPREAD. Season-to-season composite sd runs 1.21 (2004) to 1.47 (2019)
//   against a pooled 1.34, and it has trended up — the 2002-2011 seasons are
//   narrower than the 2015-2026 ones. Per-pool calibration forced every season
//   to exactly the reference spread, which silently declared every season
//   equally top-heavy. It is not, and now it does not have to be.
//
//   THE TAIL ANCHOR, which is the whole ballgame. `mapToReferenceScale` earns
//   its ceiling by anchoring on the (1 - ceilingShare) quantile of the basis.
//   Against one 331-player pool that quantile is "the third-best player this
//   year", whoever he is. Against 7,773 player-seasons it is the 56th-best
//   season since 2002 — an absolute standard, which a strong year clears more
//   often than a weak one.
//
// ── WHAT COUNTS AS "THE DATASET" ────────────────────────────────────────────
//
// CARDABLE PLAYER-SEASONS, by the pool's own rule (POOL_RULE: MPG >= 12 and
// G >= 40), applied to every season identically. Not every row the API serves:
// about 40% of those are players who would never have been carded, and including
// them would define the scale against a population the card set does not contain
// — pulling the mean down and inflating every carded player's z-score.
//
// THE RULE IS APPLIED UNSCALED to the four short seasons in range (2012's 66
// games, 2020's 65-75, 2021's 72). A 40-game bar is proportionally easier to
// clear in a 66-game season, so those seasons admit a few more marginal players
// than a full one would. Measured: 2012 keeps 293 of 483 and 2020 keeps 306 of
// 550, both squarely inside the 283-339 band every other season lands in, so the
// distortion is smaller than the season-to-season variation it would be
// correcting. Scaling the bar by `rosterGames` was tried and moved the archive
// mean by 0.004 composite points, which cannot survive rounding onto an integer
// Speed+Power scale.
//
// REGULAR SEASON AND PLAYOFFS, folded by poolSeasons.js exactly as the current
// pool folds them. This is not a detail: the composites being MAPPED are pooled,
// so a basis built on regular-season rows alone would be measuring a slightly
// different quantity from the one it calibrates, and the top of the distribution
// — where deep playoff runs live — is precisely where that would show.
//
// NO PRIOR-SEASON BLEND. priorSeasonBlend.js folds a previous season into the
// current one for nineteen injury-shortened force-includes, which is a statement
// about those nineteen cards and not about the population. The archive is one
// row per player-season, full stop.
//
// ── THE FILE IS COMMITTED; THE CACHE IS NOT ─────────────────────────────────
//
// card-data/cache is gitignored (it is a bulk copy of someone else's data), so
// this module writes everything a generator needs — the input means and spreads,
// and the sorted composite distribution itself — into card-data/generated. A
// checkout with no cache and no API key regenerates every card set bit-for-bit.
// That is the same contract REFERENCE_TOTALS and the calibration file already
// keep, and it is why the composites are stored rather than recomputed.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from './cache.js';
import { poolActualRow } from './poolSeasons.js';
import { POOL_RULE } from './generatePool.js';
import { meanSd } from './attributes.js';
import { CURRENT_STATS_SEASON } from './fetchCalibrationData.js';
import * as dtApi from './sources/dunksAndThreesApi.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const ARCHIVE_FILE = path.join(GEN_DIR, 'epm-archive.json');

/** The API's own floor — `season=2001` answers 400. See dunksAndThreesApi.js. */
export const FIRST_ARCHIVE_SEASON = dtApi.FIRST_API_SEASON;
export const LAST_ARCHIVE_SEASON = CURRENT_STATS_SEASON;

/**
 * Who is in the population, and it is deliberately the POOL's rule.
 *
 * The scale exists to spread a card set across a range, so the population that
 * defines it should be the population that gets carded. Imported rather than
 * restated so the two cannot drift.
 */
export const ARCHIVE_RULE = POOL_RULE;

/** How much the Estimated-Wins refinement moves the EPM-led ranking. */
export const REFINEMENT_WEIGHT = 0.35;

/**
 * How many of the archive's own composites are kept in the committed file.
 *
 * ALL OF THEM. The tail anchor is a quantile of this distribution and the
 * distribution's shape above the knee is exactly what the taper is fitted to, so
 * a summary would have to carry enough quantiles to reconstruct it anyway. At
 * four decimal places the whole thing is about 60KB, which is smaller than the
 * biometrics table already in the same directory.
 */
const COMPOSITE_PRECISION = 4;

/** One season's regular and playoff rows, folded into one row per player. */
export function seasonRows(season) {
  const regular = readCache(dtApi.seasonEpmCacheKey(season, dtApi.SEASON_TYPE_REGULAR));
  if (!regular) return null;
  const playoffs = readCache(dtApi.seasonEpmCacheKey(season, dtApi.SEASON_TYPE_PLAYOFFS)) ?? [];
  const byId = new Map(playoffs.map(r => [r.personId, r]));
  return regular.map(r => ({
    ...poolActualRow(r, byId.get(r.personId) ?? null),
    season: r.season ?? season,
  }));
}

/** Every cached season's pooled rows, and which seasons were actually on disk. */
export function collectRows({ first = FIRST_ARCHIVE_SEASON, last = LAST_ARCHIVE_SEASON } = {}) {
  const rows = [];
  const seasons = [];
  for (let season = first; season <= last; season += 1) {
    const got = seasonRows(season);
    if (!got) continue;
    seasons.push(season);
    rows.push(...got);
  }
  return { rows, seasons };
}

/** The rule, as a predicate. A row missing either input is not evidence. */
export function isCardable(row, rule = ARCHIVE_RULE) {
  return (
    !!row &&
    (row.mpg ?? 0) >= rule.minMpg &&
    (row.games ?? 0) >= rule.minGames &&
    Number.isFinite(row.epm) &&
    Number.isFinite(row.ewinsPerGame)
  );
}

/**
 * The composite, from an EXPLICIT basis.
 *
 * Same formula the pool has always used — `z(EPM) + 0.35 * z(EW/GP)` — with the
 * z-scores now taken against whatever basis is handed in. speedPower.js hands in
 * this archive's; nothing computes a basis from the rows it is scoring any more.
 */
export function compositeFrom(row, basis, weight = REFINEMENT_WEIGHT) {
  const z = (v, s) => (Number.isFinite(v) && s?.sd > 0 ? (v - s.mean) / s.sd : 0);
  return z(row.epm, basis.epm) + weight * z(row.ewinsPerGame, basis.ewinsPerGame);
}

/** Linear-interpolated quantile of an ASCENDING array. Mirrors speedPower.js. */
export function quantile(ascending, p) {
  if (!ascending?.length) return null;
  const i = (ascending.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return ascending[lo] + (ascending[hi] - ascending[lo]) * (i - lo);
}

/**
 * Measures the archive: the input basis, the composite distribution, and the
 * distribution itself.
 *
 * `composites` comes back SORTED ASCENDING because every consumer either
 * z-scores against it (order-free) or takes a quantile of it (needs the sort),
 * and sorting once here is one less thing for a caller to remember.
 */
export function measureArchive(rows, { weight = REFINEMENT_WEIGHT, rule = ARCHIVE_RULE } = {}) {
  const cardable = (rows ?? []).filter(r => isCardable(r, rule));
  const basis = {
    epm: meanSd(cardable.map(r => r.epm)),
    ewinsPerGame: meanSd(cardable.map(r => r.ewinsPerGame)),
  };
  const scored = cardable.map(r => ({ row: r, composite: compositeFrom(r, basis, weight) }));
  const composites = scored.map(s => s.composite).sort((a, b) => a - b);
  const compositeStats = meanSd(composites);
  const seasons = [...new Set(cardable.map(r => r.season))].sort((a, b) => a - b);
  const bySeason = seasons.map(season => {
    const g = scored.filter(s => s.row.season === season);
    const m = meanSd(g.map(s => s.composite));
    return {
      season,
      players: g.length,
      mean: Number(m.mean.toFixed(4)),
      sd: Number(m.sd.toFixed(4)),
      max: Number(Math.max(...g.map(s => s.composite)).toFixed(4)),
    };
  });
  return {
    rule,
    weight,
    seasons,
    n: cardable.length,
    epm: { mean: Number(basis.epm.mean.toFixed(6)), sd: Number(basis.epm.sd.toFixed(6)) },
    ewinsPerGame: {
      mean: Number(basis.ewinsPerGame.mean.toFixed(6)),
      sd: Number(basis.ewinsPerGame.sd.toFixed(6)),
    },
    composite: {
      mean: Number(compositeStats.mean.toFixed(6)),
      sd: Number(compositeStats.sd.toFixed(6)),
    },
    bySeason,
    top: scored
      .slice()
      .sort((a, b) => b.composite - a.composite)
      .slice(0, 50)
      .map(s => ({
        name: s.row.name,
        season: s.row.season,
        epm: Number(s.row.epm.toFixed(2)),
        ewinsPerGame: Number(s.row.ewinsPerGame.toFixed(4)),
        composite: Number(s.composite.toFixed(4)),
      })),
    composites: composites.map(c => Number(c.toFixed(COMPOSITE_PRECISION))),
  };
}

/**
 * The committed archive, or null before it has been built.
 *
 * Returns null rather than throwing so a caller can decide: the generators
 * throw with a sentence saying how to build it, and the tests exercise the
 * measurement directly on fixtures.
 */
export function loadArchive(file = ARCHIVE_FILE) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The archive, or a message saying exactly how to produce one. */
export function requireArchive(file = ARCHIVE_FILE) {
  const archive = loadArchive(file);
  if (archive) return archive;
  throw new Error(
    `No absolute Speed+Power reference at ${path.relative(REPO_ROOT, file)}. Run \`node ` +
      '--env-file=.env.local scripts/cardgen/epmArchive.js\` to build it from the 2002-2026 ' +
      'season-epm archive. It is a committed file, so this should only happen mid-rebuild.'
  );
}

/** The input basis in the shape `compositeFrom` wants. */
export const archiveBasis = archive => ({ epm: archive.epm, ewinsPerGame: archive.ewinsPerGame });

export async function main({ fetch = true, force = false, log = console.log } = {}) {
  if (fetch) {
    for (let season = FIRST_ARCHIVE_SEASON; season <= LAST_ARCHIVE_SEASON; season += 1) {
      for (const seasonType of [dtApi.SEASON_TYPE_REGULAR, dtApi.SEASON_TYPE_PLAYOFFS]) {
        if (!force && readCache(dtApi.seasonEpmCacheKey(season, seasonType))) continue;
        const rows = await dtApi.fetchSeasonEpm(season, { seasonType, force, log });
        log(`  fetched ${season} st${seasonType}: ${rows.length} rows`);
      }
    }
  }

  const { rows, seasons } = collectRows();
  if (seasons.length === 0) {
    throw new Error(
      'No cached season-epm data. Run with --env-file=.env.local so the API key is available.'
    );
  }
  const archive = measureArchive(rows);
  // One number per line would be 7,773 lines of noise, so the distribution goes
  // on ONE line and every part a human reads stays indented. The placeholder is
  // the only way to mix the two spellings in a single `JSON.stringify`.
  const { composites, ...rest } = archive;
  const body = JSON.stringify(
    { generatedAt: new Date().toISOString(), ...rest, composites: '@@COMPOSITES@@' },
    null,
    1
  );
  fs.writeFileSync(ARCHIVE_FILE, `${body.replace('"@@COMPOSITES@@"', JSON.stringify(composites))}\n`);

  log(
    `${archive.n} cardable player-seasons (${seasons[0]}-${seasons[seasons.length - 1]}, ` +
      `MPG>=${archive.rule.minMpg} & G>=${archive.rule.minGames}) of ${rows.length} rows ` +
      `-> ${path.relative(REPO_ROOT, ARCHIVE_FILE)}`
  );
  log(
    `  EPM mean ${archive.epm.mean.toFixed(3)} sd ${archive.epm.sd.toFixed(3)} | ` +
      `EW/GP mean ${archive.ewinsPerGame.mean.toFixed(4)} sd ${archive.ewinsPerGame.sd.toFixed(4)}`
  );
  log(
    `  composite mean ${archive.composite.mean.toFixed(4)} sd ${archive.composite.sd.toFixed(4)}`
  );
  const asc = archive.composites;
  log(
    `  quantiles p50 ${quantile(asc, 0.5).toFixed(3)} p90 ${quantile(asc, 0.9).toFixed(3)} ` +
      `p99 ${quantile(asc, 0.99).toFixed(3)} p99.9 ${quantile(asc, 0.999).toFixed(3)} ` +
      `max ${asc[asc.length - 1].toFixed(3)}`
  );
  // The season table is the evidence for the whole change: if these means were
  // all different the recalibration would be re-levelling the sets rather than
  // re-ranking them, and if the spreads were all the same there would have been
  // nothing wrong with per-pool calibration in the first place.
  log('  per season (mean / sd / best composite):');
  for (const s of archive.bySeason) {
    log(
      `    ${s.season}  n=${String(s.players).padStart(3)}  mean ${s.mean.toFixed(3).padStart(6)} ` +
        `sd ${s.sd.toFixed(3)}  max ${s.max.toFixed(3)}`
    );
  }
  log('  the ten best seasons in the archive:');
  for (const t of archive.top.slice(0, 10)) {
    log(
      `    ${t.composite.toFixed(3).padStart(6)}  ${t.season} ${t.name.padEnd(24)} ` +
        `EPM ${t.epm.toFixed(2)} EW/GP ${t.ewinsPerGame.toFixed(3)}`
    );
  }
  return archive;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
