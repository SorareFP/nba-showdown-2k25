// A listing never goes below the card's burn value — the one rule, checked
// from the one module both the browser and the server read.
import { describe, it, expect } from 'vitest';
import {
  burnValueFor, listingFloor, checkListingPrice,
  tradeValue, tradeShare, tradeProblem, pickTradeCard, friendsLongEnough,
  TRADE_MAX_CARDS, TRADE_MIN_SHARE, TRADE_OFFER_DAYS, TRADE_OPEN_MAX, TRADE_FRIEND_DAYS,
} from './marketRules.js';
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

// TRADES (2026-11-02; the user: "card(s) for card(s) ... some sort of
// salary/rarity buffer so someone isn't just trading commons for legendaries").
// docs/plans/2026-11-02-friend-trades-design.md
describe('a trade', () => {
  const base = ALL_CARDS.filter(c => c.set === '2026-27');
  const of = (rarity, n) => base.filter(c => getPlayerRarity(c) === rarity).slice(0, n).map(cardKey);
  const more = (rarity, n) => base.filter(c => getPlayerRarity(c) === rarity).slice(-n).map(cardKey);

  it('has the limits the design set', () => {
    expect([TRADE_MAX_CARDS, TRADE_MIN_SHARE, TRADE_OFFER_DAYS, TRADE_OPEN_MAX, TRADE_FRIEND_DAYS]).toEqual([5, 0.6, 3, 5, 7]);
  });

  it('is worth the market value of its cards', () => {
    expect(tradeValue(of('rare', 2))).toBe(1200);
    expect(tradeValue(of('common', 5))).toBe(200);
    expect(tradeValue([])).toBe(0);
  });

  // The table the user approved, 2026-11-02.
  it.each([
    ['5 commons for a rare', () => [of('common', 5), of('rare', 1)], false],
    ['5 uncommons for a rare', () => [of('uncommon', 5), of('rare', 1)], true],
    ['2 rares for a super rare', () => [of('rare', 2), of('super-rare', 1)], true],
    ['2 super rares for a legendary', () => [of('super-rare', 2), of('legendary', 1)], true],
    ['5 rares for a legendary', () => [of('rare', 5), of('legendary', 1)], true],
    ['1 rare for a super rare', () => [of('rare', 1), of('super-rare', 1)], false],
    ['4 rares for a legendary', () => [of('rare', 4), of('legendary', 1)], false],
  ])('%s', (_, sides, ok) => {
    const [give, get] = sides();
    expect(tradeProblem(give, get) === null).toBe(ok);
    expect(tradeProblem(get, give) === null).toBe(ok);
  });

  it('gives the share of the lower side', () => {
    expect(tradeShare(of('rare', 2), of('super-rare', 1))).toBeCloseTo(0.6);
    expect(tradeShare([], of('rare', 1))).toBe(0);
  });

  it('needs a card on each side', () => {
    expect(tradeProblem([], of('rare', 1))).toMatch(/each side/);
    expect(tradeProblem(of('rare', 1), [])).toMatch(/each side/);
  });

  it('holds five a side at most', () => {
    expect(tradeProblem(of('common', 6), of('common', 1))).toMatch(/Five/);
  });

  it('may hold two copies of one card, but not one card on both sides', () => {
    const [k] = of('rare', 1);
    const [other] = more('rare', 2).slice(1);
    expect(tradeProblem([k, k], [other, ...more('rare', 2).slice(0, 1)])).toBeNull();
    expect(tradeProblem([k], [k])).toMatch(/both sides/);
  });

  it('is player cards only', () => {
    expect(tradeProblem(['high_screen_roll'], of('common', 1))).toMatch(/player cards/i);
    expect(tradeProblem(of('common', 1), ['no:such_card'])).toMatch(/player cards/i);
  });
});

describe('picking a card for a trade', () => {
  it('adds a card, and takes it out on a second click', () => {
    expect(pickTradeCard([], 'a', 1)).toEqual(['a']);
    expect(pickTradeCard(['a'], 'a', 1)).toEqual([]);
  });

  it('adds a second copy when there is one, then takes them all out', () => {
    expect(pickTradeCard(['a'], 'a', 2)).toEqual(['a', 'a']);
    expect(pickTradeCard(['a', 'a'], 'a', 2)).toEqual([]);
  });

  it('stops at five', () => {
    expect(pickTradeCard(['a', 'b', 'c', 'd', 'e'], 'f', 1)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('how long two players have been friends', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 100 * DAY;

  it('counts a friendship from before dates were kept as old enough', () => {
    expect(friendsLongEnough({ uids: ['a'] }, 'a', now)).toBe(true);
  });

  it('wants seven days', () => {
    expect(friendsLongEnough({ since: { a: now - 6 * DAY } }, 'a', now)).toBe(false);
    expect(friendsLongEnough({ since: { a: now - 7 * DAY } }, 'a', now)).toBe(true);
  });
});
