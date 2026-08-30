// Pulls the WNBA CAREER archive the legends set is built from.
//
//   node scripts/cardgen/wnba/fetchWnbaHistory.js
//   node scripts/cardgen/wnba/fetchWnbaHistory.js --force
//
// Writes the same per-season cache entries scripts/cardgen/wnba/fetchWnba.js
// writes — `wnba-{season}-{kind}.json` — for every season back to the league's
// first. Nothing new is invented here: the archive IS the set of season tables,
// so this file is a season LIST and a loop, and `readSeason` reads 1997 exactly
// as it reads 2026.
//
// card-data/cache/ is gitignored, so a fresh checkout has to run this once
// before generateWnbaLegends.js will do anything. What is committed is the
// derived roster in card-data/generated/.
//
// ── THE COLUMN SET DOES NOT CHANGE, WHICH IS THE WHOLE REASON THIS IS CHEAP ──
//
// Verified against live pages 2026-08-30, on 1997, 2001 and 2005: the advanced
// table carries `per ts_pct efg_pct fg3a_per_fga_pct fta_per_fga_pct orb_pct
// trb_pct ast_pct stl_pct blk_pct tov_pct usg_pct off_rtg def_rtg ows dws ws
// ws_per_40` in the league's FIRST SEASON, identically to 2026, and the per-100
// table carries the full box score in the same season. Every input
// wnba/bpmModel.js needs therefore exists for every year the legends played.
//
// THAT IS A STATEMENT ABOUT COLUMNS AND NOT ABOUT MEANING — see
// generateWnbaLegends.js's `auditModelInputs`, which checks how many rows
// actually CARRY each value per season and reports the earliest season the
// model can honestly be evaluated on. A published column full of blanks would
// pass the check above and fail that one.
//
// ── WHAT IS NOT FETCHED ─────────────────────────────────────────────────────
//
// PACE, deliberately, and it is the one omission worth stating. The 2026 set
// measures league pace per season because it reports the possession value of a
// four-minute section. It is not on the path from a box score to a card: a
// chart is anchored on `4 * total / minutes`, which is arithmetic with no pace
// in it (see wnba/constants.js). Fetching 28 more season summary pages to
// print a number nothing consumes is 28 more requests against someone else's
// server.
//
// THE ROSTER, for the obvious reason: every player in this set is retired.

import { pathToFileURL } from 'node:url';
import { readCache, politeDelay, DEFAULT_REQUEST_SPACING_MS } from '../cache.js';
import { fetchTable, fetchSplits, TABLE_KINDS, tableCacheKey } from './fetchWnba.js';
import { WNBA_FIRST_SEASON, WNBA_LAST_ARCHIVED_SEASON } from './constants.js';

/** Every season the archive covers, oldest first. */
export function archivedSeasons(
  first = WNBA_FIRST_SEASON,
  last = WNBA_LAST_ARCHIVED_SEASON
) {
  const out = [];
  for (let s = first; s <= last; s += 1) out.push(s);
  return out;
}

/** Which seasons are already complete in the cache, and which are not. */
export function cachedSeasons(seasons = archivedSeasons()) {
  const have = [];
  const missing = [];
  for (const season of seasons) {
    const complete =
      TABLE_KINDS.every(kind => readCache(tableCacheKey(season, kind))) &&
      readCache(`wnba-${season}-pergame-splits`);
    (complete ? have : missing).push(season);
  }
  return { have, missing };
}

export async function main({ force = false, log = console.log, seasons } = {}) {
  const wanted = seasons ?? archivedSeasons();
  log(`WNBA archive: ${wanted.length} seasons, ${wanted[0]}-${wanted[wanted.length - 1]}.`);
  let fetched = 0;
  for (const season of wanted) {
    const counts = [];
    for (const kind of TABLE_KINDS) {
      const before = readCache(tableCacheKey(season, kind));
      const rows = await fetchTable(season, kind, { force });
      counts.push(`${kind} ${rows.length}`);
      if (!before || force) {
        fetched += 1;
        await politeDelay(DEFAULT_REQUEST_SPACING_MS);
      }
    }
    const hadSplits = readCache(`wnba-${season}-pergame-splits`);
    const splits = await fetchSplits(season, { force });
    counts.push(`splits ${splits.length}`);
    if (!hadSplits || force) {
      fetched += 1;
      await politeDelay(DEFAULT_REQUEST_SPACING_MS);
    }
    log(`  ${season}  ${counts.join('  ')}${!fetched ? '' : ''}`);
  }
  log(`\n${fetched} requests made; the rest came from the cache.`);
  return wanted;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main({ force: process.argv.includes('--force') }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
