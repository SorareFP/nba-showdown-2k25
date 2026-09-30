// A CARD THAT CHANGED RARITY, SETTLED ONCE (2026-09-30).
//
// The user, on the chart rebuild moving some cards across a rarity line:
// "Change the cards, deploy net coins for total collection change, with a
// floor of zero." Rarity comes from salary (rarity.js), so a rebuild that
// reprices a card can move it a band, and a band sets what the card burns for
// and the lowest price it can be listed at (marketRules.js). A player holding
// a rare that is now uncommon lost the difference.
//
// ── THE RULE ────────────────────────────────────────────────────────────────
//
//   per copy     BURN_VALUES[old rarity] - BURN_VALUES[new rarity]: positive
//                for a card that moved down, negative for one that moved up
//   the payout   the sum over every copy the player holds, whatever its state
//                (spare, collected, listed, earned), floored at zero: an
//                upgrade offsets a downgrade, and nobody is ever charged
//   the cutoff   only a copy the player held before the new cards went live
//                counts (its acquiredAt, else its mintedAt, before `cutoff`).
//                A downgraded card bought after the change was bought at its
//                new price and is owed nothing; without this a player could
//                buy cheap downgrades and be paid the old difference for them
//   once         the receipt is `claims/<id>`, the same server-only collection
//                every other one-time payment writes, so a second claim pays
//                nothing. A later change cuts a NEW table with a new id.
//
// The table is cut by scripts/cardgen/rarityShift.mjs from the cards as they
// last shipped (a git ref) against the cards as they are now, and the per-copy
// coins are written into it, so this module reads data only and the server and
// the browser cannot disagree about a price.
import table from '../../card-data/generated/rarity-shift.json' with { type: 'json' };

/** The current table: `{ id, cutoff, shifts: { cardKey: { from, to, coins } } }`. */
export const RARITY_SHIFT = table;

/** A timestamp in milliseconds from a Firestore Timestamp, a Date, a number or an ISO string; null if none. */
export function timeOf(t) {
  if (t == null) return null;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'number') return Number.isFinite(t) ? t : null;
  if (typeof t === 'string') { const ms = Date.parse(t); return Number.isFinite(ms) ? ms : null; }
  // A plain {seconds, nanoseconds} object (a Timestamp that lost its class in transit).
  if (Number.isFinite(t.seconds)) return t.seconds * 1000 + Math.floor((t.nanoseconds ?? 0) / 1e6);
  return null;
}

/**
 * Did the player hold this copy before the change? A copy with no timestamp at
 * all predates both fields and so predates the change.
 */
export function heldBefore(copy, cutoffMs) {
  if (!Number.isFinite(cutoffMs)) return true;
  const at = timeOf(copy?.acquiredAt) ?? timeOf(copy?.mintedAt);
  return at == null || at < cutoffMs;
}

/**
 * What the player is owed for the copies they hold. `copies` are ledger
 * documents (`{ cardKey, acquiredAt?, mintedAt? }`). Returns
 * `{ id, coins, net, lines }`: `net` is the signed total, `coins` the payout
 * (never below zero), and `lines` one row per card that moved, biggest first.
 */
export function rarityShiftPayout(copies, shift = RARITY_SHIFT) {
  const cutoff = timeOf(shift?.cutoff);
  const moves = shift?.shifts ?? {};
  const byKey = new Map();
  for (const copy of copies ?? []) {
    // A dynasty's second copy of a key is `key~2`; the ledger never writes one,
    // but a stray suffix must not dodge the table.
    const key = String(copy?.cardKey ?? '').replace(/~\d+$/, '');
    const move = moves[key];
    if (!move || !heldBefore(copy, cutoff)) continue;
    const line = byKey.get(key) ?? { key, from: move.from, to: move.to, each: move.coins, copies: 0, coins: 0 };
    line.copies += 1;
    line.coins += move.coins;
    byKey.set(key, line);
  }
  const lines = [...byKey.values()].sort((a, b) => b.coins - a.coins || a.key.localeCompare(b.key));
  const net = lines.reduce((sum, l) => sum + l.coins, 0);
  return { id: shift?.id ?? null, coins: Math.max(0, net), net, lines };
}

/**
 * The one line a player reads after the settlement, or null when none of
 * their cards moved. `res` is what settleRarityShift answers.
 */
export function settlementMessage(res) {
  const cards = res?.cards ?? res?.lines?.length ?? 0;
  if (!cards) return null;
  const moved = cards === 1 ? 'One of your cards' : `${cards} of your cards`;
  // A toast lives four seconds: short, with the detail left to the news item.
  if (res.coins > 0) return `+${res.coins} coins: ${moved.toLowerCase()} changed rarity. Details in the news on Home.`;
  return `${moved} changed rarity, and your collection came out ahead.`;
}

/**
 * Could this account hold a copy from before the change? One created after
 * the cutoff cannot, so the client skips the call for it.
 */
export function mayBeOwed(accountCreatedAt, shift = RARITY_SHIFT) {
  if (!shift?.id) return false;
  const cutoff = timeOf(shift.cutoff);
  const created = timeOf(accountCreatedAt);
  return !(Number.isFinite(cutoff) && created != null && created >= cutoff);
}
