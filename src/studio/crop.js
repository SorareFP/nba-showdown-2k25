// Crop math for the studio's pan/zoom editor.
//
// Crop is METADATA ({x, y, zoom}) turned into CSS by src/cards/photo.js — the
// file dropped into card-art/photos/ is never touched. Everything here is pure
// so the two pieces that are genuinely easy to get wrong —
// converting a mouse movement in scaled-preview pixels into a percentage of the
// card's photo window, and working out how far a given photo can actually be
// panned — are tested rather than eyeballed.
import { DEFAULT_CROP, PHOTO_WINDOW } from '../cards/photo.js';

// Re-exported because the drag overlay and the crop math are the two things
// that have to agree with the card's photo window, and both live here.
export { PHOTO_WINDOW };

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;

/**
 * Hard ceiling on a pan, as a percentage of the window.
 *
 * Only reached when the source image's dimensions are unknown (it has not
 * loaded yet, or failed to). Once they are known, panLimits below computes the
 * exact travel and this never binds. 400 clears the widest realistic source —
 * a 21:9 frame at 3x zoom needs ~364% — so an unloaded image is never
 * artificially fenced in, while a runaway drag still cannot fling the crop
 * somewhere it takes a thousand pixels of dragging to come back from.
 */
const PAN_LIMIT = 400;

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
 * The result is a percentage of the photo window because that is the unit
 * cropToStyle consumes — and because a percentage means the same framing
 * whether the card is previewed at 40% or screenshotted at full size for
 * export.
 *
 * Note it does NOT divide by zoom. x/y describe how far the visible photo
 * moves in the card's own coordinate space, so a given percentage is the same
 * on-screen distance at every zoom level; cropToStyle works out how much of
 * that the magnified element absorbs. Dividing by zoom here would make
 * zoomed-in drags lag the cursor.
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

/**
 * How far this particular photo can actually be panned, each way, as a
 * percentage of the photo window.
 *
 * cropToStyle already guarantees the window stays covered — the browser clamps
 * object-position against the real image. What it cannot do is stop the STORED
 * x/y from running past the edge, and a crop parked at 300% on a photo that
 * only travels 55% means the next drag back moves nothing for a thousand
 * pixels. So the studio clamps here, where the loaded image's dimensions are
 * known, and the picture stops exactly at its own edge.
 *
 * The geometry is a plain image cropper's: `object-fit: cover` scales the
 * source by whichever of the two window/source ratios is larger, zoom
 * magnifies that, and the overhang past the window is the travel.
 *
 * Falls back to PAN_LIMIT when the image is unmeasured, never to zero — a crop
 * that silently refuses to move would be a worse bug than the one this fixes.
 */
export function panLimits(zoom, image) {
  const z = clampZoom(zoom);
  const w = Number(image?.width);
  const h = Number(image?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { x: PAN_LIMIT, y: PAN_LIMIT };
  }
  const cover = Math.max(PHOTO_WINDOW.width / w, PHOTO_WINDOW.height / h);
  const travel = (shown, window) => Math.min(PAN_LIMIT, Math.max(0, ((shown - window) / 2 / window) * 100));
  return {
    x: travel(w * cover * z, PHOTO_WINDOW.width),
    y: travel(h * cover * z, PHOTO_WINDOW.height),
  };
}

/**
 * Pulls a crop back inside what the photo can reach.
 *
 * Applied by the editor after every pan and every zoom — zooming OUT shrinks
 * the travel, so a crop that was legal at 3x can be past the edge at 1.2x.
 */
export function clampCropToImage(crop, image) {
  const base = normalizeCrop(crop);
  const limits = panLimits(base.zoom, image);
  return {
    ...base,
    x: round(clamp(base.x, -limits.x, limits.x)),
    y: round(clamp(base.y, -limits.y, limits.y)),
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
