import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  AWARDS_CACHE_KEY,
  AWARDS_TABLE,
  countAwards,
  extractAwards,
  joinById,
  joinByName,
  loadSeasonAwards,
  seasonsNeeded,
  statsSeasonEndYear,
} from './generateAwards.js';
import { SEASON_TABLES } from './sources/basketballReference.js';
import { AWARD_CODES } from '../../src/cards/awards.js';
import { CURRENT_SET, ROOKIE_SET, SUPER_SEASON_SET, WNBA_SET } from '../../src/cards/sets.js';

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
    // FOURTH IN THE VOTING. The record exists — that is what `raw` is for — and
    // it carries no award.
    expect(records[0].raw).toBe('MVP-4,AS');
    expect(records[0].awards).toEqual([]);
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
    expect(superSeason[0].awards).toEqual(['MVP']);
    expect(superSeason[0].season).toBe(2014);
    // The SAME player, the SAME id, a different card — and a different trophy,
    // which is the whole reason the season is part of the join.
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

describe('the run report', () => {
  it('counts what prints AND what would print if the selections counted', () => {
    const counts = countAwards([
      { raw: 'MVP-1,CPOY-1,AS,NBA1', awards: ['MVP', 'CPOY'] },
      { raw: 'MVP-4,AS', awards: [] },
      { raw: 'AS', awards: [] },
      { raw: 'ROY-1', awards: ['ROY'] },
    ]);
    expect(counts.cards).toBe(4);
    expect(counts.marked).toBe(2);
    expect(counts.multiple).toBe(1);
    // The number that keeps the exclusion argument in awards.js measurable
    // rather than asserted.
    expect(counts.ifSelectionsCounted).toBe(4);
    expect(counts.byCode.MVP).toBe(1);
    expect(counts.byCode.CPOY).toBe(1);
    expect(counts.byCode.ROY).toBe(1);
    expect(counts.byCode.DPOY).toBe(0);
  });
});

describe('the committed file', () => {
  it('declares exactly the codes this build can draw', () => {
    expect(AWARDS.declared).toEqual(AWARD_CODES);
  });

  it('reads the twenty seasons the three sets between them need', () => {
    // 2004 and 2008-2026: the rookie set reaches furthest back, the base set
    // furthest forward, and the Super Season set sits inside both.
    expect(AWARDS.seasons[0]).toBe(2004);
    expect(AWARDS.seasons.at(-1)).toBe(2026);
    expect(AWARDS.seasons).toHaveLength(20);
  });

  it('agrees with its own counts', () => {
    // The report is computed, so this catches a hand-edited file as much as a
    // regression in the counter.
    for (const [set, counts] of Object.entries(AWARDS.counts)) {
      const records = AWARDS.sets[set];
      expect(records.length, set).toBe(counts.cards);
      expect(records.filter(r => r.awards.length > 0).length, set).toBe(counts.marked);
      for (const code of AWARD_CODES) {
        expect(records.filter(r => r.awards.includes(code)).length, `${set} ${code}`)
          .toBe(counts.byCode[code]);
      }
    }
  });

  it('marks a small minority of each set, which is what a mark is for', () => {
    // The numbers the exclusion argument in src/cards/awards.js quotes. If a
    // future declaration admits the selections, THIS is what will move.
    expect(AWARDS.counts[CURRENT_SET].marked).toBe(5);
    expect(AWARDS.counts[SUPER_SEASON_SET].marked).toBe(15);
    expect(AWARDS.counts[ROOKIE_SET].marked).toBe(11);
    // …against what admitting All-Star and the All-NBA/All-Defensive teams
    // would have marked, which is between five and eleven times as many.
    expect(AWARDS.counts[CURRENT_SET].ifSelectionsCounted).toBe(54);
    expect(AWARDS.counts[SUPER_SEASON_SET].ifSelectionsCounted).toBe(77);
    expect(AWARDS.counts[ROOKIE_SET].ifSelectionsCounted).toBe(70);
  });

  it('never exceeds the row the card can draw', () => {
    // MAX_CARD_AWARDS is 3 and the most anybody holds is 2, so no card is
    // silently losing a trophy today. When that stops being true this fails
    // here rather than dropping a mark at export time.
    const most = Math.max(...Object.values(AWARDS.sets).flat().map(r => r.awards.length));
    expect(most).toBe(2);
  });
});
