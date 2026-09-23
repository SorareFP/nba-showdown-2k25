// THE LIVE SERIES — card-data/generated/cards-live.json.
//
//   node scripts/cardgen/generateLive.js                       # mirror the base set (before the season)
//   node scripts/cardgen/generateLive.js --mode season         # the season's numbers, fetched tonight
//   node scripts/cardgen/generateLive.js --mode season --offline --season 2026 --as-of 2025-12-01 --out /tmp/x.json
//                                                              # a dry run on the cached 2025-26 pages and logs
//
// The user (2026-09-23): "the 26-27 base cards with an electric blue trim like
// the green of the rookie cards, and what these are going to do is contain a
// live export using the expected EPM page of dunks and threes … Those will
// need a job to run each day that reallocates stats and re-exports the faces."
//
// ── TWO MODES ────────────────────────────────────────────────────────────────
//
// MIRROR (before the season): every 2026-27 base card again, the same id and
// the same numbers, in the `live` set with the LIVE pill. That is what
// registers the set, exports its faces and lets the pack and collection
// wiring be built and tested before there is anything live to show.
//
// SEASON (the nightly job, .github/workflows/live-series.yml): the same
// cards re-allocated from the season as it happens. Everything moves daily,
// as the user chose, and every layer reads THE EXPECTED PAGE:
//
//   Speed / Power / Def Boost   dunksandthrees' EXPECTED EPM (/epm — a
//                               stabilised, predictive figure, not the actual
//                               page's; the two differ by 0.72 EPM on average
//                               over 2025-26), through the same archive-scaled
//                               composite as the base set (speedPower.js). EW
//                               per game, the composite's volume term, is
//                               MODELLED from EPM and minutes (EW_PER_GAME_MODEL)
//                               rather than read, because the actual figure is
//                               a season total divided by a handful of games in
//                               October.
//   Shot Line / Paint / 3PT     the expected page's predicted shooting splits
//                               (rim FG%, 3P%, TS%) and attempt rates, handed to
//                               the shooting layer with a FULL SEASON'S volume
//                               behind them: dunksandthrees has already
//                               regressed those percentages toward a prior, and
//                               shrinking them again by ten games of attempts
//                               would flatten every card to the mean.
//   The chart                   this season's real games (Basketball-Reference
//                               logs, opponent-adjusted by the dated team DEF
//                               EPM, minutes-damped — realGames.js) PLUS
//                               synthetic games from the expected per-100 rates
//                               for the rest of the 82 (generateCards.js,
//                               fillGames). The user's early-season rule: the
//                               expected rates alone, which the real games
//                               replace one at a time — NEVER last season's.
//   Salary                      the play-value price against the live field,
//                               exactly as the base set is priced.
//
// A base card whose player has no usable row on this season's table (not on
// it at all, or no expected EPM yet) is MIRRORED — the base card's numbers,
// repriced against the live field — and stamped with why.
//
// Every card carries `live: { mode, asOf, source, season, status, games }`,
// so a face, a tile or a test can tell what it is looking at, and
// live-status.json says the same for the whole set.
//
// WHAT THE RUNNER NEEDS, and nothing else: the committed generated files
// (calibration, biometrics, positional shares, the EPM archive, the pool's
// game-log index for Basketball-Reference ids), two page reads from
// dunksandthrees, one keyed API call for the opponent table, and this season's
// game-log pages — fetched only for players whose game count on
// dunksandthrees has moved past the cached log, at the polite spacing, capped
// per night and cached between nights (actions/cache). No 325 MB cache, no
// last-season basis: the user answered the two design questions on
// 2026-09-23 ("yes, and the latter"), and the latter made the basis
// unnecessary.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, readCache, writeCache, politeDelay, DEFAULT_REQUEST_SPACING_MS } from './cache.js';
import { CURRENT_SET, LIVE_SET } from '../../src/cards/sets.js';
import { LIVE_BADGE } from '../../src/cards/badges.js';
import * as dt from './sources/dunksAndThrees.js';
import * as dtApi from './sources/dunksAndThreesApi.js';
import { fetchGameLogFull } from './sources/basketballReference.js';
import { poolActualSeasons } from './poolSeasons.js';
import { liveSeasonRows, seasonTeamDefense, WINDOW_GAMES } from './realGames.js';
import { buildSpeedPowerTotals } from './speedPower.js';
import { generateCards, indexByName, STAT_NAME_ALIASES } from './generateCards.js';
import { indexBiometrics, loadBiometrics } from './biometrics.js';
import { indexPositionShares, loadPositionShares } from './positionShares.js';
import { CALIBRATION_FILE } from './calibrateAttributes.js';
import { OUTPUT_FILE as LIVE_FILL_FILE } from './calibrateLiveFill.js';
import { CURRENT_STATS_SEASON } from './fetchCalibrationData.js';
import { normalizeName } from './resolveTeams.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const BASE_FILE = path.join(GEN_DIR, `cards-${CURRENT_SET}.json`);
export const OUTPUT_FILE = path.join(GEN_DIR, `cards-${LIVE_SET}.json`);
export const STATUS_FILE = path.join(GEN_DIR, 'live-status.json');
/** The pool's Basketball-Reference ids, written by fetchPoolGameLogs.mjs. */
export const INDEX_FILE = path.join(GEN_DIR, 'pool-gamelogs-index.json');
export const MODES = ['mirror', 'season'];

/** The season the live cards are played in — the END year of the base set's name (2026-27 → 2027). */
export const LIVE_SEASON = Number(`20${CURRENT_SET.slice(-2)}`);
/** A regular season, the volume a live row's shooting is trusted at and the window the chart fills to. */
export const FULL_SEASON_GAMES = 82;
/** Game-log pages a night, at DEFAULT_REQUEST_SPACING_MS: about twenty minutes. */
export const MAX_LOG_FETCHES = 220;

/**
 * EW per game from EPM and minutes — fitted 2026-09-23 on the 452 2025-26
 * actual rows with twenty or more games: ewinsPerGame = a·EPM·MPG + b·MPG + c,
 * R² 0.9986, RMSE 0.0019 against a spread of 0.0506. Estimated wins are, to
 * that precision, EPM times playing time, so the model is the figure itself
 * without the early-season division by three games.
 */
export const EW_PER_GAME_MODEL = { epmMinutes: 0.000686, minutes: 0.002077, intercept: -0.000348 };

export function ewinsPerGameFor({ epm, mpg }) {
  if (!Number.isFinite(epm) || !Number.isFinite(mpg)) return null;
  const m = EW_PER_GAME_MODEL;
  return m.epmMinutes * epm * mpg + m.minutes * mpg + m.intercept;
}

/** The expected-page fields a live card cannot be built without. */
export const LIVE_ROW_FIELDS = ['epm', 'epmOff', 'epmDef', 'pts100', 'ast100', 'minutesPer48'];
export const isLiveRow = row => Boolean(row) && LIVE_ROW_FIELDS.every(f => Number.isFinite(row[f]));

const per75 = per100 => (per100 == null ? null : per100 * 0.75);

/**
 * The row every layer but the chart reads, composed from the expected page
 * (everything that is a rate) and the actual page (everything that is a
 * count: games, minutes played, starts). `minutes` is the shooting layer's
 * volume gate and is set to a full season at the expected minutes — see the
 * header; the minutes actually played are kept beside it as `minutesPlayed`.
 */
export function liveActualRow(expected, actual = null) {
  const mpg = expected.minutesPer48;
  const games = actual?.games ?? 0;
  const ewinsPerGame = ewinsPerGameFor({ epm: expected.epm, mpg });
  return {
    name: expected.name,
    personId: expected.personId,
    team: expected.team,
    position: expected.position,
    age: expected.age,
    games,
    minutesPlayed: actual?.minutes ?? 0,
    mpg,
    starts: actual?.starts ?? 0,
    playoffGames: actual?.playoffGames ?? 0,
    epm: expected.epm,
    epmOff: expected.epmOff,
    epmDef: expected.epmDef,
    ewinsPerGame,
    ewins: ewinsPerGame == null ? null : ewinsPerGame * games,
    usage: expected.usage,
    tsPct: expected.tsPct,
    efg: expected.efg,
    fgPctRim: expected.fgPctRim,
    fgPctMid: expected.fgPctMid,
    fgPct2: expected.fgPct2,
    fgPct3: expected.fgPct3,
    ftPct: expected.ftPct,
    fgaRimPer75: per75(expected.fgaRimPer100),
    fgaMidPer75: per75(expected.fgaMidPer100),
    fga3Per75: per75(expected.fga3Per100),
    ftaPer75: per75(expected.ftaPer100),
    fgaPer75: per75((expected.fga2Per100 ?? 0) + (expected.fga3Per100 ?? 0)),
    minutes: mpg * FULL_SEASON_GAMES,
    liveBasis: 'expected',
  };
}

/** One base card as its live twin: the set and the pill changed, a stamp saying what it is. */
export function liveCard(card, stamp) {
  const badges = [...new Set([...(card.badges ?? []), LIVE_BADGE])];
  return { ...card, set: LIVE_SET, badges, live: { ...stamp } };
}

const lookup = (index, name) =>
  index.get(normalizeName(STAT_NAME_ALIASES[name] ?? name)) ?? index.get(normalizeName(name)) ?? null;

export const readBase = () => JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));

const countGames = log => (log ? (log.reg?.length ?? 0) + (log.post?.length ?? 0) : 0);

/**
 * Tonight's inputs: the two dunksandthrees pages, the opponent table and
 * this season's game logs for the pool. `offline` reads the cache alone (a
 * dry run on a finished season); otherwise every page is re-read and the logs
 * are fetched for whoever has played since the cached page, up to
 * `maxFetches` a night. A log that cannot be fetched is not fatal — that
 * player's chart stays on the expected rates tonight — but it is counted.
 */
export async function fetchLiveInputs({
  season = LIVE_SEASON,
  offline = false,
  maxFetches = MAX_LOG_FETCHES,
  spacingMs = DEFAULT_REQUEST_SPACING_MS,
  base = readBase(),
  fetchLog = fetchGameLogFull,
  log = console.log,
} = {}) {
  const force = !offline;
  const expected = offline
    ? readCache(`dunksandthrees-epm-${season}`)
    : await dt.fetchSeasonRates(season, { force });
  if (!expected) throw new Error(`generateLive: no cached dunksandthrees expected rates for ${season} — run without --offline.`);
  const regular = offline
    ? readCache(`dunksandthrees-actual-${season}`)
    : await dt.fetchActualSeasonRates(season, { force });
  if (!regular) throw new Error(`generateLive: no cached dunksandthrees actual rates for ${season} — run without --offline.`);
  let playoffs = [];
  if (offline) {
    playoffs = readCache(`dunksandthrees-actual-${season}-st${dt.SEASON_TYPE_PLAYOFFS}`) ?? [];
  } else {
    try {
      playoffs = await dt.fetchActualSeasonRates(season, { force, seasonType: dt.SEASON_TYPE_PLAYOFFS });
    } catch (e) {
      log(`  no playoff table yet (${String(e.message).split('\n')[0]})`);
    }
  }
  const actual = poolActualSeasons(regular, playoffs);
  log(`dunksandthrees ${season}: ${expected.length} expected rows, ${regular.length} actual, ${playoffs.length} playoff`);

  // The opponent table, refreshed through the keyed API when there is a key.
  let teamEpm = 'cached';
  if (!offline) {
    let hasKey = true;
    try {
      dtApi.apiKey();
    } catch {
      hasKey = false;
    }
    if (!hasKey) {
      teamEpm = 'no key — games unadjusted for the opponent';
      log(`  ${dtApi.API_KEY_ENV} not set: the opponent table stays as cached (or empty)`);
    } else {
      try {
        await dtApi.fetchTeamEpm(season, { force });
        teamEpm = 'refreshed';
      } catch (e) {
        teamEpm = `stale: ${String(e.message).split('\n')[0]}`;
        log(`  team-epm not refreshed: ${e.message}`);
      }
    }
  }
  const defense = seasonTeamDefense(season);
  log(`  opponent table: ${defense.size} teams (${teamEpm})`);

  // This season's game logs, for whoever has played since the cached page.
  const index = fs.existsSync(INDEX_FILE) ? JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')).players ?? {} : {};
  const actualIndex = indexByName(actual);
  const logs = new Map();
  const unmatched = [];
  const failed = [];
  let fetched = 0;
  let current = 0;
  let behind = 0;
  for (const card of base.cards) {
    const playerId = index[card.id]?.playerId;
    if (!playerId) {
      unmatched.push(card.name);
      continue;
    }
    const known = lookup(actualIndex, card.name)?.games ?? 0;
    const key = `gamelog-full-${playerId}-${season}`;
    let have = countGames(readCache(key));
    if (!offline && known > have && fetched < maxFetches) {
      try {
        const page = await fetchLog(playerId, season);
        writeCache(key, page);
        have = countGames(page);
        fetched += 1;
        if (fetched % 25 === 0) log(`  ...${fetched} game-log pages fetched (${card.name})`);
        await politeDelay(spacingMs);
      } catch (e) {
        failed.push(card.name);
        log(`  FAIL ${card.name} (${playerId}, ${season}): ${e.message}`);
      }
    }
    if (have >= known) current += 1;
    else behind += 1;
    logs.set(card.id, { playerId, known, have });
  }
  const logStatus = { current, behind, fetched, failed, unmatched };
  log(
    `Game logs: ${current} current, ${behind} behind dunksandthrees' count, ${fetched} fetched tonight, ` +
      `${failed.length} failed, ${unmatched.length} unmatched`
  );
  return { season, expected, actual, defense, teamEpm, logs, logStatus };
}

const statusFor = real =>
  real >= WINDOW_GAMES
    ? 'his last 82 real games'
    : real
      ? `${real} real games, ${WINDOW_GAMES - real} from the expected rates`
      : 'the expected rates alone';

/**
 * The season's cards from tonight's inputs, in base-set order. `loadRows` is
 * realGames.js's cached-log reader, injectable so a test can hand in a log.
 */
export function buildSeason({ base, inputs, asOf, log = console.log, loadRows = liveSeasonRows } = {}) {
  const { season, expected, actual, defense, logs } = inputs;
  const asOfDate = String(asOf).slice(0, 10);
  const expectedIndex = indexByName(expected);
  const actualIndex = indexByName(actual);
  const calibration = JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'));
  // The synthetic fill's level, on the base set's real-log scale. Refused
  // without it: a live set on the published set's level prints stronger
  // cards than the base set it is played beside (calibrateLiveFill.js).
  if (!fs.existsSync(LIVE_FILL_FILE)) {
    throw new Error(`generateLive: no ${path.relative(REPO_ROOT, LIVE_FILL_FILE)} — run node scripts/cardgen/calibrateLiveFill.js first.`);
  }
  const fill = JSON.parse(fs.readFileSync(LIVE_FILL_FILE, 'utf8'));

  const pool = [];
  const teams = [];
  const rows = [];
  const mirrors = [];
  const realGamesById = new Map();
  const stamps = new Map();
  for (const card of base.cards) {
    const e = lookup(expectedIndex, card.name);
    if (!isLiveRow(e)) {
      mirrors.push({ ...card });
      stamps.set(card.id, {
        status: e ? 'awaiting an expected EPM' : "not on this season's table",
        games: { real: 0, synthetic: 0 },
      });
      continue;
    }
    const a = lookup(actualIndex, card.name);
    rows.push(liveActualRow(e, a));
    const team = e.team ?? card.team;
    pool.push({ name: card.name, team, pos: card.pos, games: FULL_SEASON_GAMES, mpg: e.minutesPer48 });
    teams.push({ name: card.name, team, pos: card.pos });
    const entry = logs.get(card.id);
    const real = entry ? loadRows(entry.playerId, season, defense, { asOf: asOfDate }) : null;
    if (real) realGamesById.set(card.id, real);
    const n = real?.length ?? 0;
    stamps.set(card.id, { status: statusFor(n), games: { real: n, synthetic: Math.max(0, WINDOW_GAMES - n) } });
  }

  const speedPower = buildSpeedPowerTotals({ pool, actual: rows });
  const built = generateCards({
    pool,
    teams,
    speedPower: speedPower.records,
    rates: expected,
    actual: rows,
    calibration,
    biometrics: indexBiometrics(loadBiometrics()),
    positionShares: indexPositionShares(loadPositionShares()),
    // The base set's hand-tuned charts are about the base set's numbers.
    overrides: {},
    // The mirrored cards join the field before pricing, the way the
    // carried-forward cards do in the base build.
    carryForwardCards: { cards: mirrors, missing: [] },
    realGamesById,
    windowCounts: new Map(),
    chartFill: WINDOW_GAMES,
    chartFillCalibration: fill,
    sharesSeason: CURRENT_STATS_SEASON,
  });
  for (const list of ['missingRates', 'missingActual']) {
    if (built[list].length) log(`  ${list}: ${built[list].join(', ')}`);
  }

  const byId = new Map(built.cards.map(c => [c.id, c]));
  const source = `dunksandthrees.com /epm ${season} (expected) + /epm/actual; Basketball-Reference ${season} game logs`;
  const cards = base.cards.map(card => {
    const b = byId.get(card.id);
    if (!b) throw new Error(`generateLive: ${card.id} fell out of the build`);
    return liveCard({ ...card, ...b }, { mode: 'season', asOf, source, season, ...stamps.get(card.id) });
  });
  const real = [...stamps.values()].filter(s => s.games.real > 0).length;
  const full = [...stamps.values()].filter(s => s.games.real >= WINDOW_GAMES).length;
  log(`Live Series ${season}: ${rows.length} built from the expected page, ${mirrors.length} mirrored; ${real} with real games, ${full} on a full window`);
  return {
    set: LIVE_SET,
    generatedAt: asOf,
    live: {
      mode: 'season',
      asOf,
      source,
      season,
      built: rows.length,
      mirrored: mirrors.length,
      withRealGames: real,
      fullWindows: full,
      logs: inputs.logStatus,
      teamEpm: inputs.teamEpm,
      fillLevel: { basis: fill.basis, generatedAt: fill.generatedAt, players: fill.players },
    },
    note:
      'THE LIVE SERIES (scripts/cardgen/generateLive.js): the 2026-27 base cards as the season moves them. ' +
      `Season mode as of ${asOfDate}: Speed/Power/Def Boost and the shooting layer from dunksandthrees' ` +
      'EXPECTED page, the chart from this season\'s real games topped up to 82 with synthetic games from ' +
      'the expected per-100 rates, salary priced against the live field. Faces: node scripts/studio/export.js --set live.',
    cards,
  };
}

function mirrorBody(base, asOf) {
  const source = `cards-${CURRENT_SET}.json`;
  const stamp = { mode: 'mirror', asOf, source };
  return {
    set: LIVE_SET,
    generatedAt: asOf,
    live: stamp,
    note:
      'THE LIVE SERIES (scripts/cardgen/generateLive.js): the 2026-27 base cards as the season moves them. ' +
      'Mode "mirror" — a mirror of the base set until the season starts. ' +
      'Faces: node scripts/studio/export.js --set live; photos are the base set\'s (setPaths).',
    cards: base.cards.map(c => liveCard(c, stamp)),
  };
}

export async function main({
  mode = 'mirror',
  season = LIVE_SEASON,
  asOf = new Date().toISOString(),
  offline = false,
  maxFetches = MAX_LOG_FETCHES,
  out = OUTPUT_FILE,
  statusFile = STATUS_FILE,
  log = console.log,
} = {}) {
  if (!MODES.includes(mode)) throw new Error(`generateLive: no such mode ${mode} (${MODES.join(', ')})`);
  const base = readBase();
  let body;
  if (mode === 'mirror') {
    body = mirrorBody(base, asOf);
  } else {
    const inputs = await fetchLiveInputs({ season, offline, maxFetches, base, log });
    body = buildSeason({ base, inputs, asOf, log });
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(body, null, 1)}\n`);
  if (statusFile) {
    fs.writeFileSync(statusFile, `${JSON.stringify({ set: LIVE_SET, cards: body.cards.length, ...body.live }, null, 1)}\n`);
  }
  log(`Live Series: ${body.cards.length} cards, mode ${mode}, as of ${asOf}.\n  ${out}`);
  return body;
}

function parseArgs(argv) {
  const flag = name => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const asOfArg = flag('--as-of');
  return {
    mode: flag('--mode') ?? 'mirror',
    season: flag('--season') ? Number(flag('--season')) : LIVE_SEASON,
    asOf: asOfArg ? new Date(`${asOfArg}T09:00:00.000Z`).toISOString() : new Date().toISOString(),
    offline: argv.includes('--offline'),
    maxFetches: flag('--max-fetches') ? Number(flag('--max-fetches')) : MAX_LOG_FETCHES,
    out: flag('--out') ? path.resolve(flag('--out')) : OUTPUT_FILE,
    // A dry run written elsewhere leaves the committed status alone too.
    statusFile: flag('--out') ? null : STATUS_FILE,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(parseArgs(process.argv.slice(2))).catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}
