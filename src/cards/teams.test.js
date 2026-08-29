import { describe, it, expect } from 'vitest';
import { TEAMS, getTeam, getThemedTeam } from './teams.js';

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

  it('carries real brand colors for spot-checked teams', () => {
    expect(TEAMS.LAL).toMatchObject({ primary: '#552583', secondary: '#FDB927' });
    expect(TEAMS.BOS).toMatchObject({ primary: '#007A33', secondary: '#BA9653' });
    expect(TEAMS.DEN).toMatchObject({ primary: '#0E2240', secondary: '#FEC524' });
    expect(TEAMS.GSW).toMatchObject({ primary: '#1D428A', secondary: '#FFC72C' });
  });
});

describe('getTeam', () => {
  it('returns the team for a known abbreviation', () => {
    expect(getTeam('DEN').name).toBe('Nuggets');
  });

  it('returns a neutral fallback for an unknown abbreviation', () => {
    const t = getTeam('ZZZ');
    expect(t.name).toBe('Unknown');
    expect(t.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(t.secondary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(t.logo).toBeNull();
  });

  it('falls back for multi-team aggregate codes, which are not teams', () => {
    // 45 players in the 2025-26 pool still carry these.
    expect(getTeam('2TM').name).toBe('Unknown');
    expect(getTeam('3TM').name).toBe('Unknown');
  });

  it('falls back rather than throwing on a missing abbreviation', () => {
    expect(getTeam(undefined).name).toBe('Unknown');
    expect(getTeam(null).name).toBe('Unknown');
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
    expect(themed.secondary).toBe('#FDB927');
    expect(themed.name).toBe('Lakers');
  });

  it('ignores overrides aimed at a different team', () => {
    expect(getThemedTeam('BOS', { LAL: { primary: '#FF0000' } })).toEqual(TEAMS.BOS);
  });

  it('still returns the fallback for an unknown abbreviation', () => {
    expect(getThemedTeam('ZZZ', { LAL: { primary: '#FF0000' } }).name).toBe('Unknown');
  });

  it('does not mutate the source table', () => {
    getThemedTeam('LAL', { LAL: { primary: '#FF0000' } });
    expect(TEAMS.LAL.primary).toBe('#552583');
  });
});
