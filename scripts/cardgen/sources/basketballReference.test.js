import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGameLogHtml, parseSeasonTableHtml, SEASON_TABLES } from './basketballReference.js';

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

describe('parseSeasonTableHtml', () => {
  const html = readFileSync(
    new URL('./__fixtures__/sample-per-poss.html', import.meta.url),
    'utf8'
  );

  it('reads every player row with its Basketball-Reference id', () => {
    const rows = parseSeasonTableHtml(html, 'per_poss');
    expect(rows.map(r => r.playerId)).toEqual([
      'bridgmi01',
      'hartjo01',
      'edwaran01',
      'bookede01',
    ]);
    expect(rows[0].name).toBe('Mikal Bridges');
  });

  // The name cell is a <td> with a nested <a>; the counting columns are plain
  // <td>s; `games` is wrapped in <strong>. All three have to come out as text.
  it('strips the markup inside a cell', () => {
    const [bridges] = parseSeasonTableHtml(html, 'per_poss');
    expect(bridges.cells.team_name_abbr).toBe('NYK');
    expect(bridges.cells.games).toBe('82');
    expect(bridges.cells.pos).toBe('SF');
  });

  // On per_poss the counting columns are suffixed `_per_poss` — reading them as
  // bare `pts` returns nothing and coerces to zero for every player in the
  // league, which is a silent, total data loss rather than a failure.
  it('exposes the _per_poss column names the table actually uses', () => {
    const [bridges] = parseSeasonTableHtml(html, 'per_poss');
    expect(bridges.cells.pts_per_poss).toBe('23.6');
    expect(bridges.cells.pts).toBeUndefined();
  });

  // The tfoot holds a league-average row with no data-append-csv. Counting it as
  // a player would add a phantom to every join.
  it('skips the league-average footer row', () => {
    expect(parseSeasonTableHtml(html, 'per_poss')).toHaveLength(4);
  });

  it('throws when the table id is not on the page', () => {
    expect(() => parseSeasonTableHtml(html, 'advanced')).toThrow(/no id="advanced"/);
  });
});

describe('SEASON_TABLES', () => {
  // The URL slug and the table id are NOT the same string for every table, and
  // assuming they were is what broke the first fetch of per_game.
  it('keeps the URL slug and the table id apart', () => {
    expect(SEASON_TABLES.perGame).toEqual({ slug: 'per_game', tableId: 'per_game_stats' });
    expect(SEASON_TABLES.perPoss.slug).toBe('per_poss');
    expect(SEASON_TABLES.perPoss.tableId).toBe('per_poss');
  });
});
