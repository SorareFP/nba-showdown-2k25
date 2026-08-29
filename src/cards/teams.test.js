import { describe, it, expect } from 'vitest';
import {
  TEAMS,
  TEAM_ALIASES,
  ACCENT_FALLBACK,
  canonicalTeam,
  getTeam,
  getThemedTeam,
  pickAccent,
  resolveAccent,
} from './teams.js';
import pool from '../../card-data/generated/player-pool-2026.json';

describe('TEAMS', () => {
  it('has all 30 NBA teams', () => {
    expect(Object.keys(TEAMS)).toHaveLength(30);
  });

  it('gives every team a name, two colors, and a logo path', () => {
    for (const [abbr, team] of Object.entries(TEAMS)) {
      expect(team.name, abbr).toBeTruthy();
      expect(team.city, abbr).toBeTruthy();
      expect(team.primary, abbr).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(team.secondary, abbr).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(team.logo, abbr).toBe(`/logos/${abbr}.png`);
    }
  });

  it('uses nba.com abbreviations, not Basketball-Reference ones', () => {
    expect(TEAMS.BKN).toBeDefined();
    expect(TEAMS.CHA).toBeDefined();
    expect(TEAMS.PHX).toBeDefined();
    expect(TEAMS.BRK).toBeUndefined();
    expect(TEAMS.CHO).toBeUndefined();
    expect(TEAMS.PHO).toBeUndefined();
  });

  it('carries the OFFICIAL brand colors for spot-checked teams', () => {
    // Values read off trucolor.net's current-era block per franchise (see the
    // header of teams.js). Pinned so a future edit from memory — which is how
    // this table was wrong in the first place — fails loudly.
    expect(TEAMS.LAL).toMatchObject({ primary: '#330072', secondary: '#FFC72C' }); // Royal Purple, Gold
    expect(TEAMS.BOS).toMatchObject({ primary: '#007A33', secondary: '#FFFFFF' }); // Celtic Green, White
    expect(TEAMS.DEN).toMatchObject({ primary: '#0C2340', secondary: '#862633' }); // Midnight Blue, Flatirons Red
    expect(TEAMS.GSW).toMatchObject({ primary: '#1D4289', secondary: '#FFC72C' }); // Warriors Royal Blue, California Golden Yellow
  });

  it('is on each franchise\'s CURRENT identity, not a retired one', () => {
    // The six that were still wearing a dead look: the Jazz's 2016-2022
    // navy/yellow, the Hawks' 2015-2020 volt green, and four more.
    expect(TEAMS.UTA.primary).toBe('#330072'); // Mountain Purple, not navy #002B5C
    expect(TEAMS.ATL.secondary).toBe('#FFC72C'); // Legacy Yellow, not volt green #C1D32F
    expect(TEAMS.MIN).toMatchObject({ primary: '#1D4289', secondary: '#009A44' }); // 2026-27 rebrand
    expect(TEAMS.HOU.secondary).toBe('#FFCD00'); // Championship Yellow, added 2026-27
  });

  it('uses no pure #000000 or #FFFFFF where the source names a real color', () => {
    // "Black C" is #010101 on this source, not #000000. A card themed from a
    // hand-typed #000000 is a card themed from memory.
    expect(TEAMS.CHI.secondary).toBe('#010101');
    expect(TEAMS.SAS.primary).toBe('#010101');
    expect(TEAMS.POR.primary).toBe('#010101');
  });
});

describe('TEAM_ALIASES', () => {
  it('covers exactly the three codes the two sources spell differently', () => {
    expect(TEAM_ALIASES).toEqual({ BRK: 'BKN', CHO: 'CHA', PHO: 'PHX' });
  });

  it('maps every alias onto a real entry in the table', () => {
    for (const [from, to] of Object.entries(TEAM_ALIASES)) {
      expect(TEAMS[to], `${from} -> ${to}`).toBeDefined();
      expect(TEAMS[from], from).toBeUndefined();
    }
  });

  it('leaves anything else alone, including inherited property names', () => {
    expect(canonicalTeam('LAL')).toBe('LAL');
    expect(canonicalTeam('2TM')).toBe('2TM');
    // `TEAM_ALIASES[abbr] ?? abbr` would hand back Object.prototype.toString.
    expect(canonicalTeam('toString')).toBe('toString');
    expect(canonicalTeam('constructor')).toBe('constructor');
  });
});

describe('getTeam', () => {
  it('returns the team for a known abbreviation', () => {
    expect(getTeam('DEN').name).toBe('Nuggets');
  });

  it('resolves Basketball-Reference spellings to the right team', () => {
    // The pool comes from Basketball-Reference; 32 of its 331 players carry
    // these codes and used to render on the grey fallback.
    expect(getTeam('BRK')).toEqual(TEAMS.BKN);
    expect(getTeam('CHO')).toEqual(TEAMS.CHA);
    expect(getTeam('PHO')).toEqual(TEAMS.PHX);
  });

  it('gives an aliased code the same colors and logo as its canonical one', () => {
    expect(getTeam('CHO')).toMatchObject({
      name: 'Hornets',
      primary: '#00778B',
      secondary: '#211747',
      logo: '/logos/CHA.png',
    });
  });

  it('returns a neutral fallback for an unknown abbreviation', () => {
    const t = getTeam('ZZZ');
    expect(t.name).toBe('Unknown');
    expect(t.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(t.secondary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(t.logo).toBeNull();
  });

  it('falls back for multi-team aggregate codes, which are not teams', () => {
    // 45 players in the 2025-26 pool still carry these. They are bad data, not
    // an alias problem, and looking unstyled is the point until team resolution
    // replaces them — so aliasing must NOT quietly rescue them.
    expect(getTeam('2TM').name).toBe('Unknown');
    expect(getTeam('3TM').name).toBe('Unknown');
  });

  it('falls back rather than throwing on a missing abbreviation', () => {
    expect(getTeam(undefined).name).toBe('Unknown');
    expect(getTeam(null).name).toBe('Unknown');
  });
});

describe('the 2025-26 pool against this table', () => {
  const unresolved = pool.filter(p => getTeam(p.team).name === 'Unknown');

  it('leaves only the 45 multi-team-code players unthemed', () => {
    expect(unresolved).toHaveLength(45);
    expect(new Set(unresolved.map(p => p.team))).toEqual(new Set(['2TM', '3TM']));
  });

  it('themes the 32 players on Basketball-Reference-spelled teams', () => {
    const aliased = pool.filter(p => p.team in TEAM_ALIASES);
    expect(aliased).toHaveLength(32);
    for (const p of aliased) expect(getTeam(p.team).logo, p.name).not.toBeNull();
  });
});

describe('getThemedTeam', () => {
  it('returns the plain team when there are no overrides', () => {
    expect(getThemedTeam('LAL')).toEqual(TEAMS.LAL);
    expect(getThemedTeam('LAL', {})).toEqual(TEAMS.LAL);
  });

  it('replaces only the fields the override names', () => {
    const themed = getThemedTeam('LAL', { LAL: { primary: '#FF0000' } });
    expect(themed.primary).toBe('#FF0000');
    expect(themed.secondary).toBe('#FFC72C');
    expect(themed.name).toBe('Lakers');
  });

  it('ignores overrides aimed at a different team', () => {
    expect(getThemedTeam('BOS', { LAL: { primary: '#FF0000' } })).toEqual(TEAMS.BOS);
  });

  it('still returns the fallback for an unknown abbreviation', () => {
    expect(getThemedTeam('ZZZ', { LAL: { primary: '#FF0000' } }).name).toBe('Unknown');
  });

  it('applies a canonical override to an aliased abbreviation', () => {
    // Otherwise the pool's 12 "BRK" players would keep the stock Nets colors
    // while every "BKN" player picked up the tuned ones.
    const themed = getThemedTeam('BRK', { BKN: { primary: '#FF0000' } });
    expect(themed.primary).toBe('#FF0000');
    expect(themed.name).toBe('Nets');
  });

  it('does not mutate the source table', () => {
    getThemedTeam('LAL', { LAL: { primary: '#FF0000' } });
    expect(TEAMS.LAL.primary).toBe('#330072');
  });

  it('ignores a blank value instead of applying it', () => {
    // The studio's team editor writes this map live out of a text field, so an
    // in-progress "" must not blank a color on every card on the team at once.
    expect(getThemedTeam('LAL', { LAL: { primary: '' } }).primary).toBe('#330072');
    expect(getThemedTeam('LAL', { LAL: { primary: '   ' } }).primary).toBe('#330072');
    expect(getThemedTeam('LAL', { LAL: { primary: null } }).primary).toBe('#330072');
  });

  it('carries an accent through even though no team has one', () => {
    // The accent is normally computed (see resolveAccent). This field is how a
    // team stops computing it, so the merge has to pass it along.
    expect(TEAMS.DEN.accent).toBeUndefined();
    expect(getThemedTeam('DEN', { DEN: { accent: '#FEC524' } }).accent).toBe('#FEC524');
  });

  it('leaves the accent absent when nothing overrides it', () => {
    // Load-bearing: "absent" is what tells the editor this team is following
    // the computation rather than pinned to a chosen color.
    expect(getThemedTeam('DEN', {})).not.toHaveProperty('accent');
    expect(getThemedTeam('DEN', { DEN: { primary: '#FF0000' } })).not.toHaveProperty('accent');
  });
});

describe('pickAccent', () => {
  it('takes the brighter of the two brand colors', () => {
    expect(pickAccent('#1D4289', '#FFC72C')).toBe('#FFC72C'); // Warriors
    expect(pickAccent('#FFC72C', '#1D4289')).toBe('#FFC72C'); // order-independent
  });

  it('falls back to cream when even the brighter one is unreadable on navy', () => {
    expect(pickAccent('#BA0C2F', '#010101')).toBe(ACCENT_FALLBACK); // Bulls
    expect(pickAccent(undefined, 'not-a-color')).toBe(ACCENT_FALLBACK);
  });

  it('falls back for half the league, which is why the override exists', () => {
    // So many official second colors are black or navy that the computation
    // gives up on 15 of 30 teams — Denver among them. Pinned because it is the
    // premise of the team editor's accent field, not an incidental number.
    const fellBack = Object.entries(TEAMS).filter(
      ([, t]) => pickAccent(t.primary, t.secondary) === ACCENT_FALLBACK
    );
    expect(fellBack).toHaveLength(15);
    expect(fellBack.map(([abbr]) => abbr)).toContain('DEN');
  });
});

describe('resolveAccent', () => {
  it('prefers an explicit accent over the computed one', () => {
    // Denver: Midnight Blue and Flatirons Red are both too dark, so the card
    // computes cream and has no gold anywhere. This is the fix.
    const computed = resolveAccent(getThemedTeam('DEN', {}));
    expect(computed).toBe(ACCENT_FALLBACK);
    expect(resolveAccent(getThemedTeam('DEN', { DEN: { accent: '#FEC524' } }))).toBe('#FEC524');
  });

  it('falls back to the computed accent when none is set', () => {
    expect(resolveAccent(getThemedTeam('GSW', {}))).toBe('#FFC72C');
    expect(resolveAccent(TEAMS.GSW)).toBe(pickAccent(TEAMS.GSW.primary, TEAMS.GSW.secondary));
  });

  it('treats a blank accent as no accent, not as a color', () => {
    expect(resolveAccent({ primary: '#1D4289', secondary: '#FFC72C', accent: '' })).toBe('#FFC72C');
    expect(resolveAccent({ primary: '#1D4289', secondary: '#FFC72C', accent: '   ' })).toBe('#FFC72C');
    expect(resolveAccent({ primary: '#1D4289', secondary: '#FFC72C', accent: null })).toBe('#FFC72C');
  });

  it('recomputes when primary/secondary are overridden and no accent is set', () => {
    // Editing the pair still moves the accent — that is the default behaviour
    // an explicit accent opts out of.
    expect(resolveAccent(getThemedTeam('DEN', { DEN: { secondary: '#FEC524' } }))).toBe('#FEC524');
  });

  it('reaches an aliased team through its canonical override', () => {
    // The pool's 12 "BRK" players must get the same accent as every "BKN" one.
    const overrides = { BKN: { accent: '#FEC524' } };
    expect(resolveAccent(getThemedTeam('BRK', overrides))).toBe('#FEC524');
    expect(resolveAccent(getThemedTeam('BKN', overrides))).toBe('#FEC524');
    expect(resolveAccent(getThemedTeam('CHO', { CHA: { accent: '#123456' } }))).toBe('#123456');
    expect(resolveAccent(getThemedTeam('PHO', { PHX: { accent: '#123456' } }))).toBe('#123456');
  });

  it('survives a missing team rather than throwing', () => {
    expect(resolveAccent(undefined)).toBe(ACCENT_FALLBACK);
    expect(resolveAccent({})).toBe(ACCENT_FALLBACK);
  });
});
