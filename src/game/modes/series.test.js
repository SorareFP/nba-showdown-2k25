// PLAYOFF SERIES AND THE CIV LENGTHS (2026-09-11): a best-of-N match played
// game by game, and a season that plays one to a champion.
import { describe, it, expect } from 'vitest';
import {
  makeBracket, withSeries, nextSeriesGame, recordGame, winsNeeded, matchIdOf, playoffRoundName,
} from './bracket.js';
import {
  createSeason, recordResult, roundFixtures, advance, totalRounds, PHASE,
  playoffGames, isRecorded, nextFixtureFor, simulatePlayoffRound,
} from './season.js';
import { LENGTHS, PICKABLE_LENGTHS, LENGTH_IDS } from './schedule.js';
import { CARDS } from '../cards.js';

const seeded = (s = 11) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const play = (bracket, g, winner) => recordGame(bracket, g.id, {
  home: g.home, away: g.away, homeScore: g.home === winner ? 100 : 90, awayScore: g.home === winner ? 90 : 100,
});

describe('a best-of-N match', () => {
  it('needs a majority of the games', () => {
    expect([1, 3, 5, 7].map(winsNeeded)).toEqual([1, 2, 3, 4]);
  });

  it('names each game, and goes 2-2-1-1-1 on home court with the higher seed first', () => {
    let b = withSeries(makeBracket(['A', 'B']), [7]);
    expect(b.matches[0].bestOf).toBe(7);
    const homes = [];
    const ids = [];
    for (let i = 0; i < 7 && !b.matches[0].winner; i += 1) {
      const g = nextSeriesGame(b.matches[0]);
      homes.push(g.home);
      ids.push(g.id);
      b = play(b, g, i % 2 === 0 ? 'A' : 'B');
    }
    expect(homes).toEqual(['A', 'A', 'B', 'B', 'A', 'B', 'A']);
    expect(ids).toEqual(['r1m1.g1', 'r1m1.g2', 'r1m1.g3', 'r1m1.g4', 'r1m1.g5', 'r1m1.g6', 'r1m1.g7']);
    expect(b.matches[0].winner).toBe('A');
    expect(b.matches[0].result).toMatchObject({ series: true, homeScore: 4, awayScore: 3 });
    expect(matchIdOf('r1m1.g6')).toBe('r1m1');
  });

  it('ends as soon as a side has its wins', () => {
    let b = withSeries(makeBracket(['A', 'B']), [5]);
    for (let i = 0; i < 3; i += 1) b = play(b, nextSeriesGame(b.matches[0]), 'B');
    expect(b.matches[0].winner).toBe('B');
    expect(b.matches[0].games).toHaveLength(3);
    expect(nextSeriesGame(b.matches[0])).toBeNull();
  });

  it('is one game under the match id at best-of-1, as every bracket before this', () => {
    const b = makeBracket(['A', 'B']);
    const g = nextSeriesGame(b.matches[0]);
    expect(g.id).toBe('r1m1');
    const after = play(b, g, 'A');
    expect(after.matches[0].winner).toBe('A');
    expect(after.matches[0].result).toMatchObject({ homeScore: 100, awayScore: 90 });
  });

  it('refuses a game out of order, and any game once the series is over', () => {
    let b = withSeries(makeBracket(['A', 'B']), [3]);
    expect(() => recordGame(b, 'r1m1.g2', { home: 'A', away: 'B', homeScore: 1, awayScore: 0 })).toThrow(/not the next game/);
    b = play(b, nextSeriesGame(b.matches[0]), 'A');
    b = play(b, nextSeriesGame(b.matches[0]), 'A');
    expect(() => recordGame(b, 'r1m1.g3', { home: 'A', away: 'B', homeScore: 1, awayScore: 0 })).toThrow(/already decided/);
  });

  it('names the rounds from the end', () => {
    expect([1, 2, 3].map(r => playoffRoundName(r, 3))).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
  });
});

describe('a season with series', () => {
  function toPlayoffs(series) {
    let s = createSeason({
      id: 'S', humans: [{ id: 'you', name: 'Me', roster: CARDS.slice(0, 10) }],
      size: 8, length: 'online', series, rng: seeded(),
    });
    for (let r = 0; r < totalRounds(s); r += 1) {
      for (const f of roundFixtures(s)) {
        if (!f.result) s = recordResult(s, { fixtureId: f.id, home: f.home, away: f.away, homeScore: 100, awayScore: 90 });
      }
      s = advance(s);
    }
    expect(s.phase).toBe(PHASE.playoffs);
    return s;
  }

  it('seeds the series lengths by round and plays the playoffs game by game to a champion', () => {
    let s = toPlayoffs([3, 5]);
    expect(s.series).toEqual([3, 5]);
    expect(s.bracket.matches.filter(m => m.round === 1).every(m => m.bestOf === 3)).toBe(true);
    expect(s.bracket.matches.find(m => m.round === 2).bestOf).toBe(5);
    let games = 0;
    for (let guard = 0; guard < 40 && s.phase !== PHASE.done; guard += 1) {
      const g = playoffGames(s).find(x => !x.result && x.home && x.away);
      expect(isRecorded(s, g.id)).toBe(false);
      const next = nextFixtureFor(s, g.home);
      expect(next.id).toBe(g.id);
      s = recordResult(s, { fixtureId: g.id, home: g.home, away: g.away, homeScore: 100, awayScore: 90 });
      expect(isRecorded(s, g.id)).toBe(true);
      games += 1;
    }
    expect(s.phase).toBe(PHASE.done);
    expect(s.champion).toBeTruthy();
    // Home court wins every game: two 2-1 semifinals, then a 3-2 final.
    expect(games).toBe(3 + 3 + 5);
    expect(s.results.filter(r => r.playoff)).toHaveLength(11);
  });

  it('keeps one game a round when no series was picked', () => {
    const s = toPlayoffs(null);
    expect(s.series).toBeNull();
    expect(playoffGames(s).map(g => g.id)).toEqual(s.bracket.matches.filter(m => m.round === 1).map(m => m.id));
  });

  it('sims the rest of a playoff round, leaving the series it is told to', () => {
    const s = toPlayoffs([3, 3]);
    const [held, other] = playoffGames(s);
    const after = simulatePlayoffRound(s, { skip: [held.id], rng: seeded(5) });
    const byMatch = new Map(after.bracket.matches.map(m => [m.id, m]));
    expect(byMatch.get(held.matchId).winner).toBeNull();
    expect(byMatch.get(other.matchId).winner).toBeTruthy();
    expect(after.round).toBe(1);
  });
});

describe('the Civ lengths', () => {
  it('offers the five Civ names, shortest first, and still reads the old ids', () => {
    expect(LENGTH_IDS).toEqual(['online', 'quick', 'standard', 'epic', 'marathon']);
    expect(PICKABLE_LENGTHS.map(l => l.meetings)).toEqual([1, 2, 3, 4, 6]);
    expect(LENGTHS.regular.meetings).toBe(LENGTHS.quick.meetings);
    expect(LENGTHS.regular.label).toBe('Quick');
  });
});
