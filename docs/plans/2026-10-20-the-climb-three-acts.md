# The Climb: three acts (piece 4, first half)

**APPROVED AND BUILT 2026-10-20.** The user: "Yes, this is what I want. We
just need to make the payoff for winning worth it. I'm thinking maybe a Super
or Mega Deluxe pack, depending on how hard it is (currently very)." One pot,
as drafted. The final boss pays a **Mega Deluxe**: measured with the careful
drafter over 300 three-act runs, the whole climb is cleared by 2.3% of runs
at Prince and 0.7% at Deity.

| Rung | Act I cleared | Act II cleared | Act III cleared | Median pot at the end |
|---|---|---|---|---|
| Prince | 30.7% (boss 42%) | 6.7% (boss 44%) | 2.3% (boss 50% of 14) | 1,675 coins |
| Deity | 15.3% (boss 28%) | 1.7% (boss 28%) | 0.7% (boss 50% of 4) | 2,614 coins |

The dials are run.js ACT_DIALS and climbMap.js ACT_POT / BOSS_PACKS.

**RE-TUNED 2026-10-21** after sign-and-release (a full roster now signs by
releasing, so payroll keeps climbing with the cap: median $8,400 at the Act II
boss, $11,600 at Act III's, where the opponents had been $6,400 and $8,000; the
full climb had risen to 21.3% at Prince and 6.3% at Deity). A franchise's
current cards top out near $7,000 at nine deep, so **Act III's Games are classic
teams too** (classicGames). Act II: Games $3,900-5,700, Rivalry +$400, boss
$9,600 x9. Act III: Games $8,000-10,300, Rivalry +$500, boss $14,000 x11. Careful
drafter, 250 runs:

| Rung | Act I cleared | Act II cleared | Act III cleared |
|---|---|---|---|
| Prince | 28.8% (boss 46%) | 4.8% (boss 39%) | 2.4% (games 85%, boss 6 of 6) |
| Deity | 11.6% (boss 23%) | 2.0% (boss 45% of 11) | 0.4% (games 75%) |

The Act III boss has too few games to read (7, all won); watch it.

**Set against what you can field** (the user: "As long as this scaling is in
line with the user's ability to scale (not necessarily what they choose, but
what they CAN choose), I'm good with it"). The most a run can field rises
$450 a stop from $2,200 (maxCapAt), and the simulated drafter reaches 93-100%
of it, so it is reachable. Acts II and III are written as shares of it
(gameShare, bossShare), so a change to the cap's growth moves them too:

| | The most you can field | Games | Boss |
|---|---|---|---|
| Act I | $2,200 to $5,350 | 44-56% | 90% |
| Act II | $5,800 to $8,950 | 67-71% | 107% |
| Act III | $9,400 to $12,550 | 85-88% | 112% |

The user, after beating the
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
real decision. *(The user: "Yes, this is what I want.")*

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
- **The bosses' packs:** Act I a Booster (as now), Act II a Rare Deluxe,
  Act III a Mega Deluxe (the user's pick, by how hard the climb measured).

## Under the hood

- The run gains an `act` (1 to 3). The map, the ledger and the bank read it.
  The server prices every act's stops and pays the bosses' packs, so the
  shared climbMap.js, the functions and Pages all deploy. No MAP_VERSION bump
  was needed: Act I draws exactly as before (its ids unprefixed, its stream
  unchanged), and Acts II and III draw from streams of their own.
- A run that has beaten the Act I boss but not banked yet (a won run today)
  is offered "Keep climbing" too.
- How to Play, the Rulebook and a NEWS item move the same day.
