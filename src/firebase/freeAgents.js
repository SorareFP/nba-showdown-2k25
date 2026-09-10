// FREE AGENTS on the account: the three callables and the player's own
// requests. The rules and the price are in src/game/freeAgents.js; the server
// side is at the end of functions/index.js.
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { app, db } from './config.js';

let fns = null;
const call = name => data => {
  fns ??= getFunctions(app, 'us-central1');
  return httpsCallable(fns, name)(data).then(r => r.data, e => {
    // A callable the live server does not have yet answers with a bare
    // "internal" (Firebase gets a 404 page back, not JSON), which is what the
    // Studio showed before the accept flow was deployed. Say what it means.
    if (e?.code === 'functions/internal' && /^internal$/i.test(e.message ?? '')) {
      throw new Error(`The server could not run ${name}. If it is new, deploy the functions first.`);
    }
    throw e;
  });
};

/** `{ bbrefId, season, playoffs }` → `{ id, quote }`, or throws with the server's reason. */
export const requestCard = call('requestCard');
/** Admins: the queue, one status at a time (default: waiting). */
export const listCardRequests = call('listCardRequests');
/** Admins: `{ id, reason }`. */
export const rejectCardRequest = call('rejectCardRequest');
/** Admins: `{ id, cardKey, built }` once the Studio has built the card. */
export const markCardRequestBuilt = call('markCardRequestBuilt');
/** Admins: `{ id }` — invoice at the finished card's price (needs the card deployed). */
export const invoiceCardRequest = call('invoiceCardRequest');
/** Admins: `{ id }` — one locked copy, free. */
export const giftCardRequest = call('giftCardRequest');
/** Requester: `{ id }` — pay the invoice, get the card. */
export const signFreeAgent = call('signFreeAgent');
/** Requester: `{ id }` — say no to the invoice. */
export const declineCardRequest = call('declineCardRequest');

/** This player's requests, newest first. Readable by their owner only (firestore.rules). */
export async function myCardRequests(uid) {
  if (!uid) return [];
  const snap = await getDocs(query(collection(db, 'cardRequests'), where('uid', '==', uid)));
  return snap.docs
    .map(d => {
      const r = d.data();
      return { ...r, id: d.id, createdAt: r.createdAt?.toMillis?.() ?? 0 };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}
