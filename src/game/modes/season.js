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
import { fitDeck } from '../deckFit.js';
import { capOf } from '../coinRewards.js';
import { buildAiLeague } from './aiTeams.js';
import { simulateFixture } from './simulate.js';
import { PHASE, teamsById, rostersOf, decksOf, roundFixtures, isHumanVsHuman, recordResult, buildSeason } from './seasonCore.js';
import { nextSeriesGame, matchIdOf } from './bracket.js';

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
  // Best-of per playoff round, first round first (bracket.js); null plays one game a round.
  series = null,
  // THE RUNG THE LEAGUE IS BUILT AT (2026-09-16). Above Prince the AI teams
  // draw to a richer cap (coinRewards.js capOf) — better players, the same
  // rules — and the season remembers the rung so a game in it pays at the
  // lower of this and the rung it was played at (payFloorOf). null is Prince.
  aiLevel = null,
} = {}) {
  if (!humans.length) throw new Error('season: needs at least one human team');
  if (size < humans.length) throw new Error(`season: ${humans.length} humans do not fit in a ${size}-team league`);
  const taken = new Set(humans.flatMap(h => h.roster.map(c => c.id)));
  const ai = buildAiLeague(size - humans.length, { taken, rng, capMult: capOf(aiLevel), ...(cards ? { cards } : {}) });
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
    // DECK-MATCHED OPPONENTS (the user, 2026-09-16). An AI team's fifty is
    // fitted to the ten it fields (deckFit.js) — or stays the default fifty
    // when no archetype is near enough, which the measurement said is most of
    // them. Humans bring their own.
    ...ai.map(t => ({ ...t, deck: t.deck ?? fitDeck(t.roster), deckName: t.deckName ?? null })),
  ];
  return { ...buildSeason({ id, teams, length, size, series }), aiLevel };
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
  // `skip` may name a series game (`r1m1.g2`); it holds the whole series.
  const hold = new Set(skip.map(matchIdOf));
  const rosters = rostersOf(season);
  const round = season.round;
  let s = season;
  // Game by game until every series in the round that is not held — and not
  // two humans' — is decided. The round moves on by itself when its last one is.
  for (let guard = 0; guard < 400; guard += 1) {
    if (s.phase !== PHASE.playoffs || s.round !== round) break;
    const by = teamsById(s);
    const m = s.bracket.matches.find(x => x.round === round && x.a && x.b && !x.winner
      && !hold.has(x.id) && !(by.get(x.a)?.human && by.get(x.b)?.human));
    if (!m) break;
    const g = nextSeriesGame(m);
    const fixture = { id: g.id, home: g.home, away: g.away };
    const r = simulateFixture(fixture, rosters, { ...deckOpts(s, fixture), ...(rng ? { rng } : {}) });
    s = recordResult(s, r);
  }
  return s;
}
