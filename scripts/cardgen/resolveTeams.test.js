import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  canonicalTeam,
  resolvePlayerTeams,
  isMultiTeamCode,
  TEAM_ALIASES,
} from './resolveTeams.js';
import { TEAM_ALIASES as CARD_ALIASES, FREE_AGENT } from '../../src/cards/teams.js';

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

  // UNSIGNED (the user, 2026-10-14: "If they're unlisted, you can remove them
  // from their teams"). This used to keep the pool's team, which left a cut
  // player on the club that let him go (Batum on the Clippers, Aaron Holiday
  // on the Rockets).
  it('makes a player on no roster a free agent, not his old team', () => {
    const pool = [{ name: 'Russell Westbrook', team: 'SAC' }, { name: 'Nobody At All', team: '2TM' }];
    const { resolved, unresolved, stats } = resolvePlayerTeams(pool, roster, {});
    expect(unresolved).toHaveLength(0);
    expect(resolved.map(p => p.team)).toEqual([FREE_AGENT, FREE_AGENT]);
    expect(resolved[0].personId).toBeNull();
    expect(stats.freeAgent).toBe(2);
  });

  it('makes a player listed with a null team a free agent, keeping his personId', () => {
    // nba.com lists unsigned players with TEAM_ABBREVIATION null (verified:
    // DeMar DeRozan, 2026-08-29). The personId is still good, and it is what
    // the headshot fallback needs.
    const freeAgent = [{ fullName: 'DeMar DeRozan', team: null, personId: 201942 }];
    const pool = [{ name: 'DeMar DeRozan', team: 'SAC' }];
    const { resolved } = resolvePlayerTeams(pool, freeAgent, {});
    expect(resolved[0]).toMatchObject({ team: FREE_AGENT, personId: 201942 });
  });

  it('reads a name nba.com spells differently (Ron Holland is "Ronald Holland II")', () => {
    const pool = [{ name: 'Ron Holland', team: 'DET' }];
    const listed = [{ fullName: 'Ronald Holland II', team: 'DET', personId: 1641842 }];
    expect(resolvePlayerTeams(pool, listed, {}).resolved[0]).toMatchObject({ team: 'DET', personId: 1641842 });
  });

  it('refuses to trust an ambiguous suffix-stripped match', () => {
    const collided = [
      { fullName: 'Gary Payton', team: 'SEA', personId: 1 },
      { fullName: 'Gary Payton II', team: 'GSW', personId: 2 },
    ];
    // Two records fold onto his name, so "not found" proves nothing either:
    // he is neither placed nor made a free agent.
    const pool = [{ name: 'Gary Payton II', team: '2TM' }];
    const { resolved, unresolved, stats } = resolvePlayerTeams(pool, collided, {});
    expect(resolved).toHaveLength(0);
    expect(unresolved).toEqual(['Gary Payton II']);
    expect(stats.ambiguous).toBe(1);
  });

  it('lets a manual team win over the roster — an offseason trade the roster does not show (2026-09-18)', () => {
    const pool = [{ name: 'Kawhi Leonard', team: 'LAC' }];
    const roster = [{ fullName: 'Kawhi Leonard', team: 'LAC', personId: 202695 }];
    const { resolved, stats } = resolvePlayerTeams(pool, roster, { 'Kawhi Leonard': 'TOR' });
    expect(resolved[0]).toMatchObject({ team: 'TOR', personId: 202695 });
    expect(stats).toMatchObject({ manual: 1, roster: 0 });
    // A null entry is still "needs a human": the roster decides.
    expect(resolvePlayerTeams(pool, roster, { 'Kawhi Leonard': null }).resolved[0].team).toBe('LAC');
  });

  it('uses a manual override when the roster has no match', () => {
    const pool = [{ name: 'Russell Westbrook', team: 'SAC' }];
    const { resolved, unresolved } = resolvePlayerTeams(pool, roster, { 'Russell Westbrook': 'DEN' });
    expect(unresolved).toHaveLength(0);
    expect(resolved[0]).toMatchObject({ team: 'DEN', personId: null });
  });

  it('treats a null manual entry as no entry: the roster decides', () => {
    const pool = [{ name: 'Cam Thomas', team: '2TM' }];
    const { resolved, stats } = resolvePlayerTeams(pool, roster, { 'Cam Thomas': null });
    expect(resolved[0].team).toBe(FREE_AGENT);
    expect(stats.manual).toBe(0);
  });

  it('counts each resolution path separately', () => {
    const pool = [
      { name: 'James Harden', team: '2TM' },     // roster
      { name: 'Russell Westbrook', team: 'SAC' }, // free agent
      { name: 'Ghost Player', team: '2TM' },      // manual
    ];
    const { stats } = resolvePlayerTeams(pool, roster, { 'Ghost Player': 'MIA' });
    expect(stats).toMatchObject({ roster: 1, freeAgent: 1, manual: 1, unresolved: 0 });
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
