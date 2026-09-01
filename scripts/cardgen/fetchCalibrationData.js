// Pulls, and caches, every external input the card generators need.
//
// Run once; re-runs are free. Everything lands in card-data/cache/ as
// normalized JSON, which is committed, so `node scripts/cardgen/generateCards.js`
// works with no network at all.
//
//   node --env-file=.env.local scripts/cardgen/fetchCalibrationData.js
//   node --env-file=.env.local scripts/cardgen/fetchCalibrationData.js --force
//
// THE `--env-file` IS NOT OPTIONAL ANY MORE. Step 1a below reads the PRIOR
// season through dunksandthrees' authenticated API, which is the only source
// that serves one, and it needs DUNKSANDTHREES_API_KEY out of .env.local. Every
// other step still works without a key — see `--skip-prior` if you have none.
//
// WHAT IT FETCHES, and why each one is needed:
//
//  0. dunksandthrees ACTUAL season rates for the CURRENT season (2025-26), BOTH
//     SEASON TYPES. What each player really did: TS%, FG% by location, and the
//     OFF/DEF/EPM/EW quartet. The primary source — Shot Line, both shooting
//     boosts, Def Boost and the Speed/Power budget all read it. One request per
//     season type for all ~600 players.
//
//     The playoff split (`seasontype=4`) is fetched into its own cache entry and
//     folded into the regular season on read by scripts/cardgen/poolSeasons.js,
//     volume-weighted per stat, so those games count as additional data rather
//     than as a second set. Only ~254 players have a playoff row — a player
//     whose team missed the playoffs simply keeps his regular-season figures.
//     The two caches stay separate because each is a faithful copy of what one
//     page served; the fold is a derivation, and derivations belong in code.
//  1. dunksandthrees PREDICTED per-100 rates for the same season. Kept for one
//     job only: the scoring chart's per-100 PTS/REB/AST anchor, which the actual
//     page does not carry (it gives rebounds and assists as rate percentages,
//     which cannot be inverted without team and opponent totals).
//  1a. THE PRIOR SEASON (2024-25), both season types, through the AUTHENTICATED
//     API rather than the public page. This is the one step that needs a key:
//     the website locks every prior season, and the API does not.
//
//     It exists for the nineteen force-included players, who are carded on a
//     2025-26 sample as short as eleven games. scripts/cardgen/priorSeasonBlend.js
//     folds their previous season in, volume-weighted, exactly as the playoffs
//     are folded in. Verified before it was relied on: for the OVERLAPPING season
//     the API and the scraped page agree on all 602 rows to every digit, so this
//     is the same table rather than a second opinion.
//
//     The whole league is fetched, not just the nineteen — the endpoint serves
//     one season at a time regardless, so filtering would cost the same request
//     and lose the ability to answer a later question without re-fetching.
//  2. Basketball-Reference's 2024-25 season tables (per-game, per-100,
//     advanced). The season the FINISHED card set was built from — the only way
//     to fit anything against those 283 real cards, since dunksandthrees keeps
//     prior seasons behind a subscription.
//  3. Real 2024-25 game logs for a stratified sample of ~30 of those players.
//     THE CENTRAL INPUT. A per-100 rate is a mean; a scoring chart is a
//     distribution across five percentile bands, and a mean cannot be turned
//     into a distribution without either assuming a shape or measuring one.
//     These logs are the measurement — see variance.js.
//
// The sample spans the minutes range on purpose. A chart's spread is not
// scale-free: the normalization in bands.js divides by each game's minutes
// TWICE, so a 14-minute-a-night player's normalized distribution behaves
// nothing like a 36-minute starter's, and a fit calibrated only on stars would
// be wrong for two thirds of the pool. Thirty players sampled evenly across the
// minutes distribution is enough to fit a two-parameter relationship per stat
// without asking much of Basketball-Reference.

import { pathToFileURL } from 'node:url';
import { cached, readCache, writeCache, politeDelay, DEFAULT_REQUEST_SPACING_MS } from './cache.js';
import * as bbref from './sources/basketballReference.js';
import * as dt from './sources/dunksAndThrees.js';
import * as dtApi from './sources/dunksAndThreesApi.js';
import { loadReferenceCards } from './referenceCards.js';
import { normalizeName } from './resolveTeams.js';

/** The season the 2026-27 set is built from. Matches STATS_SEASON in src/cards/sets.js. */
export const CURRENT_STATS_SEASON = 2026;
/** The season the FINISHED 2025-26 set was built from — everything backward-looking. */
export const REFERENCE_STATS_SEASON = 2025;

export const CALIBRATION_SAMPLE_SIZE = 30;
const MIN_GAMES = 40;
const MIN_MPG = 10;

const num = v => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
};

/** Trims a Basketball-Reference season table down to the columns anything here reads. */
export function trimSeasonTable(rows, kind) {
  return rows.map(r => {
    const c = r.cells;
    const base = { playerId: r.playerId, name: r.name, team: c.team_name_abbr ?? c.team_id ?? null };
    if (kind === 'perGame') {
      return { ...base, pos: c.pos ?? null, games: num(c.games), mpg: num(c.mp_per_g) };
    }
    if (kind === 'shooting') {
      // The rim profile the Paint Boost wants: share of attempts at the rim
      // and conversion there, with the 3-10ft band and average distance kept
      // for context. This is the data 2P% was standing in for.
      return {
        ...base,
        games: num(c.games),
        minutes: num(c.mp),
        rimShare: num(c.pct_fga_00_03),
        rimPct: num(c.fg_pct_00_03),
        shortShare: num(c.pct_fga_03_10),
        shortPct: num(c.fg_pct_03_10),
        avgDist: num(c.avg_dist),
      };
    }
    if (kind === 'playByPlay') {
      // The five Position Estimate columns, kept as the INTEGER percentages the
      // page prints. Basketball-Reference also carries a full-precision copy in
      // each cell's `csk` sort key (0.4601419196062 behind a printed 46), and
      // that precision is deliberately not taken: the five integers are read by
      // the same tested `data-stat` parser the other three tables use, and the
      // rounding is worth about 0.03 of a Speed point on a 25-point budget —
      // three thousandths of the gap between a point guard's share and a
      // centre's. The printed row does not always total 100 (99-102 across the
      // 2026 table, for the same rounding reason); consumers normalize.
      return {
        ...base,
        pos: c.pos ?? null,
        games: num(c.games),
        minutes: num(c.mp),
        pct: Object.fromEntries(
          Object.entries(bbref.POSITION_ESTIMATE_STATS).map(([p, stat]) => [p, num(c[stat]) ?? 0])
        ),
      };
    }
    if (kind === 'perPoss') {
      // The counting columns are suffixed `_per_poss` on this table only —
      // `pts_per_poss`, not `pts`. Reading them as `pts` silently yields zero
      // for every player rather than failing, which is why the names are spelled
      // out here instead of derived.
      return {
        ...base,
        pos: c.pos ?? null,
        games: num(c.games),
        minutes: num(c.mp),
        pts100: num(c.pts_per_poss),
        trb100: num(c.trb_per_poss),
        orb100: num(c.orb_per_poss),
        drb100: num(c.drb_per_poss),
        ast100: num(c.ast_per_poss),
        fga100: num(c.fga_per_poss),
        fg3a100: num(c.fg3a_per_poss),
        fg2a100: num(c.fg2a_per_poss),
        fta100: num(c.fta_per_poss),
        fgPct: num(c.fg_pct),
        fgPct3: num(c.fg3_pct),
        fgPct2: num(c.fg2_pct),
        efg: num(c.efg_pct),
        ftPct: num(c.ft_pct),
      };
    }
    return {
      ...base,
      // pos and age ride along because the ADVANCED table is the only one the
      // historical fetch reads for identity (scripts/cardgen/history.js), and a
      // card needs a position to split Speed/Power. Harmless for the 2025
      // calibration snapshot, which simply ignores them.
      pos: c.pos ?? null,
      age: num(c.age),
      games: num(c.games),
      minutes: num(c.mp),
      per: num(c.per),
      tsPct: num(c.ts_pct),
      fg3aRate: num(c.fg3a_per_fga_pct),
      ftRate: num(c.fta_per_fga_pct),
      usgPct: num(c.usg_pct),
      obpm: num(c.obpm),
      dbpm: num(c.dbpm),
      bpm: num(c.bpm),
      vorp: num(c.vorp),
      // TOTAL Win Shares, not just the rate. The two are a volume/rate pair and
      // the Super Season score deliberately carries both — see history.js.
      ws: num(c.ws),
      ws48: num(c.ws_per_48),
    };
  });
}

/**
 * One row per player, keeping the row with the most games.
 *
 * Mid-season trades give a player one "2TM" aggregate row plus one row per
 * team, and the aggregate is the one with the most games — which is the row we
 * want, since it covers the whole season. Same dedup rule the player pool and
 * the Speed/Power totals already use.
 */
export function dedupeByMaxGames(rows) {
  const best = new Map();
  for (const row of rows) {
    const prev = best.get(row.playerId);
    if (!prev || (row.games ?? 0) > (prev.games ?? 0)) best.set(row.playerId, row);
  }
  return [...best.values()];
}

export async function fetchSeasonTableCached(season, kind, { force = false } = {}) {
  return cached(
    `bbref-${season}-${kind}`,
    async () => dedupeByMaxGames(trimSeasonTable(await bbref.fetchSeasonTable(season, kind), kind)),
    { force, meta: { source: 'basketball-reference.com', season, kind } }
  );
}

/**
 * Picks the players whose real game logs get fetched.
 *
 * Stratified by minutes per game, evenly across the eligible range, restricted
 * to players who ALSO have a finished card — so the same thirty logs serve both
 * jobs: fitting the spread model, and measuring how close the finished pipeline
 * lands on real published charts.
 *
 * The chosen list is cached, so it stays fixed across re-runs even though the
 * gitignored reference CSV it was chosen from may not be present next time.
 */
export function chooseCalibrationSample(referenceCards, perGame, size = CALIBRATION_SAMPLE_SIZE) {
  const byName = new Map();
  for (const p of perGame) {
    if ((p.games ?? 0) < MIN_GAMES || (p.mpg ?? 0) < MIN_MPG) continue;
    const key = normalizeName(p.name);
    const prev = byName.get(key);
    if (!prev || p.games > prev.games) byName.set(key, p);
  }
  const eligible = [];
  for (const card of referenceCards) {
    const hit = byName.get(normalizeName(card.name));
    if (hit) eligible.push({ card: card.name, playerId: hit.playerId, name: hit.name, mpg: hit.mpg, games: hit.games, pos: hit.pos });
  }
  eligible.sort((a, b) => a.mpg - b.mpg || a.playerId.localeCompare(b.playerId));
  if (eligible.length <= size) return eligible;
  const picked = [];
  const seen = new Set();
  for (let i = 0; i < size; i += 1) {
    const at = Math.round((i * (eligible.length - 1)) / (size - 1));
    if (seen.has(at)) continue;
    seen.add(at);
    picked.push(eligible[at]);
  }
  return picked;
}

/** Fetches each sampled player's game log, spacing requests out. */
export async function fetchSampleGameLogs(sample, season, { force = false, spacingMs = DEFAULT_REQUEST_SPACING_MS, log = () => {} } = {}) {
  const logs = {};
  let fetched = 0;
  for (const player of sample) {
    const key = `gamelog-${player.playerId}-${season}`;
    const hit = force ? null : readCache(key);
    if (hit) {
      logs[player.playerId] = hit;
      continue;
    }
    if (fetched > 0) await politeDelay(spacingMs);
    log(`  fetching ${player.name} (${player.playerId})`);
    const games = await bbref.fetchGameLog(player.playerId, season);
    writeCache(key, games, { source: 'basketball-reference.com', season, playerId: player.playerId });
    logs[player.playerId] = games;
    fetched += 1;
  }
  return { logs, fetched };
}

/**
 * The prior season, both season types, through the authenticated API.
 *
 * Two requests. The endpoint's documented allowance is 90 a minute and the
 * client spaces them itself, so nothing here needs to be polite by hand — see
 * the per-endpoint throttle in sources/dunksAndThreesApi.js.
 *
 * A MISSING KEY IS A LOUD FAILURE, not a skipped step: the blend it feeds
 * changes nineteen cards, and a run that quietly produced the unblended set
 * would look exactly like a run that worked.
 */
export async function fetchPriorSeason(season, { force = false, log = () => {} } = {}) {
  const out = {};
  for (const [label, seasonType] of [
    ['regular season', dtApi.SEASON_TYPE_REGULAR],
    ['playoffs', dtApi.SEASON_TYPE_PLAYOFFS],
  ]) {
    const rows = await dtApi.fetchSeasonEpm(season, { seasonType, force, log });
    log(`  ${rows.length} players (${label})`);
    out[seasonType] = rows;
  }
  return out;
}

export async function main({ force = false, skipPrior = false, log = console.log } = {}) {
  log(`dunksandthrees ACTUAL season rates, season ${CURRENT_STATS_SEASON}...`);
  const actual = await dt.fetchActualSeasonRates(CURRENT_STATS_SEASON, { force });
  log(`  ${actual.length} players (regular season)`);

  // The postseason, same page and same 61 columns, one query parameter apart.
  // Fetched unconditionally: an empty or absent playoff table is a legitimate
  // state (nobody has played a playoff game yet) and poolSeasons.js handles it
  // by returning the regular season untouched.
  const playoffs = await dt.fetchActualSeasonRates(CURRENT_STATS_SEASON, {
    force,
    seasonType: dt.SEASON_TYPE_PLAYOFFS,
  });
  log(`  ${playoffs.length} players (playoffs)`);

  log(`dunksandthrees predicted per-100 rates, season ${CURRENT_STATS_SEASON}...`);
  const rates = await dt.fetchSeasonRates(CURRENT_STATS_SEASON, { force });
  log(`  ${rates.length} players`);

  // The prior season, from the API — the only source that serves one.
  if (skipPrior) {
    log(`Prior season ${REFERENCE_STATS_SEASON} SKIPPED (--skip-prior).`);
    log('  the force-include blend will refuse to run without it.');
  } else {
    log(`dunksandthrees API, season ${REFERENCE_STATS_SEASON} (needs ${dtApi.API_KEY_ENV})...`);
    await fetchPriorSeason(REFERENCE_STATS_SEASON, { force, log });
  }

  const tables = {};
  // `playByPlay` rides along with the other three because the calibration needs
  // it for the same season and the same reason they are here: the four-way fit
  // that decides whether the Speed/Power split reads a position LABEL or the
  // five positional SHARES is measured against the finished cards, and the
  // finished cards are 2024-25. scripts/cardgen/positionShares.js fetches the
  // other 26 seasons for generation.
  for (const kind of ['perGame', 'perPoss', 'advanced', 'playByPlay']) {
    log(`Basketball-Reference ${REFERENCE_STATS_SEASON} ${kind}...`);
    tables[kind] = await fetchSeasonTableCached(REFERENCE_STATS_SEASON, kind, { force });
    log(`  ${tables[kind].length} players`);
    await politeDelay(DEFAULT_REQUEST_SPACING_MS);
  }

  const reference = loadReferenceCards();
  let sample = readCache('calibration-sample');
  if (!sample || force) {
    if (!reference) {
      throw new Error(
        'No cached calibration sample and no card-data/source-recovered/Final Cards.csv to ' +
          'choose one from. That CSV is gitignored; restore it, or restore the cached sample.'
      );
    }
    sample = chooseCalibrationSample(reference, tables.perGame);
    writeCache('calibration-sample', sample, { season: REFERENCE_STATS_SEASON });
  }
  log(`Game logs for ${sample.length} players (${sample[0].mpg}-${sample[sample.length - 1].mpg} mpg)...`);
  const { fetched } = await fetchSampleGameLogs(sample, REFERENCE_STATS_SEASON, { force, log });
  log(`  ${fetched} fetched, ${sample.length - fetched} already cached`);

  log('Done. Cache: card-data/cache/');
}

// Run-as-script guard. pathToFileURL rather than a path string compare: on
// Windows `process.argv[1]` is `C:\...` and `import.meta.url` is `file:///C:/...`,
// which never match as strings.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main({
    force: process.argv.includes('--force'),
    skipPrior: process.argv.includes('--skip-prior'),
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
