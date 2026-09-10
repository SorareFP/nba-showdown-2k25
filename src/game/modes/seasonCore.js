// A SEASON'S PURE HALF — everything that reads or moves a season WITHOUT
// playing a game.
//
// Split out of season.js on 2026-09-08 so the SERVER can record a shared
// league's results and advance its rounds: season.js also creates AI leagues
// (aiTeams → the engine) and simulates fixtures (simulate.js → the whole
// engine), and none of that belongs in a Cloud Function. This file imports
// schedule.js, bracket.js and prizes.js — data and arithmetic — and nothing
// else. season.js re-exports all of it, so every existing caller is unchanged.
import { fixturesFrom, standingsFrom, playoffSeeds, playoffCount } from './schedule.js';
import { makeBracket, reportMatch, champion as bracketChampion, runnerUp as bracketRunnerUp, currentRound, nextMatchFor } from './bracket.js';
import { seasonEarnings } from './prizes.js';

export const PHASE = {
  regular: 'regular',
  playoffs: 'playoffs',
  done: 'done',
};

/** The teams, by id. */
export function teamsById(season) {
  return new Map(season.teams.map(t => [t.id, t]));
}

/** Rosters, by team id — what simulate.js needs. */
export function rostersOf(season) {
  return Object.fromEntries(season.teams.map(t => [t.id, t.roster]));
}

/**
 * Strategy decks by team id. Only the teams that brought one appear; a missing
 * entry is the engine's default fifty, which is what every AI team plays.
 */
export function decksOf(season) {
  return Object.fromEntries(season.teams.filter(t => t.deck).map(t => [t.id, t.deck]));
}

/**
 * Change the deck a team carries. Applies to games not yet played — a season
 * is long enough that a coach should be able to change their mind, and the
 * games already in the book are not re-litigated by it.
 */
export function setDeck(season, teamId, deck, deckName = null) {
  return {
    ...season,
    teams: season.teams.map(t => (t.id === teamId ? { ...t, deck: deck ?? null, deckName: deck ? deckName : null } : t)),
  };
}

/** How many rounds the regular season has. */
export function totalRounds(season) {
  return season.fixtures.reduce((n, f) => Math.max(n, f.round), 0);
}

/** Every fixture in the current round. */
export function roundFixtures(season, round = season.round) {
  return season.fixtures.filter(f => f.round === round);
}

/** Whether a fixture has two human teams — it needs a PvP room, not a simulation. */
export function isHumanVsHuman(season, fixture) {
  const by = teamsById(season);
  return Boolean(by.get(fixture.home)?.human && by.get(fixture.away)?.human);
}

/** The fixture a given team plays in this round, or null on a bye. */
export function fixtureFor(season, teamId, round = season.round) {
  return roundFixtures(season, round).find(f => f.home === teamId || f.away === teamId) ?? null;
}

/** The next fixture this team still has to play, anywhere in the season. */
export function nextFixtureFor(season, teamId) {
  if (season.phase === PHASE.playoffs) {
    const m = season.bracket ? nextMatchFor(season.bracket, teamId) : null;
    return m ? { id: m.id, round: m.round, home: m.a, away: m.b, playoff: true, result: null } : null;
  }
  return season.fixtures.find(f => !f.result && (f.home === teamId || f.away === teamId)) ?? null;
}

/** Standings from everything played so far. */
export function standings(season) {
  return standingsFrom(season.teams.map(t => t.id), season.results.filter(r => !r.playoff));
}

/**
 * Record one fixture's result. `result` is
 * `{ fixtureId, home, away, homeScore, awayScore }` — the shape simulate.js
 * returns and the Play tab can build from a finished game.
 */
export function recordResult(season, rawResult) {
  // THE BOX LINES ARE FOLDED, NOT KEPT. A result may carry each side's box
  // score (`homeBox`/`awayBox`, the shape boxScoreFor makes); they go into
  // the season's running per-player totals and are dropped from the stored
  // result, so a long season's document stays the size of its teams rather
  // than of every game ever played in it.
  const { homeBox, awayBox, ...result } = rawResult;
  const s = { ...season, fixtures: season.fixtures.map(f => ({ ...f })), results: [...season.results] };
  s.stats = foldBoxes(s.stats, [[result.home, homeBox], [result.away, awayBox]]);
  if (s.phase === PHASE.playoffs) {
    const winner = result.homeScore > result.awayScore ? result.home : result.away;
    s.bracket = reportMatch(s.bracket, result.fixtureId, winner, { ...result });
    s.results.push({ ...result, playoff: true, winner });
    const champ = bracketChampion(s.bracket);
    if (champ) {
      s.champion = champ;
      s.runnerUp = bracketRunnerUp(s.bracket);
      s.phase = PHASE.done;
    } else {
      s.round = currentRound(s.bracket);
    }
    return s;
  }
  const fixture = s.fixtures.find(f => f.id === result.fixtureId);
  if (!fixture) throw new Error(`season: no fixture ${result.fixtureId}`);
  if (fixture.result) throw new Error(`season: ${result.fixtureId} is already played`);
  const winner = result.homeScore > result.awayScore ? fixture.home : fixture.away;
  fixture.result = { homeScore: result.homeScore, awayScore: result.awayScore, winner, simulated: Boolean(result.simulated), forfeit: Boolean(result.forfeit) };
  s.results.push({ ...result, home: fixture.home, away: fixture.away, winner });
  return s;
}

// ── Player stats across the season ──────────────────────────────────────────
//
// `season.stats` is a flat ARRAY of rows { team, key, g, pts, reb, ast, min,
// tpm, tpa } — an array rather than a map keyed by team and card so a stored
// season never has a field name Firestore might object to, and so a season
// saved before stats existed (no `stats` at all) reads as empty rather than
// breaking. The user, 2026-09-08: "Player stats accumulated in a season
// should show within the season."
export const STAT_FIELDS = ['pts', 'reb', 'ast', 'min', 'tpm', 'tpa', 'alw', 'gs', 'fta', 'ftm', 'pnta', 'pntm', 'dca', 'dcm', 'blk', 'onf', 'ona'];

// MATCHUP +/- (2026-09-10) is a player's points minus `alw`, the points the
// man he guarded scored on him (creditAllowed, engine.js). A season that
// began before the stat existed has games whose lines carry no `alw`, and
// subtracting nothing from those games' points would read as a big plus. So
// each row also keeps `mg` — games whose line carried `alw` — and `mpts` and
// `mmin`, the points and minutes from those games only; the stat is
// `mpts - alw` over `mg` games, and points allowed per minute `alw / mmin`.
// The finer fields (gs, ftm/fta, pntm/pnta, dcm/dca, blk, onf/ona) arrived
// in the same release, so `mg` counts their games too.

function foldBoxes(stats, sides) {
  let out = Array.isArray(stats) ? stats.map(r => ({ ...r })) : [];
  for (const [team, box] of sides) {
    if (!team || !Array.isArray(box)) continue;
    for (const line of box) {
      if (!line?.key) continue;
      let row = out.find(r => r.team === team && r.key === line.key);
      if (!row) {
        row = { team, key: line.key, g: 0, mg: 0, mpts: 0, mmin: 0 };
        for (const f of STAT_FIELDS) row[f] = 0;
        out.push(row);
      }
      row.g += 1;
      // `|| 0` on the row as well: a row saved before a field existed has none.
      for (const f of STAT_FIELDS) row[f] = (Number(row[f]) || 0) + (Number(line[f]) || 0);
      if (line.alw !== undefined && line.alw !== null && Number.isFinite(Number(line.alw))) {
        row.mg = (Number(row.mg) || 0) + 1;
        row.mpts = (Number(row.mpts) || 0) + (Number(line.pts) || 0);
        row.mmin = (Number(row.mmin) || 0) + (Number(line.min) || 0);
      }
    }
  }
  return out;
}

/** Per-game rates and the matchup +/- (null where no game carried the data). */
function withRates(r) {
  return {
    ...r,
    ppg: r.g ? r.pts / r.g : 0,
    rpg: r.g ? r.reb / r.g : 0,
    apg: r.g ? r.ast / r.g : 0,
    mpm: r.mg ? (Number(r.mpts) || 0) - (Number(r.alw) || 0) : null,
    alwpm: r.mmin > 0 ? (Number(r.alw) || 0) / r.mmin : null,
    onpm: r.mg ? (Number(r.onf) || 0) - (Number(r.ona) || 0) : null,
  };
}

/** One team's players this season, totals and per-game, most points first. */
export function teamSeasonStats(season, teamId) {
  return (season?.stats ?? [])
    .filter(r => r.team === teamId)
    .map(withRates)
    .sort((a, b) => b.pts - a.pts || b.ppg - a.ppg || a.key.localeCompare(b.key));
}

/**
 * The league's leaders by a per-game average (`ppg`, `rpg`, `apg`), the
 * matchup +/- (`mpm`, only players with matchup data), or a total.
 */
export function seasonLeaders(season, { by = 'ppg', limit = 8, minGames = 1 } = {}) {
  const rows = (season?.stats ?? [])
    .filter(r => r.g >= minGames && (by !== 'mpm' || r.mg > 0))
    .map(withRates);
  const total = { ppg: 'pts', rpg: 'reb', apg: 'ast', mpm: 'mpts' }[by] ?? by;
  return rows
    .sort((a, b) => (b[by] ?? 0) - (a[by] ?? 0) || (b[total] ?? 0) - (a[total] ?? 0) || a.key.localeCompare(b.key))
    .slice(0, limit);
}

/** Whether every fixture in the current round has a result. */
export function roundComplete(season) {
  return roundFixtures(season).every(f => f.result);
}

/**
 * Move to the next round, or into the playoffs when the schedule is done.
 * Refuses while the round still has a game in it.
 */
export function advance(season) {
  if (season.phase !== PHASE.regular) return season;
  if (!roundComplete(season)) return season;
  if (season.round < totalRounds(season)) return { ...season, round: season.round + 1 };
  return startPlayoffs(season);
}

/** Seed the bracket from the final standings. */
export function startPlayoffs(season) {
  const table = standings(season);
  const seeds = playoffSeeds(table, playoffCount(season.size));
  const bracket = makeBracket(seeds);
  // THE REGULAR SEASON, KEPT. Playoff games fold into `stats` as well, and an
  // end-of-season award is a regular-season honour (awards.js reads this).
  const regStats = (season.stats ?? []).map(r => ({ ...r }));
  return { ...season, phase: PHASE.playoffs, bracket, round: 1, playoffSeeds: seeds, regStats };
}

/** What a team's season was worth in coins, once it is over. */
export function earningsFor(season, teamId, factor = 1) {
  if (season.phase !== PHASE.done) return { coins: 0, label: null };
  const madePlayoffs = (season.playoffSeeds ?? []).includes(teamId);
  return seasonEarnings(season.length, {
    champion: season.champion === teamId,
    runnerUp: season.runnerUp === teamId,
    madePlayoffs,
  }, factor);
}

/**
 * The result of a fixture you PLAYED, from the game you coached.
 *
 * You always coach team A — the rewards path, the box score the lifetime
 * tracker keeps, and the AI driver all assume it — so which of the two scores
 * is the home score depends on which side of the fixture you were drawn on,
 * and nothing else does. Getting this backwards silently inverts a season's
 * standings, which is why it is one named function rather than a ternary in a
 * component.
 */
export function resultFromPlayed({ fixtureId, home, away, humanIsHome }, scoreA, scoreB, boxA = null, boxB = null) {
  return {
    fixtureId,
    home,
    away,
    homeScore: humanIsHome ? scoreA : scoreB,
    awayScore: humanIsHome ? scoreB : scoreA,
    // The box lines ride the same mapping, for the season's player totals.
    homeBox: humanIsHome ? boxA : boxB,
    awayBox: humanIsHome ? boxB : boxA,
  };
}

/** A one-line summary for a list of saved seasons. */
export function summarize(season) {
  const table = standings(season);
  const me = season.teams.find(t => t.human);
  const row = table.find(t => t.id === me?.id);
  return {
    id: season.id,
    length: season.length,
    size: season.size,
    phase: season.phase,
    round: season.round,
    rounds: totalRounds(season),
    record: row ? `${row.w}-${row.l}` : '0-0',
    rank: row?.rank ?? null,
    champion: season.champion,
    isChampion: season.champion === me?.id,
  };
}

// fixturesFrom is re-exported for callers that build a schedule by hand.
export { fixturesFrom };
