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
 * The finished set.
 *
 * Its cards live at the FLAT legacy path `public/cards/players/{id}.png` —
 * where src/game/cardImages.js resolves them for the running game — and they
 * stay there. They are not regenerated, not moved, and nothing in the studio
 * writes anywhere near them. Recorded here only so the name has a home.
 */
export const FINISHED_SET = '2025-26';

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

/** The browser URL for a curated photo. Leading slash: served at the bare path. */
export function photoUrlPath(playerId, set = CURRENT_SET) {
  return `/${setPaths(set).photos}/${playerId}.jpg`;
}
