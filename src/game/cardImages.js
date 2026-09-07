// NBA Showdown 2026 — Card Image Mapping

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
 * A strategy card's face, from /public/cards/strats/{id}.png.
 *
 * NAMED LIKE EVERY OTHER SET NOW. These were `strat_{id}.png` — a prefix from
 * the hand-made faces of the old set, which predated the batch exporter and the
 * one-directory-per-set rule it established. Those 42 legacy faces were cleared
 * when the deck was rebuilt; the exporter writes all 51 here under the same
 * `{id}.png` convention the player sets use, so nothing has to remember that
 * this one directory is spelled differently.
 */
export function getStratImagePath(cardId) {
  return `/nba-showdown-2k25/cards/strats/${cardId}.png`;
}
