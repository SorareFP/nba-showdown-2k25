# Snake Placement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the auto-assignment of starters after blind pick with an alternating snake placement (A,B,B,A,A,B,B,A,A,B) where each coach reveals picks one at a time. Matchup strategy cards stay playable throughout. PvP-only; tutorial/solo mode unchanged.

**Architecture:** Placement is integrated into the existing `matchup_strats` phase via a new `placementStep` field (0–10). Turn order during placement is derived from a constant snake array; after step 10, the classic pass-twice flow resumes. No new phase value is introduced.

**Tech Stack:** React 18, Vite, Firebase RTDB. No automated test framework — each task ends with a build check + manual PvP self-join verification.

**Design doc:** See `docs/plans/2026-04-19-snake-placement-design.md` for rules and rationale.

**Key files:**
- `src/firebase/pvpGame.js` — turn logic, init flow
- `src/components/PvpGame.jsx` — draft resolver, new placement handler
- `src/components/game/CourtBoard.jsx` — MatchupRow, PhaseBar, new placement popover
- `src/components/game/CourtBoard.module.css` — styles for placement affordance

---

## Task 1: Add `placementStep` default and snake constant to engine

**Files:**
- Modify: `src/game/engine.js` — `newGame` return object (around line 93–122)

**Step 1: Add placementStep to newGame**

Open `src/game/engine.js`. In the `newGame` return object (currently at line 93–122), add these two fields right after `matchupPasses: 0`:

```js
    placementStep: 10,                    // 10 = all placed (solo default). PvP overrides to 0.
    placementOrder: ['A','B','B','A','A','B','B','A','A','B'],
```

This keeps solo mode working as today (step 10 = placement already complete) while exposing the fields for PvP to override.

**Step 2: Verify build compiles**

Run: `npx vite build`
Expected: `✓ built in Xs` with no errors.

**Step 3: Commit**

```bash
git add src/game/engine.js
git commit -m "feat(engine): add placementStep/placementOrder fields to newGame"
```

---

## Task 2: Update `getWhoseTurn` to respect placementStep

**Files:**
- Modify: `src/firebase/pvpGame.js` lines 71–97 (the `matchup_strats` case)

**Step 1: Update the matchup_strats branch**

Replace the existing `case 'matchup_strats':` block (currently lines 77–79) with:

```js
    case 'matchup_strats': {
      // During snake placement, active placer is driven by placementOrder
      if ((game.placementStep ?? 10) < 10) {
        const order = game.placementOrder || ['A','B','B','A','A','B','B','A','A','B'];
        const activeTeam = order[game.placementStep];
        // Both coaches can play matchup cards at any time, but the "turn" for
        // placement belongs to one coach. Return 'both' so either can act.
        // The placement UI itself gates the pick action to the active team.
        return 'both';
      }
      return mapTeamToRole(game.matchupTurn, game.hostIs);
    }
```

Rationale for returning `'both'` during placement: matchup cards are playable by either coach at any time (per the design). The UI will separately enforce that only the active placer can click the "Place next player" affordance.

**Step 2: Verify build compiles**

Run: `npx vite build`
Expected: clean build.

**Step 3: Commit**

```bash
git add src/firebase/pvpGame.js
git commit -m "feat(pvp): getWhoseTurn returns 'both' during snake placement"
```

---

## Task 3: Rewrite draft resolver to enter placement mode

**Files:**
- Modify: `src/components/PvpGame.jsx` — the `if (oppReady)` resolver branch inside `handleDraftSubmit` (currently around lines 266–322)

**Step 1: Update the resolver branch**

Find the block that starts with `// ── RESOLVER: Both ready` and currently does:

```js
      // Set starters on both teams
      if (myTeamKey === 'A') {
        clone.teamA.starters = myStarters;
        ...
```

Replace the entire block from `// Set starters on both teams` through `clone.log = [...clone.log, { team: null, msg: 'Both lineups locked — Matchup Strategy Phase.' }];` with:

```js
      // Starters start EMPTY — players are placed one at a time via snake order.
      clone.teamA.starters = [];
      clone.teamB.starters = [];

      // Reduce pools to the 5 that each coach did NOT pick (= bench candidates).
      // These are revealed once placement completes (step === 10).
      const myUnpicked = myPool.filter(p => !selectedPlayerIds.includes(p.id));
      const oppUnpicked = oppPool.filter(p => !oppPicks.includes(p.id));
      if (myTeamKey === 'A') {
        clone.draft.aPool = myUnpicked;
        clone.draft.bPool = oppUnpicked;
      } else {
        clone.draft.bPool = myUnpicked;
        clone.draft.aPool = oppUnpicked;
      }

      // Store the ORDERED pick lists for each side so the placement handler
      // knows whose picks are whose.
      clone.draft.aPicks = myTeamKey === 'A' ? selectedPlayerIds : oppPicks;
      clone.draft.bPicks = myTeamKey === 'A' ? oppPicks : selectedPlayerIds;

      clone.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
      clone.phase = 'matchup_strats';
      clone.placementStep = 0;
      clone.placementOrder = ['A','B','B','A','A','B','B','A','A','B'];
      clone.bench = null;
      clone.matchupTurn = 'A';
      clone.matchupPasses = 0;
      clone.log = [...clone.log, { team: null, msg: 'Lineups locked — begin placement.' }];
```

Also delete the old "Clear hot/cold for benched players" `['A','B'].forEach(...)` block that follows — bench clearing now happens at step 10, not here.

**Step 2: Verify build compiles**

Run: `npx vite build`
Expected: clean build.

**Step 3: Commit**

```bash
git add src/components/PvpGame.jsx
git commit -m "feat(pvp): enter placement mode after blind pick (starters start empty)"
```

---

## Task 4: Add `handlePlacePlayer` callback to PvpGame

**Files:**
- Modify: `src/components/PvpGame.jsx` — add new handler after `handleDraftSubmit` (around line 336)

**Step 1: Add the handler**

Insert this callback immediately after the closing of `handleDraftSubmit` (`}, [localGame, publicGame, myTeamKey, myRole, roomCode]);`):

```js
  // ── PvP Snake Placement: place one of my picks into the next open slot ─
  const handlePlacePlayer = useCallback(async (playerId) => {
    const step = publicGame.placementStep ?? 10;
    if (step >= 10) return;
    const order = publicGame.placementOrder || ['A','B','B','A','A','B','B','A','A','B'];
    const activeTeam = order[step];
    if (activeTeam !== myTeamKey) {
      console.warn('[PLACE] Not your turn to place');
      return;
    }

    // Look up the full player object from my privateData.draftPool
    const player = (privateData?.draftPool || []).find(p => p.id === playerId);
    if (!player) {
      console.error('[PLACE] Player not found in draftPool:', playerId);
      return;
    }

    const clone = JSON.parse(JSON.stringify(localGame));
    const team = activeTeam === 'A' ? clone.teamA : clone.teamB;
    // Guard against double-placement
    if (team.starters.find(p => p.id === playerId)) {
      console.warn('[PLACE] Player already placed:', playerId);
      return;
    }
    team.starters.push(player);
    clone.placementStep = step + 1;
    clone.log = [...clone.log, { team: activeTeam, msg: `${player.name} takes the floor.` }];

    // If placement just completed, compute bench and reset pass counters
    if (clone.placementStep === 10) {
      // Bench = full 10-player pool minus the 5 placed starters, per team.
      // We need each coach's full pool. My own is in privateData.draftPool.
      // Opponent's is at rooms/{code}/private/{oppRole}.draftPool.
      const oppRole = myRole === 'host' ? 'guest' : 'host';
      const oppSnap = await get(ref(rtdb, `rooms/${roomCode}/private/${oppRole}`));
      const oppPrivate = fixFromFirebase(oppSnap.val());
      const oppPool = oppPrivate?.draftPool || [];

      const myPool = privateData?.draftPool || [];
      const myTeamBench = myPool.filter(p => !clone[myTeamKey === 'A' ? 'teamA' : 'teamB'].starters.find(s => s.id === p.id));
      const oppTeamKey = myTeamKey === 'A' ? 'B' : 'A';
      const oppTeamBench = oppPool.filter(p => !clone[oppTeamKey === 'A' ? 'teamA' : 'teamB'].starters.find(s => s.id === p.id));

      clone.bench = {
        [myTeamKey]: myTeamBench,
        [oppTeamKey]: oppTeamBench,
      };
      clone.matchupTurn = 'A';
      clone.matchupPasses = 0;

      // Clear hot/cold for benched players (moved here from draft resolver)
      ['A', 'B'].forEach(k => {
        const t = k === 'A' ? clone.teamA : clone.teamB;
        t.stats.forEach(ps => {
          if (!t.starters.find(p => p.id === ps.id)) {
            ps.hot = 0; ps.cold = 0;
            const m = ps.minutes || 0;
            ps.minutes = m <= 8 ? 0 : Math.max(0, m - 8);
          }
        });
      });

      clone.log = [...clone.log, { team: null, msg: 'All ten on the floor — matchup strategy continues.' }];
    }

    const pubGame = stripPrivateData(clone);
    await writeGameState(roomCode, pubGame);
  }, [localGame, publicGame, privateData, myTeamKey, myRole, roomCode]);
```

**Step 2: Pass the handler to CourtBoard**

Find the `<CourtBoard ... />` JSX (around line 439) and add `onPlacePlayer={handlePlacePlayer}` as a prop:

```jsx
        <CourtBoard
          game={localGame}
          setGame={handleSetGame}
          onRoll={handleRoll}
          onEndSection={handleEndSection}
          onExecCard={handleExecCard}
          onResolve={handleResolve}
          onSpendAssist={handleSpendAssist}
          onSpendRebound={handleSpendRebound}
          onDraftSubmit={handleDraftSubmit}
          onPlacePlayer={handlePlacePlayer}
          pvpMode={true}
          myTeamKey={myTeamKey}
          isMyTurn={isMyTurn}
        />
```

**Step 3: Verify build compiles**

Run: `npx vite build`
Expected: clean build.

**Step 4: Commit**

```bash
git add src/components/PvpGame.jsx
git commit -m "feat(pvp): add handlePlacePlayer callback for snake placement"
```

---

## Task 5: Add placement affordance to MatchupRow

**Files:**
- Modify: `src/components/game/CourtBoard.jsx` — `CourtBoard` main component prop list (line 18), `MatchupRow` (lines 649–676), and the JSX that renders MatchupRows (around lines 51–54)

**Step 1: Add `onPlacePlayer` to the prop chain**

Change the `CourtBoard` signature (line 18):

```js
export default function CourtBoard({ game, setGame, onRoll, onEndSection, onExecCard, onResolve, onSpendAssist, onSpendRebound, onDraftSubmit, onPlacePlayer, pvpMode = false, myTeamKey = null, isMyTurn = true }) {
```

In the MatchupRow invocation (around line 52), pass `onPlacePlayer`:

```jsx
              {[0,1,2,3,4].map(i => (
                <MatchupRow key={i} idx={i} game={game} setGame={setGame}
                  onRoll={onRoll} onExecCard={handleExecCard} onSpendAssist={onSpendAssist} onSpendRebound={onSpendRebound}
                  onPlacePlayer={onPlacePlayer}
                  pvpMode={pvpMode} myTeamKey={myTeamKey} isMyTurn={isMyTurn} />
              ))}
```

**Step 2: Add placement logic to MatchupRow**

Update `MatchupRow` signature (line 649) to accept `onPlacePlayer`:

```js
function MatchupRow({ idx, game, setGame, onRoll, onExecCard, onSpendAssist, onSpendRebound, onPlacePlayer, pvpMode = false, myTeamKey = null, isMyTurn = true }) {
```

Replace the body's early return for empty rows (line 652: `if (!ap||!bp) return <div className={styles.emptyRow}/>;`) with this block:

```js
  // During placement phase, empty slots need special handling
  const step = game.placementStep ?? 10;
  const inPlacement = game.phase === 'matchup_strats' && step < 10;

  if (!ap || !bp) {
    if (!inPlacement) {
      return <div className={styles.emptyRow}/>;
    }
    // Figure out which side is the "next to be placed" given the snake order
    const order = game.placementOrder || ['A','B','B','A','A','B','B','A','A','B'];
    const activeTeam = order[step];
    const aCount = game.teamA.starters.length;
    const bCount = game.teamB.starters.length;
    const isActiveSlotA = activeTeam === 'A' && idx === aCount;
    const isActiveSlotB = activeTeam === 'B' && idx === bCount;

    return (
      <div className={styles.matchupRow}>
        <div className={styles.placementSlot}>
          {ap ? (
            <PlayerSlot player={ap} ps={getPS(game,'A',ap.id)||{}} adv={null}
              fat={getFatigue(game,'A',idx)} result={null} blocked={null}
              teamKey="A" idx={idx} phase={game.phase} game={game}
              defPlayer={null} defSelect={[]} defIdx={0}
              onDefChange={()=>{}} onRoll={()=>{}} pvpDisabled={true} />
          ) : isActiveSlotA && pvpMode && myTeamKey === 'A' ? (
            <PlacementAffordance game={game} teamKey="A" onPlacePlayer={onPlacePlayer} />
          ) : (
            <div className={styles.placementWaiting}>
              {activeTeam === 'A' ? 'Team A is placing…' : 'Awaiting pick'}
            </div>
          )}
        </div>
        <div className={styles.connector}>
          <div className={styles.connLine}/><div className={styles.slotNum}>{idx+1}</div><div className={styles.connLine}/>
        </div>
        <div className={styles.placementSlot}>
          {bp ? (
            <PlayerSlot player={bp} ps={getPS(game,'B',bp.id)||{}} adv={null}
              fat={getFatigue(game,'B',idx)} result={null} blocked={null}
              teamKey="B" idx={idx} phase={game.phase} game={game}
              defPlayer={null} defSelect={[]} defIdx={0}
              onDefChange={()=>{}} onRoll={()=>{}} pvpDisabled={true} />
          ) : isActiveSlotB && pvpMode && myTeamKey === 'B' ? (
            <PlacementAffordance game={game} teamKey="B" onPlacePlayer={onPlacePlayer} />
          ) : (
            <div className={styles.placementWaiting}>
              {activeTeam === 'B' ? 'Team B is placing…' : 'Awaiting pick'}
            </div>
          )}
        </div>
      </div>
    );
  }
```

**Step 3: Add the `PlacementAffordance` component**

Add this new component just below `MatchupRow` (before the `BlindPickPhase` comment marker around line 678):

```js
// ── Placement Affordance ─────────────────────────────────────────────────
// Shown in the active placer's next empty slot during snake placement.
// Reads my picks from game.draft.aPicks / bPicks and shows remaining ones.
function PlacementAffordance({ game, teamKey, onPlacePlayer }) {
  const [open, setOpen] = useState(false);
  const pickIds = teamKey === 'A' ? (game.draft?.aPicks || []) : (game.draft?.bPicks || []);
  const team = teamKey === 'A' ? game.teamA : game.teamB;
  const placedIds = new Set(team.starters.map(p => p.id));
  const pool = teamKey === 'A' ? (game.draft?.aPool || []) : (game.draft?.bPool || []);
  // aPool/bPool at this stage contain the BENCH (5 unpicked). To look up pick
  // details (name etc.) we need the full roster — but since starters is empty
  // and bench has the unpicked, we reconstruct by pulling from the private
  // data's draftPool via game.teamA.roster / teamB.roster which holds all 10.
  const roster = team.roster || [];
  const remaining = pickIds.filter(id => !placedIds.has(id));

  if (remaining.length === 0) return <div className={styles.placementWaiting}>Placed.</div>;

  return (
    <div className={styles.placementAffordance}>
      {!open ? (
        <button className={styles.placementBtn} onClick={() => setOpen(true)}>
          Place next player →
        </button>
      ) : (
        <div className={styles.placementPopover}>
          <div className={styles.placementHeader}>Choose a player:</div>
          {remaining.map(id => {
            const p = roster.find(r => r.id === id);
            if (!p) return null;
            return (
              <button key={id} className={styles.placementOption}
                onClick={() => { setOpen(false); onPlacePlayer(id); }}>
                <span className={styles.placementName}>{p.name}</span>
                <span className={styles.placementStats}>S{p.speed}·P{p.power}·D{p.defBoost||0}</span>
              </button>
            );
          })}
          <button className={styles.placementCancel} onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
```

Note: this reads `team.roster` which is the full 10-player roster (set in `makeTeam`, survives through to matchup_strats via the public game state).

**Step 4: Verify build compiles**

Run: `npx vite build`
Expected: clean build.

**Step 5: Commit**

```bash
git add src/components/game/CourtBoard.jsx
git commit -m "feat(ui): placement affordance + empty-slot handling for snake draft"
```

---

## Task 6: Add CSS for placement UI

**Files:**
- Modify: `src/components/game/CourtBoard.module.css` — append new classes

**Step 1: Append placement styles**

At the end of `src/components/game/CourtBoard.module.css`, append:

```css
/* ── Snake Placement ──────────────────────────────────────────────── */
.placementSlot {
  flex: 1;
  min-height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.placementWaiting {
  color: var(--text-dim);
  font-style: italic;
  font-size: 0.9rem;
  text-align: center;
  padding: 1rem;
  border: 1px dashed var(--border);
  border-radius: 6px;
  width: 100%;
}

.placementAffordance {
  width: 100%;
  position: relative;
}

.placementBtn {
  width: 100%;
  padding: 0.75rem;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.95rem;
}

.placementBtn:hover { opacity: 0.9; }

.placementPopover {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 320px;
  overflow-y: auto;
}

.placementHeader {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--text-dim);
  padding: 0.25rem 0.5rem;
}

.placementOption {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-1);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.placementOption:hover { background: var(--bg-3); }

.placementName { font-weight: 500; }
.placementStats { color: var(--text-dim); font-size: 0.8rem; font-family: monospace; }

.placementCancel {
  background: transparent;
  color: var(--text-dim);
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  font-size: 0.85rem;
  margin-top: 0.25rem;
}
```

**Step 2: Verify build**

Run: `npx vite build`
Expected: clean build.

**Step 3: Commit**

```bash
git add src/components/game/CourtBoard.module.css
git commit -m "style: add CSS for snake placement UI"
```

---

## Task 7: Update PhaseBar to show placement progress

**Files:**
- Modify: `src/components/game/CourtBoard.jsx` — `PhaseBar` matchup_strats branch (around lines 597–613)

**Step 1: Update the matchup_strats PhaseBar branch**

Find the block `if (phase === 'matchup_strats') {` (line 597) and replace it with:

```js
  if (phase === 'matchup_strats') {
    const col = matchupTurn==='A'?'var(--orange)':'var(--blue)';
    const step = game.placementStep ?? 10;
    const inPlacement = step < 10;
    const order = game.placementOrder || ['A','B','B','A','A','B','B','A','A','B'];
    const activeTeam = inPlacement ? order[step] : matchupTurn;
    const activeCol = activeTeam === 'A' ? 'var(--orange)' : 'var(--blue)';

    return (
      <div className={styles.phaseBar}>
        <div className={styles.phaseInfo}>
          <span className={styles.phaseLabel}>
            Q{quarter} · Sec {section}/3 · Matchup Strategy
            {inPlacement && <span> · Placement {step}/10</span>}
            <HelpBtn section="matchup" />
          </span>
          <span className={styles.phaseSub}>
            {inPlacement
              ? 'Place your players (strategy cards also playable)'
              : 'Play a card or pass twice to start scoring'}
          </span>
        </div>
        <div className={styles.phaseCtrls}>
          <span style={{color:activeCol,fontWeight:600}}>Team {activeTeam}</span>
          {!inPlacement && <span className={styles.passCount}>{matchupPasses}/2 passes</span>}
          <button className={styles.passBtn} onClick={pass} disabled={inPlacement || (pvpMode && !isMyTurn)}>Pass →</button>
          <button className={styles.ctaBtn} onClick={lock} disabled={inPlacement || (pvpMode && !isMyTurn)}>Lock → Scoring</button>
        </div>
      </div>
    );
  }
```

**Step 2: Verify build**

Run: `npx vite build`
Expected: clean build.

**Step 3: Commit**

```bash
git add src/components/game/CourtBoard.jsx
git commit -m "feat(ui): PhaseBar shows placement progress; Pass/Lock disabled during placement"
```

---

## Task 8: End-to-end manual verification

**Files:** none modified; this is a test task.

**Step 1: Start dev server**

Run: `npm run dev`
Open: `http://localhost:5173/nba-showdown-2k25/`

**Step 2: Open two browser tabs (self-join test)**

- Tab 1: sign in, create a PvP room, note the room code, select a team, submit
- Tab 2: sign in as same user (self-join), join with that code, select a team, submit
- Host tab: ready up → game initializes

**Step 3: Blind pick in both tabs**

In each tab:
- Select 5 players from the 10-player roster
- Click Submit
- Should see "Waiting for opponent" briefly until both submitted

**Step 4: Verify placement phase starts**

Both tabs should now show:
- `Phase bar: "Matchup Strategy · Placement 0/10"`
- Empty slots on both sides with "Team A is placing…" etc.
- The active tab (Team A by default) sees "Place next player →" in their slot 0 row
- Pass and Lock buttons are disabled/greyed

**Step 5: Walk through the snake**

In tab A:
- Click "Place next player →" → popover lists 5 picks
- Click one → that player appears in slot 0 on Team A's side
- Phase bar now reads `Placement 1/10`, active team flips to B
- Tab A's next affordance disappears (it's B's turn)

In tab B:
- Click "Place next player →" → see B's picks
- Click → appears in slot 0 of B
- `Placement 2/10`, active stays B (snake: B places again)

Continue alternating per `A,B,B,A,A,B,B,A,A,B` until `Placement 10/10`.

**Step 6: Verify placement completes**

After the 10th placement:
- Phase bar: `Matchup Strategy` (no more Placement indicator)
- Pass / Lock buttons enabled
- All 10 players visible on both tabs
- Log shows "All ten on the floor — matchup strategy continues."

**Step 7: Try playing a matchup card during placement**

Restart a fresh PvP game. After blind pick, during placement (e.g., at step 3):
- Both coaches should still be able to click a matchup strategy card in their hand
- `canPlayCard` may return "Need X in lineup" if a card requires 5 starters, which is correct behavior
- High Screen & Roll should work on whatever players are placed

**Step 8: Try to pass/lock during placement**

- Pass button should be greyed/disabled until `Placement 10/10`
- Lock button same

**Step 9: If all pass, commit a final marker**

```bash
git commit --allow-empty -m "test: verified snake placement end-to-end"
```

---

## Task 9: Deploy to GitHub Pages

**Files:** none modified.

**Step 1: Run deploy**

Run: `npm run deploy`
Expected: `Published` at the end.

**Step 2: Push main**

Run: `git push origin main`

**Step 3: Verify on live site**

Hard-refresh the GitHub Pages URL. Start a new PvP game. Confirm placement flow works on production.

---

## Rollback plan

If any task breaks something:

```bash
git log --oneline -5       # find the last good commit
git revert <bad-sha>        # revert the problematic task
```

Each task is a single commit so reverting is safe and granular. If a later task depends on an earlier one, revert in reverse order.

## DRY / YAGNI notes

- **No new phase value** — reused `matchup_strats` rather than adding a `placement` phase.
- **No new engine functions** — `canPlayCard` is untouched; it already evaluates against partial lineups correctly.
- **No bench UI panel** in this plan (deferred until the user asks).
- **No security rules changes** — `draftPicks/{role}` remains world-readable under current rules; fine for pre-alpha.
