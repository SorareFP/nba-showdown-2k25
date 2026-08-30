// Pulls the CAREER history the two computable special sets are built from.
//
//   node scripts/cardgen/fetchHistory.js
//   node scripts/cardgen/fetchHistory.js --force   (ignore the cache)
//
// Writes ONE cache entry, card-data/cache/bbref-history.json, which
// scripts/cardgen/generateSpecialSets.js reads with no network at all.
//
// ── WHY BASKETBALL-REFERENCE, AND ONLY BASKETBALL-REFERENCE ─────────────────
//
// dunksandthrees' prior seasons are hard-paywalled — re-verified 2026-08-30:
// `season=2025` answers `{"type":"redirect","location":"/subscribe?reason=
// locked-season"}` and `season=2024-25` answers 403. So EPM, Estimated Wins and
// rim FG% — the three inputs the current Speed/Power budget, Def Boost and
// Paint Boost run on — do not exist for any season before the current one.
// Everything here is the Basketball-Reference substitute, and every card built
// from it is marked provisional for that reason.
//
// ── WHY IT STORES SUMMARIES PLUS A FILTERED SLICE, NOT THE WHOLE ARCHIVE ────
//
// Twenty-seven seasons of two full league tables is ~10MB of JSON, and the
// generators need exactly two things from it:
//
//   1. Every SEASON's own distribution of BPM / VORP / WS / WS-per-48, so a
//      season can be scored against its contemporaries rather than against a
//      league that played at a different pace with a different three-point
//      rate. That is four means and four standard deviations per season — a few
//      hundred bytes, computed here over the FULL table. All four are cached
//      even though the best-season rule now scores on BPM alone; see
//      ARCHIVED_METRICS.
//   2. The rows belonging to players who are actually being carded.
//
// So the summaries are computed over everything and the rows are filtered down
// to the card pool. THE CONSEQUENCE, and it is the one thing to remember about
// this file: change the pool and this cache is stale in a way its key cannot
// express. Re-run with --force after regenerating player-pool-2026.json.
//
// SPLIT ROWS ARE KEPT. A player traded mid-season gets one "2TM"/"3TM"
// aggregate row plus one row per team, and both are needed for different jobs:
// the aggregate is the season's real stat line, and the splits are the only
// record of WHICH team to put on the card. See resolveSeasonTeam.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, cachePath, politeDelay, DEFAULT_REQUEST_SPACING_MS, REPO_ROOT } from './cache.js';
import * as bbref from './sources/basketballReference.js';
import { trimSeasonTable } from './fetchCalibrationData.js';
import { normalizeName } from './resolveTeams.js';

/** The 350 players who get a base card — the definition of "active" here. */
export const POOL_FILE = path.join(REPO_ROOT, 'card-data', 'generated', 'player-pool-2026.json');

export function loadPool(file = POOL_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The cache entry this script owns. */
export const HISTORY_CACHE_KEY = 'bbref-history';

/**
 * The earliest season fetched, as an END year (2000 = the 1999-2000 season).
 *
 * Set by the OLDEST ACTIVE PLAYER, with room to spare. LeBron James debuted in
 * 2003-04 and is the longest-tenured player in the 2026-27 pool, so 2004 would
 * technically do; four extra seasons cost about forty seconds of polite delay
 * and cover both a late-career surprise and the legends extension the design
 * notes anticipate (which is what reaches back to the Vancouver Grizzlies).
 */
export const FIRST_SEASON = 2000;

/** The most recent season, and the one the exclusion rules are stated against. */
export const LAST_SEASON = 2026;

/**
 * Minutes a player-season needs before it counts toward a season's DISTRIBUTION.
 *
 * Not an eligibility rule for cards — that lives in generateSpecialSets.js.
 * This is only about what "an average season" means: a league table's bottom
 * two hundred rows are ten-minute cups of coffee whose WS/48 is noise, and
 * leaving them in drags every mean down and inflates every standard deviation,
 * which would flatter every real season's z-score equally.
 */
export const DISTRIBUTION_MIN_MINUTES = 500;

/**
 * The metrics the archive summarises per season — the MENU, not the rule.
 *
 * All four are measured and cached because a per-season mean and sd costs a few
 * hundred bytes and re-fetching twenty-seven league tables to add one back costs
 * twenty minutes of polite delay. WHICH of them the best-season rule actually
 * scores on is declared in history.js (`BEST_SEASON_WEIGHTS`), and as of the
 * Win Shares removal that is BPM alone. `ws` and `ws48` stay here so the run
 * report can still say what they would have chosen — and so the decision to
 * ignore them is visible rather than invisible.
 */
export const ARCHIVED_METRICS = ['bpm', 'vorp', 'ws', 'ws48'];

/** Basketball-Reference's multi-team aggregate codes. Not teams. */
export const AGGREGATE_TEAMS = new Set(['TOT', '2TM', '3TM', '4TM', '5TM']);

export const isAggregateTeam = team => AGGREGATE_TEAMS.has(String(team ?? '').toUpperCase());

function meanSd(values) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return { mean: v[0] ?? 0, sd: 0, n: v.length };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1);
  return { mean: Number(mean.toFixed(4)), sd: Number(Math.sqrt(variance).toFixed(4)), n: v.length };
}

/**
 * One row per player for the purpose of measuring a season's distribution.
 *
 * The aggregate row of a traded player covers his whole season and has the most
 * games, so keeping the max-games row both dedupes the splits away and keeps
 * the complete line — the same rule the pool and the calibration snapshot use.
 */
export function dedupeForDistribution(rows) {
  const best = new Map();
  for (const row of rows) {
    const prev = best.get(row.playerId);
    if (!prev || (row.games ?? 0) > (prev.games ?? 0)) best.set(row.playerId, row);
  }
  return [...best.values()];
}

/** Mean and sd of each best-season metric among that season's real contributors. */
export function seasonDistribution(advancedRows) {
  const qualified = dedupeForDistribution(advancedRows).filter(
    r => (r.minutes ?? 0) >= DISTRIBUTION_MIN_MINUTES
  );
  const metrics = {};
  for (const key of ARCHIVED_METRICS) metrics[key] = meanSd(qualified.map(r => r[key]));
  return { players: qualified.length, metrics };
}

/**
 * Everything one player-season contributes, from both tables joined.
 *
 * Joined on Basketball-Reference's own player id AND the team code, so a traded
 * player's aggregate row joins to his aggregate row and each split to its own
 * split rather than all of them collapsing onto the first match.
 */
export function joinSeasonTables(season, advanced, perPoss) {
  const rates = new Map(perPoss.map(r => [`${r.playerId}|${r.team}`, r]));
  return advanced.map(a => {
    const p = rates.get(`${a.playerId}|${a.team}`) ?? null;
    return {
      season,
      playerId: a.playerId,
      name: a.name,
      team: a.team,
      pos: a.pos ?? p?.pos ?? null,
      age: a.age ?? null,
      games: a.games ?? null,
      minutes: a.minutes ?? null,
      bpm: a.bpm ?? null,
      obpm: a.obpm ?? null,
      dbpm: a.dbpm ?? null,
      vorp: a.vorp ?? null,
      ws: a.ws ?? null,
      ws48: a.ws48 ?? null,
      per: a.per ?? null,
      tsPct: a.tsPct ?? null,
      usgPct: a.usgPct ?? null,
      pts100: p?.pts100 ?? null,
      trb100: p?.trb100 ?? null,
      ast100: p?.ast100 ?? null,
      fga100: p?.fga100 ?? null,
      fg3a100: p?.fg3a100 ?? null,
      fg2a100: p?.fg2a100 ?? null,
      fta100: p?.fta100 ?? null,
      fgPct3: p?.fgPct3 ?? null,
      fgPct2: p?.fgPct2 ?? null,
      ftPct: p?.ftPct ?? null,
    };
  });
}

/**
 * Fetches one season table, caching the RAW trimmed league table per season so
 * a re-run that only widens the name filter costs nothing.
 *
 * Deliberately reuses the `bbref-{season}-{kind}` key the calibration snapshot
 * already owns for 2025 — same site, same parser, same trim — except that these
 * keep the split rows, which is why the key carries `-full`.
 */
async function seasonTable(season, kind, { force }) {
  const key = `bbref-${season}-${kind}-full`;
  if (!force) {
    const hit = readCache(key);
    if (hit) return { rows: hit, fetched: false };
  }
  const rows = trimSeasonTable(await bbref.fetchSeasonTable(season, kind), kind);
  fs.mkdirSync(cachePath(key).replace(/[/\\][^/\\]+$/, ''), { recursive: true });
  fs.writeFileSync(
    cachePath(key),
    `${JSON.stringify({ fetchedAt: new Date().toISOString(), source: 'basketball-reference.com', season, kind, data: rows })}\n`
  );
  return { rows, fetched: true };
}

export async function main({ force = false, log = console.log } = {}) {
  const pool = loadPool();
  const wanted = new Set(pool.map(p => normalizeName(p.name)));
  log(`Pool: ${pool.length} players. Seasons ${FIRST_SEASON}-${LAST_SEASON}.`);

  const seasons = {};
  const rows = [];
  for (let season = FIRST_SEASON; season <= LAST_SEASON; season += 1) {
    const adv = await seasonTable(season, 'advanced', { force });
    if (adv.fetched) await politeDelay(DEFAULT_REQUEST_SPACING_MS);
    const poss = await seasonTable(season, 'perPoss', { force });
    if (poss.fetched) await politeDelay(DEFAULT_REQUEST_SPACING_MS);

    seasons[season] = seasonDistribution(adv.rows);
    const joined = joinSeasonTables(season, adv.rows, poss.rows);
    const kept = joined.filter(r => wanted.has(normalizeName(r.name)));
    rows.push(...kept);
    log(
      `  ${season}: ${adv.rows.length} rows, ${seasons[season].players} qualified, ` +
        `${kept.length} kept${adv.fetched || poss.fetched ? '' : ' (cached)'}`
    );
  }

  const body = {
    fetchedAt: new Date().toISOString(),
    source: 'basketball-reference.com',
    firstSeason: FIRST_SEASON,
    lastSeason: LAST_SEASON,
    poolPlayers: pool.length,
    data: { seasons, rows },
  };
  // Compact, not indented: this is 27 seasons of joined rows and the indented
  // form is three times the size for a file nobody reads by eye.
  fs.writeFileSync(cachePath(HISTORY_CACHE_KEY), `${JSON.stringify(body)}\n`);
  log(`Wrote ${rows.length} player-seasons to card-data/cache/${HISTORY_CACHE_KEY}.json`);
  return body.data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main({ force: process.argv.includes('--force') }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
