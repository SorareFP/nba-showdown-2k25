import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  canonicalTeam,
  resolvePlayerTeams,
  isMultiTeamCode,
  TEAM_ALIASES,
} from './resolveTeams.js';
import { TEAM_ALIASES as CARD_ALIASES } from '../../src/cards/teams.js';

describe('normalizeName', () => {
  it('strips diacritics, case, and punctuation', () => {
    expect(normalizeName('Nikola Jokić')).toBe(normalizeName('Nikola Jokic'));
    expect(normalizeName('Alperen Şengün')).toBe(normalizeName('Alperen Sengun'));
    expect(normalizeName('Nolan Traoré')).toBe(normalizeName('Nolan Traore'));
    expect(normalizeName('Tristan Da Silva')).toBe(normalizeName('Tristan da Silva'));
    expect(normalizeName("De'Aaron Fox")).toBe('deaaronfox');
    expect(normalizeName('A.J. Green')).toBe(normalizeName('AJ Green'));
  });

  it('strips generational suffixes so Jr./III variants match', () => {
    expect(normalizeName('Bobby Portis')).toBe(normalizeName('Bobby Portis Jr.'));
    expect(normalizeName('Robert Williams')).toBe(normalizeName('Robert Williams III'));
    expect(normalizeName('GG Jackson II')).toBe(normalizeName('GG Jackson'));
    expect(normalizeName('Terrence Shannon Jr.')).toBe(normalizeName('Terrence Shannon Jr'));
  });

  it('does not strip a suffix-like fragment that is part of the actual name', () => {
    // "Jr" only counts as a suffix at the END of the name.
    expect(normalizeName('Jrue Holiday')).toBe('jrueholiday');
    // "V" as a first initial, not a regnal suffix.
    expect(normalizeName('Vince Williams Jr.')).toBe('vincewilliams');
  });

  it('survives a missing name instead of throwing', () => {
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName(null)).toBe('');
  });
});

describe('canonicalTeam', () => {
  it('maps Basketball-Reference abbreviations to nba.com ones', () => {
    expect(canonicalTeam('BRK')).toBe('BKN');
    expect(canonicalTeam('CHO')).toBe('CHA');
    expect(canonicalTeam('PHO')).toBe('PHX');
  });

  it('passes through abbreviations that already agree', () => {
    expect(canonicalTeam('DEN')).toBe('DEN');
    expect(canonicalTeam('GSW')).toBe('GSW');
  });

  it('is the very same implementation the card theming uses', () => {
    // Not a duplicate of src/cards/teams.js — a re-export of it. If this ever
    // becomes a second copy, the two can disagree and a Nets card comes out
    // grey while resolveTeams insists it wrote "BKN".
    expect(TEAM_ALIASES).toBe(CARD_ALIASES);
  });
});

describe('isMultiTeamCode', () => {
  it('recognizes every Basketball-Reference aggregate code', () => {
    for (const code of ['2TM', '3TM', '4TM', 'TOT']) expect(isMultiTeamCode(code)).toBe(true);
  });

  it('leaves real teams alone', () => {
    for (const code of ['DEN', 'BKN', 'BRK', 'PHX']) expect(isMultiTeamCode(code)).toBe(false);
  });
});

describe('resolvePlayerTeams', () => {
  const roster = [
    { fullName: 'James Harden', team: 'CLE', personId: 201935 },
    { fullName: 'Nikola Jokic', team: 'DEN', personId: 203999 },
  ];

  it('replaces multi-team aggregate codes with the real current team', () => {
    const pool = [{ name: 'James Harden', team: '2TM' }];
    const { resolved } = resolvePlayerTeams(pool, roster, {});
    expect(resolved[0]).toMatchObject({ name: 'James Harden', team: 'CLE', personId: 201935 });
  });

  it('matches across diacritics', () => {
    const pool = [{ name: 'Nikola Jokić', team: 'DEN' }];
    const { resolved } = resolvePlayerTeams(pool, roster, {});
    expect(resolved[0]).toMatchObject({ team: 'DEN', personId: 203999 });
  });

  it('keeps every other pool field untouched', () => {
    const pool = [{ name: 'Nikola Jokić', team: 'DEN', pos: 'C', games: 70, mpg: 36.7 }];
    const { resolved } = resolvePlayerTeams(pool, roster, {});
    expect(resolved[0]).toMatchObject({ pos: 'C', games: 70, mpg: 36.7 });
  });

  it('keeps a real pool team when the player is absent from the roster', () => {
    // Retired/unsigned players (Westbrook) aren't on an active roster, but their
    // pool team is a real team — only 2TM/3TM codes are actually bad data.
    const pool = [{ name: 'Russell Westbrook', team: 'SAC' }];
    const { resolved, unresolved } = resolvePlayerTeams(pool, roster, {});
    expect(unresolved).toHaveLength(0);
    expect(resolved[0]).toMatchObject({ team: 'SAC', personId: null });
  });

  it('reports as unresolved only when the pool team is ALSO a multi-team code', () => {
    const pool = [{ name: 'Nobody At All', team: '2TM' }];
    const { resolved, unresolved } = resolvePlayerTeams(pool, roster, {});
    expect(resolved).toHaveLength(0);
    expect(unresolved).toEqual(['Nobody At All']);
  });

  it('falls back to the pool team when the roster record has a null team', () => {
    // nba.com lists unsigned free agents with TEAM_ABBREVIATION null (verified:
    // DeMar DeRozan). Stamping null onto the card would be worse than keeping
    // the pool's real, if slightly stale, team. The personId is still good, and
    // it is what the headshot fallback needs.
    const freeAgent = [{ fullName: 'DeMar DeRozan', team: null, personId: 201942 }];
    const pool = [{ name: 'DeMar DeRozan', team: 'SAC' }];
    const { resolved, unresolved } = resolvePlayerTeams(pool, freeAgent, {});
    expect(unresolved).toHaveLength(0);
    expect(resolved[0]).toMatchObject({ team: 'SAC', personId: 201942 });
  });

  it('canonicalizes a pool-team fallback to nba.com spelling', () => {
    const pool = [{ name: 'Nobody At All', team: 'BRK' }];
    const { resolved } = resolvePlayerTeams(pool, roster, {});
    expect(resolved[0].team).toBe('BKN');
  });

  it('refuses to trust an ambiguous suffix-stripped match', () => {
    const collided = [
      { fullName: 'Gary Payton', team: 'SEA', personId: 1 },
      { fullName: 'Gary Payton II', team: 'GSW', personId: 2 },
    ];
    // Pool team is a multi-team code, so there's no safe fallback either.
    const pool = [{ name: 'Gary Payton II', team: '2TM' }];
    const { resolved, unresolved, stats } = resolvePlayerTeams(pool, collided, {});
    expect(resolved).toHaveLength(0);
    expect(unresolved).toEqual(['Gary Payton II']);
    expect(stats.ambiguous).toBe(1);
  });

  it('uses a manual override when the roster has no match', () => {
    const pool = [{ name: 'Russell Westbrook', team: 'SAC' }];
    const { resolved, unresolved } = resolvePlayerTeams(pool, roster, { 'Russell Westbrook': 'DEN' });
    expect(unresolved).toHaveLength(0);
    expect(resolved[0]).toMatchObject({ team: 'DEN', personId: null });
  });

  it('treats a null manual entry as "still needs a human", not as a team', () => {
    const pool = [{ name: 'Cam Thomas', team: '2TM' }];
    const { resolved, unresolved } = resolvePlayerTeams(pool, roster, { 'Cam Thomas': null });
    expect(resolved).toHaveLength(0);
    expect(unresolved).toEqual(['Cam Thomas']);
  });

  it('counts each resolution path separately', () => {
    const pool = [
      { name: 'James Harden', team: '2TM' },     // roster
      { name: 'Russell Westbrook', team: 'SAC' }, // pool fallback
      { name: 'Nobody At All', team: '3TM' },     // unresolved
      { name: 'Ghost Player', team: '2TM' },      // manual
    ];
    const { stats } = resolvePlayerTeams(pool, roster, { 'Ghost Player': 'MIA' });
    expect(stats).toMatchObject({ roster: 1, poolFallback: 1, manual: 1, unresolved: 1 });
  });

  it('leaves no multi-team code behind on any resolved player', () => {
    const pool = [
      { name: 'James Harden', team: '2TM' },
      { name: 'Russell Westbrook', team: 'SAC' },
      { name: 'Ghost Player', team: '3TM' },
    ];
    const { resolved } = resolvePlayerTeams(pool, roster, { 'Ghost Player': 'MIA' });
    expect(resolved.filter(p => isMultiTeamCode(p.team))).toHaveLength(0);
  });
});
