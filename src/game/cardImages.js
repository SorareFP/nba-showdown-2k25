// NBA Showdown 2K25 — Card Image Mapping

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Get player card image path from /public/cards/players/.
 * Files are named {playerId}.png (e.g. Anthony_Davis.png)
 * Returns null for the few players without images.
 */
export function getPlayerImageUrl(playerId) {
  return `/nba-showdown-2k25/cards/players/${playerId}.png`;
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
