// WHERE A DYNASTY LIVES BETWEEN SITTINGS — the same two stores as a season
// (see seasons.js): users/{uid}/dynasties/{id} signed in, localStorage signed
// out.
//
// A dynasty is already all card KEYS (contracts, rights, classes, the pool);
// the one part holding card objects is the live season, which is flattened
// the way seasons.js flattens a season. Firestore refuses `undefined` and
// arrays inside arrays; the domain object has neither by design, and the JSON
// round-trip below strips any stray `undefined` a screen might add.
//
// NOTHING HERE PAYS ANYTHING. Coins go through claimDynastyReward, which
// reads this document and records its receipt in `claims` — the same trust
// model as a season.
import { doc, setDoc, getDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { db } from './config.js';
import { dehydrate as dehydrateSeason, hydrate as hydrateSeason } from './seasons.js';

const LOCAL_KEY = 'showdown.dynasties';

/** What actually gets stored: the live season's rosters as keys, and no `undefined`. */
export function dehydrateDynasty(d) {
  return JSON.parse(JSON.stringify({ ...d, season: d.season ? dehydrateSeason(d.season) : null }));
}

/** A stored dynasty with its live season's cards restored. */
export function hydrateDynasty(stored) {
  if (!stored) return null;
  return { ...stored, season: stored.season ? hydrateSeason(stored.season) : null };
}

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
    /* a dynasty that cannot be saved is still playable in this sitting */
  }
}

export async function saveDynasty(uid, dynasty) {
  const body = dehydrateDynasty(dynasty);
  if (!uid) {
    const all = readLocal();
    all[dynasty.id] = body;
    writeLocal(all);
    return dynasty;
  }
  await setDoc(doc(db, 'users', uid, 'dynasties', dynasty.id), body);
  return dynasty;
}

export async function loadDynasty(uid, id) {
  if (!uid) return hydrateDynasty(readLocal()[id] ?? null);
  const snap = await getDoc(doc(db, 'users', uid, 'dynasties', id));
  return snap.exists() ? hydrateDynasty(snap.data()) : null;
}

/** Every dynasty this player has, newest first. */
export async function listDynasties(uid) {
  const raw = uid
    ? (await getDocs(collection(db, 'users', uid, 'dynasties'))).docs.map(d => d.data())
    : Object.values(readLocal());
  return raw.map(hydrateDynasty).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function deleteDynasty(uid, id) {
  if (!uid) {
    const all = readLocal();
    delete all[id];
    writeLocal(all);
    return;
  }
  await deleteDoc(doc(db, 'users', uid, 'dynasties', id));
}
