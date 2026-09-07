import { describe, it, expect } from 'vitest';
import {
  AWARDS,
  AWARD_CODES,
  AWARD_WIN_RANK,
  CHAMPION_CODE,
  MAX_CARD_AWARDS,
  orderAwardCodes,
  awardColors,
  awardImagePath,
  awardVars,
  awardsEarned,
  awardsWon,
  getAward,
  postSeasonAwardsEarned,
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
// THE TOKEN IS NOW READ RATHER THAN REFUSED, and the protection did not move an
// inch — it changed from "the parser cannot make sense of this" to "the parser
// knows exactly what this is, and it is not an MVP". The space is INSIDE the
// code: `Finals MVP-1` is the single code `Finals MVP` at rank 1, `codesIn`
// still splits on ',' ALONE, and `MVP` is not a token anywhere in that string.
//
// THREE SEPARATE THINGS KEEP IT HONEST and this is where all three are pinned,
// because none is obvious enough to survive a tidy-up unpinned:
//
//   The regular-season table still never carries it — `isolateTableBody` matches
//   `id="advanced"` INCLUDING the closing quote, so a request for `advanced` is
//   not a request for `advanced_post`. Pinned in sources/basketballReference.test.js.
//
//   The whole token is one code, below.
//
//   And the playoff column can earn NOTHING BUT this trophy, which is
//   `postSeason: true` and `postSeasonAwardsEarned`, also below.
describe('a compound award token', () => {
  it('reads `Finals MVP-1` as one code, with the space inside it', () => {
    // THE WHOLE PROTECTION, IN ONE ASSERTION. The code is `Finals MVP` — not
    // `Finals`, not `MVP`. If anyone is ever tempted to "tidy" the split in
    // `codesIn` into /[,\s]+/, or to let TOKEN match a suffix of its input,
    // these fail.
    expect(parseAwardToken('Finals MVP-1')).toEqual({ code: 'Finals MVP', rank: 1 });
    expect(awardsWon('Finals MVP-1')).toEqual(['Finals MVP']);
    expect(selectionsIn('Finals MVP-1')).toEqual([]);
    expect(awardsEarned('Finals MVP-1')).toEqual(['FMVP']);
  });

  it('still needs its -1, exactly as every other trophy does', () => {
    // Admitting the mark did not soften the rank rule for it. There is only ever
    // one Finals MVP so a `-2` has never been seen; the rule is uniform anyway,
    // because "the suffix is a finishing position" is a fact about the column
    // and not about any one award.
    expect(awardsEarned('Finals MVP-2')).toEqual([]);
    expect(awardsEarned('Finals MVP')).toEqual([]);
  });

  it('does not become a REGULAR-SEASON MVP mark beside a losing MVP finish', () => {
    // The failure in the shape it would actually take: a player who came fourth
    // in the regular-season voting and won the Finals MVP. He gets the Finals
    // MVP and emphatically not the MVP.
    expect(awardsEarned('MVP-4,Finals MVP-1')).toEqual(['FMVP']);
    expect(awardsEarned('MVP-4,Finals MVP-1')).not.toContain('MVP');
    // Brunson's real 2026 pair of strings, regular season and postseason, run
    // together. The All-Star selection and the Finals MVP; not the fifth-place
    // Clutch Player finish and not the All-NBA second team.
    expect(awardsEarned('CPOY-5,AS,NBA2,Finals MVP-1')).toEqual(['FMVP', 'AS']);
    expect(awardsEarned('Finals MVP-1,AS')).toEqual(['FMVP', 'AS']);
  });

  it('leaves the rest of the string alone', () => {
    // Both marks, in declared order, off one string — the case where a man wins
    // the MVP and the Finals MVP in the same season. Twelve have.
    expect(awardsEarned('MVP-1,Finals MVP-1')).toEqual(['MVP', 'FMVP']);
  });

  it('admits ONE space and not a run of whitespace', () => {
    // The scraped-string contract: a cell whose whitespace a site change has
    // mangled fails to parse and costs a card its mark, rather than being
    // guessed at. A tab or a newline is not a space.
    expect(parseAwardToken('Finals  MVP-1')).toBeNull();
    expect(parseAwardToken('Finals\tMVP-1')).toBeNull();
    expect(parseAwardToken('Finals\nMVP-1')).toBeNull();
  });
});

// ── THE PLAYOFF COLUMN'S ONE DOOR ───────────────────────────────────────────
//
// The generator reads two tables and the whole risk of that is the playoff one
// contributing something it should not. `postSeason: true` on the FMVP row is
// what makes "it can only ever add a Finals MVP" a rule instead of an
// observation about today's data.
describe('what the postseason column may earn', () => {
  it('keeps the Finals MVP and nothing else, whatever the string says', () => {
    expect(postSeasonAwardsEarned('Finals MVP-1')).toEqual(['FMVP']);
    // If Basketball-Reference ever started repeating the regular-season cell in
    // the playoff table, none of it would reach a card through this door.
    expect(postSeasonAwardsEarned('MVP-1,DPOY-1,AS,Finals MVP-1')).toEqual(['FMVP']);
    expect(postSeasonAwardsEarned('MVP-1,CPOY-1,AS')).toEqual([]);
    expect(postSeasonAwardsEarned(null)).toEqual([]);
  });

  it('is the only door that admits it, and the other one is not narrowed', () => {
    // ONE-DIRECTIONAL ON PURPOSE. The dangerous direction is the playoff column
    // producing a regular-season mark, and that is shut. The reverse is
    // harmless — the same man with the same trophy — so `awardsEarned` is not
    // made to refuse it, and a site reorganisation cannot cost a card the mark.
    expect(awardsEarned('Finals MVP-1')).toEqual(['FMVP']);
    // And no regular-season trophy can be smuggled through the playoff door by
    // spelling it like one.
    expect(postSeasonAwardsEarned('FMVP-1')).toEqual([]);
  });
});

// ── THE RING IS NOT IN THE STRING ───────────────────────────────────────────
describe('the externally-resolved championship mark', () => {
  it('cannot be earned by any awards string, however it is spelled', () => {
    // `external: true` is what makes this a rule rather than an accident of
    // Basketball-Reference's vocabulary. A token spelled CHAMP-1 would satisfy
    // the -1 rule exactly, and would hand the ring to the ten men who lost.
    for (const raw of ['CHAMP', 'CHAMP-1', 'MVP-1,CHAMP-1', 'CHAMP,AS']) {
      expect(awardsEarned(raw), raw).not.toContain(CHAMPION_CODE);
    }
    expect(awardsEarned('MVP-1,CHAMP-1')).toEqual(['MVP']);
    expect(awardsEarned('CHAMP,AS')).toEqual(['AS']);
  });

  it('orders into its declared place when the generator adds it', () => {
    // The generator holds two lists — what the string earned, and a ring it
    // resolved from a roster — and concatenating them would put the ring after
    // All-Star. `orderAwardCodes` is the one door to the declared order.
    expect(orderAwardCodes([...awardsEarned('MVP-1,AS,NBA1'), CHAMPION_CODE]))
      .toEqual(['MVP', 'CHAMP', 'AS']);
    expect(orderAwardCodes(['AS', 'CHAMP'])).toEqual(['CHAMP', 'AS']);
    // Uncapped, unlike pickAwards: the generated file has to record every mark
    // a card EARNED so that `capped` can count the ones the row cannot draw.
    expect(orderAwardCodes([...AWARD_CODES])).toHaveLength(AWARD_CODES.length);
    expect(orderAwardCodes([...AWARD_CODES]).length).toBeGreaterThan(MAX_CARD_AWARDS);
    // Filters to the declaration and deduplicates, like everything else here.
    expect(orderAwardCodes(['NBA1', 'CHAMP', 'CHAMP', 42, null])).toEqual(['CHAMP']);
    expect(orderAwardCodes('MVP')).toEqual([]);
    expect(orderAwardCodes(null)).toEqual([]);
  });
});

// ── THE DECLARATION ─────────────────────────────────────────────────────────
describe('the declared awards', () => {
  it('is the six voted trophies, Finals MVP, the ring and All-Star', () => {
    expect(AWARD_CODES).toEqual([
      'MVP', 'FMVP', 'DPOY', 'ROY', 'MIP', '6MOY', 'CPOY', 'CHAMP', 'AS',
    ]);
    // The four that stay out, named so this is a decision on the record rather
    // than an omission: All-NBA puts 15 more players on the list every season
    // and All-Defensive another 10, overlapping almost entirely with the
    // All-Star team that is already in. See the header of awards.js.
    for (const code of ['NBA1', 'NBA2', 'NBA3', 'DEF1', 'DEF2']) {
      expect(getAward(code), code).toBeNull();
    }
    // Exactly one row is a selection, and it is the one the user asked for.
    expect(getAward('AS')).toEqual({ code: 'AS', name: 'All-Star', selection: true });
    // And exactly one row declares a `token`, because exactly one code on
    // Basketball-Reference is not a bare initialism. A second row growing one
    // silently would mean a second string this file joins on.
    expect(AWARDS.filter(a => a.token).map(a => a.code)).toEqual(['FMVP']);
    expect(getAward('FMVP')).toEqual({
      code: 'FMVP',
      name: 'Finals MVP',
      token: 'Finals MVP',
      file: 'Finals_MVP',
      postSeason: true,
    });
    // The five plain rows declare nothing but a code and a name — a row says
    // only how it is unusual, and these are not.
    for (const code of ['MVP', 'DPOY', 'ROY', 'MIP', '6MOY', 'CPOY']) {
      expect(Object.keys(getAward(code)).sort(), code).toEqual(['code', 'name']);
    }
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

  it('caps at the row the wrapped block can hold, dropping the LEAST of them', () => {
    // FIVE marks do not fit — see MAX_CARD_AWARDS, which is four now that
    // .awards wraps at two rather than laying three across. What goes is the
    // bottom of the priority order, so the MVP is never the one dropped.
    const all = pickCodes([...AWARD_CODES]);
    expect(all).toHaveLength(MAX_CARD_AWARDS);
    expect(all).toEqual(['MVP', 'FMVP', 'DPOY', 'ROY']);
    expect(MAX_CARD_AWARDS).toBe(4);
  });

  it('keeps the Finals MVP over the ring it implies', () => {
    // EVERY Finals MVP holds the ring — he is on the winning team by
    // definition — so the two marks say overlapping things and one of them is
    // twenty times rarer. The order has to drop the ring first, or a capped row
    // would print the weaker half of the same fact. See AWARDS.
    expect(AWARD_CODES.indexOf('FMVP')).toBeLessThan(AWARD_CODES.indexOf('CHAMP'));
    expect(pickCodes(['MVP', 'DPOY', 'AS', 'CHAMP', 'FMVP'])).toEqual([
      'MVP', 'FMVP', 'DPOY', 'CHAMP',
    ]);
    // The real shape it takes: a Finals MVP who also made the All-Star team and
    // won the title prints all three, in that order, under the cap.
    expect(pickCodes(['AS', 'CHAMP', 'FMVP'])).toEqual(['FMVP', 'CHAMP', 'AS']);
  });

  it('drops ALL-STAR first when the cap bites, whatever else is on the card', () => {
    // The consequence of putting it last, stated as its own rule because it is
    // the reason the order was chosen. Every four-mark hand loses the All-Star
    // and keeps the three trophies — a card that won three things and made the
    // team prints the three it won.
    expect(pickCodes(['MVP', 'DPOY', 'ROY', 'MIP', 'AS'])).toEqual([
      'MVP', 'DPOY', 'ROY', 'MIP',
    ]);
    expect(pickCodes(['AS', 'MIP', '6MOY', 'CPOY', 'CHAMP'])).toEqual([
      'MIP', '6MOY', 'CPOY', 'CHAMP',
    ]);
    // And the RING goes second, never before a trophy: a five-mark hand loses
    // All-Star, a six-mark hand loses the ring too, and the four trophies stay.
    expect(pickCodes(['MVP', 'DPOY', 'ROY', 'MIP', 'CHAMP', 'AS'])).toEqual([
      'MVP', 'DPOY', 'ROY', 'MIP',
    ]);
    // Under the cap the ring prints, in its declared place.
    expect(pickCodes(['AS', 'CHAMP', 'MVP'])).toEqual(['MVP', 'CHAMP', 'AS']);
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
      const award = getAward(code);
      expect(awardImagePath(code), code).toBe(`/awards/${award.file ?? code}.png`);
    }
    // Seven of the eight are named by their code, because the code is
    // Basketball-Reference's spelling and the art is what gets renamed to match.
    for (const code of ['MVP', 'DPOY', 'ROY', 'MIP', '6MOY', 'CPOY', 'AS']) {
      expect(awardImagePath(code), code).toBe(`/awards/${code}.png`);
    }
    // The ring is the exception, and the only one: it comes out of no column, so
    // no external spelling constrains it and the user's own filename stands.
    expect(awardImagePath('CHAMP')).toBe('/awards/LarryOBrien.png');
  });

  it('never offers a WNBA card an NBA trophy, even as a fallback', () => {
    // The user's call: "for WNBA awards we don't have trophy photos for, just
    // add badges as placeholders." The two leagues' hardware is genuinely
    // different, so a shared file on a WNBA card is a false claim rather than a
    // stand-in — and it looks finished while making it. One candidate, no
    // fallback, and AssetImage lands on the lettered chip.
    for (const code of AWARD_CODES) {
      const paths = awardImagePath(code, 'WNBA');
      expect(Array.isArray(paths), code).toBe(true);
      expect(paths, code).toEqual([`/awards/wnba/${code}.png`]);
      for (const path of paths) {
        expect(path.startsWith('/awards/wnba/'), `${code} -> ${path}`).toBe(true);
      }
    }
  });

  it('names WNBA art by CODE, not by the filename the NBA set saved', () => {
    // `file` exists to honour filenames the user had already saved for the NBA
    // set. `/awards/wnba/LarryOBrien.png` would be an actively wrong name for a
    // trophy that is not the Larry O'Brien.
    expect(awardImagePath('CHAMP', 'WNBA')).toEqual(['/awards/wnba/CHAMP.png']);
    expect(awardImagePath('FMVP', 'WNBA')).toEqual(['/awards/wnba/FMVP.png']);
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
