// src/game/rarity.js — Rarity utilities, weights, burn values
import { CARDS } from './cards.js';
import { STRATS } from './strats.js';

// Player rarity derived from salary. LEGENDARY (approved 2026-09-03) is the
// apex band — 16 base cards at $1,200+ (Giannis $1,730 down to LaMelo) — with
// its own sliver of pull weight and NO place in any guarantee: "guaranteed
// super-rare" means exactly the $900-1,199 band, so the apex cards come only
// from the base odds. The salary thresholds survive the 2026-27 reprice with
// near-identical tier proportions to the shipped set.
export function getPlayerRarity(card) {
  const s = card.salary || 0;
  if (s >= 1200) return 'legendary';
  if (s >= 900) return 'super-rare';
  if (s >= 700) return 'rare';
  if (s >= 450) return 'uncommon';
  return 'common';
}

// Strategy rarity from the rarity field
export function getStratRarity(strat) {
  return strat.rarity || 'common';
}

// Ordered worst -> best, shared by every band computation.
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'super-rare', 'legendary'];

// Get all player cards by rarity
export function getPlayersByRarity(rarity) {
  return CARDS.filter(c => getPlayerRarity(c) === rarity);
}

// Get all strat cards by rarity
export function getStratsByRarity(rarity) {
  return STRATS.filter(s => getStratRarity(s) === rarity);
}

// Target pull rates — these are the ACTUAL probabilities per pick,
// normalized by pool size so the ecosystem stays balanced. Legendary at 0.3%
// means one apex card roughly every 67 boosters of 5 pulls.
export const PACK_WEIGHTS = {
  common: 0.65,
  uncommon: 0.25,
  rare: 0.08,
  'super-rare': 0.017,
  legendary: 0.003,
};

// Rarity display config (colors, labels)
export const RARITY_CONFIG = {
  'common':     { label: 'Common',     color: '#94A3B8', bg: 'rgba(148,163,184,0.15)' },
  'uncommon':   { label: 'Uncommon',   color: '#4ADE80', bg: 'rgba(74,222,128,0.15)' },
  'rare':       { label: 'Rare',       color: '#60A5FA', bg: 'rgba(96,165,250,0.15)' },
  'super-rare': { label: 'Super Rare', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  'legendary':  { label: 'Legendary',  color: '#A855F7', bg: 'rgba(168,85,247,0.18)' },
};

// Burn values — players
export const BURN_VALUES = {
  'common': 2,
  'uncommon': 5,
  'rare': 45,
  'super-rare': 100,
  'legendary': 250,
};

/**
 * MARKET PRICES — what a SPECIFIC card costs in coins.
 *
 * ── WHY A MARKET EXISTS AT ALL ──────────────────────────────────────────────
 *
 * Packs were the only source of cards, which made every card a lottery, and the
 * odds are per-card: a specific legendary is 0.3% spread over fourteen cards,
 * or one per ~933 boosters. Chasing one costs ~53,000 net coins — around seven
 * hundred games. That is fine for a card you stumble into and impossible for a
 * card you NEED, and team collections need thirty specific cards at a time.
 *
 * Note this is not a duplicate-protection problem: even with perfect dupe
 * protection the 0.3% rate over fourteen cards still means ~933 boosters to see
 * them all. The missing thing was never better luck, it was a way to CHOOSE.
 *
 * ── HOW THE NUMBERS WERE SET ────────────────────────────────────────────────
 *
 * Anchored so the hardest roster in the game is a season's goal rather than a
 * second job. Oklahoma City is the worst case — two legendaries and two
 * super-rares — and comes to ~15,500 coins, roughly 175 games. Brooklyn, the
 * easiest, is ~2,300, roughly 26. That 6.7x spread tracks the real difficulty
 * spread (264 to 1,595 boosters), so buying preserves the ordering that makes
 * some teams worth more to complete than others.
 *
 * EVERY PRICE IS 20x ITS BURN VALUE, deliberately and uniformly. The margin is
 * what stops the obvious exploit — buy a card, burn it, repeat — and holding
 * the ratio constant means burning a duplicate always funds the same fraction
 * of the card you actually wanted, whatever band it came from.
 */
export const MARKET_PRICES = {
  'common': 40,
  'uncommon': 100,
  'rare': 600,
  'super-rare': 2000,
  'legendary': 5000,
};

/**
 * Sets the market will not sell, at any price.
 *
 * EARNED CARDS MUST STAY EARNED. Team rewards are the payoff for completing a
 * roster and Dissonance is reward territory too — neither is in any pack. If
 * the market priced them off salary like everything else, the hardest
 * collection in the game would be purchasable for 5,000 coins and the entire
 * ladder would be decorative. `getMarketPrice` returning null is the whole
 * enforcement: `buyCard` refuses anything without a price.
 */
export const NOT_FOR_SALE = new Set(['team-rewards', 'wnba-team-rewards', 'set-rewards', 'wnba-set-rewards', 'dissonance']);

/**
 * What this specific card costs to buy outright.
 *
 * Null means "no price", which covers three different things on purpose: it is
 * not a player card, or its set is not for sale, or its salary is outside every
 * band. Every caller treats all three the same way — refuse the sale.
 */
export function getMarketPrice(card) {
  if (!card || NOT_FOR_SALE.has(card.set)) return null;
  return MARKET_PRICES[getPlayerRarity(card)] ?? null;
}

/**
 * What a card is WORTH by its rarity, whether or not it can be sold. The
 * market price is null for an untradable set (Dissonance), which is right for
 * the market and wrong for a collection goal: the goal's coins are a share of
 * the set's buy-out, and a set nobody can sell is not worth nothing to finish.
 */
export function notionalPrice(card) {
  if (!card) return null;
  return MARKET_PRICES[getPlayerRarity(card)] ?? null;
}

// Burn values — strategy cards (nerfed: capped per deck so players have lots of extras)
export const STRAT_BURN_VALUES = {
  'common': 1,
  'uncommon': 2,
  'rare': 8,
  // The apex band arrived with the 2026-09-07 reband. Priced at the same
  // multiple over rare that rare sits over uncommon, so the ladder keeps its
  // shape rather than acquiring a cliff at the top.
  'legendary': 30,
};

// Deck copy caps for STRATEGY cards, by rarity — the 5/3/1 rule. Enforced by
// the deck editor in place of the old flat 8-per-card cap.
export const STRAT_COPY_CAPS = {
  'common': 5,
  'uncommon': 3,
  'rare': 1,
};
