// WHERE A SEASON LIVES BETWEEN SITTINGS.
//
// A season is a schedule you come back to, so it has to survive a reload. Two
// stores, one shape:
//
//   signed in    users/{uid}/seasons/{seasonId} — follows you between devices
//   signed out   localStorage — so the mode is playable before anyone signs
//                up, which is how most people will meet it
//
// The season document is the domain object from src/game/modes/season.js and
// nothing else, EXCEPT that rosters are stored as card keys rather than card
// objects. A season holds up to twelve teams of ten cards; writing the whole
// card into Firestore would be a 120-card document that goes stale the moment
// a set is regenerated, and the keys are the only part that is really the
// season's. `hydrate` puts the cards back on the way in.
//
// NOTHING HERE PAYS ANYTHING. The season document is client-written, so it is
// worth exactly what the client says it is worth — which is why the title
// money is claimed through claimSeasonReward and recorded in `claims`, the
// server-only collection the goals already use. See functions/index.js.
import { doc, setDoc, getDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { db } from './config.js';
import { packSeason, unpackSeason } from '../game/modes/seasonPack.js';

const LOCAL_KEY = 'showdown.seasons';

// The packing itself is shared with the Cloud Functions (modes/seasonPack.js):
// a dynasty with friends stores its live season the same way.
/** A season with its rosters flattened to keys — what actually gets stored. */
export const dehydrate = packSeason;

/** A stored season with its cards restored; a card that no longer exists is dropped. */
export const hydrate = unpackSeason;

function readLocal() {
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocal(all) {
  try {
    globalThis.localStorage?.setItem(LOCAL_KEY, JSON.stringify(all));
  } catch {
    /* a season that cannot be saved is still playable in this sitting */
  }
}

/** Save a season. `uid` null means the signed-out player's local store. */
export async function saveSeason(uid, season) {
  const body = dehydrate(season);
  if (!uid) {
    const all = readLocal();
    all[season.id] = body;
    writeLocal(all);
    return season;
  }
  await setDoc(doc(db, 'users', uid, 'seasons', season.id), body);
  return season;
}

/** Load one season, cards restored. */
export async function loadSeason(uid, seasonId) {
  if (!uid) return hydrate(readLocal()[seasonId] ?? null);
  const snap = await getDoc(doc(db, 'users', uid, 'seasons', seasonId));
  return snap.exists() ? hydrate(snap.data()) : null;
}

/** Every season this player has going, newest first. */
export async function listSeasons(uid) {
  const raw = uid
    ? (await getDocs(collection(db, 'users', uid, 'seasons'))).docs.map(d => d.data())
    : Object.values(readLocal());
  return raw.map(hydrate).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Abandon a season. */
export async function deleteSeason(uid, seasonId) {
  if (!uid) {
    const all = readLocal();
    delete all[seasonId];
    writeLocal(all);
    return;
  }
  await deleteDoc(doc(db, 'users', uid, 'seasons', seasonId));
}
