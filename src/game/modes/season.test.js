// The season state machine. Most of this drives the machine with fed results,
// which is fast and exact; one test plays a real simulated round so the wiring
// to the engine is proved rather than assumed.
import { describe, it, expect } from 'vitest';
import {
  createSeason, PHASE, standings, recordResult, roundFixtures, roundComplete, advance,
  totalRounds, nextFixtureFor, fixtureFor, isHumanVsHuman, simulateRound, simulatePlayoffRound,
  startPlayoffs, earningsFor, summarize, teamsById, rostersOf,
} from './season.js';
import { buildAiLeague } from './aiTeams.js';

const seeded = (s = 4242) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };

/** A season whose humans are built from the AI league, so rosters are real cards. */
function makeSeason({ size = 4, length = 'short', humans = 1 } = {}) {
  const pool = buildAiLeague(humans, { rng: seeded(11) });
  return createSeason({
    id: 'test',
    size,
    length,
    rng: seeded(12),
    humans: pool.map((t, i) => ({ id: `me${i + 1}`, name: `Human ${i + 1}`, roster: t.roster })),
  });
}

/** Feed a fixture a result without touching the engine. */
const feed = (season, fixture, homeScore, awayScore) =>
  recordResult(season, { fixtureId: fixture.id, home: fixture.home, away: fixture.away, homeScore, awayScore });

/** Play out a whole round with fed results; the home team wins by ten. */
function feedRound(season, homeWinsAll = true) {
  let s = season;
  for (const f of roundFixtures(s)) {
    if (f.result) continue;
    s = homeWinsAll ? feed(s, f, 100, 90) : feed(s, f, 90, 100);
  }
  return s;
}

describe('createSeason', () => {
  it('fills the league with AI teams and leaves the human roster alone', () => {
    const s = makeSeason({ size: 8 });
    expect(s.teams).toHaveLength(8);
    expect(s.teams.filter(t => t.human)).toHaveLength(1);
    expect(s.phase).toBe(PHASE.regular);
    expect(s.round).toBe(1);
    // No card is in two rosters.
    const ids = s.teams.flatMap(t => t.roster.map(c => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of s.teams) expect(t.roster.length).toBe(10);
  });

  it('schedules by length: Short is everyone once', () => {
    const short = makeSeason({ size: 4, length: 'short' });
    expect(totalRounds(short)).toBe(3);
    expect(short.fixtures).toHaveLength(6);
    const regular = makeSeason({ size: 4, length: 'regular' });
    expect(totalRounds(regular)).toBe(6);
    expect(regular.fixtures).toHaveLength(12);
  });

  it('refuses a league too small for its humans, or none at all', () => {
    expect(() => createSeason({ humans: [], size: 4 })).toThrow(/at least one human/);
    const pool = buildAiLeague(3, { rng: seeded(1) });
    const humans = pool.map((t, i) => ({ id: `h${i}`, name: `H${i}`, roster: t.roster }));
    expect(() => createSeason({ humans, size: 2, rng: seeded(2) })).toThrow(/do not fit/);
  });

  it('knows which fixtures are human against human', () => {
    const s = makeSeason({ size: 4, humans: 2 });
    expect(s.teams.filter(t => t.human)).toHaveLength(2);
    const derby = s.fixtures.find(f => isHumanVsHuman(s, f));
    expect(derby).toBeTruthy();
    expect(s.fixtures.filter(f => isHumanVsHuman(s, f))).toHaveLength(1); // short: they meet once
  });
});

describe('playing a season', () => {
  it('records results, moves the standings and refuses a replay', () => {
    let s = makeSeason({ size: 4 });
    const f = roundFixtures(s)[0];
    s = feed(s, f, 110, 100);
    expect(s.fixtures.find(x => x.id === f.id).result).toMatchObject({ homeScore: 110, winner: f.home });
    const table = standings(s);
    expect(table.find(t => t.id === f.home)).toMatchObject({ w: 1, l: 0, diff: 10 });
    expect(table.find(t => t.id === f.away)).toMatchObject({ w: 0, l: 1, diff: -10 });
    expect(() => feed(s, f, 1, 2)).toThrow(/already played/);
    expect(() => recordResult(s, { fixtureId: 'nope', homeScore: 1, awayScore: 2 })).toThrow(/no fixture/);
  });

  it('will not advance until the round is done, then opens the next one', () => {
    let s = makeSeason({ size: 4 });
    expect(roundComplete(s)).toBe(false);
    expect(advance(s).round).toBe(1); // refused
    s = feedRound(s);
    expect(roundComplete(s)).toBe(true);
    s = advance(s);
    expect(s.round).toBe(2);
    expect(roundFixtures(s).every(f => !f.result)).toBe(true);
  });

  it('finds my fixture each round and my next one overall', () => {
    let s = makeSeason({ size: 4 });
    const mine = fixtureFor(s, 'me1');
    expect(mine).toBeTruthy();
    expect([mine.home, mine.away]).toContain('me1');
    expect(nextFixtureFor(s, 'me1').id).toBe(mine.id);
    s = feed(s, mine, 100, 90);
    expect(fixtureFor(s, 'me1').result).toBeTruthy();
    expect(nextFixtureFor(s, 'me1').round).toBe(2);
  });

  it('goes to the playoffs when the schedule runs out, seeded by standing', () => {
    let s = makeSeason({ size: 4 });
    for (let r = 0; r < totalRounds(s); r += 1) {
      s = feedRound(s);
      s = advance(s);
    }
    expect(s.phase).toBe(PHASE.playoffs);
    expect(s.bracket.size).toBe(2); // half of four
    const table = standings(s);
    expect(s.playoffSeeds).toEqual([table[0].id, table[1].id]);
  });

  it('crowns a champion and pays the season out', () => {
    let s = makeSeason({ size: 4, length: 'short' });
    for (let r = 0; r < totalRounds(s); r += 1) { s = feedRound(s); s = advance(s); }
    const final = s.bracket.matches[0];
    s = recordResult(s, { fixtureId: final.id, home: final.a, away: final.b, homeScore: 120, awayScore: 100 });
    expect(s.phase).toBe(PHASE.done);
    expect(s.champion).toBe(final.a);
    expect(s.runnerUp).toBe(final.b);
    // Short season: 200 champion, 100 runner-up, 50 for making it.
    expect(earningsFor(s, final.a)).toEqual({ coins: 200, label: 'Season Champion' });
    expect(earningsFor(s, final.b)).toEqual({ coins: 100, label: 'Runner-up' });
    // Halved for a fantasy-draft dynasty.
    expect(earningsFor(s, final.a, 0.5).coins).toBe(100);
    const missed = s.teams.map(t => t.id).find(id => !s.playoffSeeds.includes(id));
    expect(earningsFor(s, missed)).toEqual({ coins: 0, label: null });
  });

  it('summarises for a saved-seasons list', () => {
    let s = makeSeason({ size: 4 });
    s = feedRound(s);
    const sum = summarize(s);
    expect(sum).toMatchObject({ id: 'test', size: 4, length: 'short', phase: PHASE.regular, rounds: 3 });
    expect(sum.record).toMatch(/^\d+-\d+$/);
    expect(sum.rank).toBeGreaterThanOrEqual(1);
  });

  it('exposes teams and rosters in the shapes the simulator and UI want', () => {
    const s = makeSeason({ size: 4 });
    expect(teamsById(s).get('me1').human).toBe(true);
    expect(Object.keys(rostersOf(s))).toHaveLength(4);
    expect(rostersOf(s).me1).toHaveLength(10);
  });
});

describe('simulating the rest of the league', () => {
  it('plays every other fixture in the round for real, holding mine back', () => {
    let s = makeSeason({ size: 4 });
    const mine = fixtureFor(s, 'me1');
    s = simulateRound(s, { skip: [mine.id], rng: seeded(77) });
    const played = roundFixtures(s).filter(f => f.result);
    expect(played).toHaveLength(1); // four teams: two fixtures, one is mine
    expect(played[0].result.simulated).toBe(true);
    expect(played[0].result.homeScore).toBeGreaterThan(0);
    expect(fixtureFor(s, 'me1').result).toBeNull();
    expect(roundComplete(s)).toBe(false);
  });

  it('never simulates a game between two humans', () => {
    let s = makeSeason({ size: 4, humans: 2 });
    const derby = s.fixtures.find(f => isHumanVsHuman(s, f));
    s = { ...s, round: derby.round };
    s = simulateRound(s, { rng: seeded(5) });
    expect(s.fixtures.find(f => f.id === derby.id).result).toBeNull();
  });

  it('simulates a playoff round the same way', () => {
    let s = makeSeason({ size: 4 });
    for (let r = 0; r < totalRounds(s); r += 1) { s = feedRound(s); s = advance(s); }
    expect(s.phase).toBe(PHASE.playoffs);
    s = simulatePlayoffRound(s, { rng: seeded(9) });
    expect(s.phase).toBe(PHASE.done);
    expect(s.champion).toBeTruthy();
    expect(s.results.filter(r => r.playoff)).toHaveLength(1);
  });
});
