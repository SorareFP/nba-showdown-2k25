// The shared Free Agents rules (freeAgents.js): the price the user chose,
// and how a quote row reads.
import { describe, it, expect } from 'vitest';
import {
  freeAgentPrice, packOddsCost, readQuoteRow, quoteSpread, FA_PACK_WEIGHT, FREE_AGENT_SETS, OPEN_REQUEST_LIMIT,
  searchQuotes, prepareSearch, seasonText, checkRequest, indexQuotes, quoteKey, REQUEST_STATUS,
  quoteFilterOptions, countQuotes, canBrowse,
  AUTO_REJECT_MESSAGE, searchHitsNeverCard, ARCHIVE_COVERAGE, coverageText, isWnbaId,
} from './freeAgents.js';
import quoteIndex from '../../card-data/generated/quote-index.json';
import { MARKET_PRICES, RARITY_ORDER, RARITY_SALARY } from './rarity.js';

describe('the free-agent price', () => {
  it('is the rarity table leaned 20% toward pack odds, the numbers the user picked (2026-09-10)', () => {
    expect(FA_PACK_WEIGHT).toBe(0.2);
    // 1080/3760 since the 2026-09-24 reprice: the pack-odds half reads the
    // base booster's rarity shares, and the currency-rate line moved them.
    expect(RARITY_ORDER.map(r => freeAgentPrice('throwbacks', r))).toEqual([100, 260, 1080, 3760, 9100]);
    // The rookie rare price is 970 since 2026-09-22: pack odds are read off the
    // set, and the reward/identity batch put four rookie years into it (Wall,
    // Brand, Arenas, DeAndre Jordan), which moved the rare share one rounding
    // step. The lean and the table are untouched.
    // 960/3120 since the 2026-09-24 reprice, the same shares moving in the
    // Rookie set's own pack.
    expect(RARITY_ORDER.map(r => freeAgentPrice('rookie', r))).toEqual([100, 220, 960, 3120, 7580]);
  });

  it('sits between the table and the pack-odds cost, and climbs with rarity', () => {
    for (const set of Object.keys(FREE_AGENT_SETS)) {
      const prices = RARITY_ORDER.map(r => freeAgentPrice(set, r));
      for (let i = 1; i < prices.length; i += 1) expect(prices[i]).toBeGreaterThan(prices[i - 1]);
      RARITY_ORDER.forEach((r, i) => {
        expect(prices[i]).toBeGreaterThanOrEqual(MARKET_PRICES[r]);
        expect(prices[i]).toBeLessThan(packOddsCost(set, r));
      });
    }
  });

  it('is table-only at weight 0, and has no price for an unknown rarity', () => {
    expect(freeAgentPrice('throwbacks', 'rare', 0)).toBe(MARKET_PRICES.rare);
    expect(freeAgentPrice('throwbacks', 'mythic')).toBeNull();
  });
});

describe('a quote row', () => {
  it('reads the compact index row into salary, rarity and price', () => {
    // The salary comes off the band cut, so a re-cut cannot silently turn this
    // fixture super-rare — which 2026-09-12 did, at a hard-coded 1250.
    const legendary = RARITY_SALARY.legendary;
    const q = readQuoteRow(['jordami01', 'Michael Jordan', 1988, 'r', 'CHI', legendary, 'super-season']);
    expect(q).toMatchObject({ bbrefId: 'jordami01', season: 1988, playoffs: false, salary: legendary, rarity: 'legendary', set: 'super-season' });
    expect(q.price).toBe(freeAgentPrice('super-season', 'legendary'));
    expect(readQuoteRow(['x', 'X', 2010, 'p', 'BOS', 500, 'summer-standouts']).playoffs).toBe(true);
  });

  // The Korver case (2026-09-21): quoted $790 rare, built $570 uncommon. With
  // the calibration's spread the row says which bands are in reach.
  it('says how sure it is: the bands one spread either side, when they differ', () => {
    const row = ['korveky01', 'Kyle Korver', 2011, 'r', 'CHI', 790, 'throwbacks'];
    const q = readQuoteRow(row, 124);
    expect(q).toMatchObject({ spread: 124, rarity: 'rare', rarityLow: 'uncommon', rarityHigh: 'rare', uncertain: true });
    const sure = readQuoteRow(['x', 'X', 2011, 'r', 'CHI', 810, 'throwbacks'], 100);   // 710..910: rare both ways
    expect(sure).toMatchObject({ rarityLow: 'rare', rarityHigh: 'rare', uncertain: false });
    expect(readQuoteRow(row)).not.toHaveProperty('spread');                        // no calibration, no claim
    // The spread comes from the line that priced the row: regular, playoffs or WNBA.
    const cal = { regular: { sd: 124.2 }, playoffs: { sd: 98.4 }, wnba: { sd: 93.6 } };
    expect(quoteSpread(cal, row)).toBe(124);
    expect(quoteSpread(cal, ['x', 'X', 2010, 'p', 'BOS', 500, 'summer-standouts'])).toBe(98);
    expect(quoteSpread(cal, ['moorema01w', 'Maya Moore', 2016, 'r', 'MIN', 1200, 'wnba-throwbacks'])).toBe(94);
    expect(quoteSpread(null, row)).toBeNull();
    // The shipped index carries a spread for every line, and a search passes it through.
    expect(quoteSpread(quoteIndex.calibration, row)).toBeGreaterThan(0);
    const hit = searchQuotes(prepareSearch(quoteIndex.rows, quoteIndex.calibration), 'korver').find(p => p.bbrefId === 'korveky01');
    expect(hit.seasons.every(sn => sn.spread > 0)).toBe(true);
  });

  it('allows three open requests', () => {
    expect(OPEN_REQUEST_LIMIT).toBe(3);
  });
});

describe('where the archive stops', () => {
  const runs = seasons => {
    const out = [];
    for (const y of [...new Set(seasons)].sort((a, b) => a - b)) {
      const last = out.at(-1);
      if (last && y === last[1] + 1) last[1] = y; else out.push([y, y]);
    }
    return out;
  };

  it('is exactly what the quote index holds, so the form never promises a season it cannot quote', () => {
    const nba = quoteIndex.rows.filter(r => !isWnbaId(r[0]));
    const wnba = quoteIndex.rows.filter(r => isWnbaId(r[0]));
    expect(ARCHIVE_COVERAGE.regular).toEqual(runs(nba.filter(r => r[3] === 'r').map(r => r[2])));
    expect(ARCHIVE_COVERAGE.playoffs).toEqual(runs(nba.filter(r => r[3] === 'p').map(r => r[2])));
    expect(ARCHIVE_COVERAGE.wnba).toEqual(runs(wnba.map(r => r[2])));
    // A WNBA row always lands in a WNBA set, and an NBA row never does.
    expect(wnba.every(r => r[6].startsWith('wnba-'))).toBe(true);
    expect(nba.some(r => r[6].startsWith('wnba'))).toBe(false);
  });

  it('says so in a sentence, the long run first and the stragglers after', () => {
    expect(coverageText()).toBe(
      'NBA regular seasons from 1984-85 to 2025-26 (plus 1975-76 and 1976-77), playoff runs from 2002 to 2026, ' +
      'and WNBA seasons from 1997 to 2026'
    );
    expect(coverageText({ regular: [[2000, 2010]], playoffs: [] })).toBe('NBA regular seasons from 1999-00 to 2009-10');
    expect(coverageText({ regular: [[2000, 2010]], playoffs: [[2002, 2010]] })).toBe(
      'NBA regular seasons from 1999-00 to 2009-10, and playoff runs from 2002 to 2010'
    );
  });
});

describe('WNBA seasons', () => {
  it('read as one year, and price through the WNBA Booster', () => {
    expect(isWnbaId('wilsoa01w')).toBe(true);
    expect(isWnbaId('wilsoa01')).toBe(false);
    expect(seasonText({ bbrefId: 'lesleli01w', season: 2001, playoffs: false })).toBe('2001 WNBA');
    expect(seasonText({ bbrefId: 'jordami01', season: 1988, playoffs: false })).toBe('1987-88');
    for (const set of ['wnba-rookie', 'wnba-super-season', 'wnba-throwbacks']) {
      expect(FREE_AGENT_SETS[set].league).toBe('wnba');
      expect(freeAgentPrice(set, 'rare')).toBeGreaterThanOrEqual(MARKET_PRICES.rare);
    }
  });
});

describe('requests', () => {
  const rows = [
    ['jordami01', 'Michael Jordan', 1988, 'r', 'CHI', 1250, 'super-season'],
    ['jordami01', 'Michael Jordan', 1991, 'p', 'CHI', 1300, 'summer-standouts'],
    ['jordami01', 'Michael Jordan', 1985, 'r', 'CHI', 900, 'throwbacks'],
    ['jordade01', 'DeAndre Jordan', 2014, 'r', 'LAC', 700, 'throwbacks'],
    ['whitero01', 'Royce White', 2015, 'r', 'SAC', 150, 'throwbacks'],
  ];

  it('finds a player by any part of the name, name-start first, seasons in order', () => {
    const found = searchQuotes(prepareSearch(rows), 'jord');
    expect(found.map(p => p.name)).toEqual(['DeAndre Jordan', 'Michael Jordan']);   // neither starts with "jord"
    expect(searchQuotes(prepareSearch(rows), 'mich')[0].seasons.map(s => seasonText(s))).toEqual(['1984-85', '1987-88', '1991 playoffs']);
    expect(searchQuotes(prepareSearch(rows), 'jo')).toEqual([]);                    // too short to search
  });

  it('narrows a name search by season, team and salary, and opens a team or a season without a name', () => {
    const p = prepareSearch(rows);
    expect(searchQuotes(p, 'jord', { filters: { season: 1991 } })[0].seasons.map(s => seasonText(s))).toEqual(['1991 playoffs']);
    expect(searchQuotes(p, 'jord', { filters: { team: 'nba:LAC' } }).map(x => x.name)).toEqual(['DeAndre Jordan']);
    expect(searchQuotes(p, 'jord', { filters: { team: 'wnba:LAC' } })).toEqual([]);          // the leagues share letters
    expect(searchQuotes(p, 'jord', { filters: { salaryMin: 1000 } })[0].seasons.map(s => s.salary)).toEqual([1250, 1300]);
    expect(searchQuotes(p, 'jord', { filters: { salaryMax: 900 } }).map(x => x.name)).toEqual(['DeAndre Jordan', 'Michael Jordan']);
    // A browse: no name, a team or a season, best-paid first, capped.
    expect(searchQuotes(p, '', { filters: { team: 'nba:CHI' } }).map(x => x.name)).toEqual(['Michael Jordan']);
    expect(searchQuotes(p, '', { filters: { season: 2014 } }).map(x => x.name)).toEqual(['DeAndre Jordan']);
    expect(searchQuotes(p, '', { filters: { season: 2015 } })).toEqual([]);                  // a never-card is never listed
    expect(searchQuotes(p, 'jo', { filters: { salaryMin: 100 } })).toEqual([]);              // salary alone is the whole archive
    expect(canBrowse({ salaryMin: 100 })).toBe(false);
    expect(canBrowse({ team: 'nba:CHI' })).toBe(true);
    expect(searchQuotes(p, '', { filters: { team: 'nba:CHI' }, browseLimit: 0 })).toEqual([]);
    expect(countQuotes(p, '', { team: 'nba:CHI' })).toBe(1);
    expect(countQuotes(p, 'jord')).toBe(2);
    expect(quoteFilterOptions(rows)).toEqual({ seasons: [2015, 2014, 1991, 1988, 1985], teams: { nba: ['CHI', 'LAC', 'SAC'], wnba: [] } });
  });

  it('refuses the never-card names with the user\'s message, and the form can tell from the search text', () => {
    expect(AUTO_REJECT_MESSAGE).toBe("That guys sucks, he's not getting a card.");
    expect(checkRequest({ row: rows[4] })).toEqual({ ok: false, code: 'auto-rejected', msg: AUTO_REJECT_MESSAGE });
    // It waits for "Enes F", "Enes K", "Royce W" (the user, 2026-09-10), or a surname only he carries.
    for (const t of ['Enes K', 'enes kanter', 'Enes F', 'Enes Freedom', 'Royce W', 'ROYCE WHITE', 'Kanter', 'freedom']) {
      expect(searchHitsNeverCard(t), t).toBe(true);
    }
    for (const t of ['Enes', 'Enes ', 'Royce', 'Royce O', 'white', 'Coby White', 'Whiteside', 'free', 'Tim Duncan']) {
      expect(searchHitsNeverCard(t), t).toBe(false);
    }
  });

  it('refuses a season with no quote, the same card twice, and a fourth open request', () => {
    expect(checkRequest({ row: null }).code).toBe('not-found');
    expect(checkRequest({ row: rows[0], alreadyAsked: true }).code).toBe('already-exists');
    expect(checkRequest({ row: rows[0], openCount: 3 }).code).toBe('resource-exhausted');
    expect(checkRequest({ row: rows[0], openCount: 2 })).toEqual({ ok: true });
  });

  it('finds a row by player, season and kind, the way the server looks one up', () => {
    const index = indexQuotes(rows);
    expect(index.get(quoteKey('jordami01', 1991, true))[5]).toBe(1300);
    expect(index.get(quoteKey('jordami01', 1991, false))).toBeUndefined();
    expect(REQUEST_STATUS.requested).toBe('requested');
  });
});
