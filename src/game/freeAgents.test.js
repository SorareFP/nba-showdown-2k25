// The shared Free Agents rules (freeAgents.js): the price the user chose,
// and how a quote row reads.
import { describe, it, expect } from 'vitest';
import { freeAgentPrice, packOddsCost, readQuoteRow, FA_PACK_WEIGHT, FREE_AGENT_SETS, OPEN_REQUEST_LIMIT } from './freeAgents.js';
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
