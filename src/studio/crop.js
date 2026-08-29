// Crop math for the studio's pan/zoom editor.
//
// Crop is METADATA ({x, y, zoom}) applied to the photo as a CSS transform by
// src/cards/photo.js — the file dropped into card-art/photos/ is never touched.
// Everything here is pure so the one piece that is genuinely easy to get wrong
// — converting a mouse movement in scaled-preview pixels into a percentage of
// the card's photo window — is tested rather than eyeballed.
import { DEFAULT_CROP } from '../cards/photo.js';

/**
 * The photo window's position and size within the 843x1181 card.
 *
 * MUST match .photoOuter + .photoWindow in src/cards/CardTemplate.module.css:
 * left/top are the two nested offsets summed (150+5, 110+5), width/height are
 * the inner window's. crop.test.js parses that stylesheet and fails if these
 * drift, because a stale value here makes the drag overlay sit off the photo
 * and makes every pan translate by the wrong amount.
 */
export const PHOTO_WINDOW = { left: 155, top: 115, width: 673, height: 796 };

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;

/**
 * How far the photo may be pushed, as a percentage of the window.
 *
 * At the maximum 3x zoom the image overhangs the window by 100% of it in each
 * direction, so 200 is well past any useful framing while still stopping a
 * runaway drag from flinging the photo somewhere it can't be found.
 */
const PAN_LIMIT = 200;

/** Two decimals: enough precision to be invisible, keeps crops.json readable. */
const round = n => Math.round(n * 100) / 100;

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/** A complete, finite crop — fills in defaults and rejects garbage values. */
export function normalizeCrop(crop) {
  const merged = { ...DEFAULT_CROP, ...(crop ?? {}) };
  return {
    x: Number.isFinite(merged.x) ? clamp(merged.x, -PAN_LIMIT, PAN_LIMIT) : DEFAULT_CROP.x,
    y: Number.isFinite(merged.y) ? clamp(merged.y, -PAN_LIMIT, PAN_LIMIT) : DEFAULT_CROP.y,
    zoom: clampZoom(merged.zoom),
  };
}

export function clampZoom(zoom) {
  if (!Number.isFinite(zoom)) return DEFAULT_CROP.zoom;
  return round(clamp(zoom, ZOOM_MIN, ZOOM_MAX));
}

/**
 * Moves the photo by a mouse drag.
 *
 * `dx`/`dy` are the movement in SCREEN pixels; `scale` is the preview's
 * transform scale. Dividing by it is the whole point: the preview is shown at
 * roughly half size, so 100px of mouse travel is ~200px of card, and without
 * the correction the photo crawls along at half the cursor's speed.
 *
 * The result is a percentage of the photo window because that is what the CSS
 * translate() takes — and because a percentage means the same framing whether
 * the card is previewed at 40% or screenshotted at full size for export.
 *
 * Note it does NOT divide by zoom: `translate(x%, y%) scale(z)` composes as
 * translate-then-scale, so the translation happens in the card's own
 * coordinate space and a given percentage moves the image the same distance at
 * every zoom level. Dividing by zoom here would make zoomed-in drags lag the
 * cursor.
 *
 * Call this ONCE PER DRAG with the total delta since pointerdown, not once per
 * pointermove event with the step: the two-decimal rounding below is invisible
 * on a single application but accumulates over the hundreds of events a real
 * drag produces. CropEditor holds the crop as of pointerdown for this reason.
 */
export function panCrop(crop, { dx = 0, dy = 0, scale = 1 } = {}) {
  const base = normalizeCrop(crop);
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const ddx = Number.isFinite(dx) ? dx : 0;
  const ddy = Number.isFinite(dy) ? dy : 0;
  return {
    ...base,
    x: round(clamp(base.x + (ddx / s / PHOTO_WINDOW.width) * 100, -PAN_LIMIT, PAN_LIMIT)),
    y: round(clamp(base.y + (ddy / s / PHOTO_WINDOW.height) * 100, -PAN_LIMIT, PAN_LIMIT)),
  };
}

/** Sets an absolute zoom, e.g. from the slider. */
export function setZoom(crop, zoom) {
  return { ...normalizeCrop(crop), zoom: clampZoom(zoom) };
}

/**
 * Zooms by a wheel gesture.
 *
 * Scaled so one notch of a typical mouse wheel (deltaY ~100) is a 10% step,
 * and inverted so scrolling up — away from you — zooms in, matching every map
 * and image viewer.
 */
export function zoomByWheel(crop, deltaY) {
  const base = normalizeCrop(crop);
  const step = Number.isFinite(deltaY) ? -deltaY * 0.001 : 0;
  return { ...base, zoom: clampZoom(base.zoom + step) };
}

/** A fresh default crop. Returns a copy so callers can't mutate DEFAULT_CROP. */
export function resetCrop() {
  return { ...DEFAULT_CROP };
}

/** True when a crop is untouched — used to disable the reset control. */
export function isDefaultCrop(crop) {
  const c = normalizeCrop(crop);
  return c.x === DEFAULT_CROP.x && c.y === DEFAULT_CROP.y && c.zoom === DEFAULT_CROP.zoom;
}

/**
 * Drops default crops out of the persisted map.
 *
 * Every player the user merely clicks past would otherwise get an entry, and
 * crops.json is tracked in git — it should record decisions, not visits.
 */
export function pruneCrops(crops) {
  const out = {};
  for (const [id, crop] of Object.entries(crops ?? {})) {
    if (!isDefaultCrop(crop)) out[id] = normalizeCrop(crop);
  }
  return out;
}
