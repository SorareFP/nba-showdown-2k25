// The Card Studio's player list: where the records come from, and every pure
// operation the list UI performs on them.
//
// TWO SOURCES, deliberately — and they are named for TWO DIFFERENT SEASONS,
// which is the single most confusable thing in this tool. A set is named for
// the season it will be played in; its numbers come from the season before.
// See STATS_SEASON in src/cards/sets.js.
//
//  - `pool` (the default) is the player list for the set being built now, and
//    it is named for the season its STATS came from: 2025-26 stats build the
//    2026-27 set. It has names, teams and positions and nothing else — charts,
//    Speed/Power and salaries have not been generated yet — so cards from it
//    render mostly placeholders. That is correct: the photo is the thing being
//    judged here, and this is the real target list of 331.
//
//  - `cards` is the shipped 306-card set — the FINISHED 2025-26 set, built
//    from 2024-25 stats — and the only data with every field populated. It
//    exists so the template itself can be judged with real stats in place.
//    Photos curated against it are not part of the new set.
//
// The pool JSON is imported, not fetched: Vite handles JSON natively, so the
// list is present on first paint instead of arriving a round trip later, and a
// missing/renamed file becomes a build error rather than an empty studio.
import rawPool from '../../card-data/generated/player-pool-2026.json';
import { CARDS } from '../game/cards.js';
import { CURRENT_SET, STATS_SEASON, FINISHED_SET, FINISHED_STATS_SEASON } from '../cards/sets.js';

/**
 * The team-resolved pool, when `node scripts/cardgen/generateTeams.js` has been
 * run. PREFERRED over the raw pool, for two reasons:
 *
 *  - 45 of the 331 raw records carry Basketball-Reference's "2TM"/"3TM"
 *    mid-season-trade aggregate codes, which are not teams. Every one of those
 *    cards rendered on the neutral grey fallback with no logo and no colors.
 *    The resolved file replaces them with the player's real current team.
 *  - It carries `personId`, nba.com's player id, which is the ONLY thing that
 *    makes the headshot fallback (see src/cards/photo.js) work for a pool
 *    player who has no curated photo yet.
 *
 * import.meta.glob rather than a plain import so an absent file degrades to the
 * raw pool instead of breaking the studio: this file is GENERATED, and a
 * checkout that has never run the generator (or a season whose generator has
 * not been re-run yet) must still open a usable studio. Eager, so the list is
 * still there on first paint.
 */
const resolvedModules = import.meta.glob('../../card-data/generated/player-teams-2026.json', {
  eager: true,
});
const resolvedPool = Object.values(resolvedModules)[0]?.default ?? null;

/** True when the studio is showing real resolved teams rather than raw codes. */
export const TEAMS_RESOLVED = resolvedPool !== null;

/**
 * The raw pool with resolved records OVERLAID — not replaced by them.
 *
 * The resolved file is deliberately shorter than the pool: the generator emits
 * only players it could give a real team, which today leaves 4 out (they are on
 * no active roster AND carry an aggregate code, so no source knows their team).
 * Taking the resolved file as the list would quietly drop those 4 from a
 * 331-player set — the user would simply never be offered them to photograph.
 *
 * So the pool stays the spine and resolution is an overlay. The unresolved few
 * keep their raw "2TM" code and go on rendering the neutral fallback theme,
 * which is the correct signal: those are the cards still needing a human
 * decision, and they should look unfinished until they get one.
 *
 * Keyed by `name` because that is what the generator copies through verbatim.
 */
const resolvedByName = new Map((resolvedPool ?? []).map(p => [p.name, p]));
const pool = rawPool.map(p => ({ ...p, ...(resolvedByName.get(p.name) ?? {}) }));

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

/** The pool, shaped like a card. Missing stats stay missing. */
export const POOL_PLAYERS = pool.map(p => ({
  id: playerIdFromName(p.name),
  name: p.name,
  team: p.team,
  pos: p.pos,
  games: p.games,
  mpg: p.mpg,
  // Present only on the resolved file. `?? null` rather than left undefined so
  // the field always exists and resolvePhotoUrl's `if (personId)` reads the
  // same either way.
  personId: p.personId ?? null,
  // No chart / speed / power / salary / shotLine: they have not been generated
  // for this pool. CardTemplate renders placeholders for each.
}));

/** The shipped 306-card set, already in card shape. */
export const CARD_PLAYERS = CARDS;

const byName = (a, b) => a.name.localeCompare(b.name);

/**
 * The two lists, labelled so nobody has to ask which season is which.
 *
 * Both labels name a season, and they are DIFFERENT seasons on purpose — so
 * each one also says what its season is: a stats season for the pool being
 * photographed, a set for the cards already printed. Labels are composed from
 * the constants in sets.js rather than typed, so the season a label claims
 * cannot drift from the season the tool is actually working on.
 */
export const SOURCES = {
  pool: {
    key: 'pool',
    label: `Players · ${STATS_SEASON} stats`,
    hint:
      `The ${CURRENT_SET} set's player list — every player being given a card this cycle. ` +
      `Named for the season its stats came from: ${STATS_SEASON} stats → the ${CURRENT_SET} set. ` +
      `Photos and crops you save here belong to the ${CURRENT_SET} set.`,
    players: [...POOL_PLAYERS].sort(byName),
  },
  cards: {
    key: 'cards',
    label: `Shipped cards · ${FINISHED_SET} set`,
    hint:
      `The finished ${FINISHED_SET} set, already printed (built from ${FINISHED_STATS_SEASON} stats). ` +
      `Here only because it is the one data set with every stat filled in, so the template can be ` +
      `judged with real numbers. Photos curated against it are NOT part of the ${CURRENT_SET} set.`,
    players: [...CARD_PLAYERS].sort(byName),
  },
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
