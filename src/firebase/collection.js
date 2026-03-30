// src/firebase/collection.js — Collection CRUD with batch writes
import { db } from './config.js';
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

// Load entire collection
export async function loadCollection(uid) {
  const snap = await getDocs(collRef(uid));
  const items = {};
  snap.forEach(d => { items[d.id] = d.data(); });
  return items; // { [cardId]: { type, count, acquiredAt } }
}

// Add cards to collection (from pack opening)
// cards: [{ id, type: 'player'|'strat' }]
export async function addCardsToCollection(uid, cards, packType, cost) {
  const batch = writeBatch(db);

  // Group by cardId and count
  const counts = {};
  cards.forEach(c => {
    if (!counts[c.id]) counts[c.id] = { type: c.type, add: 0 };
    counts[c.id].add++;
  });

  // Upsert each card
  for (const [cardId, info] of Object.entries(counts)) {
    const ref = doc(db, 'users', uid, 'collection', cardId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      batch.update(ref, { count: increment(info.add) });
    } else {
      batch.set(ref, { type: info.type, count: info.add, acquiredAt: serverTimestamp() });
    }
  }

  // Deduct currency
  if (cost > 0) {
    const userRef = doc(db, 'users', uid);
    batch.update(userRef, { currency: increment(-cost) });
  }

  // Add pack history
  const historyRef = doc(histRef(uid));
  batch.set(historyRef, {
    packType,
    cards: cards.map(c => c.id),
    cost,
    openedAt: serverTimestamp(),
  });

  await batch.commit();
}

// Burn a card for coins
export async function burnCard(uid, cardId, burnValue) {
  const ref = doc(db, 'users', uid, 'collection', cardId);
  const snap = await getDoc(ref);
  if (!snap.exists() || snap.data().count < 1) throw new Error('Card not owned');

  const batch = writeBatch(db);
  const newCount = snap.data().count - 1;
  if (newCount <= 0) {
    batch.delete(ref);
  } else {
    batch.update(ref, { count: increment(-1) });
  }
  // Add coins
  const userRef = doc(db, 'users', uid);
  batch.update(userRef, { currency: increment(burnValue) });
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
