// THE ROAMING COPY of the game in progress: users/{uid}/games/current.
//
// Two calls and a delete; every decision about what goes in and which copy
// wins is in src/game/gameSave.js. Rules: the player's own subtree, read and
// write by isSelf, like teams, decks and seasons — a game mints nothing (the
// payout is claimed separately by claimGameReward, which rolls its own dice
// on the client anyway).
import { doc, getDoc, setDoc, deleteDoc, runTransaction } from 'firebase/firestore';
import { db } from './config.js';
import { forFirestore } from '../game/gameSave.js';

export const CURRENT_GAME_DOC = 'current';

const ref = uid => doc(db, 'users', uid, 'games', CURRENT_GAME_DOC);

/** The save on the account, or null. */
export async function loadRemoteGame(uid) {
  if (!uid) return null;
  const snap = await getDoc(ref(uid));
  const data = snap.exists() ? snap.data() : null;
  return data && data.game ? data : null;
}

/** Writes the save; false when it could not be shaped for Firestore. */
export async function saveRemoteGame(uid, save) {
  if (!uid) return false;
  const body = forFirestore(save);
  if (!body) return false;
  await setDoc(ref(uid), body);
  return true;
}

/**
 * THE GUARDED WRITE. Writes `save`, or deletes the copy for null, ONLY if the
 * account's copy is no newer than `baseAt`: the stamp of the last copy this
 * device wrote or took. A newer one was written by another device since — the
 * desktop tab left open while the game went on on the phone — and landing on
 * top of it would throw that progress away. So the write is refused and the
 * account's copy handed back.
 *
 * Resolves `{ ok: true }`, `{ ok: false, newer }` when refused, or
 * `{ ok: false }` when the save cannot be shaped for Firestore.
 */
export async function saveRemoteGameIfCurrent(uid, save, baseAt = 0) {
  if (!uid) return { ok: false };
  const body = save ? forFirestore(save) : null;
  if (save && !body) return { ok: false };
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref(uid));
    const cur = snap.exists() ? snap.data() : null;
    if (cur?.game && (cur.at || 0) > (baseAt || 0)) return { ok: false, newer: cur };
    if (body) tx.set(ref(uid), body);
    else if (snap.exists()) tx.delete(ref(uid));
    return { ok: true };
  });
}

export async function clearRemoteGame(uid) {
  if (!uid) return;
  await deleteDoc(ref(uid));
}
