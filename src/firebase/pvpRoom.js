import { rtdb } from './config.js';
import { ref, set, get, update, onValue, off } from 'firebase/database';
import { fixFromFirebase, prepareForFirebase } from './pvpGame.js';

// ---------- helpers ----------

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1

function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

// ---------- room lifecycle ----------

export async function createRoom(uid, displayName) {
  let code;
  let exists = true;

  // generate unique code (collision check)
  while (exists) {
    code = generateCode();
    const snap = await get(ref(rtdb, `rooms/${code}/meta`));
    exists = snap.exists();
  }

  const meta = {
    code,
    hostUid: uid,
    guestUid: null,
    hostName: displayName || 'Player 1',
    guestName: null,
    hostReady: false,
    guestReady: false,
    status: 'waiting',
    createdAt: Date.now(),
    lastActionAt: Date.now(),
    lastActionBy: 'host',
    forfeitClockStartedAt: null,
    forfeitClockStartedBy: null,
    winner: null,
  };

  await set(ref(rtdb, `rooms/${code}/meta`), meta);

  // userGames index
  await set(ref(rtdb, `userGames/${uid}/${code}`), {
    role: 'host',
    createdAt: Date.now(),
  });

  return code;
}

export async function joinRoom(code, uid, displayName) {
  const metaRef = ref(rtdb, `rooms/${code}/meta`);
  const snap = await get(metaRef);

  if (!snap.exists()) throw new Error('Room not found.');

  const meta = snap.val();

  // Allow self-join on localhost for testing; block in production
  if (meta.hostUid === uid && window.location.hostname !== 'localhost') {
    throw new Error('You cannot join your own room.');
  }
  if (meta.guestUid) throw new Error('Room is already full.');
  if (meta.status !== 'waiting') throw new Error('Room is no longer accepting players.');

  await update(metaRef, {
    guestUid: uid,
    guestName: displayName || 'Player 2',
    status: 'team_select',
    lastActionAt: Date.now(),
    lastActionBy: 'guest',
  });

  // userGames index (use role-suffixed key when self-joining to avoid overwrite)
  const indexKey = meta.hostUid === uid ? `${code}_guest` : code;
  await set(ref(rtdb, `userGames/${uid}/${indexKey}`), {
    role: 'guest',
    createdAt: Date.now(),
  });
}

// ---------- team selection ----------

export async function setTeamSelection(code, role, roster, deckConfig, teamName) {
  const teamPath = role === 'host' ? 'hostTeam' : 'guestTeam';

  await set(ref(rtdb, `rooms/${code}/${teamPath}`), prepareForFirebase({
    roster,
    deckConfig,
    teamName,
  }));

  await update(ref(rtdb, `rooms/${code}/meta`), {
    [`${role}Ready`]: true,
    lastActionAt: Date.now(),
    lastActionBy: role,
  });
}

// ---------- listeners ----------

export function onRoomMeta(code, callback) {
  const metaRef = ref(rtdb, `rooms/${code}/meta`);
  onValue(metaRef, (snap) => callback(snap.val()));
  return () => off(metaRef);
}

export function onGameState(code, callback) {
  const gameRef = ref(rtdb, `rooms/${code}/game`);
  onValue(gameRef, (snap) => {
    const val = snap.val();
    callback(val ? fixFromFirebase(val) : val);
  });
  return () => off(gameRef);
}

export function onPrivateData(code, role, callback) {
  const privRef = ref(rtdb, `rooms/${code}/private/${role}`);
  onValue(privRef, (snap) => {
    const val = snap.val();
    callback(val ? fixFromFirebase(val) : val);
  });
  return () => off(privRef);
}

// ---------- game state writes ----------

export async function writeGameState(code, gameState) {
  await set(ref(rtdb, `rooms/${code}/game`), prepareForFirebase(gameState));
  await update(ref(rtdb, `rooms/${code}/meta`), {
    lastActionAt: Date.now(),
  });
}

export async function writePrivateData(code, role, data) {
  await set(ref(rtdb, `rooms/${code}/private/${role}`), prepareForFirebase(data));
}

export async function startGame(code, gameState, hostPrivate, guestPrivate) {
  await set(ref(rtdb, `rooms/${code}/game`), prepareForFirebase(gameState));
  await set(ref(rtdb, `rooms/${code}/private/host`), prepareForFirebase(hostPrivate));
  await set(ref(rtdb, `rooms/${code}/private/guest`), prepareForFirebase(guestPrivate));
  await update(ref(rtdb, `rooms/${code}/meta`), {
    status: 'active',
    lastActionAt: Date.now(),
    lastActionBy: 'system',
  });
}

// ---------- end-game ----------

export async function forfeitGame(code, loserRole) {
  const winner = loserRole === 'host' ? 'guest' : 'host';
  await update(ref(rtdb, `rooms/${code}/meta`), {
    status: 'forfeit',
    winner,
    lastActionAt: Date.now(),
    lastActionBy: loserRole,
  });
}

export async function abandonGame(code) {
  await update(ref(rtdb, `rooms/${code}/meta`), {
    status: 'abandoned',
    lastActionAt: Date.now(),
  });
}

// ---------- forfeit clock ----------

export async function startForfeitClock(code, startedByRole) {
  await update(ref(rtdb, `rooms/${code}/meta`), {
    forfeitClockStartedAt: Date.now(),
    forfeitClockStartedBy: startedByRole,
    lastActionAt: Date.now(),
    lastActionBy: startedByRole,
  });
}

export async function claimForfeitWin(code, claimingRole) {
  const snap = await get(ref(rtdb, `rooms/${code}/meta`));
  if (!snap.exists()) throw new Error('Room not found.');

  const meta = snap.val();

  if (!meta.forfeitClockStartedAt) {
    throw new Error('No forfeit clock is running.');
  }

  const elapsed = Date.now() - meta.forfeitClockStartedAt;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  if (elapsed < TWENTY_FOUR_HOURS) {
    throw new Error('Forfeit clock has not reached 24 hours yet.');
  }

  await update(ref(rtdb, `rooms/${code}/meta`), {
    status: 'forfeit',
    winner: claimingRole,
    lastActionAt: Date.now(),
    lastActionBy: claimingRole,
  });
}

// ---------- my games ----------

export async function loadMyGames(uid) {
  const snap = await get(ref(rtdb, `userGames/${uid}`));
  if (!snap.exists()) return [];

  const entries = snap.val(); // { [code]: { role, createdAt } }
  const results = [];

  const keys = Object.keys(entries);
  // Keys may have _guest suffix for self-join; extract real room code
  const codeFromKey = (k) => k.endsWith('_guest') ? k.slice(0, -6) : k;
  const metaPromises = keys.map((k) => get(ref(rtdb, `rooms/${codeFromKey(k)}/meta`)));
  const metaSnaps = await Promise.all(metaPromises);

  for (let i = 0; i < keys.length; i++) {
    const metaSnap = metaSnaps[i];
    if (!metaSnap.exists()) continue; // room deleted
    results.push({
      code: codeFromKey(keys[i]),
      role: entries[keys[i]].role,
      meta: metaSnap.val(),
    });
  }

  return results;
}

export async function removeFromMyGames(uid, code, role = null) {
  // Check both the plain key and _guest suffixed key
  const key = role === 'guest' ? `${code}_guest` : code;
  await set(ref(rtdb, `userGames/${uid}/${key}`), null);
  // Also try the other key in case of self-join cleanup
  const altKey = role === 'guest' ? code : `${code}_guest`;
  const snap = await get(ref(rtdb, `userGames/${uid}/${altKey}`));
  if (snap.exists()) await set(ref(rtdb, `userGames/${uid}/${altKey}`), null);
}
