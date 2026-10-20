# The Climb: a "+" for every card

**APPROVED AND BUILT 2026-10-20** (the user: "I think you can just push all of
the + cards and I'll let you know if any need buffed/nerfed/reworked"). Two
texts were shortened to fit the face: Coach's Challenge+ and Double Team+. The
seven proposed Climb-only cards below were approved with the Grind cards
("I love 'em, go for all") and BUILT the same day. Second draft follows (the strategy card approval rule). The user: "Can we now move on to adding + versions of every
card in the climb?" Thirty cards already have an approved "+" (the kits and the
four kit additions, docs/plans/2026-10-18-the-climb-upgrades.md). These are the
other **79**: every card a run can offer (no promo; the four legendaries are
never offered) plus the eleven Climb-only cards.

**What changed in this draft (the user, on the first):** "I want all cards to be
rooted in reality, even if they are a little stronger just with how the game
mode works. So double-team where no one is left open is non-sensible ... Things
like defensive identity+ is just a good card. In a game like this where a lot
of the opponents will end up better, those cards having huge buffs (relatively)
can really help the user. That's what we want, without making things WILDLY
OP." So every "+" now has to be something a better-drilled team could really
do — a harder trap still leaves someone open, an and-one is still one point, a
timeout cannot rest a player for a whole section. **✱ marks the 18 rows that
changed** since the first draft (commit 45ca742c), with the reason under the
table.

**The rule:** a "+" is clearly worth a Rest Day — about half again to double
the card's main number, or the card plus one rider: an Assist, a card drawn, a
cheaper cost, a looser condition, a smaller drawback, **Innate** (it starts the
game in your hand), or **Run It Back** (after you play it, it is shuffled back
into your deck, so you can draw it again this game). Changes are in **bold**.

## Slay the Spire 2's levers, and what they become here

Read from the Slay the Spire 2 card lists (the official wiki's
"Slay_the_Spire_2:Cards_List", Spire Codex, slaythespire2.gg):

- **Powers** — played once, they stay for the fight and pay on a trigger:
  Feel No Pain ("Whenever a card is Exhausted, gain 3 Block"; + 4), Serpent
  Form ("Whenever you play a card, deal 4 damage to a random enemy"; + 6),
  Black Hole ("Whenever you spend or gain a Star, deal 3 damage to ALL
  enemies"; + 4), Child of the Stars ("Whenever you spend Stars, gain 2 Block
  per Star"; + 3). The upgrade raises the payoff by a third to a half.
- **Start-of-turn engines** — Demon Form (+3 Strength a turn; + 4), Noxious
  Fumes (2 Poison to all; + 3), Genesis (2 Stars; + 3), Pale Blue Dot (play 5+
  cards, draw 1 next turn; + 2).
- **Exhaust one-shots** — a big effect that is gone for the fight: Piercing
  Wail, Royal Gamble, Bundle of Joy. The upgrade adds Retain or Innate, or
  takes the Exhaust off (Mirage+).
- **Cards that grow** — Rampage (+5 damage each time it is played; + 10),
  Kingly Punch (grows each time it is drawn), Supermassive (+3 per card made
  this fight).
- **Innate / Retain** as upgrades — Aggression+, Juggling+, Arsenal+ and Big
  Bang+ gain Innate.

**One correction on Exhaust.** Our games never reshuffle: a card played goes to
the discard and cannot come back that game (engine.js drawCards stops at an
empty deck). So "it leaves the deck for this game" is how **every** card
already works. The lever translates three ways instead:

1. **Run It Back** — Exhaust's opposite, a "+" rider: the play goes back into
   the deck and can come again (Slay's Anger / "shuffle into your draw pile").
2. **One-shot (run)** — Exhaust across the run: a big effect, and the card
   leaves your Climb deck after the game (Ice Bath already works this way).
3. **Powers** — the Climb-only cards are already Powers ("Stays in play this
   game"); the new ones below add the "Whenever you…" triggers you asked for.

## New Climb-only cards (proposed with this draft)

| Card | Playbook | Kind | Text | "+" |
|---|---|---|---|---|
| Get Stops | Defense | Power | Stays in play this game: each time you play a defense card, gain 1 Rebound. | …gain **2** Rebounds. |
| Talk on Defense | Defense | Power | Stays in play this game: each time you play a switching card, your defenders get +1 Speed this section. | …**+2** Speed this section. |
| Ball Movement | Speed | Power | Stays in play this game: each time you hit a 3PT Shot Check, gain 1 Assist. | **Innate.** Stays in play this game: each time you hit a 3PT Shot Check, gain 1 Assist. |
| Wear Them Down | Paint | Power | Stays in play this game: each time you hit a Paint Shot Check, the defender on that player has −1 Power for the rest of the game (up to −3 each). | …(up to **−5** each). |
| Film Session | any | Power | Stays in play this game: at the start of each section, draw 1 card. | **Innate.** Stays in play this game: at the start of each section, draw 1 card. |
| Signature Set | any | Grows | A player of yours gets +2 to their scoring roll. After each game you play it, it gives 1 more for the rest of the run (up to +6). | …gives **2** more after each game (up to +6). |
| Leave It All Out There | any | One-shot | Every player of yours gets +3 to their scoring roll this section. After this game it leaves your deck. | …**+4**… |

## Commons (27)

| | Card | Today | "+" |
|---|---|---|---|
| | Anticipate the Pass | Opponent has 6+ assists: spend 1 of your assists to remove 2 from their track. | Opponent has 6+ assists: spend 1 of your assists to remove **4** from their track. |
| | Beat 'Em to the Spot | After an opponent's Speed-boost card: their boost is halved (rounded down), and they suffer −1 Assist. | After an opponent's Speed-boost card: their boost is **cancelled**, and they suffer −1 Assist. |
| ✱ | Clamp the Reserve | An opposing player with salary $400 or less who has not rolled rolls two D20 and keeps the lower this period. | An opposing player with salary $400 or less who has not rolled rolls **three** D20 and keeps the **lowest** this period. |
| | Crash and Kick | Spend 3 Rebounds and 1 Assist: a player of your choice announces a 3PT Shot Check at +2. | …announces a 3PT Shot Check at **+4**. |
| | Crowd Favorite | Player with salary ≤$350: if they score 2+ pts this section, they gain a hot marker. | …they gain **two** hot markers. |
| | Defensive Stopper | A player benched last segment gains +5 Speed and +5 Power on defense this segment. | …gains **+8** Speed and **+8** Power on defense this segment. |
| | Delayed Slip | Speed ≥12 and Power ≥10, no matchup advantage: +2 to scoring roll and +1 Rebound. | …**+4** to scoring roll and +1 Rebound. |
| | Denial | Discard a card. Opponent announces a shot check: they lose 2 Assists — fewer than 2, the check is at −3 instead. | **No discard.** Opponent announces a shot check: they lose 2 Assists — fewer than 2, the check is at −3 instead. |
| | Energizer | Player with salary below $250: +3 Speed and +3 Power on defense this period. | …**+5** Speed and **+5** Power on defense this period. |
| | Energy Injection | Two players with salary <$400 each get +2 to their scoring roll. If either scores 4+: +1 assist. | …each get **+4** to their scoring roll. If either scores 4+: +1 assist. |
| ✱ | Extra Pass | Spend 2 Assists: any player announces a 3PT or Paint Shot Check. No card bonuses apply. | Spend 2 Assists: any player announces a 3PT or Paint Shot Check. No card bonuses apply. **Run It Back.** |
| ✱ | Find the Open Teammate *(was a second "Extra Pass")* | Opponent has a Double Team on the floor: a player they are NOT trapping gets +4 to their scoring roll. | …gets **+6** to their scoring roll. |
| | Feeling It | One of your players has a hot marker: draw 2 strategy cards. | …draw **3** strategy cards. |
| ✱ | Fight Over | Cancel opponent's screen-and-roll card. The faster of the two offensive players gets +2 to their scoring roll. | Cancel opponent's screen-and-roll card. The faster of the two offensive players gets **+1** to their scoring roll. |
| | From Way Downtown | 3PT Shot Check at +1. Roll 1–3: cold marker. Roll 18–20: hot marker. | 3PT Shot Check at **+3**. Roll 1–3: cold marker. Roll 18–20: hot marker. |
| | Grab and Go | Spend 3 Rebounds: +2 Assists. | Spend 3 Rebounds: **+3** Assists. |
| | Hammer Set | A player WITHOUT a 3PT Bonus who holds a Speed advantage announces a 3PT Shot Check at normal difficulty. Hit: +2 Assists. | …announces a 3PT Shot Check at **+3**. Hit: +2 Assists. |
| | Hustle Play | An opponent above $800 announces a shot check: a player of yours under $400 contests it, subtracting their Defensive Bonus. | …contests it, subtracting their Defensive Bonus **and 2 more**. |
| ✱ | Iso-Heavy Offense | One player takes over: +3 to their scoring roll this period. Every teammate rolls at −2. | One player takes over: **+5** to their scoring roll this period. Every teammate rolls at −2. |
| | Mismatch Hunter | A player with a Speed or Power advantage of +4 or more: their scoring roll gains an additional +2. | …their scoring roll gains an additional **+4**. |
| | Offensive Foul | After an opponent's Power-boost card: their boost is halved (rounded down), and they suffer −1 Rebound. | After an opponent's Power-boost card: their boost is **cancelled**, and they suffer −1 Rebound. |
| | Pick-and-Pop | Spend 2 Assists: a player with a 3PT Bonus announces a 3PT Shot Check at +1. Hit: gain 2 Assists back. | …announces a 3PT Shot Check at **+3**. Hit: gain 2 Assists back. |
| | Rebound Tap-Out | Spend 2 rebounds: +1 assist to a player with a 3PT Bonus, who makes a 3PT Shot Check at +1. | …who makes a 3PT Shot Check at **+3**. |
| ✱ | Second Wind | A fatigued player ignores their fatigue penalty this segment (+4 minutes on their tracker after). | A fatigued player ignores their fatigue penalty this segment (**+2** minutes on their tracker after). |
| | Turnover | Opponent has a cold marker: draw 2 strategy cards. | Opponent has a cold marker: draw **3** strategy cards. |
| ✱ | Unsung Hero | A player with salary $400 or less who has not rolled rolls two D20 and keeps the higher this period. | A player with salary $400 or less who has not rolled rolls **three** D20 and keeps the **highest** this period. |
| | Verticality | An opponent card just scored with no roll or check: if your defender has a Defensive Bonus or matches their Power, the points are wiped. | …the points are wiped, **and you gain 1 Rebound**. |

## Uncommons (27)

| | Card | Today | "+" |
|---|---|---|---|
| ✱ | And One!!! | Speed or Power advantage ≥3: +1 pt. Advantage ≥5: also a free throw check. 🔒 | Speed or Power advantage **≥2**: +1 pt. Advantage **≥4**: also a free throw check. 🔒 |
| | Blitz | Opponent announces a 3PT or Paint check: the offense must give it to another player on the floor, with the same card bonus. | …the offense must give it to another player on the floor, with the card bonus **less 2**. |
| ✱ | Blow-By | Speed 13+ and a hot marker: +2 pts and another hot marker. | Speed **12+** and a hot marker: +2 pts and another hot marker. |
| | Burst of Momentum | Top tier AND 3+ pts this segment: +1 AST, +1 REB, and a hot marker. Once per player per section. | …**+2** AST, **+2** REB, and a hot marker. Once per player per section. |
| | Chip on the Shoulder | Salary ≤$250: +3 Speed and +3 Power this segment. A positive roll bonus now: draw a card. | Salary ≤$250: **+5** Speed and **+5** Power this segment. A positive roll bonus now: draw a card. |
| ✱ | Coach's Challenge | Re-roll any opponent shot check; they must accept the new result. 2 per game per team. | Re-roll any opponent shot check; they must accept the new result. **An overturned make does not use up the challenge.** 2 per game per team. |
| | Cross-Court Dime | Spend 3 assists: a player skips their roll for one Paint and one 3PT Shot Check. | Spend **2** assists: a player skips their roll for one Paint and one 3PT Shot Check. |
| | Defensive Anchor | A defender's Defensive Bonus counts double this section, against their player and on every check they contest. | …on every check they contest, **and draw a card**. |
| ✱ | Double Team | Their defender gets +6 Speed/+6 Power this segment; but your opponent gets +3 on the next roll they choose. Once per section. | Their defender gets +6 Speed/+6 Power this segment; **your rotation recovers, so the open player gets +1, not +3**. Once per section. |
| | Elevator Doors | A player with a 3PT Bonus attempts a 3PT Shot Check at an additional +3. | …at an additional **+5**. |
| | Five-Out Offense | A player with a 3PT Bonus who has not rolled takes two 3PT Shot Checks at +1 instead of their roll. | …takes two 3PT Shot Checks at **+3** instead of their roll. |
| | Flare Screen | A player rolled a natural 20: a 3PT Shot Check. Success: +3 pts and draw a card. | A player rolled a natural **19 or** 20: a 3PT Shot Check. Success: +3 pts and draw a card. |
| | Foul Trouble | An opposing defender your player beats by 4+ on Speed or Power sits the whole next section. | …beats by **3**+ on Speed or Power sits the whole next section. |
| | Green Light | Three 3PT Shot Checks instead of the player's roll. Once per player per section. | Three 3PT Shot Checks **at +2 each** instead of the player's roll. Once per player per section. |
| | Heat Check | Top tier: a 3PT Shot Check at −2. Success: +3 pts and a hot marker. 🔒 | Top tier: a 3PT Shot Check at **+1**. Success: +3 pts and a hot marker. 🔒 |
| | Inside-Out | After one of your paint scores: a teammate takes a free 3PT Shot Check. | …a teammate takes a free 3PT Shot Check **at +2**. |
| | Kick-Out Three | After your miss, spend 2 Rebounds: a different player with a 3PT Bonus of +1 or more announces a 3PT Shot Check. | …announces a 3PT Shot Check **at +3**. |
| | Outside Pick | Discard a card: a 3PT Shot Check at +5. Hit: 3 points and +1 Assist. | **No discard:** a 3PT Shot Check at +5. Hit: 3 points and +1 Assist. |
| | Pin-Down Screen | Discard a card: a 3PT Shot Check at +5. Success: 3 pts and an assist to a teammate. | **No discard:** a 3PT Shot Check at +5. Success: 3 pts and an assist to a teammate. |
| | Putback Dunk | Your team leads in rebounds and a player has Power 14+: 2 points automatically. Once per section. | …and a player has Power **12**+: 2 points automatically. Once per section. |
| | Rebound and Push | After an opponent's miss, spend 2 Rebounds: your defender on the shooter announces a Paint Shot Check at +1. | …announces a Paint Shot Check at **+3**. |
| ✱ | Rimshaker | Power 13+ and a hot marker: +2 pts and another hot marker. | Power **12+** and a hot marker: +2 pts and another hot marker. |
| ✱ | Short-Roll Playmaker | Speed 8+ and Power 8+: +1 Assist every time they hit a paint check this period. | Speed 8+ and Power 8+: +1 Assist every time **any of your players** hits a paint check this period. |
| | Stagger Action | One player with Speed 13+ and one with a 3PT Bonus each gain +2 Speed this segment. | …each gain **+4** Speed this segment. |
| | Swarming Defense | The opponent's highest salary, roll a D20: on 11+ they roll twice this period and keep the lower. | …roll a D20: on **6**+ they roll twice this period and keep the lower. |
| | Uncontested Layup | Any player with +2 Speed AND +2 Power over their matchup scores 2 pts. | …scores 2 pts **and +1 Assist**. |
| | You Stand Over There | A player skips their roll for two 3PT Shot Checks. | A player skips their roll for two 3PT Shot Checks **at +2 each**. |

## Rares (14)

| | Card | Today | "+" |
|---|---|---|---|
| | Defensive Identity | Three or more of your players have a Defensive Bonus: all five get +2 Speed and +2 Power on defense this period. | …all five get **+4** Speed and **+4** Power on defense this period. |
| | Desperation Press | CRUNCH TIME, trailing: the next opposing roll in its top tier is re-rolled; the second result stands. | CRUNCH TIME, trailing: the next **two** opposing rolls in their top tier are re-rolled; the second results stand. |
| | Dogged | A fatigued opposing player: −2 Speed and −2 Power until benched for a segment. | A fatigued opposing player: **−3** Speed and **−3** Power until benched for a segment. |
| ✱ | Fresh Legs | During your Timeout: up to two players each shed 4 minutes of fatigue. | During your Timeout: up to **three** players each shed 4 minutes of fatigue. |
| | Ice the Hot Hand | During your Timeout: strip all hot markers from one opposing player. | During your Timeout: strip all hot markers from **two** opposing players. |
| | Lob City | Needs Speed or Power 15+. Discard a card: every Speed 15+ adds an Assist, every Power 15+ scores 2. | Needs Speed or Power 15+. **No discard:** every Speed 15+ adds an Assist, every Power 15+ scores 2. |
| | Own the Glass | Lead the Rebound Track by 6+: spend 5 Rebounds: two Paint Shot Checks at +1. | …two Paint Shot Checks at **+3**. |
| | Pick-and-Roll Maestro | Speed 14+ swaps defenders with a teammate; a new defender 5+ slower: a Paint Shot Check, 2 points and +1 Assist. | …a new defender **3**+ slower: a Paint Shot Check, 2 points and +1 Assist. |
| | Point God | A Speed advantage, before rolling: assists from scoring rolls doubled this period. | …assists from scoring rolls doubled this period, **and draw a card**. |
| | Post Domination | A Power advantage, before rolling: rebounds from scoring rolls doubled this period. | …rebounds from scoring rolls doubled this period, **and draw a card**. |
| | Reset | During your Timeout: clear all cold markers from one of your players. | …clear all cold markers from one of your players, **and they gain a hot marker**. |
| | Stretch Five | A C or PF with a 3PT line of 14 or lower takes a 3PT Shot Check; then a teammate takes a Paint Shot Check at +2. | …then a teammate takes a Paint Shot Check at **+4**. |
| ✱ | Switch Everything | Choose who guards each opposing player. All opponent offensive advantages are doubled. 🔒 | Choose who guards each opposing player. **Opponent advantages grow by half (rounded down), not double.** 🔒 |
| | Three-Point Barrage | Three or more of your players have a 3PT Bonus: each takes a 3PT Shot Check. You may spend 1 Assist for one more. | …each takes a 3PT Shot Check **at +2**. You may spend 1 Assist for one more. |

## Climb-only (11)

| | Card | Today | "+" |
|---|---|---|---|
| | Bruise Crew | This game: your Paint Shot Checks are +1. | This game: your Paint Shot Checks are **+2**. |
| ✱ | Chemistry | This game: each screen card gives your next scoring roll +1 more than the last: +1, then +2, then +3. | **Innate.** This game: each screen card gives your next scoring roll +1 more than the last: +1, then +2, then +3. |
| ✱ | Conditioning | Your players' fatigue costs them nothing this game. | Your players' fatigue costs them nothing this game **and the next**. |
| | Ice Bath | After this game, your players' fatigue is cleared. Ice Bath then leaves your deck. | After this game, your players' fatigue is cleared. **It stays in your deck.** |
| | Let It Fly | This game: your 3PT Shot Checks are +1. | This game: your 3PT Shot Checks are **+2**. |
| | On Fire | This game: a player who makes three checks in a row is On Fire — +3 until they miss. | This game: a player who makes **two** checks in a row is On Fire — +3 until they miss. |
| | Pace and Space | This game: +1 Speed to every player of yours. | This game: **+2** Speed to every player of yours. |
| | Shut the Door | This game: opposing Paint Shot Checks are −1. | This game: opposing Paint Shot Checks are **−2**. |
| | Splash | This game: your 3PT checks get +1 for every two threes your team has made (up to +3). | This game: your 3PT checks get +1 for **every** three your team has made (up to +3). |
| ✱ | Stay Hot | This game: your players carry their hot markers into the next game (up to 2 each). | …into the next game (up to **3** each). |
| | Weight Room | Choose a player: +3 Power for the rest of this game. | Choose a player: **+5** Power for the rest of this game. |

## Why the ✱ rows changed

| Card | First draft | Now | Why |
|---|---|---|---|
| Clamp the Reserve, Unsung Hero | salary up to $600 | three dice, keep the lowest / highest | $600 is a starter, not a reserve; the card stays about reserves and does more to them. |
| Extra Pass | spend 1 Assist | Run It Back | Ball movement is a habit you go back to; it is the Exhaust lever turned round. |
| Find the Open Teammate | "Extra Pass" | renamed | Two cards printed the same name; "Find the Open Man" would break the they/their rule. |
| Fight Over | the offense gets nothing | the faster attacker gets +1 | Fighting over a screen always leaves the defender a step behind; a better fight cuts it, it cannot erase it. |
| Iso-Heavy Offense | teammates roll as usual | +5 to the star, teammates still −2 | Four players standing still is what an isolation is; a bigger takeover is the realistic upgrade. |
| Second Wind | no cost after | 2 minutes after, not 4 | Pushing through fatigue always costs something; conditioning halves it. |
| And One!!! | +2 pts | the doors open at 2 and 4 | An and-one is one free throw. |
| Blow-By, Rimshaker | +3 pts | Speed / Power 12+ | A drive or a dunk is two points; more players can do it instead. |
| Coach's Challenge | re-roll at −2 | an overturned make keeps the challenge | A review does not make the shot harder; the NBA lets a winning challenge stand. |
| Double Team | nobody left open | the open player +1, not +3 | A trap always leaves someone open; a quick rotation shrinks the shot it gives up. |
| Short-Roll Playmaker | +2 Assists a make | +1 Assist whenever anyone scores in the paint | One basket is one assist; the short roll makes plays for everyone. |
| Fresh Legs | 8 minutes off | three players, 4 minutes each | A timeout cannot rest a player for a whole section. |
| Switch Everything | advantages not doubled | they grow by half | Switching everything always gives up mismatches; a drilled team gives up smaller ones. |
| Chemistry | +2 / +4 / +6 | Innate | Chemistry is there from the tip; doubling every screen bonus was the WILDLY OP end. |
| Conditioning | draw a card | this game and the next | Conditioning carries; a card drawn was an abstraction. |
| Stay Hot | up to 4 markers | up to 3 | Kept on the strong side, short of absurd. |

The strongest that stay, by the user's own measure ("defensive identity+ is
just a good card"): Defensive Identity+ (+4/+4 to all five), Ice Bath+ (stays
in the deck), Defensive Stopper+ (+8/+8), the no-discard family.

## Also on the branch since your last deploy (cards only)

Putback Specialist (a make credits the rebound to the scorer); Bruise Brothers
renamed Bruise Crew; Find the Open Teammate renamed; Second Wind's text now
says its 4 minutes; Point God / Post Domination / On Fire reworded they/their;
First Step and Point God now ask which player; art for the eleven Climb-only
cards and Hack-A-____.

## When approved

Each "+" is built the way the first thirty were: the effect reads `plus` at
the card's door (execCard / canPlay / the AI / the board), the text goes in
strats.js PLUS, the faces export to public/cards/strats-plus/ (the card's own
art with the gold "+"), and the Practice screen offers them. Innate and Run It
Back are new riders to build once (the opening draw and the play path); the
seven new Climb-only cards join CLIMB_GAME_CARDS with art and faces.
