// WHERE A CLIMB LIVES BETWEEN SITTINGS: users/{uid}/runs/{runId}, the
// player's own document (firestore.rules), one active run at a time.
//
// The run is the domain object from src/game/modes/run.js, less its map:
// Firestore refuses an array of arrays, which is what an act's floors are, and
// the map is the seed's anyway (climbMap.js generateMap), so it is rebuilt on
// the way in. NOTHING HERE PAYS: the pot is the server's ledger
// (users/{uid}/runLedger, climbBank in functions/index.js).
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { db } from './config.js';
import { generateMap } from '../game/modes/climbMap.js';

/** Still yours to play or bank: not lost, and its pot not yet banked. */
export const isActiveRun = run => Boolean(run) && run.status !== 'lost' && !run.banked;

/** The run as stored: no map, no undefined, and the `active` flag the list queries. */
export function packRun(run) {
  const { map, ...rest } = run;
  return JSON.parse(JSON.stringify({ ...rest, active: isActiveRun(run) }));
}

/** A stored run with its map rebuilt from its seed. */
export function unpackRun(stored) {
  if (!stored) return null;
  const { active, ...run } = stored;
  return { ...run, map: generateMap(run.seed) };
}

export async function saveRun(uid, run) {
  await setDoc(doc(db, 'users', uid, 'runs', run.id), packRun(run));
  return run;
}

export async function loadRun(uid, runId) {
  const snap = await getDoc(doc(db, 'users', uid, 'runs', runId));
  return snap.exists() ? unpackRun(snap.data()) : null;
}

/** The newest run still in play, or null. */
export async function loadActiveRun(uid) {
  const snap = await getDocs(query(collection(db, 'users', uid, 'runs'), where('active', '==', true)));
  const runs = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return unpackRun(runs[0] ?? null);
}
