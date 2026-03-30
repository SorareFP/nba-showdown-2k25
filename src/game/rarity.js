// src/game/rarity.js — Rarity utilities, weights, burn values
import { CARDS } from './cards.js';
import { STRATS } from './strats.js';

// Player rarity derived from salary
export function getPlayerRarity(card) {
  const s = card.salary || 0;
  if (s >= 900) return 'super-rare';
  if (s >= 700) return 'rare';
  if (s >= 450) return 'uncommon';
  return 'common';
}

// Strategy rarity from the rarity field
export function getStratRarity(strat) {
  return strat.rarity || 'common';
}

// Get all player cards by rarity
export function getPlayersByRarity(rarity) {
  return CARDS.filter(c => getPlayerRarity(c) === rarity);
}

// Get all strat cards by rarity
export function getStratsByRarity(rarity) {
  return STRATS.filter(s => getStratRarity(s) === rarity);
}

// Target pull rates — these are the ACTUAL probabilities per pick,
// normalized by pool size so the ecosystem stays balanced.
export const PACK_WEIGHTS = {
  common: 0.65,
  uncommon: 0.25,
  rare: 0.08,
  'super-rare': 0.02,
};

// Rarity display config (colors, labels)
export const RARITY_CONFIG = {
  'common':     { label: 'Common',     color: '#94A3B8', bg: 'rgba(148,163,184,0.15)' },
  'uncommon':   { label: 'Uncommon',   color: '#4ADE80', bg: 'rgba(74,222,128,0.15)' },
  'rare':       { label: 'Rare',       color: '#60A5FA', bg: 'rgba(96,165,250,0.15)' },
  'super-rare': { label: 'Super Rare', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
};

// Burn values — players
export const BURN_VALUES = {
  'common': 2,
  'uncommon': 5,
  'rare': 45,
  'super-rare': 100,
};

// Burn values — strategy cards (nerfed: capped per deck so players have lots of extras)
export const STRAT_BURN_VALUES = {
  'common': 1,
  'uncommon': 2,
  'rare': 8,
};
