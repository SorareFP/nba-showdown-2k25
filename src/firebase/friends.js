// FRIENDS (2026-10-11) — the server calls, and the one thing the client
// writes itself: its own needs, on its own profile (firestore.rules lets the
// owner write only `needs` and `needsAt`, and read only their own).
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { app, db } from './config.js';

export const NOT_ON_MESSAGE = 'Friends is not switched on yet. Try again after the next update.';

let fns = null;
const call = name => data => {
  fns ??= getFunctions(app, 'us-central1');
  return httpsCallable(fns, name)(data).then(r => r.data, e => {
    // A callable the live server does not have yet answers a bare "internal".
    if (e?.code === 'functions/internal' && /^internal$/i.test(e.message ?? '')) throw new Error(NOT_ON_MESSAGE);
    throw e;
  });
};

/** `{ code, friends, incoming, outgoing, playedWith }`. */
export const myFriends = call('myFriends');
/** `{ code }` or `{ uid }` → `{ sent }` | `{ friends }`. */
export const requestFriend = call('requestFriend');
/** `{ id, accept }`. */
export const answerFriendRequest = call('answerFriendRequest');
/** `{ uid }`. */
export const removeFriend = call('removeFriend');

const profileRef = uid => doc(db, 'profiles', uid);

/** What this account last published, or null if it never has. */
export async function loadPublishedNeeds(uid) {
  const s = await getDoc(profileRef(uid));
  return s.exists() ? (s.data()?.needs ?? []) : null;
}

export function publishNeeds(uid, needs) {
  return setDoc(profileRef(uid), { needs, needsAt: serverTimestamp() });
}
