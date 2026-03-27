import { collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { db } from './config.js';

const MAX_PER_CARD = 8;
const MAX_TOTAL = 50;

function decksRef(uid) {
  return collection(db, 'users', uid, 'decks');
}

export function validateDeck(cards) {
  let total = 0;
  for (const [cardId, count] of Object.entries(cards)) {
    if (count < 0 || count > MAX_PER_CARD) {
      return { ok: false, msg: `${cardId}: max ${MAX_PER_CARD} copies` };
    }
    total += count;
  }
  if (total > MAX_TOTAL) {
    return { ok: false, msg: `Deck has ${total} cards (max ${MAX_TOTAL})` };
  }
  return { ok: true, total };
}

export async function saveDeck(uid, { name, cards }) {
  const { ok, msg, total } = validateDeck(cards);
  if (!ok) throw new Error(msg);
  return addDoc(decksRef(uid), {
    name,
    cards,
    totalCards: total,
    maxPerCard: MAX_PER_CARD,
    linkedTeamId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateDeck(uid, deckId, { name, cards }) {
  const { ok, msg, total } = validateDeck(cards);
  if (!ok) throw new Error(msg);
  const ref = doc(db, 'users', uid, 'decks', deckId);
  return updateDoc(ref, {
    name,
    cards,
    totalCards: total,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteDeck(uid, deckId) {
  return deleteDoc(doc(db, 'users', uid, 'decks', deckId));
}

export async function loadDecks(uid) {
  const q = query(decksRef(uid), orderBy('updatedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
