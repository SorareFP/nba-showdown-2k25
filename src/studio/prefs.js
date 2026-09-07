// Studio UI preferences that survive a reload.
//
// NOT the same thing as the studio's state. Photos, crops and team colours are
// the WORK, and they go through the dev-server plugin onto disk under
// card-art/sets/{id}/ where the generators can read them. What lives here is
// only how the tool is arranged for the person using it — which is nobody's
// data, belongs to one browser, and would be noise in a file the generators
// read. localStorage is the right size for that, and this is a dev-only tool
// served from one origin, so there is nothing else to weigh.
//
// EVERY ACCESS IS GUARDED. `localStorage` is not merely absent under vitest's
// node environment — it also THROWS on read in a browser configured to block
// site data, and on write when the origin's quota is full or the page is in a
// private context that refuses persistence. A preference that cannot be read is
// not an error condition; it is the default. So every path here falls back
// silently and the studio opens exactly as it would on a first visit.

/**
 * Whether the selector's reference-set group is expanded.
 *
 * Namespaced with a `studio.` prefix because this origin also serves the game
 * itself (index.html) out of the same dev server, and an unprefixed key would
 * be one collision away from meaning something else.
 */
export const SHOW_REFERENCE_SETS_KEY = 'studio.showReferenceSets';

/**
 * The store to use, or null when there isn't one.
 *
 * A PARAMETER with a default rather than a direct `localStorage` reference, so
 * the two functions below are testable without a DOM: vitest runs this project
 * in the node environment, where the global does not exist at all.
 */
function resolveStore(store) {
  if (store !== undefined) return store;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Reading the property itself throws in some blocked-storage contexts.
    return null;
  }
}

/**
 * Reads the stored boolean, defaulting to `fallback` when it is absent,
 * unreadable, or anything other than the two values this ever writes.
 *
 * Strict on the way in: a value left by an older build, or by hand in devtools,
 * must not be coerced into `true` just because it is a non-empty string.
 */
export function readFlag(key, fallback = false, store) {
  const s = resolveStore(store);
  if (!s) return fallback;
  try {
    const raw = s.getItem(key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Writes the boolean, and returns whether it actually landed.
 *
 * The return value is not decoration: a caller that has already updated its own
 * React state is still correct for this session when the write fails, so
 * nothing here throws — but the studio should never claim a preference is
 * remembered when it is not.
 */
export function writeFlag(key, value, store) {
  const s = resolveStore(store);
  if (!s) return false;
  try {
    s.setItem(key, value ? 'true' : 'false');
    return true;
  } catch {
    return false;
  }
}

/** The reference-set disclosure, read. Collapsed unless the user opened it. */
export function readShowReferenceSets(store) {
  return readFlag(SHOW_REFERENCE_SETS_KEY, false, store);
}

/** The reference-set disclosure, written. */
export function writeShowReferenceSets(value, store) {
  return writeFlag(SHOW_REFERENCE_SETS_KEY, value, store);
}

/**
 * SETS THE CURATOR HAS PUT AWAY.
 *
 * The user, 2026-09-07: "Is there a way I can hide completed sets in card
 * studio? I might need to unhide in the future to adjust photo placement, but
 * can you add a manual hide?" — and then "And an auto-hide when complete."
 *
 * So there are two ways a set leaves the bar and one way it comes back, which
 * is why this is three preferences rather than one list:
 *
 *   hiddenSets     put away BY HAND, whatever its progress
 *   autoHide       put away automatically once every card has a photo
 *   revealedSets   pulled back OUT by hand — the override that makes
 *                  auto-hide safe, because a finished set is exactly the one
 *                  you return to when a photo needs re-cropping
 *
 * A set is hidden when it is in `hiddenSets`, or when auto-hide is on and it
 * is complete and NOT in `revealedSets`. Nothing here can lose work: hiding is
 * a view, the photos and crops stay on disk either way.
 */
export const HIDDEN_SETS_KEY = 'studio.hiddenSets';
export const REVEALED_SETS_KEY = 'studio.revealedSets';
export const AUTO_HIDE_KEY = 'studio.autoHideComplete';

function readList(key, store) {
  try {
    const s = store ?? globalThis.localStorage;
    const raw = s?.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter(k => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(key, list, store) {
  try {
    const s = store ?? globalThis.localStorage;
    s?.setItem(key, JSON.stringify([...new Set(list.filter(k => typeof k === 'string'))]));
  } catch {
    /* a preference that cannot be written is not an error — see the note above */
  }
}

export const readHiddenSets = store => readList(HIDDEN_SETS_KEY, store);
export const writeHiddenSets = (list, store) => writeList(HIDDEN_SETS_KEY, list, store);
export const readRevealedSets = store => readList(REVEALED_SETS_KEY, store);
export const writeRevealedSets = (list, store) => writeList(REVEALED_SETS_KEY, list, store);
/** Auto-hide defaults ON — the user asked for it as the behaviour, not an opt-in. */
export const readAutoHide = store => readFlag(AUTO_HIDE_KEY, true, store);
export const writeAutoHide = (value, store) => writeFlag(AUTO_HIDE_KEY, value, store);

/**
 * Which sets are out of the bar, given what is hidden by hand, what is
 * complete, and what has been pulled back out. Pure, so the rule is testable
 * without a browser.
 */
export function hiddenSetKeys({ hidden = [], revealed = [], complete = [], autoHide = true } = {}) {
  const out = new Set(hidden);
  if (autoHide) for (const key of complete) if (!revealed.includes(key)) out.add(key);
  for (const key of revealed) if (!hidden.includes(key)) out.delete(key);
  return out;
}
