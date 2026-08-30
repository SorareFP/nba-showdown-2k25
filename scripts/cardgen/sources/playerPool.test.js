import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parsePerGameStatsHtml,
  filterPlayerPool,
  forcedOnly,
  unmatchedForceIncludes,
} from './playerPool.js';

const FIXTURE = readFileSync(new URL('./__fixtures__/sample-per-game-stats.html', import.meta.url), 'utf-8');

describe('parsePerGameStatsHtml', () => {
  it('extracts name/team/pos/games/mpg for real players', () => {
    const players = parsePerGameStatsHtml(FIXTURE);
    expect(players.length).toBeGreaterThan(0);
    const luka = players.find((p) => p.name === 'Luka Dončić');
    expect(luka).toMatchObject({ team: 'LAL', pos: 'PG', games: 64, mpg: 35.8 });
  });

  it('throws when the expected table id is missing, instead of silently returning garbage', () => {
    expect(() => parsePerGameStatsHtml('<html><body>not the right page</body></html>')).toThrow(
      /per_game_stats/
    );
  });

  it('keeps only the max-games row for a player with multiple rows (mid-season trade)', () => {
    const players = parsePerGameStatsHtml(FIXTURE);
    const harden = players.filter((p) => p.name === 'James Harden');
    expect(harden).toHaveLength(1);
    expect(harden[0]).toMatchObject({ team: '2TM', games: 70 });
  });
});

describe('filterPlayerPool', () => {
  it('keeps only players meeting both the minutes and games thresholds', () => {
    const players = [
      { name: 'A', games: 45, mpg: 15 },
      { name: 'B', games: 39, mpg: 20 }, // fails games
      { name: 'C', games: 50, mpg: 8 }, // fails minutes
      { name: 'D', games: 40, mpg: 12 }, // exactly at both bars
    ];
    const result = filterPlayerPool(players, { minMpg: 12, minGames: 40 });
    expect(result.map((p) => p.name)).toEqual(['A', 'D']);
  });
});

describe('the force-include list', () => {
  // Two of these are the real shape of the problem: a star hurt all season
  // (fails games only) and a direct individual pick (fails both).
  const players = [
    { name: 'Regular Starter', games: 70, mpg: 33 },
    { name: 'Hurt Star', games: 16, mpg: 32.6 },
    { name: 'Direct Pick', games: 15, mpg: 22.6 },
    { name: 'Deep Bench', games: 12, mpg: 6 },
  ];
  const rule = { minMpg: 12, minGames: 40 };

  it('forces a named player in, and leaves everyone else to the rule', () => {
    const result = filterPlayerPool(players, { ...rule, forceInclude: ['Hurt Star', 'Direct Pick'] });
    expect(result.map((p) => p.name)).toEqual(['Regular Starter', 'Hurt Star', 'Direct Pick']);
  });

  // The inverse, which is what makes the list the SOURCE of those players rather
  // than decoration on top of something else that also lets them through.
  it('drops a player again when the name is removed from the list', () => {
    const result = filterPlayerPool(players, { ...rule, forceInclude: ['Direct Pick'] });
    expect(result.map((p) => p.name)).toEqual(['Regular Starter', 'Direct Pick']);
    expect(filterPlayerPool(players, { ...rule, forceInclude: [] }).map((p) => p.name)).toEqual([
      'Regular Starter',
    ]);
  });

  it('composes with the rule rather than replacing it — a name can only add', () => {
    const withList = filterPlayerPool(players, { ...rule, forceInclude: ['Hurt Star'] });
    const withoutList = filterPlayerPool(players, rule);
    for (const p of withoutList) expect(withList).toContain(p);
    expect(withList).toHaveLength(withoutList.length + 1);
  });

  it('is a no-op for a name that already passes the rule', () => {
    expect(filterPlayerPool(players, { ...rule, forceInclude: ['Regular Starter'] })).toEqual(
      filterPlayerPool(players, rule)
    );
  });

  // The two sources disagree about generational suffixes constantly, and Jimmy
  // Butler is the live case: Basketball-Reference says "Jimmy Butler",
  // dunksandthrees says "Jimmy Butler III". Whichever spelling the file carries,
  // the other has to match, or the player silently vanishes.
  it('matches across name-spelling differences the sources actually have', () => {
    const rows = [{ name: 'Jimmy Butler', games: 38, mpg: 31.1 }];
    expect(
      filterPlayerPool(rows, { ...rule, forceInclude: ['Jimmy Butler III'] }).map((p) => p.name)
    ).toEqual(['Jimmy Butler']);
  });

  it('reports which pool players are in ONLY because they were named', () => {
    const forced = forcedOnly(players, {
      ...rule,
      forceInclude: ['Regular Starter', 'Hurt Star', 'Direct Pick'],
    });
    expect(forced.map((p) => p.name)).toEqual(['Hurt Star', 'Direct Pick']);
  });

  it('reports a named player who matches no row, instead of dropping him silently', () => {
    expect(unmatchedForceIncludes(players, ['Hurt Star', 'Jayson Taturn'])).toEqual([
      'Jayson Taturn',
    ]);
  });
});
