// Photo resolution and crop metadata for card art.
//
// Crop is stored as METADATA, never baked into the source image. The original
// file dropped into card-art/photos/ is left byte-identical forever, so a crop
// can be redone later without re-sourcing the photo, and a template change can
// never destroy work already done.

/** Neutral crop: centered, no zoom. */
export const DEFAULT_CROP = { x: 0, y: 0, zoom: 1 };

const HEADSHOT_BASE = 'https://cdn.nba.com/headshots/nba/latest/1040x760';

/**
 * Picks the image for a player.
 *
 * Curated action photos are the intended art for every card. The NBA headshot
 * CDN is only a fallback so a player without a curated photo yet still renders
 * a complete card instead of a hole — it is not the target look.
 *
 * Returns null when neither is available; callers render a placeholder.
 */
export function resolvePhotoUrl({ playerId, hasPhoto, personId } = {}) {
  if (hasPhoto) return `/card-art/photos/${playerId}.jpg`;
  if (personId) return `${HEADSHOT_BASE}/${personId}.png`;
  return null;
}

/**
 * Converts crop metadata into an inline style for the photo element.
 *
 * x/y are percentages of the photo's own box, so the same crop reads the same
 * whether the card is previewed scaled down in the studio or screenshotted at
 * full 843x1181 for export.
 */
export function cropToStyle(crop = DEFAULT_CROP) {
  const { x, y, zoom } = { ...DEFAULT_CROP, ...crop };
  return {
    transform: `translate(${x}%, ${y}%) scale(${zoom})`,
    transformOrigin: 'center center',
  };
}
