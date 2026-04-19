# Snake Placement Design

**Date:** 2026-04-19
**Status:** Approved for planning

## Summary

Replace the auto-assignment of starters/matchups after blind pick with an alternating snake placement where each coach reveals their picked players one at a time. Matchup strategy cards remain playable throughout. This unifies placement with the existing `matchup_strats` phase rather than adding a new phase.

## Motivation

Today, after both coaches blind-pick 5 players, the game auto-sets `starters = picks` and `offMatchups = [0,1,2,3,4]`, then drops both coaches into `matchup_strats`. This skips the information-reveal dynamic that makes matchup planning interesting: coaches never get to react to each other's lineup decisions one pick at a time.

The snake placement reintroduces that tension: each coach commits one player, the other responds, etc. Matchup cards stay playable throughout so tactical responses (High Screen & Roll, Defensive Stopper, etc.) can still fire in reaction.

## Game rules (agreed)

1. **Order:** Snake `[A, B, B, A, A, B, B, A, A, B]` — 10 placements total, 5 per team.
2. **Slot:** Auto-filled by placement order. A's 1st pick → `teamA.starters[0]`, B's 1st pick → `teamB.starters[0]`, B's 2nd → `teamB.starters[1]`, A's 2nd → `teamA.starters[1]`, etc.
3. **Visibility:** Opponent only sees a placed player after they hit the court. Unplaced picks stay hidden.
4. **Bench:** The 5 roster players each coach did NOT pick are revealed to both coaches once all 10 are placed.
5. **Matchup cards:** Playable at any time during placement by either coach, independent of placement turn. Cards that target starters operate on whoever is currently placed; if their preconditions can't be met with a partial lineup, the existing `canPlayCard` rules already return an appropriate "no" reason.
6. **Reactions (Go Under / Fight Over / Veer Switch / Overhelp / Burned on the Switch):** Remain open until their effect would be moot (e.g., a known roll). Since no rolls happen during matchup_strats, reactions stay open throughout placement. No new engine logic needed — existing `lastMatchupCard` tracking covers this.
7. **Completion:** When `placementStep === 10`, bench reveals and the classic `matchup_strats` pass-twice flow resumes (matchupTurn='A', matchupPasses=0). Two consecutive passes → scoring.

## Architecture

### Game state additions (public)

```js
{
  phase: 'matchup_strats',            // unchanged — placement happens inside this phase
  placementStep: 0,                    // 0–10; 10 = placement complete
  placementOrder: ['A','B','B','A','A','B','B','A','A','B'],
  bench: null,                         // { A: [playerObj…], B: [playerObj…] } once placementStep === 10
  teamA.starters: [],                  // grows from 0 to 5 during placement
  teamB.starters: [],                  // grows from 0 to 5 during placement
  matchupTurn: 'A',                    // ignored while placementStep < 10
  matchupPasses: 0,                    // reset to 0 on every card play; only relevant after placement
}
```

### Firebase paths

- `rooms/{code}/draftPicks/{role}` — 5 picked player IDs, written during blind-pick submit (already established by the Fix 1 commit).
- `rooms/{code}/private/{role}.draftPool` — full 10-player roster, written at game init (already exists). Used to resolve placed player IDs into full player objects and to compute the bench at step 10.
- `rooms/{code}/game` — public state, written on every placement to sync `placementStep` + `starters`. Never writes private data (preserving the Fix 1 invariant that private data is untouched after init).

### Turn derivation

- `placementStep < 10` → active placer = `placementOrder[placementStep]`
- `placementStep === 10` → active turn = `matchupTurn` (existing pass rotation)
- `getWhoseTurn` updated to account for `placementStep` in matchup_strats.

## UI changes (minimal)

- **Empty starter slots** render using the existing empty matchup row with an "Awaiting pick" placeholder.
- **Active placer's next empty slot** on their side is clickable: opens a popover/modal listing the 5 picks with already-placed ones greyed out. Clicking one places it.
- **Opponent's view** of the active slot: muted "Waiting…" text. No new panel.
- **Phase bar** gains a small `· Placement N/10` indicator next to `Matchup Strategy`. Pass and Lock buttons stay in place, disabled until `placementStep === 10`.
- **Hand panel / strategy cards:** unchanged — remain active throughout.
- **Bench reveal:** data written to state but no visual panel (deferred; nice-to-have).

Only net-new UI element: the "place your next player" popover. Piggybacks on the existing modal pattern used elsewhere (Pin Down Screen, defender selection).

## Data flow for a single placement

1. Active coach clicks a pick from their popover.
2. Client constructs the new public state:
   - Looks up player object in their own `privateData.draftPool`
   - Pushes it to their team's `starters` array
   - Increments `placementStep`
   - If `placementStep === 10`: computes `bench = { A: draftPoolA.filter(not in draftPicksA), B: same for B }` by reading the opponent's private data from Firebase (allowed as a one-shot read, no writes).
3. Calls `writeGameState(code, pubGame)` — single write, no private data touched.
4. Both clients' `onGameState` listeners fire → UI updates. The newly-placed player appears in their slot.

## Changes to existing code

### `src/firebase/pvpGame.js`

- `getWhoseTurn(game)`: when `phase === 'matchup_strats'`, branch on `placementStep`:
  - `< 10` → return role corresponding to `placementOrder[placementStep]`
  - `=== 10` → existing `mapTeamToRole(matchupTurn, hostIs)` logic

### `src/components/PvpGame.jsx`

- `handleDraftSubmit` resolver branch: instead of setting `teamA.starters = myStarters; teamB.starters = oppStarters`, leave starters empty. Set `phase = 'matchup_strats'`, `placementStep = 0`, `placementOrder = ['A','B','B','A','A','B','B','A','A','B']`, `bench = null`. Log message changes to "Lineups locked — begin placement."
- New handler `handlePlacePlayer(playerId)`: writes updated public state with one more player placed. Handles the `placementStep === 10` bench computation.

### `src/components/game/CourtBoard.jsx`

- `MatchupRow` (or a new `PlacementRow` branch): when `placementStep < 10` and the slot would be the active placer's next slot for the active team, render the placement affordance. Otherwise render empty/placed as usual.
- `PhaseBar` for `matchup_strats`: append `· Placement N/10` while `placementStep < 10`. Disable Pass/Lock buttons while `placementStep < 10`.
- New `PlacementPopover` component: lists the 5 picks (from `draftPicks/{myRole}` + `draftPool` lookup), greys placed ones, click to place.

### `src/game/engine.js`

- `newGame`: initialize `placementStep = 10` (so solo mode keeps today's behavior of starting with all 5 placed). PvP path will override to 0 after blind pick.
- Alternative: leave `newGame` as-is and set `placementStep` only in the PvP resolver. This keeps solo mode untouched. Preferred.

### `src/game/canPlay.js`

- No changes. Card preconditions already evaluate against `myT.starters` which naturally handles partial lineups. Cards that require 5 starters will return `no('Need X in lineup')` as before.

## Edge cases and error handling

- **Out-of-turn placement:** UI disables the affordance for the non-active placer. No server-side validation (self-join test mode).
- **Player picks placement but misses their turn:** Not possible; only the active placer sees the placement UI.
- **Concurrent card play during placement:** Multiple cards can stack in rapid succession; each is a separate `writeGameState`. Firebase serializes writes, so race conditions are minimal. If an issue emerges, the existing `lastActionAt` on meta gives us a conflict-detection lever.
- **Placement with fewer than 5 picks somehow:** If `draftPicks` has fewer than 5 entries (shouldn't happen), placement stalls at whatever count is available. We could add a defensive check, but the blind-pick submit UI already enforces `selected.length === 5`.
- **Bench visibility race:** Bench is only populated when step reaches 10. Before that, opponent has no way to see the 5 unpicked players. After 10, both sides see both benches.

## What is explicitly out of scope

- **Tutorial / solo mode changes:** Tutorial still uses snake draft from the original code. This change is PvP-only.
- **Bench UI panel:** Data written to state; no visual element in this pass.
- **Security rules:** Currently anyone can read `draftPicks/{role}`. Production hardening would require security rules; deferred.
- **Animation / reveal transitions:** No animations specced. Just re-renders.

## Open questions (none blocking)

None at design time. Any refinements happen during implementation.
