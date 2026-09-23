# Rebound cards: ways to spend a surplus on the glass (DRAFT, awaiting approval)

The user, 2026-09-23: "Definitely a few rebound-based strategy cards, ways to leverage surplus rebounding."

**Status:** drafted, NOT built. Every new strategy card is run by the user before it ships.

## The price a rebound now has

Rebounds spend like assists since e825aa9b. 5 REB buys a paint check for any player, the same price as the assist paint check. Over 600 AI games, 7.0 rebound checks a team-game paid 6.4 points, so:

| Currency | Points per unit (measured) |
|---|---|
| 1 REB | about 0.18 |
| 1 AST | about 0.33 |

A card that spends rebounds has to beat the rebound check it replaces. It also costs a card slot, so it should be clearly ahead.

## The cards

**1. Kick-Out Three.** Reaction, offense, uncommon, 2 copies.
> After your player misses a shot check, spend 2 Rebounds: a different player of yours with a 3PT Bonus of +1 or more announces a 3PT Shot Check.

- It is Putback Specialist's three-point twin. That card takes a paint check at +3 by anyone, also for 2 REB after a miss.
- Worth: a +1 to +3 shooter hits about 35-50%, so about 1.2 points for 0.37 points of bank.
- Wiring: `lastCheckMiss` with `claimed`, the same window Putback Specialist and Glass Cleaner use. Whoever claims the miss first gets the board.

**2. Grab and Go.** Scoring, offense, common, 2 copies.
> Spend 3 Rebounds: +2 Assists.

- The plain exchange: the surplus currency buys the scarce one. Assists also buy +1 boosts and 3PT checks, which rebounds cannot.
- Worth: about 0.55 points of bank for about 0.66 in assists. The edge is small and the value is flexibility. It also brings the first-to-5-assists bonus card closer.
- Wiring: bank arithmetic only; analytics `assistsFromCards`.

**3. Rebound and Push.** Reaction, defense, uncommon, 2 copies.
> Right after an opponent misses a shot check, spend 2 Rebounds: your defender on the shooter announces a Paint Shot Check at +1.

- The defensive board becomes a transition bucket, so the defense scores off the miss.
- It competes with Glass Cleaner (+2 REB) for the same miss.
- Worth: about 1.0 point for 0.37 of bank. The shooter is whoever guards the man who missed, so it pays most with a two-way big on the floor.
- Wiring: `lastCheckMiss` (opponent's), `offMatchups[miss.teamKey][miss.playerIdx]` for the guard, as Glass Cleaner reads it; `announceCheck`.

**4. Own the Glass.** Scoring, offense, rare, 1 copy.
> Your team leads the Rebound Track by 6 or more: spend 5 Rebounds: a player of yours announces two Paint Shot Checks at +1.

- This is the card for a dominant front line. The lead is the condition and the bank is the fuel.
- Worth: about 2.2 points for 0.9 of bank, but only when the lead is there.
- Wiring: `announceCheck` with a `then` of one further check, as Bully Ball does. The condition reads the banks (the same differential the track shows).

## What the coach needs

- `REBOUND_COST` in ai.js gains each card's price, so the open rebound check keeps a reserve for the card in hand.
- Values in `evaluateCard` from the numbers above. The duel harness measures each card once built.

## Checks before building

- No condition reads a roll point, so there is nothing to check against the chart bands.
- "3PT Bonus of +1 or more" reads the printed bonus, not Speed or Power, so the effective-numbers rule does not apply.
- Every flag gets a reader (the dead-card rule). Each card has a picker on the board and a refusal in the engine where it takes a chosen player.
- Placeholder art until the Photo Hunt artifact picks them up (COMPOSED_STRATS in photoHunt.mjs).
