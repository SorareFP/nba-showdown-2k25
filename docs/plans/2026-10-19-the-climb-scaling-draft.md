# The Climb, piece 2: how a deck scales (DRAFT for the user)

## The user's answers (2026-10-19) and what is built

- **Run-long things are relics, not cards:** "run-based things would have to
  be similar to relics dropped by rivalries and bosses, while quarter-long
  things (like negate all fatigue this game, +X power this game, etc.) that
  are drawn during the game are what we're looking for." So family 1 became
  **perks** (src/game/modes/climbPerks.js): a Rivalry win offers one of three
  or none; a boss will when acts follow it. Built: Gym Rat, Extra Reps,
  Signature Move (as +1 3PT Bonus), Film Study (practise a card now); no
  number on a player moves more than 3.
- **Cards last a game.** Chemistry is built (strats.js `climbOnly`), offered
  from the reward's "anywhere" slot 35% of the time while it is not in the
  deck. Families 2-4 are the pool for more, in that spirit.
- **The playbooks are the characters:** "the starting decks being similar to
  the different characters in Slay, and the way they get specific cards to
  them. Assists and rebounds being like strength/weak in slay, and then some
  of the speed/power builds being like the difference between the Ironclad and
  the Silent." No new currencies: "I do not really want to get into the added
  currency types like with The Regent." So the next Climb-only cards should
  lean to a playbook, each its own.
- The four "+" drafts below the kits were approved ("Perfect") and are built.

2026-10-19. The user: "start to use inspiration from StS II about how decks
might be able to scale and how to pull those strings with Climb-only cards."
Nothing here is built. Every card below is a draft for the strategy card
approval rule; the numbers are starting values the simulated runs would set.

## What Slay the Spire scales with

Slay the Spire 1:

- **Powers.** Played once, they stay for the rest of the fight and often grow
  each turn (Demon Form, Noxious Fumes, Footwork). The earlier you play them,
  the more they pay.
- **Cards that grow for the whole run.** Ritual Dagger gains damage when it
  kills; Genetic Algorithm gains block every time it is played; Feed raises
  max HP. A run builds one monster card.
- **Counters and payoffs.** Many small cards build a count, and one card cashes
  it: shivs and Accuracy, poison and Catalyst, Strength and Heavy Blade.
- **Engines.** Draw and energy turn a thin deck into one that plays itself.
- **Thinning.** Removing cards makes the good ones come round more often.

What Slay the Spire 2 adds (early access since March 2026; the details come from
guides and wikis and may move):

- **Enchantments.** A permanent modifier on one copy of a card, given by an
  event, a relic or a shop. Most carry a cost; Corrupted adds 50% damage and
  costs HP when played ([PCGamesN](https://www.pcgamesn.com/slay-the-spire-2/enchantments),
  [Mobalytics](https://mobalytics.gg/slay-the-spire-2/guides/enchantments)).
- **The Regent's Stars and Forge.** A second resource next to energy, and Forge,
  which stacks onto one blade card until it is a run-defining weapon
  ([character guide](https://rogueliker.com/slay-the-spire-2-character-guide)).
- **The Necrobinder's Osty and Doom.** A companion that fights beside you, and
  Doom, a debuff that executes an enemy once it reaches their HP.
- **Ancients.** At the start of each act an Ancient offers a choice (Neow is
  Act 1), some of them "Wax" relics that melt after three fights
  ([PCGamesN](https://www.pcgamesn.com/slay-the-spire-2/ancients)).

## What this game already has in the same seats

| Slay the Spire | NBA Showdown |
|---|---|
| HP | fatigue (the Climb already uses it as health) |
| Energy, Stars | Assists and Rebounds: two banks you earn and spend |
| Strength / Weak on one fighter | hot and cold markers on one player (+2 / −2 a roll) |
| Powers | the stay-in-play identity cards: Run the Floor, Twin Towers, Defensive Identity (`g.standing`) |
| Upgrades, enchantments on one copy | "+" copies (`id+` in the run's deck): per-copy is already built |
| Elite and boss phases | Crunch Time, Clutch Possessions, the timeout |

The difference that shapes everything: **a Climb game is one quarter, three
sections.** A power played in section 1 pays three times at most, so in-game
scaling has to be steep or it will not matter. The long lever is the run itself,
about eight games.

## Four families of Climb-only cards

Climb-only means never in packs, the market, the collection or Free Agents:
offered only as rewards inside a run, and never in a coach's deck.

### 1. Build a player (Ritual Dagger, Forge, Feed)

One player on your team becomes the run's monster card. It fits the game's
pillar that players are good at different things: you are not making everyone
better, you are making *him* the one.

| Card | Text | Engine |
|---|---|---|
| **Gym Rat** | Choose one of your players: +1 Power for the rest of the run (up to +3 on a player). Once per game. | M: a run-level boost on the player, applied when the game is set up |
| **Extra Reps** | Choose a player who made a shot check this game: his Shot Line improves by 1 for the rest of the run (up to 3). | M: the same boost, on the Shot Line |
| **Signature Move** | Choose a player with a 3PT Bonus: 3PT Shot Check at +0. Hit: every Signature Move is +1 for the rest of the run (up to +5). | M: a run-level counter on the card |
| **Film Study** | Upgrade another card in your deck to its "+" for the rest of the run. Film Study then leaves your deck. (The brainstorm's idea: Practice in a card.) | S: the Rest Day's practice, from a card |

### 2. Team identity (Powers)

Stays in play for the game, like Twin Towers, and grows each section, so the
real decision is how early you can afford to play it.

| Card | Text | Engine |
|---|---|---|
| **Chemistry** | Stays in play this game: each screen card you play (High Screen & Roll, Spain Pick & Roll, Ghost Screen, Pin-Down Screen…) gives your next scoring roll +1 more than the last: +1, then +2, then +3. | S-M: a standing entry and a counter |
| **Momentum** | Stays in play this game: your first scoring roll each section is +1, then +2, then +3. | S |
| **Lockdown** | Stays in play this game: each opposing shot check you hold to a miss makes their next one −1 more (−1, −2, −3), until they hit. | S-M |

Chemistry is the one I'd build first: it pays off the switching cards, which
the user wants more of, and every kit already carries High Screen & Roll ×2.

### 3. Bank engines (Stars, Souls)

Assists and Rebounds are already the game's second resources. These make the
banks the engine.

| Card | Text | Engine |
|---|---|---|
| **Ball Movement** | Stays in play this game: whenever your team gains Assists, it gains 1 more. | M: one choke point for gaining Assists (today they are added in many places) |
| **Extra Possession** | Spend 3 Assists: draw 2 cards. | S |
| **Glass Eaters** | Stays in play this game: the glass bonus (a rebound lead of 3+) is +3 instead of +2 and works on every paint check, not once a section. | S |

### 4. Counters and payoffs (shivs and Accuracy, Doom)

| Card | Text | Engine |
|---|---|---|
| **On Fire** | Stays in play this game: a player who makes three shot checks in a row is On Fire. His shot checks are +3 until he misses. (NBA Jam's; Ice the Hot Hand would put it out, with one line added to that card.) | S-M: a make-streak counter per player |
| **Splash** | 3PT Shot Check: +1 for each three your team has made this game (up to +4). | S: the game already counts threes made |
| **Attack the Rim** (Doom) | A player with a Speed or Power advantage draws a foul on his defender. A defender with five fouls fouls out for the game. | L: fouls are a new system; Drive the Lane, And One!!! and Unethical Hoops could draw fouls too |

"On Fire" takes the brainstorm's old "Heat Check" idea; that name belongs to a
real card now.

## Later, with the shop and events (piece 3)

- **Tendencies** (enchantments). A permanent mark on one copy, from an event or
  bought in the Front Office, usually with a cost: *Clutch* (+2 in Crunch Time,
  −1 before it), *Quick Release* (draw a card when played, its bonus −1),
  *Signature* (+2, but the coach answers it first if it can). They ride on the
  per-copy model "+" already uses.
- **Ancients.** Training Camp at the start of each act (Acts 2 and 3 are piece 4)
  with bigger boons and real downsides, and "wax" perks that melt after three
  games: *Hot Streak* (+1 to every shot check for the next three games).

## Guardrails

- Caps on anything that grows for the run (+3 on a player's number, +5 on a
  card), and "once per game" where it is played on a player, so the growth is
  earned one win at a time.
- Every new card gets an answer (counter-coverage): Ice the Hot Hand would
  answer On Fire, Go Under and Veer Switch cancel the screens Chemistry counts.
- The boss stays a wall. Simulated runs with the drafter taking these cards
  set the numbers before anyone plays.
- Climb-only cards need faces: a distinct mark (like the crunch stamp) says
  "run only" at a glance.

## The question for the user

Which family to build first. My suggestion is family 1 (Gym Rat, Extra Reps,
Signature Move, Film Study) and Chemistry: they give the "my run is turning into something"
feeling with the least new engine.
