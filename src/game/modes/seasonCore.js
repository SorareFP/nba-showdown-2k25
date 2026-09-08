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
export function recordResult(season, result) {
  const s = { ...season, fixtures: season.fixtures.map(f => ({ ...f })), results: [...season.results] };
  if (s.phase === PHASE.playoffs) {
    const winner = result.homeScore > result.awayScore ? result.home : result.away;
    s.bracket = reportMatch(s.bracket, result.fixtureId, winner, result);
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
  return { ...season, phase: PHASE.playoffs, bracket, round: 1, playoffSeeds: seeds };
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
export function resultFromPlayed({ fixtureId, home, away, humanIsHome }, scoreA, scoreB) {
  return {
    fixtureId,
    home,
    away,
    homeScore: humanIsHome ? scoreA : scoreB,
    awayScore: humanIsHome ? scoreB : scoreA,
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
