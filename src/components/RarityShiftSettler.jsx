// SETTLES THE RARITY CHANGE ONCE PER ACCOUNT, on sign-in (2026-09-30).
//
// No screen of its own: it calls settleRarityShift the first time a signed-in
// account loads the app after a card change moved rarities, and says what it
// paid in a toast. The server holds the receipt, so a second call is harmless;
// the local note only saves the call on later visits. An account created after
// the change cannot hold a copy from before it and is never called for.
// src/game/rarityShift.js has the rule.
import { useEffect } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { useDialogs } from '../ui/dialogs.jsx';
import { settleRarityShift } from '../firebase/serverWrites.js';
import { RARITY_SHIFT, mayBeOwed, settlementMessage } from '../game/rarityShift.js';

const noteKey = uid => `showdown.rarityShift:${uid}`;
function readNote(uid) {
  try { return localStorage.getItem(noteKey(uid)); } catch { return null; }
}
function writeNote(uid, id) {
  try { localStorage.setItem(noteKey(uid), id); } catch { /* storage blocked: the server's receipt still holds */ }
}

// One call per account per page load, however many times the effect runs
// (StrictMode mounts twice in development).
const inFlight = new Set();

export default function RarityShiftSettler() {
  const { user } = useAuth();
  const { toast } = useDialogs();
  const uid = user?.uid;
  const created = user?.metadata?.creationTime;

  useEffect(() => {
    const id = RARITY_SHIFT?.id;
    if (!uid || !id || readNote(uid) === id || inFlight.has(uid)) return;
    if (!mayBeOwed(created)) { writeNote(uid, id); return; }
    inFlight.add(uid);
    settleRarityShift(uid)
      .then(res => {
        writeNote(uid, id);
        if (res?.already) return;
        const text = settlementMessage(res);
        if (text) toast(text, { tone: res.coins > 0 ? 'success' : 'info' });
      })
      // Offline, or the function not deployed yet: the next load tries again.
      .catch(() => {})
      .finally(() => inFlight.delete(uid));
  }, [uid, created, toast]);

  return null;
}
