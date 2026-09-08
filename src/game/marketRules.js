// THE MARKET'S PRICE RULES, shared by the browser and the Cloud Functions.
//
// A spare is worth its burn value the moment it is pulled — burnCard pays it
// on demand — so a listing below that number is a card sold for less than
// its own scrap price, which nobody means and a script could exploit to move
// coins around. The rule (the user, 2026-09-08): a card may not be listed
// below its burn price. It lives here, once, so the server's listCard, the
// client's direct route and the collection's sell form all draw the same
// line; functions/prepare.mjs copies this file into the server bundle.
import { getCardByKey } from './cardSets.js';
import { getStrat } from './strats.js';
import { getPlayerRarity, getStratRarity, BURN_VALUES, STRAT_BURN_VALUES } from './rarity.js';

/**
 * What a spare of this card is worth when burned — from the card's rarity,
 * never from the caller. Null for a key that is not a card at all.
 */
export function burnValueFor(cardKey) {
  const card = getCardByKey(cardKey);
  const strat = card ? null : getStrat(cardKey);
  const value = card
    ? BURN_VALUES[getPlayerRarity(card)]
    : strat ? STRAT_BURN_VALUES[getStratRarity(strat)] : undefined;
  return Number.isFinite(value) ? value : null;
}

/** The least a listing may ask: the card's burn value. */
export function listingFloor(cardKey) {
  return burnValueFor(cardKey);
}

/**
 * May this card be listed at this price? `{ ok, floor, msg }` — the message
 * is what the seller is told, on either route.
 */
export function checkListingPrice(cardKey, price) {
  const floor = listingFloor(cardKey);
  if (floor == null) return { ok: false, floor: null, msg: 'That card cannot be listed' };
  if (!(Number.isInteger(price) && price >= floor)) {
    return { ok: false, floor, msg: `Price must be at least ${floor} coins — a listing never goes below the card's burn value` };
  }
  return { ok: true, floor, msg: null };
}
