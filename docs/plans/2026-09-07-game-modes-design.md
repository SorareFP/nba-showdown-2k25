# Game modes: Season, Tournament, Dynasty — design

Status: DRAFT, built in the background on 2026-09-07 while the user was away.
Every decision marked **[call]** is mine and reversible; the user's own words
are quoted where they set the rule. Nothing here is pushed.

## What the user asked for (2026-09-07)

- **Tournaments** — "fully PvP tournaments, with variable sizes … a cost to
  enter, which would affect the prize pool of coins given out for wins and for
  winning the tournament."
- **Season** — "play a certain amount of AI teams in the season. You can add
  other human users before you start the season with variable season lengths,
  which affects the amount of coins that you get for winning [and] winning the
  championship."
- **Dynasty** — "multiple seasons on the backs of each other … some sort of
  currency that you need to resign your cards, and there's free agency … only
  one version of each card, but users could enter with their own rosters, and
  then that removes those players from the rest of the player pool. They
  could start a dynasty with a fantasy draft of all cards available in the
  game, though I think I would want that to nerf the amount of coins earned …
  playing with your own cards should be what drives currency income."
- Out of scope, by the user: variable game lengths ("that would alter every
  single card"), AI difficulty tiers ("we would need to build an effective AI
  at a baseline level … first").

## One core, three modes

A **competition** is a set of teams, a set of fixtures, results, and a rule for
what the results are worth. The three modes differ only in how the fixtures
are generated and who plays them:

| | teams | fixtures | who plays a fixture | coins |
|---|---|---|---|---|
| Season | you + AI teams (+ humans before it starts) | round-robin, then a playoff bracket | you vs AI: a normal solo game; AI vs AI: simulated instantly; human vs human: a PvP room | every game pays as today; the title pays a bonus scaled by length |
| Tournament | humans only, 4/8/16 | single-elimination bracket | PvP rooms | entry fees form the pool; wins and the title pay out of it |
| Dynasty | a Season, repeated, with a persistent pool | a Season per year plus an off-season | as Season | as Season, halved when the dynasty began with a fantasy draft |

Pure domain modules under `src/game/modes/` carry all of the rules and are
tested without a browser or Firebase:

- `schedule.js` — round-robin generation (circle method, byes for odd counts,
  balanced home/away across meetings), standings with tiebreaks, playoff
  seeding, the three length presets.
- `bracket.js` — single-elimination brackets for 4/8/16/32, standard seeding
  or random, advancing winners, the champion.
- `prizes.js` — tournament pools and payouts, season title money, the dynasty
  income factor.
- `simulate.js` — a headless AI-vs-AI game, ported from the audit harness, so
  the rest of a season's round resolves the moment your own game ends.
- `aiTeams.js` — franchise-flavoured AI rosters built from the card pool
  within the salary band real teams live in.
- `season.js` — the season state machine: create, next fixture, record,
  advance, playoffs, champion.
- `dynasty.js` — the pool, contracts, free agency, the draft, the rollover.

## Season

**Setup.** Your team (a saved team or the roster in Team Builder), the number
of teams in the league **[call: 4, 6, 8, 10 or 12]**, the length, and any
humans to add before the start (by uid, the way a PvP room is joined by code).
AI teams fill the rest. Each AI team wears a real franchise identity — name,
colours, logo — and its roster prefers that franchise's cards, filled from the
pool within the same salary band Quick Match draws from **[call]**.

**Length.** The user asked for variable lengths that scale the money.
Presets **[call]**:

| preset | each pair meets | 8-team season |
|---|---|---|
| Short | once | 7 games |
| Regular | twice (home and away) | 14 games |
| Long | three times | 21 games |

**Play.** The schedule is rounds; you play your fixture of the current round
as a normal solo game (the Play tab with the rosters handed to it). When it
ends, every other fixture in the round is simulated and the standings update.
A round with a human-vs-human fixture waits for that game to be played in a
PvP room; the round advances when every fixture has a result.

**Standings.** Wins, then head-to-head among the tied, then point
differential, then points for **[call]**.

**Playoffs.** The top half of the league, rounded down to a power of two
**[call: 4 teams in an 8-team league, 2 in a 4-team one]**, single
elimination, one game per round, seeded by standing.

**Coins.** Every game you play pays exactly what a game pays today (completion,
win, daily first win, milestones under the daily cap), through the same
server call, so a season is never a way to farm faster than the sandbox. The
season itself adds, on top, paid once by a server call that reads the season's
recorded results **[call, tunable in prizes.js]**:

| | Short | Regular | Long |
|---|---|---|---|
| Champion | 200 | 400 | 700 |
| Runner-up | 100 | 200 | 350 |
| Made the playoffs | 50 | 100 | 150 |

**Persistence.** `users/{uid}/seasons/{seasonId}` for a signed-in player;
localStorage for a signed-out one (a local season pays no coins, since coins
need an account).

## Tournament

**Setup.** A host creates a tournament: size **[call: 4, 8 or 16]**, entry fee
**[call: 0, 50, 100, 250 or 500 coins]**, seeding random. Players join by
code, paying the fee into the pool on the server. When full, the host starts
it and the bracket is dealt.

**Matches** are PvP rooms. The higher seed creates the room for a match and
the other joins it; both must be online, as PvP is today. When the game ends,
either player reports the result; the server reads the room's final state to
confirm the winner and advances the bracket.

**Pool and payouts** **[call]**: the pool is fee × entrants and is paid out in
full. Half of it goes to the champion. The other half is split equally across
every match win in the bracket, so a first-round win pays a share, a semifinal
winner has earned two, and the champion three plus the half. Rounding
remainders go to the champion. A free tournament pays nothing but pride and
the PvP-win coins a normal game pays.

| entrants | fee | pool | per match win | champion (total) |
|---|---|---|---|---|
| 8 | 100 | 800 | 57 | 400 + 3 × 57 = 571 |
| 16 | 250 | 4,000 | 133 | 2,000 + 4 × 133 = 2,532 |

**Server.** `createTournament`, `joinTournament` (charges the fee), `startTournament`,
`reportTournamentMatch` (verifies, advances, pays). Firestore
`tournaments/{id}`; every coin movement is server-side.

## Dynasty

A dynasty is a sequence of seasons with a persistent world. The user's rules,
and my calls for the gaps he named:

**The pool.** Every player card in the game, one copy each. A human entrant
brings their own roster; those cards leave the pool for everyone else. AI
teams are built from what remains. **The finite pool is the point**: the
draft each off-season is dealt from what is left, so it shrinks over the years
and free agency recycles what teams release **[call]**.

**Fantasy-draft start.** Instead of bringing rosters, every team drafts from
the whole pool in a snake, ten rounds. The user wants this to "nerf the amount
of coins earned": a fantasy-draft dynasty pays **half** the coins per game and
half the title money **[call: 0.5]**.

**Currency.** Two currencies, deliberately separate **[call]**:
- **Coins** are the real economy and keep working as today (game claims).
- **Dynasty Dollars (DD)** exist only inside the dynasty and pay for contracts.
  Each team receives a budget per season: 1,000 DD, plus 25 per regular-season
  win, plus 200 for a title. DD never converts to coins.

**Contracts.** A card on a roster has a contract of 1–3 seasons. Cards brought
into a dynasty arrive on 2-season deals; drafted cards on 3; free agents on
the length offered. A card's cap hit is its printed salary, under the existing
5,500 cap.

**Off-season order**: contracts tick down → expiring cards may be **re-signed**
for 10% of salary per new season, in DD (a 1,200 card for 2 more years costs
240) → unsigned cards enter **free agency** → the **draft** deals the best
remaining pool cards, twice the league size, in reverse standings order → free
agency: any team may sign a free agent for 5% of salary per year, in DD, cap
permitting; AI teams sign to fill their rosters → rosters must be 8–10 cards
and under the cap to start the season.

**Humans.** A dynasty can have several humans; they enter before the first
season like a season's humans. Their own coin income depends on how the
dynasty started, as above.

## What is built, in order

1. Domain modules with tests (all three modes).
2. Season mode end to end: a Modes tab, the setup wizard, standings and
   schedule, playing a fixture through the Play tab, simulated rounds,
   playoffs, the title reward (server call).
3. Tournament: server callables, the lobby, the bracket view, the match flow
   on PvP rooms.
4. Dynasty: the off-season screens on top of Season.

## Open questions for the user

- Should a human-vs-human season fixture have a deadline, and what happens if
  it is never played (forfeit, or simulate it)?
- Tournament seeding: random (built) or by some rating?
- Dynasty: should AI teams also re-sign and bid in free agency against the
  humans, or only fill gaps? Built: they fill gaps.
- Is 0.5 the right nerf for a fantasy-draft dynasty?
