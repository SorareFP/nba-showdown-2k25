// FRIENDS, AND THE CARDS THEY NEED (2026-10-11) — docs/plans/2026-10-11-friends-design.md.
//
// The user: "when a friend is within 2 cards of a collection and you pack a
// card, when you have My Collection filtered to 'Spare to sell or burn' have a
// little dot on any excess card that says 'A friend needs this card for a
// collection. List it?'" Every rule of it lives here, shared by the browser
// and the server (functions/prepare.mjs copies this file), so the two cannot
// disagree about what a need is or what a code looks like.
import { GOALS, GOALS_BY_ID, goalProgress, collectedKeys } from './collections.js';
import { canonicalKey, getCardByKey } from './cardSets.js';
import { getTeam } from '../cards/teams.js';

export const FRIENDS_MAX = 30;         // the most one Firestore `in` query takes
export const NEED_WITHIN = 2;          // "within 2 cards of a collection"
export const NEEDS_MAX = 60;
export const CODE_LENGTH = 6;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I
const LABEL_MAX = 60;

export function makeFriendCode(rng = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return s;
}

/** What a person typed, as a code — or null if it cannot be one. */
export function normalizeCode(input) {
  const s = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== CODE_LENGTH || [...s].some(ch => !CODE_ALPHABET.includes(ch))) return null;
  return s;
}

/** A collection as a person says it: "Atlanta Hawks collection", "Super Season set". */
export function goalName(goal) {
  if (goal?.kind === 'team') {
    const t = getTeam(goal.label, { league: goal.league });
    return `${t ? `${t.city} ${t.name}` : goal.label} collection`;
  }
  if (goal?.kind === 'set') return String(goal.label ?? '').replace(/^Complete\s+/, '').replace(/\s+Set$/, ' set');
  return `${goal?.label ?? 'a'} collection`;
}

/** Card keys the owner holds ANY copy of (canonical). */
function heldKeys(collection) {
  return new Set(Object.entries(collection ?? {}).filter(([, e]) => (e?.count ?? 0) > 0).map(([k]) => canonicalKey(k)));
}

const byNeed = (a, b) => a.cardKey.localeCompare(b.cardKey) || a.goalId.localeCompare(b.goalId);

/**
 * WHAT THIS PLAYER NEEDS: every missing card of a collection not yet claimed
 * that is 1 to NEED_WITHIN cards short — and only cards they hold NO copy of,
 * since a spare waiting to be collected needs no friend.
 */
export function needsFromCollection(collection, claimedIds = new Set()) {
  const owned = collectedKeys(collection);
  const held = heldKeys(collection);
  const out = [];
  for (const g of GOALS) {
    if (claimedIds.has(g.id)) continue;
    const p = goalProgress(g.id, owned);
    if (!p || p.missingCount < 1 || p.missingCount > NEED_WITHIN) continue;
    for (const key of p.missing) {
      if (held.has(key)) continue;
      out.push({ cardKey: key, goalId: g.id, goalLabel: goalName(g), missing: p.missingCount });
    }
  }
  return out.sort(byNeed).slice(0, NEEDS_MAX);
}

const needId = n => `${n.cardKey}|${n.goalId}|${n.missing}`;
export function sameNeeds(a, b) {
  const x = (a ?? []).map(needId).sort();
  const y = (b ?? []).map(needId).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** THE SERVER'S SANITISER: a friend's profile is written by their own app, so trust nothing in it. */
export function cleanNeeds(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const n of raw) {
    if (out.length >= NEEDS_MAX) break;
    if (!n || typeof n !== 'object') continue;
    const { cardKey, goalId, goalLabel, missing } = n;
    if (typeof cardKey !== 'string' || !getCardByKey(cardKey)) continue;
    if (typeof goalId !== 'string' || !GOALS_BY_ID[goalId]) continue;
    if (!Number.isInteger(missing) || missing < 1 || missing > NEED_WITHIN) continue;
    out.push({ cardKey, goalId, goalLabel: String(goalLabel ?? '').slice(0, LABEL_MAX), missing });
  }
  return out;
}

/** Card (canonical key) → the friends who need it, one entry each at their nearest collection. */
export function wantsByCard(friends) {
  const out = new Map();
  for (const f of friends ?? []) {
    const best = new Map();
    for (const n of f?.needs ?? []) {
      const key = canonicalKey(n.cardKey);
      const cur = best.get(key);
      if (!cur || n.missing < cur.missing) best.set(key, { uid: f.uid, name: f.name, goalLabel: n.goalLabel, missing: n.missing });
    }
    for (const [key, w] of best) {
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(w);
    }
  }
  return out;
}

export function listJoin(names) {
  const n = (names ?? []).filter(Boolean);
  if (n.length <= 1) return n[0] ?? '';
  return `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
}

/** The dot's sentence. */
export function wantText(wants) {
  if (!wants?.length) return '';
  if (wants.length === 1) {
    const w = wants[0];
    return `${w.name} needs this for the ${w.goalLabel} (${w.missing} to go). List it?`;
  }
  return `${listJoin(wants.map(w => w.name))} need this for a collection. List it?`;
}

/** The pack reveal's chip for a pulled card, or null. */
export function friendNoteFor(wants, key) {
  const w = wants?.get?.(canonicalKey(key));
  if (!w?.length) return null;
  return `${listJoin(w.map(x => x.name))} ${w.length === 1 ? 'needs' : 'need'} this one`;
}

export function chunk(list, n) {
  const out = [];
  for (let i = 0; i < (list ?? []).length; i += n) out.push(list.slice(i, i + n));
  return out;
}
