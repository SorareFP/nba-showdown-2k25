# The Climb: three acts (piece 4, first half)

**DRAFT 2026-10-20, for the user's approval.** The user, after beating the
Act I boss and finding only "Bank the pot" and "Give up this run": "the point
of the game is to have 3 acts like Slay the Spire. The options should be 'take
what you've earned and quit,' or 'keep going and adding to the pot.' The game
gets harder and the rewards get bigger as you go up."

This is piece 4 of docs/plans/2026-10-18-the-climb-design.md ("Acts 2 and 3
with their bosses"). Game lengths and the coin continue stay out of it.

## The choice after a boss

Beating the Act I or Act II boss ends on two buttons:

- **Take the pot and stop:** banks everything earned so far (coins and the
  bosses' packs) and ends the run.
- **Keep climbing:** the pot stays on the table and Act II (or III) begins.

Beating the Act III boss completes the climb and banks the pot.
**Retire and bank** stays on the map between stops in every act, as now.

**The gamble (my reading of "keep going and adding to the pot"):** the pot is
one pot. A loss in Act II or III loses all of it, the Act I winnings included,
exactly as a loss in Act I does today. That is what makes "stop or continue" a
real decision. *(Awaiting the user's answer; the alternative is that each boss
locks in part of the pot.)*

## Between acts (Slay the Spire's act break)

- **Fatigue clears:** every tracker starts the new act fresh.
- **The boss's reward:** one of three strategy cards with a rare guaranteed,
  a player (sure, like a Rivalry's), and a perk.
- The run keeps its deck, its players, its perks and its cap (the cap keeps
  rising $450 a floor).

## Harder

- **A new map per act**, the same shape (seven floors and a boss), drawn
  from the run's seed and the act.
- **Opponents step up per act:** Game and Rivalry caps continue from where
  the last act's boss stood. The coach's deck adds more extras, rares
  included, from Act II's first floor.
- **Bosses:** each act's boss is a classic team, bigger and richer than the
  last. The Act III boss is drawn from the strongest classic teams.
  It is scouted from the act's first floor, as now.
- Every number (the act caps, the boss caps, the coach's extras) is set by the
  three-act Climb simulation (runClimbSim) before the user plays, and shown
  to the user before it ships.

## Bigger rewards

- **The pot per win grows by act:** about ×1.5 in Act II and ×2 in Act III,
  the rung's pay on top. The sim sets the exact factors.
- **Rarer cards:** the rare chance keeps climbing past Act I's 45%.
- **The bosses' packs (proposed):** Act I a Booster (as now), Act II two
  Boosters, Act III a Chase pack (its guaranteed legendary player).

## Under the hood

- The run gains an `act` (1 to 3). The map, the ledger and the bank read it.
  The server prices every act's stops and pays the bosses' packs, so the
  shared climbMap.js, the functions and Pages all deploy. A MAP_VERSION bump
  keeps runs already in progress on their own map.
- A run that has beaten the Act I boss but not banked yet (a won run today)
  is offered "Keep climbing" too.
- How to Play, the Rulebook and a NEWS item move the same day.
