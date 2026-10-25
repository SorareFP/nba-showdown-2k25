# The Climb: events and coach styles

**DRAFT 2026-10-25, for the user's approval.** From the variance draft the
user picked two: "Love the first two" (? stops and opponent identities), and
of boss abilities: "Not sure about the third. It's already hard enough, so
maybe we can do that if there's a tradeoff." So every rule below is two-sided:
a strength and a hole, never a plain buff. Nothing ships before the user
approves the list (the strategy-card rule).

## 1. ? stops (events)

A new stop on the map, about one in six on floors 2-6 (fewer Games, the same
Rivalries and Rest Days). Like a Rest Day it is not a game: the server never
hears of it, and it adds nothing to the pot. Each shows a short scene and two
or three choices; the run's seed picks the scene, and a scene comes once a
run.

| Event | Choices |
|---|---|
| **Trade Call** | Swap your lowest-paid player for one of three better ones (the cap must still fit) · Hang up |
| **Locker-Room Dispute** | Your highest-paid player sits the next game · Every starter carries 4 more minutes into it |
| **Film Room** | Upgrade one card · Remove two cards |
| **Two-Way Contract** | Sign a cheap player for free; they leave after three games · Pass |
| **Summer-League Tape** | Take a random rare card, with a dead card (Bad Contract, does nothing) shuffled in · Pass |
| **Injury Scare** | Gamble: half the time a player of yours is out next game, half the time they come back with 2 hot markers · Rest them (they sit the next game, no gamble) |
| **Veteran Minimum** | Sign one of three veterans (the current set's long-career players at the low end of the pay scale), and only half their salary counts against your cap · Pass |
| **Team Meeting** | Clear every tracker · Upgrade one card |
| **Front-Office Leak** | See the next two stops' coach styles and rosters · Take $200 of cap |
| **Hot Streak** | Your two best scorers start the next game with a hot marker each · Your whole five +1 Power next game |
| **Contract Year** | A player of yours gets +1 Speed and +1 Power for the run, but their salary rises $150 |
| **Back-to-Back** | The next game: every starter carries 4 more minutes, and a win pays a perk for sure · Skip it (rest the team, no perk) |

## 2. Coach styles (opponent identities)

Every franchise's coach plays one style, shown on the map stop and in the
game's header before you choose a route. Ten styles, each a strength and a
hole, spread over the thirty franchises. Act I plays them at half strength
(the strength only on a Rivalry).

| Style | Strength | Hole | Franchises |
|---|---|---|---|
| **Seven Seconds** | their rolls +1 in the first section | they tire a minute faster each section | PHX, SAC, IND |
| **Grit and Grind** | your paint checks −1 | their 3PT checks −1 | MEM, MIA, NYK |
| **Splash** | their 3PT checks +1 | their whole team −1 Power *(was: their paint checks −1)* | GSW, BOS, ATL |
| **Bully Ball** | their paint checks +1 | their whole team −1 Speed *(was: their 3PT checks −1)* | CLE, MIN, NOP |
| **Heliocentric** | their highest-paid player's rolls +2 | their other starters' rolls −1 | DAL, LAL, MIL |
| **Bench Mob** | their bench comes in fresh (no carried minutes) | their opening hand is a card short | TOR, SAS, UTA |
| **Closers** | their rolls +1 in Crunch Time | their rolls −1 in the first section | LAC, CHI, DEN |
| **Glass Eaters** | +1 rebound on each of their scoring rolls that scores nothing *(was: every roll)* | their whole team −1 Speed | DET, OKC, POR |
| **Pace and Space** | their whole five +1 Speed | their whole five −1 Power | CHA, HOU, ORL |
| **Process** | they draw a card more each section | their starters −1 on Defensive Bonus | PHI, WAS, BKN |

**As built (2026-10-25):** the sim's by-style tally (400 runs at Prince)
had Glass Eaters winning 63%, Bully Ball 67% and Splash 68% against 76-83%
for the rest: a rebound on every roll was too many, and a hole on a check the
coach seldom takes was no hole. The three rows above carry the retune; every
style then won 75-82% with both halves playing, and Act II's Games came back
to 84.3% (84.7% before styles). Act I's Games play only the hole.

## 3. Boss abilities, only with a trade (the user's condition)

Optional, never forced: at the boss's stop, choose **Full Strength**. The boss
plays its franchise's style at double strength (e.g. the '96 Bulls' Closers:
+2 in Crunch Time, still −1 early) and the boss's reward grows: one more
strategy-card pick and a boss's perk from four instead of three. Decline and
it is today's boss.

## When approved

Events: a map version bump (MAP_VERSION 2, so a run in flight keeps its
map), an event screen, run.js steps for each choice, tests, and the server's
reachability treating ? stops like Rest Days. Styles: engine hooks of the
kind the perks already use (roll bonus by section, check terms, minutes,
draws), the map and header labels, and the sim re-run so Act I stays as hard
as it is now. How to Play, the Rulebook and a NEWS item the same day.
