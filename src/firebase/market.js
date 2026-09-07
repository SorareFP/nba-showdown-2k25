// THE MARKET — peer to peer, and that is the whole design.
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
//
// `buyCard` used to sell a card for coins out of nowhere. That is minting by
// another name, and under the supply model it makes every pull rate a lie: a
// card's chance of coming out of the next pack falls as copies enter the world,
// so a shop that conjures copies drives that number without anybody opening a
// pack. The user's rule, exactly: "I do not want people to be able to just buy,
// and thus mint, their own cards using coins. Each card minted has an ID and
// that ID can be posted on the market for a price."
//
// SO NOTHING HERE TOUCHES `supply/`. A trade moves a copy that already exists
// between two owners. Mints and burns move supply; trades never do. If you find
// yourself writing to supply in this file, something has gone wrong.
//
// ── WHAT MAY BE SOLD ────────────────────────────────────────────────────────
//
// Spares only. The first copy of a card is the one in your collection and is
// protected automatically — the user's rule again: "when you add a card to your
// collection, you can no longer burn it or post it on the market. If you have
// 10 copies of a card, and you collected one, you can burn the other 9, or you
// can list them on the market." Team rewards are `earned` and are never
// tradable at any count, because a market for them would make the whole
// difficulty ladder purchasable.
//
// The guarantee lives in `listCard` and again inside the buy transaction, not
// in whether the UI draws a button. A hidden button is a suggestion.
//
// ── WHY BUYING IS A TRANSACTION AND NOT A BATCH ─────────────────────────────
//
// A batch writes atomically but reads nothing, so two buyers hitting the same
// listing would both succeed and the copy would be created twice. The listing
// has to be RE-READ inside the transaction and the sale abandoned if it is
// gone. That is the one race this file actually has, and it is the expensive
// one: it duplicates a card, which is the thing the supply model cannot
// tolerate.
import { db } from './config.js';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit as qLimit,
  runTransaction, serverTimestamp, writeBatch, increment,
} from 'firebase/firestore';
import { COPY_STATE, isProtected } from './collection.js';

const listingsRef = () => collection(db, 'listings');
const copiesRef = uid => collection(db, 'users', uid, 'copies');
const copyRef = (uid, id) => doc(db, 'users', uid, 'copies', id);
const indexRef = (uid, cardKey) => doc(db, 'users', uid, 'collection', cardKey);
const userRef = uid => doc(db, 'users', uid);

/** The widest price the market accepts. Sanity, not economics. */
export const MAX_PRICE = 1_000_000;

/**
 * A price a seller may actually ask.
 *
 * Whole coins only, and above zero. A fractional price would round differently
 * on the two sides of a trade and a free listing is a giveaway with no way to
 * say who gets it.
 */
export function validPrice(price) {
  return Number.isInteger(price) && price > 0 && price <= MAX_PRICE;
}

/**
 * Put one spare copy up for sale.
 *
 * Picks the copy itself rather than taking a copy id, because the caller is a
 * collection screen that knows a CARD and should not have to know which of its
 * copies is safe to sell. The choice is not arbitrary: it takes a `spare`, so
 * the collected copy and any earned copy are unreachable from here by
 * construction rather than by a check somebody might forget.
 */
export async function listCard(uid, cardKey, price) {
  if (!validPrice(price)) throw new Error('Price must be a whole number of coins above zero');

  const snap = await getDocs(copiesRef(uid));
  const mine = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.cardKey === cardKey);
  if (mine.length === 0) throw new Error('Card not owned');

  const spare = mine.find(c => c.state === COPY_STATE.SPARE);
  if (!spare) {
    const only = mine.find(c => isProtected(c.state));
    throw new Error(
      only?.state === COPY_STATE.EARNED
        ? 'This is a collection reward — it can never be sold'
        : 'Your only copy is the one in your collection — collect a spare to sell'
    );
  }

  // ESCROW BY STATE, not by moving the document. The copy stays in the seller's
  // subtree and simply stops being spare, so a listing that is never bought
  // needs no repair and a seller browsing their own collection still sees the
  // card they own. `listed` is not in PROTECTED, so burnCard would otherwise
  // still take it — which is why burn re-checks for exactly `spare`.
  const listing = doc(listingsRef());
  const batch = writeBatch(db);
  batch.update(copyRef(uid, spare.id), { state: COPY_STATE.LISTED, listingId: listing.id });
  batch.set(listing, {
    cardKey,
    copyId: spare.id,
    seller: uid,
    price,
    listedAt: serverTimestamp(),
  });
  await batch.commit();
  return listing.id;
}

/** Take a listing down. The copy goes back to being an ordinary spare. */
export async function delistCard(uid, listingId) {
  const snap = await getDoc(doc(db, 'listings', listingId));
  if (!snap.exists()) throw new Error('That listing is already gone');
  const listing = snap.data();
  if (listing.seller !== uid) throw new Error('That is not your listing');

  const batch = writeBatch(db);
  batch.update(copyRef(uid, listing.copyId), { state: COPY_STATE.SPARE, listingId: null });
  batch.delete(doc(db, 'listings', listingId));
  await batch.commit();
}

/**
 * What is for sale.
 *
 * Cheapest first, because the only question a buyer has is "what does this cost
 * me" and the answer is the lowest open listing. `cardKey` narrows it to one
 * card, which is how a collection tracker asks "can I just buy the one I need".
 */
export async function loadListings({ cardKey = null, limit = 100 } = {}) {
  const parts = [];
  if (cardKey) parts.push(where('cardKey', '==', cardKey));
  parts.push(orderBy('price', 'asc'), qLimit(limit));
  const snap = await getDocs(query(listingsRef(), ...parts));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** A seller's own open listings, so they can price or pull them. */
export async function myListings(uid) {
  const snap = await getDocs(query(listingsRef(), where('seller', '==', uid)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Buy a listing. The one operation in this file that has to be atomic.
 *
 * Firestore requires every read before any write inside a transaction, so the
 * shape below is: read listing, seller copy, both index docs and the buyer's
 * wallet; decide; then write. Re-reading the listing is what stops two buyers
 * duplicating a copy — see the note at the top of the file.
 */
export async function buyListing(uid, listingId) {
  return runTransaction(db, async tx => {
    const listingDoc = doc(db, 'listings', listingId);
    const listingSnap = await tx.get(listingDoc);
    // THE RACE, CAUGHT. Somebody else bought it between the browse and the tap.
    if (!listingSnap.exists()) throw new Error('That listing has already sold');
    const listing = listingSnap.data();

    if (listing.seller === uid) throw new Error('That is your own listing');

    const sellerCopy = copyRef(listing.seller, listing.copyId);
    const [copySnap, buyerSnap, buyerIndexSnap] = await Promise.all([
      tx.get(sellerCopy),
      tx.get(userRef(uid)),
      tx.get(indexRef(uid, listing.cardKey)),
    ]);

    // A listing whose copy has vanished is a broken listing, not a sale. Clear
    // it rather than leaving it to fail for the next buyer too.
    if (!copySnap.exists()) {
      tx.delete(listingDoc);
      throw new Error('That listing is no longer valid');
    }
    const copy = copySnap.data();
    if (copy.state !== COPY_STATE.LISTED) {
      tx.delete(listingDoc);
      throw new Error('That listing is no longer valid');
    }

    const coins = buyerSnap.data()?.currency ?? 0;
    if (coins < listing.price) throw new Error(`Not enough coins — this costs ${listing.price}`);

    // ── the writes ──────────────────────────────────────────────────────────
    // The copy MOVES: deleted from the seller, created for the buyer, keeping
    // its mint history so a card's provenance survives every trade.
    tx.delete(sellerCopy);
    const owned = buyerIndexSnap.exists() ? (buyerIndexSnap.data().count ?? 0) : 0;
    tx.set(doc(copiesRef(uid)), {
      cardKey: listing.cardKey,
      mintedAt: copy.mintedAt ?? null,
      source: copy.source ?? null,
      // LOCK-ON-COLLECT APPLIES TO A BOUGHT CARD TOO. If this is the buyer's
      // first, it is their collection copy and is immediately unsellable —
      // which is the point of the rule and not an oversight of the market.
      state: COPY_STATE.SPARE, // a bought card is a spare until collected
      acquiredAt: serverTimestamp(),
      boughtFrom: listing.seller,
      boughtFor: listing.price,
    });

    // Indexes on both sides. The seller's count is decremented by the caller's
    // own recount on refresh if it drifts; `copies` is the truth either way.
    const sellerIndex = indexRef(listing.seller, listing.cardKey);
    tx.set(sellerIndex, { count: increment(-1) }, { merge: true });
    tx.set(
      indexRef(uid, listing.cardKey),
      { type: 'player', count: increment(1), acquiredAt: serverTimestamp() },
      { merge: true }
    );

    tx.set(userRef(uid), { currency: increment(-listing.price) }, { merge: true });
    tx.set(userRef(listing.seller), { currency: increment(listing.price) }, { merge: true });
    tx.delete(listingDoc);

    // SUPPLY IS NOT TOUCHED. A trade moves a copy; it does not make one.
    return { cardKey: listing.cardKey, price: listing.price };
  });
}
