// The Card Studio's player list: where the records come from, and every pure
// operation the list UI performs on them.
//
// TWO SOURCES, deliberately:
//
//  - `pool` (the default) is the 2025-26 set the photos are actually being
//    curated FOR. It has names, teams and positions and nothing else — charts,
//    Speed/Power and salaries have not been generated yet — so cards from it
//    render mostly placeholders. That is correct: the photo is the thing being
//    judged here, and this is the real target list of 331.
//
//  - `cards` is the shipped 306-card set, the only data with every field
//    populated. It exists so the template itself can be judged with real stats
//    in place. Photos curated against it are not part of the new set.
//
// The pool JSON is imported, not fetched: Vite handles JSON natively, so the
// list is present on first paint instead of arriving a round trip later, and a
// missing/renamed file becomes a build error rather than an empty studio.
import pool from '../../card-data/generated/player-pool-2026.json';
import { CARDS } from '../game/cards.js';

/**
 * Derives a player's stable id from their name.
 *
 * This id IS the photo filename (`card-art/sets/{set}/photos/{id}.jpg`) and the key in
 * crops.json, so it must never change for a given name — renaming the scheme
 * would orphan every photo already curated. The batch export derives ids the
 * same way, which is what lets it find the photos the studio wrote.
 *
 * Diacritics are stripped before the character replacement, so accented names
 * survive as readable ASCII ("Luka Dončić" -> "Luka_Doncic") instead of
 * collapsing to "Luka_Don_i_". That is this repo's existing convention, not a
 * new one: the shipped card art is named `Vit_Krejci.png` and the shipped ids
 * in src/game/rawCards.js are `Alperen_Sengun`, `Nikola_Jokic`. Matching it
 * makes 194 of the 331 pool ids line up with an existing card id, up from 177.
 *
 * Unlike the cross-source matching key in scripts/cardgen/resolveTeams.js, this
 * PRESERVES case and word separators — it is a filename, meant to be read by a
 * human scrolling the set's photos/, so "Luka_Doncic" and not "lukadoncic".
 *
 * Leading and trailing underscores are trimmed, so "Jabari Smith Jr." is
 * `Jabari_Smith_Jr` rather than `Jabari_Smith_Jr_` — again matching the shipped
 * ids. Interior punctuation still collapses to one underscore ("De'Aaron Fox"
 * -> "De_Aaron_Fox"). Verified collision-free across all 331 pool names and all
 * 306 shipped cards, and inside the character set the studio server's path
 * guard accepts.
 */
export function playerIdFromName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The 2025-26 pool, shaped like a card. Missing stats stay missing. */
export const POOL_PLAYERS = pool.map(p => ({
  id: playerIdFromName(p.name),
  name: p.name,
  team: p.team,
  pos: p.pos,
  games: p.games,
  mpg: p.mpg,
  // No chart / speed / power / salary / shotLine: they have not been generated
  // for this pool. CardTemplate renders placeholders for each.
}));

/** The shipped 306-card set, already in card shape. */
export const CARD_PLAYERS = CARDS;

const byName = (a, b) => a.name.localeCompare(b.name);

export const SOURCES = {
  pool: { key: 'pool', label: '2025-26 pool', players: [...POOL_PLAYERS].sort(byName) },
  cards: { key: 'cards', label: 'Shipped cards', players: [...CARD_PLAYERS].sort(byName) },
};

export const DEFAULT_SOURCE = 'pool';

/** Accepts an array or a Set of photo ids and returns a Set. */
function asSet(photoIds) {
  if (photoIds instanceof Set) return photoIds;
  return new Set(Array.isArray(photoIds) ? photoIds : []);
}

/**
 * How far through the set the photo curation is.
 *
 * Counts only photos belonging to the ACTIVE source list: the set's photos/
 * accumulates files from both sources, and reporting "310 / 331" because the
 * shipped-card photos were counted too would make the progress number useless.
 */
export function photoProgress(players, photoIds) {
  const have = asSet(photoIds);
  let withPhoto = 0;
  for (const p of players) if (have.has(p.id)) withPhoto += 1;
  return { withPhoto, total: players.length, missing: players.length - withPhoto };
}

/**
 * The visible slice of the list.
 *
 * `missingOnly` is the one that earns its keep across sessions: on session
 * five, "who still needs a photo" is the only question being asked, and
 * scrolling 331 rows looking for hollow dots is not an answer.
 */
export function filterPlayers(players, { query = '', missingOnly = false, photoIds } = {}) {
  const have = asSet(photoIds);
  const q = query.trim().toLowerCase();
  return players.filter(p => {
    if (missingOnly && have.has(p.id)) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      String(p.team ?? '').toLowerCase().includes(q) ||
      String(p.pos ?? '').toLowerCase().includes(q)
    );
  });
}

/**
 * The id `delta` steps away from `currentId` in a list — the keyboard nav.
 *
 * Clamps at both ends rather than wrapping: wrapping from the last player back
 * to the first, mid-session, silently loses your place in a 331-row list.
 *
 * `anchorIndex` is where the selection last WAS in this list, and it carries
 * the main workflow. Filter to "needs photo", drop a photo on someone, and
 * they leave the list on the spot — with no anchor the very next keypress
 * would jump to the top of 331 rows instead of continuing to the next player
 * who needs one. Stepping forward from a vanished row lands on whoever took
 * its place; stepping back lands on the row above it.
 */
export function stepSelection(players, currentId, delta, anchorIndex = 0) {
  if (!players.length) return null;
  const clamp = i => Math.min(Math.max(i, 0), players.length - 1);
  const at = players.findIndex(p => p.id === currentId);
  if (at !== -1) return players[clamp(at + delta)].id;
  const anchor = clamp(anchorIndex);
  return players[clamp(delta > 0 ? anchor : anchor - 1)].id;
}
