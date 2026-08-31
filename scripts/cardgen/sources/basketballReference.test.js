import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseGameLogHtml,
  parseLeagueChampionHtml,
  parseRosterHtml,
  parseSeasonTableHtml,
  POSITION_ESTIMATE_STATS,
  SEASON_TABLES,
} from './basketballReference.js';

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

describe('the play-by-play position estimates', () => {
  const html = readFileSync(
    new URL('./__fixtures__/sample-play-by-play.html', import.meta.url),
    'utf8'
  );
  const rows = parseSeasonTableHtml(html, 'pbp_stats');
  const pct = row => Object.values(POSITION_ESTIMATE_STATS).map(s => Number(row.cells[s]));

  it('reads the five pct_N cells for every player', () => {
    expect(rows.map(r => r.playerId)).toEqual([
      'thompam01',
      'hardeja01',
      'goberru01',
      'doncilu01',
    ]);
    // Amen Thompson, a near-pure point guard: 83% PG, 16% SG, 1% SF.
    expect(pct(rows[0])).toEqual([83, 16, 1, 0, 0]);
    // Rudy Gobert, the other end of the same scale.
    expect(pct(rows[2])).toEqual([0, 0, 0, 0, 100]);
  });

  // The whole reason this table is worth fetching: the single `pos` label calls
  // James Harden a point guard, and the shares say he spent more of his minutes
  // at the two. A label cannot express that and a blend can.
  it('disagrees with the single position label where the label is a simplification', () => {
    const harden = rows[1];
    expect(harden.cells.pos).toBe('PG');
    expect(pct(harden)).toEqual([46, 52, 2, 0, 0]);
  });

  // A traded player's whole season lives on his 2TM aggregate row, which is the
  // one `dedupeByMaxGames` keeps. Losing it would leave half a season's shares.
  it('keeps the multi-team aggregate row a traded player s season lives on', () => {
    expect(rows[1].cells.team_name_abbr).toBe('2TM');
    expect(Number(rows[1].cells.games)).toBe(70);
  });

  // Integer percentages, so a row need not total exactly 100 — 99 to 102 across
  // the real 2026 table. Every consumer normalizes rather than trusting the sum.
  it('does not promise the five shares total 100', () => {
    for (const row of rows) {
      const sum = pct(row).reduce((a, b) => a + b, 0);
      expect(sum).toBeGreaterThanOrEqual(99);
      expect(sum).toBeLessThanOrEqual(102);
    }
  });

  it('maps pct_1 to PG and pct_5 to C, which is not guessable from the markup', () => {
    expect(POSITION_ESTIMATE_STATS).toEqual({
      PG: 'pct_1',
      SG: 'pct_2',
      SF: 'pct_3',
      PF: 'pct_4',
      C: 'pct_5',
    });
  });
});

describe('SEASON_TABLES', () => {
  // The URL slug and the table id are NOT the same string for every table, and
  // assuming they were is what broke the first fetch of per_game.
  it('keeps the URL slug and the table id apart', () => {
    expect(SEASON_TABLES.perGame).toEqual({ slug: 'per_game', tableId: 'per_game_stats' });
    expect(SEASON_TABLES.perPoss.slug).toBe('per_poss');
    expect(SEASON_TABLES.perPoss.tableId).toBe('per_poss');
    // The play-by-play page shares no substring between the two, which is the
    // strongest case yet for spelling them out rather than deriving one.
    expect(SEASON_TABLES.playByPlay).toEqual({ slug: 'play-by-play', tableId: 'pbp_stats' });
  });

  // The page carries `pbp_stats_post` for the playoffs right beside the
  // regular-season table. `id="pbp_stats"` includes the closing quote, so the
  // playoff table cannot be selected by a prefix match.
  it('cannot select the playoff table by prefix', () => {
    const playoffOnly = '<table id="pbp_stats_post"><tbody><tr></tr></tbody></table>';
    expect(() => parseSeasonTableHtml(playoffOnly, SEASON_TABLES.playByPlay.tableId)).toThrow(
      /no id="pbp_stats"/
    );
  });
});

// ── THE AWARDS COLUMN, AND THE ONE TOKEN THAT MUST NOT REACH IT ─────────────
//
// The advanced page is the same shape: `<table id="advanced">` for the regular
// season and `<table id="advanced_post">` for the playoffs, one after the
// other. And the playoff table carries a token the regular-season one never
// does — `Finals MVP-1`, live on Jalen Brunson's 2026 row:
//
//   <td data-stat="awards"><b><a href="/awards/finals_mvp.html">
//      Finals MVP-1</a></b></td>
//
// That token ends in `-1`, and `-1` is the entire rule that earns a trophy in
// src/cards/awards.js. A parser that split on whitespace would print a
// REGULAR-SEASON MVP on the Finals MVP.
//
// BOTH TABLES ARE READ NOW — `advancedPost` is where the Finals MVP mark comes
// from — so the guarantee this file owes is no longer "the playoff rows are
// never seen" but the stronger and more useful one: THE TWO REQUESTS RETURN
// DISJOINT ROWS. Asking for `advanced` gets the regular season and only the
// regular season; asking for `advancedPost` gets the playoffs and only the
// playoffs. `isolateTableBody` matching the closing quote is what does it, and
// it is stated here on the real markup rather than an analogous one.
describe('the awards column', () => {
  const REG = `<table id="advanced"><tbody>
    <tr><td data-append-csv="gilgesh01" data-stat="name_display">Shai Gilgeous-Alexander</td>
        <td data-stat="awards"><b>MVP-1,CPOY-1,AS,NBA1</b></td></tr>
    <tr><td data-append-csv="brunsja01" data-stat="name_display">Jalen Brunson</td>
        <td data-stat="awards">CPOY-5,AS,NBA2</td></tr>
  </tbody></table>`;
  const POST = `<table id="advanced_post"><tbody>
    <tr><td data-append-csv="brunsja01" data-stat="name_display">Jalen Brunson</td>
        <td data-stat="awards"><b><a href="/awards/finals_mvp.html">Finals MVP-1</a></b></td></tr>
  </tbody></table>`;

  it('reads the column, with the markup stripped out of the cell', () => {
    // The cell is wrapped in <b> and sometimes in <a>; the value is the text.
    const rows = parseSeasonTableHtml(REG, SEASON_TABLES.advanced.tableId);
    expect(rows.map(r => r.cells.awards)).toEqual(['MVP-1,CPOY-1,AS,NBA1', 'CPOY-5,AS,NBA2']);
  });

  it('never reads the playoff table when asked for the regular season', () => {
    const rows = parseSeasonTableHtml(REG + POST, SEASON_TABLES.advanced.tableId);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.cells.awards, row.playerId).not.toMatch(/Finals/);
    // And the reason: `id="advanced"` includes the closing quote, so
    // `advanced_post` is not a prefix match for it. On a page carrying only the
    // playoff table this throws rather than silently parsing the wrong rows.
    expect(() => parseSeasonTableHtml(POST, SEASON_TABLES.advanced.tableId)).toThrow(
      /no id="advanced"/
    );
  });

  it('reads the playoff table, and ONLY it, when asked for the postseason', () => {
    // The other half of the disjointness, and the half the Finals MVP mark
    // depends on. The two entries share a slug — same page — and differ only in
    // the table they isolate, so this is what says the pair is a partition and
    // not two views of the same rows.
    const rows = parseSeasonTableHtml(REG + POST, SEASON_TABLES.advancedPost.tableId);
    expect(rows).toHaveLength(1);
    expect(rows[0].playerId).toBe('brunsja01');
    expect(rows[0].cells.awards).toBe('Finals MVP-1');
    expect(SEASON_TABLES.advancedPost.slug).toBe(SEASON_TABLES.advanced.slug);
  });
});

// ── THE CHAMPION, WHICH IS ON NO TABLE AT ALL ───────────────────────────────
describe('parseLeagueChampionHtml', () => {
  // The real sentence off NBA_2026.html, single-quoted href and all.
  const PAGE =
    "<p><strong>League Champion</strong>: <a href='/teams/NYK/2026.html'>New York Knicks</a></p>" +
    "<p><strong>Most Valuable Player</strong>: <a href='/players/g/gilgesh01.html'>SGA</a></p>";

  it('reads the team, its season abbreviation and its name', () => {
    expect(parseLeagueChampionHtml(PAGE)).toEqual({
      abbr: 'NYK',
      season: 2026,
      name: 'New York Knicks',
    });
  });

  it('takes the abbreviation off the LINK, not from this repo', () => {
    // The champions span 2004..2026, a range in which New Jersey became
    // Brooklyn and New Orleans was NOH before it was NOP. teams.js knows only
    // today's spelling, so the href is the only answer that cannot drift.
    const nets = "<p><strong>League Champion</strong>: <a href='/teams/NJN/2003.html'>New Jersey Nets</a></p>";
    expect(parseLeagueChampionHtml(nets)).toEqual({
      abbr: 'NJN',
      season: 2003,
      name: 'New Jersey Nets',
    });
  });

  it('returns null for a season nobody has won yet, rather than throwing', () => {
    // Not hypothetical: an in-progress season's index page exists and lists
    // leaders months before it lists a champion.
    expect(parseLeagueChampionHtml('<p><strong>PPG Leader</strong>: someone</p>')).toBeNull();
    expect(parseLeagueChampionHtml('')).toBeNull();
    expect(parseLeagueChampionHtml(null)).toBeNull();
  });
});

describe('parseRosterHtml', () => {
  // Basketball-Reference repeats `data-append-csv` on a roster row — the linked
  // name cell and the sortable-key cell both carry it — so a naive scan returns
  // every player twice. Verified on the live NYK 2026 page: 40 hits, 20 men.
  const ROSTER = `<table id="roster"><tbody>
    <tr><td data-append-csv="brunsja01" data-stat="player">Jalen Brunson</td>
        <td data-append-csv="brunsja01" data-stat="pos">PG</td></tr>
    <tr><td data-append-csv="townska01" data-stat="player">Karl-Anthony Towns</td></tr>
    <tr><td data-stat="player">(a header row, no id)</td></tr>
  </tbody></table>`;

  it('deduplicates by id and skips rows with no player id', () => {
    expect(parseRosterHtml(ROSTER)).toEqual([
      { playerId: 'brunsja01', name: 'Jalen Brunson' },
      { playerId: 'townska01', name: 'Karl-Anthony Towns' },
    ]);
  });

  it('reads the ROSTER table, which is the team as it FINISHED the season', () => {
    // The same page carries per_game_stats, which lists everyone who logged a
    // minute — including a player traded away in February who was not there in
    // June. Reading the harder table is what makes the ring's rule correct.
    const withStats =
      ROSTER +
      '<table id="per_game_stats"><tbody><tr>' +
      '<td data-append-csv="tradedaw01" data-stat="player">Traded Away</td>' +
      '</tr></tbody></table>';
    expect(parseRosterHtml(withStats).map(p => p.playerId)).toEqual([
      'brunsja01',
      'townska01',
    ]);
  });
});
