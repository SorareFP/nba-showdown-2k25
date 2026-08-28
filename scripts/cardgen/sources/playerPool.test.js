import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePerGameStatsHtml, filterPlayerPool } from './playerPool.js';

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
