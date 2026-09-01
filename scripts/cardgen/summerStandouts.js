/**
 * The Summer Standouts plumbing, shared by the two generators that need it.
 *
 * A Summer Standout is a PLAYOFF RUN carded through the shipped historical
 * pipeline: the same `buildSet` -> `buildHistoricalCard` path the Super Season
 * set uses, fed the player's playoff stat line instead of a regular season.
 * The roster is a NAMED LIST (card-data/summer-standouts.json) exactly like
 * the WNBA legends — the user picked these runs, and no threshold can produce
 * or withhold one. The same file also names the Super Seasons the conflict
 * rule kept INSTEAD of a playoff card (standout-conflict-decisions.json holds
 * each call); those displace that player's algorithmic Super Season pick, so
 * generateSpecialSets.js reads this file too.
 *
 * Everything here was proven in scripts/analysis/runConflictSalaries.js — the
 * pricing run the decisions were made from — and is lifted, not reinvented,
 * so the cards that ship are built exactly the way the ones priced were.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache } from './cache.js';
import { normalizeName } from './resolveTeams.js';

export const STANDOUTS_FILE = path.join(REPO_ROOT, 'card-data', 'summer-standouts.json');

/** The API publishes playoff rates per 75 possessions; the builder reads per 100. */
const P75_TO_P100 = 100 / 75;

/** `{ playoffCards, superSeasons }`, or empty maps when the file is absent. */
export function readSummerStandouts(file = STANDOUTS_FILE) {
  if (!fs.existsSync(file)) return { playoffCards: {}, superSeasons: {} };
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { playoffCards: body.playoffCards ?? {}, superSeasons: body.superSeasons ?? {} };
}

/** The API's playoff row (seasonType st4) for one player-season, or null. */
export function playoffRow(name, season) {
  let cached;
  try { cached = readCache(`dunksandthrees-api-season-epm-${season}-st4`); } catch { return null; }
  const rows = cached?.data ?? cached ?? [];
  return (Array.isArray(rows) ? rows : rows.rows ?? []).find(
    r => normalizeName(r.name) === normalizeName(name)
  ) ?? null;
}

/**
 * A playoff run, shaped as the season object buildHistoricalCard reads.
 *
 * DEF EPM sits in DBPM's slot on purpose: the historical path rounds whatever
 * is there through the same Def Boost rule, and for a playoff run the real
 * DEF EPM exists — it is the regular-season cards that have to substitute.
 */
export function playoffSeason(row, fallbackPos) {
  const fga100 = (row.fgaPer75 ?? 0) * P75_TO_P100;
  const fg3a100 = (row.fga3Per75 ?? 0) * P75_TO_P100;
  return {
    season: row.season,
    playerId: null,
    // historicalComposite reads this: a playoff-only sample is trusted against
    // FULL_PLAYOFF_MINUTES, not a regular season's 1500.
    playoffRun: true,
    team: row.team,
    pos: row.position ?? fallbackPos ?? 'SF',
    games: row.games,
    minutes: row.minutes,
    usgPct: row.usage != null ? row.usage * 100 : null,
    pts100: (row.pts75 ?? 0) * P75_TO_P100,
    trb100: (row.reb75 ?? 0) * P75_TO_P100,
    ast100: (row.ast75 ?? 0) * P75_TO_P100,
    fg2a100: Math.max(fga100 - fg3a100, 0),
    fg3a100,
    fta100: (row.ftaPer75 ?? 0) * P75_TO_P100,
    fgPct2: row.fgPct2,
    fgPct3: row.fgPct3,
    tsPct: row.tsPct,
    dbpm: row.epmDef,
    epm: row.epm,
    ewinsPerGame: row.ewinsPerGame,
  };
}

/**
 * EPM for any player-season, from the API caches rather than the archive.
 *
 * `indexEpmSeasons(archiveRows)` covers only the 350-player pool, and most of
 * the standouts are outside it. Feeding that index sends `historicalComposite`
 * to trust = 0 and prices the season at replacement — the conflict run's first
 * pass printed Speed+Power 14 for Jokic's 2022 that way.
 */
export function buildApiEpmIndex(first = 2002, last = 2026) {
  const index = new Map();
  for (let season = first; season <= last; season += 1) {
    let cached;
    try { cached = readCache(`dunksandthrees-api-season-epm-${season}-st2`); } catch { continue; }
    const rows = cached?.data ?? cached ?? [];
    for (const r of Array.isArray(rows) ? rows : rows.rows ?? []) {
      index.set(`${normalizeName(r.name)}|${season}`, {
        epm: r.epm,
        ewinsPerGame: r.ewinsPerGame,
      });
    }
  }
  return index;
}

/**
 * Per-100 and advanced season rows for EVERY player, from the cached
 * full-league tables — the pool-scoped history archive has no rows for the
 * retirees the standout Super Seasons name.
 */
export function loadFullSeasonTables({ first = 2000, last = 2026 } = {}) {
  const perPoss = new Map();
  const advanced = new Map();
  for (let season = first; season <= last; season += 1) {
    for (const [kind, target] of [['perPoss', perPoss], ['advanced', advanced]]) {
      let cached;
      try { cached = readCache(`bbref-${season}-${kind}-full`); } catch { continue; }
      const rows = Array.isArray(cached) ? cached : cached?.rows ?? cached?.data ?? [];
      for (const r of rows) target.set(`${r.playerId}|${season}`, { ...r, season });
    }
  }
  return { perPoss, advanced };
}
