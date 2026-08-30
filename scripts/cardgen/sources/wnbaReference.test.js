// Tests for the WNBA season-table adapter, against REAL markup.
//
// The fixtures are trimmed excerpts of the live 2026 pages (fetched
// 2026-08-30), not hand-written HTML, because every bug this parser can have is
// a bug about what Basketball-Reference actually emits — and two of them are
// things nobody would write by hand: an unterminated `</strong` and a `<tbody>`
// that is never closed.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  WNBA_SEASON_TABLES,
  dedupeByMaxGames,
  isAggregateTeam,
  parseRowCells,
  parseWnbaLeaguePace,
  parseWnbaTableHtml,
  playerIdFromRow,
  stripCellMarkup,
  trimWnbaTable,
} from './wnbaReference.js';

const fixture = name => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const PER_GAME = fixture('sample-wnba-per-game.html');
const ADVANCED = fixture('sample-wnba-advanced.html');
const PER_POSS = fixture('sample-wnba-per-poss.html');
const SEASON = fixture('sample-wnba-season.html');

describe('stripCellMarkup', () => {
  it('drops an UNTERMINATED closing tag, which is the whole gotcha', () => {
    // Verbatim from the live page. `</strong` has no closing bracket, so the
    // ordinary `<[^>]*>` strip cannot see it and leaves it on the name.
    expect(stripCellMarkup("<strong><a href='/x'>Kiah Stokes</a></strong")).toBe('Kiah Stokes');
  });

  it('leaves ordinary text and ordinary markup alone', () => {
    expect(stripCellMarkup('<a href="/x">GSV</a>')).toBe('GSV');
    expect(stripCellMarkup('22.2')).toBe('22.2');
    expect(stripCellMarkup('')).toBe('');
    expect(stripCellMarkup(null)).toBe('');
  });

  it('does not eat a stray less-than that is not a tag', () => {
    expect(stripCellMarkup('a < b')).toBe('a < b');
  });
});

describe('parseWnbaTableHtml', () => {
  it('reads every player row and no header row', () => {
    const rows = parseWnbaTableHtml(PER_GAME, 'per_game');
    // The fixture holds one repeated header row, five players, and Kelsey
    // Plum's TOT row plus both of her team splits.
    expect(rows).toHaveLength(7);
    expect(rows.every(r => r.name && r.playerId)).toBe(true);
  });

  it('never lets a tag fragment reach a name', () => {
    for (const [html, id] of [
      [PER_GAME, 'per_game'],
      [ADVANCED, 'advanced'],
      [PER_POSS, 'per_poss'],
    ]) {
      for (const row of parseWnbaTableHtml(html, id)) {
        expect(row.name, row.name).not.toMatch(/[<>]/);
      }
    }
  });

  it('gets the name right on the row that is wrapped in <strong>', () => {
    const rows = parseWnbaTableHtml(PER_GAME, 'per_game');
    expect(rows.map(r => r.name)).toContain('Kiah Stokes');
    expect(rows.map(r => r.name)).not.toContain('Kiah Stokes</strong');
  });

  it("takes the player id out of the link, since there is no data-append-csv", () => {
    expect(PER_GAME).not.toContain('data-append-csv');
    const rows = parseWnbaTableHtml(PER_GAME, 'per_game');
    expect(rows.find(r => r.name === 'A’ja Wilson' || r.name === "A'ja Wilson").playerId).toBe(
      'wilsoa01w'
    );
  });

  it('survives a <tbody> that is never closed', () => {
    // The live WNBA pages emit `<tbody>` and no `</tbody>`; the body ends at
    // `</table>`. Ending only on `</tbody>` would run to the end of the file.
    expect(PER_GAME).not.toContain('</tbody>');
    expect(parseWnbaTableHtml(PER_GAME, 'per_game').length).toBeGreaterThan(0);
  });

  it('stops at the table it was asked for rather than running on', () => {
    const twoTables = `${PER_GAME}<table id="other"><tbody><tr><td data-stat="player"><a href='/wnba/players/z/zzzzzz01w.html'>Nobody</a></td></tr></table>`;
    const rows = parseWnbaTableHtml(twoTables, 'per_game');
    expect(rows.map(r => r.name)).not.toContain('Nobody');
  });

  it('throws rather than guessing when the table is not there', () => {
    expect(() => parseWnbaTableHtml('<html></html>', 'per_game')).toThrow(/no id="per_game"/);
  });
});

describe('parseRowCells', () => {
  it('keeps the FIRST value when a data-stat is printed twice', () => {
    // `g` and `mp` each appear twice in every WNBA row.
    const row =
      '<tr><td data-stat="g">29</td><td data-stat="mp">831</td>' +
      '<td data-stat="g">29</td><td data-stat="gs">27</td></tr>';
    expect(parseRowCells(row)).toEqual({ g: '29', mp: '831', gs: '27' });
  });
});

describe('playerIdFromRow', () => {
  it('reads the id out of a WNBA player href and nothing else', () => {
    expect(playerIdFromRow("<a href='/wnba/players/s/stokeki01w.html'>x</a>")).toBe('stokeki01w');
    expect(playerIdFromRow("<a href='/players/s/stokeki01.html'>x</a>")).toBeNull();
    expect(playerIdFromRow('<tr class="thead"><th>Player</th></tr>')).toBeNull();
  });
});

describe('trimWnbaTable', () => {
  const one = (html, id, kind, name) =>
    trimWnbaTable(parseWnbaTableHtml(html, id), kind).find(r => r.name === name);

  it('reads the per-game columns, with total minutes rather than per-game', () => {
    const stokes = one(PER_GAME, 'per_game', 'perGame', 'Kiah Stokes');
    expect(stokes).toMatchObject({ team: 'GSV', pos: 'C', games: 38, mpg: 22.2 });
    // `mp` on this table is the SEASON total: 38 games x 22.2 = 843.6.
    expect(stokes.minutes).toBe(843);
  });

  it('reads WS PER FORTY, not per forty-eight', () => {
    const stokes = one(ADVANCED, 'advanced', 'advanced', 'Kiah Stokes');
    expect(stokes.wsPer40).toBe(0.153);
    // The identity that makes WS/40 the WNBA's exact analogue of the NBA's
    // WS/48: it is total Win Shares scaled to a full game of playing time.
    expect((stokes.ws * 40) / stokes.minutes).toBeCloseTo(stokes.wsPer40, 2);
  });

  it('carries ORtg and DRtg, which the NBA keeps on a different table', () => {
    const stokes = one(ADVANCED, 'advanced', 'advanced', 'Kiah Stokes');
    expect(stokes.offRtg).toBe(112);
    expect(stokes.defRtg).toBe(97);
  });

  it('has NO plus/minus estimate of any kind — the reason the model exists', () => {
    const stokes = one(ADVANCED, 'advanced', 'advanced', 'Kiah Stokes');
    for (const absent of ['bpm', 'obpm', 'dbpm', 'vorp']) {
      expect(stokes[absent]).toBeUndefined();
    }
    expect(ADVANCED).not.toContain('data-stat="bpm"');
  });

  it('derives defensive rebounds, which the per-100 table does not carry', () => {
    expect(PER_POSS).not.toContain('drb_per_poss');
    const stokes = one(PER_POSS, 'per_poss', 'perPoss', 'Kiah Stokes');
    expect(stokes.orb100).toBe(2.7);
    expect(stokes.trb100).toBe(13.4);
    // Exact by definition, not an estimate: rebounds are offensive or defensive.
    expect(stokes.drb100).toBe(10.7);
  });

  it('leaves an empty cell null rather than zero', () => {
    // A player with no three-point attempts has no 3P%, and a 0 there would be
    // a shooting percentage she never posted.
    const rows = trimWnbaTable(
      [{ playerId: 'x', name: 'X', cells: { g: '4', mp: '40', fg3_pct: '' } }],
      'perGame'
    );
    expect(rows[0].fgPct3).toBeNull();
    expect(rows[0].games).toBe(4);
  });
});

describe('dedupeByMaxGames', () => {
  it('keeps the TOT row of a player who moved, not either half', () => {
    const rows = trimWnbaTable(parseWnbaTableHtml(PER_GAME, 'per_game'), 'perGame');
    const plum = rows.filter(r => r.name === 'Kelsey Plum');
    expect(plum.length).toBeGreaterThan(1);
    const kept = dedupeByMaxGames(rows).filter(r => r.name === 'Kelsey Plum');
    expect(kept).toHaveLength(1);
    expect(kept[0].team).toBe('TOT');
    expect(kept[0].games).toBe(Math.max(...plum.map(p => p.games)));
  });

  it('leaves one row per player', () => {
    const rows = dedupeByMaxGames(trimWnbaTable(parseWnbaTableHtml(PER_GAME, 'per_game'), 'perGame'));
    expect(new Set(rows.map(r => r.playerId)).size).toBe(rows.length);
  });
});

describe('isAggregateTeam', () => {
  it('knows TOT is not a franchise', () => {
    expect(isAggregateTeam('TOT')).toBe(true);
    expect(isAggregateTeam('2TM')).toBe(true);
    expect(isAggregateTeam('LVA')).toBe(false);
    expect(isAggregateTeam(null)).toBe(false);
  });
});

describe('parseWnbaLeaguePace', () => {
  it('averages the teams and excludes the league-average row', () => {
    const measured = parseWnbaLeaguePace(SEASON);
    // FIFTEEN teams in 2026 — Portland and Toronto joined Golden State's 2025
    // expansion. A table written from a 2024 memory would say thirteen.
    expect(measured.teams).toBe(15);
    expect(measured.paces.map(p => p.team)).not.toContain('League Average');
    // Basketball-Reference's own League Average row reads 79.2.
    expect(measured.pace).toBeCloseTo(79.2, 1);
  });

  it('throws rather than returning a wrong pace when the table moves', () => {
    expect(() => parseWnbaLeaguePace('<html></html>')).toThrow(/advanced-team/);
  });
});

describe('WNBA_SEASON_TABLES', () => {
  it('spells every table id out rather than deriving it from the slug', () => {
    // They all match today. The NBA's do not, which is why neither is derived.
    for (const table of Object.values(WNBA_SEASON_TABLES)) {
      expect(typeof table.slug).toBe('string');
      expect(typeof table.tableId).toBe('string');
    }
  });
});
