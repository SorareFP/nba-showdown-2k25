// THE THREE WRITES THAT CREATE VALUE, moved to where they can be trusted.
//
// ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
//
// `generatePack` runs in the browser and `addCardsToCollection` writes whatever
// the client hands it. Anyone who can open a console can mint themselves a
// legendary, and no rule written anywhere in the client can stop them, because
// all of them run on the attacker's machine.
//
// That was a fairness question when a collection was a count. Under the supply
// model it is a CORRECTNESS question: a card's pull rate falls as copies enter
// circulation, so a fabricated copy does not just enrich one player, it changes
// the odds for everybody and makes every printed number in
// docs/plans/2026-09-04-card-economy-design.md wrong.
//
// Three writes move value and therefore move here:
//
//   openPack    spends coins and MINTS copies
//   buyListing  moves a copy and coins between two players
//   claimGoal   pays coins and mints an EARNED copy
//
// Everything else — teams, decks, settings — arranges cards a player already
// has, creates nothing, and stays on the client where it is fast.
//
// ── THE FUNCTIONS ARE NOT THE ENFORCEMENT ───────────────────────────────────
//
// firestore.rules is. These functions use the Admin SDK, which bypasses rules
// entirely; the rules refuse the client. Deploying these without the rules
// changes nothing about what a determined client can do — it just adds a
// second, honest path. Deploy order is in README.md and it matters.
//
// ── THE PACK IS GENERATED HERE AND RETURNED, NOT VERIFIED ───────────────────
//
// A tempting cheaper design is to let the client generate and have the server
// check the result. It does not work: the pull is random, so "could this have
// come out" is true of any legal pack, and a client that always reports its
// luckiest possible roll is indistinguishable from a lucky one. The server has
// to hold the dice.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import { generatePack, PACK_TYPES, favoriteTeamOptions, normalizeFavoriteTeam } from './shared/src/game/packEngine.js';
import { goalProgress, goalCoinReward, REWARD_BY_GOAL, collectedKeys } from './shared/src/game/collections.js';
import { getCardByKey } from './shared/src/game/cardSets.js';
import { getPlayerRarity, BURN_VALUES, getStratRarity, STRAT_BURN_VALUES } from './shared/src/game/rarity.js';
import { getStrat } from './shared/src/game/strats.js';
import { settleGameReward, todayKey, sanitizeBox } from './shared/src/game/coinRewards.js';
import { seasonEarnings, dynastyCoinFactor } from './shared/src/game/modes/prizes.js';

initializeApp();
const db = getFirestore();

/** Copy states, mirrored from src/firebase/collection.js. */
const COLLECTED = 'collected';
const SPARE = 'spare';
const LISTED = 'listed';
const EARNED = 'earned';

const MAX_PACKS_PER_MINUTE = 30;

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first');
  return uid;
}

/**
 * Circulating supply, merged across every document under `supply/`.
 *
 * Read here rather than trusted from the client for the obvious reason, and
 * merged rather than read by name for the reason in collection.js: the day one
 * document is not enough, shards are new documents and nothing else changes.
 */
async function readSupply() {
  const snap = await db.collection('supply').get();
  const counts = {};
  snap.forEach(doc => {
    for (const [key, n] of Object.entries(doc.data()?.counts ?? {})) {
      counts[key] = (counts[key] ?? 0) + n;
    }
  });
  return counts;
}

/**
 * OPEN A PACK.
 *
 * The whole operation is one transaction: read the wallet and the supply,
 * generate, then write copies, indexes, supply and the debit together. A pack
 * that half-committed would be the worst outcome available — coins gone and no
 * cards, or cards with no debit.
 */
export const openPack = onCall({ region: 'us-central1' }, async request => {
  const uid = requireAuth(request);
  const { packType, options = {} } = request.data ?? {};

  const def = PACK_TYPES[packType];
  if (!def) throw new HttpsError('invalid-argument', `Unknown pack ${packType}`);

  // A once-only pack is once-only on the SERVER. The client hides the button;
  // that is a courtesy, not a control.
  const userRef = db.doc(`users/${uid}`);
  const supply = await readSupply();

  return db.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new HttpsError('failed-precondition', 'No such player');
    const user = userSnap.data();

    if (def.once && user.starterPackOpened) {
      throw new HttpsError('failed-precondition', 'That pack can only be opened once');
    }

    const cost = def.price ?? 0;
    const coins = user.currency ?? 0;
    if (coins < cost) throw new HttpsError('failed-precondition', `Not enough coins — ${packType} costs ${cost}`);

    // A crude rate limit. Not security — the transaction and the coin balance
    // are that — but it stops a runaway client burning a wallet in a loop and
    // makes a scripted mint attempt visible in the logs.
    const now = Date.now();
    const recent = (user.packWindow?.at ?? 0) > now - 60_000 ? (user.packWindow?.n ?? 0) : 0;
    if (recent >= MAX_PACKS_PER_MINUTE) {
      throw new HttpsError('resource-exhausted', 'Slow down a moment');
    }

    // THE DICE, ROLLED SERVER-SIDE, weighted by the supply the server read.
    // A once-only pack is the same draw for everybody, so it is not weighted by
    // supply — the direct route in serverWrites.js does the same.
    // THE FAVOURITE TEAM COMES OFF THE USER DOC, never off the request. It is
    // write-once (see setFavoriteTeam) precisely so the starter's guaranteed
    // core — and the pack bias that will lean on it later — cannot be steered
    // by a client that fancies a different franchise this minute.
    const cards = generatePack(
      packType,
      def.once
        ? { ...options, favoriteTeam: user.favoriteTeam ?? null }
        : { ...options, supply, favoriteTeam: user.favoriteTeam ?? null }
    );

    // EVERY PULL IS A SPARE. It used to be that the first copy of a card locked
    // itself into the collection on the way out of the pack; since 2026-09-05
    // collecting is something the player DOES (collectCard, below), so a pull
    // stays free to sell or burn until they do.
    // EVERY CARD IN THE PACK — strategy cards included. The loop used to skip
    // anything that was not a player, so every strat pulled through this
    // route was shown on the reveal and never written anywhere (the user:
    // "none of my packed strats are saving to my collection", 2026-09-05).
    // The direct route always saved them, which is why localhost never
    // showed it.
    const minted = {};
    const types = {};
    for (const card of cards) {
      const key = card.id;
      const type = card.type === 'strat' ? 'strat' : 'player';
      tx.set(db.collection(`users/${uid}/copies`).doc(), {
        cardKey: key,
        type,
        mintedAt: FieldValue.serverTimestamp(),
        source: packType,
        state: SPARE,
      });
      minted[key] = (minted[key] ?? 0) + 1;
      types[key] = type;
    }

    for (const [key, n] of Object.entries(minted)) {
      tx.set(
        db.doc(`users/${uid}/collection/${key}`),
        { type: types[key], count: FieldValue.increment(n), acquiredAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    // SUPPLY MOVES ON A MINT — of a PLAYER. Strategy cards have no supply:
    // the pack odds never read them (packEngine.js), so they are not counted.
    // This is the write the whole exercise exists to take out of the client's
    // hands.
    const playerMints = Object.entries(minted).filter(([k]) => types[k] === 'player');
    if (playerMints.length) {
      tx.set(
        db.doc('supply/current'),
        { counts: Object.fromEntries(playerMints.map(([k, n]) => [k, FieldValue.increment(n)])) },
        { merge: true }
      );
    }

    tx.update(userRef, {
      currency: FieldValue.increment(-cost),
      packWindow: { at: now, n: recent + 1 },
      ...(def.once ? { starterPackOpened: true } : {}),
    });

    tx.set(db.collection(`users/${uid}/packHistory`).doc(), {
      packType, cost, openedAt: FieldValue.serverTimestamp(), cards: cards.length,
    });

    // Returned so the reveal screen can show what was ALREADY recorded. The
    // cards are the player's the moment this commits; the animation is a
    // replay, not a negotiation.
    return { cards, spent: cost };
  });
});

/**
 * BUY A LISTING.
 *
 * Moved from the client verbatim in shape — the client version was already a
 * transaction that re-read the listing, which is the one race that matters. It
 * moves here because the coin transfer and the copy move must be beyond a
 * client's reach, not because the logic was wrong.
 *
 * SUPPLY IS NOT TOUCHED. A trade moves a copy that already exists.
 */
export const buyListing = onCall({ region: 'us-central1' }, async request => {
  const uid = requireAuth(request);
  const { listingId } = request.data ?? {};
  if (!listingId) throw new HttpsError('invalid-argument', 'No listing given');

  return db.runTransaction(async tx => {
    const listingRef = db.doc(`listings/${listingId}`);
    const listingSnap = await tx.get(listingRef);
    if (!listingSnap.exists) throw new HttpsError('not-found', 'That listing has already sold');
    const listing = listingSnap.data();
    if (listing.seller === uid) throw new HttpsError('failed-precondition', 'That is your own listing');

    const sellerCopyRef = db.doc(`users/${listing.seller}/copies/${listing.copyId}`);
    const buyerIndexRef = db.doc(`users/${uid}/collection/${listing.cardKey}`);
    const [copySnap, buyerSnap, buyerIndexSnap] = await tx.getAll(
      sellerCopyRef, db.doc(`users/${uid}`), buyerIndexRef
    );

    if (!copySnap.exists || copySnap.data().state !== LISTED) {
      tx.delete(listingRef);
      throw new HttpsError('failed-precondition', 'That listing is no longer valid');
    }
    const coins = buyerSnap.data()?.currency ?? 0;
    if (coins < listing.price) {
      throw new HttpsError('failed-precondition', `Not enough coins — this costs ${listing.price}`);
    }

    const copy = copySnap.data();

    tx.delete(sellerCopyRef);
    tx.set(db.collection(`users/${uid}/copies`).doc(), {
      cardKey: listing.cardKey,
      mintedAt: copy.mintedAt ?? null,
      source: copy.source ?? null,
      // A bought card is a spare until its new owner collects it.
      state: SPARE,
      acquiredAt: FieldValue.serverTimestamp(),
      boughtFrom: listing.seller,
      boughtFor: listing.price,
    });
    tx.set(db.doc(`users/${listing.seller}/collection/${listing.cardKey}`),
      { count: FieldValue.increment(-1) }, { merge: true });
    tx.set(buyerIndexRef,
      { type: 'player', count: FieldValue.increment(1), acquiredAt: FieldValue.serverTimestamp() },
      { merge: true });
    tx.set(db.doc(`users/${uid}`), { currency: FieldValue.increment(-listing.price) }, { merge: true });
    tx.set(db.doc(`users/${listing.seller}`), { currency: FieldValue.increment(listing.price) }, { merge: true });
    tx.delete(listingRef);

    return { cardKey: listing.cardKey, price: listing.price };
  });
});

/**
 * CLAIM A COMPLETED GOAL.
 *
 * ELIGIBILITY IS RE-DERIVED FROM THE SERVER'S OWN VIEW of the collection. The
 * client sends a goal id and nothing else; whether that goal is complete is a
 * question the server answers by reading what the player actually owns and
 * running the same `goalProgress` the tracker runs.
 *
 * The reward copy is minted `earned`, which is never burnable and never
 * tradable at any count — a market for team rewards would make the whole
 * difficulty ladder purchasable.
 */
export const claimGoal = onCall({ region: 'us-central1' }, async request => {
  const uid = requireAuth(request);
  const { goalId } = request.data ?? {};
  if (!goalId) throw new HttpsError('invalid-argument', 'No goal given');

  // A SET OF KEYS, not the documents. `goalProgress` asks `ownedKeys.has(key)`
  // — passing the map of documents instead throws `ownedKeys.has is not a
  // function` at the first player who finishes a collection, which is the worst
  // possible moment to find out. A count of zero is not ownership, so the
  // filter matters too.
  const collectionSnap = await db.collection(`users/${uid}/collection`).get();
  const index = {};
  collectionSnap.forEach(doc => { index[doc.id] = doc.data(); });
  // COLLECTED cards, not owned ones — the same rule the client's goal ladder reads.
  const owned = collectedKeys(index);

  const progress = goalProgress(goalId, owned);
  if (!progress?.complete) throw new HttpsError('failed-precondition', 'That collection is not finished');

  const claimRef = db.doc(`users/${uid}/claims/${goalId}`);
  const rewardKey = REWARD_BY_GOAL[goalId] ?? null;
  const coins = goalCoinReward(goalId) ?? 0;

  return db.runTransaction(async tx => {
    const claimSnap = await tx.get(claimRef);
    // THE DOUBLE-CLAIM GUARD. Two taps, two tabs, or a retried call all land
    // here, and only the first finds an empty claim document.
    if (claimSnap.exists) throw new HttpsError('already-exists', 'Already claimed');

    tx.set(claimRef, { claimedAt: FieldValue.serverTimestamp(), reward: rewardKey, coins });

    if (rewardKey) {
      tx.set(db.collection(`users/${uid}/copies`).doc(), {
        cardKey: rewardKey,
        mintedAt: FieldValue.serverTimestamp(),
        source: `goal:${goalId}`,
        state: EARNED,
      });
      tx.set(db.doc(`users/${uid}/collection/${rewardKey}`),
        { type: 'player', count: FieldValue.increment(1), earned: true,
          acquiredAt: FieldValue.serverTimestamp() },
        { merge: true });
      // A reward IS a mint: the card did not exist before the collection was
      // finished, so circulation moves.
      tx.set(db.doc('supply/current'),
        { counts: { [rewardKey]: FieldValue.increment(1) } }, { merge: true });
    }
    if (coins > 0) tx.set(db.doc(`users/${uid}`), { currency: FieldValue.increment(coins) }, { merge: true });

    return { goalId, reward: rewardKey, coins };
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FOUR MORE, found by reading firestore.rules against the client's writes.
//
// The first cut moved the three writes that MINT. But the rules close every
// write to copies, currency, supply and listings, and the client had four more
// of those: putting a card on the market, taking it off, burning a spare for
// coins, and paying out a finished game. Each would have failed the moment the
// rules landed. They live here now for the same reason the first three do.
// ═══════════════════════════════════════════════════════════════════════════

/** Mirrored from src/firebase/market.js — that file imports the client SDK. */
const MAX_PRICE = 1_000_000;
const validPrice = p => Number.isInteger(p) && p > 0 && p <= MAX_PRICE;

/** A real game takes minutes; more claims than this a minute is a script. */
const MAX_GAME_CLAIMS_PER_MINUTE = 3;

/**
 * One SPARE copy of a card, chosen for the caller, or the reason there is none.
 *
 * The caller names a CARD, never a copy: which physical copy is sold or burned
 * is not a choice worth making a player make, and taking a copy id would let
 * the client point at the collected one. `spare` is the only state this will
 * hand back — `collected` and `earned` are unreachable by construction, and
 * `listed` is excluded so a card on the market cannot also be burned.
 *
 * A transaction read, so the state is the state at commit time.
 */
async function findSpare(tx, uid, cardKey) {
  const snap = await tx.get(db.collection(`users/${uid}/copies`).where('cardKey', '==', cardKey));
  if (snap.empty) throw new HttpsError('failed-precondition', 'Card not owned');
  const mine = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
  const spare = mine.find(c => c.state === SPARE);
  if (!spare) {
    const only = mine.find(c => c.state === COLLECTED || c.state === EARNED);
    throw new HttpsError(
      'failed-precondition',
      only?.state === EARNED
        ? 'This is a collection reward — it can never be sold or burned'
        : 'Your only copy is the one in your collection — collect a spare first'
    );
  }
  return { spare, count: mine.length };
}

/**
 * PUT A SPARE ON THE MARKET.
 *
 * Escrow by state, not by moving the document: the copy stays in the seller's
 * subtree and stops being spare. A listing nobody buys needs no repair.
 */
export const listCard = onCall({ region: 'us-central1' }, async request => {
  const uid = requireAuth(request);
  const { cardKey, price } = request.data ?? {};
  if (!cardKey) throw new HttpsError('invalid-argument', 'No card given');
  if (!validPrice(price)) {
    throw new HttpsError('invalid-argument', 'Price must be a whole number of coins above zero');
  }

  return db.runTransaction(async tx => {
    const { spare } = await findSpare(tx, uid, cardKey);
    const listingRef = db.collection('listings').doc();
    tx.update(spare.ref, { state: LISTED, listingId: listingRef.id });
    tx.set(listingRef, {
      cardKey, copyId: spare.id, seller: uid, price, listedAt: FieldValue.serverTimestamp(),
    });
    return { listingId: listingRef.id };
  });
});

/** TAKE A LISTING DOWN. The copy goes back to being an ordinary spare. */
export const delistCard = onCall({ region: 'us-central1' }, async request => {
  const uid = requireAuth(request);
  const { listingId } = request.data ?? {};
  if (!listingId) throw new HttpsError('invalid-argument', 'No listing given');

  return db.runTransaction(async tx => {
    const listingRef = db.doc(`listings/${listingId}`);
    const snap = await tx.get(listingRef);
    if (!snap.exists) throw new HttpsError('not-found', 'That listing is already gone');
    const listing = snap.data();
    if (listing.seller !== uid) throw new HttpsError('permission-denied', 'That is not your listing');

    tx.update(db.doc(`users/${uid}/copies/${listing.copyId}`), { state: SPARE, listingId: null });
    tx.delete(listingRef);
    return { listingId };
  });
});

/**
 * BURN A SPARE FOR COINS.
 *
 * THE PRICE COMES FROM THE CARD. The client version took the burn value as an
 * argument, which meant the browser named its own price for destroying a
 * common. Here it is looked up from the card's rarity in the same table the
 * shop uses, and a key that resolves to no card cannot be burned at all.
 *
 * A burned card leaves the supply, so the pool feels it and the card becomes
 * fractionally likelier to appear again. That is what makes burning a sink
 * rather than a shrug.
 */
export const burnCard = onCall({ region: 'us-central1' }, async request => {
  const uid = requireAuth(request);
  const { cardKey } = request.data ?? {};
  if (!cardKey) throw new HttpsError('invalid-argument', 'No card given');

  // A player is valued by its rarity band; a strategy card by its own table.
  // The strat branch is new with the pack fix above — a strat could not be
  // burned before because it had never been minted here.
  const card = getCardByKey(cardKey);
  const strat = card ? null : getStrat(cardKey);
  const value = card
    ? BURN_VALUES[getPlayerRarity(card)]
    : strat ? STRAT_BURN_VALUES[getStratRarity(strat)] : undefined;
  if (!Number.isFinite(value)) throw new HttpsError('invalid-argument', 'That card cannot be burned');

  return db.runTransaction(async tx => {
    const { spare, count } = await findSpare(tx, uid, cardKey);
    const indexRef = db.doc(`users/${uid}/collection/${cardKey}`);

    tx.delete(spare.ref);
    if (count <= 1) tx.delete(indexRef);
    else tx.set(indexRef, { count: FieldValue.increment(-1) }, { merge: true });
    tx.set(db.doc('supply/current'), { counts: { [cardKey]: FieldValue.increment(-1) } }, { merge: true });
    tx.set(db.doc(`users/${uid}`), { currency: FieldValue.increment(value) }, { merge: true });

    return { cardKey, coins: value };
  });
});

/**
 * PAY OUT A FINISHED GAME.
 *
 * The server never sees the game. It sees a claim — won, PvP, which milestones,
 * whether Bam was hit — and prices it with settleGameReward, the same function
 * the results screen runs, against ITS OWN copy of the daily counters. So a
 * client can still claim a game it did not play, but it cannot be paid more per
 * game than the table says, more milestone coins a day than the cap, or the
 * first-win bonus twice; and it cannot claim faster than games can be played.
 * Before this, addCoins() accepted any integer from anyone.
 *
 * The daily counters are written HERE and nowhere else — the rules no longer
 * let the client touch them, because a client that can zero its own counters
 * has no cap.
 */
export const claimGameReward = onCall({ region: 'us-central1' }, async request => {
  const uid = requireAuth(request);
  const d = request.data ?? {};
  const claim = {
    won: Boolean(d.won),
    pvp: Boolean(d.pvp),
    milestoneIds: Array.isArray(d.milestoneIds)
      ? d.milestoneIds.filter(x => typeof x === 'string').slice(0, 8)
      : [],
    bam: Boolean(d.bam),
    // The lifetime tracker's input: one line per card that took the floor for
    // the caller's team. Sanitized to shape, then to cards that exist.
    box: sanitizeBox(d.box).filter(row => getCardByKey(row.key)),
  };
  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new HttpsError('failed-precondition', 'No such player');
    const user = userSnap.data();

    const now = Date.now();
    const recent = (user.gameWindow?.at ?? 0) > now - 60_000 ? (user.gameWindow?.n ?? 0) : 0;
    if (recent >= MAX_GAME_CLAIMS_PER_MINUTE) {
      throw new HttpsError('resource-exhausted', 'Slow down a moment');
    }

    const today = todayKey();
    const settled = settleGameReward(
      claim,
      { date: user.dailyMilestoneDate, coins: user.dailyMilestoneCoins, firstWin: user.dailyFirstWin },
      today
    );

    // The Bam card is a MINT, so it goes through the same lock-on-collect and
    // supply bookkeeping as a pull. Reads first: Firestore transactions refuse
    // a read after a write.
    let minted = null;
    const bamKey = settled.bam && getCardByKey(settled.bamCardId) ? settled.bamCardId : null;
    const bamIndexRef = bamKey ? db.doc(`users/${uid}/collection/${bamKey}`) : null;

    if (bamKey) {
      tx.set(db.collection(`users/${uid}/copies`).doc(), {
        cardKey: bamKey,
        mintedAt: FieldValue.serverTimestamp(),
        source: 'milestone',
        state: SPARE,
      });
      tx.set(bamIndexRef,
        { type: 'player', count: FieldValue.increment(1), acquiredAt: FieldValue.serverTimestamp() },
        { merge: true });
      tx.set(db.doc('supply/current'), { counts: { [bamKey]: FieldValue.increment(1) } }, { merge: true });
      minted = bamKey;
    }

    tx.update(userRef, {
      currency: FieldValue.increment(settled.coins),
      dailyMilestoneDate: settled.daily.date,
      dailyMilestoneCoins: settled.daily.coins,
      dailyFirstWin: settled.daily.firstWin,
      gameWindow: { at: now, n: recent + 1 },
    });

    // LIFETIME STATS, per card, per player: totals the client averages. They
    // ride the reward claim because that is the one call a finished game
    // already makes, rate-limited above, and because a stat line the client
    // could write directly would be a stat line the client could invent.
    for (const row of claim.box) {
      tx.set(db.doc(`users/${uid}/cardStats/${row.key}`), {
        games: FieldValue.increment(1),
        wins: FieldValue.increment(claim.won ? 1 : 0),
        pts: FieldValue.increment(row.pts),
        reb: FieldValue.increment(row.reb),
        ast: FieldValue.increment(row.ast),
        min: FieldValue.increment(row.min),
        tpm: FieldValue.increment(row.tpm),
        tpa: FieldValue.increment(row.tpa),
        lastPlayed: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return {
      coins: settled.coins,
      milestoneCoins: settled.milestoneCoins,
      firstWin: settled.firstWin,
      bam: Boolean(minted),
      minted,
    };
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DEV: RESET AN ACCOUNT. Gated to the game's own account, server-side.
//
// Testing a rollout means opening the starter pack more than once, and the
// server quite rightly refuses that. The old reset was a pile of direct writes
// from the browser; those die the moment the rules land, so it moves here. It
// is the only function that checks WHO is calling beyond "signed in", because
// it is the only one whose whole purpose is to do what the rules forbid.
//
// It also knows about everything the old one did not: the copies ledger,
// claims, the account's own listings — and it hands every deleted copy back to
// the supply, or a reset leaves the pool counting cards that no longer exist
// and the pull rates for everybody else drift.
// ═══════════════════════════════════════════════════════════════════════════

const ADMIN_EMAILS = new Set(['hoopsonhoops@gmail.com']);

/** Firestore batches take 500 writes; stay well under with headroom. */
const BATCH = 400;

/**
 * WIPE ONE ACCOUNT back to a fresh sign-in: every card, the ledger, the
 * currency, teams, decks, seasons, the roaming game, the lifetime card stats,
 * the favourite team and the starter-pack status. Deleted copies go back to
 * supply. Shared by devResetAccount (the caller's own account, or an admin's
 * chosen target) and the all-accounts wipe the user asked for on 2026-09-08
 * ("wipe all collections and starterPackOpened from the four users").
 */
async function wipeAccount(uid) {
  // Teams and decks too: they name cards, and after a reset they would name
  // cards the account no longer holds. The user noticed (2026-09-05).
  const [copies, coll, hist, claims, listings, teams, decks, seasons, games, stats] = await Promise.all([
    db.collection(`users/${uid}/copies`).get(),
    db.collection(`users/${uid}/collection`).get(),
    db.collection(`users/${uid}/packHistory`).get(),
    db.collection(`users/${uid}/claims`).get(),
    db.collection('listings').where('seller', '==', uid).get(),
    db.collection(`users/${uid}/teams`).get(),
    db.collection(`users/${uid}/decks`).get(),
    db.collection(`users/${uid}/seasons`).get(),
    db.collection(`users/${uid}/games`).get(),
    db.collection(`users/${uid}/cardStats`).get(),
  ]);

  // Every copy that existed leaves circulation, whatever state it was in —
  // an earned reward and a bought card were both counted into the supply when
  // they were minted.
  const returned = {};
  copies.forEach(d => {
    const key = d.data()?.cardKey;
    if (key) returned[key] = (returned[key] ?? 0) - 1;
  });

  const refs = [...copies.docs, ...coll.docs, ...hist.docs, ...claims.docs, ...listings.docs, ...teams.docs, ...decks.docs, ...seasons.docs, ...games.docs, ...stats.docs].map(d => d.ref);
  for (let i = 0; i < refs.length; i += BATCH) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + BATCH)) batch.delete(ref);
    await batch.commit();
  }

  const last = db.batch();
  if (Object.keys(returned).length) {
    last.set(
      db.doc('supply/current'),
      { counts: Object.fromEntries(Object.entries(returned).map(([k, n]) => [k, FieldValue.increment(n)])) },
      { merge: true }
    );
  }
  last.set(db.doc(`users/${uid}`), {
    currency: 0,
    starterPackOpened: false,
    dailyMilestoneCoins: 0,
    dailyMilestoneDate: '',
    dailyFirstWin: false,
    packWindow: FieldValue.delete(),
    gameWindow: FieldValue.delete(),
    // The favourite team is write-once by rule; a wiped account chooses again.
    favoriteTeam: FieldValue.delete(),
    // A saved reveal names cards that no longer exist in the ledger.
    settings: { pendingReveals: [] },
  }, { merge: true });
  await last.commit();

  return {
    uid,
    copies: copies.size, cards: coll.size, claims: claims.size, listings: listings.size,
    teams: teams.size, decks: decks.size, seasons: seasons.size, games: games.size, cardStats: stats.size,
  };
}

/**
 * DEV RESET of the caller's OWN account, admins only. It once took
 * `{ all: true }` for the beta wipe; the user had that removed the same day
 * ("I don't want to accidentally use it"), so there is no argument here that
 * aims it at anyone else. Nothing about the supply's opening counts is
 * touched beyond handing deleted copies back.
 */
export const devResetAccount = onCall({ region: 'us-central1' }, async request => {
  const uid = requireAuth(request);
  const email = request.auth?.token?.email ?? '';
  if (!ADMIN_EMAILS.has(email)) throw new HttpsError('permission-denied', 'Not a dev account');
  return wipeAccount(uid);
});

/**
 * DEV COINS. Admins only, adds to the caller's own balance. The direct client
 * write this replaces stops working the moment the rules land (currency is
 * not a client-writable field), and a dev tool that only works before the
 * rules is a dev tool that is about to break.
 */
export const devGrantCoins = onCall({ region: 'us-central1' }, async request => {
  const uid = requireAuth(request);
  const email = request.auth?.token?.email ?? '';
  if (!ADMIN_EMAILS.has(email)) throw new HttpsError('permission-denied', 'Not a dev account');
  const amount = Number(request.data?.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) throw new HttpsError('invalid-argument', 'amount');
  await db.doc(`users/${uid}`).set({ currency: FieldValue.increment(amount) }, { merge: true });
  return { added: amount };
});

/**
 * COLLECT: put one of the caller's copies of a card into the collection.
 *
 * This is the act that used to happen by itself at the pack. The copy becomes
 * `collected` — never burnable, never listable — and the index says so, which
 * is what the goal ladder and claimGoal read. A copy already locked under the
 * old rule counts: the index just did not carry the flag yet, so pressing
 * Collect on it writes the flag and changes nothing else. Idempotent.
 */
/**
 * COLLECT EVERYTHING COLLECTABLE in one go: for every player card the caller
 * owns a spare of and has not collected, one spare becomes `collected` and
 * the index says so — the same two writes collectCard makes, batched. Cards
 * on the market are not spares and are left alone; strategy cards are not
 * collected (the ladder does not count them). The user (2026-09-08): "bulk
 * collection actions like checkboxes or a 'collect all uncollected' button."
 */
export const collectAllCards = onCall({ region: 'us-central1' }, async request => {
  const uid = requireAuth(request);
  const [spares, index] = await Promise.all([
    db.collection(`users/${uid}/copies`).where('state', '==', SPARE).get(),
    db.collection(`users/${uid}/collection`).get(),
  ]);
  const skip = new Set();
  index.forEach(d => { const x = d.data(); if (x.collected || x.type === 'strat') skip.add(d.id); });
  const pick = new Map();
  spares.forEach(d => {
    const key = d.data()?.cardKey;
    if (!key || skip.has(key) || pick.has(key)) return;
    const card = getCardByKey(key);
    if (!card) return;
    pick.set(key, d.ref);
  });
  const entries = [...pick.entries()];
  const now = FieldValue.serverTimestamp();
  for (let i = 0; i < entries.length; i += 200) {
    const batch = db.batch();
    for (const [key, ref] of entries.slice(i, i + 200)) {
      batch.update(ref, { state: COLLECTED, collectedAt: now });
      batch.set(db.doc(`users/${uid}/collection/${key}`), { collected: true, collectedAt: now }, { merge: true });
    }
    await batch.commit();
  }
  return { collected: entries.length };
});

/**
 * The franchises a player may actually name, DERIVED from the cards rather
 * than listed — so a set that adds or retires a team cannot leave this behind.
 * Both leagues, because the starter's pool spans both.
 */
const KNOWN_FRANCHISES = new Set(favoriteTeamOptions());

/**
 * NAME YOUR TEAM — once, and only once.
 *
 * The user, 2026-09-07: "players [can] pick their favorite team, either NBA or
 * WNBA ... Then maybe a small packing boost in the future based on that
 * setting (which cannot be changed in the future)."
 *
 * Write-once is the whole point: it guarantees the starter's core and will
 * later tilt pack odds, so a client that could rewrite it could farm whichever
 * franchise happened to be worth most. The transaction refuses a second write,
 * and the franchise must be one the game actually has.
 */
export const setFavoriteTeam = onCall({ region: 'us-central1' }, async request => {
  const uid = requireAuth(request);
  // Stored league-qualified — "nba:MIL", "wnba:LVA" — because seven codes
  // mean a team in both leagues.
  // Normalised the same way the option list is spelled ("nba:CLE"); the
  // old .toLowerCase() here refused every single choice as unknown.
  const team = normalizeFavoriteTeam(request.data?.team);
  if (!team || !KNOWN_FRANCHISES.has(team)) throw new HttpsError('invalid-argument', `Unknown team ${request.data?.team ?? ''}`);
  const userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async tx => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new HttpsError('failed-precondition', 'No such player');
    const existing = snap.data().favoriteTeam;
    if (existing) throw new HttpsError('failed-precondition', `Your team is already ${existing} — that choice is permanent`);
    tx.update(userRef, { favoriteTeam: team });
    return { favoriteTeam: team };
  });
});

export const collectCard = onCall({ region: 'us-central1' }, async request => {
  const uid = requireAuth(request);
  const cardKey = String(request.data?.cardKey ?? '');
  if (!getCardByKey(cardKey)) throw new HttpsError('invalid-argument', 'No such card');
  const indexRef = db.doc(`users/${uid}/collection/${cardKey}`);

  return db.runTransaction(async tx => {
    const snap = await tx.get(db.collection(`users/${uid}/copies`).where('cardKey', '==', cardKey));
    if (snap.empty) throw new HttpsError('failed-precondition', 'Card not owned');
    const mine = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
    const already = mine.find(c => c.state === COLLECTED || c.state === EARNED);
    const spare = mine.find(c => c.state === SPARE);
    if (!already && !spare) {
      throw new HttpsError('failed-precondition', 'Your only copy is on the market — delist it first');
    }
    if (!already) tx.update(spare.ref, { state: COLLECTED, collectedAt: FieldValue.serverTimestamp() });
    tx.set(indexRef, { collected: true, collectedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { cardKey, copyId: (already ?? spare).id };
  });
});

/**
 * THE TITLE MONEY. What a finished season pays once, on top of what its
 * individual games already paid through claimGameReward.
 *
 * ── WHY THE SERVER READS THE SEASON RATHER THAN BEING TOLD THE PRIZE ────────
 *
 * The client could just send "I won, pay me 400". It sends a season id
 * instead, and the price comes from SEASON_REWARDS keyed by the season's own
 * length. A client that lies still has to lie in the document — and the
 * document is the thing it plays a whole schedule to fill in.
 *
 * That is the same trust model as claimGameReward, which believes the browser
 * about who won a game, and for the same reason: the dice are rolled on the
 * client. What is NOT trusted is the double claim, and that is why the receipt
 * goes in `claims` — the server-only collection the goal ladder already uses —
 * rather than as a `paid` flag on the client-writable season.
 */
export const claimSeasonReward = onCall({ region: 'us-central1' }, async request => {
  const uid = requireAuth(request);
  const seasonId = String(request.data?.seasonId ?? '').trim();
  if (!seasonId || seasonId.includes('/')) throw new HttpsError('invalid-argument', 'No season given');

  const seasonSnap = await db.doc(`users/${uid}/seasons/${seasonId}`).get();
  if (!seasonSnap.exists) throw new HttpsError('not-found', 'No such season');
  const season = seasonSnap.data();
  if (season.phase !== 'done') throw new HttpsError('failed-precondition', 'That season is not over');

  // The human team is the one this account played. A season with none of them
  // is a document that was not written by this mode.
  const mine = (season.teams ?? []).find(t => t.human);
  if (!mine) throw new HttpsError('failed-precondition', 'That season has no team of yours');

  const factor = dynastyCoinFactor(season.startMode);
  const { coins, label } = seasonEarnings(season.length, {
    champion: season.champion === mine.id,
    runnerUp: season.runnerUp === mine.id,
    madePlayoffs: (season.playoffSeeds ?? []).includes(mine.id),
  }, factor);
  if (!coins) throw new HttpsError('failed-precondition', 'That season finished out of the money');

  const claimRef = db.doc(`users/${uid}/claims/season:${seasonId}`);
  return db.runTransaction(async tx => {
    const claim = await tx.get(claimRef);
    if (claim.exists) throw new HttpsError('already-exists', 'Already claimed');
    tx.set(claimRef, { claimedAt: FieldValue.serverTimestamp(), coins, reward: null, season: seasonId, label });
    tx.set(db.doc(`users/${uid}`), { currency: FieldValue.increment(coins) }, { merge: true });
    return { seasonId, coins, label };
  });
});
