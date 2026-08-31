// What share of his minutes each carded player actually spent at each position.
//
//   node scripts/cardgen/positionShares.js
//   node scripts/cardgen/positionShares.js --force   (ignore the cache)
//
// Writes card-data/generated/position-shares.json, which attributes.js uses to
// split Speed and Power by a BLEND of the five positions rather than by the one
// label a player is filed under.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// The split rule was `POSITION_SPEED_SHARE[basePosition(pos)]`, and
// `basePosition` throws away everything but the first token: "SG-PG" is a
// shooting guard, "PF-C" is a power forward. That is a lossy summary of
// something Basketball-Reference actually measures. Its play-by-play page
// carries, per player-season, the percentage of his minutes spent at each of
// the five positions — James Harden's 2025-26 row reads PG 46 / SG 52 / SF 2
// under a `pos` label of "PG".
//
// The label forces a player into one bucket. The shares let him be a weighted
// blend of all five, and — this is the part that makes it more than a
// refinement — they let the SIZE term's baseline be blended too. The size term
// is a deviation from "the average build of this player's position", which
// previously required committing to one position to even state. With shares
// the baseline is the average build of his own positional mix, so the fudge is
// removed rather than a knob added. See speedShare in attributes.js.
//
// ── WHY IT IS A COMMITTED FILE RATHER THAN A CACHE READ ─────────────────────
//
// Same reason as player-biometrics.json: card-data/cache is gitignored (it is a
// bulk copy of someone else's data and this repo is public), so a GENERATOR may
// not depend on it. Calibration may — it already needs the gitignored reference
// CSV — and so calibrateAttributes.js reads the play-by-play cache directly for
// the 2024-25 season the finished cards were built from, while generation reads
// this committed table.
//
// ── ONE ROW PER PLAYER-SEASON, UNLIKE BIOMETRICS ────────────────────────────
//
// Height and weight are one listed figure per career, so player-biometrics.json
// folds the seasons together. Positional role is the opposite: it is the thing
// that MOVES. In this pool alone, 2026-27's shares differ from the same
// player's rookie-season shares by more than 40 points of PG-share for a dozen
// players. So the Super Season and Rookie sets read the shares of the season
// their card actually shows, keyed by `${playerId}|${season}` — never by name,
// because the archive contains six father/son name collisions and
// `normalizeName` strips the suffix that tells them apart. See history.js.
//
// ── WHY THE ROWS ARE FILTERED TO THE POOL ───────────────────────────────────
//
// 27 seasons of the full league table is ~16,000 player-seasons and about
// 700KB of someone else's data in a public repo. The pool is 350 players, and
// the only cards that exist are theirs. THE CONSEQUENCE, exactly as with
// card-data/cache/bbref-history.json: change the pool and this file is stale in
// a way nothing will notice. Re-run it after regenerating player-pool-2026.json.
//
// ── WHAT IS NOT COVERED ─────────────────────────────────────────────────────
//
// The WNBA. Checked, not assumed: /wnba/years/2025_play-by-play.html and
// /wnba/years/2026_play-by-play.html both answer 404 (verified 2026-08-31), and
// no WNBA table on the site carries a Position Estimate group. Every WNBA card
// therefore keeps the position-LABEL split it already had — `speedShare` takes
// the shares as optional for exactly this reason, so a league without them is
// unchanged rather than dropped.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, readCache, politeDelay, DEFAULT_REQUEST_SPACING_MS } from './cache.js';
import { fetchSeasonTableCached } from './fetchCalibrationData.js';
import { normalizeName } from './resolveTeams.js';
import { POSITIONS } from './attributes.js';

export const POSITION_SHARES_FILE = path.join(
  REPO_ROOT,
  'card-data',
  'generated',
  'position-shares.json'
);

export const POOL_FILE = path.join(REPO_ROOT, 'card-data', 'generated', 'player-pool-2026.json');

/**
 * The seasons fetched, as END years.
 *
 * The same window as fetchHistory.js, and for the same reason: the Rookie set
 * reaches back to whichever season the pool's oldest player debuted in (LeBron
 * James, 2003-04), and four seasons of headroom cost about twenty seconds of
 * polite delay.
 */
export const FIRST_SEASON = 2000;
export const LAST_SEASON = 2026;

/** The cache key one season's play-by-play table lands under. */
export const cacheKey = season => `bbref-${season}-playByPlay`;

/**
 * The five integer percentages, as fractions that sum to exactly 1.
 *
 * NORMALIZING IS NOT OPTIONAL. Basketball-Reference prints these rounded to
 * whole percents and the row totals 99, 100, 101 or 102 depending on where the
 * rounding fell. An un-normalized blend would therefore scale every player's
 * positional centre by up to 2%, which is a systematic error in the SAME
 * direction as the rounding rather than noise.
 *
 * Returns null — not a uniform guess — when the row carries no minutes at any
 * position. A player with no measurement should fall back to his label, and the
 * only way to say that is to hand back nothing.
 */
export function normalizeShares(pct) {
  if (!pct) return null;
  const raw = POSITIONS.map(p => (Number.isFinite(pct[p]) ? Math.max(pct[p], 0) : 0));
  const total = raw.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  return Object.fromEntries(POSITIONS.map((p, i) => [p, raw[i] / total]));
}

/**
 * One row per player-season, filtered to the pool, sorted for a readable diff.
 *
 * `seasonRows` is `{ [season]: trimmedPlayByPlayRows }`. Ids are resolved from
 * the MOST RECENT season only — the pool is built from that season, so every
 * pool player has a row in it, and resolving anywhere else is what would let a
 * father collect his son's career. Same rule as resolvePlayerIds.
 */
export function buildPositionShares({ seasonRows, pool, lastSeason = LAST_SEASON }) {
  const current = new Map();
  for (const row of seasonRows[lastSeason] ?? []) {
    const key = normalizeName(row.name);
    const prev = current.get(key);
    if (!prev || (row.games ?? 0) > (prev.games ?? 0)) current.set(key, row);
  }

  const ids = new Map();
  const missing = [];
  for (const p of pool) {
    const hit = current.get(normalizeName(p.name));
    if (hit) ids.set(hit.playerId, p.name);
    else missing.push(p.name);
  }

  const records = [];
  for (const season of Object.keys(seasonRows).map(Number).sort((a, b) => a - b)) {
    // A traded player has one aggregate row plus one per team; the aggregate
    // covers the whole season and always carries the most games, so max-games
    // per id is both the dedupe and the right pick. Same rule everywhere else.
    const best = new Map();
    for (const row of seasonRows[season] ?? []) {
      if (!ids.has(row.playerId)) continue;
      const prev = best.get(row.playerId);
      if (!prev || (row.games ?? 0) > (prev.games ?? 0)) best.set(row.playerId, row);
    }
    for (const row of best.values()) {
      if (!normalizeShares(row.pct)) continue;
      records.push({
        id: row.playerId,
        // The POOL's spelling, so a name that gained a suffix reads the way the
        // rest of the pipeline spells it. The join is by id regardless.
        name: ids.get(row.playerId),
        season,
        pct: POSITIONS.map(p => row.pct?.[p] ?? 0),
      });
    }
  }
  records.sort((a, b) => a.name.localeCompare(b.name) || a.season - b.season);
  return { records, missing, players: ids.size };
}

/** Loads the committed table, or null when it has not been built yet. */
export function loadPositionShares(file = POSITION_SHARES_FILE) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Two lookups over the table: by Basketball-Reference id, and by name.
 *
 * BOTH, because the two consumers hold different keys. The special sets carry
 * an archived row with a real player id and are built from seasons where names
 * collide, so they ask by id. The base set's pool carries only a name — it is
 * built from one season's per-game table, where a normalized name is unique —
 * so it asks by name and gets the current season.
 *
 * Returns an object whose lookups yield null for anything absent, so a caller
 * can always pass the result straight to `speedShare` and get the label-only
 * split for a player the table does not carry.
 */
export function indexPositionShares(records) {
  const byId = new Map();
  const byName = new Map();
  for (const r of records ?? []) {
    const shares = normalizeShares(Object.fromEntries(POSITIONS.map((p, i) => [p, r.pct?.[i]])));
    if (!shares) continue;
    byId.set(`${r.id}|${r.season}`, shares);
    const nameKey = normalizeName(r.name);
    if (nameKey) byName.set(`${nameKey}|${r.season}`, shares);
  }
  return {
    size: byId.size,
    forId: (id, season) => byId.get(`${id}|${season}`) ?? null,
    forName: (name, season) => byName.get(`${normalizeName(name)}|${season}`) ?? null,
  };
}

export function loadPool(file = POOL_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Every season's play-by-play table that is already on disk. */
export function collectCachedSeasons({ first = FIRST_SEASON, last = LAST_SEASON } = {}) {
  const seasonRows = {};
  for (let season = first; season <= last; season += 1) {
    const rows = readCache(cacheKey(season));
    if (rows) seasonRows[season] = rows;
  }
  return seasonRows;
}

export async function main({ force = false, log = console.log } = {}) {
  for (let season = FIRST_SEASON; season <= LAST_SEASON; season += 1) {
    if (!force && readCache(cacheKey(season))) continue;
    const rows = await fetchSeasonTableCached(season, 'playByPlay', { force });
    log(`  ${season}: ${rows.length} rows`);
    await politeDelay(DEFAULT_REQUEST_SPACING_MS);
  }

  const seasonRows = collectCachedSeasons();
  const seasons = Object.keys(seasonRows).map(Number).sort((a, b) => a - b);
  if (seasons.length === 0) {
    throw new Error('No cached play-by-play tables — this run fetched nothing and found nothing.');
  }

  const pool = loadPool();
  const { records, missing, players } = buildPositionShares({ seasonRows, pool });

  // One record per LINE, like player-biometrics.json: a changed player-season
  // stays exactly one changed line in a diff.
  fs.writeFileSync(
    POSITION_SHARES_FILE,
    `[\n${records.map(r => ` ${JSON.stringify(r)}`).join(',\n')}\n]\n`
  );

  log(
    `${records.length} player-seasons for ${players} of ${pool.length} pool players ` +
      `(${seasons[0]}-${seasons.at(-1)}) -> ${path.relative(REPO_ROOT, POSITION_SHARES_FILE)}`
  );
  if (missing.length) {
    log(`  ⚠ no ${LAST_SEASON} play-by-play row for: ${missing.join(', ')}`);
    log('    those players keep the position-LABEL split.');
  }

  // How much the shares actually disagree with the label they replace — the
  // whole justification for the file, reported rather than asserted.
  const currentRecords = records.filter(r => r.season === LAST_SEASON);
  const dominant = r => POSITIONS[r.pct.indexOf(Math.max(...r.pct))];
  const pure = currentRecords.filter(r => Math.max(...r.pct) >= 90).length;
  const split = currentRecords.filter(r => Math.max(...r.pct) < 60).length;
  log(
    `  ${LAST_SEASON}: ${pure} players spent 90%+ of their minutes at one position, ` +
      `${split} spent under 60% at their most-played one`
  );
  const poolPos = new Map(pool.map(p => [normalizeName(p.name), p.pos]));
  const disagree = currentRecords.filter(r => {
    const label = String(poolPos.get(normalizeName(r.name)) ?? '').split(/[-/,]/)[0].trim();
    return label && dominant(r) !== label;
  });
  log(
    `  the pool's single label names a different position from the most-played one for ` +
      `${disagree.length} of ${currentRecords.length}`
  );
  return records;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main({ force: process.argv.includes('--force') }).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
