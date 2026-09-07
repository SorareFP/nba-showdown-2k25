// src/firebase/collection.js — Collection CRUD with batch writes
import { db } from './config.js';
import { goalProgress, claimableGoals, goalCoinReward } from '../game/collections.js';
import { CARD_MAP } from '../game/cards.js';
import { getMarketPrice } from '../game/rarity.js';
import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, writeBatch, increment,
} from 'firebase/firestore';

function collRef(uid) {
  return collection(db, 'users', uid, 'collection');
}

function histRef(uid) {
  return collection(db, 'users', uid, 'packHistory');
}

function copiesRef(uid) {
  return collection(db, 'users', uid, 'copies');
}

/**
 * ── THE LEDGER ──────────────────────────────────────────────────────────────
 *
 * A collection entry used to be a COUNT, and a count cannot be listed, cannot
 * be sold, and cannot tell the copy you collected apart from the nine you would
 * burn. So the unit of ownership is now a COPY: one document per physical card
 * in the game, with a state saying where it stands.
 *
 * The `collection` documents survive as a derived INDEX — the collection screen
 * and the goal tracker want one read per card, not one per copy — and they keep
 * their `count` field so every existing consumer keeps working unchanged.
 * `copies` is the truth; the index is a cache of it.
 *
 * See docs/plans/2026-09-04-card-economy-design.md.
 */
import { collectedKeys } from '../game/collections.js';

export const COPY_STATE = {
  /** The one that completes a collection. Never burnable, never listable. */
  COLLECTED: 'collected',
  /** Any further copy. Free to burn or sell. */
  SPARE: 'spare',
  /** A spare currently on the market. */
  LISTED: 'listed',
  /** Won by finishing a collection. Never burnable, never listable, ever. */
  EARNED: 'earned',
};

/** States whose copies may not be destroyed or traded. */
const PROTECTED = new Set([COPY_STATE.COLLECTED, COPY_STATE.EARNED]);

export const isProtected = state => PROTECTED.has(state);

/**
 * Global circulating supply, `cardKey -> count`.
 *
 * READS EVERY DOCUMENT UNDER `supply/` AND MERGES THEM, rather than reading
 * `supply/current` by name. There is one document today and one is plenty —
 * a pack open is a single write to it, and Firestore's ~1/sec ceiling is some
 * three to four thousand weekly players away. But sharding later means adding
 * documents, and a read path that already merges makes that a change to nothing
 * else. It costs these four lines.
 */
export async function readSupply() {
  const snap = await getDocs(collection(db, 'supply'));
  const counts = {};
  snap.forEach(d => {
    for (const [key, n] of Object.entries(d.data()?.counts ?? {})) {
      counts[key] = (counts[key] ?? 0) + n;
    }
  });
  return counts;
}

/** Every copy this player holds, newest first. */
export async function loadCopies(uid) {
  const snap = await getDocs(copiesRef(uid));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Load entire collection
export async function loadCollection(uid) {
  const snap = await getDocs(collRef(uid));
  const items = {};
  snap.forEach(d => { items[d.id] = d.data(); });
  return items; // { [cardId]: { type, count, acquiredAt } }
}

/**
 * Mint the cards a pack produced.
 *
 * ── EVERY PULL BECOMES A SPARE ──────────────────────────────────────────────
 *
 * It used to be that the first copy of a card locked itself into the
 * collection here. The user's rule since 2026-09-05: "they should have to go
 * into the collections tab and hit collect." So a pull is a `spare` — it can
 * be sold or burned — until its owner collects it (collectCardDirect, below),
 * and only a collected card counts toward a goal (collectedKeys in
 * src/game/collections.js).
 *
 * ── AND THE SUPPLY MOVES ────────────────────────────────────────────────────
 *
 * Minting is the only thing that raises circulating supply, and supply is what
 * decides how likely a card is to appear in the next pack. Trading does not
 * mint; burning takes a card back out.
 *
 * `cards` is `[{ id, type }]` where `id` is the collection key.
 */
export async function addCardsToCollection(uid, cards, packType, cost) {
  const batch = writeBatch(db);

  // What is already collected decides whether this pull is the collection copy
  // or a spare, so it has to be read before anything is written.
  const existing = await loadCollection(uid);

  const minted = {};
  for (const card of cards) {
    const key = card.id;
    const copy = doc(copiesRef(uid));
    batch.set(copy, {
      cardKey: key,
      type: card.type,
      state: COPY_STATE.SPARE,
      source: packType,
      mintedAt: serverTimestamp(),
    });

    minted[key] = (minted[key] ?? 0) + 1;
    const indexRef = doc(db, 'users', uid, 'collection', key);
    batch.set(
      indexRef,
      {
        type: card.type,
        count: increment(1),
        acquiredAt: existing[key]?.acquiredAt ?? serverTimestamp(),
      },
      { merge: true }
    );
  }

  // One document, one write, merged — see readSupply for why it is not read by
  // name. `increment` inside a nested object is why this is setDoc/merge rather
  // than updateDoc: a card key holds a colon, which an update field path would
  // try to parse.
  batch.set(
    doc(db, 'supply', 'current'),
    { counts: Object.fromEntries(Object.entries(minted).map(([k, n]) => [k, increment(n)])) },
    { merge: true }
  );

  if (cost > 0) batch.update(doc(db, 'users', uid), { currency: increment(-cost) });

  batch.set(doc(histRef(uid)), {
    packType,
    cards: cards.map(c => c.id),
    cost,
    openedAt: serverTimestamp(),
  });

  await batch.commit();
}

/**
 * Burn one SPARE copy of a card for coins.
 *
 * ── THE PROTECTION IS HERE, NOT IN THE UI ───────────────────────────────────
 *
 * A hidden button is a suggestion. This is the only place a card is destroyed,
 * so it is the only place the guarantee can be made: a `collected` copy is the
 * one that completes a collection and an `earned` copy is a reward that can
 * never be won twice, and neither may be burned at any price.
 *
 * Takes a card KEY rather than a copy id, because burning is a decision about a
 * card ("I have nine spare Jokics") and picking which physical copy dies is not
 * a choice worth making a player make.
 */
export async function burnCard(uid, cardKey, burnValue) {
  const copies = await loadCopies(uid);
  const mine = copies.filter(c => c.cardKey === cardKey);
  if (mine.length === 0) throw new Error('Card not owned');

  const spare = mine.find(c => c.state === COPY_STATE.SPARE);
  if (!spare) {
    const only = mine.find(c => isProtected(c.state));
    throw new Error(
      only?.state === COPY_STATE.EARNED
        ? 'This is a collection reward — it can never be burned'
        : 'Your only copy is the one in your collection — collect a spare to burn'
    );
  }

  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', uid, 'copies', spare.id));

  const indexRef = doc(db, 'users', uid, 'collection', cardKey);
  if (mine.length <= 1) batch.delete(indexRef);
  else batch.update(indexRef, { count: increment(-1) });

  // A burned card leaves the supply, so the pool feels it and the card becomes
  // fractionally likelier to appear again. That is what makes burning a sink
  // rather than a shrug.
  batch.set(doc(db, 'supply', 'current'), { counts: { [cardKey]: increment(-1) } }, { merge: true });
  batch.update(doc(db, 'users', uid), { currency: increment(burnValue) });
  await batch.commit();
}

// Add coins to user
export async function addCoins(uid, amount) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { currency: increment(amount) });
}

// Get user data
export async function getUserData(uid) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// Update user fields (starterPackOpened, daily tracking, etc.)
export async function updateUserFields(uid, fields) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, fields);
}

/**
 * Claim ONE completed collection goal — a franchise, a conference, or a set.
 *
 * ── WHY A CLAIM AND NOT AN AUTOMATIC GRANT ──────────────────────────────────
 *
 * This began as an auto-grant on load, and the objection is not technical:
 * finishing a roster is the payoff of the whole feature, and a card that simply
 * appears spends that moment on nothing. A claim makes the player do the last
 * small thing, so the reward has somewhere to happen.
 *
 * The safety property of the auto-grant is kept. Eligibility is derived from
 * the CURRENT collection rather than from an event, so it survives a dropped
 * write, pays someone who finished a roster before the feature existed, and is
 * harmless to call twice. It is re-verified HERE rather than trusted from the
 * client, because this is the function that mints a card and moves currency.
 *
 * A goal with no reward card yet (conference and set tiers) still pays its
 * coins. The card is the trophy; the coins are the part that funds the next
 * collection, and there is no reason to withhold them for want of art.
 */
export async function claimGoal(uid, goalId) {
  const items = await loadCollection(uid);
  const ownedKeys = new Set(Object.keys(items));

  const progress = goalProgress(goalId, ownedKeys);
  if (!progress) throw new Error(`No such goal: ${goalId}`);
  if (!progress.complete) throw new Error(`${progress.label} is not complete`);

  const claimedRef = doc(db, 'users', uid, 'claims', goalId);
  if ((await getDoc(claimedRef)).exists()) throw new Error('Already claimed');

  const coins = goalCoinReward(goalId);
  const batch = writeBatch(db);

  if (progress.reward && !ownedKeys.has(progress.reward)) {
    // A reward is minted as an EARNED copy: never burnable, never listable, at
    // any price. A completed roster stays complete, so it can never be won
    // twice — destroying or selling one would be irreversible in a way no other
    // card is, and a market for them would make the difficulty ladder
    // purchasable.
    const copy = doc(copiesRef(uid));
    batch.set(copy, {
      cardKey: progress.reward,
      type: 'player',
      state: COPY_STATE.EARNED,
      source: goalId,
      mintedAt: serverTimestamp(),
    });
    batch.set(
      doc(db, 'users', uid, 'collection', progress.reward),
      { type: 'player', count: increment(1), collectedCopyId: copy.id, acquiredAt: serverTimestamp() },
      { merge: true }
    );
    // A reward is a real card entering the world, so it counts against supply
    // like any other mint.
    batch.set(
      doc(db, 'supply', 'current'),
      { counts: { [progress.reward]: increment(1) } },
      { merge: true }
    );
  }
  if (coins > 0) batch.update(doc(db, 'users', uid), { currency: increment(coins) });
  // The claim RECEIPT is what makes this once-only. The card alone could not:
  // a coins-only goal mints nothing, and a player could otherwise re-claim it
  // forever.
  batch.set(claimedRef, { goalId, coins, card: progress.reward ?? null, claimedAt: serverTimestamp() });

  await batch.commit();
  return { goalId, coins, card: progress.reward ?? null };
}

/**
 * Every goal this player has already claimed: `goalId -> receipt`.
 *
 * The tracker needs the RECEIPT and not just the id, because a claimed goal
 * still has something to show — what it paid, and when. A goal whose card no
 * longer exists (a pool change retired the reward) keeps its receipt and so
 * keeps reading as claimed rather than silently reopening.
 */
export async function loadClaims(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'claims'));
  const out = {};
  snap.forEach(d => { out[d.id] = d.data(); });
  return out;
}

/** Goal ids that are complete and not yet claimed, for the tracker. */
export async function claimableForUser(uid, owned = null) {
  const items = owned ?? (await loadCollection(uid));
  const ownedKeys = collectedKeys(items);
  const claimed = new Set(Object.keys(await loadClaims(uid)));
  return claimableGoals(ownedKeys).filter(id => !claimed.has(id));
}

/**
 * `buyCard` USED TO LIVE HERE, and its removal is the point rather than a tidy-up.
 *
 * It created a card out of coins, which is minting by another name. Under the
 * supply model that makes every pull rate a lie: a card's chance of appearing
 * in the next pack falls as copies enter the world, and a shop that conjures
 * copies from nothing drives that number without anybody opening a pack.
 *
 * The market that replaces it is peer to peer — a copy that already exists
 * changes hands and supply does not move. See §4 of
 * docs/plans/2026-09-04-card-economy-design.md.
 */

/**
 * DIRECT ROUTE of collectCard (functions/index.js) — same rule, same result.
 */
export async function collectCardDirect(uid, cardKey) {
  const copies = await loadCopies(uid);
  const mine = copies.filter(c => c.cardKey === cardKey);
  if (!mine.length) throw new Error('Card not owned');
  const already = mine.find(c => isProtected(c.state));
  const spare = mine.find(c => c.state === COPY_STATE.SPARE);
  if (!already && !spare) throw new Error('Your only copy is on the market — delist it first');
  const batch = writeBatch(db);
  if (!already) {
    batch.update(doc(db, 'users', uid, 'copies', spare.id), {
      state: COPY_STATE.COLLECTED, collectedAt: serverTimestamp(),
    });
  }
  batch.set(doc(db, 'users', uid, 'collection', cardKey),
    { collected: true, collectedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  return { cardKey, copyId: (already ?? spare).id };
}

/** The lifetime tracker, `{ [cardKey]: { games, wins, pts, reb, ast, min, tpm, tpa } }`. */
export async function loadCardStats(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'cardStats'));
  const out = {};
  snap.forEach(d => { out[d.id] = d.data(); });
  return out;
}

/** DIRECT ROUTE of the stat lines claimGameReward writes — see functions/index.js. */
export async function recordCardStats(uid, won, box) {
  if (!box?.length) return;
  const batch = writeBatch(db);
  for (const row of box) {
    batch.set(doc(db, 'users', uid, 'cardStats', row.key), {
      games: increment(1),
      wins: increment(won ? 1 : 0),
      pts: increment(row.pts), reb: increment(row.reb), ast: increment(row.ast),
      min: increment(row.min), tpm: increment(row.tpm), tpa: increment(row.tpa),
      lastPlayed: serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
}
