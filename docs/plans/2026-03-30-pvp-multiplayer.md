# PvP Multiplayer (Room Codes) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable two authenticated players to play NBA Showdown 2K25 against each other in real-time using room codes, with owned-cards-only teams, hidden information, and full game lifecycle (forfeit/abandon/inactivity).

**Architecture:** Firebase Realtime Database stores live game state. When it's your turn, your client applies the action locally using the existing pure game engine, then writes the updated state to RTDB. The opponent's client listens via `onValue` and re-renders. Hidden info (hands, roster pools) is stored in player-private nodes with security rules. Room codes are short alphanumeric strings generated at room creation.

**Tech Stack:** Firebase Realtime Database (new), Firebase Auth (existing), React, existing game engine (engine.js, execCard.js, canPlay.js)

---

## Data Model

```
rtdb/
  rooms/{code}/
    meta/
      code: "KOBE24"
      hostUid: "abc123"
      guestUid: "def456" | null
      hostName: "hoopsonhoops"
      guestName: "friend99"
      hostReady: false
      guestReady: false
      status: "waiting" | "team_select" | "active" | "done" | "forfeit" | "abandoned"
      createdAt: timestamp
      lastActionAt: timestamp
      lastActionBy: "host" | "guest"
      forfeitClockStartedAt: null | timestamp
      forfeitClockStartedBy: null | "host" | "guest"
      winner: null | "host" | "guest"

    hostTeam/
      roster: [...playerIds]
      deckConfig: {...}
      teamName: "My Squad"

    guestTeam/
      roster: [...playerIds]
      deckConfig: {...}
      teamName: "Opponent Squad"

    game/
      # Full game state from engine.js newGame() output
      # EXCEPT hands and draft pools (those go in private nodes)
      quarter, section, phase, draft, offMatchups, ...
      teamA: { name, roster, starters, score, assists, rebounds, stats, deck: [count only], discard: [count only] }
      teamB: { same structure }
      rollResults, tempEff, tempDefEff, log, done, ...

      # PvP-specific fields
      hostIs: "A" | "B"  # randomly assigned at game start
      whoseTurn: "host" | "guest" | "both" | null

    private/
      {hostUid}/
        hand: [...cardIds]
        draftPool: [...playerObjects]  # remaining roster not yet drafted
      {guestUid}/
        hand: [...cardIds]
        draftPool: [...playerObjects]
```

## Turn Ownership Logic

| Phase | Current Turn | whoseTurn |
|-------|-------------|-----------|
| Draft | draft.step determines A/B via snake order | Map A/B to host/guest via hostIs |
| Matchup Strats | matchupTurn (A or B) | Map to host/guest |
| Matchup Reaction | opponent of matchupTurn | Map to host/guest |
| Scoring (strategy) | scoringTurn (A or B) | Map to host/guest |
| Scoring (rolling open) | both teams rolling | "both" |
| Scoring (reaction window) | opponent of acting team | Map to host/guest |
| Pending shot check | opponent may Close Out | Map to host/guest |
| Section end | automatic | whichever player triggers it |

---

### Task 1: Firebase Realtime Database Setup

**Files:**
- Modify: `src/firebase/config.js`
- Create: `database.rules.json` (for reference/deploy)

**Step 1: Add RTDB to Firebase config**

In `src/firebase/config.js`, add:
```javascript
import { getDatabase } from 'firebase/database';
// ... after existing initializeApp
export const rtdb = getDatabase(app);
```

**Step 2: Create security rules reference file**

Create `database.rules.json`:
```json
{
  "rules": {
    "rooms": {
      "$roomCode": {
        "meta": {
          ".read": "auth != null",
          ".write": "auth != null && (
            !data.exists() ||
            data.child('hostUid').val() === auth.uid ||
            data.child('guestUid').val() === auth.uid ||
            (!data.child('guestUid').exists() && newData.child('guestUid').val() === auth.uid)
          )"
        },
        "hostTeam": {
          ".read": "auth != null && (data.parent().child('meta/hostUid').val() === auth.uid || data.parent().child('meta/guestUid').val() === auth.uid)",
          ".write": "auth != null && data.parent().child('meta/hostUid').val() === auth.uid"
        },
        "guestTeam": {
          ".read": "auth != null && (data.parent().child('meta/hostUid').val() === auth.uid || data.parent().child('meta/guestUid').val() === auth.uid)",
          ".write": "auth != null && data.parent().child('meta/guestUid').val() === auth.uid"
        },
        "game": {
          ".read": "auth != null && (data.parent().child('meta/hostUid').val() === auth.uid || data.parent().child('meta/guestUid').val() === auth.uid)",
          ".write": "auth != null && (data.parent().child('meta/hostUid').val() === auth.uid || data.parent().child('meta/guestUid').val() === auth.uid)"
        },
        "private": {
          "$uid": {
            ".read": "auth != null && auth.uid === $uid",
            ".write": "auth != null && auth.uid === $uid"
          }
        }
      }
    },
    "userGames": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

**Step 3: Commit**

```bash
git add src/firebase/config.js database.rules.json
git commit -m "feat: add Firebase Realtime Database for PvP multiplayer"
```

---

### Task 2: Room Management Service Layer

**Files:**
- Create: `src/firebase/pvpRoom.js`

**Step 1: Implement room service**

```javascript
// src/firebase/pvpRoom.js
import { rtdb } from './config.js';
import { ref, set, get, update, onValue, off, push, serverTimestamp } from 'firebase/database';

// Generate 6-char alphanumeric room code
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 for clarity
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Create a new room — returns the room code
export async function createRoom(uid, displayName) {
  let code, exists = true;
  while (exists) {
    code = generateCode();
    const snap = await get(ref(rtdb, `rooms/${code}/meta`));
    exists = snap.exists();
  }

  await set(ref(rtdb, `rooms/${code}/meta`), {
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
  });

  // Index for user's active games
  await set(ref(rtdb, `userGames/${uid}/${code}`), { role: 'host', createdAt: Date.now() });

  return code;
}

// Join an existing room
export async function joinRoom(code, uid, displayName) {
  const metaRef = ref(rtdb, `rooms/${code}/meta`);
  const snap = await get(metaRef);
  if (!snap.exists()) throw new Error('Room not found');

  const meta = snap.val();
  if (meta.hostUid === uid) throw new Error('You created this room');
  if (meta.guestUid && meta.guestUid !== uid) throw new Error('Room is full');
  if (meta.status !== 'waiting' && meta.guestUid !== uid) throw new Error('Game already in progress');

  await update(metaRef, {
    guestUid: uid,
    guestName: displayName || 'Player 2',
    status: 'team_select',
    lastActionAt: Date.now(),
  });

  await set(ref(rtdb, `userGames/${uid}/${code}`), { role: 'guest', createdAt: Date.now() });

  return snap.val();
}

// Set team selection for a player
export async function setTeamSelection(code, role, roster, deckConfig, teamName) {
  const path = role === 'host' ? 'hostTeam' : 'guestTeam';
  await set(ref(rtdb, `rooms/${code}/${path}`), { roster, deckConfig, teamName });
  await update(ref(rtdb, `rooms/${code}/meta`), {
    [`${role}Ready`]: true,
    lastActionAt: Date.now(),
    lastActionBy: role,
  });
}

// Listen to room meta changes
export function onRoomMeta(code, callback) {
  const metaRef = ref(rtdb, `rooms/${code}/meta`);
  onValue(metaRef, snap => callback(snap.val()));
  return () => off(metaRef);
}

// Listen to full game state changes
export function onGameState(code, callback) {
  const gameRef = ref(rtdb, `rooms/${code}/game`);
  onValue(gameRef, snap => callback(snap.val()));
  return () => off(gameRef);
}

// Listen to private data (hand + draft pool)
export function onPrivateData(code, uid, callback) {
  const privRef = ref(rtdb, `rooms/${code}/private/${uid}`);
  onValue(privRef, snap => callback(snap.val()));
  return () => off(privRef);
}

// Write updated game state after a player action
export async function writeGameState(code, gameState) {
  await set(ref(rtdb, `rooms/${code}/game`), gameState);
  await update(ref(rtdb, `rooms/${code}/meta`), { lastActionAt: Date.now() });
}

// Write private data (hand/pool) for a player
export async function writePrivateData(code, uid, data) {
  await set(ref(rtdb, `rooms/${code}/private/${uid}`), data);
}

// Start the game (called when both players are ready)
export async function startGame(code, gameState, hostUid, guestUid, hostPrivate, guestPrivate) {
  await set(ref(rtdb, `rooms/${code}/game`), gameState);
  await set(ref(rtdb, `rooms/${code}/private/${hostUid}`), hostPrivate);
  await set(ref(rtdb, `rooms/${code}/private/${guestUid}`), guestPrivate);
  await update(ref(rtdb, `rooms/${code}/meta`), { status: 'active', lastActionAt: Date.now() });
}

// Forfeit the game
export async function forfeitGame(code, loserRole) {
  const winnerRole = loserRole === 'host' ? 'guest' : 'host';
  await update(ref(rtdb, `rooms/${code}/meta`), {
    status: 'forfeit',
    winner: winnerRole,
    lastActionAt: Date.now(),
  });
}

// Abandon the game (no winner)
export async function abandonGame(code) {
  await update(ref(rtdb, `rooms/${code}/meta`), {
    status: 'abandoned',
    lastActionAt: Date.now(),
  });
}

// Start 24h forfeit clock
export async function startForfeitClock(code, startedByRole) {
  await update(ref(rtdb, `rooms/${code}/meta`), {
    forfeitClockStartedAt: Date.now(),
    forfeitClockStartedBy: startedByRole,
    lastActionAt: Date.now(),
  });
}

// Claim forfeit win (after 24h clock expires)
export async function claimForfeitWin(code, claimingRole) {
  const snap = await get(ref(rtdb, `rooms/${code}/meta`));
  const meta = snap.val();
  if (!meta.forfeitClockStartedAt) throw new Error('No forfeit clock active');
  const elapsed = Date.now() - meta.forfeitClockStartedAt;
  if (elapsed < 24 * 60 * 60 * 1000) throw new Error('24 hours have not passed');

  await update(ref(rtdb, `rooms/${code}/meta`), {
    status: 'forfeit',
    winner: claimingRole,
    lastActionAt: Date.now(),
  });
}

// Load all active games for a user
export async function loadMyGames(uid) {
  const snap = await get(ref(rtdb, `userGames/${uid}`));
  if (!snap.exists()) return [];
  const entries = snap.val();
  const games = [];
  for (const [code, info] of Object.entries(entries)) {
    const metaSnap = await get(ref(rtdb, `rooms/${code}/meta`));
    if (metaSnap.exists()) {
      games.push({ code, ...info, meta: metaSnap.val() });
    }
  }
  return games;
}

// Clean up finished game from user's active list
export async function removeFromMyGames(uid, code) {
  await set(ref(rtdb, `userGames/${uid}/${code}`), null);
}
```

**Step 2: Commit**

```bash
git add src/firebase/pvpRoom.js
git commit -m "feat: add PvP room management service layer"
```

---

### Task 3: PvP Lobby UI

**Files:**
- Create: `src/components/PvpLobby.jsx`
- Create: `src/components/PvpLobby.module.css`

**Step 1: Build lobby component**

The PvP lobby has three sub-views:
1. **Landing** — "Create Room" and "Join Room" buttons, plus active games list
2. **Waiting Room** — Host sees room code, waits for guest to join
3. **Team Select** — Both players pick team + deck, ready up

```javascript
// src/components/PvpLobby.jsx
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { createRoom, joinRoom, onRoomMeta, setTeamSelection, loadMyGames } from '../firebase/pvpRoom.js';
import { loadTeams } from '../firebase/savedTeams.js';
import { loadDecks } from '../firebase/savedDecks.js';
import { loadCollection } from '../firebase/collection.js';
import styles from './PvpLobby.module.css';

export default function PvpLobby({ onGameStart }) {
  const { user } = useAuth();
  const [view, setView] = useState('landing'); // landing | waiting | team_select | joining
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [meta, setMeta] = useState(null);
  const [myGames, setMyGames] = useState([]);
  const [error, setError] = useState('');

  // Team/deck selection state
  const [savedTeams, setSavedTeams] = useState([]);
  const [savedDecks, setSavedDecks] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [selectedDeck, setSelectedDeck] = useState(null);
  const [myRole, setMyRole] = useState(null); // 'host' | 'guest'

  // Load active games on mount
  useEffect(() => {
    if (user) loadMyGames(user.uid).then(setMyGames);
  }, [user]);

  // Listen to room meta when in a room
  useEffect(() => {
    if (!roomCode) return;
    const unsub = onRoomMeta(roomCode, (m) => {
      setMeta(m);
      // Guest joined — move host to team select
      if (m?.status === 'team_select' && view === 'waiting') {
        setView('team_select');
        loadTeamData();
      }
      // Both ready — trigger game start
      if (m?.hostReady && m?.guestReady && m?.status === 'team_select') {
        onGameStart(roomCode, myRole);
      }
    });
    return unsub;
  }, [roomCode, view, myRole]);

  const loadTeamData = async () => {
    const [teams, decks] = await Promise.all([
      loadTeams(user.uid),
      loadDecks(user.uid),
    ]);
    setSavedTeams(teams);
    setSavedDecks(decks);
  };

  const handleCreate = async () => {
    setError('');
    try {
      const code = await createRoom(user.uid, user.displayName);
      setRoomCode(code);
      setMyRole('host');
      setView('waiting');
    } catch (e) { setError(e.message); }
  };

  const handleJoin = async () => {
    setError('');
    const code = joinCode.trim().toUpperCase();
    if (!code) return setError('Enter a room code');
    try {
      await joinRoom(code, user.uid, user.displayName);
      setRoomCode(code);
      setMyRole('guest');
      setView('team_select');
      loadTeamData();
    } catch (e) { setError(e.message); }
  };

  const handleReady = async () => {
    if (!selectedTeam) return setError('Select a team first');
    setError('');
    try {
      await setTeamSelection(
        roomCode, myRole,
        selectedTeam.players,
        selectedDeck?.cards || null,
        selectedTeam.name
      );
    } catch (e) { setError(e.message); }
  };

  const handleResumeGame = (code, role) => {
    setRoomCode(code);
    setMyRole(role);
    onGameStart(code, role);
  };

  // ... render landing / waiting / team_select views
  // See CSS file for styling
}
```

Key UI elements:
- **Landing**: Two big buttons (Create / Join), input for room code, active games list with Resume buttons
- **Waiting**: Big room code display with copy button, "Waiting for opponent..." spinner
- **Team Select**: Dropdown for saved teams, dropdown for saved decks, opponent status (ready/not), Ready button

**Step 2: Style the lobby**

Create `PvpLobby.module.css` with:
- Room code display (large, monospace, gold highlight)
- Copy-to-clipboard button
- Team/deck selection dropdowns
- Ready/not-ready status indicators
- Active games list with status badges

**Step 3: Commit**

```bash
git add src/components/PvpLobby.jsx src/components/PvpLobby.module.css
git commit -m "feat: add PvP lobby UI with create/join/team-select"
```

---

### Task 4: Game Initialization for PvP

**Files:**
- Create: `src/firebase/pvpGame.js`
- Modify: `src/game/engine.js` (extract hand/pool from game state)

**Step 1: Create PvP game initialization**

When both players are ready, the host's client:
1. Loads both team rosters from RTDB
2. Calls `newGame()` with both rosters and deck configs
3. Extracts private data (hands, draft pools) from the game state
4. Writes public game state to `rooms/{code}/game`
5. Writes each player's private data to `rooms/{code}/private/{uid}`
6. Randomly assigns host to Team A or B

```javascript
// src/firebase/pvpGame.js
import { rtdb } from './config.js';
import { ref, get } from 'firebase/database';
import { newGame } from '../game/engine.js';
import { startGame, writeGameState, writePrivateData } from './pvpRoom.js';

export async function initializePvpGame(code, hostUid, guestUid) {
  // Load both team selections
  const [hostSnap, guestSnap] = await Promise.all([
    get(ref(rtdb, `rooms/${code}/hostTeam`)),
    get(ref(rtdb, `rooms/${code}/guestTeam`)),
  ]);

  const hostTeam = hostSnap.val();
  const guestTeam = guestSnap.val();

  // Randomly assign host to A or B
  const hostIsA = Math.random() < 0.5;
  const rosterA = hostIsA ? hostTeam.roster : guestTeam.roster;
  const rosterB = hostIsA ? guestTeam.roster : hostTeam.roster;
  const deckA = hostIsA ? hostTeam.deckConfig : guestTeam.deckConfig;
  const deckB = hostIsA ? guestTeam.deckConfig : hostTeam.deckConfig;

  // Build full game state
  const game = newGame(rosterA, rosterB, deckA, deckB);

  // Extract private data
  const teamAUid = hostIsA ? hostUid : guestUid;
  const teamBUid = hostIsA ? guestUid : hostUid;

  const hostPrivate = {
    hand: hostIsA ? game.teamA.hand : game.teamB.hand,
    draftPool: hostIsA ? game.draft.aPool : game.draft.bPool,
  };
  const guestPrivate = {
    hand: hostIsA ? game.teamB.hand : game.teamA.hand,
    draftPool: hostIsA ? game.draft.bPool : game.draft.aPool,
  };

  // Strip private data from shared game state
  const publicGame = {
    ...game,
    hostIs: hostIsA ? 'A' : 'B',
    whoseTurn: 'host', // A always drafts first, host might be A
    teamA: { ...game.teamA, hand: [], deck: game.teamA.deck.length },
    teamB: { ...game.teamB, hand: [], deck: game.teamB.deck.length },
    draft: { ...game.draft, aPool: [], bPool: [] },
  };

  // Determine whose turn based on draft snake order
  // Step 0 = A picks. If host is A, whoseTurn = 'host', else 'guest'
  publicGame.whoseTurn = hostIsA ? 'host' : 'guest';

  await startGame(code, publicGame, hostUid, guestUid, hostPrivate, guestPrivate);
  return publicGame;
}
```

**Step 2: Create helper to determine whose turn**

```javascript
// In pvpGame.js
export function getWhoseTurn(game) {
  if (game.done) return null;
  const { phase, hostIs } = game;
  const aIsHost = hostIs === 'A';
  const map = (teamKey) => (teamKey === 'A') === aIsHost ? 'host' : 'guest';

  if (phase === 'draft') {
    // Snake draft: A,B,B,A,A,B,B,A,A,B
    const snake = ['A','B','B','A','A','B','B','A','A','B'];
    const picking = snake[game.draft.step] || 'A';
    return map(picking);
  }
  if (phase === 'matchup_strats') {
    return map(game.matchupTurn);
  }
  if (phase === 'scoring') {
    if (game.scoringPasses >= 99) return 'both'; // rolling open
    if (game.pendingShotCheck) {
      // Opponent of the team that initiated the check
      return map(game.pendingShotCheck.teamKey === 'A' ? 'B' : 'A');
    }
    return map(game.scoringTurn);
  }
  return null;
}
```

**Step 3: Commit**

```bash
git add src/firebase/pvpGame.js
git commit -m "feat: add PvP game initialization and turn logic"
```

---

### Task 5: PvP Game Wrapper Component

**Files:**
- Create: `src/components/PvpGame.jsx`
- Create: `src/components/PvpGame.module.css`

This is the core PvP component. It bridges Firebase RTDB with the existing CourtBoard/game UI.

**Step 1: Build PvP game wrapper**

Key responsibilities:
- Listen to game state from RTDB via `onGameState()`
- Listen to private data via `onPrivateData()`
- Reconstruct a "local" game object by merging public state + private data
- When it's your turn, allow actions (same handlers as PlayTab)
- After each action, write updated public state to RTDB + updated private data
- Disable all controls when it's not your turn

```javascript
// src/components/PvpGame.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { onGameState, onPrivateData, onRoomMeta, writeGameState, writePrivateData, forfeitGame, abandonGame, startForfeitClock, claimForfeitWin } from '../firebase/pvpRoom.js';
import { getWhoseTurn } from '../firebase/pvpGame.js';
import { doRoll, endSection, spendAssist, spendReboundBonus } from '../game/engine.js';
import { execCard, resolvePendingShotCheck } from '../game/execCard.js';
import CourtBoard from './game/CourtBoard.jsx';
import GameOver from './game/GameOver.jsx';
import styles from './PvpGame.module.css';

export default function PvpGame({ roomCode, myRole, onLeave }) {
  const { user } = useAuth();
  const [publicGame, setPublicGame] = useState(null);
  const [privateData, setPrivateData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);

  // Listen to all three data sources
  useEffect(() => {
    const unsub1 = onRoomMeta(roomCode, setMeta);
    const unsub2 = onGameState(roomCode, (g) => { setPublicGame(g); setLoading(false); });
    const unsub3 = onPrivateData(roomCode, user.uid, setPrivateData);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [roomCode, user.uid]);

  // Reconstruct full local game by merging public + private
  const localGame = useMemo(() => {
    if (!publicGame || !privateData) return null;
    const g = JSON.parse(JSON.stringify(publicGame));
    const myTeamKey = (myRole === 'host') === (g.hostIs === 'A') ? 'A' : 'B';
    const myTeam = myTeamKey === 'A' ? g.teamA : g.teamB;

    // Inject my hand
    myTeam.hand = privateData.hand || [];

    // Inject my draft pool
    if (g.phase === 'draft') {
      if (myTeamKey === 'A') g.draft.aPool = privateData.draftPool || [];
      else g.draft.bPool = privateData.draftPool || [];
    }

    return g;
  }, [publicGame, privateData, myRole]);

  const myTeamKey = localGame ? ((myRole === 'host') === (localGame.hostIs === 'A') ? 'A' : 'B') : null;
  const whoseTurn = publicGame ? getWhoseTurn(publicGame) : null;
  const isMyTurn = whoseTurn === myRole || whoseTurn === 'both';

  // After any action, sync state back to RTDB
  const syncToFirebase = useCallback(async (updatedGame) => {
    const g = JSON.parse(JSON.stringify(updatedGame));

    // Extract my updated private data
    const myTeam = myTeamKey === 'A' ? g.teamA : g.teamB;
    const newPrivate = {
      hand: myTeam.hand || [],
      draftPool: myTeamKey === 'A' ? (g.draft?.aPool || []) : (g.draft?.bPool || []),
    };

    // Strip private data from public state
    g.teamA.hand = [];
    g.teamB.hand = [];
    if (g.draft) { g.draft.aPool = []; g.draft.bPool = []; }
    g.teamA.deck = typeof g.teamA.deck === 'number' ? g.teamA.deck : (g.teamA.deck?.length || 0);
    g.teamB.deck = typeof g.teamB.deck === 'number' ? g.teamB.deck : (g.teamB.deck?.length || 0);

    // Update whose turn
    g.whoseTurn = getWhoseTurn(g);
    g.lastActionBy = myRole;

    await Promise.all([
      writeGameState(roomCode, g),
      writePrivateData(roomCode, user.uid, newPrivate),
    ]);
  }, [roomCode, myTeamKey, myRole, user.uid]);

  // Game action handlers (same interface as PlayTab but with RTDB sync)
  const handleRoll = useCallback(async (teamKey, idx) => {
    if (!isMyTurn || teamKey !== myTeamKey) return;
    const updated = doRoll(JSON.parse(JSON.stringify(localGame)), teamKey, idx);
    await syncToFirebase(updated);
  }, [localGame, isMyTurn, myTeamKey, syncToFirebase]);

  const handleExecCard = useCallback(async (teamKey, cardId, opts) => {
    if (!isMyTurn && whoseTurn !== 'both') return;
    const result = execCard(JSON.parse(JSON.stringify(localGame)), teamKey, cardId, opts);
    if (!result.ok) { alert(result.msg); return; }
    await syncToFirebase(result.game);
  }, [localGame, isMyTurn, whoseTurn, syncToFirebase]);

  const handleEndSection = useCallback(async () => {
    const updated = endSection(JSON.parse(JSON.stringify(localGame)));
    // On section end, both players need hands updated (card draw)
    // The acting player writes the full state including opponent's new hand
    // Opponent picks up their hand from the game state on next sync
    await syncToFirebase(updated);
  }, [localGame, syncToFirebase]);

  const handleSpendAssist = useCallback(async (teamKey, type, playerIdx) => {
    if (teamKey !== myTeamKey) return;
    const updated = spendAssist(JSON.parse(JSON.stringify(localGame)), teamKey, type, playerIdx);
    await syncToFirebase(updated);
  }, [localGame, myTeamKey, syncToFirebase]);

  const handleSpendRebound = useCallback(async (teamKey, type, playerIdx) => {
    if (teamKey !== myTeamKey) return;
    const updated = spendReboundBonus(JSON.parse(JSON.stringify(localGame)), teamKey, type, playerIdx);
    await syncToFirebase(updated);
  }, [localGame, myTeamKey, syncToFirebase]);

  const handleResolve = useCallback(async () => {
    const updated = resolvePendingShotCheck(JSON.parse(JSON.stringify(localGame)));
    await syncToFirebase(updated);
  }, [localGame, syncToFirebase]);

  // Forfeit / Abandon handlers
  const handleForfeit = async () => {
    if (!confirm('Forfeit this game? Your opponent will receive the win.')) return;
    await forfeitGame(roomCode, myRole);
  };

  const handleAbandon = async () => {
    if (!confirm('Abandon this game? No coins will be awarded to either player.')) return;
    await abandonGame(roomCode);
  };

  if (loading) return <div className={styles.loading}>Connecting to game...</div>;

  // Game over states
  if (meta?.status === 'forfeit' || meta?.status === 'abandoned' || localGame?.done) {
    return (
      <GameOver
        game={localGame}
        meta={meta}
        myRole={myRole}
        myTeamKey={myTeamKey}
        onLeave={onLeave}
        isPvp={true}
      />
    );
  }

  return (
    <div className={styles.wrap}>
      {/* PvP header bar */}
      <div className={styles.pvpBar}>
        <div className={styles.opponent}>
          vs. {myRole === 'host' ? meta?.guestName : meta?.hostName}
        </div>
        <div className={styles.turnIndicator}>
          {isMyTurn ? 'Your Turn' : "Opponent's Turn"}
        </div>
        <div className={styles.pvpActions}>
          <button className={styles.forfeitBtn} onClick={handleForfeit}>Forfeit</button>
          <button className={styles.abandonBtn} onClick={handleAbandon}>Abandon</button>
        </div>
      </div>

      {/* Existing game board — same CourtBoard, restricted by turn */}
      <CourtBoard
        game={localGame}
        setGame={/* wrapped to sync */}
        onRoll={handleRoll}
        onEndSection={handleEndSection}
        onExecCard={handleExecCard}
        onResolve={handleResolve}
        onSpendAssist={handleSpendAssist}
        onSpendRebound={handleSpendRebound}
        pvpMode={true}
        myTeamKey={myTeamKey}
        isMyTurn={isMyTurn}
      />
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/PvpGame.jsx src/components/PvpGame.module.css
git commit -m "feat: add PvP game wrapper with RTDB sync"
```

---

### Task 6: Adapt CourtBoard for PvP Mode

**Files:**
- Modify: `src/components/game/CourtBoard.jsx`

**Step 1: Add PvP props and guards**

CourtBoard receives new props: `pvpMode`, `myTeamKey`, `isMyTurn`

Key changes:
1. **Hide opponent hand**: When `pvpMode`, only show cards for `myTeamKey`
2. **Hide opponent draft pool**: Only show your pool during draft
3. **Disable controls when not your turn**: Roll buttons, card play, pass buttons all check `isMyTurn`
4. **Single-perspective view**: Always render your team on the left (or bottom on mobile)

```javascript
// Add to CourtBoard props
// pvpMode = false, myTeamKey = null, isMyTurn = true (defaults for local play)

// Guard all action handlers:
const canAct = (teamKey) => !pvpMode || (isMyTurn && teamKey === myTeamKey);

// In HandPanel rendering:
// Only show hand for myTeamKey when pvpMode
// Show opponent hand count (e.g., "Opponent: 5 cards") instead of actual cards

// In DraftPhase rendering:
// Only show draft pool for myTeamKey
// Show "Opponent is picking..." when it's their turn

// In roll buttons:
// Disable when !canAct(teamKey)

// In Pass button:
// Disable when !isMyTurn
```

**Step 2: Add "not your turn" overlay**

When `pvpMode && !isMyTurn`, show a subtle overlay or indicator:
- "Waiting for opponent..." text
- Slight dimming of interactive elements
- Still show the board state (scores, matchups, etc.)

**Step 3: Commit**

```bash
git add src/components/game/CourtBoard.jsx
git commit -m "feat: adapt CourtBoard for PvP mode with turn guards"
```

---

### Task 7: Handle Draft Phase in PvP

**Files:**
- Modify: `src/components/game/CourtBoard.jsx` (draft section)
- Modify: `src/components/PvpGame.jsx` (draft pool sync)

**Step 1: PvP draft pick flow**

When you pick a player in draft:
1. Remove player from your local draft pool
2. Add to starters (visible to both)
3. Advance draft step
4. Write public game state (with new starter visible)
5. Write private data (updated pool)
6. Opponent sees the pick appear but NOT your remaining pool

```javascript
// In PvpGame.jsx — handle draft pick
const handleDraftPick = async (card) => {
  const g = JSON.parse(JSON.stringify(localGame));
  const team = myTeamKey === 'A' ? g.teamA : g.teamB;
  const pool = myTeamKey === 'A' ? g.draft.aPool : g.draft.bPool;

  // Add to starters, remove from pool
  team.starters.push(card);
  const poolIdx = pool.findIndex(c => c.id === card.id);
  if (poolIdx >= 0) pool.splice(poolIdx, 1);

  g.draft.step++;

  // Check if draft complete (both have 5)
  if (g.teamA.starters.length >= 5 && g.teamB.starters.length >= 5) {
    g.phase = 'matchup_strats';
    g.offMatchups = { A: [0,1,2,3,4], B: [0,1,2,3,4] };
  }

  await syncToFirebase(g);
};
```

**Step 2: Show opponent picks as they happen**

Opponent's starters array updates in real-time via `onGameState`. CourtBoard already renders starters, so picks appear automatically. The key is just NOT showing the opponent's remaining pool.

**Step 3: Commit**

```bash
git add src/components/game/CourtBoard.jsx src/components/PvpGame.jsx
git commit -m "feat: implement PvP draft phase with hidden pools"
```

---

### Task 8: Handle Scoring Phase Edge Cases in PvP

**Files:**
- Modify: `src/components/PvpGame.jsx`

**Step 1: Handle reaction card windows**

Reaction cards are the trickiest PvP interaction. When Player A plays a card that allows a reaction (e.g., High Screen & Roll triggers Go Under/Fight Over/Veer Switch), we need to:
1. Player A's action writes the card effect + sets a `pendingReaction` field
2. Player B's client sees the pending reaction and enables reaction card play
3. Player B plays reaction OR passes (clicks "No Reaction")
4. State resolves and continues

Add to game state:
```javascript
// In publicGame
pendingReaction: {
  type: 'screen_reaction' | 'close_out' | 'general',
  triggerTeamKey: 'A' | 'B',
  cardId: 'high_screen_roll',
  // reaction-specific context
} | null
```

**Step 2: Handle "rolling open" phase**

When `scoringPasses >= 99` (rolling open), BOTH players can roll simultaneously. The `whoseTurn` is set to `'both'`. Each player can only roll their own team's players. Need optimistic locking or last-write-wins for the shared rollResults.

Approach: Each player writes their own rolls. Since rolls only modify `rollResults[myTeamKey]` and `teamX.stats`, there's no conflict — each player only modifies their side.

**Step 3: Handle endSection sync**

`endSection()` modifies both teams (fatigue, card draw, rebound bonuses). This should be triggered by either player clicking "End Section" after all 10 players have rolled. The acting player runs `endSection()` and writes the full state including both players' new hands.

Special handling: after `endSection()`, the acting player needs to write BOTH players' private data (since hands may change from card draws). Add a `writeAllPrivate()` function for this case.

**Step 4: Commit**

```bash
git add src/components/PvpGame.jsx
git commit -m "feat: handle PvP scoring phase reactions and rolling"
```

---

### Task 9: Game Lifecycle (Forfeit / Abandon / Inactivity)

**Files:**
- Modify: `src/components/PvpGame.jsx`
- Modify: `src/components/game/GameOver.jsx`

**Step 1: Forfeit flow**

Already wired in Task 5. When a player forfeits:
- Room status → 'forfeit', winner set to opponent's role
- GameOver component detects `meta.status === 'forfeit'`
- Winner gets coin rewards (game completion + win bonus)
- Loser gets nothing

**Step 2: Abandon flow**

- Room status → 'abandoned'
- GameOver shows "Game Abandoned — No rewards"
- Both players see a "Leave" button

**Step 3: 24-hour inactivity clock**

In the PvP header bar, show time since last opponent action:
```javascript
const timeSinceOpponent = Date.now() - meta.lastActionAt;
const canStartClock = timeSinceOpponent > 24 * 60 * 60 * 1000 && !meta.forfeitClockStartedAt;
const clockActive = meta.forfeitClockStartedAt && meta.forfeitClockStartedBy !== myRole;
const canClaimWin = clockActive && (Date.now() - meta.forfeitClockStartedAt > 24 * 60 * 60 * 1000);
```

UI shows:
- "Opponent inactive for X hours" when > 1 hour
- "Start Forfeit Clock" button when > 24 hours
- "Claim Win" button when forfeit clock has expired

**Step 4: Adapt GameOver for PvP**

Add `isPvp` prop to GameOver. When true:
- Show opponent name
- Calculate rewards only for the local player's perspective
- "Leave Game" button (calls `onLeave` + removes from active games)
- No "Rematch" button for now

**Step 5: Commit**

```bash
git add src/components/PvpGame.jsx src/components/game/GameOver.jsx
git commit -m "feat: add forfeit, abandon, and 24h inactivity clock"
```

---

### Task 10: PvP Coin Rewards

**Files:**
- Modify: `src/components/game/GameOver.jsx`
- Modify: `src/game/coinRewards.js`

**Step 1: Adjust rewards for PvP context**

```javascript
// In coinRewards.js, add pvp parameter
export function calculateRewards(game, isWinner, dailyMilestoneCoinsUsed = 0, isPvp = false) {
  // Same base rewards
  // PvP win bonus could be higher than self-play (e.g., 50 instead of 25)
  if (isWinner) {
    coins += isPvp ? 50 : 25;
    breakdown.push({ label: isPvp ? 'PvP Victory' : 'Victory Bonus', coins: isPvp ? 50 : 25 });
  }
  // Forfeit win: winner gets base + win bonus, NO milestone checks (game wasn't completed)
  // Abandon: no rewards at all
}
```

**Step 2: Persist PvP rewards**

In GameOver, when `isPvp && game.done`:
- Calculate rewards using the player's team stats
- Call `addCoins()` to persist

When `isPvp && meta.status === 'forfeit'`:
- If winner: base + PvP victory bonus only
- If loser: nothing

When `isPvp && meta.status === 'abandoned'`:
- No rewards for either player

**Step 3: Commit**

```bash
git add src/components/game/GameOver.jsx src/game/coinRewards.js
git commit -m "feat: add PvP coin rewards with forfeit/abandon handling"
```

---

### Task 11: Wire PvP into App.jsx

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.module.css`

**Step 1: Add PvP tab for authenticated users**

```javascript
// In AUTH_TABS array
const AUTH_TABS = [
  { id: 'builder', label: 'Team Builder' },
  { id: 'play', label: 'Play' },
  { id: 'pvp', label: 'PvP' },  // NEW
  { id: 'collection', label: 'Collection' },
  { id: 'rules', label: 'Rulebook' },
];
```

**Step 2: Add PvP state management**

```javascript
const [pvpGame, setPvpGame] = useState(null); // { roomCode, myRole }

const handlePvpGameStart = (roomCode, myRole) => {
  setPvpGame({ roomCode, myRole });
};

const handlePvpLeave = () => {
  setPvpGame(null);
};

// In render:
// If pvpGame is set, show PvpGame component (fullscreen, replaces tab content)
// Otherwise show PvpLobby in the pvp tab
```

**Step 3: Commit**

```bash
git add src/App.jsx src/App.module.css
git commit -m "feat: wire PvP tab into main app navigation"
```

---

### Task 12: End-to-End Testing & Polish

**Files:**
- All PvP files

**Step 1: Test full flow on localhost**

Open two browser windows (one regular, one incognito) with different Google accounts:
1. Player A creates room → gets code
2. Player B enters code → joins
3. Both select teams and decks → ready up
4. Game starts → draft alternates correctly
5. Matchup phase → card plays sync
6. Scoring phase → rolls sync, reactions work
7. Game ends → rewards calculated correctly
8. Test forfeit mid-game
9. Test abandon

**Step 2: Fix serialization issues**

Firebase RTDB doesn't support `undefined` values. Audit all game state writes to ensure:
- No `undefined` values (use `null` instead)
- No circular references
- Arrays are properly serialized (RTDB converts arrays to objects if sparse)

Common fix: `JSON.parse(JSON.stringify(state))` before writing (already done in handlers).

**Step 3: Deploy and test on production**

```bash
npm run deploy
```

Test with real accounts on the live site.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: PvP multiplayer with room codes — complete implementation"
```

---

## Execution Order & Dependencies

```
Task 1 (RTDB setup)
  ↓
Task 2 (Room service)
  ↓
Task 3 (Lobby UI) ←→ Task 4 (Game init)
  ↓
Task 5 (PvP game wrapper)
  ↓
Task 6 (CourtBoard PvP mode) ←→ Task 7 (Draft PvP) ←→ Task 8 (Scoring PvP)
  ↓
Task 9 (Lifecycle) ←→ Task 10 (Rewards)
  ↓
Task 11 (Wire into App)
  ↓
Task 12 (E2E testing)
```

Tasks 3+4, 6+7+8, and 9+10 can be worked in parallel within their groups.
