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
 * THE TILE-SIZED FACE: /public/cards/thumbs/{set}/{id}.webp, a 420-px WebP
 * of ~30–50 KB against the 0.5–0.9 MB PNG. Every tile reads this; the
 * lightbox and the pack reveal keep the PNG. scripts/studio/thumbs.py writes
 * them (export.js runs it after every export), and a tile whose thumb is
 * missing falls back to the PNG through fallbackTo — so a face exported a
 * minute ago still shows.
 */
export function getPlayerThumbUrl(playerKey, set) {
  const card = getCardByKey(playerKey);
  const dir = set ?? card?.set ?? (String(playerKey).includes(':') ? String(playerKey).split(':')[0] : BASE_SET);
  const id = card?.id ?? String(playerKey).split(':').pop();
  return `/nba-showdown-2k25/cards/thumbs/${dir}/${id}.webp`;
}

export function getStratThumbPath(cardId) {
  return `/nba-showdown-2k25/cards/thumbs/strats/${cardId}.webp`;
}

/**
 * An onError handler that first retries with the full-size face, then does
 * whatever the tile did before (hide itself, usually). One retry, tracked on
 * the element, so a face that is missing everywhere does not loop.
 */
export function fallbackTo(fullUrl, then) {
  return e => {
    const img = e.currentTarget ?? e.target;
    if (fullUrl && img && !img.dataset.fellBack) {
      img.dataset.fellBack = '1';
      img.src = fullUrl;
      return;
    }
    then?.(e);
  };
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
