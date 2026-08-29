// Photo resolution and crop metadata for card art.
//
// Crop is stored as METADATA, never baked into the source image. The original
// file dropped into card-art/photos/ is left byte-identical forever, so a crop
// can be redone later without re-sourcing the photo, and a template change can
// never destroy work already done.

/** Neutral crop: centered, no zoom. */
export const DEFAULT_CROP = { x: 0, y: 0, zoom: 1 };

/**
 * The photo window's position and size within the 843x1181 card.
 *
 * MUST match .photoOuter + .photoWindow in CardTemplate.module.css: left/top
 * are the two nested offsets summed (150+5, 110+5), width/height are the inner
 * window's. src/studio/crop.test.js parses that stylesheet and fails if these
 * drift, because a stale value here makes the studio's drag overlay sit off the
 * photo and makes every pan translate by the wrong amount.
 *
 * Lives here rather than in the studio because cropToStyle needs it too, and
 * the crop math must not depend on the studio to render a card.
 */
export const PHOTO_WINDOW = { left: 155, top: 115, width: 673, height: 796 };

const HEADSHOT_BASE = 'https://cdn.nba.com/headshots/nba/latest/1040x760';

/**
 * Picks the image for a player.
 *
 * Curated action photos are the intended art for every card. The NBA headshot
 * CDN is only a fallback so a player without a curated photo yet still renders
 * a complete card instead of a hole — it is not the target look.
 *
 * `version` is a cache-busting token, NOT decoration. Replacing a photo
 * rewrites `{id}.jpg` in place, so the URL is unchanged and the browser happily
 * re-shows the bytes it already has — the new image simply does not appear.
 * Remounting the <img> does not help: the reused decoded image lives in the
 * browser's memory cache, not in the React tree. A changed query string is the
 * only thing that reliably forces a re-fetch. The studio passes a fresh token
 * on every upload; the batch export passes none, because a headless browser
 * launched per run has nothing cached.
 *
 * Returns null when neither is available; callers render a placeholder.
 */
export function resolvePhotoUrl({ playerId, hasPhoto, personId, version } = {}) {
  if (hasPhoto) {
    const url = `/card-art/photos/${playerId}.jpg`;
    return version == null || version === '' ? url : `${url}?v=${encodeURIComponent(version)}`;
  }
  if (personId) return `${HEADSHOT_BASE}/${personId}.png`;
  return null;
}

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const round = n => Math.round(n * 100) / 100;

/** `calc(50% + 12px)` / `calc(50% - 12px)` — never `calc(50% + -12px)`. */
function offsetTerm(px) {
  const n = round(px);
  return n < 0 ? `calc(50% - ${-n}px)` : `calc(50% + ${n}px)`;
}

/**
 * One axis of object-position, held inside the source image.
 *
 * `clamp(100%, V, 0%)` looks backwards and is not. For an image fitted with
 * `object-fit: cover` the content is LARGER than the box, so the percentage
 * axis runs opposite to the offset: 0% pins the image's left edge to the box's
 * left edge (offset 0, the furthest right it can sit) and 100% pins its right
 * edge to the box's right edge (offset box−content, the furthest left). clamp()
 * is defined as max(MIN, min(VAL, MAX)), so passing them in this order confines
 * the offset to exactly the range in which the image still covers the box.
 *
 * THIS is what makes panning safe: the browser resolves those percentages
 * against the real source dimensions, which this code never sees, so a pan can
 * reach the true edge of any photo and cannot go one pixel past it. When the
 * photo's aspect ratio matches the window there is no overflow at all, 0% and
 * 100% collapse to the same value, and the axis simply does not pan — correct,
 * not broken. Zooming in is what creates room on that axis (see cropToStyle).
 */
function objectPositionAxis(px) {
  return `clamp(100%, ${offsetTerm(px)}, 0%)`;
}

/**
 * Converts crop metadata into an inline style for the photo element.
 *
 * x/y are a percentage of the PHOTO WINDOW, and they mean "shift the visible
 * photo this far", so the same crop reads the same whether the card is
 * previewed scaled down in the studio or screenshotted at full 843x1181 for
 * export. That is the same meaning, and the same numbers, the earlier
 * `translate(x%, y%)` implementation had — saved crops carry over unchanged.
 *
 * What changed is WHERE the shift is applied. Translating the <img> alone slid
 * a photo that `object-fit: cover` had already trimmed to the window, so
 * panning walked the picture off the edge and left the window's background
 * behind it — the photo's other 60% was unreachable. The shift is now split
 * across the two places it can go, which turn out to be exactly complementary:
 *
 *   object-position  moves the source image inside the cover crop. This is the
 *                    whole pan at zoom 1, and it is bounded by the browser to
 *                    the image's real edges (see objectPositionAxis). Divided
 *                    by zoom because it is measured in the element's own
 *                    pre-scale pixels.
 *
 *   translate        moves the magnified element across the window. At zoom z
 *                    the element overhangs the window by width*(z-1)/2 on each
 *                    side, and moving it that far is exactly what keeps the
 *                    window covered — which is why this is clamped here, in
 *                    pixels the CSS cannot work out for itself.
 *
 * Their two ranges sum to (source_width * cover * zoom - window_width) / 2,
 * the full travel of a normal image cropper, with no gap and no overlap. The
 * window is therefore covered by photo at every reachable crop, at every zoom.
 */
export function cropToStyle(crop = DEFAULT_CROP) {
  const merged = { ...DEFAULT_CROP, ...(crop ?? {}) };
  const zoom = Number.isFinite(merged.zoom) && merged.zoom > 0 ? merged.zoom : DEFAULT_CROP.zoom;
  const x = Number.isFinite(merged.x) ? merged.x : DEFAULT_CROP.x;
  const y = Number.isFinite(merged.y) ? merged.y : DEFAULT_CROP.y;

  // The shift the crop asks for, in card pixels.
  const dx = (x / 100) * PHOTO_WINDOW.width;
  const dy = (y / 100) * PHOTO_WINDOW.height;

  // Spend the zoom overhang first — it is the part whose limit is knowable
  // without the source image — then hand the remainder to object-position.
  const overhangX = (PHOTO_WINDOW.width * (zoom - 1)) / 2;
  const overhangY = (PHOTO_WINDOW.height * (zoom - 1)) / 2;
  const tx = clamp(dx, -overhangX, overhangX);
  const ty = clamp(dy, -overhangY, overhangY);

  return {
    objectPosition: `${objectPositionAxis((dx - tx) / zoom)} ${objectPositionAxis((dy - ty) / zoom)}`,
    transform: `translate(${round(tx)}px, ${round(ty)}px) scale(${zoom})`,
    transformOrigin: 'center center',
  };
}
