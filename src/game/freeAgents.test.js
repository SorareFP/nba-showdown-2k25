// The shared Free Agents rules (freeAgents.js): the price the user chose,
// and how a quote row reads.
import { describe, it, expect } from 'vitest';
import {
  freeAgentPrice, packOddsCost, readQuoteRow, FA_PACK_WEIGHT, FREE_AGENT_SETS, OPEN_REQUEST_LIMIT,
  searchQuotes, prepareSearch, seasonText, checkRequest, indexQuotes, quoteKey, REQUEST_STATUS,
  AUTO_REJECT_MESSAGE, searchHitsNeverCard, ARCHIVE_COVERAGE, coverageText, isWnbaId,
} from './freeAgents.js';
import quoteIndex from '../../card-data/generated/quote-index.json';
import { MARKET_PRICES, RARITY_ORDER } from './rarity.js';

describe('the free-agent price', () => {
  it('is the rarity table leaned 20% toward pack odds, the numbers the user picked (2026-09-10)', () => {
    expect(FA_PACK_WEIGHT).toBe(0.2);
    expect(RARITY_ORDER.map(r => freeAgentPrice('throwbacks', r))).toEqual([100, 260, 1100, 3780, 9100]);
    expect(RARITY_ORDER.map(r => freeAgentPrice('rookie', r))).toEqual([100, 210, 970, 3120, 7760]);
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
    const q = readQuoteRow(['jordami01', 'Michael Jordan', 1988, 'r', 'CHI', 1250, 'super-season']);
    expect(q).toMatchObject({ bbrefId: 'jordami01', season: 1988, playoffs: false, salary: 1250, rarity: 'legendary', set: 'super-season' });
    expect(q.price).toBe(freeAgentPrice('super-season', 'legendary'));
    expect(readQuoteRow(['x', 'X', 2010, 'p', 'BOS', 500, 'summer-standouts']).playoffs).toBe(true);
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
