# The Climb: Grind cards (minutes for upside)

**APPROVED AND BUILT 2026-10-20** (the user: "I love 'em, go for all"), with
the seven new Climb-only cards from the "+" draft. Built as drafted; Ride Your
Star's star must still be to roll, Signature Set's player too, and Talk on
Defense's switching cards are Switch the Screen, Veer Switch, Switch
Everything, Go Under and Fight Over (strats.js TALK_CARDS).

The user: "Energy and card-draw are also StS mechanics that
really help build and scale decks, but I don't necessary want to add the energy
economy they have. Maybe we could add climb cards that add minutes of fatigue
but have upside."

## Why minutes work as the price

Minutes are already a currency the player watches: the tracker costs −2 on the
roll at 8 minutes, −6 at 12 and −12 at 16, a section played is 4 minutes, and
in a run every tracker carries into the next game (10 minutes come off between
games). So a card that costs minutes is Slay the Spire's "lose HP for power"
(Offering, Bloodletting, Hemokinesis) without an energy bar: cheap on a fresh
bench, expensive on a tired one, and the run remembers.

**The rule for every Grind card:** the minutes land **at the end of the
section** (as Second Wind's do), so the cost never hurts the roll the card is
helping. Each is Climb-only.

## The cards

| Card | Playbook | Text | Why it is real | "+" |
|---|---|---|---|---|
| Up-Tempo | Speed | Draw 2 cards. At the end of this section, each of your starters adds 1 minute. | More possessions is more plays called, and more running. | Draw **3** cards. |
| Ride Your Star | any | Your highest-salary starter gets +4 to their scoring roll this segment. At the end of this section they add 3 minutes. | The coach keeps the best player in; it costs them later. | …they add **2** minutes. |
| Full-Court Press | Defense | Your five get +3 Speed on defense this section. At the end of it, each adds 2 minutes. | A press wins the ball and empties the legs. | …**+4** Speed on defense. |
| Crash Every Board | Paint | Gain 3 Rebounds. At the end of this section, your two highest-Power starters each add 2 minutes. | Sending everyone to the glass is work. | Gain **4** Rebounds. |
| Play Through Contact | Paint | A player with a Power advantage takes a Paint Shot Check at +3. Hit: a hot marker. At the end of this section they add 3 minutes. | Taking the hit to finish wears a big down. | …at **+5**. |
| Two-a-Days | any | Play in the Matchup Phase. After this game, one card in your deck of your choice becomes its "+", and your players carry 4 more minutes into the next game. It then leaves your deck. | Double sessions make a team better and more tired. | …carry **2** more minutes. |

Two-a-Days is the deck-scaling one: a Rest Day's Practice, paid for in fatigue
instead of a stop on the map.

## Still waiting from the "+" draft (not built)

The seven new Climb-only cards proposed with the "+" draft
(docs/plans/2026-10-20-the-climb-plus-every-card.md) are still unapproved: Get
Stops, Talk on Defense, Ball Movement (Innate "+"), Wear Them Down, Film Session
(Innate "+", the card draw one), Signature Set and Leave It All Out There. They
can ship with these or on their own.

## When approved

Each card joins CLIMB_GAME_CARDS' neighbours in strats.js (climbOnly, leaning to
its playbook), with art, a face and a "+" face; the end-of-section minutes reuse
Second Wind's path (a numeric `secondWindPenalty`-style mark read in
endSection); Two-a-Days rides the run result like Ice Bath (resultFromGame →
recordResult) and opens a Practice pick after the game.
