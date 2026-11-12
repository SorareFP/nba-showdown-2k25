// THE LIVE SERIES' EXPECTED NUMBERS, MADE HERE (2026-11-12).
//
// dunksandthrees served the Live Series its EXPECTED page (each player's
// predicted impact, rates and shooting, from their career and this season)
// until 2026-11-05, when the site began refusing every scripted read: a 403 to
// GitHub's runner and to the user's own machine alike, while the page still
// opens in a browser. Seven nightly runs failed on it. Its keyed API was ruled
// out on price on 2026-10-28 ("a non-starter"), and asked where the numbers
// should come from now, the user chose Basketball-Reference.
//
// So the expected row is made here, in dunksandthrees' shape (toSeasonRate in
// sources/dunksAndThrees.js), from Basketball-Reference's season tables:
// advanced, per 100 possessions, shooting and per game. Everything
// downstream (Speed/Power, the shooting layer, the chart's fill) reads it as
// it read theirs.
//
// ── THE RECIPE ───────────────────────────────────────────────────────────────
//
// Every number is a PRIOR from the last three seasons, blended with THIS season
// by how much of this season there is.
//
//   prior   the last three seasons weighted 1, 0.25 and 0.1 by minutes (by
//           attempts for a percentage), pulled toward a fringe player's
//           figure by PRIOR_SHRINK, so a 200-minute season says little. No
//           season at all (a rookie): the fringe figure alone.
//   blend   (prior x K + this season x volume) / (K + volume), K from
//           CURRENT_K: how much of this season counts as much as the prior.
//
// Measured against dunksandthrees' own Expected table of 2026-11-02 (cached
// before the block), the prior reads their offence at r 0.92 and their defence
// at 0.81, near the 0.93 and 0.82 their own last season reads it at; points
// and assists per 100 at 0.96. The weights and the shrink are the grid's best
// (1/0.5/0.25 and 300 minutes, 1/0.25/0 and 150, last season alone: all
// within 0.01 of it).
//
// The weights on THIS season are a judgment, not a fit: there is no dated
// Basketball-Reference table to fit them on. Impact (BPM) is the noisiest
// thing measured, so this season's 1,000 minutes weigh as much as the prior
// on offence, and 1,500 on defence, where DBPM reads their numbers less well
// (r 0.77 against 0.94: (0.94 / 0.77) squared is about 1.5); counting rates
// settle faster (400 minutes); a percentage is weighed in attempts,
// three-point percentage slowest of all.
//
// ── IMPACT: their numbers where we have them ─────────────────────────────────
//
// Last season's impact is dunksandthrees' OWN for every player in the base
// set's pool: speed-power-totals-2026.json, the record the base cards' Speed
// and Power were built from, already in the repo. Box-score plus-minus reads
// defence poorly (DBPM against their defensive EPM, r 0.69: Gobert 1.4 against
// 4.6, Jokic 3.7 against 1.1, and no box-score correction moved r past 0.70),
// so the season that weighs most in the prior is theirs, and a Live card opens
// the season close to its base card. Older seasons and anyone outside that pool
// (a short season, a rookie's first games) read Basketball-Reference's OBPM
// and DBPM through ACTUAL_BRIDGE, and so does THIS season.
//
// ── THE BRIDGE onto dunksandthrees' scale ────────────────────────────────────
//
// The base set was built from dunksandthrees' numbers, and a Live card is
// played beside it, so each Basketball-Reference figure is mapped onto theirs.
// Fitted 2026-11-12 on 2025-26 (377 players with 500+ minutes, minutes-weighted):
//
//   offence  OBPM -> EPM offence r 0.944    defence  DBPM -> EPM defence r 0.772
//   rim FG%  0-3 ft -> their rim r 0.886    (their rim zone is wider, so lower)
//   rim and midrange attempts r 0.97        usage, TS%, 2P%, 3P%, FT%: the same
//
// The blend runs on their ACTUAL scale, and EXPECTED_BRIDGE then moves it onto
// their Expected page's (the scale a Live card was built on until the block),
// fitted on the prior against their Expected table of 2026-11-02.
import { cached } from './cache.js';
import * as bbref from './sources/basketballReference.js';
import { trimSeasonTable, dedupeByMaxGames } from './fetchCalibrationData.js';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache } from './cache.js';
import { canonicalTeam } from '../../src/cards/teams.js';
import { normalizeName } from './resolveTeams.js';

/** The last three seasons' weights in the prior, most recent first. */
export const PRIOR_SEASON_WEIGHTS = [1, 0.25, 0.1];

/** How hard the prior is pulled toward the fringe player: minutes, games, or attempts. */
export const PRIOR_SHRINK = { minutes: 100, games: 10, three: 150, ft: 100, two: 150, rim: 100, mid: 150, ts: 200, efg: 200 };

/** How much of this season counts as much as the prior, in the same units. */
export const CURRENT_K = { impact: 1000, impactDef: 1500, rate: 400, games: 10, three: 400, ft: 150, two: 250, rim: 150, mid: 250, ts: 400, efg: 400 };

/** `[intercept, slope]` from a Basketball-Reference figure to dunksandthrees'. See the header. */
export const BRIDGE = {
  fgPctRim: [0.06, 0.831],
  fgPctMid: [-0.031, 1.016],
  tsPct: [-0.006, 1.013],
  usage: [0.002, 0.974],
  // Their attempts are per 75 possessions, 0.74 of a Basketball-Reference 100.
  fgaRimPer75: [0.471, 0.922],
  fgaMidPer75: [-0.555, 0.643],
};
const PER75_OF_100 = 0.74;

/**
 * Their actual scale onto their Expected page's: see the header. The slopes
 * are above 1 because the prior is the more cautious of the two about a star.
 */
export const EXPECTED_BRIDGE = { epmOff: [-0.432, 1.148], epmDef: [0.377, 1.116] };

/** OBPM and DBPM onto their ACTUAL offensive and defensive EPM (2025-26, r 0.944 and 0.772). */
export const ACTUAL_BRIDGE = { epmOff: [0.002, 0.772], epmDef: [0.002, 0.743] };

/** A season's impact, theirs: the base set's Speed/Power record for it (2026 = 2025-26). */
export const impactPriorFile = season => path.join(REPO_ROOT, 'card-data', 'generated', `speed-power-totals-${season}.json`);

/** `{ epmOff, epmDef }` by normalized name, from a Speed/Power record. Empty when the file is not there. */
export function readImpactPrior(file = impactPriorFile(2026)) {
  if (!fs.existsSync(file)) return new Map();
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Map(rows.filter(r => Number.isFinite(r.epmOff) && Number.isFinite(r.epmDef)).map(r => [normalizeName(r.name), { epmOff: r.epmOff, epmDef: r.epmDef }]));
}

/** Who the fringe player is: this many minutes in the most recent prior season. */
export const FRINGE_MINUTES = [100, 700];

const at = (map, x) => (Number.isFinite(x) ? map[0] + map[1] * x : null);
const fin = x => Number.isFinite(x);
/** Attempts from a per-100 rate and minutes: about a possession a minute and a bit (100 per 48). */
const attempts = (per100, minutes) => (fin(per100) && fin(minutes) ? (per100 * minutes) / 48 : 0);

/**
 * One season's rows, by Basketball-Reference id, merged across the four
 * tables. `perGame` may carry a traded player's team rows; the merged row's
 * `team` is the last one listed (the club now, the rule card_team_mismatches
 * and traded_season_last_team set), and the 2TM total gives games and minutes.
 */
export function seasonRows({ advanced = [], perPoss = [], shooting = [], perGame = [] }, impact = new Map()) {
  const out = new Map();
  const into = (id, patch) => out.set(id, { ...(out.get(id) ?? { playerId: id }), ...patch });
  for (const r of dedupeByMaxGames(advanced)) {
    // Impact on their actual scale: theirs when `impact` has the player, else the bridge.
    const theirs = impact.get(normalizeName(r.name));
    into(r.playerId, {
      name: r.name, age: r.age ?? null, games: r.games ?? 0, minutes: r.minutes ?? 0,
      usg: fin(r.usgPct) ? r.usgPct / 100 : null, tsPct: r.tsPct ?? null,
      epmOff: theirs?.epmOff ?? at(ACTUAL_BRIDGE.epmOff, r.obpm),
      epmDef: theirs?.epmDef ?? at(ACTUAL_BRIDGE.epmDef, r.dbpm),
    });
  }
  for (const r of dedupeByMaxGames(perPoss)) {
    into(r.playerId, {
      name: out.get(r.playerId)?.name ?? r.name, pos: r.pos ?? null,
      pts100: r.pts100, ast100: r.ast100, orb100: r.orb100, drb100: r.drb100,
      fga100: r.fga100, fg2a100: r.fg2a100, fg3a100: r.fg3a100, fta100: r.fta100,
      fgPct2: r.fgPct2, fgPct3: r.fgPct3, ftPct: r.ftPct, efg: r.efg,
      ...(out.get(r.playerId)?.minutes ? {} : { games: r.games ?? 0, minutes: r.minutes ?? 0 }),
    });
  }
  for (const r of dedupeByMaxGames(shooting)) {
    if (!out.has(r.playerId)) continue;
    const row = out.get(r.playerId);
    const rimShare = r.rimShare;
    const rim100 = fin(row.fga100) && fin(rimShare) ? row.fga100 * rimShare : null;
    const mid100 = fin(rim100) && fin(row.fg3a100) ? Math.max(0, row.fga100 - rim100 - row.fg3a100) : null;
    // Midrange percentage is what 2P% leaves once the rim is taken out.
    const midPct = fin(mid100) && mid100 > 0.5 && fin(row.fgPct2) && fin(r.rimPct)
      ? (row.fgPct2 * row.fg2a100 - r.rimPct * rim100) / mid100
      : null;
    into(r.playerId, { rim100, mid100, rimPct: r.rimPct ?? null, midPct: midPct != null && midPct >= 0 && midPct <= 1 ? midPct : null });
  }
  const games = new Map();
  for (const r of perGame) {
    if (!r?.playerId) continue;
    const g = games.get(r.playerId) ?? { games: 0, mpg: null, pos: null, team: null };
    if ((r.games ?? 0) >= g.games) Object.assign(g, { games: r.games ?? 0, mpg: r.mpg ?? null });
    g.pos ??= r.pos ?? null;
    if (r.team && !/^\dTM$|^TOT$/.test(r.team)) g.team = canonicalTeam(r.team);
    if (!g.name) g.name = r.name;
    games.set(r.playerId, g);
  }
  for (const [id, g] of games) {
    const row = out.get(id);
    if (!row) continue;
    into(id, { team: g.team, pos: row.pos ?? g.pos, mpg: g.mpg ?? (row.games ? row.minutes / row.games : null) });
  }
  return out;
}

/**
 * Every blended field: how to read it from a season row, what its volume is,
 * and which shrink and current weights it takes. Percentages are weighed in
 * attempts; the rest in minutes (mpg in games).
 */
const FIELDS = {
  epmOff: { read: r => r.epmOff, vol: r => r.minutes, shrink: 'minutes', k: 'impact' },
  epmDef: { read: r => r.epmDef, vol: r => r.minutes, shrink: 'minutes', k: 'impactDef' },
  pts100: { read: r => r.pts100, vol: r => r.minutes, shrink: 'minutes', k: 'rate' },
  ast100: { read: r => r.ast100, vol: r => r.minutes, shrink: 'minutes', k: 'rate' },
  orb100: { read: r => r.orb100, vol: r => r.minutes, shrink: 'minutes', k: 'rate' },
  drb100: { read: r => r.drb100, vol: r => r.minutes, shrink: 'minutes', k: 'rate' },
  fg2a100: { read: r => r.fg2a100, vol: r => r.minutes, shrink: 'minutes', k: 'rate' },
  fg3a100: { read: r => r.fg3a100, vol: r => r.minutes, shrink: 'minutes', k: 'rate' },
  fta100: { read: r => r.fta100, vol: r => r.minutes, shrink: 'minutes', k: 'rate' },
  rim100: { read: r => r.rim100, vol: r => r.minutes, shrink: 'minutes', k: 'rate' },
  mid100: { read: r => r.mid100, vol: r => r.minutes, shrink: 'minutes', k: 'rate' },
  usg: { read: r => r.usg, vol: r => r.minutes, shrink: 'minutes', k: 'rate' },
  mpg: { read: r => r.mpg, vol: r => r.games, shrink: 'games', k: 'games' },
  fgPct3: { read: r => r.fgPct3, vol: r => attempts(r.fg3a100, r.minutes), shrink: 'three', k: 'three' },
  ftPct: { read: r => r.ftPct, vol: r => attempts(r.fta100, r.minutes), shrink: 'ft', k: 'ft' },
  fgPct2: { read: r => r.fgPct2, vol: r => attempts(r.fg2a100, r.minutes), shrink: 'two', k: 'two' },
  rimPct: { read: r => r.rimPct, vol: r => attempts(r.rim100, r.minutes), shrink: 'rim', k: 'rim' },
  midPct: { read: r => r.midPct, vol: r => attempts(r.mid100, r.minutes), shrink: 'mid', k: 'mid' },
  tsPct: { read: r => r.tsPct, vol: r => attempts((r.fga100 ?? 0) + 0.44 * (r.fta100 ?? 0), r.minutes), shrink: 'ts', k: 'ts' },
  efg: { read: r => r.efg, vol: r => attempts(r.fga100, r.minutes), shrink: 'efg', k: 'efg' },
};
export const BLENDED_FIELDS = Object.keys(FIELDS);

const weightedMean = (rows, read, vol) => {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const v = read(r);
    const w = vol(r);
    if (fin(v) && fin(w) && w > 0) { num += v * w; den += w; }
  }
  return den > 0 ? num / den : null;
};

/**
 * What the prior is pulled toward. For a percentage, the league's (every
 * attempt counts); for the rest, the FRINGE player's: minutes-weighted over
 * the most recent prior season's 100-to-700-minute players, which is who a
 * rookie or a thin record most resembles.
 */
export function fringeProfile(rows) {
  const all = [...rows.values()];
  const fringe = all.filter(r => r.minutes >= FRINGE_MINUTES[0] && r.minutes <= FRINGE_MINUTES[1]);
  const out = {};
  for (const [f, spec] of Object.entries(FIELDS)) {
    const isPct = !['minutes', 'games'].includes(spec.shrink);
    out[f] = weightedMean(isPct ? all : fringe, spec.read, spec.vol);
  }
  return out;
}

/** One field, blended: the shrunk prior, then this season by its volume. */
export function blendField(field, priorRows, current, fringe) {
  const spec = FIELDS[field];
  const shrinkK = PRIOR_SHRINK[spec.shrink];
  let num = shrinkK * fringe[field];
  let den = shrinkK;
  priorRows.forEach((r, i) => {
    const v = r ? spec.read(r) : null;
    const w = r ? spec.vol(r) * (PRIOR_SEASON_WEIGHTS[i] ?? 0) : 0;
    if (fin(v) && fin(w) && w > 0) { num += v * w; den += w; }
  });
  const prior = num / den;
  const v = current ? spec.read(current) : null;
  const vol = current ? spec.vol(current) : 0;
  if (!fin(v) || !fin(vol) || vol <= 0) return prior;
  const k = CURRENT_K[spec.k];
  return (prior * k + v * vol) / (k + vol);
}

/**
 * THE EXPECTED TABLE, in dunksandthrees' row shape. `current` and `priors`
 * are seasonRows maps (priors most recent first). A row is made for whoever
 * played this season or last; one with neither has no row, and the Live build
 * keeps their card as it last was. `team` is this season's alone: a player yet
 * to play keeps the card's team.
 */
export function expectedTable({ current, priors }) {
  const fringe = fringeProfile(priors[0] ?? new Map());
  const ids = new Set([...current.keys(), ...(priors[0]?.keys() ?? [])]);
  const out = [];
  for (const id of ids) {
    const now = current.get(id) ?? null;
    const past = priors.map(p => p?.get(id) ?? null);
    const named = now ?? past.find(Boolean);
    if (!named?.name) continue;
    const b = Object.fromEntries(BLENDED_FIELDS.map(f => [f, blendField(f, past, now, fringe)]));
    const epmOff = at(EXPECTED_BRIDGE.epmOff, b.epmOff);
    const epmDef = at(EXPECTED_BRIDGE.epmDef, b.epmDef);
    out.push({
      name: named.name,
      bbrefId: id,
      personId: null,
      team: now?.team ?? null,
      position: now?.pos ?? past.find(r => r?.pos)?.pos ?? null,
      age: now?.age ?? (past[0]?.age != null ? past[0].age + 1 : null),
      epm: epmOff + epmDef,
      epmOff,
      epmDef,
      minutesPer48: b.mpg,
      usage: at(BRIDGE.usage, b.usg),
      pts100: b.pts100,
      ast100: b.ast100,
      orb100: b.orb100,
      drb100: b.drb100,
      tsPct: at(BRIDGE.tsPct, b.tsPct),
      efg: b.efg,
      fga2Per100: b.fg2a100,
      fga3Per100: b.fg3a100,
      ftaPer100: b.fta100,
      fgaRimPer100: Math.max(0, at(BRIDGE.fgaRimPer75, b.rim100) / PER75_OF_100),
      fgaMidPer100: Math.max(0, at(BRIDGE.fgaMidPer75, b.mid100) / PER75_OF_100),
      fgPct2: b.fgPct2,
      fgPct3: b.fgPct3,
      fgPctRim: at(BRIDGE.fgPctRim, b.rimPct),
      fgPctMid: at(BRIDGE.fgPctMid, b.midPct),
      ftPct: b.ftPct,
      // How much of each went in, for live-status and a reader of one card.
      basis: { priorSeasons: past.filter(Boolean).length, currentMinutes: now?.minutes ?? 0 },
    });
  }
  return out;
}

/** This season's counts, in the actual page's shape: what liveActualRow reads. */
export const actualTable = current => [...current.values()].map(r => ({
  name: r.name, team: r.team ?? null, games: r.games ?? 0, minutes: r.minutes ?? 0, mpg: r.mpg ?? null, starts: 0, playoffGames: 0,
}));

/** A season table as Basketball-Reference lists it, every team row kept (seasonRows picks the last team). */
export function fetchSeasonRows(season, kind, { force = false } = {}) {
  return cached(
    `bbref-${season}-${kind}-rows`,
    async () => trimSeasonTable(await bbref.fetchSeasonTable(season, kind), kind),
    { force, meta: { source: 'basketball-reference.com', season, kind } }
  );
}

export const SEASON_KINDS = ['advanced', 'perPoss', 'shooting', 'perGame'];

const cachedRows = (season, kind) => readCache(`bbref-${season}-${kind}-rows`);

/**
 * One season's four tables. This season's are read again every night
 * (`force`); a finished season's come from the cache after the first night,
 * with no wait between them. `offline` reads the cache alone.
 */
export async function fetchSeason(season, {
  force = false, offline = false, between = async () => {}, fetchRows = fetchSeasonRows, readCached = cachedRows,
} = {}) {
  const tables = {};
  for (const kind of SEASON_KINDS) {
    const have = force ? null : readCached(season, kind);
    if (have || offline) {
      tables[kind] = have ?? [];
      continue;
    }
    tables[kind] = await fetchRows(season, kind, { force });
    await between();
  }
  return tables;
}
