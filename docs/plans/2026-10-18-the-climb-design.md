# The Climb — design (piece 1: the core loop)

2026-10-18. The user: "a Slay the Spire 2 type roguelike deck-builder game mode
where there is a NBA Jam-like team ladder, and beating teams gives you card
rewards of players and strats." Decided over the 2026-10-18 brainstorm; the
whole mode splits into four pieces, each its own spec and plan:

1. **The core loop (this spec):** start, Training Camp, one act, short games,
   rewards, fatigue as health, Rest Day (rest or practice), the pot, retire
   or lose, the server ledger. Upgrades for the starter-kit cards.
2. Run-only cards: scaling cards (Gym Rat, Heat Check, Chemistry, Film Study,
   tag synergies), "+" upgrades for every other strat, the Film Room.
3. The map's extras: Front Office shop (where cutting a card lives — the user,
   2026-10-18: "cut might be good for shops"), events, Front Office perks (relics),
   Neow's risky deals, the coin continue (one per run, price rising with the
   floor, no healing, payout cut by its cost).
4. The full climb: Acts 2 and 3 with their bosses, the three game lengths
   (quarter / half / full, everything tuned per section, picks per win scaled
   by length), difficulty rungs above the first act, stronger openings after a
   good run.

## Decisions (the user's)

- **Players are bring-your-own; strats and reward players are run-only.**
- **Start small:** five owned players under a low starting cap; rewards fill
  the bench and the cap rises as you climb.
- **One loss ends the run** (the coin continue is piece 3).
- **Identity comes from an early choice, like Neow** — Training Camp.
- **A branching map**, StS-style.
- **The pot: coins and milestone packs, kept only if you win or retire early.**
- **Higher-level strategy matters:** skipping a reward is often right; a focused
  deck beats bulk. **Rewards scale higher up the climb.**
- **Practice** (StS calls it smithing; the user named it Practice, 2026-10-19): upgrades, starting with the starter-kit cards.
- Name: **The Climb** ("for now").

## The run

- **Start:** choose the difficulty rung (aiLevels.js, Settler to Deity; it
  sets the coach's play and the pot's pay factor, as in normal games), pick
  five owned players under the **starting run cap, $2,200**, then Training Camp.
- **One act in piece 1:** beating its boss wins the run.
- **The map:** 7 floors and the boss, 3 lanes; each stop links to one or two
  stops on the floor above (no crossing paths). Floor 1 is a Game; the floor
  before the boss is a Rest Day. Stops: Game, Rivalry, Rest Day, Boss. The
  generator guarantees every path from floor 1 to the boss passes at least one
  Rivalry and at least one Rest Day before floor 7 (on top of the fixed one at
  floor 7), and that no path has two Rest Days in a row.
- **Opponents:** a Game is a franchise team from buildAiRoster at the floor's
  cap (about $2,600 at floor 1 rising to about $4,000 at floor 7); a Rivalry is
  the same at +$700. **The boss is a classic team**: one franchise built from
  its Super Season, Throwback and reward cards, at a cap **set per act, not
  from your team**: 20-40% above the team a typical run has by then (the user,
  2026-10-18: "set at each act based on like 20-40% above what a normal run
  through that act will give your team" — after "a boss team at 5500 when you
  start lower might be crazy"). "Typical" is the median team salary at the boss
  across the simulated runs; the boss cap is that times a factor from 1.2 to
  1.4, tuned by the same runs (today's numbers: about $4,000 x 1.3, about
  $5,200). The same bar for everyone, so a run that drafted well meets a fair
  fight and one that coasted meets a wall. The coach's strat deck is fitted to
  its roster (deckFit.js) and grows with the floor: 15 cards at floor 1, 25 for
  the boss. Every number here ($2,200, the floor caps, +$700, the boss factor,
  the pot) is a starting value, set by the simulated runs before the user plays.
- **Tuned 2026-10-18** (scripts/analysis/runClimbSim.js, 400 runs at Prince
  and at King; the coach plays both sides, "you" draft simply). The starting
  caps above won a third of first games, so: the coach's cap by floor is
  **$1,600, 1,650, 1,700, 2,100, 2,200, 2,450, 2,700** (flat while your five
  has no bench: the median team is $2,100 to floor 3, $3,100 at floors 4-5,
  $4,000 at the boss), a Rivalry **+$250**, the boss **$4,800** (1.2 x $4,000,
  the bottom of the user's range), Rivalries drawn at 0.15 (the repair had made
  them a third of the fights). Result: about 80% of Games and 70% of Rivalries
  won, a third of runs reach the boss, which simulated drafters beat 8-18% of
  the time depending on the franchise.
- **Act I eased, 2026-10-19** (the user: "losing in the second or third game
  so often is tough ... in Slay, the early opponents are fairly easy"; the
  coaches carried rares and legendaries no player could have yet). Floors 1-3:
  the coach plays its own kit only (KIT_ONLY_FLOORS). With the sixteen-card
  kits (a crunch card in each, the same day) the caps are **$1,200, 1,250,
  1,350, 2,000, 2,100, 2,350, 2,700**. 300 runs at Prince: floors 1-3 won
  95/93/93% (were 83/71/72), 14% of runs over by floor 3 (46%), floors 4-6
  80-85%, 55% reach the boss (31%), the boss still ~15%.
- **The run grows faster, 2026-10-19** (the user: "the key here is to
  find/allow some more variance and also the ability to really scale a deck.
  Each move up the ladder should feel like a big step"; "I *like* the
  difficulty, it just might be slightly too hard"). The sim now plays the
  coach at its rung (placement samples by rung; it had used Prince's at every
  rung, so Deity read easy: act won 2.3%). Cap +$450 a floor (was $300), rare
  chance 10% to 45% (was 5% to 25%), drops game 50%/10% and rivalry 75%/70%
  player/perk, Climb-only slot 50%. 300 runs: Prince wins the act 23%, Deity
  8.7%; the median team at the boss $4,820 (was $3,990).
- **Skill moves the odds, 2026-10-19** (the user: "1 in 40 isn't crazy, I just
  want to make it so skill improves those odds a ton. When I think of skill in
  that context, I think roster building and deck scaling"). A Rest Day can now
  cut a card (MIN_DECK 7). The sim plays three drafters (drafter=careless |
  plain | careful; scripts/analysis/runClimbSim.js), 300 runs each, act won:

  | | careless | plain | careful | careful, no cutting |
  |---|---|---|---|---|
  | Prince | 13.0% | 23.3% | 23.7% | 20.0% |
  | Deity | 2.0% | 8.7% | 12.7% | 9.0% |
  | Deity, cap step $300 | 0.7% | — | 3.0% | — |

  At Deity careful play wins six times as often as careless (1 in 8 against 1
  in 50); cutting alone is worth +3.7 points. The $450 cap step widens the gap
  rather than flattening it (more room for the right players), so it stays.
- **The rest of the list, 2026-10-19/20** (the user: "keep going down the list"),
  each measured the same way, Deity, 300 runs, act won (one standard error is
  about ±2 points at these rates):

  | | careless | careful |
  |---|---|---|
  | before (the table above) | 2.0% | 12.7% |
  | richer Rivalries (sure perk, two picks) | 4.3% | 11.3% |
  | the same with a tougher Rivalry coach (+$400) | 5.3% | 10.0% |
  | + Splash and On Fire (build-around cards) | 2.7% | 10.7% |
  | + In System | 3.3% | 12.3% |
  | careful choosing its playbook by In System count | — | 9.0% |

  Richer Rivalries narrowed the gap and were not adopted. Scouting the boss
  is information, which the sim does not use, so it is not in the table.
  Splash, On Fire and In System are kept: neither moved the gap beyond the
  noise in the sim, but the sim's careful drafter is a few rules — it never
  builds around Splash or lines a five up for In System — and both reward
  exactly the choices it skips. Picking the playbook by In System count did
  worse than the one Training Camp marks as fitting (the kit's own card
  conditions matter more than +1), so the drafter keeps Training Camp's.
- **A game is one quarter:** it starts at Q4 section 1, so it is three
  sections with crunch time if within CRUNCH_MARGIN and overtime if tied. The
  rest is the normal engine; the coach plays at the run's rung.

## Your team and deck

- **The run cap rises $300 per floor cleared** (about $4,300 by the boss).
  Reward players must fit under the current cap; the roster maxes at 10.
- **Fatigue is health.** Each player's fatigue tracker carries from game to
  game under the normal penalties. Every run game is a fourth quarter, where
  the forced-rest rule is already lifted, so nobody is benched — tired players
  just play worse. **Between games every player recovers a set amount, and a
  bigger win recovers more** (the user, 2026-10-18: "a specific recovery
  amount between games … Maybe win margin helps recover things?"): 8 minutes
  off the tracker, 10 after a win by 10 or more, 12 after a win by 20 or more,
  so a starter who played the whole quarter comes back fresh from a blowout and
  carries 4 minutes from a close one. Starting values, tuned by the simulated
  runs. A player benched during a game already rests on the bench as in any
  game. A Rest Day can clear everyone.
- **The deck:** 15 strats — a shared **core** of about 7 (the switching basics
  every deck carries) plus about 8 **signature** cards of the chosen playbook
  (the commons and uncommons its fitted deck in archetypeDecks.js uses most
  relative to the other two). Normal 7-card hand, normal copy limits.
- **Training Camp,** before the first game:
  1. **Playbook:** speed, paint or defense kit; the one nearest your five's
     archetype (deckFit.js nearestArchetype) is marked "fits your team".
  2. **One boon of three offered at random:** an extra reward pick after each
     of the next 3 games; cut 2 starter cards; +$400 run cap; a random rare
     strat; one free Rest Day to use any time.

## Rewards and the pot

- **After every win:** pick 1 of 3 strats, or skip. From the packable strats,
  two of three leaning to your playbook, one from anywhere. **The rare chance
  climbs by floor** (about 5% at floor 1 to about 25% at floor 7); a Rivalry
  always offers a rare.
- **Players:** after every Rivalry and every second Game win, pick 1 of 3
  players or skip — any player card (owned or not, any set) that fits under
  the current cap, leaning to the best that fits. Run-only.
- **The reward screen shows the deck:** its size and its fit (deckFit.js), so
  what a pick costs is visible. A 15-card deck is seen whole in a one-quarter
  game; past that every card thins the others.
- **The pot:** run games paid nothing per game until 2026-10-19; since then
  each pays a quarter of a game (the user: "pro-rated quarter-length coins ...
  it shouldn't be all-or-nothing"; climbGamePay in coinRewards.js), and the pot
  is banked on top. A Game win adds **30 coins at
  floor 1 rising to 60 at floor 7**, a Rivalry **+70**, the boss **+120 and a
  Booster pack**; all times the rung's pay factor. Winning the act is roughly
  400 coins and a Booster for about an hour.
- **Retire** between stops (never mid-game) to bank the pot and end the run;
  beating the boss banks it. **A loss ends the run and the pot is gone.**
- Lifetime card stats record for owned players as in any game.

## Rest Day and practice

- **A Rest Day offers one of two,** StS's campfire: **Rest** (clear every
  player's fatigue) or **Practice** (upgrade one card in the deck to its "+"
  version). **Cutting a card belongs to the shop** (piece 3); in piece 1 the
  only cut is Training Camp's "cut 2 starter cards" boon.
- **"+" versions** exist in piece 1 for the starter-kit cards (the core and the
  three signature sets, about 25 cards). Each is written for its card — not a
  formula — and **the user approves the batch before it ships** (the strategy
  card approval rule). A reward card outside the kits shows "no upgrade yet"
  until piece 2.
- An upgraded card is the same card with `upgraded: true`; its effect reads the
  flag in the engine, so the coach's simulation of it (choicePreview, the AI)
  is the real thing.
- **Practice upgrades one copy** (the user, 2026-10-18: "It should only be each
  card, not all of one"): a deck with two Close Outs can hold one Close Out and
  one Close Out+.

## How it is built

- **src/game/modes/run.js** — the run's state (rung, cap, floor, map, roster,
  deck, fatigue, pot, status) and pure functions: new run, map generation,
  choose stop, set up a game, record a result into offers, pick or skip,
  rest or practice, retire. Seeded randomness, so tests replay exactly.
- **Engine:** an option to start a game at Q4 section 1 with each player's
  starting fatigue (the tutorial's stageCrunch already starts mid-game).
- **Opponents:** buildAiRoster at the floor's cap; a new classic-team builder.
- **Saving:** `users/{uid}/runs/{id}`, owner-only like solo seasons; one active
  run; resumes on any device as games do.
- **The server ledger** (`users/{uid}/runLedger/{id}`, server-only):
  - a callable registers each run game as it starts;
  - claimGameReward with the run's id records the result and pays nothing per
    game; a loss ends the run;
  - a **bank** callable pays the pot (coins, and a minted Booster for the boss);
  - the server computes the pot from the stops won, their floors and the rung,
    never from the browser's numbers; a game that started and never reported is
    a loss; a pot banks once.
- **Screens,** a new entry under Play: start (rung, your five), Training Camp,
  the map, the game on the existing board, the reward picker (with deck size
  and fit), the Rest Day choice, the run-over / banked summary.

## Testing

- Unit tests (run.js): map rules (floor 1 a Game, Rest Day before the boss,
  every stop reachable, no crossings), the cap ramp, every player offer fits
  the cap, the rare chance by floor, pot math, run states (active, won, lost,
  retired) and their transitions, rest or practice, seeded replay.
- Engine: a game started at Q4 section 1 plays three sections, arms crunch,
  goes to overtime when tied, and carries the given fatigue.
- Server (functions harness): start, claim win, claim loss ends the run, bank
  pays the computed pot once, a never-reported game is a loss, a pot from a
  lost run cannot bank, the browser's numbers are ignored.
- Upgrades: each "+" card has a test of its stronger effect.
- **Simulated runs** (coach against coach, the AI duel harness) to tune the
  floor caps, the boss factor (from the median team at the boss), reward odds
  and the pot before the user plays.
- Deploy: rules (the runs rule) → functions → Pages; a NEWS item.

## Not in this piece

Run-only scaling cards and upgrades beyond the kits (piece 2); the shop,
events, perks, risky deals and the continue (piece 3); Acts 2 and 3, game
lengths, higher rungs' openings (piece 4). Collection rewards beyond the pot.
