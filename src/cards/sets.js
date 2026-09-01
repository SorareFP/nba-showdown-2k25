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
//   badge           the card-type badge EVERY card in the set carries, by id,
//                   or null — see src/cards/badges.js
//   treatment       the set-level visual treatment, or null — see treatments.js

import { ROOKIE_BADGE, SUMMER_STANDOUT_BADGE, SUPER_SEASON_BADGE, tierBadge } from './badges.js';

/** The set currently being built. Every studio write goes under this. */
export const CURRENT_SET = '2026-27';

/** The best-season rares. Card type, not a season — see docs and history.js. */
export const SUPER_SEASON_SET = 'super-season';

/** Rookie-year cards, one per player whose rookie year is not the one on his base card. */
export const ROOKIE_SET = 'rookie';

/**
 * The WNBA set. A different LEAGUE, which is a third thing a set can be —
 * neither a season nor a card type.
 *
 * It is why `league` exists on a set below: everything else on a card is
 * team-derived or set-derived, but the league mark in the corner is neither,
 * and printing an NBA mark on a WNBA card would be a factual error on the face
 * of it — the same argument that put the Seattle SuperSonics in
 * HISTORICAL_TEAMS rather than mapping Kevin Durant's rookie card to OKC.
 */
export const WNBA_SET = 'wnba';

/**
 * The Summer Standouts — deep playoff runs, carded. A CARD TYPE like
 * `super-season`, and like `wnba-super-season` its roster is a NAMED LIST
 * rather than a rule: card-data/summer-standouts.json holds the picks and
 * card-data/standout-conflict-decisions.json the calls that shaped them.
 */
export const SUMMER_STANDOUTS_SET = 'summer-standouts';

/**
 * The WNBA legends set — sixteen retired greats, each on her best season.
 *
 * BOTH of the things a set can be at once, which is why it is its own id rather
 * than a flag on either of the two it resembles. It is a CARD TYPE cut across
 * seasons, exactly like `super-season`; and it is a LEAGUE, exactly like
 * `wnba`. Nothing about a Super Season card knows how to be a WNBA card — the
 * team table, the league mark and the whole generator differ — and nothing
 * about the WNBA set knows how to be historical.
 *
 * It is also the ONLY set in this file whose roster is a NAMED LIST rather than
 * a rule. See card-data/wnba-legends.json: the user named these players, and no
 * threshold can produce or withhold one.
 */
export const WNBA_SUPER_SEASON_SET = 'wnba-super-season';

/**
 * The WNBA Rookie set — each carded player's rookie season. The same pairing
 * with `wnba` that `rookie` has with the base set, and the same double life
 * `wnba-super-season` leads: a CARD TYPE and a LEAGUE at once. The archive
 * reaches the league's own 1997, so unlike the NBA side there is no season a
 * rookie year can hide behind.
 */
export const WNBA_ROOKIE_SET = 'wnba-rookie';

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
    // NO BLANKET BADGE — which is NOT the same as "no badges on this set".
    // 140 of its cards carry a badge in their own record: their best or first
    // season is the one this set is built from, so the separate Super Season
    // and Rookie sets have no card for them. 107 print SUPER SEASON and 33
    // print the dated ROOKIE pill. The badge is a CARD property now; this field
    // only says whether the SET puts one on every card. See src/cards/badges.js.
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
    // A BADGE ID, not the text on the pill — the text, the priority order and
    // the colour derivation all live in src/cards/badges.js, because the badge
    // is no longer a thing only a set can have. This row says "every card in
    // this set carries the Super Season badge", which is the same behaviour it
    // had when it held the string.
    // ── BOTH OF THESE ARE THE GILDED TIER'S ─────────────────────────────────
    //
    // 55 of the 210 cards in this set render exactly as declared here. The
    // other 155 cost less than SUPER_SEASON_MIN_SALARY, print BEST SEASON in
    // the team's accent, and take no treatment at all — see `cardTreatment`
    // below and `tierBadge` in badges.js. The row is not written as a pair
    // because the set genuinely declares one badge and one treatment; what the
    // salary decides is whether a given card is still in the tier they name.
    badge: SUPER_SEASON_BADGE,
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
    badge: ROOKIE_BADGE,
    treatment: 'green-accent',
  },
  {
    id: SUMMER_STANDOUTS_SET,
    name: 'Summer Standouts',
    statsSeason: 'playoff run',
    kind: 'special',
    editable: true,
    // Same zero-floored chart path as every generated set.
    hidesEmptyRows: true,
    // WHICH run this is IS the card — Kawhi in Toronto means 2019 and nothing
    // else. Same sentence as the Super Season row.
    showsSeason: true,
    badge: SUMMER_STANDOUT_BADGE,
    // No treatment: the run is marked by the pill and the season line. Gold
    // stays the Super Season tier's.
    treatment: null,
  },
  {
    id: WNBA_SET,
    name: 'WNBA',
    statsSeason: '2026',
    // A LEAGUE, not a season and not a card type. Its teams live in their own
    // table (WNBA_TEAMS in teams.js) and its cards are generated by
    // scripts/cardgen/wnba/, which shares every layer with the base set except
    // the ones a 40-minute game and a league with no BPM force it to re-derive.
    kind: 'league',
    league: 'WNBA',
    editable: true,
    // Generated by the same zero-floored chart path as the base set, so the
    // same structural rows exist and the same rule hides them.
    hidesEmptyRows: true,
    // NO SEASON ON THE CARD — a USER DECISION, and the reason is worth keeping
    // because the opposite reading is tempting. The season text exists for the
    // Super Season and Rookie sets, where WHICH season a card represents is the
    // whole point of the card. This is a CURRENT-season set, exactly like
    // `2026-27`, so it prints like `2026-27`: no season, no badge. That a WNBA
    // card sits beside an NBA card from a differently-numbered year is not a
    // reason to date it — the league mark already says why the numbering
    // differs, and the base set does not date itself either.
    //
    // The flag is set EXPLICITLY here rather than left to the `?? false`
    // default in showsSeason(), so that this stays a decision on the record
    // instead of an accident of omission. The card data still carries
    // `seasonLabel` (see cards-wnba.json) — this governs only whether it prints.
    showsSeason: false,
    // NO BADGE, deliberately. The badge names the card TYPE, and this set's
    // type is its league — which the mark in the top-left corner already says.
    // A pill reading WNBA under a mark reading WNBA is the same word twice.
    badge: null,
    // No visual treatment decided yet. It renders on the team's own derived
    // field theme, exactly as the base set does.
    treatment: null,
  },
  {
    id: WNBA_SUPER_SEASON_SET,
    name: 'WNBA Super Season',
    statsSeason: 'career-best season',
    // A CARD TYPE, like `super-season` — not a league, even though it carries
    // one. `kind` answers "what makes this a set", and what makes this one a
    // set is that every card in it is somebody's best year. The league is
    // carried in `league` below, which is what the mark in the corner reads.
    kind: 'special',
    league: 'WNBA',
    editable: true,
    hidesEmptyRows: true,
    // ── AND THIS ONE DOES PRINT ITS SEASON, UNLIKE THE OTHER WNBA SET ────────
    //
    // The `wnba` row above sets `showsSeason: false` with a paragraph of
    // argument, and none of it applies here. That set is a CURRENT-season set,
    // so naming its season would be noise; this one is a career-best set
    // spanning 1997 to 2024, and WHICH season a card is IS the card — the same
    // sentence the NBA Super Season row makes. Lauren Jackson has four seasons
    // anyone could argue for and a card that does not say which one it is
    // cannot be read.
    showsSeason: true,
    // The gold pill, the same badge the NBA Super Season set carries. It says
    // what KIND of card this is, and the kind is identical; the league mark in
    // the opposite corner is what says the rest.
    //
    // TIERED BY SALARY LIKE THE NBA SET, AND FIFTEEN OF THE SIXTEEN ARE GOLD.
    // Tina Charles' 2016 at $860 is the one that is not: it cleared the old
    // $700 line and does not clear the $900 one, so it prints BEST SEASON on
    // the team's own palette like any other demoted card. That is the argument
    // for not special-casing this set, arriving one threshold change after the
    // argument was made — `cardTreatment` asks the same question of every set
    // rather than of a list of set ids, so nothing here had to be edited for a
    // named roster of sixteen to stop being unanimous.
    badge: SUPER_SEASON_BADGE,
    treatment: 'gold-foil',
  },
  {
    id: WNBA_ROOKIE_SET,
    name: 'WNBA Rookie',
    statsSeason: 'rookie season',
    kind: 'special',
    league: 'WNBA',
    editable: true,
    hidesEmptyRows: true,
    // WHICH season a rookie card is IS the card, same as the NBA Rookie set.
    showsSeason: true,
    badge: ROOKIE_BADGE,
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
 * The treatment ONE CARD in that set actually renders with.
 *
 * A set declares its treatment for the tier it declares its badge for, and a
 * card demoted out of that tier does not get it. Today that means exactly one
 * thing — a Super Season card under SUPER_SEASON_MIN_SALARY prints BEST SEASON
 * and keeps its team's own palette, gold foil and all — but it is written as
 * the general sentence because the rule is general: "not make the tab gold for
 * anyone under [the line] salary" is one decision about the pill AND the foil,
 * and both halves have to come out of the same comparison or they will drift
 * into a gold band under a team-coloured pill. (The user said 700 when the tier
 * was introduced and 900 when it was moved; neither number appears here, which
 * is the point.)
 *
 * ── WHY IT ASKS `tierBadge` INSTEAD OF COMPARING THE SALARY ITSELF ──────────
 *
 * Because the comparison lives in exactly one place, and it is not this one.
 * This function names no salary, no threshold and no treatment id: it asks
 * whether the set's OWN declared badge still prints at the id the set declared,
 * and withholds the treatment when it does not. So the Rookie set is untouched
 * at every salary (its badge does not tier), the base and finished sets are
 * untouched because they declare no treatment to withhold, `wnba-super-season`
 * is covered without being named — none of its sixteen falls below the line
 * today, and the rule stays right if a future legend does — and a set that
 * declares a badge this build does not tier goes on rendering exactly as it
 * did.
 *
 * TAKES THE SALARY, NOT THE CARD, so this file still knows nothing about the
 * shape of a card record — the same reason `pickBadge` takes a list of ids.
 * Omitting it means gold, exactly as it does there.
 */
export function cardTreatment(set, salary) {
  const badge = setBadge(set);
  if (badge !== null && tierBadge(badge, salary) !== badge) return null;
  return setTreatment(set);
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
 * The card-type badge EVERY card in this set carries, BY ID, or null.
 *
 * AN ID, NOT A LABEL, and null here does not mean "no badge on this set". A
 * card carries its own badge ids as well (see `badges` on the card record and
 * `pickBadge` in badges.js); this is only the set's blanket one, unioned with
 * the card's by CardTemplate. The two special sets badge every card, so they
 * declare one; the base set badges 140 of 350, so it declares none and those
 * 140 say so in their own data.
 *
 * The text and the colour both live in src/cards/badges.js — the colour because
 * every palette question on this card is answered by measured contrast rather
 * than by a literal, and the text because it belongs with the colour.
 */
export function setBadge(set) {
  return getSet(set)?.badge ?? null;
}

/**
 * The season a set's cards are built FROM, as the row declares it.
 *
 * A PLAIN ACCESSOR, like setBadge and setLeague, and it hands back the prose
 * rows too ('career-best season', 'rookie season') rather than nulling them: a
 * set whose every card comes from a different year genuinely has no single
 * stats season, and saying so is more useful than pretending the field is
 * empty. Callers that need a real season label test for one — badgeLabel in
 * badges.js does, and it is the reason this accessor exists: a base-set card
 * prints no season line, so the ROOKIE pill has to get the year from the SET.
 *
 * Note the pairing this reads out, spelled out on STATS_SEASON above: the
 * 2026-27 set's stats season is 2025-26, which is why a 2026-27 rookie card
 * says "25-26 ROOKIE" and not "26-27 ROOKIE".
 */
export function setStatsSeason(set) {
  return getSet(set)?.statsSeason ?? null;
}

/**
 * The league a set belongs to, defaulting to the NBA.
 *
 * Read by CardTemplate to pick the mark in the card's top-left corner. A
 * DEFAULT rather than a required field, so every set that existed before the
 * WNBA arrived keeps its behaviour without being edited.
 */
export const DEFAULT_LEAGUE = 'NBA';

export function setLeague(id) {
  return getSet(id)?.league ?? DEFAULT_LEAGUE;
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
 * EVERY IMAGE FORMAT A CARD WILL DRAW, whatever the image is of.
 *
 * ── ONE LIST, BECAUSE THE SPLIT WAS THE BUG ─────────────────────────────────
 *
 * This started life as PHOTO_EXTENSIONS and governed player photos only. Team
 * logos and award marks resolved through `logoSrc` instead, which took whatever
 * extension the DATA spelled and could not consider another — so `/awards/AS`
 * was `.png` or it was nothing, and a user with `All-Star.webp` got a lettered
 * chip and no explanation. The user's question was the right one: "Can we
 * really only do pngs? I thought we changed things to be able to use other
 * formats." Half of it had been changed. This is the other half, and the way it
 * stays fixed is that there is now ONE list rather than two that agree today.
 *
 * Renamed rather than duplicated for exactly that reason. `DEFAULT_PHOTO_EXT`
 * and `normalizePhotoExt` stay photo-shaped — the studio's upload route really
 * does write `.jpg` and nothing else does — but WHICH FORMATS EXIST is not a
 * question about photos.
 *
 * Mirrored by ALLOWED_PHOTO_EXT in the server plugin (a test asserts it),
 * read by src/studio/api.js's isImageFile on drop, and walked by
 * `assetCandidates` in CardTemplate.jsx for logos and award marks.
 *
 * .avif earns its place the same way .jpeg did: it is what a browser's "Save
 * image as" produces on a growing share of sites, so images saved by hand
 * arrive under it, and every browser that can run this studio can display it.
 *
 * .jfif is the same story with a worse name. It IS a JPEG — same bytes, same
 * decoder — and it is what Chrome on Windows writes for a "Save image as" on a
 * site that serves `image/jpeg` without a filename. Found in the wild in this
 * repo twice: card-art/sets/wnba/photos/DiJonai_Carrington.jfif, which the
 * studio listed as no photo at all because the extension was not on this list,
 * and public/awards/All-Star MVP.jfif. Rejecting it would be rejecting a JPEG
 * for its spelling.
 *
 * ORDER IS PROBE ORDER for `assetCandidates`, which tries the extension the
 * data declared first and then the rest of this list in sequence. It is not
 * worth optimising — the alternatives are only reached for a file that is not
 * where the data said, and each miss is one 404 against a local static server.
 */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.avif'];

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
  return IMAGE_EXTENSIONS.includes(dotted) ? dotted : DEFAULT_PHOTO_EXT;
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
