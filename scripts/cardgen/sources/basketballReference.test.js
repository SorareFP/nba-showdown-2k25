import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGameLogHtml } from './basketballReference.js';

describe('parseGameLogHtml', () => {
  const html = readFileSync(new URL('./__fixtures__/sample-gamelog.html', import.meta.url), 'utf-8');

  it('extracts minutes/pts/reb/ast rows, skipping games not played', () => {
    const games = parseGameLogHtml(html);
    expect(games.length).toBeGreaterThan(0);
    for (const g of games) {
      expect(g).toHaveProperty('minutes');
      expect(g).toHaveProperty('pts');
      expect(g).toHaveProperty('reb');
      expect(g).toHaveProperty('ast');
    }
  });

  it('skips the Inactive/DNP row present in the fixture', () => {
    // The fixture has 5 played games + 1 "Inactive" row with no mp cell.
    const games = parseGameLogHtml(html);
    expect(games).toHaveLength(5);
  });

  it('matches the real published values for the first game (Jokic 2023-10-24 vs LAL)', () => {
    const games = parseGameLogHtml(html);
    expect(games[0]).toEqual({ minutes: '36:16', pts: 29, reb: 13, ast: 11 });
  });
});
