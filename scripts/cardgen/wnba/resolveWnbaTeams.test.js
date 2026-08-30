import { describe, it, expect } from 'vitest';
import { indexRoster, normalizeWnbaName, resolveWnbaTeams } from './resolveWnbaTeams.js';
import { WNBA_TEAMS } from '../../../src/cards/teams.js';
import pool from '../../../card-data/generated/wnba-pool-2026.json';

const rec = (fullName, team) => ({ fullName, team, personId: 1 });

describe('normalizeWnbaName', () => {
  it('folds the things the two sources actually disagree about', () => {
    expect(normalizeWnbaName("Ta'Niya Latson")).toBe('taniyalatson');
    expect(normalizeWnbaName('TA’NIYA LATSON')).toBe('taniyalatson');
    expect(normalizeWnbaName('Leonie Fiebich')).toBe(normalizeWnbaName('Leoníe Fiebich'));
    expect(normalizeWnbaName('Betnijah Laney-Hamilton')).toBe('betnijahlaneyhamilton');
  });

  it('does NOT strip a generational suffix, unlike the NBA rule', () => {
    // resolveTeams.js strips them because nba.com and Basketball-Reference
    // disagree constantly about "Jr."/"III". The WNBA feeds do not, and a strip
    // can only ever collapse two real people onto one key.
    expect(normalizeWnbaName('X Y Jr.')).not.toBe(normalizeWnbaName('X Y'));
  });
});

describe('indexRoster', () => {
  it('refuses a name two players share rather than picking one', () => {
    const { byName, ambiguous } = indexRoster([rec('A Smith', 'LAS'), rec('A Smith', 'MIN')]);
    expect(ambiguous.has('asmith')).toBe(true);
    expect(byName.has('asmith')).toBe(false);
  });
});

describe('resolveWnbaTeams', () => {
  const splits = [
    { playerId: 'plumke01w', team: 'TOT', games: 17, minutes: 519 },
    { playerId: 'plumke01w', team: 'LAS', games: 12, minutes: 414 },
    { playerId: 'plumke01w', team: 'PHO', games: 5, minutes: 105 },
    { playerId: 'bonnede01w', team: 'PHO', games: 37, minutes: 1021 },
    { playerId: 'smithna01w', team: 'LVA', games: 38, minutes: 923 },
  ];
  const rows = [
    { name: 'Kelsey Plum', playerId: 'plumke01w', team: 'TOT' },
    { name: 'DeWanna Bonner', playerId: 'bonnede01w', team: 'PHO' },
    { name: 'NaLyssa Smith', playerId: 'smithna01w', team: 'LVA' },
  ];

  it('puts a TOT player on the team the live roster says she is on', () => {
    // THE REPORTED BUG, end to end: Kelsey Plum is a Phoenix Mercury player and
    // her stat row says TOT. wnba.com spells it PHX; the card set spells it PHO.
    const { teamOf, stats } = resolveWnbaTeams({
      rows,
      splits,
      roster: [rec('Kelsey Plum', 'PHX')],
    });
    expect(teamOf.get('plumke01w')).toBe('PHO');
    expect(stats.roster).toBe(1);
  });

  it('trusts the roster over a stat row that already names a real team', () => {
    // Bonner played all 37 of her 2026 games for Phoenix and is on Atlanta now.
    // Reported as an offSeasonMove so the two kinds of change stay separable.
    const { teamOf, changes } = resolveWnbaTeams({
      rows,
      splits,
      roster: [rec('DeWanna Bonner', 'ATL')],
    });
    expect(teamOf.get('bonnede01w')).toBe('ATL');
    expect(changes.find(c => c.name === 'DeWanna Bonner')).toMatchObject({
      from: 'PHO',
      to: 'ATL',
      path: 'roster',
      offSeasonMove: true,
    });
  });

  it('keeps a real stat-row team when the roster carries a NULL one', () => {
    // An unsigned player is in the feed with every team field null. Stamping
    // that null onto a card as if it were a franchise would be worse than
    // keeping a real, stale team.
    const { teamOf, changes } = resolveWnbaTeams({
      rows,
      splits,
      roster: [rec('NaLyssa Smith', null)],
    });
    expect(teamOf.get('smithna01w')).toBe('LVA');
    // And it counts as no change at all, not as a resolution.
    expect(changes.map(c => c.name)).not.toContain('NaLyssa Smith');
  });

  it('falls back to the LAST stint when the roster cannot help at all', () => {
    const { teamOf, stats, changes } = resolveWnbaTeams({ rows, splits, roster: [] });
    expect(teamOf.get('plumke01w')).toBe('PHO');
    expect(stats.lastStint).toBe(1);
    expect(changes.find(c => c.name === 'Kelsey Plum')).toMatchObject({
      from: 'TOT',
      to: 'PHO',
      path: 'lastStint',
      offSeasonMove: false,
    });
  });

  it('reports a player it cannot place instead of guessing', () => {
    // No roster record and no split rows: TOT is all there is, and a guess here
    // prints the wrong logo on a card that looks perfectly fine.
    const { unresolved, teamOf } = resolveWnbaTeams({
      rows: [{ name: 'Ghost Player', playerId: 'ghostgh01w', team: 'TOT' }],
      splits: [],
      roster: [],
    });
    expect(unresolved).toEqual([
      { name: 'Ghost Player', playerId: 'ghostgh01w', statRow: 'TOT' },
    ]);
    // Kept in the output on her aggregate code — a grey card is a visible
    // problem, a missing player is not.
    expect(teamOf.get('ghostgh01w')).toBe('TOT');
  });

  it('demotes an ambiguous name to the split rows rather than guessing', () => {
    const { teamOf, stats } = resolveWnbaTeams({
      rows: [{ name: 'Kelsey Plum', playerId: 'plumke01w', team: 'TOT' }],
      splits,
      roster: [rec('Kelsey Plum', 'LVA'), rec('Kelsey Plum', 'SEA')],
    });
    expect(stats.ambiguous).toBe(1);
    expect(teamOf.get('plumke01w')).toBe('PHO');
  });
});

describe('the generated pool this produced', () => {
  it('leaves nobody on an aggregate code', () => {
    expect(pool.filter(p => /^(TOT|\dTM)$/.test(p.team))).toEqual([]);
  });

  it('places every carded player on a 2026 franchise', () => {
    const unknown = [...new Set(pool.map(p => p.team))].filter(t => !Object.hasOwn(WNBA_TEAMS, t));
    expect(unknown).toEqual([]);
  });

  it('has Kelsey Plum on Phoenix', () => {
    // The user's own example, pinned against the shipped file rather than
    // against a fixture — this is the assertion that would have caught it.
    expect(pool.find(p => p.name === 'Kelsey Plum').team).toBe('PHO');
  });
});
