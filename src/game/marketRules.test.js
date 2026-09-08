// A listing never goes below the card's burn value — the one rule, checked
// from the one module both the browser and the server read.
import { describe, it, expect } from 'vitest';
import { burnValueFor, listingFloor, checkListingPrice } from './marketRules.js';
import { ALL_CARDS, cardKey } from './cardSets.js';
import { BURN_VALUES, STRAT_BURN_VALUES, getPlayerRarity } from './rarity.js';

const aCard = ALL_CARDS[0];
const key = cardKey(aCard);

describe('the listing floor', () => {
  it('is the burn value, for a player and for a strategy card', () => {
    expect(listingFloor(key)).toBe(BURN_VALUES[getPlayerRarity(aCard)]);
    expect(listingFloor('turnover')).toBe(STRAT_BURN_VALUES.common);
    expect(burnValueFor('no-such-card')).toBeNull();
  });

  it('refuses a price under the floor and accepts one at it', () => {
    const floor = listingFloor(key);
    expect(checkListingPrice(key, floor - 1)).toMatchObject({ ok: false, floor });
    expect(checkListingPrice(key, floor - 1).msg).toMatch(/at least/);
    expect(checkListingPrice(key, floor)).toEqual({ ok: true, floor, msg: null });
    expect(checkListingPrice(key, floor + 100).ok).toBe(true);
  });

  it('refuses a card that is not a card, and a price that is not whole', () => {
    expect(checkListingPrice('no-such-card', 50)).toMatchObject({ ok: false, floor: null });
    expect(checkListingPrice(key, 2.5).ok).toBe(false);
  });

  it('holds for every card in every set', () => {
    // A legendary's floor is 250; a common's is 2. Whatever the band, the
    // floor is exactly the burn table's number for it.
    for (const c of ALL_CARDS) {
      expect(listingFloor(cardKey(c))).toBe(BURN_VALUES[getPlayerRarity(c)]);
    }
  });
});
