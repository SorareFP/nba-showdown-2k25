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
// as the user chose, and every layer reads THE EXPECTED PAGE: dunksandthrees'
// own until 2026-11-04, and since 2026-11-12 one made the same shape from
// Basketball-Reference (liveExpected.js), when their site began refusing
// every scripted read. What follows describes their page; liveExpected.js
// says how ours stands in for it.
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
// THE ADDITIONS (2026-10-28; the user: "Can we try to generate charts for the
// live series cards that don't have them? Then withhold players who don't have
// charts from packs"). Players on a 2026-27 roster with no base card — the
// rookies, the returning and the short seasons of card-data/live-rookies.json —
// are carded from the same expected page, in a second build whose charts are
// placed against the base cards' field and whose salaries are priced against
// it (priceSet's basis), so adding them moves no base card. A player is carded
// once they have a usable expected row, which is what makes a chart; one with
// no row yet is WITHHELD — out of the set, so out of every pack — and listed,
// with why, in live-status.json. A photo is not required: the face shows the
// placeholder until one lands (the user, 2026-10-28: "Placeholder photos are
// fine, I just don't want non-chart cards in packs"). The rookies wear the
// Live rookie look (the ROOKIE pill dated 2026-27).
//
// Every card carries `live: { mode, asOf, source, season, status, games }`,
// so a face, a tile or a test can tell what it is looking at, and
// live-status.json says the same for the whole set.
//
// WHAT THE RUNNER NEEDS, and nothing else: the committed generated files
// (calibration, biometrics, positional shares, the EPM archive, the pool's
// game-log index for Basketball-Reference ids), two page reads from
// dunksandthrees, Basketball-Reference's team page (the opponent table) and
// per-game page (who has played how many games) and this season's
// game-log pages — fetched only for players whose game count has moved past
// the cached log, at the polite spacing, capped per night and cached between
// nights (actions/cache). No 325 MB cache, no
// last-season basis: the user answered the two design questions on
// 2026-09-23 ("yes, and the latter"), and the latter made the basis
// unnecessary.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, readCache, writeCache, politeDelay, DEFAULT_REQUEST_SPACING_MS } from './cache.js';
import { CURRENT_SET, LIVE_SET } from '../../src/cards/sets.js';
import { LIVE_BADGE, ROOKIE_BADGE } from '../../src/cards/badges.js';
import { playerIdFromName } from '../../src/cards/playerId.js';
import { FREE_AGENT } from '../../src/cards/teams.js';
import { fetchGameLogFull } from './sources/basketballReference.js';
import { seasonRows, expectedTable, actualTable, fetchSeason, readImpactPrior, impactPriorFile } from './liveExpected.js';
import { liveSeasonRows, seasonTeamDefense, teamDefenseFromRatings, WINDOW_GAMES } from './realGames.js';
import { buildSpeedPowerTotals } from './speedPower.js';
import { generateCards, indexByName, STAT_NAME_ALIASES } from './generateCards.js';
import { computePlayValue, priceSet } from './playValue.js';
import { roundSalary, SALARY_MIN, SALARY_MAX } from './attributes.js';
import { indexBiometrics, loadBiometrics } from './biometrics.js';
import { indexPositionShares, loadPositionShares } from './positionShares.js';
import { CALIBRATION_FILE } from './calibrateAttributes.js';
import { OUTPUT_FILE as LIVE_FILL_FILE } from './calibrateLiveFill.js';
import { CURRENT_STATS_SEASON, dedupeByMaxGames, fetchTeamAdvancedCached } from './fetchCalibrationData.js';
import { isNeverCard } from '../../src/game/neverCard.js';
import { normalizeName } from './resolveTeams.js';
import { HISTORY_FILE, updateHistory } from './liveHistory.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const BASE_FILE = path.join(GEN_DIR, `cards-${CURRENT_SET}.json`);
export const OUTPUT_FILE = path.join(GEN_DIR, `cards-${LIVE_SET}.json`);
export const STATUS_FILE = path.join(GEN_DIR, 'live-status.json');
/** The pool's Basketball-Reference ids, written by fetchPoolGameLogs.mjs. */
export const INDEX_FILE = path.join(GEN_DIR, 'pool-gamelogs-index.json');
export const MODES = ['mirror', 'season'];
/**
 * The night's salaries, a public file published with the site for the Cloud
 * Functions to read (functions/liveRefresh.js). Gitignored: only the nightly
 * job's build carries it, and a local deploy leaves the site's copy be
 * (deploySync.mjs strip).
 */
export const SALARIES_FILE = path.join(REPO_ROOT, 'public', 'live-salaries.json');
/** The Live Series' additions: on a 2026-27 roster with no base card (see the header). */
export const ADDITIONS_FILE = path.join(REPO_ROOT, 'card-data', 'live-rookies.json');
/** The season a carded rookie's pill is dated (the base set's name). */
export const ROOKIE_SEASON_LABEL = CURRENT_SET;

/** The additions, in file order: rookies, then returning, then short seasons; never one left out. */
export function readAdditions(file = ADDITIONS_FILE) {
  if (!fs.existsSync(file)) return [];
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = new Set((body.leftOut ?? []).map(x => x?.id ?? x));
  const of = (list, kind) => (list ?? [])
    .filter(a => a?.id && !out.has(a.id))
    .map(a => ({ id: a.id, name: a.name, team: a.team, pos: a.pos, kind }));
  return [...of(body.rookies, 'rookie'), ...of(body.returning, 'returning'), ...of(body.shortSeason, 'shortSeason')];
}

/**
 * A card's position for a player with no base card: Basketball-Reference's
 * when they have played (its first listed), else nba.com's three-letter kind
 * read through the expected rates — a guard who sets up six assists per 100
 * is a PG, a forward with 11 rebounds per 100 a PF.
 */
export function cardPosition(nbaPos, row = null, bbrefPos = null) {
  const bb = String(bbrefPos ?? '').split('-')[0];
  if (['PG', 'SG', 'SF', 'PF', 'C'].includes(bb)) return bb;
  const p = String(nbaPos ?? '').toUpperCase();
  if (p === 'C' || p === 'C-F') return 'C';
  if (p === 'F-C') return 'PF';
  if (p === 'G-F') return 'SG';
  if (p === 'F-G') return 'SF';
  if (p === 'G') return (row?.ast100 ?? 0) >= 6 ? 'PG' : 'SG';
  if (p === 'F') return (row?.orb100 ?? 0) + (row?.drb100 ?? 0) >= 11 ? 'PF' : 'SF';
  return 'SF';
}

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

/**
 * A LIVE CARD'S TEAM: dunksandthrees' for a player on a roster (it follows a
 * trade the night it happens), but a Free Agent stays one. dunksandthrees keeps
 * a waived player on their last club, and the first season-mode run (2026-10-22)
 * printed the four cut that day (Bruce Brown, Micah Peavy, Dwight Powell, Drew
 * Eubanks) on their old teams; the base set's FA is the rule (nba.com's rosters,
 * card_team_mismatches, isUnsignedCard).
 */
export function liveTeam(card, expectedRow) {
  if (card?.team === FREE_AGENT) return FREE_AGENT;
  return expectedRow?.team || card?.team;
}
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
 * WHO HAS PLAYED HOW MANY GAMES (2026-10-26). The logs used to be fetched
 * when dunksandthrees' ACTUAL page counted new games, and a week into the
 * season that page still served 2025-26 only, so no card had a real game in
 * it (live-status: withRealGames 0). Basketball-Reference's per-game page
 * counts every player's games on one page, by the same ids the logs are kept
 * under; a traded player's rows give the most games (the 2TM total). The user:
 * "Yes please" to counting from it.
 */
export function gamesByPlayer(rows) {
  const out = new Map();
  for (const r of rows ?? []) {
    const n = Number(r?.games) || 0;
    if (r?.playerId && n > (out.get(r.playerId) ?? 0)) out.set(r.playerId, n);
  }
  return out;
}

/** A player's games so far: the larger of Basketball-Reference's count and dunksandthrees'. */
export const gamesPlayed = (playerId, name, counts, actualIndex) =>
  Math.max(counts?.get(playerId) ?? 0, lookup(actualIndex, name)?.games ?? 0);

/**
 * THE OPPONENT TABLE, tonight's (2026-11-02). From Basketball-Reference's team
 * ratings: the keyed team EPM went dead on 10-22, and the user calls that API a
 * non-starter. Without the page the run goes on, on whatever dunksandthrees
 * table is cached for the season (a dry run on an old one) or unadjusted.
 */
export async function readOpponents(season, {
  offline = false,
  fetchTeams = s => fetchTeamAdvancedCached(s, { force: true }),
  log = console.log,
} = {}) {
  try {
    const teams = (offline ? readCache(`bbref-${season}-teamAdvanced`) : await fetchTeams(season)) ?? [];
    if (teams.length) {
      return { defense: teamDefenseFromRatings(season, teams), opponents: `basketball-reference: ${teams.length} teams` };
    }
    return { defense: seasonTeamDefense(season), opponents: 'no team table: games unadjusted unless one is cached' };
  } catch (e) {
    const why = String(e.message).split('\n')[0];
    log(`  no Basketball-Reference team page: ${why}`);
    return { defense: seasonTeamDefense(season), opponents: `unavailable (${why}): games unadjusted unless one is cached` };
  }
}

/**
 * WHO HAS PLAYED WITH NO LIVE CARD (2026-11-02; the user: "Perfect"). The
 * additions are a hand-kept list, so a signing or a late call-up is missed
 * unless the job says so. `rows` is Basketball-Reference's per-game page: a card
 * is known by its id there (`index`, the names can differ) or by name. Whoever
 * was left out on purpose and the never-card names are not listed. The most
 * minutes played come first, so the rotation players lead.
 */
export function uncardedPlayers({ cards, rows, index = {}, leftOut = [] }) {
  const ids = new Set(cards.map(c => index[c.id]?.playerId).filter(Boolean));
  const names = new Set([...cards, ...leftOut].map(c => normalizeName(c.name)));
  return (rows ?? [])
    .filter(r => r?.playerId && !ids.has(r.playerId) && !names.has(normalizeName(r.name)) && !isNeverCard(r.name))
    .map(r => ({ name: r.name, team: r.team ?? null, games: r.games ?? 0, mpg: r.mpg ?? 0 }))
    .sort((a, b) => (b.games * b.mpg) - (a.games * a.mpg) || a.name.localeCompare(b.name));
}

/** Who live-rookies.json leaves out on purpose. */
function readLeftOut(file = ADDITIONS_FILE) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).leftOut ?? [];
}

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
  additions = readAdditions(),
  fetchLog = fetchGameLogFull,
  fetchTables = fetchSeason,
  fetchTeams = s => fetchTeamAdvancedCached(s, { force: true }),
  impactPrior = readImpactPrior(impactPriorFile(season - 1)),
  log = console.log,
} = {}) {
  // THE EXPECTED TABLE (2026-11-12), made from Basketball-Reference: this
  // season's four tables read afresh, the three before from the cache after
  // their first night, last season's impact dunksandthrees' own (liveExpected.js).
  const between = () => politeDelay(spacingMs);
  const nowTables = await fetchTables(season, { force: !offline, offline, between });
  if (!nowTables.advanced?.length) {
    throw new Error(`generateLive: no Basketball-Reference ${season} tables${offline ? ' cached — run without --offline' : ''}.`);
  }
  const thisSeason = seasonRows(nowTables);
  const priors = [];
  for (const s of [season - 1, season - 2, season - 3]) {
    priors.push(seasonRows(await fetchTables(s, { offline, between }), s === season - 1 ? impactPrior : new Map()));
  }
  const expected = expectedTable({ current: thisSeason, priors });
  const actual = actualTable(thisSeason);
  log(
    `Basketball-Reference ${season}: ${expected.length} expected rows, ${thisSeason.size} players this season; ` +
      `priors ${priors.map(p => p.size).join('/')}, ${impactPrior.size} on dunksandthrees' own ${season - 1} impact`
  );

  // The games each player has played, from the same per-game page.
  const countRows = dedupeByMaxGames(nowTables.perGame ?? []);
  const counts = gamesByPlayer(countRows);
  const countsFrom = 'basketball-reference';
  log(`  games played: ${counts.size} players on Basketball-Reference's ${season} per-game page`);

  const { defense, opponents } = await readOpponents(season, { offline, fetchTeams, log });
  log(`  opponent table: ${defense.size} teams (${opponents})`);
  if (!offline) await politeDelay(spacingMs);

  // A player's row on that page by name: the Basketball-Reference id and
  // position an addition has no index entry for.
  const bbrefByName = new Map((countRows ?? []).filter(r => r?.playerId).map(r => [normalizeName(r.name), r]));

  // This season's game logs, for whoever has played since the cached page.
  const index = fs.existsSync(INDEX_FILE) ? JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')).players ?? {} : {};
  const actualIndex = indexByName(actual);
  const logs = new Map();
  const unmatched = [];
  const failed = [];
  let fetched = 0;
  let current = 0;
  let behind = 0;
  for (const card of [...base.cards, ...additions]) {
    const playerId = index[card.id]?.playerId ?? bbrefByName.get(normalizeName(card.name))?.playerId;
    if (!playerId) {
      unmatched.push(card.name);
      continue;
    }
    const known = gamesPlayed(playerId, card.name, counts, actualIndex);
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
  const logStatus = { countsFrom, current, behind, fetched, failed, unmatched };
  log(
    `Game logs: ${current} current, ${behind} behind the games played, ${fetched} fetched tonight, ` +
      `${failed.length} failed, ${unmatched.length} unmatched`
  );
  const uncarded = uncardedPlayers({ cards: [...base.cards, ...additions], rows: countRows, index, leftOut: readLeftOut() });
  if (uncarded.length) log(`  ${uncarded.length} played with no Live card: ${uncarded.slice(0, 5).map(p => p.name).join(', ')}…`);
  const expectedFrom = {
    source: 'basketball-reference',
    rows: expected.length,
    withGames: expected.filter(r => r.basis.currentMinutes > 0).length,
    impactPrior: impactPrior.size,
  };
  return { season, expected, actual, defense, opponents, logs, logStatus, additions, bbrefByName, uncarded, expectedFrom };
}

/**
 * LAST NIGHT'S CARD, KEPT (2026-11-12). A card in the set stays in it: someone
 * may own it. A player with no row tonight (a rookie yet to play, carded from
 * dunksandthrees' draft-based row before the block; a page that failed to
 * parse) keeps the card they had, stamped with when it was built.
 */
export function keptCard(prev, asOf) {
  const from = prev.live?.keptFrom ?? prev.live?.asOf ?? null;
  return {
    ...prev,
    live: {
      ...prev.live,
      asOf,
      keptFrom: from,
      status: `kept from ${String(from ?? 'an earlier build').slice(0, 10)}: not on tonight's table`,
      games: prev.live?.games ?? { real: 0, synthetic: 0 },
    },
  };
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
export function buildSeason({ base, inputs, asOf, previous = [], log = console.log, loadRows = liveSeasonRows } = {}) {
  const { season, expected, actual, defense, logs } = inputs;
  const previousById = new Map(previous.map(c => [c.id, c]));
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
      // Last night's numbers if there were any, the base card's if not;
      // either way repriced against tonight's field.
      const prev = previousById.get(card.id);
      if (prev?.live?.mode === 'season') {
        const { live, set, badges, ...numbers } = keptCard(prev, asOf);
        mirrors.push({ ...card, ...numbers, id: card.id, name: card.name });
        stamps.set(card.id, { status: live.status, keptFrom: live.keptFrom, games: live.games });
        continue;
      }
      mirrors.push({ ...card });
      stamps.set(card.id, {
        status: e ? 'awaiting an expected EPM' : "not on this season's table",
        games: { real: 0, synthetic: 0 },
      });
      continue;
    }
    const a = lookup(actualIndex, card.name);
    rows.push(liveActualRow(e, a));
    const team = liveTeam(card, e);
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
  const source = `Basketball-Reference ${season}: expected numbers made from the last three seasons and this one (liveExpected.js), games played and game logs`;
  const cards = base.cards.map(card => {
    const b = byId.get(card.id);
    if (!b) throw new Error(`generateLive: ${card.id} fell out of the build`);
    return liveCard({ ...card, ...b }, { mode: 'season', asOf, source, season, ...stamps.get(card.id) });
  });
  const added = buildAdditions({
    additions: inputs.additions ?? [], inputs, expectedIndex, actualIndex, asOf, asOfDate, source,
    calibration, fill, field: built.cards, loadRows, previousById,
  });
  for (const [id, s] of added.stamps) stamps.set(id, s);
  cards.push(...added.cards);
  const real = [...stamps.values()].filter(s => s.games.real > 0).length;
  const full = [...stamps.values()].filter(s => s.games.real >= WINDOW_GAMES).length;
  const kept = [...stamps.values()].filter(s => s.keptFrom).length;
  log(`Live Series ${season}: ${rows.length} built from the expected page, ${mirrors.length} mirrored or kept (${kept} kept from an earlier night); ${real} with real games, ${full} on a full window`);
  log(`  additions: ${added.cards.length} carded, ${added.withheld.length} withheld (${[...new Set(added.withheld.map(w => w.why))].join('; ') || 'none'})`);
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
      kept,
      expectedFrom: inputs.expectedFrom ?? null,
      additions: { carded: added.cards.length, withheld: added.withheld },
      withRealGames: real,
      fullWindows: full,
      logs: inputs.logStatus,
      opponents: inputs.opponents,
      uncarded: inputs.uncarded ?? [],
      fillLevel: { basis: fill.basis, generatedAt: fill.generatedAt, players: fill.players },
    },
    note:
      'THE LIVE SERIES (scripts/cardgen/generateLive.js): the 2026-27 base cards as the season moves them. ' +
      `Season mode as of ${asOfDate}: Speed/Power/Def Boost and the shooting layer from the expected numbers ` +
      'made from Basketball-Reference (liveExpected.js), the chart from this season\'s real games topped up to 82 with synthetic games from ' +
      'the expected per-100 rates, salary priced against the live field. Faces: node scripts/studio/export.js --set live.',
    cards,
  };
}

/**
 * THE ADDITIONS' BUILD (see the header): those with an expected row, built
 * against the base cards' field and priced on its values. The rest come back
 * as `withheld`, with why.
 */
export function buildAdditions({ additions, inputs, expectedIndex, actualIndex, asOf, asOfDate, source, calibration, fill, field, loadRows, previousById = new Map() }) {
  const withheld = [];
  const kept = new Map();
  const pool = [];
  const teams = [];
  const rows = [];
  const realGamesById = new Map();
  const stamps = new Map();
  const picked = [];
  for (const a of additions) {
    const e = lookup(expectedIndex, a.name);
    if (!isLiveRow(e)) {
      const prev = previousById.get(a.id);
      if (prev) {
        const card = keptCard(prev, asOf);
        kept.set(a.id, card);
        stamps.set(a.id, { status: card.live.status, keptFrom: card.live.keptFrom, games: card.live.games, addition: a.kind });
      } else {
        withheld.push({ id: a.id, name: a.name, kind: a.kind, why: 'no expected EPM yet' });
      }
      continue;
    }
    const pos = cardPosition(e.position || a.pos, e, inputs.bbrefByName?.get(normalizeName(a.name))?.pos);
    const team = liveTeam(a, e);
    rows.push(liveActualRow(e, lookup(actualIndex, a.name)));
    pool.push({ name: a.name, team, pos, games: FULL_SEASON_GAMES, mpg: e.minutesPer48 });
    teams.push({ name: a.name, team, pos });
    // The generator keys a card by the id it makes from the name; the file's id is the card's.
    const genId = playerIdFromName(a.name);
    const entry = inputs.logs?.get(a.id);
    const real = entry ? loadRows(entry.playerId, inputs.season, inputs.defense, { asOf: asOfDate }) : null;
    if (real) realGamesById.set(genId, real);
    const n = real?.length ?? 0;
    stamps.set(a.id, { status: statusFor(n), games: { real: n, synthetic: Math.max(0, WINDOW_GAMES - n) }, addition: a.kind });
    picked.push({ a, genId });
  }
  const inOrder = carded => additions.map(a => carded.get(a.id) ?? kept.get(a.id)).filter(Boolean);
  if (!picked.length) return { cards: inOrder(new Map()), withheld, stamps };

  const speedPower = buildSpeedPowerTotals({ pool, actual: rows });
  const built = generateCards({
    pool,
    teams,
    speedPower: speedPower.records,
    rates: inputs.expected,
    actual: rows,
    calibration,
    biometrics: indexBiometrics(loadBiometrics()),
    positionShares: indexPositionShares(loadPositionShares()),
    overrides: {},
    carryForwardCards: { cards: [], missing: [] },
    realGamesById,
    windowCounts: new Map(),
    chartFill: WINDOW_GAMES,
    chartFillCalibration: fill,
    sharesSeason: CURRENT_STATS_SEASON,
    opponentField: field.map(c => ({ speed: c.speed, power: c.power, defBoost: c.defBoost ?? 0 })),
  });
  // Priced against the set they join, on its own values: its prices stay put.
  const { value: basis } = computePlayValue(field, { field });
  const salaries = priceSet(built.cards, { field, basis, roundSalary, min: SALARY_MIN, max: SALARY_MAX });
  const byGen = new Map(built.cards.map((c, i) => [c.id, { ...c, salary: salaries[i] }]));
  const carded = new Map(picked.map(({ a, genId }) => {
    const b = byGen.get(genId);
    if (!b) throw new Error(`generateLive: the addition ${a.id} fell out of the build`);
    const look = a.kind === 'rookie' ? { badges: [LIVE_BADGE, ROOKIE_BADGE], seasonLabel: ROOKIE_SEASON_LABEL } : {};
    return [a.id, liveCard({ ...b, id: a.id, name: a.name, ...look }, { mode: 'season', asOf, source, season: inputs.season, ...stamps.get(a.id) })];
  }));
  return { cards: inOrder(carded), withheld, stamps };
}

/** All the server needs of a Live card: what prices it and whether it is signed. */
export function liveSalariesBody(cards, asOf) {
  return { asOf, cards: Object.fromEntries(cards.map(c => [c.id, [c.salary, c.team]])) };
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
  historyFile = HISTORY_FILE,
  salariesFile = SALARIES_FILE,
  previousFile = OUTPUT_FILE,
  log = console.log,
} = {}) {
  if (!MODES.includes(mode)) throw new Error(`generateLive: no such mode ${mode} (${MODES.join(', ')})`);
  const base = readBase();
  let body;
  if (mode === 'mirror') {
    body = mirrorBody(base, asOf);
  } else {
    const inputs = await fetchLiveInputs({ season, offline, maxFetches, base, log });
    // The committed set, so a card no row reaches tonight keeps its numbers.
    const previous = fs.existsSync(previousFile) ? JSON.parse(fs.readFileSync(previousFile, 'utf8')).cards ?? [] : [];
    body = buildSeason({ base, inputs, asOf, previous, log });
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(body, null, 1)}\n`);
  if (statusFile) {
    fs.writeFileSync(statusFile, `${JSON.stringify({ set: LIVE_SET, cards: body.cards.length, ...body.live }, null, 1)}\n`);
  }
  if (salariesFile) {
    fs.mkdirSync(path.dirname(salariesFile), { recursive: true });
    fs.writeFileSync(salariesFile, `${JSON.stringify(liveSalariesBody(body.cards, asOf))}\n`);
  }
  log(`Live Series: ${body.cards.length} cards, mode ${mode}, as of ${asOf}.\n  ${out}`);
  // The night by night the Live Series view reads (liveHistory.js): the
  // season's nights only, so a mirror build records none.
  if (historyFile && mode === 'season') updateHistory({ file: historyFile, date: String(asOf).slice(0, 10), cards: body.cards, log });
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
    // A dry run written elsewhere leaves the committed status alone too, and the history.
    statusFile: flag('--out') ? null : STATUS_FILE,
    historyFile: flag('--out') ? null : HISTORY_FILE,
    salariesFile: flag('--out') ? null : SALARIES_FILE,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(parseArgs(process.argv.slice(2))).catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}
