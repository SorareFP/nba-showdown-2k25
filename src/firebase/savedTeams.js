import { collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { db } from './config.js';

function teamsRef(uid) {
  return collection(db, 'users', uid, 'teams');
}

export async function saveTeam(uid, { name, players, salary }) {
  return addDoc(teamsRef(uid), {
    name,
    players,
    salary,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateTeam(uid, teamId, { name, players, salary }) {
  const ref = doc(db, 'users', uid, 'teams', teamId);
  return updateDoc(ref, {
    name,
    players,
    salary,
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
