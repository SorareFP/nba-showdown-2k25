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
