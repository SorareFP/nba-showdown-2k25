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

  it('throws when the __NEXT_DATA__ script tag is missing', () => {
    expect(() => parseRosterHtml('<html><body>nope</body></html>')).toThrow(/__NEXT_DATA__/);
  });

  it('throws when the players array is missing from the blob', () => {
    const html = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>';
    expect(() => parseRosterHtml(html)).toThrow(/pageProps\.players/);
  });
});
