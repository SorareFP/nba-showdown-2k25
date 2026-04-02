# Scoring Balance + Draft Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce average game scoring by rebalancing the assist/rebound economy, removing the fast break mechanic, and replacing the snake draft with simultaneous blind lineup selection.

**Architecture:** Three independent changes to the game engine (assist costs, rebound costs, draft phase), plus UI updates for the new blind pick flow and PvP sync. All changes are in `src/game/engine.js`, `src/game/canPlay.js`, `src/components/game/CourtBoard.jsx`, and PvP-related files.

**Tech Stack:** React 18, Vite, Firebase RTDB (PvP only), pure JS game engine

---

### Task 1: Rebalance Assist Spending Costs

**Files:**
- Modify: `src/game/engine.js` — `spendAssist()` function
- Modify: `src/components/game/CourtBoard.jsx` — assist spend button labels

**Step 1: Update assist costs in engine.js**

In `spendAssist()`, change the cost checks:

```javascript
// 3PT check: change cost from 2 to 4
if (type === '3pt') {
    if (myT.assists < 4) return { game: ng, ok: false, msg: `Need 4 assists (have ${myT.assists})` };
    // ... (keep all other logic the same)
    myT.assists -= 4;
```

```javascript
// Paint check: change cost from 3 to 3 (stays the same but verify)
if (type === 'paint') {
    if (myT.assists < 3) return { game: ng, ok: false, msg: `Need 3 assists (have ${myT.assists})` };
    // ... (keep all other logic the same)
    myT.assists -= 3;
```

Also update the log messages to reflect new costs:
- `Spent 4 AST:` instead of `Spent 2 AST:` for 3pt
- `Spent 3 AST:` instead of `Spent 3 AST:` for paint (already correct)

**Step 2: Update assist spend button labels in CourtBoard.jsx**

Search for where assist spend buttons are rendered. They display the cost to the user. Find strings like `"2 AST"` or `"Spend 2"` for the 3PT option and update to `"4 AST"`. The paint option text should already say 3.

Search patterns: `onSpendAssist`, `3pt`, `paint`, `boost` in CourtBoard.jsx to find the button render locations.

**Step 3: Update How to Play content**

In `src/components/HowToPlay.jsx`, find the Assists accordion section and update:
- `1 AST: +1 to any shot check` (unchanged)
- `3 AST: Attempt a Paint shot check` (was 2)
- `4 AST: Attempt a 3PT shot check` (was 2)

**Step 4: Verify and commit**

Run: `npx vite build`
Expected: Build succeeds with no errors.

```bash
git add src/game/engine.js src/components/game/CourtBoard.jsx src/components/HowToPlay.jsx
git commit -m "balance: increase assist costs — 4 AST for 3PT check, 3 AST for paint check"
```

---

### Task 2: Rebalance Rebound Bonus Costs + Remove Fast Break

**Files:**
- Modify: `src/game/engine.js` — `spendReboundBonus()` and `endSection()`
- Modify: `src/components/game/CourtBoard.jsx` — rebound spend buttons (remove fast break UI)
- Modify: `src/components/HowToPlay.jsx` — update rules content

**Step 1: Update paint check cost in spendReboundBonus()**

In `src/game/engine.js`, find `spendReboundBonus()`, `type === 'paint_check'` case:

```javascript
if (type === 'paint_check') {
    // Change cost from 2 to 3
    if (myT.rebounds < 3) return { game: ng, ok: false, msg: `Need 3 rebounds (have ${myT.rebounds})` };
    myT.rebounds -= 3;
    // ... rest stays the same
```

Update the log message: `Rebound Paint Check (−3 REB):` instead of `(−2 REB)`.

**Step 2: Remove fast_break case from spendReboundBonus()**

Delete the entire `if (type === 'fast_break') { ... }` block from `spendReboundBonus()`.

**Step 3: Remove fast break from endSection()**

In `endSection()`, find where `reboundBonuses` are set. Currently:
```javascript
ng.reboundBonuses[wk] = { diff: absRd, paintCheck: absRd >= 3, fastBreak: absRd >= 5 };
```

Change to:
```javascript
ng.reboundBonuses[wk] = { diff: absRd, paintCheck: absRd >= 3 };
```

**Step 4: Remove fast break UI from CourtBoard.jsx**

Search CourtBoard.jsx for `fast_break` or `fastBreak` references in the rebound bonus spend buttons. Remove the fast break button entirely. Keep paint_check and putback buttons.

**Step 5: Remove fast break from analytics tracking**

In `src/game/engine.js`, if the analytics tracking added by the earlier agent tracks `fast_break` in `spendReboundBonus`, remove that case.

**Step 6: Update How to Play content**

In `src/components/HowToPlay.jsx`, in the Rebounds accordion section:
- Remove the fast break line (`+5 differential: Fast-break shot check`)
- Update paint check text: `+3 differential: Second-chance Paint check (costs 3 REB)` (was 2)

**Step 7: Verify and commit**

Run: `npx vite build`

```bash
git add src/game/engine.js src/components/game/CourtBoard.jsx src/components/HowToPlay.jsx
git commit -m "balance: rebound paint check costs 3 REB, remove fast break mechanic"
```

---

### Task 3: Draft Phase Redesign — Engine Changes

**Files:**
- Modify: `src/game/engine.js` — `newGame()` initial state, remove SNAKE export dependency awareness
- Modify: `src/game/canPlay.js` — if any draft-phase checks reference step count

**Step 1: Update newGame() draft state**

In `src/game/engine.js`, `newGame()`, change the draft initialization:

```javascript
// Old:
draft: { step: 0, aPool: rosterA.slice(), bPool: rosterB.slice() },

// New:
draft: {
  aPool: rosterA.slice(),
  bPool: rosterB.slice(),
  aReady: false,   // Team A has submitted their picks
  bReady: false,   // Team B has submitted their picks
},
```

The `step` field and `SNAKE` array are no longer needed for the draft. However, keep the `SNAKE` export since TutorialGame.jsx may reference it — just note it's deprecated.

The `starters` arrays on each team are already initialized as `[]` in `makeTeam()`, and players will be added when each team submits their 5 picks.

**Step 2: Verify canPlay.js has no draft step dependencies**

Read `src/game/canPlay.js` — confirm line `if (phase === 'draft') return no(...)` is the only draft reference. No changes needed if so.

**Step 3: Commit**

```bash
git add src/game/engine.js
git commit -m "refactor: update draft state for simultaneous blind selection"
```

---

### Task 4: Draft Phase Redesign — Solo Mode UI

**Files:**
- Modify: `src/components/game/CourtBoard.jsx` — replace DraftRow/snake draft UI with blind pick UI

**Step 1: Understand current draft UI**

In CourtBoard.jsx, the draft is rendered by `DraftPhase` (or inline draft logic). Find where `phase === 'draft'` triggers the draft UI. Currently it shows a snake draft with alternating picks.

**Step 2: Create BlindPickPhase component**

Add a new component (either in CourtBoard.jsx or as a separate file) that:

1. Shows your 10-player roster as selectable cards
2. Tracks which 5 are selected (local state, not game state yet)
3. Shows fatigue/hot/cold info on each player
4. Shows a count: "3/5 selected"
5. "Submit" button enabled when exactly 5 are selected
6. On submit in solo mode:
   - Set your starters to the 5 selected players
   - Run AI draft pick for opponent (use `aiDraftPick` from `src/game/ai.js` — call it 5 times to fill opponent starters)
   - Transition to matchup_strats phase
   - Update game state via `setGame()`

The UI should show each player as a toggleable card with:
- Player name, Speed, Power, Shot Line
- Salary
- Fatigue minutes / hot/cold markers
- Selected state (highlighted border when picked)

**Step 3: Update PhaseBar for new draft**

The PhaseBar currently shows `Pick {step}/10 · A B B A A B B A A B`. Change to:
```
Q{quarter} · Sec {section}/3 · Lineup Selection — {selectedCount}/5
```

With a "Submit" button instead of the snake order display.

**Step 4: Handle AI opponent picks in solo mode**

When the player submits, use the AI to pick the opponent's team:

```javascript
import { aiDraftPick } from '../../game/ai.js';

// After player submits their 5:
const g = JSON.parse(JSON.stringify(game));
g.teamA.starters = selectedPlayers; // player's picks
// AI picks 5 for Team B
for (let i = 0; i < 5; i++) {
  const action = aiDraftPick(g, 'B');
  if (action) {
    const pool = g.draft.bPool;
    const pIdx = pool.findIndex(p => p.id === action.playerId);
    if (pIdx >= 0) {
      g.teamB.starters.push(pool[pIdx]);
      g.draft.bPool = pool.filter((_, j) => j !== pIdx);
    }
  }
}
g.phase = 'matchup_strats';
g.offMatchups = { A: [0,1,2,3,4], B: [0,1,2,3,4] };
setGame(g);
```

**Step 5: Verify and commit**

Run: `npx vite build`

```bash
git add src/components/game/CourtBoard.jsx
git commit -m "feat: replace snake draft with simultaneous blind lineup selection (solo mode)"
```

---

### Task 5: Draft Phase Redesign — PvP Mode

**Files:**
- Modify: `src/components/PvpGame.jsx` — handle blind pick submission and sync
- Modify: `src/firebase/pvpGame.js` — if needed for draft state sync

**Step 1: PvP blind pick flow**

In PvP, the blind pick works like the end-section vote pattern:

1. Each player selects their 5 starters locally
2. On "Submit", write their picks to `private/{role}` in Firebase (hidden from opponent)
3. Also set `draft.aReady = true` or `draft.bReady = true` in the public game state
4. When both are ready, a callback reads both private picks and reveals them:
   - Set `teamA.starters` and `teamB.starters` from the private data
   - Remove picked players from pools
   - Transition to `matchup_strats` phase
   - Sync to Firebase

**Step 2: Update PvpGame.jsx handleSetGame for draft submission**

Add a new handler `handleDraftSubmit(selectedPlayerIds)` that:

```javascript
const handleDraftSubmit = useCallback(async (selectedPlayerIds) => {
  const clone = JSON.parse(JSON.stringify(localGame));
  const myPool = myTeamKey === 'A' ? clone.draft.aPool : clone.draft.bPool;
  const picks = selectedPlayerIds.map(id => myPool.find(p => p.id === id)).filter(Boolean);

  // Write picks to private data
  const newPrivate = { ...privateData, draftPicks: selectedPlayerIds };
  await writePrivateData(roomCode, myRole, prepareForFirebase(newPrivate));

  // Mark ready in public state
  if (myTeamKey === 'A') clone.draft.aReady = true;
  else clone.draft.bReady = true;

  // Check if both ready
  const otherReady = myTeamKey === 'A' ? clone.draft.bReady : clone.draft.aReady;
  if (otherReady) {
    // Both ready — read opponent's private picks and reveal
    // This will be triggered by the Firebase listener when both are ready
  }

  await syncToFirebase(clone);
}, [localGame, myTeamKey, privateData, roomCode, myRole, syncToFirebase]);
```

**Step 3: Add Firebase listener for both-ready detection**

When the public game state updates and both `aReady` and `bReady` are true, read both private data sets, set starters, and transition to matchup_strats.

**Step 4: Pass handleDraftSubmit to CourtBoard**

Add `onDraftSubmit` prop to CourtBoard, wire it up in the BlindPickPhase component.

**Step 5: Verify and commit**

```bash
git add src/components/PvpGame.jsx src/components/game/CourtBoard.jsx
git commit -m "feat: PvP blind pick — simultaneous hidden lineup selection with Firebase sync"
```

---

### Task 6: Draft Phase Redesign — Tutorial Mode

**Files:**
- Modify: `src/components/TutorialGame.jsx` — update AI draft logic for blind pick
- Modify: `src/game/tutorialData.js` — draft tooltips already updated

**Step 1: Update TutorialGame AI draft**

In `TutorialGame.jsx`, the AI currently uses the snake draft pattern. Change to:

When `game.phase === 'draft'`, the tutorial should:
1. Let the player select their 5 (same BlindPickPhase UI)
2. On submit, AI picks its 5 using `aiDraftPick` called 5 times
3. Reveal both lineups and transition to matchup_strats

Remove the old snake-draft AI logic that checked `SNAKE[step]`.

**Step 2: Verify and commit**

```bash
git add src/components/TutorialGame.jsx
git commit -m "feat: tutorial mode uses blind pick draft"
```

---

### Task 7: Update All Rules/Help Content

**Files:**
- Modify: `src/components/HowToPlay.jsx` — draft section, assist section, rebound section
- Modify: `src/game/strats.js` — no changes needed (card descriptions don't reference draft)

**Step 1: Update Draft section in HowToPlay**

Replace the snake draft content:

```jsx
<p>Each section starts with <strong>Lineup Selection</strong>. Both teams simultaneously choose 5 starters from their roster — picks are hidden until both submit.</p>
<p>You won't see your opponent's lineup until both are locked in, so think about what they might play. Manage fatigue by resting tired players on the bench.</p>
```

Remove the snake draft order display (`A → B → B → A...`).

**Step 2: Verify assist/rebound sections already updated**

Confirm the changes from Tasks 1 and 2 are reflected in HowToPlay.

**Step 3: Commit**

```bash
git add src/components/HowToPlay.jsx
git commit -m "docs: update How to Play for blind draft, new assist/rebound costs"
```

---

### Task 8: Integration Testing

**Step 1: Build**

Run: `npx vite build`
Expected: Clean build, no errors.

**Step 2: Test solo mode**

1. Start a solo game
2. Verify draft shows blind pick UI (select 5, submit)
3. Verify AI picks 5 on submit, lineups revealed
4. Play through a section — verify assist costs show 1/3/4
5. Verify no fast break button in rebound bonuses
6. Check analytics panel shows correct tracking

**Step 3: Test PvP mode (localhost)**

1. Open two browser windows
2. Create room, join room
3. Verify both players see blind pick during draft
4. Submit from both — verify lineups reveal
5. Play through scoring, verify new assist costs

**Step 4: Test tutorial mode**

1. Click How to Play → Play Tutorial
2. Verify draft tooltip shows blind pick language
3. Verify AI picks its team on submit

**Step 5: Fix any issues found**

**Step 6: Final commit**

```bash
git add -A
git commit -m "fix: integration fixes for scoring balance and blind draft"
```

---

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/game/engine.js` | Modify | Assist costs (1/3/4), rebound paint cost (3), remove fast break, draft state |
| `src/game/canPlay.js` | Verify | Confirm no draft-step dependencies |
| `src/components/game/CourtBoard.jsx` | Modify | Blind pick UI, remove fast break buttons, update assist labels |
| `src/components/PvpGame.jsx` | Modify | PvP blind pick sync via Firebase private data |
| `src/components/TutorialGame.jsx` | Modify | Tutorial draft uses blind pick + AI |
| `src/components/HowToPlay.jsx` | Modify | Update rules for blind draft, new costs |
| `src/game/tutorialData.js` | Already done | Draft tooltips already updated |
