import { describe, it, expect } from 'vitest';
import {
  AWARDS,
  AWARD_CODES,
  AWARD_WIN_RANK,
  MAX_CARD_AWARDS,
  awardColors,
  awardImagePath,
  awardVars,
  awardsEarned,
  awardsWon,
  getAward,
  selectionsIn,
  parseAwardToken,
  pickAwards,
} from './awards.js';
import { deriveFieldTheme, contrastRatio } from './fieldTheme.js';
import { AA_BODY } from './treatments.js';
import { TEAMS, resolveAccent } from './teams.js';

/** pickAwards, reduced to the codes it kept — what the card actually draws. */
const pickCodes = codes => pickAwards(codes).map(a => a.code);

// ── THE PARSING RULE ────────────────────────────────────────────────────────
//
// This is the half of the feature that can be wrong without looking wrong. Ten
// to fifteen players carry an `MVP-n` token every season and exactly one of
// them is the MVP; a reading that ignored the suffix would put a trophy on all
// of them and every card would still render, still look designed, and still be
// a lie. So the rule is tested against the real strings rather than against
// invented ones.
describe('the -1 rule', () => {
  it('reads only a first-place finish as a win', () => {
    expect(awardsWon('MVP-1')).toEqual(['MVP']);
    expect(awardsWon('MVP-2')).toEqual([]);
    expect(awardsWon('MVP-4')).toEqual([]);
    expect(awardsWon('MVP-10')).toEqual([]);
    expect(AWARD_WIN_RANK).toBe(1);
  });

  it("rejects Luka Dončić's MVP-4 — the case that would put a trophy on ten cards", () => {
    // His real 2025-26 row, verbatim off Basketball-Reference. He finished
    // FOURTH in the MVP voting and eighth in Clutch Player, made the All-Star
    // team and First Team All-NBA, and won nothing. Every one of those four
    // tokens has to come back empty, and for two different reasons: two are
    // losing ranks and two are selections.
    expect(awardsWon('MVP-4,CPOY-8,AS,NBA1')).toEqual([]);
  });

  it("reads Shai Gilgeous-Alexander's double, and only the two he won", () => {
    // The other real 2025-26 row. MVP and Clutch Player of the Year, plus an
    // All-Star selection and First Team All-NBA which are not wins.
    expect(awardsWon('MVP-1,CPOY-1,AS,NBA1')).toEqual(['MVP', 'CPOY']);
  });

  it('picks the win out of a row that is mostly near-misses', () => {
    // Victor Wembanyama's 2025-26: third in MVP voting, DPOY. The MVP token
    // comes FIRST in the string, so a parser that took the first token, or the
    // highest-profile code, or anything but the rank would get this wrong.
    expect(awardsWon('MVP-3,DPOY-1,AS,NBA1,DEF1')).toEqual(['DPOY']);
    // And LeBron's 2008-09, the same shape the other way up.
    expect(awardsWon('MVP-1,DPOY-2,AS,NBA1,DEF1')).toEqual(['MVP']);
  });

  it('never reads a SELECTION as a win, however many there are', () => {
    // No rank suffix means no finishing position means nothing was won. This is
    // what keeps All-Star and the All-NBA/All-Defensive teams out without a
    // second list of exclusions to maintain.
    expect(awardsWon('AS')).toEqual([]);
    expect(awardsWon('AS,NBA1,DEF1')).toEqual([]);
    expect(awardsWon('NBA1,NBA2,NBA3,DEF1,DEF2,AS')).toEqual([]);
  });

  it('survives anything that is not an awards string', () => {
    // It comes off a scraped page. A site change should cost a card its mark,
    // never take a generator down.
    for (const junk of ['', ' ', null, undefined, 42, {}, [], 'MVP-', '-1', 'MVP-1-2', ',,,']) {
      expect(() => awardsWon(junk), String(junk)).not.toThrow();
    }
    expect(awardsWon('MVP-')).toEqual([]);
    expect(awardsWon('-1')).toEqual([]);
    expect(awardsWon('MVP-1-2')).toEqual([]);
    // Whitespace around a token is Basketball-Reference's, not ours.
    expect(awardsWon(' MVP-1 , CPOY-1 ')).toEqual(['MVP', 'CPOY']);
  });

  it('parses the two token shapes and nothing else', () => {
    expect(parseAwardToken('MVP-1')).toEqual({ code: 'MVP', rank: 1 });
    expect(parseAwardToken('6MOY-12')).toEqual({ code: '6MOY', rank: 12 });
    expect(parseAwardToken('NBA1')).toEqual({ code: 'NBA1', rank: null });
    expect(parseAwardToken('')).toBeNull();
    expect(parseAwardToken('MVP-x')).toBeNull();
  });

  it('deduplicates rather than repeating a code', () => {
    // The generator unions a traded player's rows, so a repeated token is
    // reachable data even though no season produces one today.
    expect(awardsWon('MVP-1,MVP-1')).toEqual(['MVP']);
  });

  it('reads the selections out separately, and prints none of them', () => {
    // The other half of the same string, parsed without consulting the
    // declaration — which is what makes admitting one a row in AWARDS rather
    // than a second parser. Nothing declares a selection today, so nothing this
    // half finds reaches a card.
    expect(selectionsIn('MVP-1,CPOY-1,AS,NBA1')).toEqual(['AS', 'NBA1']);
    expect(selectionsIn('MVP-4')).toEqual([]);
    expect(awardsEarned('AS,NBA1,DEF1')).toEqual([]);
  });

  it('joins the two halves to the declaration, and only there', () => {
    // awardsEarned is the ONE function that knows both the syntax and the
    // declaration. A ranked award needs its -1; a declared selection would need
    // only to be present; nothing else earns a mark.
    expect(awardsEarned('MVP-1,CPOY-1,AS,NBA1')).toEqual(['MVP', 'CPOY']);
    expect(awardsEarned('MVP-4,CPOY-8,AS,NBA1')).toEqual([]);
    // Priority order, not the order the site listed them in.
    expect(awardsEarned('CPOY-1,MVP-1')).toEqual(['MVP', 'CPOY']);
    // Undeclared codes never earn one, whichever shape they are.
    expect(awardsEarned('NBA1,DEF1,AS')).toEqual([]);
    for (const junk of ['', null, undefined, 42, {}]) {
      expect(awardsEarned(junk), String(junk)).toEqual([]);
    }
  });

  it('would take a declared selection on presence alone', () => {
    // The `selection` flag's whole contract, asserted through the real function
    // on a hypothetical declaration — so that the day somebody adds
    // `{ code: 'AS', name: 'All-Star', selection: true }` they are adding one
    // row and not a parsing rule. Nothing declares one today.
    expect(AWARDS.some(a => a.selection)).toBe(false);
    AWARDS.push({ code: 'AS', name: 'All-Star', selection: true });
    try {
      expect(awardsEarned('MVP-4,CPOY-8,AS,NBA1')).toEqual(['AS']);
      expect(awardsEarned('MVP-1,AS')).toEqual(['MVP', 'AS']);
      // And it is still not a WIN — the fact and the decision stay apart.
      expect(awardsWon('MVP-1,AS')).toEqual(['MVP']);
    } finally {
      AWARDS.pop();
    }
    expect(awardsEarned('MVP-1,AS')).toEqual(['MVP']);
  });
});

// ── THE DECLARATION ─────────────────────────────────────────────────────────
describe('the declared awards', () => {
  it('is the six voted trophies, and no selections', () => {
    expect(AWARD_CODES).toEqual(['MVP', 'DPOY', 'ROY', 'MIP', '6MOY', 'CPOY']);
    // The selections, named so this is a decision on the record rather than an
    // omission: none of them has a single winner to rank against, and each puts
    // 10-30 players on the list every season.
    for (const code of ['AS', 'NBA1', 'NBA2', 'NBA3', 'DEF1', 'DEF2']) {
      expect(getAward(code), code).toBeNull();
    }
  });

  it('orders by standing, MVP first', () => {
    expect(AWARD_CODES[0]).toBe('MVP');
    expect(AWARD_CODES.indexOf('DPOY')).toBeLessThan(AWARD_CODES.indexOf('6MOY'));
    expect(AWARD_CODES.indexOf('ROY')).toBeLessThan(AWARD_CODES.indexOf('CPOY'));
  });

  it('names every one of them, for the studio and for a reader', () => {
    for (const award of AWARDS) {
      expect(award.name, award.code).toMatch(/^[A-Z]/);
      expect(award.name.length, award.code).toBeGreaterThan(award.code.length);
    }
  });

  it('looks up own properties only, never the prototype', () => {
    expect(getAward('constructor')).toBeNull();
    expect(getAward('toString')).toBeNull();
    expect(getAward('__proto__')).toBeNull();
  });
});

// ── WHAT A CARD PRINTS ──────────────────────────────────────────────────────
describe('the marks a card prints', () => {
  it('orders by importance rather than by the order the data listed them', () => {
    expect(pickCodes(['CPOY', 'MVP'])).toEqual(['MVP', 'CPOY']);
    expect(pickCodes(['6MOY', 'ROY', 'DPOY'])).toEqual(['DPOY', 'ROY', '6MOY']);
  });

  it('caps at the row the 135px bar can hold, dropping the LEAST of them', () => {
    // Four marks do not fit — see MAX_CARD_AWARDS. What goes is the bottom of
    // the priority order, so the MVP is never the one dropped.
    const all = pickCodes([...AWARD_CODES]);
    expect(all).toHaveLength(MAX_CARD_AWARDS);
    expect(all).toEqual(['MVP', 'DPOY', 'ROY']);
    expect(MAX_CARD_AWARDS).toBe(3);
  });

  it('ignores a code this build does not declare, rather than throwing', () => {
    // A data file naming an award this build has never heard of should cost
    // that card a mark, not take the studio down. Same contract as pickBadge.
    expect(pickCodes(['AS', 'NBA1', 'MVP'])).toEqual(['MVP']);
    expect(pickCodes(['nonsense'])).toEqual([]);
    expect(pickCodes(['constructor'])).toEqual([]);
  });

  it('answers nothing for nothing', () => {
    expect(pickCodes([])).toEqual([]);
    expect(pickCodes(null)).toEqual([]);
    expect(pickCodes(undefined)).toEqual([]);
    expect(pickCodes('MVP')).toEqual([]);
    expect(pickCodes([null, 7, {}])).toEqual([]);
  });

  it('deduplicates', () => {
    expect(pickCodes(['MVP', 'MVP', 'MVP'])).toEqual(['MVP']);
  });
});

// ── THE ART, AND THE ABSENCE OF IT ──────────────────────────────────────────
describe('award art', () => {
  it('resolves every declared code into public/awards/', () => {
    for (const code of AWARD_CODES) {
      expect(awardImagePath(code), code).toBe(`/awards/${code}.png`);
    }
  });

  it('resolves an undeclared code to nothing, never to a guessed path', () => {
    // A path is a request. Inventing one for a code this build does not declare
    // would put a 404 on the card in place of a fallback that was designed.
    expect(awardImagePath('AS')).toBeNull();
    expect(awardImagePath('constructor')).toBeNull();
    expect(awardImagePath(null)).toBeNull();
  });

  it('is bare and root-relative, so Node and the browser read the same string', () => {
    // Same rule as a team's `logo` in teams.js: CardTemplate runs it through
    // logoSrc to pick up the app's base path, and nothing here may assume one.
    for (const code of AWARD_CODES) {
      expect(awardImagePath(code).startsWith('/')).toBe(true);
      expect(awardImagePath(code)).not.toMatch(/^https?:|^\.\.?\//);
    }
  });
});

// ── THE CHIP'S COLOURS ──────────────────────────────────────────────────────
describe('the lettered chip', () => {
  it('reads on every stock team, because it is the BEST SEASON pill', () => {
    // No new colour is invented — the fill is the team accent deriveFieldTheme
    // already cleared, and the ink is pickInkFor of it. treatments.test.js
    // sweeps the same pair over all 37 franchises and every treatment; this is
    // the unit-level statement of the same fact.
    for (const [abbr, team] of Object.entries(TEAMS)) {
      const theme = deriveFieldTheme(team.primary, team.secondary, resolveAccent(team));
      const { fill, ink } = awardColors(theme);
      expect(fill, abbr).toBe(theme.accentOnField);
      expect(contrastRatio(ink, fill), `${abbr} award code`).toBeGreaterThanOrEqual(AA_BODY);
    }
  });

  it('emits no properties at all for a card with no marks', () => {
    // Same contract badgeVars keeps: a card without the feature carries nothing
    // of it, so the stylesheet's var() fallbacks stay unreached.
    const theme = deriveFieldTheme('#007A33', '#BA9653', '#FFFFFF');
    expect(awardVars(theme, [])).toEqual({});
    expect(awardVars(theme, null)).toEqual({});
    expect(awardVars(null, [{ code: 'MVP' }])).toEqual({});
  });

  it('emits both colours as plain hex when there are marks', () => {
    const theme = deriveFieldTheme('#007A33', '#BA9653', '#FFFFFF');
    const vars = awardVars(theme, [{ code: 'MVP' }]);
    expect(vars['--award-fill']).toMatch(/^#[0-9A-F]{6}$/i);
    expect(vars['--award-ink']).toMatch(/^#[0-9A-F]{6}$/i);
  });
});
