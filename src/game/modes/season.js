// A SEASON — the state machine behind Season mode, and the spine of a dynasty.
//
// The user (2026-09-07): "play a certain amount of AI teams in the season. You
// can add other human users before you start the season with variable season
// lengths, which affects the amount of coins that you get for winning [and]
// winning the championship."
//
// ── THE SHAPE ───────────────────────────────────────────────────────────────
//
// A season is DATA, not a process: teams, fixtures, results, a bracket. Every
// function here takes a season and returns a new one, so the UI can store it
// in Firestore or localStorage and reload it mid-round without anything
// living in memory. Nothing here plays a game — the caller does that (your
// own fixture through the Play tab, everyone else's through simulate.js) and
// hands the result back to `recordResult`.
//
// ── ROUNDS, NOT A FLAT LIST ─────────────────────────────────────────────────
//
// Fixtures come in rounds and a round resolves together: you play yours, the
// rest simulate, the standings move, the next round opens. That is what makes
// a season feel like a schedule rather than a queue, and it is also what lets
// a human-vs-human fixture hold a round open until both players have shown up.
import { roundRobin, fixturesFrom, standingsFrom, playoffSeeds, playoffCount, LENGTHS } from './schedule.js';
import { makeBracket, reportMatch, champion as bracketChampion, runnerUp as bracketRunnerUp, currentRound, nextMatchFor } from './bracket.js';
import { buildAiLeague } from './aiTeams.js';
import { simulateFixture } from './simulate.js';
import { seasonEarnings } from './prizes.js';

export const PHASE = {
  regular: 'regular',
  playoffs: 'playoffs',
  done: 'done',
};

/**
 * Create a season.
 *
 * `humans` are `[{ id, name, roster }]` — you first. AI teams fill the league
 * to `size`, avoiding every card a human brought (so a season never plays a
 * card against itself) and skipping the franchises the humans' cards mostly
 * come from is deliberately NOT done: a Lakers-heavy user roster can still
 * meet the Lakers, which reads fine because the AI team is built from what is
 * left.
 */
export function createSeason({
  id = `season-${Date.now()}`,
  humans = [],
  size = 8,
  length = 'regular',
  rng = Math.random,
  cards = undefined,
} = {}) {
  if (!humans.length) throw new Error('season: needs at least one human team');
  if (size < humans.length) throw new Error(`season: ${humans.length} humans do not fit in a ${size}-team league`);
  const taken = new Set(humans.flatMap(h => h.roster.map(c => c.id)));
  const ai = buildAiLeague(size - humans.length, { taken, rng, ...(cards ? { cards } : {}) });
  const teams = [
    ...humans.map(h => ({ id: h.id, name: h.name, human: true, uid: h.uid ?? null, roster: h.roster, abbr: h.abbr ?? null, logo: h.logo ?? null })),
    ...ai,
  ];
  const meetings = LENGTHS[length]?.meetings ?? LENGTHS.regular.meetings;
  const fixtures = fixturesFrom(roundRobin(teams.map(t => t.id), meetings));
  return {
    id,
    createdAt: Date.now(),
    length,
    size,
    phase: PHASE.regular,
    teams,
    fixtures,
    results: [],
    round: 1,
    bracket: null,
    champion: null,
    paid: false,
  };
}

/** The teams, by id. */
export function teamsById(season) {
  return new Map(season.teams.map(t => [t.id, t]));
}

/** Rosters, by team id — what simulate.js needs. */
export function rostersOf(season) {
  return Object.fromEntries(season.teams.map(t => [t.id, t.roster]));
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
  fixture.result = { homeScore: result.homeScore, awayScore: result.awayScore, winner, simulated: Boolean(result.simulated) };
  s.results.push({ ...result, home: fixture.home, away: fixture.away, winner });
  return s;
}

/**
 * Simulate every unplayed fixture in the current round EXCEPT the ones the
 * caller names (yours, and any human-vs-human game waiting on a room).
 */
export function simulateRound(season, { skip = [], rng = undefined } = {}) {
  const hold = new Set(skip);
  const rosters = rostersOf(season);
  let s = season;
  for (const f of roundFixtures(s)) {
    if (f.result || hold.has(f.id)) continue;
    if (isHumanVsHuman(s, f)) continue; // two humans: their game, not the simulator's
    s = recordResult(s, simulateFixture(f, rosters, rng ? { rng } : {}));
  }
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

/** Simulate every ready playoff match except the ones held back. */
export function simulatePlayoffRound(season, { skip = [], rng = undefined } = {}) {
  if (season.phase !== PHASE.playoffs || !season.bracket) return season;
  const hold = new Set(skip);
  const rosters = rostersOf(season);
  let s = season;
  for (const m of s.bracket.matches.filter(x => x.a && x.b && !x.winner && x.round === s.round)) {
    if (hold.has(m.id)) continue;
    const by = teamsById(s);
    if (by.get(m.a)?.human && by.get(m.b)?.human) continue;
    const r = simulateFixture({ id: m.id, home: m.a, away: m.b }, rosters, rng ? { rng } : {});
    s = recordResult(s, r);
  }
  return s;
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
