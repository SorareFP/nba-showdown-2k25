// WHAT THE BUTTON PROMISES IS WHAT THE SERVER PAYS.
//
// The user, 2026-09-14: "I just burned a bunch of cards, and I think I was
// supposed to get 400 for Katie Smith, but I only have like 235 coins left.
// Can you double-check that the burn mechanism is working correctly?"
//
// Katie Smith's 2000 Super Season is $760, which is rare, which burns for 45 —
// and 400 is not a value on the ladder at all (2 / 5 / 45 / 100 / 250). It is
// close to the rare MARKET price of 600, which is the number a card SELLS for,
// and the gap between the two is the whole point of burning being a sink.
//
// So no bug, but the question deserves a guard rather than a shrug. The
// collection row computes the number it shows from the card's rarity, and
// burnCard on the server pays burnValueFor(cardKey). Those are two paths to
// one figure, and if they ever disagree the confirm dialog becomes a lie. This
// walks the whole set and holds them together.
import { describe, it, expect } from 'vitest';
import { CARDS } from './cards.js';
import { STRATS } from './strats.js';
import { cardKey } from './cardSets.js';
import {
  getPlayerRarity, getStratRarity, BURN_VALUES, STRAT_BURN_VALUES, MARKET_PRICES, RARITY_ORDER,
} from './rarity.js';
import { burnValueFor, listingFloor } from './marketRules.js';

/** Exactly what MyCollection puts in the "+N coins?" confirm. */
const shown = card => (card.type === 'strat'
  ? (STRAT_BURN_VALUES[getStratRarity(card)] ?? 1)
  : (BURN_VALUES[getPlayerRarity(card)] ?? 0));

describe('the burn value the collection shows is the one that gets paid', () => {
  it('agrees on every player card in the game', () => {
    const wrong = [];
    for (const c of CARDS) {
      const key = cardKey(c);
      const paid = burnValueFor(key);
      if (paid !== shown(c)) wrong.push(`${c.name} $${c.salary}: shows ${shown(c)}, pays ${paid}`);
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  it('agrees on every strategy card', () => {
    const wrong = [];
    for (const s of STRATS) {
      const paid = burnValueFor(s.id);
      const show = STRAT_BURN_VALUES[getStratRarity(s)] ?? 1;
      if (paid !== show) wrong.push(`${s.name}: shows ${show}, pays ${paid}`);
    }
    expect(wrong).toEqual([]);
  });

  it('pays something for everything that can be burned', () => {
    for (const c of CARDS) {
      expect(burnValueFor(cardKey(c)), c.name).toBeGreaterThan(0);
    }
  });
});

describe('burning is a sink, not a sale', () => {
  it('always pays less than the market price of the same band', () => {
    for (const band of RARITY_ORDER) {
      expect(BURN_VALUES[band], band).toBeLessThan(MARKET_PRICES[band]);
    }
  });

  it('sets the listing floor at the burn value, so selling is never worse', () => {
    for (const c of CARDS.slice(0, 50)) {
      expect(listingFloor(cardKey(c))).toBe(burnValueFor(cardKey(c)));
    }
  });

  it('is the ladder the user was reading against — 400 is not on it', () => {
    expect(Object.values(BURN_VALUES).sort((a, b) => a - b)).toEqual([2, 5, 45, 100, 250]);
    expect(Object.values(BURN_VALUES)).not.toContain(400);
    // The rare MARKET price is the number nearest what they remembered.
    expect(MARKET_PRICES.rare).toBe(600);
  });
});
