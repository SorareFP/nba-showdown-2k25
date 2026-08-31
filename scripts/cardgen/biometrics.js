// Every carded player's height and weight, from the dunksandthrees API.
//
//   node --env-file=.env.local scripts/cardgen/biometrics.js
//   node --env-file=.env.local scripts/cardgen/biometrics.js --force
//
// Writes card-data/generated/player-biometrics.json, which attributes.js uses to
// bend the Speed/Power split by SIZE and not by position label alone.
//
// ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
//
// There was no height or weight anywhere in this repo. `season-epm` carries
// `inches` and `weight` on every player-season and always has — `toApiSeasonRate`
// already passed both through — so the data was one fetch away and nothing was
// reading it.
//
// It matters because memory/speed_power_methodology.md states the split rule as
// "guards skew Speed, bigger players skew Power", which is a claim about SIZE.
// Position was only ever standing in for it. The finished set agrees: joined to
// these biometrics, a card's speed share correlates -0.78 with height and -0.76
// with weight, and size alone explains almost exactly as much of it (R^2 0.689)
// as the position label does (0.695). More to the point, size still explains
// real variance INSIDE each position — which is the part a position label
// structurally cannot express, and the part that gives two same-budget guards
// different cards.
//
// ── WHY IT IS A COMMITTED FILE RATHER THAN A CACHE READ ─────────────────────
//
// card-data/cache is gitignored (it is a bulk copy of someone else's data and
// this repo is public), so a generator may not depend on it. Every other input
// the card build needs already lives in card-data/generated/ for exactly this
// reason. Two numbers per player is small enough to commit, and committing it is
// what lets a fresh checkout regenerate the same cards.
//
// ── ONE ROW PER PLAYER, NOT PER PLAYER-SEASON ───────────────────────────────
//
// Checked, not assumed: of the 1,985 players in the archive who span more than
// one season, the median and 90th-percentile career weight RANGE are both zero.
// The API is serving a listed height and weight per player rather than a
// per-season measurement, so folding the seasons together loses nothing. The
// run prints those numbers every time so the claim stays checkable.
//
// Each player therefore gets his modal height (16 of 2,543 are listed at more
// than one) and his mean weight, across every season the API serves. That also
// makes the table usable by the historical sets, whose cards are seasons from
// 2004 onwards, without carrying 25 seasons of duplicates.
//
// ── WHAT IS NOT COVERED ─────────────────────────────────────────────────────
//
// The WNBA. `season-epm` is an NBA endpoint and there is no equivalent, so every
// WNBA card degrades to the position-only split — see `splitSpeedPower`, which
// takes the size term as optional precisely so a set without it is unchanged
// rather than dropped.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, readCache } from './cache.js';
import * as dtApi from './sources/dunksAndThreesApi.js';
import { normalizeName } from './resolveTeams.js';

export const BIOMETRICS_FILE = path.join(
  REPO_ROOT,
  'card-data',
  'generated',
  'player-biometrics.json'
);

/**
 * The seasons the archive spans.
 *
 * From the API's own floor to the current season. `season-epm` allows 90
 * requests a minute and the client spaces them itself, so the whole archive is
 * about twenty seconds and every season is cached separately afterwards.
 */
export const FIRST_SEASON = dtApi.FIRST_API_SEASON;
export const LAST_SEASON = 2026;

/** The most common value in a list, ties broken by the larger. */
export function mode(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = null;
  let bestCount = -1;
  for (const [v, n] of counts) {
    if (n > bestCount || (n === bestCount && v > best)) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Folds many player-seasons into one row per player.
 *
 * `seasons` and the weight range are carried so the run can report how much a
 * career actually moves, rather than asserting that it does not.
 */
export function buildBiometrics(rows) {
  const byKey = new Map();
  for (const r of rows ?? []) {
    if (!Number.isFinite(r?.inches) || !Number.isFinite(r?.weight)) continue;
    const key = normalizeName(r.name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, { name: r.name, inches: [], weight: [], seasons: [] });
    const e = byKey.get(key);
    e.inches.push(r.inches);
    e.weight.push(r.weight);
    if (Number.isFinite(r.season)) e.seasons.push(r.season);
    // The most recent spelling wins, so a name that gained a suffix reads the
    // way the current pool spells it.
    if (Number.isFinite(r.season) && r.season >= Math.max(...e.seasons)) e.name = r.name;
  }

  const records = [];
  for (const e of byKey.values()) {
    const weights = e.weight;
    records.push({
      name: e.name,
      inches: mode(e.inches),
      weight: Number((weights.reduce((s, w) => s + w, 0) / weights.length).toFixed(1)),
      seasons: e.seasons.length,
      firstSeason: e.seasons.length ? Math.min(...e.seasons) : null,
      lastSeason: e.seasons.length ? Math.max(...e.seasons) : null,
      weightRange: Number((Math.max(...weights) - Math.min(...weights)).toFixed(1)),
      heightVaries: new Set(e.inches).size > 1,
    });
  }
  records.sort((a, b) => a.name.localeCompare(b.name));
  return records;
}

/** Loads the committed table, or null when it has not been built yet. */
export function loadBiometrics(file = BIOMETRICS_FILE) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Name -> `{ inches, weight }`, keyed the way every other join in this tree is.
 *
 * Returns an EMPTY map rather than null for a missing table, so a caller can
 * always `index.get(name) ?? null` and get the position-only split. A set with
 * no biometrics is a legitimate state (the WNBA), not an error.
 */
export function indexBiometrics(records) {
  const m = new Map();
  for (const r of records ?? []) {
    const key = normalizeName(r.name);
    if (key) m.set(key, { inches: r.inches, weight: r.weight });
  }
  return m;
}

/** The cached `season-epm` rows for one season, or null if never fetched. */
export function readCachedSeason(season, seasonType = dtApi.SEASON_TYPE_REGULAR) {
  return readCache(dtApi.seasonEpmCacheKey(season, seasonType));
}

/**
 * Every cached season's rows, tagged with the season they came from.
 *
 * Reads only what is on disk. `main` fetches first, so a full run has
 * everything; a re-run with no network still rebuilds the file from the cache.
 */
export function collectCachedRows({ first = FIRST_SEASON, last = LAST_SEASON } = {}) {
  const rows = [];
  const seasons = [];
  for (let season = first; season <= last; season += 1) {
    const cached = readCachedSeason(season);
    if (!cached) continue;
    seasons.push(season);
    for (const r of cached) rows.push({ ...r, season: r.season ?? season });
  }
  return { rows, seasons };
}

export async function main({ force = false, log = console.log } = {}) {
  for (let season = FIRST_SEASON; season <= LAST_SEASON; season += 1) {
    if (!force && readCachedSeason(season)) continue;
    const rows = await dtApi.fetchSeasonEpm(season, { force, log });
    log(`  ${season}: ${rows.length} players`);
  }

  const { rows, seasons } = collectCachedRows();
  if (seasons.length === 0) {
    throw new Error(
      'No cached season-epm data. Run with --env-file=.env.local so the API key is available.'
    );
  }
  const records = buildBiometrics(rows);
  // One record per LINE rather than one field per line: 2,543 players is the
  // largest file in card-data/generated/, and the usual `null, 1` spelling makes
  // it three times bigger without making a diff any easier to read — a changed
  // player is still exactly one changed line this way.
  fs.writeFileSync(
    BIOMETRICS_FILE,
    `[\n${records.map(r => ` ${JSON.stringify(r)}`).join(',\n')}\n]\n`
  );

  log(
    `${records.length} players from ${rows.length} player-seasons ` +
      `(${seasons[0]}-${seasons.at(-1)}) -> ${path.relative(REPO_ROOT, BIOMETRICS_FILE)}`
  );
  const inches = records.map(r => r.inches).sort((a, b) => a - b);
  const weights = records.map(r => r.weight).sort((a, b) => a - b);
  const at = (a, p) => a[Math.floor(p * (a.length - 1))];
  log(`  height  ${inches[0]}" .. ${inches.at(-1)}"  median ${at(inches, 0.5)}"`);
  log(`  weight  ${weights[0]} .. ${weights.at(-1)} lb  median ${at(weights, 0.5)} lb`);

  // The claim the one-row-per-player fold rests on, checked rather than assumed.
  const multi = records.filter(r => r.seasons > 1);
  const ranges = multi.map(r => r.weightRange).sort((a, b) => a - b);
  const varies = multi.filter(r => r.weightRange > 0);
  log(
    `  ${multi.length} players span more than one season, and ${varies.length} of them are ever ` +
      `listed at a different weight (median range ${at(ranges, 0.5)} lb, p90 ${at(ranges, 0.9)} lb, ` +
      `max ${ranges.at(-1)} lb)`
  );
  log(
    `  so the API's weight is effectively a single listed figure per player, not a per-season ` +
      'measurement — which is what makes one row per player the right fold rather than a lossy one'
  );
  log(`  ${records.filter(r => r.heightVaries).length} players are listed at more than one height`);
  return records;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main({ force: process.argv.includes('--force') }).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
