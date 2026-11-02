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
import { getPlayerRarity, getStratRarity, notionalPrice, BURN_VALUES, STRAT_BURN_VALUES } from './rarity.js';

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

// ── TRADES BETWEEN FRIENDS (2026-11-02) ─────────────────────────────────────
// docs/plans/2026-11-02-friend-trades-design.md. The user: "card(s) for card(s)
// ... some sort of salary/rarity buffer so someone isn't just trading commons
// for legendaries". The one rule for the trade screen's meter and the server,
// which runs it again at accept: a Live card can change rarity overnight.

/** Cards a side. Without a cap, enough commons would match anything. */
export const TRADE_MAX_CARDS = 5;
/** The lower side's least share of the higher, by market value. */
export const TRADE_MIN_SHARE = 0.6;
export const TRADE_OFFER_DAYS = 3;
/** Offers one player may have open; a counter does not count. */
export const TRADE_OPEN_MAX = 5;
/** How long two players must have been friends: the guard against a second account feeding a main. */
export const TRADE_FRIEND_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A side's market value (notionalPrice): what the game says a card of its rarity costs. */
export const tradeValue = keys => (keys ?? []).reduce((sum, key) => sum + (notionalPrice(getCardByKey(key)) ?? 0), 0);

/** The lower side as a share of the higher, 0 to 1. */
export function tradeShare(give, get) {
  const [a, b] = [tradeValue(give), tradeValue(get)];
  return a > 0 && b > 0 ? Math.min(a, b) / Math.max(a, b) : 0;
}

/** Null when these two sides may trade, else why not, as the player is told it. */
export function tradeProblem(give, get) {
  if (!give?.length || !get?.length) return 'A trade needs a card on each side';
  if (give.length > TRADE_MAX_CARDS || get.length > TRADE_MAX_CARDS) return 'Five cards a side at most';
  if (![...give, ...get].every(key => getCardByKey(key))) return 'Trades are player cards only';
  if (give.some(key => get.includes(key))) return 'One card cannot be on both sides';
  const [a, b] = [tradeValue(give), tradeValue(get)];
  // In whole numbers: 1,200 against 2,000 is exactly the line.
  if (Math.min(a, b) * 100 < Math.max(a, b) * Math.round(TRADE_MIN_SHARE * 100)) return 'Too uneven: the lower side must be at least 60% of the higher';
  return null;
}

/**
 * A click on a card: one more copy while there are copies and room, else out.
 * `available` is how many spares of it the owner has.
 */
export function pickTradeCard(list, key, available) {
  const held = list.filter(k => k === key).length;
  if (held < available && list.length < TRADE_MAX_CARDS) return [...list, key];
  return held ? list.filter(k => k !== key) : list;
}

/** `myDoc` is the caller's friends document; a friendship from before dates were kept is old enough. */
export function friendsLongEnough(myDoc, otherUid, now) {
  const since = myDoc?.since?.[otherUid];
  return since == null || now - since >= TRADE_FRIEND_DAYS * DAY_MS;
}
