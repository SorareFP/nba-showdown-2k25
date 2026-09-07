// THE ROSTER RULES, in one place for two builders.
//
// The sandbox Team Builder and the collection-only editor in My Teams both
// enforce the same cap and the same roster size. They used to be constants
// inside the sandbox component; a second builder that copied them would drift
// the first time somebody tuned the cap. So they live here, along with the
// one derivation both need: which of a player's cards are PLAYERS they own.
import { getCardByKey } from './cardSets.js';
import { CARDS } from './cards.js';

/** Total salary a roster may carry. */
export const CAP = 5500;
/** Most players on a roster. */
export const MAX = 10;
/** Fewest players a roster needs before a game can start. */
export const MIN_TO_PLAY = 5;

export const capSal = roster => roster.reduce((s, c) => s + (c.salary ?? 0), 0);

/**
 * The player cards a collection actually contains, with how many of each.
 *
 * `collection` is the index loadCollection returns: `{ [cardKey]: { type,
 * count, ... } }`. Strategy cards are in it too and are not players; a card
 * that has left the pool between seasons resolves to nothing and is dropped
 * rather than crashing the builder; and a count of zero is not ownership.
 *
 * Keys are collection keys — `set:id` for a special set, the bare id for the
 * base set — which is also what a saved team stores, so a team built here
 * loads back through CARD_MAP without translation.
 */
export function ownedPlayers(collection) {
  const out = [];
  for (const [key, entry] of Object.entries(collection ?? {})) {
    const count = entry?.count ?? 0;
    if (count <= 0) continue;
    if (entry?.type && entry.type !== 'player') continue;
    const card = getCardByKey(key);
    if (!card || !Number.isFinite(card.salary)) continue;
    out.push({ key, card, count });
  }
  return out;
}

/**
 * A random roster that lands in the salary band real teams live in.
 *
 * Moved here from the sandbox builder so Quick Match on the Play tab can use
 * the same one: its old shuffle took the first ten cards it found, which put a
 * $2,400 roster against a $5,500 one and made a test game prove nothing about
 * the game. The band is the floor below and the cap above; `ownedOnly` with a
 * collection restricts the draw to cards the player has.
 */
export const RANDOM_MIN_SAL = 4800;

export function randomizeTeam(other, ownedOnly, collection) {
  let available = [...CARDS];
  if (ownedOnly && collection) {
    available = available.filter(c => (collection[c.id]?.count || 0) > 0);
  }
  const MIN_SAL = RANDOM_MIN_SAL;
  const MAX_SAL = CAP;

  // Pick a random target salary within range for each attempt
  // This ensures true spread across the 4800-5500 range
  let best = null;
  let bestDist = Infinity;

  for (let attempt = 0; attempt < 500; attempt++) {
    const target = MIN_SAL + Math.floor(Math.random() * (MAX_SAL - MIN_SAL + 1));
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const roster = []; let sal = 0;
    const remaining = () => 10 - roster.length;

    for (const card of shuffled) {
      if (roster.length >= 10) break;
      if (sal + card.salary > MAX_SAL) continue;
      // Skip if adding this card would make it impossible to fill remaining slots
      // (each remaining player needs at least ~100 salary minimum)
      const spotsAfter = remaining() - 1;
      if (spotsAfter > 0 && sal + card.salary + spotsAfter * 80 > MAX_SAL) continue;
      roster.push(card); sal += card.salary;
    }

    if (roster.length === 10 && sal >= MIN_SAL && sal <= MAX_SAL) {
      const dist = Math.abs(sal - target);
      if (dist < bestDist) {
        best = roster;
        bestDist = dist;
        // If we're within 50 of our random target, good enough
        if (dist <= 50) break;
      }
    }
  }

  if (best) return best;

  // Fallback: just fill under cap
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  const roster = []; let sal = 0;
  for (const card of shuffled) {
    if (roster.length >= 10) break;
    if (sal + card.salary <= CAP) { roster.push(card); sal += card.salary; }
  }
  return roster;
}

// ── The pool controls, shared ───────────────────────────────────────────────
//
// Two builders, one set of filters and sorts. The user's list (2026-09-05):
// "sort by position, speed, power, paint bonus, 3pt bonus, defense bonus and
// salary. And team, plus a name search." Position is a filter rather than a
// sort — five buckets, not an order — and everything else is a sort key.

export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

/** Sort keys, in the order the menu lists them. Every one is a comparator. */
export const POOL_SORTS = {
  'salary-desc': { label: 'Salary ↓', cmp: (a, b) => b.salary - a.salary },
  'salary-asc': { label: 'Salary ↑', cmp: (a, b) => a.salary - b.salary },
  speed: { label: 'Speed ↓', cmp: (a, b) => b.speed - a.speed },
  power: { label: 'Power ↓', cmp: (a, b) => b.power - a.power },
  paint: { label: 'Paint bonus ↓', cmp: (a, b) => (b.paintBoost || 0) - (a.paintBoost || 0) },
  three: { label: '3PT bonus ↓', cmp: (a, b) => (b.threePtBoost || 0) - (a.threePtBoost || 0) },
  defense: { label: 'Defense ↓', cmp: (a, b) => (b.defBoost || 0) - (a.defBoost || 0) },
  name: { label: 'Name A-Z', cmp: (a, b) => a.name.localeCompare(b.name) },
};

export const DEFAULT_FILTERS = { search: '', team: '', pos: '', maxSal: 9999, sort: 'salary-desc' };

/** The cards that survive the filters. Pure; does not sort. */
export function filterPool(cards, f = DEFAULT_FILTERS) {
  const q = (f.search || '').trim().toLowerCase();
  return cards.filter(c =>
    (!q || c.name.toLowerCase().includes(q) || String(c.team).toLowerCase().includes(q)) &&
    (!f.team || c.team === f.team) &&
    (!f.pos || c.pos === f.pos) &&
    (c.salary ?? 0) <= (f.maxSal ?? 9999)
  );
}

/** A sorted COPY, ties broken by salary then name so an order is stable. */
export function sortPool(cards, sort = 'salary-desc') {
  const primary = (POOL_SORTS[sort] ?? POOL_SORTS['salary-desc']).cmp;
  return [...cards].sort((a, b) => primary(a, b) || b.salary - a.salary || a.name.localeCompare(b.name));
}

/**
 * A saved team, checked against the collection it is played from.
 *
 * THE HOLE THIS CLOSES (2026-09-05): a saved team was loaded straight from the
 * card table with no ownership check, so a card sold or burned after the team
 * was saved stayed playable from it — in the sandbox and, worse, in PvP. The
 * builder's pool respected ownership; the LOAD did not.
 *
 * Same rule the pool uses: with no collection at all this is sandbox mode and
 * nothing is dropped; with one, a card not in it (or at count zero) is out.
 * Returns what survived and what was dropped, so the caller can say so.
 *
 * This is enforced where a team is loaded, on the client. PvP trusts what a
 * client sends, as it trusts the client's rolls; this stops the honest case —
 * "I sold that card last week and forgot" — and is not a defence against a
 * player editing their own client.
 */
export function ownedRoster(playerIds, collection) {
  const ids = Array.isArray(playerIds) ? playerIds : [];
  const enforce = collection && Object.keys(collection).length > 0;
  if (!enforce) return { roster: ids, dropped: [] };
  const roster = [];
  const dropped = [];
  for (const id of ids) ((collection[id]?.count ?? 0) > 0 ? roster : dropped).push(id);
  return { roster, dropped };
}
