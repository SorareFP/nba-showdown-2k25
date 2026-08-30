// Card SETS — which season's cards a path belongs to.
//
// WHY THIS FILE EXISTS: the finished 2025-26 cards are ~300 hand-made PNGs
// sitting at public/cards/players/{id}.png, and the studio derives ids for the
// new season with the SAME rule. A batch export with no set in its path would
// overwrite a season of art that cannot be regenerated. Set-scoping every
// working file and every output makes that collision impossible rather than
// merely unlikely.
//
// The set id is declared ONCE, here. Nothing else in the tree should contain
// the literal '2026-27' — starting the next season is meant to be a one-line
// edit, not a search-and-replace.

/** The set currently being built. Every studio write goes under this. */
export const CURRENT_SET = '2026-27';

/**
 * The season whose STATS the current set is built from.
 *
 * TWO DIFFERENT SEASONS ARE ON SCREEN IN THE STUDIO AT ONCE, and confusing
 * them is the whole reason this constant exists rather than a literal in a
 * label. A set is named for the season it will be PLAYED in; the numbers
 * printed on it come from the season just finished. So:
 *
 *   2024-25 stats  ->  the 2025-26 set  (FINISHED — the ~300 cards on disk)
 *   2025-26 stats  ->  the 2026-27 set  (BEING BUILT here)
 *
 * The player pool the studio lists is named for its stats season, which is why
 * a "2025-26 pool" builds a "2026-27 set" and neither label is a typo.
 */
export const STATS_SEASON = '2025-26';

/**
 * The finished set.
 *
 * Its cards live at the FLAT legacy path `public/cards/players/{id}.png` —
 * where src/game/cardImages.js resolves them for the running game — and they
 * stay there. They are not regenerated, not moved, and nothing in the studio
 * writes anywhere near them. Recorded here only so the name has a home.
 */
export const FINISHED_SET = '2025-26';

/**
 * The stats season behind the finished set — the other half of the pairing
 * described on STATS_SEASON. It sits one season back from FINISHED_SET for
 * exactly the same reason STATS_SEASON sits one back from CURRENT_SET.
 */
export const FINISHED_STATS_SEASON = '2024-25';

/** Working files root. Outside public/ — photos are inputs, not shipped assets. */
export const ART_ROOT = 'card-art';

/**
 * Every path a set owns, project-root-relative and POSIX-separated.
 *
 * Returned as plain strings rather than resolved absolutes so the same helper
 * serves the Node dev-server plugin (which resolves them against the Vite root)
 * and the browser (which uses them as URLs).
 */
export function setPaths(set = CURRENT_SET) {
  const root = `${ART_ROOT}/sets/${set}`;
  return {
    set,
    root,
    photos: `${root}/photos`,
    crops: `${root}/crops.json`,
    teamOverrides: `${root}/team-overrides.json`,
    // Where a batch export of THIS set writes. Deliberately not
    // public/cards/players/ — see FINISHED_SET.
    cards: `public/cards/${set}`,
  };
}

/**
 * The extension a photo UPLOADED through the studio is stored under.
 *
 * The upload route rewrites whatever bytes it is handed to `{id}.jpg`, so this
 * is the right answer for anything the studio itself wrote, and it stays the
 * default here for exactly that reason.
 */
export const DEFAULT_PHOTO_EXT = '.jpg';

/**
 * Photo extensions a set will serve. Mirrors ALLOWED_PHOTO_EXT in the server
 * plugin, and src/studio/api.js's isImageFile accepts the same set on drop.
 *
 * .avif earns its place the same way .jpeg did: it is what a browser's "Save
 * image as" produces on a growing share of sites, so photos saved by hand
 * arrive under it, and every browser that can run this studio can display it.
 */
export const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];

/**
 * Normalizes an extension to the dotted lowercase form the paths use.
 *
 * Accepts "png", ".PNG" or ".png" and returns ".png"; anything not on the
 * allowed list falls back to the default rather than being interpolated into a
 * path. Callers pass values that ultimately came off a directory listing, so
 * "reject and fall back" beats "trust and 404".
 */
export function normalizePhotoExt(ext) {
  if (typeof ext !== 'string' || ext === '') return DEFAULT_PHOTO_EXT;
  const dotted = (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase();
  return PHOTO_EXTENSIONS.includes(dotted) ? dotted : DEFAULT_PHOTO_EXT;
}

/**
 * The browser URL for a curated photo. Leading slash: served at the bare path.
 *
 * THE EXTENSION IS A PARAMETER because the photos directory does not only
 * contain .jpg. Photos are saved by hand as often as they are dropped on the
 * studio, and a browser's "Save image as" writes .jpeg or .png — files the
 * server already lists (ALLOWED_PHOTO_EXT) and already serves, and which the
 * studio therefore counts as present. Hardcoding `.jpg` here made every one of
 * them resolve to a path with no file behind it: the player showed as having a
 * photo and rendered a broken image. The state endpoint reports the real
 * extension per player; this turns it into the URL.
 */
export function photoUrlPath(playerId, set = CURRENT_SET, ext = DEFAULT_PHOTO_EXT) {
  return `/${setPaths(set).photos}/${playerId}${normalizePhotoExt(ext)}`;
}
