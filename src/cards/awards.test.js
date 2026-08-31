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

  it('reads the selections out separately, declaration or no declaration', () => {
    // The other half of the same string, parsed WITHOUT consulting the
    // declaration — which is what made admitting All-Star a row in AWARDS
    // rather than a second parser. All five come back here; only the declared
    // one reaches a card, and that filtering happens in awardsEarned.
    expect(selectionsIn('MVP-1,CPOY-1,AS,NBA1')).toEqual(['AS', 'NBA1']);
    expect(selectionsIn('MVP-4')).toEqual([]);
    expect(selectionsIn('AS,NBA1,NBA2,NBA3,DEF1,DEF2')).toEqual([
      'AS',
      'NBA1',
      'NBA2',
      'NBA3',
      'DEF1',
      'DEF2',
    ]);
  });

  it('joins the two halves to the declaration, and only there', () => {
    // awardsEarned is the ONE function that knows both the syntax and the
    // declaration. A ranked award needs its -1; a declared selection needs only
    // to be present; nothing else earns a mark.
    expect(awardsEarned('MVP-1,CPOY-1,AS,NBA1')).toEqual(['MVP', 'CPOY', 'AS']);
    // Priority order, not the order the site listed them in — and All-Star
    // sorts LAST however early the site printed it.
    expect(awardsEarned('CPOY-1,MVP-1')).toEqual(['MVP', 'CPOY']);
    expect(awardsEarned('AS,CPOY-1,MVP-1')).toEqual(['MVP', 'CPOY', 'AS']);
    // The four UNDECLARED selections never earn a mark, and neither does a
    // losing rank, so a row of nothing but those is a row of nothing.
    expect(awardsEarned('NBA1,NBA2,NBA3,DEF1,DEF2')).toEqual([]);
    expect(awardsEarned('MVP-4,CPOY-8,NBA1,DEF1')).toEqual([]);
    for (const junk of ['', null, undefined, 42, {}]) {
      expect(awardsEarned(junk), String(junk)).toEqual([]);
    }
  });

  it("gives Luka Dončić an All-Star mark and STILL no MVP, off one row", () => {
    // THE RECORD THE WHOLE CHANGE IS JUDGED ON, and both halves are asserted
    // together on purpose: admitting a selection is only safe if it left the
    // -1 rule untouched, and the way to show that is one string that exercises
    // both shapes at once. His real 2025-26 row — fourth in MVP voting, eighth
    // in Clutch Player, All-Star, First Team All-NBA.
    const LUKA = 'MVP-4,CPOY-8,AS,NBA1';
    expect(awardsEarned(LUKA)).toEqual(['AS']);
    // Not the MVP, not the CPOY, and not the All-NBA either.
    expect(awardsEarned(LUKA)).not.toContain('MVP');
    expect(awardsEarned(LUKA)).not.toContain('CPOY');
    expect(awardsEarned(LUKA)).not.toContain('NBA1');
    // And the All-Star mark is still NOT A WIN. The fact and the decision stay
    // apart: awardsWon answers "what did he win" and the answer is nothing.
    expect(awardsWon(LUKA)).toEqual([]);
    // The same row with the MVP actually won — Shai's 2025-26 — for contrast,
    // so the difference between the two really is the suffix.
    expect(awardsEarned('MVP-1,CPOY-1,AS,NBA1')).toEqual(['MVP', 'CPOY', 'AS']);
  });

  it('takes a declared selection on presence alone, and nothing else does', () => {
    // The `selection` flag's contract, now that a row uses it. A selection is
    // HELD rather than WON, so presence is the whole test for it — and the
    // trophies are unaffected, which is the property that has to hold for the
    // flag to have been a safe door to open.
    expect(getAward('AS').selection).toBe(true);
    expect(AWARDS.filter(a => a.selection).map(a => a.code)).toEqual(['AS']);
    expect(awardsEarned('AS')).toEqual(['AS']);
    // A trophy with no rank at all is NOT a win, flag or no flag: the six
    // voted rows carry no `selection`, so a bare `MVP` earns nothing.
    expect(awardsEarned('MVP')).toEqual([]);
    expect(awardsEarned('MVP,DPOY,ROY,MIP,6MOY,CPOY')).toEqual([]);
    // …and a RANKED All-Star token is not a thing Basketball-Reference writes,
    // but if it ever were, the selection rule reads presence and would still
    // want the bare token. `AS-1` is a token with a rank, so selectionsIn does
    // not see it and no mark is earned — a shape change would fail here rather
    // than quietly marking every All-Star ballot.
    expect(awardsEarned('AS-1')).toEqual([]);
  });
});

// ── THE COMPOUND TOKEN ──────────────────────────────────────────────────────
//
// `Finals MVP-1` IS A REAL STRING ON BASKETBALL-REFERENCE. Verified live
// against NBA_2026_advanced.html: it sits in the awards cell of Jalen
// Brunson's row in `<table id="advanced_post">`, the PLAYOFF table, as
// `<b><a href="/awards/finals_mvp.html">Finals MVP-1</a></b>`.
//
// It is the one string on the site that could put a REGULAR-SEASON MVP MARK ON
// A FINALS MVP, because it ends in `-1` and the `-1` rule is the whole of what
// earns a trophy. A splitter that broke tokens on `[,\s]+` would yield
// `Finals` and `MVP-1`, and the second of those is indistinguishable from the
// real thing.
//
// TWO SEPARATE THINGS STOP IT and this is where both are pinned, because
// neither is obvious enough to survive a tidy-up unpinned:
//
//   parseSeasonTableHtml never reads that table — `isolateTableBody` matches
//   `id="advanced"` INCLUDING the closing quote, so `advanced_post` is not a
//   match. That half is pinned in sources/basketballReference.test.js.
//
//   And this file's parser would refuse the token anyway, which is the half
//   below. It is the one that matters if the scoping ever fails.
describe('a compound award token', () => {
  it('refuses `Finals MVP-1` rather than reading an MVP out of it', () => {
    // The space is what does it: `codesIn` splits on ',' ALONE, and TOKEN then
    // requires the whole token to be [A-Za-z0-9]+ with an optional -{digits}.
    // If anyone is ever tempted to "tidy" that split into /[,\s]+/, this fails.
    expect(parseAwardToken('Finals MVP-1')).toBeNull();
    expect(awardsWon('Finals MVP-1')).toEqual([]);
    expect(selectionsIn('Finals MVP-1')).toEqual([]);
    expect(awardsEarned('Finals MVP-1')).toEqual([]);
  });

  it('does not let it become an MVP mark beside a losing MVP finish', () => {
    // The failure in the shape it would actually take: a player who came fourth
    // in the regular-season voting and won the Finals MVP. Neither token earns
    // a trophy, so neither does the pair.
    expect(awardsEarned('MVP-4,Finals MVP-1')).toEqual([]);
    // Brunson's real 2026 pair of strings, regular season and postseason, run
    // together. The All-Star selection is earned; nothing else is.
    expect(awardsEarned('CPOY-5,AS,NBA2,Finals MVP-1')).toEqual(['AS']);
    expect(awardsEarned('Finals MVP-1,AS')).toEqual(['AS']);
  });

  it('leaves the rest of the string alone, rather than dropping it', () => {
    // A token it cannot parse costs that token its mark and nothing else — the
    // scraped-string contract in the header. A site change must not silently
    // strip a card of the trophy it did win.
    expect(awardsEarned('MVP-1,Finals MVP-1')).toEqual(['MVP']);
  });
});

// ── THE DECLARATION ─────────────────────────────────────────────────────────
describe('the declared awards', () => {
  it('is the six voted trophies plus All-Star, and no other selection', () => {
    expect(AWARD_CODES).toEqual(['MVP', 'DPOY', 'ROY', 'MIP', '6MOY', 'CPOY', 'AS']);
    // The four that stay out, named so this is a decision on the record rather
    // than an omission: All-NBA puts 15 more players on the list every season
    // and All-Defensive another 10, overlapping almost entirely with the
    // All-Star team that is already in. See the header of awards.js.
    for (const code of ['NBA1', 'NBA2', 'NBA3', 'DEF1', 'DEF2']) {
      expect(getAward(code), code).toBeNull();
    }
    // Exactly one row is a selection, and it is the one the user asked for.
    expect(getAward('AS')).toEqual({ code: 'AS', name: 'All-Star', selection: true });
  });

  it('orders by standing, MVP first and All-Star last', () => {
    expect(AWARD_CODES[0]).toBe('MVP');
    expect(AWARD_CODES.indexOf('DPOY')).toBeLessThan(AWARD_CODES.indexOf('6MOY'));
    expect(AWARD_CODES.indexOf('ROY')).toBeLessThan(AWARD_CODES.indexOf('CPOY'));
    // LAST, and it has to be: 24+ players hold it every season against one for
    // each of the six above, so it is the least distinguishing mark on the
    // list — which is also what makes it the first the cap drops.
    expect(AWARD_CODES.at(-1)).toBe('AS');
    for (const code of AWARD_CODES) {
      if (code === 'AS') continue;
      expect(AWARD_CODES.indexOf(code), code).toBeLessThan(AWARD_CODES.indexOf('AS'));
    }
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

  it('drops ALL-STAR first when the cap bites, whatever else is on the card', () => {
    // The consequence of putting it last, stated as its own rule because it is
    // the reason the order was chosen. Every four-mark hand loses the All-Star
    // and keeps the three trophies — a card that won three things and made the
    // team prints the three it won.
    expect(pickCodes(['MVP', 'DPOY', 'ROY', 'AS'])).toEqual(['MVP', 'DPOY', 'ROY']);
    expect(pickCodes(['AS', 'MIP', '6MOY', 'CPOY'])).toEqual(['MIP', '6MOY', 'CPOY']);
    // Under the cap it stays, and stays at the end.
    expect(pickCodes(['AS', 'MVP'])).toEqual(['MVP', 'AS']);
    expect(pickCodes(['AS', 'CPOY', 'MVP'])).toEqual(['MVP', 'CPOY', 'AS']);
  });

  it('ignores a code this build does not declare, rather than throwing', () => {
    // A data file naming an award this build has never heard of should cost
    // that card a mark, not take the studio down. Same contract as pickBadge.
    expect(pickCodes(['NBA1', 'DEF1', 'MVP'])).toEqual(['MVP']);
    // All-Star IS declared now, so it survives the same filter the other four
    // selections do not.
    expect(pickCodes(['AS', 'NBA1', 'MVP'])).toEqual(['MVP', 'AS']);
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
    for (const code of ['NBA1', 'NBA2', 'NBA3', 'DEF1', 'DEF2']) {
      expect(awardImagePath(code), code).toBeNull();
    }
    expect(awardImagePath('constructor')).toBeNull();
    expect(awardImagePath(null)).toBeNull();
  });

  it('names the All-Star file by its CODE, which is the side of the join that is fixed', () => {
    // The user's file is called "All-Star". The card asks for AS, because the
    // code is what Basketball-Reference writes and what every other row here is
    // spelled as — so the art is what gets renamed, not the declaration.
    expect(awardImagePath('AS')).toContain('/awards/AS');
    expect(awardImagePath('AS')).not.toContain('All-Star');
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
