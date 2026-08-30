import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  COLUMNS,
  WNBA_ROSTER_ALIASES,
  canonicalWnbaTeam,
  parseWnbaRosterHtml,
} from './wnbaRoster.js';
import { WNBA_TEAMS } from '../../../src/cards/teams.js';

const FIXTURE = readFileSync(
  new URL('./__fixtures__/sample-wnba-players.html', import.meta.url),
  'utf-8'
);

/** Builds a page around an arbitrary currentPlayersData, for the shape checks. */
const page = rows =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { currentPlayersData: rows } },
  })}</script></body></html>`;

/** A well-formed row, so each shape test can break exactly one thing. */
const row = (over = {}) => {
  const cells = [
    1628276, 'Plum', 'Kelsey', 'kelsey-plum', 1611661319, 'mercury',
    'Phoenix', 'Mercury', 'PHX', '10', 'G',
  ];
  for (const [name, value] of Object.entries(over)) cells[COLUMNS[name]] = value;
  return cells;
};

describe('parseWnbaRosterHtml', () => {
  it('reads a positional row into a named record', () => {
    const players = parseWnbaRosterHtml(FIXTURE);
    expect(players.length).toBeGreaterThan(0);
    const plum = players.find(p => p.personId === 1628276);
    expect(plum).toMatchObject({
      firstName: 'Kelsey',
      lastName: 'Plum',
      fullName: 'Kelsey Plum',
      teamCity: 'Phoenix',
      teamName: 'Mercury',
      position: 'G',
    });
  });

  it('translates wnba.com tricodes into Basketball-Reference abbreviations', () => {
    // The one the user reported. wnba.com says PHX, the stat tables say PHO,
    // and WNBA_TEAMS is keyed the way the stat tables spell it — so an
    // untranslated tricode would find no franchise and theme grey, which is the
    // exact failure this whole path exists to remove.
    const plum = parseWnbaRosterHtml(FIXTURE).find(p => p.personId === 1628276);
    expect(plum.team).toBe('PHO');
    expect(canonicalWnbaTeam('PDX')).toBe('POR');
    expect(canonicalWnbaTeam('LVA')).toBe('LVA');
    expect(canonicalWnbaTeam(null)).toBeNull();
  });

  it('resolves every alias to a franchise that actually exists', () => {
    // A typo in the alias table would be invisible: the code would map onto a
    // key nothing has, and the player would theme grey exactly as if the alias
    // were missing.
    for (const [from, to] of Object.entries(WNBA_ROSTER_ALIASES)) {
      expect(Object.hasOwn(WNBA_TEAMS, to), `${from} -> ${to}`).toBe(true);
      expect(Object.hasOwn(WNBA_TEAMS, from), `${from} is not a BBRef code`).toBe(false);
    }
  });

  it('preserves a null team for a player on no roster', () => {
    // Unsigned players stay in the feed with a person id and every team field
    // null (NaLyssa Smith, verified 2026-08-30). The null has to reach the
    // caller: "she is on no roster, keep her stat-table team" and "the feed
    // changed shape" must stay distinguishable, and only the null does that.
    const smith = parseWnbaRosterHtml(FIXTURE).find(p => p.fullName === 'NaLyssa Smith');
    expect(smith.team).toBeNull();
    expect(smith.teamCity).toBeNull();
    expect(smith.personId).toBeGreaterThan(0);
  });

  it('keeps a roster team that DISAGREES with the stat table', () => {
    // DeWanna Bonner's only 2026 stat row is Phoenix; wnba.com has her on
    // Atlanta. That is not an error to smooth over — it is the entire reason to
    // consult a roster at all, and the adapter must report what the feed says.
    const bonner = parseWnbaRosterHtml(FIXTURE).find(p => p.lastName === 'Bonner');
    expect(bonner.team).toBe('ATL');
  });

  it('names every rostered player onto a franchise the card set knows', () => {
    for (const p of parseWnbaRosterHtml(FIXTURE)) {
      if (p.team === null) continue;
      expect(Object.hasOwn(WNBA_TEAMS, p.team), `${p.fullName} -> ${p.team}`).toBe(true);
    }
  });

  // ── The shape checks, which exist because the row is positional ───────────
  //
  // A self-describing feed announces a breaking change by renaming a key. This
  // one cannot: insert a column and index 8 keeps returning a string, just the
  // wrong one. These are the only tripwire available.

  it('throws when the tricode column returns something that is not a tricode', () => {
    // The realistic failure: a column inserted before the tricode, after which
    // index 8 is the jersey number and every player in the league is on team
    // "10". Silent, and league-wide.
    expect(() => parseWnbaRosterHtml(page([row({ team: '10' })]))).toThrow(/not a team tricode/);
  });

  it('throws when the id column stops being an id', () => {
    expect(() => parseWnbaRosterHtml(page([row({ personId: 'Plum' })]))).toThrow(
      /not a numeric person id/
    );
  });

  it('throws on a row too short to hold the columns it reads', () => {
    expect(() => parseWnbaRosterHtml(page([[1, 'Plum', 'Kelsey']]))).toThrow(/row shape/);
  });

  it('throws when the name columns are empty', () => {
    expect(() => parseWnbaRosterHtml(page([row({ firstName: '' })]))).toThrow(/no name at columns/);
  });

  it('throws on an EMPTY roster rather than returning one', () => {
    // [] passes Array.isArray and would leave every moved player on TOT with
    // nothing to show that the feed had stopped answering.
    expect(() => parseWnbaRosterHtml(page([]))).toThrow(/never serves an empty/);
  });

  it('throws when currentPlayersData is not an array at all', () => {
    expect(() => parseWnbaRosterHtml(page({ nope: true }))).toThrow(/was not an array/);
  });

  it('throws when the __NEXT_DATA__ script tag is missing', () => {
    expect(() => parseWnbaRosterHtml('<html><body>nope</body></html>')).toThrow(/__NEXT_DATA__/);
  });

  it('throws when the blob is not JSON', () => {
    expect(() =>
      parseWnbaRosterHtml('<script id="__NEXT_DATA__" type="application/json">{</script>')
    ).toThrow(/not valid JSON/);
  });
});
