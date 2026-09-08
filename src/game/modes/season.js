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
// THE PURE HALF LIVES IN seasonCore.js (2026-09-08) — recording, standings,
// advancing, playoffs, earnings — so the server can run a shared league's
// bookkeeping without the simulator. Everything there is re-exported here;
// this file keeps what needs the engine: building the AI league and
// simulating fixtures.
import { roundRobin, fixturesFrom, LENGTHS } from './schedule.js';
import { buildAiLeague } from './aiTeams.js';
import { simulateFixture } from './simulate.js';
import { PHASE, teamsById, rostersOf, decksOf, roundFixtures, isHumanVsHuman, recordResult } from './seasonCore.js';

export * from './seasonCore.js';

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
    // `deck` is the strategy deck this human brings — the shape savedDecks
    // stores, a { cardId: count } map, or null for the engine's default fifty.
    // It rides on the TEAM rather than on the season because two humans in one
    // league bring their own, and because a simulated fixture has to know
    // which side's deck is which.
    ...humans.map(h => ({
      id: h.id, name: h.name, human: true, uid: h.uid ?? null, roster: h.roster,
      abbr: h.abbr ?? null, logo: h.logo ?? null,
      deck: h.deck ?? null, deckName: h.deckName ?? null,
    })),
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
    stats: [],
    round: 1,
    bracket: null,
    champion: null,
    paid: false,
  };
}

/** The deck options a fixture is played with, from whoever is on each side. */
function deckOpts(season, fixture) {
  const decks = decksOf(season);
  return { deckA: decks[fixture.home] ?? null, deckB: decks[fixture.away] ?? null };
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
    s = recordResult(s, simulateFixture(f, rosters, { ...deckOpts(s, f), ...(rng ? { rng } : {}) }));
  }
  return s;
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
    const fixture = { id: m.id, home: m.a, away: m.b };
    const r = simulateFixture(fixture, rosters, { ...deckOpts(s, fixture), ...(rng ? { rng } : {}) });
    s = recordResult(s, r);
  }
  return s;
}
