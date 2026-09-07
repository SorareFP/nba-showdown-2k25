// The competition core: schedules, standings, brackets, prizes.
import { describe, it, expect } from 'vitest';
import {
  LENGTHS, roundRobin, fixturesFrom, standingsFrom, playoffCount, playoffSeeds, gamesPerTeam,
} from './schedule.js';
import {
  seedOrder, makeBracket, reportMatch, readyMatches, currentRound, champion, runnerUp, nextMatchFor, winsFor, eliminated,
} from './bracket.js';
import {
  prizePool, tournamentPayouts, tournamentEarnings, seasonEarnings, dynastyCoinFactor, SEASON_REWARDS,
} from './prizes.js';

const ids = n => Array.from({ length: n }, (_, i) => `t${i + 1}`);

describe('roundRobin', () => {
  it('meets every pair exactly once per meeting, every team once per round', () => {
    for (const n of [4, 6, 8, 10, 12]) {
      const rounds = roundRobin(ids(n), 1);
      expect(rounds).toHaveLength(n - 1);
      const seen = new Map();
      for (const round of rounds) {
        const inRound = new Set();
        expect(round).toHaveLength(n / 2);
        for (const { home, away } of round) {
          expect(inRound.has(home)).toBe(false);
          expect(inRound.has(away)).toBe(false);
          inRound.add(home); inRound.add(away);
          const key = [home, away].sort().join('-');
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }
      expect(seen.size).toBe((n * (n - 1)) / 2);
      for (const v of seen.values()) expect(v).toBe(1);
    }
  });

  it('gives an odd league a bye each round and still meets every pair once', () => {
    const rounds = roundRobin(ids(5), 1);
    expect(rounds).toHaveLength(5);
    for (const round of rounds) expect(round).toHaveLength(2);
    const pairs = new Set(rounds.flat().map(f => [f.home, f.away].sort().join('-')));
    expect(pairs.size).toBe(10);
  });

  it('a Regular season is one home and one away against everyone', () => {
    const rounds = roundRobin(ids(8), LENGTHS.regular.meetings);
    expect(rounds).toHaveLength(14);
    const fixtures = fixturesFrom(rounds);
    expect(fixtures).toHaveLength(56);
    for (const t of ids(8)) {
      const home = fixtures.filter(f => f.home === t).length;
      const away = fixtures.filter(f => f.away === t).length;
      expect(home).toBe(7);
      expect(away).toBe(7);
      for (const u of ids(8)) {
        if (u === t) continue;
        expect(fixtures.filter(f => f.home === t && f.away === u)).toHaveLength(1);
      }
    }
    expect(gamesPerTeam(8, 'regular')).toBe(14);
    expect(gamesPerTeam(8, 'long')).toBe(21);
  });

  it('numbers fixtures by round', () => {
    const fx = fixturesFrom(roundRobin(ids(4)));
    expect(fx.map(f => f.id)).toEqual(['r1g1', 'r1g2', 'r2g1', 'r2g2', 'r3g1', 'r3g2']);
    expect(fx.every(f => f.result === null)).toBe(true);
  });
});

describe('standingsFrom', () => {
  const res = (home, away, hs, as) => ({ home, away, homeScore: hs, awayScore: as });

  it('ranks by wins, then head-to-head, then differential, then points for', () => {
    const teams = ['a', 'b', 'c', 'd'];
    const results = [
      res('a', 'b', 80, 70), // a beats b
      res('c', 'd', 90, 60), // c beats d
      res('b', 'c', 75, 74), // b beats c
      res('a', 'd', 60, 90), // d beats a
      res('c', 'a', 100, 50), // c beats a
      res('b', 'd', 70, 65), // b beats d
    ];
    // a 1-2, b 2-1, c 2-1, d 1-2. b beat c head to head → b first.
    // a vs d: d beat a → d third, a fourth.
    const s = standingsFrom(teams, results);
    expect(s.map(t => t.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(s[0]).toMatchObject({ w: 2, l: 1, rank: 1, gp: 3 });
    expect(s.find(t => t.id === 'c').diff).toBe(30 - 1 + 50);
  });

  it('handles no results and unknown ids', () => {
    const s = standingsFrom(['x', 'y'], [null, res('q', 'x', 1, 2)]);
    expect(s.map(t => t.w)).toEqual([0, 0]);
  });

  it('sends half the league to the playoffs, rounded down to a power of two', () => {
    expect(playoffCount(4)).toBe(2);
    expect(playoffCount(6)).toBe(2);
    expect(playoffCount(8)).toBe(4);
    expect(playoffCount(10)).toBe(4);
    expect(playoffCount(12)).toBe(4);
    const s = standingsFrom(['a', 'b', 'c', 'd'], [res('a', 'b', 9, 1), res('c', 'd', 9, 1)]);
    expect(playoffSeeds(s)).toEqual(['a', 'c']);
  });
});

describe('bracket', () => {
  it('seeds so the top two can only meet in the final', () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const b = makeBracket(ids(8));
    expect(b.matches.filter(m => m.round === 1).map(m => [m.a, m.b])).toEqual([
      ['t1', 't8'], ['t4', 't5'], ['t2', 't7'], ['t3', 't6'],
    ]);
    expect(b.matches).toHaveLength(7);
    expect(b.rounds).toBe(3);
  });

  it('advances winners to the right side of the next match and crowns a champion', () => {
    let b = makeBracket(ids(4));
    expect(readyMatches(b).map(m => m.id)).toEqual(['r1m1', 'r1m2']);
    expect(currentRound(b)).toBe(1);
    b = reportMatch(b, 'r1m1', 't4', { scoreA: 60, scoreB: 70 });
    b = reportMatch(b, 'r1m2', 't2');
    const final = b.matches.find(m => m.round === 2);
    expect([final.a, final.b]).toEqual(['t4', 't2']);
    expect(final.seedA).toBe(4);
    expect(currentRound(b)).toBe(2);
    expect(nextMatchFor(b, 't2').id).toBe('r2m1');
    expect(nextMatchFor(b, 't1')).toBeNull();
    expect(eliminated(b, 't1')).toBe(true);
    expect(champion(b)).toBeNull();
    b = reportMatch(b, 'r2m1', 't2');
    expect(champion(b)).toBe('t2');
    expect(runnerUp(b)).toBe('t4');
    expect(winsFor(b, 't2')).toBe(2);
    expect(currentRound(b)).toBeNull();
  });

  it('refuses bad reports and bad sizes', () => {
    const b = makeBracket(ids(4));
    expect(() => reportMatch(b, 'r2m1', 't1')).toThrow(/not ready/);
    expect(() => reportMatch(b, 'r1m1', 't2')).toThrow(/not in/);
    expect(() => makeBracket(ids(6))).toThrow(/size 6/);
    // A pair is a straight final — a four-team season's playoff.
    expect(makeBracket(ids(2)).matches).toHaveLength(1);
    const once = reportMatch(b, 'r1m1', 't1');
    expect(() => reportMatch(once, 'r1m1', 't1')).toThrow(/already/);
  });

  it('shuffles when asked, deterministically under a seeded rng', () => {
    let s = 7;
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
    const b = makeBracket(ids(8), { random: true, rng });
    expect([...b.seeds].sort()).toEqual(ids(8));
    expect(b.seeds).not.toEqual(ids(8));
  });
});

describe('prizes', () => {
  it('pays the whole pool: half to the champion, the rest per match win', () => {
    expect(prizePool(100, 8)).toBe(800);
    const p = tournamentPayouts(8, 100);
    expect(p).toEqual({ pool: 800, perWin: 57, champion: 401, matches: 7 });
    expect(p.perWin * p.matches + p.champion).toBe(800);
    // The champion won three matches on the way.
    expect(tournamentEarnings(8, 100, { wins: 3, champion: true })).toBe(3 * 57 + 401);
    expect(tournamentEarnings(8, 100, { wins: 1 })).toBe(57);
    expect(tournamentPayouts(16, 250)).toMatchObject({ pool: 4000, perWin: 133 });
  });

  it('a free bracket pays nothing', () => {
    expect(tournamentPayouts(4, 0)).toEqual({ pool: 0, perWin: 0, champion: 0, matches: 3 });
  });

  it('season money scales with length and takes the dynasty factor', () => {
    expect(seasonEarnings('short', { champion: true })).toEqual({ coins: 200, label: 'Season Champion' });
    expect(seasonEarnings('long', { runnerUp: true })).toEqual({ coins: 350, label: 'Runner-up' });
    expect(seasonEarnings('regular', { madePlayoffs: true })).toEqual({ coins: 100, label: 'Made the Playoffs' });
    expect(seasonEarnings('regular', {})).toEqual({ coins: 0, label: null });
    expect(seasonEarnings('regular', { champion: true }, dynastyCoinFactor('fantasy'))).toEqual({ coins: 200, label: 'Season Champion' });
    expect(dynastyCoinFactor('own')).toBe(1);
    expect(SEASON_REWARDS.long.champion).toBeGreaterThan(SEASON_REWARDS.regular.champion);
  });
});
