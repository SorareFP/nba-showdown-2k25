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
    // The API's own rim numbers — historicalShootingInput prefers these over
    // the 2P% substitute, exactly as the BBRef shooting split is preferred on
    // the archived seasons. A playoff run's Paint Boost is real rim finishing.
    rimPct: row.fgPctRim,
    rimShare: row.fgaPer75 > 0 ? (row.fgaRimPer75 ?? 0) / row.fgaPer75 : null,
    fga100: (row.fgaPer75 ?? 0) * P75_TO_P100,
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

/**
 * A BPM -> EPM bridge, for the seasons dunksandthrees does not reach.
 *
 * EPM begins in 2002. Shaquille O'Neal's displaced 1999-00 Super Season and
 * every pre-2000 rookie year land BEFORE it, and a season with no EPM is
 * priced at replacement outright (trust 0) — which printed Speed+Power 14 on
 * the 2000 MVP. The bridge maps BPM into EPM units the same way the WNBA
 * sets cross leagues: RANK-PRESERVING Z-SCORES, not a unit equation. BPM's
 * spread is about twice EPM's, so putting raw BPM in the EPM slot would
 * inflate every z-score by that factor; instead a season's BPM is scored
 * against the cardable BPM distribution of the EPM ERA (games >= 40, 12+ mpg,
 * 2002-2026 — the pool rule, over the same years the EPM basis measures) and
 * re-expressed at the same percentile of the EPM basis. VORP per game bridges
 * into the Estimated-Wins-per-game slot identically — the refinement slot's
 * own historical substitute, at the same weight.
 */
export function buildBpmBridge(epmBasis, { first = 2002, last = 2026 } = {}) {
  const bpms = [];
  const vorpRates = [];
  for (let season = first; season <= last; season += 1) {
    let cachedRows;
    try { cachedRows = readCache(`bbref-${season}-advanced-full`); } catch { continue; }
    const rows = Array.isArray(cachedRows) ? cachedRows : cachedRows?.rows ?? cachedRows?.data ?? [];
    for (const r of rows) {
      const games = r.games ?? 0;
      if (games < 40 || (r.minutes ?? 0) / games < 12) continue;
      if (Number.isFinite(r.bpm)) bpms.push(r.bpm);
      if (Number.isFinite(r.vorp) && games > 0) vorpRates.push(r.vorp / games);
    }
  }
  const meanSd = xs => {
    const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1)) || 1;
    return { mean, sd };
  };
  const b = meanSd(bpms);
  const v = meanSd(vorpRates);
  return {
    seasonsMeasured: `${first}-${last}`,
    cardableSeasons: bpms.length,
    epmFromBpm: bpm => Number.isFinite(bpm)
      ? epmBasis.epm.mean + ((bpm - b.mean) / b.sd) * epmBasis.epm.sd
      : null,
    ewinsPerGameFromVorp: (vorp, games) => Number.isFinite(vorp) && games > 0
      ? epmBasis.ewinsPerGame.mean + ((vorp / games - v.mean) / v.sd) * epmBasis.ewinsPerGame.sd
      : null,
  };
}

/**
 * The rim profile by player-season: share of attempts at 0-3 feet and FG%
 * there, from Basketball-Reference's shooting tables (cached 1997-2026).
 * Aggregate stint preferred (most games at one key), so a traded season reads
 * season-wide. This is the real data the Paint Boost's 2P% substitute stood
 * in for — see historicalShootingInput.
 */
export function loadRimProfiles({ first = 1997, last = 2026 } = {}) {
  const map = new Map();
  for (let season = first; season <= last; season += 1) {
    let cachedRows;
    try { cachedRows = readCache(`bbref-${season}-shooting-full`); } catch { continue; }
    const rows = Array.isArray(cachedRows) ? cachedRows : cachedRows?.rows ?? cachedRows?.data ?? [];
    for (const r of rows) {
      if (!r.playerId) continue;
      const key = `${r.playerId}|${season}`;
      const prev = map.get(key);
      if (!prev || (r.games ?? 0) > (prev.games ?? 0)) map.set(key, r);
    }
  }
  return map;
}

/**
 * FT% -> TS%-scale bridge, for the seasons dunksandthrees does not reach.
 *
 * The user's rule: pre-D&T players take their shot line from FREE-THROW
 * touch, not from TS% — but the shooting layer's line comes off a TS%-scale
 * distribution, and raw FT% (~.75 average) would float every old-timer to
 * the top of it. So a season's FT% is scored against the cardable FT%
 * distribution of the EPM era and re-expressed at the same percentile of the
 * cardable TS% distribution — the exact rank-preserving move the BPM bridge
 * makes, on the shooting axis. Shaq's .527 lands where a .527 free-throw
 * shooter belongs; rookie Ray Allen's .823 lands where touch belongs.
 */
export function buildFtLineBridge({ first = 2002, last = 2026 } = {}) {
  const fts = [];
  const tss = [];
  for (let season = first; season <= last; season += 1) {
    let pp, adv;
    try { pp = readCache(`bbref-${season}-perPoss-full`); } catch { continue; }
    try { adv = readCache(`bbref-${season}-advanced-full`); } catch { continue; }
    const ppRows = Array.isArray(pp) ? pp : pp?.rows ?? pp?.data ?? [];
    const advRows = Array.isArray(adv) ? adv : adv?.rows ?? adv?.data ?? [];
    const advById = new Map(advRows.map(r => [`${r.playerId}|${r.team}`, r]));
    for (const r of ppRows) {
      const a = advById.get(`${r.playerId}|${r.team}`);
      const games = r.games ?? 0;
      if (games < 40 || (r.minutes ?? 0) / games < 12) continue;
      if (Number.isFinite(r.ftPct)) fts.push(r.ftPct);
      if (Number.isFinite(a?.tsPct)) tss.push(a.tsPct);
    }
  }
  const meanSd = xs => {
    const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1)) || 1;
    return { mean, sd };
  };
  const f = meanSd(fts);
  const t = meanSd(tss);
  return {
    sampled: fts.length,
    tsFromFt: ft => Number.isFinite(ft) ? t.mean + ((ft - f.mean) / f.sd) * t.sd : null,
  };
}
