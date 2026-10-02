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

/**
 * MAY A PLAYER BURN THIS CARD BY HAND? A player card, yes. A STRATEGY CARD,
 * NO (the user, 2026-10-02: "Please remove the burn-ability from strategy
 * cards, and just keep the auto-burn when a user exceeds a card's deck
 * limit"). A strategy copy leaves a collection one way now: the copy that
 * would take a card past its deck limit is burned on arrival, for its burn
 * value (recordMints and burnOverCap on the server, which price it with
 * burnValueFor and never ask this).
 *
 * Null when the burn may go ahead, else the reason, as the player is told it.
 * One rule for the server's burnCard, the direct route and the collection's
 * button, so a hidden button is never the only thing in the way.
 */
export const STRAT_BURN_REFUSAL = 'Strategy cards cannot be burned. A copy over a card\'s deck limit is burned for you.';
export function burnProblem(cardKey) {
  if (getCardByKey(cardKey)) return null;
  return getStrat(cardKey) ? STRAT_BURN_REFUSAL : 'That card cannot be burned';
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
