import { describe, it, expect } from 'vitest';
import {
  TEAMS,
  TEAM_ALIASES,
  HISTORICAL_TEAMS,
  WNBA_TEAMS,
  ACCENT_FALLBACK,
  canonicalTeam,
  canonicalTeamFor,
  getTeam,
  getThemedTeam,
  getWnbaTeam,
  leagueTeamCount,
  pickAccent,
  resolveAccent,
} from './teams.js';
import pool from '../../card-data/generated/player-pool-2026.json';
import wnbaPool from '../../card-data/generated/wnba-pool-2026.json';

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
    // The pool comes from Basketball-Reference; three dozen of its players carry
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
    // Dozens of players in the 2025-26 pool still carry these. They are bad data, not
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

  // The COUNTS here are deliberately not asserted: the pool grows whenever a
  // name is added to card-data/force-include-2026.json, and pinning "45" made
  // this test fail for the one reason that is not a bug. What matters is the
  // CLASSIFICATION — that the only unthemed players are the multi-team codes,
  // and that every Basketball-Reference spelling still finds its logo.
  it('leaves only the multi-team-code players unthemed', () => {
    expect(unresolved.length).toBeGreaterThan(0); // non-vacuous
    expect(new Set(unresolved.map(p => p.team))).toEqual(new Set(['2TM', '3TM']));
  });

  it('themes the players on Basketball-Reference-spelled teams', () => {
    const aliased = pool.filter(p => p.team in TEAM_ALIASES);
    expect(aliased.length).toBeGreaterThan(0);
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


describe('WNBA_TEAMS', () => {
  it('holds the fifteen franchises that played the 2026 season', () => {
    // FIFTEEN, not thirteen: Golden State joined in 2025, Portland and Toronto
    // in 2026. A table written from a 2024 memory would leave every Fire and
    // Tempo player on the neutral fallback.
    expect(Object.keys(WNBA_TEAMS)).toHaveLength(15);
    expect(Object.keys(WNBA_TEAMS)).toEqual(expect.arrayContaining(['GSV', 'POR', 'TOR']));
  });

  it('gives every team a name, a city and two colours', () => {
    for (const [abbr, team] of Object.entries(WNBA_TEAMS)) {
      expect(team.name, abbr).toBeTruthy();
      expect(team.city, abbr).toBeTruthy();
      expect(team.primary, abbr).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(team.secondary, abbr).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(team.league, abbr).toBe('WNBA');
    }
  });

  /**
   * TruColor's WNBA page, read on 2026-08-30, franchise by franchise.
   *
   * Colours #1 and #2 of each franchise's CURRENT era — the "through present"
   * block, which is the first one the page lists — under the same mechanical
   * rule the NBA table above was corrected with. Transcribed here rather than
   * left implicit in teams.js so the source and the table are two independent
   * statements that have to agree, which is the only way this test can catch a
   * hex being "improved" by hand later.
   *
   *   https://www.trucolor.net/portfolio/womens-national-basketball-association-official-colors-1997-through-present/
   *
   * Three of these are on an era that did not exist a season ago and that
   * recall would get wrong: Phoenix REBRANDED for 2026 (purple/orange, over the
   * 2015-2025 identity), and Portland and Toronto are 2026 expansion clubs with
   * no prior identity at all — Portland's is PINK, not the red a guess reaches
   * for. Note also that the page carries a SECOND, defunct "Portland Fire
   * (2000 through 2002)"; only the current-era block counts.
   */
  const TRUCOLOR = {
    ATL: ['#C8102E', '#373A36'], // Red, Dark Gray                 (2020-present)
    CHI: ['#418FDE', '#FFCD00'], // Sky Blue, Radiant Yellow       (2019-present)
    CON: ['#FC4C02', '#0C2340'], // Orange, Navy                   (2021-present)
    DAL: ['#C4D600', '#0C2340'], // Lime Green, Navy               (2021-present)
    GSV: ['#010101', '#AD96DC'], // Black, Valkyrie Violet         (2025-present)
    IND: ['#041E42', '#C8102E'], // Navy, Red                      (2019-present)
    LAS: ['#702F8A', '#FFC72C'], // Purple, Gold                   (2021-present)
    LVA: ['#010101', '#A7A8A9'], // Black, Silver                  (2024-present)
    MIN: ['#236192', '#0C2340'], // Lake Blue, Midnight Blue       (2018-present)
    NYL: ['#010101', '#6ECEB2'], // Black, Seafoam Green           (2020-present)
    PHO: ['#582C83', '#FC4C02'], // Purple, Orange                 (2026-present)
    POR: ['#E93CAC', '#C8102E'], // Pink, Red                      (2026-present)
    SEA: ['#2C5234', '#FBE122'], // Storm Green, Lightning Yellow  (2021-present)
    TOR: ['#612C51', '#B8CCEA'], // Bordeaux, Hydrogen Blue        (2026-present)
    WAS: ['#C8102E', '#0C2340'], // Red, Navy                      (2011-present)
  };

  it('takes every colour off TruColor, the same authority the NBA table uses', () => {
    // The NBA table was read off the authority the user chose; so is this one,
    // off that page's WNBA counterpart. The rule is mechanical on purpose —
    // official colours #1 and #2 of the current era, no judgement on top — so
    // that a surprising result is visibly the rule's answer rather than
    // somebody's taste.
    expect(Object.keys(TRUCOLOR).sort()).toEqual(Object.keys(WNBA_TEAMS).sort());
    for (const [abbr, [primary, secondary]] of Object.entries(TRUCOLOR)) {
      expect(WNBA_TEAMS[abbr].primary, abbr).toBe(primary);
      expect(WNBA_TEAMS[abbr].secondary, abbr).toBe(secondary);
    }
  });

  it('carries no unverified flag, unlike the historical NBA franchises', () => {
    // HISTORICAL_TEAMS is flagged because nothing checked it. These were
    // checked, so the absence of the flag is a claim — and a row that quietly
    // gained one would be a row somebody stopped standing behind.
    for (const [abbr, team] of Object.entries(WNBA_TEAMS)) {
      expect(team.unverifiedColors, abbr).toBeUndefined();
    }
    expect(HISTORICAL_TEAMS.SEA.unverifiedColors).toBe(true);
  });

  it('points every team at a logo file inside the WNBA\'s own directory', () => {
    // public/logos/ is a FLAT directory of NBA marks and nine of these
    // abbreviations mean an NBA franchise there. The subdirectory is what stops
    // a WNBA "PHO" from silently resolving to the Phoenix Suns' file — which
    // would not 404, and would look completely fine on the card.
    // logoFiles.test.js checks the files themselves exist and are usable.
    //
    // The file is {abbr}.png for thirteen of the fifteen, and the two
    // exceptions are exceptions for UNRELATED reasons:
    //
    //   CON  CONN.png, because "CON" is a reserved Windows device name and git
    //        cannot index a file called CON.png at all — see
    //        RESERVED_DEVICE_NAMES in teams.js, and the test that refuses a new
    //        one in logoFiles.test.js.
    //   TOR  TOR_ALT.png, a CONTRAST call rather than a filesystem one: the
    //        Tempo's primary mark is drawn in the team's own bordeaux and
    //        disappears on a bordeaux field. The alt is the same mark in
    //        Hydrogen Blue. TOR.png is still in the directory, unused.
    const EXCEPTIONS = { CON: 'CONN', TOR: 'TOR_ALT' };
    for (const [abbr, team] of Object.entries(WNBA_TEAMS)) {
      const expected = EXCEPTIONS[abbr] ?? abbr;
      expect(team.logo, abbr).toBe(`/logos/WNBA/${expected}.png`);
    }
  });

  it('stays out of TEAMS, which logoFiles.test.js requires a real file for', () => {
    for (const abbr of Object.keys(WNBA_TEAMS)) {
      const collides = Object.hasOwn(TEAMS, abbr);
      // Nine DO collide by abbreviation — that is exactly why they are a
      // separate table rather than extra rows.
      if (collides) expect(TEAMS[abbr].name).not.toBe(WNBA_TEAMS[abbr].name);
    }
    expect(Object.keys(TEAMS)).toHaveLength(30);
  });
});

describe('getTeam with a league', () => {
  it('answers with the WNBA franchise, not the NBA one that shares the code', () => {
    // The failure this prevents: an Atlanta Dream card themed as the Hawks.
    expect(getTeam('ATL', { league: 'WNBA' }).name).toBe('Dream');
    expect(getTeam('ATL').name).toBe('Hawks');
    expect(getTeam('PHO', { league: 'WNBA' }).name).toBe('Mercury');
    expect(getTeam('SEA', { league: 'WNBA' }).name).toBe('Storm');
    // SEA in the NBA table is the defunct SuperSonics, a different franchise.
    expect(getTeam('SEA').name).toBe('SuperSonics');
  });

  it('never falls through to an NBA team for an unknown WNBA code', () => {
    // Falling through would print the Boston Celtics on a card whose team the
    // data got wrong — wrong in a way that looks completely fine.
    expect(getTeam('BOS', { league: 'WNBA' }).name).toBe('Unknown');
    expect(getWnbaTeam('BOS')).toBeNull();
  });

  it('leaves every existing caller alone', () => {
    expect(getTeam('LAL').name).toBe('Lakers');
    expect(getTeam('BRK').name).toBe('Nets');
  });
});

describe('canonicalTeamFor', () => {
  it('is the key an override is written and read under', () => {
    // The studio's team editor derives this key to WRITE an override; the card
    // derives it to READ one. If the two disagreed, tuning a colour on a
    // Mercury card would save under "PHX" and the card would never show it.
    expect(canonicalTeamFor('PHO', { league: 'WNBA' })).toBe('PHO');
    expect(canonicalTeamFor('PHO')).toBe('PHX');
    const overrides = { PHO: { primary: '#123456' } };
    expect(getThemedTeam('PHO', overrides, { league: 'WNBA' }).primary).toBe('#123456');
    // And the NBA path is untouched: the same override keyed the NBA way.
    expect(getThemedTeam('PHO', { PHX: { primary: '#654321' } }).primary).toBe('#654321');
  });

  it('uppercases a WNBA code rather than leaving it as typed', () => {
    expect(canonicalTeamFor('lva', { league: 'WNBA' })).toBe('LVA');
    expect(canonicalTeamFor(null, { league: 'WNBA' })).toBe('');
  });
});

describe('leagueTeamCount', () => {
  it('is the denominator the team editor prints', () => {
    // "0 of 30 customised" under a WNBA card was wrong in a way nobody would
    // report, so the count follows the table the panel is actually editing.
    expect(leagueTeamCount('WNBA')).toBe(15);
    expect(leagueTeamCount('NBA')).toBe(30);
    expect(leagueTeamCount(undefined)).toBe(30);
  });
});

describe('getThemedTeam with a league', () => {
  it('does not run a WNBA code through the NBA alias map', () => {
    // TEAM_ALIASES maps Basketball-Reference's NBA spellings onto nba.com's.
    // 'PHO' -> 'PHX' would turn the Phoenix Mercury into the key of the Suns.
    expect(canonicalTeam('PHO')).toBe('PHX');
    expect(getThemedTeam('PHO', {}, { league: 'WNBA' }).name).toBe('Mercury');
  });

  it('applies an override under the WNBA key', () => {
    const themed = getThemedTeam('MIN', { MIN: { primary: '#123456' } }, { league: 'WNBA' });
    expect(themed.primary).toBe('#123456');
    expect(themed.name).toBe('Lynx');
  });
});

describe('the WNBA pool against this table', () => {
  it('resolves every carded player to a real franchise', () => {
    const unknown = [
      ...new Set(wnbaPool.map(p => p.team).filter(t => !getWnbaTeam(t))),
    ];
    expect(unknown).toEqual([]);
  });

  it('never leaves a carded player on the TOT aggregate code', () => {
    // TOT is not a team. A player who moved mid-season is resolved to the
    // franchise she played the most games for — see resolveDisplayTeams.
    expect(wnbaPool.filter(p => p.team === 'TOT')).toEqual([]);
  });
});
