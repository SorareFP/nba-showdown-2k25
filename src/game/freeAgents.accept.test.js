// Answering a Free Agent request: the invoice is the FINISHED card's price,
// which requests still hold a place, and how a built card joins its set.
import { describe, it, expect } from 'vitest';
import {
  invoiceFor, freeAgentPrice, OPEN_STATUSES, OPEN_REQUEST_LIMIT, REQUEST_STATUS, signableCount, signNotice,
  isGift, signPriceText,
} from './freeAgents.js';
import { getPlayerRarity } from './rarity.js';
import { joinFreeAgents, getCardByKey } from './cardSets.js';
import { withFreeAgent } from '../../scripts/cardgen/freeAgentFile.js';
import { SPECIAL_SETS_IN_PACKS } from './packEngine.js';
import { SPECIAL_SETS } from './collections.js';

describe('the invoice', () => {
  it('prices the finished card by its own salary and set, not the quote', () => {
    const card = { set: 'rookie', salary: 640 };
    const rarity = getPlayerRarity(card);
    expect(invoiceFor(card)).toEqual({ salary: 640, rarity, price: freeAgentPrice('rookie', rarity) });
    // A card that came out a rarity higher than quoted is invoiced at the higher price.
    const star = invoiceFor({ set: 'rookie', salary: 1500 });
    expect(star.price).toBeGreaterThan(invoiceFor(card).price);
  });
});

describe('the home screen note', () => {
  it('counts only invoiced requests, and says so in the user\'s words', () => {
    expect(signableCount([{ status: 'invoiced' }, { status: 'built' }, { status: 'signed' }, { status: 'invoiced' }])).toBe(2);
    expect(signableCount(null)).toBe(0);
    expect(signNotice(0)).toBeNull();
    expect(signNotice(1)).toBe('You have a free agent waiting to be signed!');
    expect(signNotice(2)).toBe('You have 2 free agents waiting to be signed!');
  });
});

describe('a gift', () => {
  const gift = { status: 'invoiced', invoice: { salary: 480, rarity: 'uncommon', price: 0, gift: true } };
  const bill = { status: 'invoiced', invoice: { salary: 480, rarity: 'uncommon', price: 260 } };

  it('waits to be signed like any invoice, so the home screen counts it', () => {
    expect(isGift(gift)).toBe(true);
    expect(isGift(bill)).toBe(false);
    expect(signableCount([gift, bill])).toBe(2);
    expect(signNotice(signableCount([gift]))).toBe('You have a free agent waiting to be signed!');
  });

  it('prints 0 coins with a gift icon, and a real invoice its price', () => {
    expect(signPriceText(gift)).toBe('🎁 0 coins');
    expect(signPriceText(bill)).toBe('🪙 260');
  });
});

describe('open requests', () => {
  it('holds a place while asked, being made, or invoiced; frees it once answered', () => {
    expect(OPEN_STATUSES).toEqual([REQUEST_STATUS.requested, REQUEST_STATUS.built, REQUEST_STATUS.invoiced]);
    for (const done of ['signed', 'gifted', 'declined', 'rejected']) expect(OPEN_STATUSES).not.toContain(done);
    expect(OPEN_REQUEST_LIMIT).toBe(3);
  });
});

describe('a built card joins its set', () => {
  it('goes into the set it names; a card with no set is ignored', () => {
    const sets = joinFreeAgents({ rookie: [{ id: 'A', set: 'rookie' }] }, [
      { id: 'B', set: 'rookie' }, { id: 'C', set: 'summer-standouts' }, { id: 'D' },
    ]);
    expect(sets.rookie.map(c => c.id)).toEqual(['A', 'B']);
    expect(sets['summer-standouts'].map(c => c.id)).toEqual(['C']);
    expect(Object.values(sets).flat().some(c => c.id === 'D')).toBe(false);
  });

  it('a rebuild of the same request replaces its card in the file', () => {
    const file = { set: 'free-agents', cards: [{ id: 'X', requestId: 'r1', salary: 500 }, { id: 'Y', requestId: 'r2' }] };
    const next = withFreeAgent(file, { id: 'X', requestId: 'r1', salary: 700 });
    expect(next.cards.map(c => [c.id, c.salary ?? null])).toEqual([['Y', null], ['X', 700]]);
  });

  it('the shipped game still finds its base cards with the free-agent file merged in', () => {
    expect(getCardByKey('Nikola_Jokic')).toBeTruthy();
  });
});

describe('Throwbacks in packs', () => {
  it('pulls from both Throwbacks sets like the other specials, with no completion goal', () => {
    expect(SPECIAL_SETS_IN_PACKS).toEqual(expect.arrayContaining(['throwbacks', 'wnba-throwbacks']));
    expect(SPECIAL_SETS.map(s => s.id)).not.toContain('throwbacks');
    expect(SPECIAL_SETS.map(s => s.id)).not.toContain('wnba-throwbacks');
  });
});
