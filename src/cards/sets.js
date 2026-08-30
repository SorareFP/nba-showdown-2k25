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
//
// ── THERE ARE NOW FOUR SETS, AND THE LIST IS THE MODEL ──────────────────────
//
// This file used to say "a set is a season", with two constants — CURRENT_SET
// and FINISHED_SET — and every consumer branching on which of the two it held.
// That stopped being true the moment the special sets arrived: Super Season and
// Rookie are not seasons at all, they are CARD TYPES cut across many seasons,
// and there will be more of them (Championship Standouts is designed and
// waiting; WNBA is its own).
//
// So the model is now a declared LIST — see SETS below — and every question the
// studio, the template or the server plugin used to answer by comparing against
// one of the two constants is answered by looking the set up. The two season
// constants survive because they still name something real (the set being built
// and the set already printed), not because anything branches on them.
//
// A set declares five things, and each exists because something downstream
// asked a question that could not be answered from the id:
//
//   id              the directory name under card-art/sets/ and public/cards/
//   name            what the studio prints on its selector
//   editable        whether photos and crops may be saved against it
//   hidesEmptyRows  whether a chart row that produces nothing at all is printed
//   showsSeason     whether the card prints the season it represents
//   badge           the card-type badge's text, or null
//   treatment       the set-level visual treatment, or null — see treatments.js

/** The set currently being built. Every studio write goes under this. */
export const CURRENT_SET = '2026-27';

/** The best-season rares. Card type, not a season — see docs and history.js. */
export const SUPER_SEASON_SET = 'super-season';

/** Rookie-year cards, one per player whose rookie year is not the one on his base card. */
export const ROOKIE_SET = 'rookie';

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

/**
 * Every set this tool knows about, in the order the studio offers them.
 *
 * DECLARATION, not derivation. Adding a set is adding a row here; nothing else
 * branches on a set id. The two season sets keep exactly the behaviour they had
 * before this list existed, and there is a test that pins both.
 */
export const SETS = [
  {
    // `name` is the set's NAME, with no noun after it: the studio writes
    // "Building the {name} set", so a name that already ends in "set" reads
    // "the 2026-27 set set".
    id: CURRENT_SET,
    name: CURRENT_SET,
    statsSeason: '2025-26',
    kind: 'season',
    editable: true,
    // The generator floors every chart with a blank 1-2 tier AND leaves a
    // no-scoring tier above it whose reb/ast usually round to zero as well; the
    // card prints neither. See hidesEmptyRows for why this is a set rule.
    hidesEmptyRows: true,
    // The base set is THIS season's cards. There is no other season it could be
    // mistaken for, so naming one would be noise — see showsSeason.
    showsSeason: false,
    badge: null,
    treatment: null,
  },
  {
    id: '2025-26',
    name: '2025-26',
    statsSeason: '2024-25',
    kind: 'season',
    // Finished and printed. Read-only: both lists derive player ids with the
    // same rule and share one photo store, so an upload made here would land in
    // another set under a name that player happens to share.
    editable: false,
    // 66 of its 306 cards print "1-2: 0,0,0" as a real hand-made bottom row.
    hidesEmptyRows: false,
    // Its legend cards DO print a season — but in the hand-made art, not from
    // the template. The reference view exists to match what was printed, so
    // the template must not draw a second one over it.
    showsSeason: false,
    badge: null,
    treatment: null,
  },
  {
    id: SUPER_SEASON_SET,
    name: 'Super Season',
    statsSeason: 'career-best season',
    kind: 'special',
    editable: true,
    // Generated by the same zero-floor path as the current set, so the same
    // structural row exists and the same rule hides it.
    hidesEmptyRows: true,
    // WHICH season this is IS the card. A Super Season card is a specific year
    // out of a career, so a card that does not name it is unreadable — the
    // finished set's legend cards print theirs for the same reason.
    showsSeason: true,
    // Uppercase because it is set on the card, not composed at render time:
    // every other label the card prints (SPEED, PAINT, SALARY) is written the
    // way it is drawn, and text-transform would hide the real string from the
    // width budget the badge is measured against.
    badge: 'SUPER SEASON',
    treatment: 'gold-foil',
  },
  {
    id: ROOKIE_SET,
    name: 'Rookie',
    statsSeason: 'rookie season',
    kind: 'special',
    editable: true,
    hidesEmptyRows: true,
    showsSeason: true,
    badge: 'ROOKIE',
    treatment: 'green-accent',
  },
];

const SETS_BY_ID = new Map(SETS.map(s => [s.id, s]));

/** The declared set with this id, or null. Own-property lookup, never a prototype hit. */
export function getSet(id) {
  return SETS_BY_ID.get(id) ?? null;
}

/** Just the ids, in declared order. */
export const SET_IDS = SETS.map(s => s.id);

/** Whether photos and crops may be written against this set. Unknown sets: no. */
export function isEditableSet(id) {
  return getSet(id)?.editable === true;
}

/**
 * The set-level visual treatment id, or null.
 *
 * Composes WITH the team's derived field theme rather than replacing it — see
 * src/cards/treatments.js. A set with no treatment renders exactly as it did
 * before treatments existed, which is what keeps the two season sets frozen.
 */
export function setTreatment(id) {
  return getSet(id)?.treatment ?? null;
}

/**
 * Does this set drop a chart row that produces NOTHING — no point, no rebound,
 * no assist?
 *
 * A SET-LEVEL RULE, NOT A SHAPE MATCH, and the difference is the whole reason
 * this function exists. Both sets can print a bottom row reading "1-2: 0,0,0",
 * and they mean opposite things:
 *
 *   2026-27  The generator floors every chart with a blank tier on rolls 1-2
 *            (scripts/cardgen/zeroFloor.js) so the engine can resolve a natural
 *            1 or 2 — the same two rolls engine.js hands a cold marker for. It
 *            is structure. Printing it costs a row of a five-row table to say
 *            something every card in the set says, and the row is needed for
 *            the no-scoring tier above it. Hidden.
 *
 *   2025-26  66 of the 306 finished cards print "1-2: 0,0,0" as a REAL bottom
 *            row, hand-made, and the reference set exists so the template can
 *            be judged against the cards as they were actually printed. Shown.
 *
 * Matching on shape alone cannot tell those apart — they are the same three
 * numbers over the same two rolls — so it would silently delete a row from 66
 * finished cards. Asking which SET a card belongs to always can.
 *
 * ── WHY THIS IS NO LONGER JUST THE BLANK TIER ───────────────────────────────
 *
 * It was `hidesBlankTier`, and it hid exactly one row: the structural 1-2 floor.
 * But the NO-SCORING tier directly above it is `pts: 0` with reb and ast taken
 * from the player's real bottom decile, and on most of the pool those two round
 * to zero as well — so the card printed a second row that also said nothing.
 * The user's call: "You can hide all 0-0-0 lines fwiw, like Jalen Brunson's
 * 'Roll: 3 - 0-0-0' Line". The justification is the blank tier's, unchanged:
 * every roll below the lowest PRINTED row implicitly produces nothing, so a row
 * spelling that out is redundant ink. A row carrying a rebound — Rudy Gobert's
 * "3-4 | 0 | 1 | 0" — is not empty and still prints, which is exactly the case
 * the no-scoring tier exists for.
 *
 * Unknown sets print everything. That is the fail-loud default: an unprinted
 * row that should have shown is invisible, while an extra row overflows the
 * chart into the photo frame and trips CardTemplate.test.js's height check.
 *
 * A lookup in SETS rather than a comparison against CURRENT_SET, so the two
 * special sets — whose charts come out of the same zero-floored generator — get
 * the right answer without this function growing a branch per set.
 */
export function hidesEmptyRows(set) {
  return getSet(set)?.hidesEmptyRows === true;
}

/**
 * Does this set print the SEASON its cards represent?
 *
 * Only the sets that cut across seasons. A Super Season or Rookie card is one
 * specific year out of a career and is unreadable without it; a base-set card
 * is this season by definition, so naming the season would be noise. The
 * finished 2025-26 set draws its legend cards' seasons in the ART — measured at
 * a 12px cap height in the sidebar, directly above the team mark — so the
 * template must not print a second one over the top of them.
 */
export function showsSeason(set) {
  return getSet(set)?.showsSeason === true;
}

/**
 * The card-type badge's text for this set, or null.
 *
 * TEXT ONLY. What COLOUR the badge is comes from the set's treatment (gold for
 * Super Season, the team's own accent for Rookie — see treatments.js), because
 * that is a question about the palette and every other palette question on this
 * card is answered there by measured contrast rather than by a literal.
 */
export function setBadge(set) {
  return getSet(set)?.badge ?? null;
}

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
