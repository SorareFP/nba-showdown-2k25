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

  it('throws instead of silently parsing the whole page when the expected table id is missing', () => {
    // Guards against a repeat of this task's own discovery (BBRef's table id changed from
    // `pgl_basic` to `player_game_log_reg` between when the plan was written and now): if the
    // site's markup changes again, a batch job over hundreds of players should fail loudly on
    // the first mismatch instead of silently returning [] or blending in unrelated rows.
    const htmlWithoutExpectedTable = '<table id="some_other_table"><tbody><tr></tr></tbody></table>';
    expect(() => parseGameLogHtml(htmlWithoutExpectedTable)).toThrow(/player_game_log_reg/);
  });
});
