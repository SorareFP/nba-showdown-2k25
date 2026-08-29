import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRosterHtml } from './nbaRoster.js';

const FIXTURE = readFileSync(new URL('./__fixtures__/sample-nba-players.html', import.meta.url), 'utf-8');

describe('parseRosterHtml', () => {
  it('extracts player records with team and person id', () => {
    const players = parseRosterHtml(FIXTURE);
    expect(players.length).toBeGreaterThan(0);
    // NOTE: nba.com spells this surname WITH the diacritic ("Jokić"), exactly as
    // Basketball-Reference does in our player pool — verified 2026-08-29 against
    // both live sources. (An earlier assumption that nba.com served a plain-ASCII
    // "Jokic" here was wrong.) This adapter is a source adapter: it passes names
    // through verbatim and deliberately does no normalization, so the assertion
    // matches the raw feed value. Name matching/normalization between the two
    // sources belongs to the consumer (resolveTeams.js), not here.
    const jokic = players.find((p) => p.lastName === 'Jokić');
    expect(jokic).toMatchObject({
      personId: 203999,
      firstName: 'Nikola',
      team: 'DEN',
      teamCity: 'Denver',
      teamName: 'Nuggets',
    });
    expect(jokic.fullName).toBe('Nikola Jokić');
  });

  // An unsigned free agent stays in the feed with its TEAM_* fields null. That
  // null must survive to the caller: resolveTeams.js has to tell "this player
  // has no team" apart from "nba.com renamed its team keys", and preserving the
  // null is the only thing that keeps those two distinguishable.
  it('preserves a null team for an unsigned free agent still listed in the feed', () => {
    const players = parseRosterHtml(FIXTURE);
    const deRozan = players.find((p) => p.personId === 201942);
    expect(deRozan.fullName).toBe('DeMar DeRozan');
    expect(deRozan.team).toBeNull();
    expect(deRozan.teamCity).toBeNull();
    expect(deRozan.teamName).toBeNull();
  });

  it('throws when the __NEXT_DATA__ script tag is missing', () => {
    expect(() => parseRosterHtml('<html><body>nope</body></html>')).toThrow(/__NEXT_DATA__/);
  });

  it('throws when the players array is missing from the blob', () => {
    const html = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>';
    expect(() => parseRosterHtml(html)).toThrow(/pageProps\.players/);
  });

  // Array.isArray([]) is true, so the shape guard alone lets an empty roster
  // through. nba.com is never legitimately empty, and silently returning []
  // would strand every traded player on a "2TM" code.
  it('throws when the players array is present but empty', () => {
    const html =
      '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"players":[]}}}</script>';
    expect(() => parseRosterHtml(html)).toThrow(/empty/);
  });

  // A key rename is the failure mode that would otherwise produce well-formed
  // garbage: every field undefined, and fullName the truthy string
  // "undefined undefined", which passes a naive `if (p.fullName)` check.
  it('throws when a record is missing a required key, instead of mapping it to undefined', () => {
    const renamed = JSON.stringify({
      props: { pageProps: { players: [{ personId: 203999, firstName: 'Nikola', lastName: 'Jokić' }] } },
    });
    expect(
      () => parseRosterHtml(`<script id="__NEXT_DATA__" type="application/json">${renamed}</script>`)
    ).toThrow(/players\[0\] has no PERSON_ID key/);
  });

  // Presence, not truthiness — otherwise the fix above would reject the
  // legitimate null-team free agents the adapter is contractually required to keep.
  it('accepts a record whose team keys are present but null', () => {
    const nulls = JSON.stringify({
      props: {
        pageProps: {
          players: [
            {
              PERSON_ID: 1,
              PLAYER_FIRST_NAME: 'A',
              PLAYER_LAST_NAME: 'B',
              TEAM_ABBREVIATION: null,
            },
          ],
        },
      },
    });
    const players = parseRosterHtml(
      `<script id="__NEXT_DATA__" type="application/json">${nulls}</script>`
    );
    expect(players[0]).toMatchObject({ personId: 1, team: null });
  });

  it('throws a contextualized error when an array entry is not an object', () => {
    const html =
      '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"players":[null]}}}</script>';
    expect(() => parseRosterHtml(html)).toThrow(/players\[0\] was not an object/);
  });
});
