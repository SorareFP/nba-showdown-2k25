// NBA Showdown 2K25 — Card Image Mapping

import { BASE_SET, getCardByKey } from './cardSets.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Get a player card's face from /public/cards/<set>/<id>.png — the studio's
 * batch export writes every set there (base 354, specials, WNBA). Accepts a
 * collection KEY ("Nikola_Jokic" or "super-season:Nikola_Jokic"): the set is
 * resolved from the key, with an explicit `set` argument as override. Cards
 * without a photo still have a face — the export renders their NO PHOTO frame.
 */
export function getPlayerImageUrl(playerKey, set) {
  const card = getCardByKey(playerKey);
  const dir = set ?? card?.set ?? (String(playerKey).includes(':') ? String(playerKey).split(':')[0] : BASE_SET);
  const id = card?.id ?? String(playerKey).split(':').pop();
  return `/nba-showdown-2k25/cards/${dir}/${id}.png`;
}

/**
 * Get strategy card image path from /public/cards/strats/.
 * Files are named strat_{cardId}.png
 */
export function getStratImagePath(cardId) {
  // These files live in public/cards/strats/strat_{cardId}.png
  // Vite serves public/ at the base URL
  return `/nba-showdown-2k25/cards/strats/strat_${cardId}.png`;
}
