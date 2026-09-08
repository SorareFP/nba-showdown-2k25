// THE ROAMING COPY of the game in progress: users/{uid}/games/current.
//
// Two calls and a delete; every decision about what goes in and which copy
// wins is in src/game/gameSave.js. Rules: the player's own subtree, read and
// write by isSelf, like teams, decks and seasons — a game mints nothing (the
// payout is claimed separately by claimGameReward, which rolls its own dice
// on the client anyway).
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
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

export async function clearRemoteGame(uid) {
  if (!uid) return;
  await deleteDoc(ref(uid));
}
