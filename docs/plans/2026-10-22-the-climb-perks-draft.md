# The Climb: new perks, from Slay the Spire's relics

**DRAFT 2026-10-22, for the user's approval.** The user: "As far as perks go,
extra reps makes signature move kind of redundant when they appear at the same
time. Can you look at the Slay the Spire relics and come up with some new
perks?"

Perks are the Climb's relics: they last the run (the user, 2026-10-19: run-long
things "would have to be similar to relics dropped by rivalries and bosses").
Every one below is something a real team does, and names the relic it comes
from. ★ marks my picks for a first batch.

## First, the redundancy

Extra Reps lowers a player's Shot Line by 1, which is +1 on **every** shot
check (threes, paint, free throws). Signature Move is +1 on threes only, so it
is strictly worse whenever both are offered.

- ★ **Signature Move becomes +2 3PT Bonus** (still capped at 3 on the number).
  Now it is a real choice: +1 on everything, or +2 on the one shot your
  shooter takes most.
- ★ **Post Moves (new): +2 Paint Bonus**, Signature Move's twin for a big.
- ★ **One shooting perk an offer.** An offer of three never shows two of
  Extra Reps, Signature Move and Post Moves.

## Perks a Rivalry or a Game can drop

### Build a player (Vajra, Oddly Smooth Stone)
| | Perk | Effect | Relic | Why it is real |
|---|---|---|---|---|
| ★ | Track Work | +1 Speed on a player (cap 3). | Oddly Smooth Stone | Gym Rat's twin: conditioning and first-step work. |
| ★ | Lockdown Drills | +1 Defensive Bonus on a player (cap 3). | Thread and Needle | A player who commits to defense; feeds Defense's In System. |

### Every game (Bag of Preparation, Lantern, Captain's Wheel)
| | Perk | Effect | Relic | Why it is real |
|---|---|---|---|---|
| ★ | Scouting Report | Every game, one more card in your opening hand. | Bag of Preparation | You walk in knowing their sets. |
| | Fast Start | In each game's first section, your scoring rolls are +1. | Lantern | A team that comes out of the locker room ready. |
| ★ | Closers | In Crunch Time, your scoring rolls are +1. | Captain's Wheel | A team that executes late. |
| | Rim Deterrent | Every game, the first opposing Paint check is at −3. | Fossilized Helix | The first one to the rim gets met. |
| | Ball Movement Culture | Every fifth strategy card you play in a game draws a card. | Ink Bottle | A system: one good action leads to the next. |

### Between games (Burning Blood, Dream Catcher, Meat on the Bone)
| | Perk | Effect | Relic | Why it is real |
|---|---|---|---|---|
| ★ | Training Staff | After every win, each tracker comes down 2 more minutes. | Burning Blood | Treatment, recovery, sleep science. |
| ★ | Shootaround | When you Rest at a Rest Day, also practise one card. | Dream Catcher | A light day is still a day of reps. |

### The run's rewards (Question Card, Prayer Wheel, Golden Idol, Wing Boots)
| | Perk | Effect | Relic | Why it is real |
|---|---|---|---|---|
| ★ | Advance Scout | Strategy-card rewards show four cards, not three. | Question Card | More film, more options. |
| | Scouting Network | Every Game win offers a player, not half of them. | Prayer Wheel | A pipeline of available players. |
| | Sponsorship | Every win adds 20% more to the pot. | Golden Idol | A winning team sells. |
| | Travel Day | Three times this run, go to any stop on the next floor, linked or not. | Wing Boots | You set your own schedule. |

## Perks only a boss gives (the act's reward; boss relics, StS 2's Ancients)

Big upside, usually with a real cost, as Slay the Spire's boss relics are.

| | Perk | Effect | Relic | Why it is real |
|---|---|---|---|---|
| ★ | Second Chance | Once this run, a loss is replayed instead of ending the run. The pot stays. | Lizard Tail | A protest upheld; the game is replayed. |
| | Win-Now Trade | +$900 of cap now; from here on, a Rest Day cannot rest (practise or cut only). | Coffee Dripper | You load up and play through the fatigue. |
| | Max Contract | One player +2 Speed and +2 Power; from here on, Games add nothing to the pot (Rivalries and bosses still do). | Ectoplasm | One star eats the budget. |
| | Heavy Minutes | Your scoring rolls are +1; every starter adds a minute each section. | Mark of Pain | Ride the starters. Same idea as the Grind cards. |
| | Short Rotation | Draw one more card each section; play at most two strategy cards a section. | Velvet Choker | A tight playbook, run well. |
| | Front Office Shake-Up | Now: cut two cards from your deck and practise two. | Astrolabe, Empty Cage | A new staff cleans house. |

## Left out on purpose

Gold, shops, potions, curses and orbs have no Climb equivalent (the user: no
new currency types), and relics that only add maximum HP are covered by the
cap growing $450 a stop.

## When approved

Each perk joins climbPerks.js PERKS with its target (a player, a card, or the
team), the readers it needs (presetFor / newGame for game-long effects, the
run for between-game ones), an icon, and a test. Boss perks get their own
pool for continueClimb's reward. How to Play, the Rulebook and a NEWS item
move the same day.
