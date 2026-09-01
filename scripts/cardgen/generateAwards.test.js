import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  AWARDS_CACHE_KEY,
  AWARDS_TABLE,
  CHAMPION_CACHE_KEY,
  championIndex,
  countAwards,
  extractAwards,
  joinById,
  joinByName,
  loadSeasonAwards,
  seasonsNeeded,
  statsSeasonEndYear,
} from './generateAwards.js';
import { SEASON_TABLES } from './sources/basketballReference.js';
import { normalizeName } from './resolveTeams.js';
import { AWARD_CODES, MAX_CARD_AWARDS } from '../../src/cards/awards.js';
import { CURRENT_SET, ROOKIE_SET, SUPER_SEASON_SET,
  SUMMER_STANDOUTS_SET, WNBA_SET } from '../../src/cards/sets.js';

const generated = name =>
  JSON.parse(readFileSync(new URL(`../../card-data/generated/${name}`, import.meta.url), 'utf8'));

const AWARDS = generated('card-awards.json');

/**
 * card-data/cache is GITIGNORED — it is a bulk copy of Basketball-Reference's
 * tables and this repo is public — so the one test that reads it runs only
 * where the generator has actually been run. Same treatment
 * generateSpecialSets.test.js gives the history archive.
 */
const CACHED_2026 = existsSync(
  new URL('../../card-data/cache/bbref-2026-awards.json', import.meta.url)
);

/** A parsed season-table row, in the shape parseSeasonTableHtml returns. */
const row = (playerId, name, awards) => ({ playerId, name, cells: { awards } });

describe('reading the awards column off a season table', () => {
  it('keeps only the players who have one', () => {
    const rows = [
      row('gilgesh01', 'Shai Gilgeous-Alexander', 'MVP-1,CPOY-1,AS,NBA1'),
      row('nobodyx01', 'A Nobody', ''),
      row('nobodyy01', 'Another Nobody', undefined),
    ];
    expect(extractAwards(rows)).toEqual([
      { playerId: 'gilgesh01', name: 'Shai Gilgeous-Alexander', awards: 'MVP-1,CPOY-1,AS,NBA1' },
    ]);
  });

  it('unions a traded player rather than taking whichever row came first', () => {
    // A traded player has a combined 2TM row and one per team. No season today
    // repeats the awards cell across them — this is the guard for the day one
    // does, because taking the first row would silently drop the other half.
    const rows = [
      row('somebo01', 'Somebody', 'MIP-1'),
      row('somebo01', 'Somebody', 'MIP-1,AS'),
    ];
    expect(extractAwards(rows)).toEqual([
      { playerId: 'somebo01', name: 'Somebody', awards: 'MIP-1,AS' },
    ]);
  });

  it('reads one named table, so two tables cannot disagree', () => {
    expect(AWARDS_TABLE).toBe('advanced');
    expect(SEASON_TABLES[AWARDS_TABLE]).toBeDefined();
  });

  it('caches under a key of its own, never over an existing normalizer', () => {
    // cache.js's invalidation rule is "delete the file when the parser changes".
    // Widening bbref-{season}-advanced-full would have made twenty-seven
    // committed files stale at once; a new key invalidates nothing.
    expect(AWARDS_CACHE_KEY(2026)).toBe('bbref-2026-awards');
    expect(AWARDS_CACHE_KEY(2026)).not.toContain('advanced');
  });

  it.runIf(CACHED_2026)('asks the site nothing when the season is already cached', async () => {
    // Every season this build needs is committed, so the generator is offline
    // after the first run. A fetch here would be a regression in politeness as
    // much as in speed.
    const explode = () => {
      throw new Error('fetched a season that was already cached');
    };
    const rows = await loadSeasonAwards(2026, { fetchImpl: explode });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some(r => r.awards.includes('MVP-1'))).toBe(true);
  });
});

describe('which season a set is read from', () => {
  it('turns the base set\'s stats-season label into the year the site indexes by', () => {
    // "2025-26" -> 2026. Derived from sets.js rather than written down, so the
    // awards year moves when the set does.
    expect(statsSeasonEndYear(CURRENT_SET)).toBe(2026);
  });

  it('answers null for a set whose cards each carry their own season', () => {
    // 'career-best season' and 'rookie season' are prose, not labels — the
    // signal that the join has to go card by card instead.
    expect(statsSeasonEndYear(SUPER_SEASON_SET)).toBeNull();
    expect(statsSeasonEndYear(ROOKIE_SET)).toBeNull();
    // The WNBA set declares a bare year, which is not a season label either.
    expect(statsSeasonEndYear(WNBA_SET)).toBeNull();
    expect(statsSeasonEndYear('no-such-set')).toBeNull();
  });

  it('collects every season any set needs into one polite pass', () => {
    const seasons = seasonsNeeded([
      { set: CURRENT_SET, season: 2026, cards: [] },
      { set: SUPER_SEASON_SET, cards: [{ season: 2016 }, { season: 2016 }, { season: 2009 }] },
      { set: ROOKIE_SET, cards: [{ season: 2004 }, { season: null }, {}] },
    ]);
    expect(seasons).toEqual([2004, 2009, 2016, 2026]);
  });
});

describe('joining awards to cards', () => {
  const cards = [
    { id: 'Luka_Doncic', name: 'Luka Dončić', season: 2026 },
    { id: 'A_J_Green', name: 'A.J. Green', season: 2026 },
  ];

  it('matches the base set on the cross-source name key', () => {
    // The base set's cards carry no Basketball-Reference id, so the join is
    // normalizeName — which folds diacritics ("Dončić"/"Doncic") and
    // punctuation ("A.J."/"AJ"), the two disagreement classes that actually
    // occur between these two sources.
    const { records } = joinByName(
      cards,
      [{ playerId: 'doncilu01', name: 'Luka Doncic', awards: 'MVP-4,AS' }],
      2026
    );
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('Luka_Doncic');
    // FOURTH IN THE VOTING, and an All-Star. `raw` keeps both — that is what it
    // is for — and the parsed result takes the selection and NOT the losing
    // rank, off the one string.
    expect(records[0].raw).toBe('MVP-4,AS');
    expect(records[0].awards).toEqual(['AS']);
    // And the season is the SET's, because a base card has none of its own.
    expect(records[0].season).toBe(2026);
  });

  it('throws rather than guessing when two names collide', () => {
    // An MVP on the wrong card is not recoverable; a generator that stopped is.
    expect(() =>
      joinByName(
        cards,
        [
          { playerId: 'a01', name: 'A.J. Green', awards: 'MVP-1' },
          { playerId: 'b01', name: 'AJ Green', awards: '6MOY-1' },
        ],
        2026
      )
    ).toThrow(/unsafe/);
    expect(() =>
      joinByName(
        [...cards, { id: 'AJ_Green', name: 'AJ Green', season: 2026 }],
        [{ playerId: 'a01', name: 'Somebody Else', awards: 'MVP-1' }],
        2026
      )
    ).toThrow(/unsafe/);
  });

  it('reports the award rows no card claimed, rather than dropping them silently', () => {
    const { unmatched } = joinByName(
      cards,
      [{ playerId: 'x01', name: 'Not In The Pool', awards: 'MVP-1' }],
      2026
    );
    expect(unmatched.map(r => r.name)).toEqual(['Not In The Pool']);
  });

  it('matches a special set by bbref id and by that card\'s own season', () => {
    // No name matching here: these cards carry the id generateSpecialSets.js
    // resolved once, from the most recent season only, which is the rule that
    // keeps fathers and sons apart.
    const bySeason = new Map([
      [2014, new Map([['duranke01', { playerId: 'duranke01', name: 'Kevin Durant', awards: 'MVP-1,AS,NBA1' }]])],
      [2008, new Map([['duranke01', { playerId: 'duranke01', name: 'Kevin Durant', awards: 'ROY-1' }]])],
    ]);
    const superSeason = joinById(
      [{ id: 'Kevin_Durant', name: 'Kevin Durant', bbrefId: 'duranke01', season: 2014 }],
      bySeason
    );
    expect(superSeason[0].awards).toEqual(['MVP', 'AS']);
    expect(superSeason[0].season).toBe(2014);
    // The SAME player, the SAME id, a different card — a different trophy AND
    // no All-Star selection, which is the whole reason the season is part of
    // the join.
    const rookie = joinById(
      [{ id: 'Kevin_Durant', name: 'Kevin Durant', bbrefId: 'duranke01', season: 2008 }],
      bySeason
    );
    expect(rookie[0].awards).toEqual(['ROY']);
  });

  it('skips a card whose season was never fetched, rather than mis-crediting it', () => {
    expect(
      joinById([{ id: 'X', name: 'X', bbrefId: 'x01', season: 1997 }], new Map())
    ).toEqual([]);
  });
});

// ── THE RING, WHICH IS IN NO COLUMN ────────────────────────────────────────
describe('joining the champion roster to cards', () => {
  const CHAMPION = {
    abbr: 'OKC',
    season: 2025,
    name: 'Oklahoma City Thunder',
    roster: [
      { playerId: 'gilgesh01', name: 'Shai Gilgeous-Alexander' },
      { playerId: 'dortlu01', name: 'Luguentz Dort' },
      { playerId: 'willija06', name: 'Jalen Williams' },
    ],
  };
  const index = championIndex(CHAMPION);

  it('indexes the roster both ways, because the two sets join differently', () => {
    // The special sets carry bbrefId and match on it; the base set carries no
    // id at all and matches on normalizeName.
    expect(index.byId.get('dortlu01')).toEqual({
      playerId: 'dortlu01',
      name: 'Luguentz Dort',
      team: 'OKC',
    });
    expect(index.byName.get(normalizeName('Luguentz Dort')).playerId).toBe('dortlu01');
    expect(index.abbr).toBe('OKC');
    expect(index.season).toBe(2025);
  });

  it('is null for a season nobody has won yet', () => {
    expect(championIndex(null)).toBeNull();
    expect(championIndex({ abbr: 'X', season: 1, name: 'X' })).toBeNull();
  });

  it("throws rather than giving one man another man's ring", () => {
    expect(() =>
      championIndex({
        ...CHAMPION,
        roster: [
          { playerId: 'a01', name: 'Jalen Williams' },
          { playerId: 'b01', name: 'Jalen Williams' },
        ],
      })
    ).toThrow(/champion name join is unsafe/);
  });

  it('marks a champion who won NOTHING individually, by id', () => {
    // The case a join gated on "has an awards row" would have missed, and the
    // reason awardRecord no longer returns early without one: most of a title
    // roster wins nothing, and the ring is a team fact.
    const cards = [{ id: 'Lu_Dort', name: 'Luguentz Dort', bbrefId: 'dortlu01', season: 2025 }];
    const [record] = joinById(cards, new Map([[2025, new Map()]]), new Map([[2025, index]]));
    expect(record.awards).toEqual(['CHAMP']);
    expect(record.champion).toBe('OKC');
    expect(record.bbrefId).toBe('dortlu01');
    // `raw` is null rather than empty: the column carried nothing, which is a
    // different fact from a column that was never read.
    expect(record.raw).toBeNull();
  });

  it('puts the ring in its declared place beside what the column earned', () => {
    const cards = [
      { id: 'SGA', name: 'Shai Gilgeous-Alexander', bbrefId: 'gilgesh01', season: 2025 },
    ];
    const awards = new Map([
      [2025, new Map([['gilgesh01', {
        playerId: 'gilgesh01',
        name: 'Shai Gilgeous-Alexander',
        awards: 'MVP-1,DPOY-10,CPOY-8,AS,NBA1',
      }]])],
    ]);
    const [record] = joinById(cards, awards, new Map([[2025, index]]));
    // Not ['MVP','AS','CHAMP'] — the ring sorts below the trophy and above the
    // selection, which is what orderAwardCodes is for.
    expect(record.awards).toEqual(['MVP', 'CHAMP', 'AS']);
    expect(record.raw).toBe('MVP-1,DPOY-10,CPOY-8,AS,NBA1');
    expect(record.champion).toBe('OKC');
  });

  it("reads each card's OWN season, so a ring lands on the right card", () => {
    // The same man, two seasons, one champion. This is the whole reason the
    // champion is looked up per card on the special sets.
    const cards = [
      { id: 'A', name: 'Shai Gilgeous-Alexander', bbrefId: 'gilgesh01', season: 2025 },
      { id: 'B', name: 'Shai Gilgeous-Alexander', bbrefId: 'gilgesh01', season: 2024 },
    ];
    const awards = new Map([[2024, new Map()], [2025, new Map()]]);
    const champions = new Map([[2025, index], [2024, championIndex({
      abbr: 'BOS', season: 2024, name: 'Boston Celtics', roster: [],
    })]]);
    const records = joinById(cards, awards, champions);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('A');
    expect(records[0].season).toBe(2025);
  });

  it('marks the base set by NAME, since those cards carry no id', () => {
    const { records } = joinByName(
      [
        { id: 'Lu_Dort', name: 'Luguentz Dort' },
        { id: 'Nobody', name: 'Some Other Player' },
      ],
      [],
      2025,
      index
    );
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('Lu_Dort');
    expect(records[0].awards).toEqual(['CHAMP']);
    expect(records[0].bbrefId).toBe('dortlu01');
  });

  it('marks nobody when the season has no champion', () => {
    const { records } = joinByName([{ id: 'X', name: 'Luguentz Dort' }], [], 2025, null);
    expect(records).toEqual([]);
    expect(joinById([{ id: 'X', name: 'X', bbrefId: 'dortlu01', season: 2025 }],
      new Map([[2025, new Map()]]), null)).toEqual([]);
  });

  it('caches the champion under a key of its own', () => {
    expect(CHAMPION_CACHE_KEY(2026)).toBe('bbref-2026-champion');
    expect(CHAMPION_CACHE_KEY(2026)).not.toBe(AWARDS_CACHE_KEY(2026));
  });
});

describe('the run report', () => {
  it('counts what prints AND what would print if EVERY selection counted', () => {
    const counts = countAwards([
      { raw: 'MVP-1,CPOY-1,AS,NBA1', awards: ['MVP', 'CPOY', 'AS'] },
      { raw: 'MVP-4,AS', awards: ['AS'] },
      { raw: 'AS', awards: ['AS'] },
      { raw: 'ROY-1', awards: ['ROY'] },
      // Near-misses and nothing else — no trophy, no selection of any kind.
      // This card is not marked and would NOT be marked by admitting All-NBA
      // or All-Defensive either, which is exactly what the old counter got
      // wrong: it counted any non-empty raw string.
      { raw: 'MVP-9,DPOY-6', awards: [] },
      // A selection this build does not declare, on a card with no trophy: not
      // marked today, and the one shape ifSelectionsCounted exists to count.
      { raw: 'NBA3,DEF2', awards: [] },
    ]);
    expect(counts.cards).toBe(6);
    expect(counts.marked).toBe(4);
    expect(counts.multiple).toBe(1);
    // Nothing over the row the card can draw. A four-code record would show up
    // here rather than as a silently dropped mark at export time.
    expect(counts.capped).toBe(0);
    expect(
      countAwards([{ raw: 'x', awards: ['MVP', 'DPOY', 'ROY', 'MIP', 'AS'] }]).capped
    ).toBe(1);
    // And the high-water mark, which says how much headroom is left BEFORE the
    // row overflows rather than only whether it has.
    expect(counts.mostHeld).toBe(3);
    expect(countAwards([]).mostHeld).toBe(0);
    // The number that keeps the argument for leaving All-NBA and
    // All-Defensive out measurable rather than asserted: the four marked cards
    // plus the NBA3/DEF2 one, and NOT the pure near-miss.
    expect(counts.ifSelectionsCounted).toBe(5);
    expect(counts.byCode.MVP).toBe(1);
    expect(counts.byCode.CPOY).toBe(1);
    expect(counts.byCode.ROY).toBe(1);
    expect(counts.byCode.AS).toBe(3);
    expect(counts.byCode.DPOY).toBe(0);
  });
});

describe('the committed file', () => {
  it('declares exactly the codes this build can draw', () => {
    expect(AWARDS.declared).toEqual(AWARD_CODES);
  });

  it('reads the thirty-seven seasons the five sets between them need', () => {
    // 1987-2026 with the gaps of the rosters themselves: the rookie set now
    // reaches Rodman's 1986-87 debut, the base set sits furthest forward, and
    // every other set lands inside.
    expect(AWARDS.seasons[0]).toBe(1987);
    expect(AWARDS.seasons.at(-1)).toBe(2026);
    expect(AWARDS.seasons).toHaveLength(37);
  });

  it('agrees with its own counts', () => {
    // The report is computed, so this catches a hand-edited file as much as a
    // regression in the counter.
    for (const [set, counts] of Object.entries(AWARDS.counts)) {
      const records = AWARDS.sets[set];
      expect(records.length, set).toBe(counts.cards);
      expect(records.filter(r => r.awards.length > 0).length, set).toBe(counts.marked);
      expect(records.filter(r => r.awards.length > 1).length, set).toBe(counts.multiple);
      expect(
        records.filter(r => r.awards.length > MAX_CARD_AWARDS).length,
        set
      ).toBe(counts.capped);
      for (const code of AWARD_CODES) {
        expect(records.filter(r => r.awards.includes(code)).length, `${set} ${code}`)
          .toBe(counts.byCode[code]);
      }
    }
  });

  it('marks a minority of each set, which is what a mark is for', () => {
    // THE PRICE OF ALL-STAR AND THE RING, on the record. The user took the
    // All-Star decision with these numbers in front of him; they are quoted in
    // src/cards/awards.js and pinned here so the file and the comment cannot
    // drift apart.
    //
    // Re-measured when the Summer Standouts joined the plan: the standout
    // Super Seasons added marked retirees to that set, and the newly cached
    // 2000-2007 pages resolved two more rookie-year marks.
    expect(AWARDS.counts[CURRENT_SET].marked).toBe(40);
    expect(AWARDS.counts[SUPER_SEASON_SET].marked).toBe(63);
    // The rookie set moves at last, and only on the ring: no player in that
    // pool was an All-Star as a rookie, but six of them won a title as one.
    expect(AWARDS.counts[ROOKIE_SET].marked).toBe(25);
    // The standouts themselves: a playoff-run card is the season a ring was
    // actually won in, so the ring is the mark that carries the set.
    // 23 with Rodman's 1996 title run — his ring is the mark.
    expect(AWARDS.counts[SUMMER_STANDOUTS_SET].marked).toBe(23);
    expect(AWARDS.counts[SUMMER_STANDOUTS_SET].byCode.CHAMP).toBe(17);
    // Shaq is the one rookie All-Star; Blake Griffin's case finally has its
    // twin, and it arrived from 1993 rather than from a pool change.
    expect(AWARDS.counts[ROOKIE_SET].byCode.AS).toBe(1);
    expect(AWARDS.counts[ROOKIE_SET].byCode.CHAMP).toBe(8);
    // The ring is a TEAM fact, so it marks a whole roster's worth at once and
    // still leaves each set a minority.
    expect(AWARDS.counts[CURRENT_SET].byCode.CHAMP).toBe(11);
    expect(AWARDS.counts[SUPER_SEASON_SET].byCode.CHAMP).toBe(11);
    // …against what admitting All-NBA and All-Defensive as well would mark.
    // Still a step up on every set, which is the case for stopping here.
    // (Unchanged by the ring: ifSelectionsCounted asks about the awards column,
    // and the ring is not in it.)
    expect(AWARDS.counts[CURRENT_SET].ifSelectionsCounted).toBe(46);
    expect(AWARDS.counts[SUPER_SEASON_SET].ifSelectionsCounted).toBe(76);
    expect(AWARDS.counts[ROOKIE_SET].ifSelectionsCounted).toBe(25);
  });

  it('names every champion it marked, and gets them right', () => {
    // The rings are otherwise unfalsifiable without re-fetching. Six of the
    // twenty, spread across the range and each checkable from memory.
    const byYear = Object.fromEntries(AWARDS.champions.map(c => [c.season, c.abbr]));
    expect(AWARDS.champions).toHaveLength(AWARDS.seasons.length);
    expect(byYear[2004]).toBe('DET');
    expect(byYear[2008]).toBe('BOS');
    expect(byYear[2016]).toBe('CLE');
    expect(byYear[2021]).toBe('MIL');
    expect(byYear[2023]).toBe('DEN');
    expect(byYear[2025]).toBe('OKC');
    // And every ring on a card belongs to a team on that list, for that season.
    for (const records of Object.values(AWARDS.sets)) {
      for (const r of records.filter(x => x.awards.includes('CHAMP'))) {
        expect(r.champion, `${r.name} ${r.season}`).toBe(byYear[r.season]);
      }
    }
  });

  it('never exceeds the row the card can draw, now that the fourth mark is spent', () => {
    // MAX_CARD_AWARDS is 4 since .awards started wrapping, and one card now
    // holds exactly four: Shai Gilgeous-Alexander's 2024-25 Super Season, MVP +
    // FMVP + CHAMP + AS. It is the card the cap was raised past three FOR, and
    // admitting Finals MVP is what filled it. NOTHING IS DROPPED — `capped` is
    // still zero in every set — but the ceiling and the cap are level again, so
    // this assertion is the early warning if a fifth ever appears.
    const most = Math.max(...Object.values(AWARDS.sets).flat().map(r => r.awards.length));
    expect(most).toBe(4);
    expect(most).toBeLessThanOrEqual(MAX_CARD_AWARDS);
    for (const counts of Object.values(AWARDS.counts)) {
      expect(counts.capped).toBe(0);
      expect(counts.mostHeld).toBeLessThanOrEqual(MAX_CARD_AWARDS);
    }
    // Every card at three or more, named so a regression says WHO changed.
    const crowded = Object.entries(AWARDS.sets).flatMap(([set, rs]) =>
      rs.filter(r => r.awards.length >= 3).map(r => `${set} ${r.name} ${r.season} ${r.awards.join('+')}`)
    );
    expect(crowded.sort()).toEqual([
      '2026-27 Jalen Brunson 2026 FMVP+CHAMP+AS',
      '2026-27 Shai Gilgeous-Alexander 2026 MVP+CPOY+AS',
      'summer-standouts Kawhi Leonard 2019 FMVP+CHAMP+AS',
      'summer-standouts Kevin Durant 2017 FMVP+CHAMP+AS',
      'super-season Shai Gilgeous-Alexander 2025 MVP+FMVP+CHAMP+AS',
      "super-season Shaquille O'Neal 2000 MVP+FMVP+CHAMP+AS",
    ]);
  });

  it('marks every Finals MVP it read, and only from the playoff column', () => {
    // TWENTY SEASONS, TWENTY FINALS MVPs — the playoff column has never had a
    // gap in the range these sets span, so a run that reads fewer than one per
    // season has lost a page rather than found a season nobody won.
    expect(AWARDS.finalsMvps).toHaveLength(AWARDS.seasons.length);
    const byYear = Object.fromEntries(AWARDS.finalsMvps.map(f => [f.season, f.name]));
    expect(byYear[2004]).toBe('Chauncey Billups');
    expect(byYear[2015]).toBe('Andre Iguodala');
    expect(byYear[2021]).toBe('Giannis Antetokounmpo');
    expect(byYear[2026]).toBe('Jalen Brunson');
    // Every FMVP mark on a card is that season's man, and the EVIDENCE for it
    // is in `rawPost` and never in `raw` — which is the two-column split doing
    // its job. Brunson's regular-season string is `CPOY-5,AS,NBA2`: no trophy
    // in it at all, and the mark comes from the other table entirely.
    for (const records of Object.values(AWARDS.sets)) {
      for (const r of records.filter(x => x.awards.includes('FMVP'))) {
        expect(r.name, `${r.name} ${r.season}`).toBe(byYear[r.season]);
        expect(r.rawPost, `${r.name} ${r.season}`).toBe('Finals MVP-1');
        expect(r.raw ?? '', `${r.name} ${r.season}`).not.toMatch(/Finals/);
      }
    }
    // And no card carries a Finals MVP its own season did not produce.
    expect(AWARDS.counts[CURRENT_SET].byCode.FMVP).toBe(1);
    expect(AWARDS.counts[SUPER_SEASON_SET].byCode.FMVP).toBe(2);
    // ZERO IN THE ROOKIE SET, and that is a fact about the award rather than a
    // miss: no rookie has won a Finals MVP in the 2004..2026 range, and only
    // Magic Johnson ever has.
    expect(AWARDS.counts[ROOKIE_SET].byCode.FMVP).toBe(0);
  });
});
