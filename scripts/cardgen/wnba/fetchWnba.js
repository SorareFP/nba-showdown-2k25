// Pulls every WNBA input the set is built from.
//
//   node scripts/cardgen/wnba/fetchWnba.js
//   node scripts/cardgen/wnba/fetchWnba.js --force
//
// Writes card-data/cache/wnba-{season}-{kind}.json, wnba-{season}-pace.json and
// wnba-roster.json. That directory is GITIGNORED — it is a bulk copy of two
// other people's data and this repo is public — so a fresh checkout has to run
// this once before either generator will do anything. What IS committed is the
// derived output in card-data/generated/, which is what the studio and the game
// read, and neither of those ever touches the network.
//
// TWO SEASONS, and they are not the same job:
//
//   2026  the set's season. All three tables, all 230 players.
//   2025  fetched for ONE reason — the six force-included stars whose 2026
//         sample is eleven to nineteen games. Their two seasons are pooled by
//         volume (see pool.js). Everyone else is carded on 2026 alone.
//
// The PACE is fetched per season and not per-team, and it is fetched at all
// because a WNBA four-minute section is `pace * 4/40` possessions and there is
// no conventional round number to assume — see wnba/constants.js.
//
// The ROSTER is not a season at all. wnba.com serves who is on which team right
// now, and it is the only source that can place a player Basketball-Reference
// files under `TOT`. See sources/wnbaRoster.js and wnba/resolveWnbaTeams.js.

import { pathToFileURL } from 'node:url';
import { cached, readCache, writeCache, politeDelay, DEFAULT_REQUEST_SPACING_MS } from '../cache.js';
import {
  fetchWnbaSeasonTable,
  fetchWnbaLeaguePace,
  trimWnbaTable,
  dedupeByMaxGames,
} from '../sources/wnbaReference.js';
import { fetchWnbaRoster } from '../sources/wnbaRoster.js';
import { WNBA_SEASON, WNBA_BLEND_SEASON } from './constants.js';

export const TABLE_KINDS = ['perGame', 'advanced', 'perPoss', 'totals'];

export const tableCacheKey = (season, kind) => `wnba-${season}-${kind.toLowerCase()}`;
export const paceCacheKey = season => `wnba-${season}-pace`;

/**
 * The live roster's key, which has NO SEASON IN IT, unlike every other key
 * here.
 *
 * That is the point rather than an omission: the tables are a record of a
 * season and never change again, and this is a snapshot of who is on which
 * roster right now. Keying it by season would suggest it could be re-fetched
 * for 2025, which it cannot — wnba.com serves today's rosters and only today's.
 * Re-fetch it with --force when a card should reflect a move that has happened
 * since.
 */
export const ROSTER_CACHE_KEY = 'wnba-roster';

/**
 * One season table, deduped to one row per player.
 *
 * THE SPLIT ROWS ARE DROPPED HERE, unlike the NBA history fetch which keeps
 * them to resolve a traded player's team. The WNBA path resolves the display
 * team from the per-game table's splits instead, and that table is fetched
 * whole below — see fetchWnbaSplits.
 */
export async function fetchTable(season, kind, { force = false } = {}) {
  return cached(
    tableCacheKey(season, kind),
    async () => dedupeByMaxGames(trimWnbaTable(await fetchWnbaSeasonTable(season, kind), kind)),
    { force, meta: { source: 'basketball-reference.com/wnba', season, kind } }
  );
}

/**
 * The per-game table WITHOUT the dedup — every row, splits included.
 *
 * Needed for exactly one thing: a player who moved mid-season carries `TOT` as
 * her team, which is not a team and themes to the neutral grey fallback. The
 * splits are the only record of which franchise to print. Cached under its own
 * key so the deduped table stays byte-identical to what every other consumer
 * reads.
 */
export async function fetchSplits(season, { force = false } = {}) {
  return cached(
    `wnba-${season}-pergame-splits`,
    async () => trimWnbaTable(await fetchWnbaSeasonTable(season, 'perGame'), 'perGame'),
    { force, meta: { source: 'basketball-reference.com/wnba', season, kind: 'perGame-splits' } }
  );
}

/**
 * wnba.com's current active-player list, the CURRENT-TEAM source.
 *
 * Basketball-Reference reports a mid-season move as `TOT`, which is not a team.
 * This is the only source that says where a player actually is — see
 * wnba/resolveWnbaTeams.js, and sources/nbaRoster.js for the NBA's identical
 * arrangement.
 */
export async function fetchRoster({ force = false } = {}) {
  return cached(ROSTER_CACHE_KEY, fetchWnbaRoster, {
    force,
    meta: { source: 'wnba.com/players', kind: 'roster' },
  });
}

export async function fetchPace(season, { force = false } = {}) {
  return cached(paceCacheKey(season), async () => fetchWnbaLeaguePace(season), {
    force,
    meta: { source: 'basketball-reference.com/wnba', season, kind: 'pace' },
  });
}

/** The cached roster. `[]` if it was never fetched, which is a runnable state. */
export function readRoster() {
  return readCache(ROSTER_CACHE_KEY) ?? [];
}

/** Everything one season contributes, from the cache. Null if it was never fetched. */
export function readSeason(season) {
  const tables = {};
  for (const kind of TABLE_KINDS) {
    const rows = readCache(tableCacheKey(season, kind));
    if (!rows) return null;
    tables[kind] = rows;
  }
  return {
    season,
    ...tables,
    splits: readCache(`wnba-${season}-pergame-splits`) ?? [],
    pace: readCache(paceCacheKey(season))?.pace ?? null,
  };
}

export async function main({ force = false, log = console.log, seasons } = {}) {
  const wanted = seasons ?? [WNBA_SEASON, WNBA_BLEND_SEASON];
  const paces = {};
  for (const season of wanted) {
    log(`WNBA ${season}...`);
    for (const kind of TABLE_KINDS) {
      const before = readCache(tableCacheKey(season, kind));
      const rows = await fetchTable(season, kind, { force });
      log(`  ${kind.padEnd(9)} ${rows.length} players${before && !force ? ' (cached)' : ''}`);
      if (!before || force) await politeDelay(DEFAULT_REQUEST_SPACING_MS);
    }
    const hadSplits = readCache(`wnba-${season}-pergame-splits`);
    const splits = await fetchSplits(season, { force });
    log(`  splits    ${splits.length} rows${hadSplits && !force ? ' (cached)' : ''}`);
    if (!hadSplits || force) await politeDelay(DEFAULT_REQUEST_SPACING_MS);

    const hadPace = readCache(paceCacheKey(season));
    const pace = await fetchPace(season, { force });
    paces[season] = pace.pace;
    log(
      `  pace      ${pace.pace} possessions per 40 min over ${pace.teams} teams` +
        `${hadPace && !force ? ' (cached)' : ''}`
    );
    if (!hadPace || force) await politeDelay(DEFAULT_REQUEST_SPACING_MS);
  }

  // The roster, once — it is not a per-season thing. Last, so a wnba.com
  // outage cannot cost a Basketball-Reference fetch that already succeeded.
  const hadRoster = readCache(ROSTER_CACHE_KEY);
  const roster = await fetchRoster({ force });
  const rostered = roster.filter(p => p.team).length;
  log(
    `wnba.com roster ${roster.length} current players, ${rostered} on a team ` +
      `(${roster.length - rostered} unsigned)${hadRoster && !force ? ' (cached)' : ''}`
  );

  log('');
  log('Measured league pace — copy into WNBA_LEAGUE_PACE in wnba/constants.js if it moved:');
  for (const [season, pace] of Object.entries(paces)) {
    log(`  ${season}: ${pace},   -> ${((pace * 4) / 40).toFixed(3)} possessions per 4-min section`);
  }
  return paces;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main({ force: process.argv.includes('--force') }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

export { writeCache };
