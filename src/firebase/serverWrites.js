// THE SWITCH between writing value from the browser and asking the server to.
//
// ── WHY THERE IS A SWITCH AT ALL ────────────────────────────────────────────
//
// The Cloud Functions exist (functions/index.js). The moment the client starts
// calling them it stops working until they are deployed, and the moment
// firestore.rules is deployed the direct path stops working whether the client
// is ready or not. Those two facts in the wrong order are a broken game, so the
// order is made explicit here rather than left to a deploy day:
//
//   1. deploy the functions          nothing changes; nobody calls them
//   2. flip USE_CLOUD_FUNCTIONS      the client asks the server instead
//   3. verify a pack, a buy, a claim
//   4. deploy firestore.rules        the direct path is closed for good
//
// Step 4 is the one that actually secures anything. Steps 1 to 3 are how you
// get there without a window where the game is down.
//
// ── THE SWITCH HAS TO BE WHERE THE CALLS ARE ────────────────────────────────
//
// The first version of this file exported the flag and three `...OnServer`
// wrappers, and nothing imported any of them: every component kept calling
// collection.js and market.js directly, the flag was read by nobody, and the
// functions were deployed to an app that never dialled them. Step 3 would have
// passed while proving nothing, and step 4 would have broken every write in
// the game.
//
// So now the components import their value-moving calls from HERE, and this
// file decides. Both routes export the same seven names with the same
// signatures, and the flag picks a table. Flipping it back is still one word.
//
// ── ONE SHAPE FOR OPENING A PACK ────────────────────────────────────────────
//
// The server rolls the dice, so it has to be asked BEFORE the reveal — the
// cards it returns are the cards, and the animation is a replay. The direct
// route used to save AFTER the animation; it now saves first too, so the
// component has one flow and the reveal never shows a pack that then fails to
// save. That is a small change to how the direct path behaves, and the right
// one regardless of the flag.
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  collection, doc, getDoc, getDocs, query, where, writeBatch, increment, deleteField,
  runTransaction, serverTimestamp,
} from 'firebase/firestore';
import { app, db } from './config.js';
import {
  addCardsToCollection,
  burnCard as burnCardDirect,
  claimGoal as claimGoalDirect,
  addCoins,
  getUserData,
  updateUserFields, collectCardDirect, recordCardStats } from './collection.js';
import {
  listCard as listCardDirect,
  delistCard as delistCardDirect,
  buyListing as buyListingDirect,
} from './market.js';
import { generatePack, PACK_TYPES, favoriteTeamOptions } from '../game/packEngine.js';
import { getCardByKey } from '../game/cardSets.js';
import { burnValueFor, listingFloor, checkListingPrice } from '../game/marketRules.js';
import { settleGameReward, todayKey, sanitizeBox } from '../game/coinRewards.js';
import { seasonEarnings, dynastyCoinFactor } from '../game/modes/prizes.js';

/**
 * FLIP THIS AFTER `firebase deploy --only functions`.
 *
 * False means every value-moving write happens in the browser, which is where
 * they have always happened and which anybody with a console can forge.
 */
export const USE_CLOUD_FUNCTIONS = true;

let fns = null;
function callable(name) {
  fns ??= getFunctions(app, 'us-central1');
  return httpsCallable(fns, name);
}

/**
 * Unwraps a callable result and re-throws its error as a plain one.
 *
 * A Firebase `HttpsError` arrives with the message buried and a `code` like
 * `functions/failed-precondition` attached, and every caller in this app shows
 * `e.message` to a player. Passing it through raw would put "internal" on
 * screen where "Not enough coins" belongs.
 */
async function call(name, payload) {
  try {
    const res = await callable(name)(payload);
    return res.data;
  } catch (e) {
    const message = e?.details?.message ?? e?.message ?? 'Something went wrong';
    throw new Error(String(message).replace(/^functions\/[a-z-]+:?\s*/i, ''));
  }
}

/**
 * What a spare of this card is worth when burned — from the card's rarity,
 * never from the caller. The old burnCard took the value as an argument, which
 * meant the browser named its own price. It lives in marketRules.js now,
 * beside the listing floor it also sets; re-exported here for its readers.
 */
export { burnValueFor, listingFloor, checkListingPrice };

/** The server route. `uid` is ignored: the server knows who is calling. */
const server = {
  openPack: (uid, packType, options = {}) => call('openPack', { packType, options }),
  buyListing: (uid, listingId) => call('buyListing', { listingId }),
  claimGoal: (uid, goalId) => call('claimGoal', { goalId }),
  listCard: (uid, cardKey, price) => call('listCard', { cardKey, price }),
  delistCard: (uid, listingId) => call('delistCard', { listingId }),
  burnCard: (uid, cardKey) => call('burnCard', { cardKey }),
  claimGameReward: (uid, claim) => call('claimGameReward', claim),
  claimSeasonReward: (uid, seasonId) => call('claimSeasonReward', { seasonId }),
  setFavoriteTeam: (uid, team) => call('setFavoriteTeam', { team }),
  collectCard: (uid, cardKey) => call('collectCard', { cardKey }),
  collectAllCards: () => call('collectAllCards', {}),
  // Leagues — tournaments and human seasons. Server only: fees, payouts and
  // room-verified results have no honest direct route.
  createLeague: (uid, payload) => call('createLeague', payload),
  joinLeague: (uid, payload) => call('joinLeague', payload),
  leaveLeague: (uid, leagueId) => call('leaveLeague', { leagueId }),
  cancelLeague: (uid, leagueId) => call('cancelLeague', { leagueId }),
  startLeague: (uid, payload) => call('startLeague', payload),
  attachLeagueRoom: (uid, payload) => call('attachLeagueRoom', payload),
  reportLeagueResult: (uid, payload) => call('reportLeagueResult', payload),
  forfeitLeagueFixture: (uid, payload) => call('forfeitLeagueFixture', payload),
  devResetAccount: () => call('devResetAccount', {}),
  devGrantCoins: (uid, amount) => call('devGrantCoins', { amount }),
};

/** The direct route: the browser does it all, as it always did. */
const direct = {
  async openPack(uid, packType, options = {}, supply = {}) {
    const def = PACK_TYPES[packType];
    if (!def) throw new Error(`Unknown pack ${packType}`);
    // The starter is the same draw for everybody, so it is not weighted by what
    // the playerbase already owns — see CollectionTab for the reasoning.
    const cards = generatePack(packType, def.once ? { ...options } : { ...options, supply });
    await addCardsToCollection(uid, cards, packType, def.price ?? 0);
    if (def.once) await updateUserFields(uid, { starterPackOpened: true });
    return { cards, spent: def.price ?? 0 };
  },
  buyListing: (uid, listingId) => buyListingDirect(uid, listingId),
  claimGoal: (uid, goalId) => claimGoalDirect(uid, goalId),
  /**
   * The permanent favourite-team choice, made in the browser. Write-once here
   * too — the transaction is the whole point of the call, not the round trip.
   */
  async setFavoriteTeam(uid, team) {
    const value = String(team ?? '').trim().toLowerCase();
    if (!favoriteTeamOptions().includes(value)) throw new Error(`Unknown team ${value}`);
    const userRef = doc(db, 'users', uid);
    await runTransaction(db, async tx => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) throw new Error('No such player');
      const existing = snap.data().favoriteTeam;
      if (existing) throw new Error(`Your team is already ${existing} — that choice is permanent`);
      tx.update(userRef, { favoriteTeam: value });
    });
    return { favoriteTeam: value };
  },

  /**
   * A finished season's title money, paid in the browser. The receipt is the
   * same `claims/season:{id}` document the server writes, so a client that
   * pays itself here and a server that pays it later cannot both succeed.
   */
  async claimSeasonReward(uid, seasonId) {
    const seasonSnap = await getDoc(doc(db, 'users', uid, 'seasons', String(seasonId)));
    if (!seasonSnap.exists()) throw new Error('No such season');
    const season = seasonSnap.data();
    if (season.phase !== 'done') throw new Error('That season is not over');
    const mine = (season.teams ?? []).find(t => t.human);
    if (!mine) throw new Error('That season has no team of yours');
    const { coins, label } = seasonEarnings(season.length, {
      champion: season.champion === mine.id,
      runnerUp: season.runnerUp === mine.id,
      madePlayoffs: (season.playoffSeeds ?? []).includes(mine.id),
    }, dynastyCoinFactor(season.startMode));
    if (!coins) throw new Error('That season finished out of the money');
    const claimRef = doc(db, 'users', uid, 'claims', `season:${seasonId}`);
    await runTransaction(db, async tx => {
      const claim = await tx.get(claimRef);
      if (claim.exists()) throw new Error('Already claimed');
      tx.set(claimRef, { claimedAt: serverTimestamp(), coins, reward: null, season: seasonId, label });
      tx.set(doc(db, 'users', uid), { currency: increment(coins) }, { merge: true });
    });
    return { seasonId, coins, label };
  },
  collectCard: (uid, cardKey) => collectCardDirect(uid, cardKey),
  listCard: async (uid, cardKey, price) => {
    // The same floor the server holds: never below the burn value.
    const floor = checkListingPrice(cardKey, price);
    if (!floor.ok) throw new Error(floor.msg);
    return listCardDirect(uid, cardKey, price);
  },
  delistCard: (uid, listingId) => delistCardDirect(uid, listingId),
  async burnCard(uid, cardKey) {
    const value = burnValueFor(cardKey);
    if (value == null) throw new Error('That card cannot be burned');
    await burnCardDirect(uid, cardKey, value);
    return { cardKey, coins: value };
  },
  async claimGameReward(uid, claim) {
    const me = await getUserData(uid);
    const today = todayKey();
    const settled = settleGameReward(
      claim,
      { date: me?.dailyMilestoneDate, coins: me?.dailyMilestoneCoins, firstWin: me?.dailyFirstWin },
      today
    );
    if (settled.coins > 0) await addCoins(uid, settled.coins);
    await updateUserFields(uid, {
      dailyMilestoneDate: settled.daily.date,
      dailyMilestoneCoins: settled.daily.coins,
      dailyFirstWin: settled.daily.firstWin,
    });
    if (settled.bam) {
      await addCardsToCollection(uid, [{ id: settled.bamCardId, type: 'player' }], 'milestone', 0);
    }
    await recordCardStats(uid, settled.won ?? claim.won, sanitizeBox(claim.box).filter(r => getCardByKey(r.key)));
    return {
      coins: settled.coins,
      milestoneCoins: settled.milestoneCoins,
      firstWin: settled.firstWin,
      bam: settled.bam,
      minted: settled.bam ? settled.bamCardId : null,
    };
  },
  /**
   * DEV. Everything the server version does, from the browser — which only
   * works while the rules are not deployed, which is exactly when this route
   * is the live one. Gated in the component to dev builds and the game's own
   * account; the server route is gated again server-side.
   */
  /** Leagues have no direct route at all. */
  async createLeague() { throw new Error('Leagues need the server route'); },
  async joinLeague() { throw new Error('Leagues need the server route'); },
  async leaveLeague() { throw new Error('Leagues need the server route'); },
  async cancelLeague() { throw new Error('Leagues need the server route'); },
  async startLeague() { throw new Error('Leagues need the server route'); },
  async attachLeagueRoom() { throw new Error('Leagues need the server route'); },
  async reportLeagueResult() { throw new Error('Leagues need the server route'); },
  async forfeitLeagueFixture() { throw new Error('Leagues need the server route'); },
  /** Bulk collect has no direct route: one card at a time, through collectCardDirect. */
  async collectAllCards() { throw new Error('Collect all needs the server route'); },
  /** Dev coins on the direct route: the old client write, which the rules will refuse. */
  async devGrantCoins(uid, amount) {
    await addCoins(uid, amount);
    return { added: amount };
  },
  async devResetAccount(uid) {
    const [copies, coll, hist, claims, listings, teams, decks] = await Promise.all([
      getDocs(collection(db, 'users', uid, 'copies')),
      getDocs(collection(db, 'users', uid, 'collection')),
      getDocs(collection(db, 'users', uid, 'packHistory')),
      getDocs(collection(db, 'users', uid, 'claims')),
      getDocs(query(collection(db, 'listings'), where('seller', '==', uid))),
      getDocs(collection(db, 'users', uid, 'teams')),
      getDocs(collection(db, 'users', uid, 'decks')),
    ]);
    const returned = {};
    copies.forEach(d => {
      const key = d.data()?.cardKey;
      if (key) returned[key] = (returned[key] ?? 0) - 1;
    });
    const refs = [...copies.docs, ...coll.docs, ...hist.docs, ...claims.docs, ...listings.docs, ...teams.docs, ...decks.docs].map(d => d.ref);
    for (let i = 0; i < refs.length; i += 400) {
      const batch = writeBatch(db);
      for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
      await batch.commit();
    }
    const last = writeBatch(db);
    if (Object.keys(returned).length) {
      last.set(
        doc(db, 'supply', 'current'),
        { counts: Object.fromEntries(Object.entries(returned).map(([k, n]) => [k, increment(n)])) },
        { merge: true }
      );
    }
    last.set(doc(db, 'users', uid), {
      currency: 0,
      starterPackOpened: false,
      dailyMilestoneCoins: 0,
      dailyMilestoneDate: '',
      dailyFirstWin: false,
      packWindow: deleteField(),
      gameWindow: deleteField(),
      settings: { pendingReveals: [] },
    }, { merge: true });
    await last.commit();
    return {
      copies: copies.size, cards: coll.size, claims: claims.size, listings: listings.size,
      teams: teams.size, decks: decks.size,
    };
  },
};

/** Both tables, for the test that checks they agree on what they offer. */
export const ROUTES = { server, direct };

const impl = USE_CLOUD_FUNCTIONS ? server : direct;

/** Open a pack. Returns `{ cards, spent }`; the cards are already the player's. */
export const openPack = (uid, packType, options, supply) => impl.openPack(uid, packType, options, supply);
export const buyListing = (uid, listingId) => impl.buyListing(uid, listingId);
export const claimGoal = (uid, goalId) => impl.claimGoal(uid, goalId);
export const listCard = (uid, cardKey, price) => impl.listCard(uid, cardKey, price);
export const delistCard = (uid, listingId) => impl.delistCard(uid, listingId);
export const burnCard = (uid, cardKey) => impl.burnCard(uid, cardKey);
/** Settle a finished game. `claim` is `{ won, pvp, milestoneIds, bam }`. */
export const claimGameReward = (uid, claim) => impl.claimGameReward(uid, claim);
/** Pay a finished season's title money, once. Returns `{ coins, label }`. */
export const claimSeasonReward = (uid, seasonId) => impl.claimSeasonReward(uid, seasonId);
/** Name a favourite team, once and for good. `team` is league-qualified: "nba:MIL". */
export const setFavoriteTeam = (uid, team) => impl.setFavoriteTeam(uid, team);
/** Put one owned copy into the collection. Returns `{ cardKey, copyId }`. */
export const collectCard = (uid, cardKey) => impl.collectCard(uid, cardKey);
/** DEV ONLY. Wipes the caller's collection, ledger and wallet. */
export const devResetAccount = uid => impl.devResetAccount(uid);
export const collectAllCards = uid => impl.collectAllCards(uid);
export const createLeague = (uid, payload) => impl.createLeague(uid, payload);
export const joinLeague = (uid, payload) => impl.joinLeague(uid, payload);
export const leaveLeague = (uid, leagueId) => impl.leaveLeague(uid, leagueId);
export const cancelLeague = (uid, leagueId) => impl.cancelLeague(uid, leagueId);
export const startLeague = (uid, payload) => impl.startLeague(uid, payload);
export const attachLeagueRoom = (uid, payload) => impl.attachLeagueRoom(uid, payload);
export const reportLeagueResult = (uid, payload) => impl.reportLeagueResult(uid, payload);
export const forfeitLeagueFixture = (uid, payload) => impl.forfeitLeagueFixture(uid, payload);
/** Server only — there is no honest direct route to coins. */
export const devGrantCoins = (uid, amount) => impl.devGrantCoins(uid, amount);
