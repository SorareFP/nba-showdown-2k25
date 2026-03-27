# Saved Teams & Deck Building Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Firebase Auth + Firestore so users can save/load teams and build strategy card decks, accessed via a new Collection tab.

**Architecture:** Firebase JS SDK for auth (Google sign-in) and Firestore. AuthProvider context at app root. New CollectionTab component with sub-views for teams list, decks list, and deck editor. Firestore helpers in `src/firebase/` directory. Team Builder gets Save/Load buttons when signed in.

**Tech Stack:** Firebase 10.x (Auth, Firestore), React context, Vite env vars for config.

**Design doc:** `docs/plans/2026-03-27-saved-teams-decks-design.md`

---

### Task 1: Firebase Project Setup & SDK Installation

**Files:**
- Modify: `package.json` (add firebase dependency)
- Create: `src/firebase/config.js`
- Create: `.env.local` (local dev, gitignored)
- Modify: `.gitignore`

**Step 1: Install Firebase SDK**

Run: `npm install firebase`

**Step 2: Create Firebase config file**

Create `src/firebase/config.js`:

```js
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
```

**Step 3: Create `.env.local` template**

Create `.env.local` with placeholder values (user fills in from Firebase console):

```
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

**Step 4: Add `.env.local` to `.gitignore`**

Append to `.gitignore`:
```
.env.local
.env*.local
```

**Step 5: Verify build still passes**

Run: `npm run build`
Expected: Clean build (Firebase tree-shaken since nothing imports it yet)

**Step 6: Commit**

```bash
git add package.json package-lock.json src/firebase/config.js .gitignore
git commit -m "feat: add Firebase SDK and config scaffold"
```

---

### Task 2: Auth Provider & Hook

**Files:**
- Create: `src/firebase/AuthProvider.jsx`
- Modify: `src/App.jsx` (wrap with AuthProvider)

**Step 1: Create AuthProvider**

Create `src/firebase/AuthProvider.jsx`:

```jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, googleProvider, db } from './config.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        // Ensure user doc exists in Firestore
        const ref = doc(db, 'users', fbUser.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            displayName: fbUser.displayName,
            email: fbUser.email,
            photoURL: fbUser.photoURL,
            currency: 0,
            createdAt: serverTimestamp(),
          });
        }
        setUser(fbUser);
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const signIn = () => signInWithPopup(auth, googleProvider);
  const signOut = () => fbSignOut(auth);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
```

**Step 2: Wrap App with AuthProvider**

In `src/App.jsx`, import `AuthProvider` and wrap `<LightboxProvider>` with it:

```jsx
import { AuthProvider } from './firebase/AuthProvider.jsx';

// In the return:
return (
  <AuthProvider>
    <LightboxProvider>
      {/* ...existing app content... */}
    </LightboxProvider>
  </AuthProvider>
);
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean build

**Step 4: Commit**

```bash
git add src/firebase/AuthProvider.jsx src/App.jsx
git commit -m "feat: add AuthProvider with Google sign-in and Firestore user doc"
```

---

### Task 3: Auth Button in Header

**Files:**
- Create: `src/components/AuthButton.jsx`
- Create: `src/components/AuthButton.module.css`
- Modify: `src/App.jsx` (add AuthButton to header)
- Modify: `src/App.module.css` (auth button styles)

**Step 1: Create AuthButton component**

Create `src/components/AuthButton.jsx`:

```jsx
import { useAuth } from '../firebase/AuthProvider.jsx';
import styles from './AuthButton.module.css';

export default function AuthButton() {
  const { user, loading, signIn, signOut } = useAuth();

  if (loading) return null;

  if (!user) {
    return (
      <button className={styles.signIn} onClick={signIn}>
        Sign In
      </button>
    );
  }

  return (
    <div className={styles.user}>
      {user.photoURL && (
        <img src={user.photoURL} alt="" className={styles.avatar} referrerPolicy="no-referrer" />
      )}
      <span className={styles.name}>{user.displayName?.split(' ')[0]}</span>
      <button className={styles.signOut} onClick={signOut}>Sign Out</button>
    </div>
  );
}
```

**Step 2: Create AuthButton styles**

Create `src/components/AuthButton.module.css`:

```css
.signIn {
  background: rgba(255,255,255,0.08);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 5px 14px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.signIn:hover { background: rgba(255,255,255,0.14); }

.user {
  display: flex;
  align-items: center;
  gap: 8px;
}

.avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.name {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}

.signOut {
  background: none;
  color: var(--text-dim);
  font-size: 11px;
  padding: 2px 6px;
  cursor: pointer;
}
.signOut:hover { color: var(--text); }
```

**Step 3: Add AuthButton to App header**

In `src/App.jsx`, import `AuthButton` and add it after the `<nav>` in the header:

```jsx
import AuthButton from './components/AuthButton.jsx';

// In header, after </nav>:
<AuthButton />
```

**Step 4: Manual verification**

Run: `npm run dev`
Verify: "Sign In" button appears in header. Clicking opens Google popup (requires Firebase project configured). After sign-in, shows avatar + name + Sign Out.

**Step 5: Commit**

```bash
git add src/components/AuthButton.jsx src/components/AuthButton.module.css src/App.jsx
git commit -m "feat: add auth button to header with Google sign-in"
```

---

### Task 4: Firestore Helpers for Teams & Decks

**Files:**
- Create: `src/firebase/savedTeams.js`
- Create: `src/firebase/savedDecks.js`

**Step 1: Create team CRUD helpers**

Create `src/firebase/savedTeams.js`:

```js
import { collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { db } from './config.js';

function teamsRef(uid) {
  return collection(db, 'users', uid, 'teams');
}

export async function saveTeam(uid, { name, players, salary }) {
  return addDoc(teamsRef(uid), {
    name,
    players,  // array of card IDs
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
```

**Step 2: Create deck CRUD helpers**

Create `src/firebase/savedDecks.js`:

```js
import { collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { db } from './config.js';

const MAX_PER_CARD = 8;
const MAX_TOTAL = 50;

function decksRef(uid) {
  return collection(db, 'users', uid, 'decks');
}

export function validateDeck(cards) {
  // cards = { cardId: count, ... }
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
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean build (tree-shaken, no runtime usage yet)

**Step 4: Commit**

```bash
git add src/firebase/savedTeams.js src/firebase/savedDecks.js
git commit -m "feat: add Firestore CRUD helpers for teams and decks"
```

---

### Task 5: Collection Tab — Shell & My Teams List

**Files:**
- Create: `src/components/CollectionTab.jsx`
- Create: `src/components/CollectionTab.module.css`
- Modify: `src/App.jsx` (add Collection tab, conditionally visible)

**Step 1: Create CollectionTab component**

Create `src/components/CollectionTab.jsx` with My Teams section:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { loadTeams, deleteTeam } from '../firebase/savedTeams.js';
import { CARD_MAP } from '../game/cards.js';
import styles from './CollectionTab.module.css';

export default function CollectionTab({ onLoadTeam }) {
  const { user } = useAuth();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedTeam, setExpandedTeam] = useState(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const t = await loadTeams(user.uid);
    setTeams(t);
    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (teamId) => {
    if (!confirm('Delete this team?')) return;
    await deleteTeam(user.uid, teamId);
    refresh();
  };

  return (
    <div className={styles.wrap}>
      <h2 className={styles.sectionTitle}>My Teams</h2>
      {loading && <div className={styles.loading}>Loading...</div>}
      {!loading && teams.length === 0 && (
        <div className={styles.empty}>No saved teams yet. Build a team and save it from the Team Builder.</div>
      )}
      <div className={styles.list}>
        {teams.map(t => (
          <div key={t.id} className={styles.item}>
            <div className={styles.itemHeader} onClick={() => setExpandedTeam(expandedTeam === t.id ? null : t.id)}>
              <div>
                <div className={styles.itemName}>{t.name}</div>
                <div className={styles.itemMeta}>
                  {t.players.length} players · ${t.salary}
                  {t.updatedAt?.toDate && ` · ${t.updatedAt.toDate().toLocaleDateString()}`}
                </div>
              </div>
              <span className={styles.chevron}>{expandedTeam === t.id ? '▾' : '▸'}</span>
            </div>
            {expandedTeam === t.id && (
              <div className={styles.itemBody}>
                <div className={styles.playerList}>
                  {t.players.map(pid => {
                    const c = CARD_MAP[pid];
                    return c ? (
                      <div key={pid} className={styles.playerRow}>
                        <span>{c.name}</span>
                        <span className={styles.playerMeta}>{c.team} · S{c.speed} P{c.power} · ${c.salary}</span>
                      </div>
                    ) : <div key={pid} className={styles.playerRow}>{pid}</div>;
                  })}
                </div>
                <div className={styles.itemActions}>
                  <button className={styles.loadBtn} onClick={() => onLoadTeam(t, 'A')}>Load as Team A</button>
                  <button className={styles.loadBtnB} onClick={() => onLoadTeam(t, 'B')}>Load as Team B</button>
                  <button className={styles.deleteBtn} onClick={() => handleDelete(t.id)}>Delete</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Create CollectionTab styles**

Create `src/components/CollectionTab.module.css`:

```css
.wrap { display: flex; flex-direction: column; gap: 1.5rem; }

.sectionTitle { font-size: 18px; font-weight: 700; }

.loading { color: var(--text-muted); font-size: 13px; font-style: italic; }
.empty { color: var(--text-dim); font-size: 13px; font-style: italic; padding: 1rem; text-align: center; }

.list { display: flex; flex-direction: column; gap: 8px; }

.item {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.itemHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
}
.itemHeader:hover { background: var(--card-hover); }

.itemName { font-weight: 600; font-size: 14px; }
.itemMeta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.chevron { color: var(--text-dim); font-size: 14px; }

.itemBody { padding: 0 14px 12px; border-top: 1px solid var(--border); }

.playerList { display: flex; flex-direction: column; gap: 2px; padding: 8px 0; }
.playerRow { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
.playerMeta { color: var(--text-muted); font-size: 11px; }

.itemActions { display: flex; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.loadBtn {
  background: var(--orange); color: #fff;
  padding: 6px 14px; border-radius: var(--radius-sm);
  font-size: 12px; font-weight: 600;
}
.loadBtn:hover { background: #C2410C; }
.loadBtnB {
  background: var(--blue); color: #fff;
  padding: 6px 14px; border-radius: var(--radius-sm);
  font-size: 12px; font-weight: 600;
}
.loadBtnB:hover { background: #2563EB; }
.deleteBtn {
  background: none; color: var(--red);
  font-size: 12px; padding: 6px 10px;
  margin-left: auto;
}
.deleteBtn:hover { opacity: 0.7; }

/* Deck Editor styles (Task 7) will go here */

@media (max-width: 600px) {
  .itemHeader { padding: 10px 12px; }
  .itemName { font-size: 13px; }
  .itemActions { flex-wrap: wrap; }
  .loadBtn, .loadBtnB { flex: 1; text-align: center; }
}
```

**Step 3: Add Collection tab to App**

In `src/App.jsx`:
- Import `CollectionTab` and `useAuth`
- Add Collection tab to TABS (conditionally visible when signed in)
- Wire `onLoadTeam` to set teamA/teamB from saved data
- Pass `CARD_MAP` lookup to resolve player IDs to card objects

```jsx
import CollectionTab from './components/CollectionTab.jsx';
import { useAuth } from './firebase/AuthProvider.jsx';
import { CARD_MAP } from './game/cards.js';

// Inside App():
const { user } = useAuth();

const TABS = [
  { id: 'cards',   label: '📋 Cards' },
  { id: 'strats',  label: '🃏 Strategy Cards' },
  { id: 'builder', label: '🏗 Team Builder' },
  { id: 'play',    label: '🏀 Play' },
  { id: 'rules',   label: '📖 Rulebook' },
  ...(user ? [{ id: 'collection', label: '💾 Collection' }] : []),
];

const handleLoadTeam = (savedTeam, slot) => {
  const roster = savedTeam.players.map(id => CARD_MAP[id]).filter(Boolean);
  if (slot === 'A') setTeamA(roster);
  else setTeamB(roster);
  setTab('builder');
};

// In render:
{tab === 'collection' && <CollectionTab onLoadTeam={handleLoadTeam} />}
```

**Step 4: Manual verification**

Run: `npm run dev`
Verify: Collection tab appears when signed in, disappears when signed out. Shows empty state.

**Step 5: Commit**

```bash
git add src/components/CollectionTab.jsx src/components/CollectionTab.module.css src/App.jsx
git commit -m "feat: add Collection tab with My Teams list and load-to-builder"
```

---

### Task 6: Save/Load Buttons in Team Builder

**Files:**
- Modify: `src/components/TeamBuilderTab.jsx`
- Modify: `src/components/TeamBuilderTab.module.css`

**Step 1: Add Save and Load buttons to RosterPanel**

In `src/components/TeamBuilderTab.jsx`:

- Import `useAuth`, `saveTeam`, `loadTeams` from firebase modules
- Import `CARD_MAP` from cards.js
- Add save handler: prompts for name, calls `saveTeam(uid, { name, players: roster.map(c => c.id), salary })`
- Add load handler: fetches saved teams, shows a modal/dropdown to pick one, resolves IDs back to card objects
- Only show Save/Load when `user` is truthy

Save button goes in each `RosterPanel` header. Load button opens a simple modal listing saved teams.

**Step 2: Add styles for save/load buttons**

Add to `TeamBuilderTab.module.css`:

```css
.saveBtn {
  background: rgba(255,255,255,0.08);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 4px 10px;
  font-size: 11px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.saveBtn:hover { background: rgba(255,255,255,0.14); }

.loadModal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.65);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.loadModalBox {
  background: #0F1E35;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 14px;
  padding: 20px;
  max-width: 400px;
  width: 100%;
  box-shadow: 0 8px 40px rgba(0,0,0,0.6);
}
.loadModalTitle { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
.loadModalList { display: flex; flex-direction: column; gap: 6px; max-height: 50vh; overflow-y: auto; }
.loadModalItem {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 10px 14px;
  text-align: left;
  cursor: pointer;
}
.loadModalItem:hover { background: rgba(255,255,255,0.12); }
.loadModalName { font-size: 13px; font-weight: 600; }
.loadModalMeta { font-size: 11px; color: var(--text-muted); }
.loadModalCancel {
  background: rgba(255,255,255,0.07);
  color: #94A3B8;
  padding: 8px 18px;
  border-radius: 6px;
  font-size: 13px;
  width: 100%;
  margin-top: 10px;
}
.loadModalCancel:hover { background: rgba(255,255,255,0.12); }
```

**Step 3: Manual verification**

Run: `npm run dev`
Verify: When signed in, Save/Load buttons appear on each roster panel. Save prompts for name, saves to Firestore. Load shows modal with saved teams, clicking one populates the roster.

**Step 4: Commit**

```bash
git add src/components/TeamBuilderTab.jsx src/components/TeamBuilderTab.module.css
git commit -m "feat: add Save/Load team buttons to Team Builder (requires sign-in)"
```

---

### Task 7: Deck Editor

**Files:**
- Create: `src/components/DeckEditor.jsx`
- Create: `src/components/DeckEditor.module.css`
- Modify: `src/components/CollectionTab.jsx` (add My Decks section + deck editor)

**Step 1: Create DeckEditor component**

Create `src/components/DeckEditor.jsx`:

The deck editor shows:
- Left: all strategy cards from STRATS, each with +/- buttons and current count (0-8)
- Right/top: deck summary with name input, running total (X/50), save button
- Cards grouped by phase (matchup, pre_roll, scoring, reaction)
- Each card row shows: name, phase, side, description snippet, quantity selector
- Save validates via `validateDeck()` before calling `saveDeck()` or `updateDeck()`

**Step 2: Create DeckEditor styles**

Create `src/components/DeckEditor.module.css`:

Layout: two-column on desktop (card list + deck summary sidebar), stacks on mobile.
Card rows: compact with +/- buttons, quantity display, card name and phase tag.
Summary sidebar: sticky, shows total, name input, save button.

**Step 3: Add My Decks section to CollectionTab**

In `src/components/CollectionTab.jsx`:
- Import `loadDecks`, `deleteDeck` from firebase
- Import `DeckEditor`
- Add My Decks list below My Teams (same expand/collapse pattern)
- "New Deck" button opens DeckEditor with empty state
- Edit button on existing deck opens DeckEditor pre-filled
- DeckEditor gets `onSave` callback that refreshes the list

**Step 4: Manual verification**

Run: `npm run dev`
Verify: My Decks section shows in Collection tab. "New Deck" opens editor. Can add cards with +/- buttons (respects 0-8 range). Total updates live. Save persists to Firestore. Edit loads existing deck. Delete works.

**Step 5: Commit**

```bash
git add src/components/DeckEditor.jsx src/components/DeckEditor.module.css src/components/CollectionTab.jsx
git commit -m "feat: add deck editor with card quantity controls and Firestore persistence"
```

---

### Task 8: Mobile Responsive for New Components

**Files:**
- Modify: `src/components/CollectionTab.module.css`
- Modify: `src/components/DeckEditor.module.css`
- Modify: `src/components/AuthButton.module.css`

**Step 1: Add responsive breakpoints**

Collection tab: item actions stack on small screens, full-width buttons.
Deck editor: two-column → single-column below 700px, summary moves to top.
Auth button: compact on mobile (just avatar, no name).

**Step 2: Manual verification**

Run: `npm run dev`
Open browser devtools responsive mode at 375px and 768px widths. Verify all new components are usable.

**Step 3: Commit**

```bash
git add src/components/CollectionTab.module.css src/components/DeckEditor.module.css src/components/AuthButton.module.css
git commit -m "feat: add mobile responsive styles for Collection tab and deck editor"
```

---

### Task 9: Final Build, Deploy & Verify

**Step 1: Verify clean build**

Run: `npm run build`
Expected: No errors, clean output

**Step 2: Test end-to-end flow locally**

Run: `npm run preview`
Test: Sign in → save a team → save a deck → load team from Collection → load team from Team Builder → sign out → verify guest mode works

**Step 3: Commit any remaining changes and push**

```bash
git add -A
git commit -m "chore: final cleanup for saved teams & decks feature"
git push origin main
```

**Step 4: Deploy to GitHub Pages**

Run: `npm run deploy`
Verify at: https://SorareFP.github.io/nba-showdown-2k25

**Note:** User must create a Firebase project and populate `.env.local` before Tasks 2+ will work at runtime. The Firebase console setup (create project, enable Google Auth, create Firestore database, copy config) is a prerequisite the user handles manually.
