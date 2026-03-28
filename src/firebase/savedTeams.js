import { collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { db } from './config.js';

function teamsRef(uid) {
  return collection(db, 'users', uid, 'teams');
}

export async function saveTeam(uid, { name, players, salary, linkedDeckId = null }) {
  return addDoc(teamsRef(uid), {
    name,
    players,
    salary,
    linkedDeckId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateTeam(uid, teamId, data) {
  const ref = doc(db, 'users', uid, 'teams', teamId);
  return updateDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTeam(uid, teamId) {
  return deleteDoc(doc(db, 'users', uid, 'teams', teamId));
}

export async function loadTeams(uid) {
  const q = query(teamsRef(uid), orderBy('updatedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
