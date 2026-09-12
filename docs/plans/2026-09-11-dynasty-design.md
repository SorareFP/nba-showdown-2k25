# Dynasty mode: the design (2026-09-11)

This replaces the dynasty section of `2026-09-07-game-modes-design.md`. The domain module built that day (`src/game/modes/dynasty.js`) had no screens. It is rewritten here around the user's spec from today. The user asked me to build it and said they would make tweaks when they got back, so every number below is **my call** unless it is marked **[user]**.

## The shape

- **[user]** A dynasty is **ten seasons**. Finishing all ten pays a coin bonus.
- **[user]** There are two ways to start, and the second one comes in two sizes:
  - **Bring your team.** Use the roster you built from your own cards.
  - **Fantasy draft.** Draft from every card in the base set.
  - **Fantasy draft (random pool).** Draft from a smaller pool that is drawn at random. It holds 15 cards per team and is spread across the salary range, so it keeps both stars and cheap players.
- **[user]** The pool is finite: **one copy of each player**. A player on any roster is out of the pool. Uniqueness is by person, so bringing LeBron's Super Season card takes base LeBron out of the league.
- The league size (4–12) and the season length (short/regular/long) are the same choices Season mode offers. Each year is an ordinary Season: the same Dashboard, the same fixtures played through the Play tab, and the same per-game coins.

## Dynasty Points (DP), the payroll

**[user]** "The salary on the card is gonna determine … how much you can sign a player for. Better players ask for more dynasty points while ten salary cards are just happy to be on the team."

- **A player's fair value** is `salary ÷ 55`, rounded, with a minimum of 1 DP.
  - A $10 card is worth 1 DP.
  - A $560 card (the median) is worth 10 DP.
  - An $1,840 card (the top) is worth 33 DP.
- **The cap is 100 DP** of payroll a season, which is the printed $5,500 cap converted into DP.
  - A contract is **DP per season × years**. It counts against the cap every season it runs.
  - DP is a payroll, not a bank. It never converts to coins, and coins never buy DP.
- **The apron is 115 DP.**
  - Re-signing **your own** expiring players and signing **your own draft picks** may take you over the cap, up to the apron. These are Bird rights: keeping your team together is what a dynasty is.
  - A new free agent must fit under the cap.
  - Exception: a **1-DP minimum deal** can always be signed, up to the apron.
- **Rosters hold 8 to 10 players.** You cannot start a season with fewer than 8.
- **Waiving** a player under contract is allowed in the offseason. His DP stays on your cap for the coming season as dead money, then it is gone.

## Negotiation and personalities

**[user]** "Maybe we randomly assign them personalities … something to make the signing process more intriguing."

Every player in the dynasty is dealt a personality when the dynasty is created, and it never changes. Cards at $150 or less are always **Happy to Be Here**.

| | Personality | What it does |
|---|---|---|
| 🤝 | Loyal | Takes 20% less from the team he last played for. |
| 💍 | Ring Chaser | Takes 25% less from the champion and 12% less from a playoff team. Asks 12% more from a lottery team. |
| 💰 | Mercenary | Asks 15% over his value. He has little give and 2 patience. |
| 🛡️ | Security First | Wants 4 years. Each year short of that adds 12%. |
| 🎲 | Bets on Himself | Wants 1 year. Each year past that adds 12%. |
| 😎 | Easygoing | 5% under value, wide give, 4 patience. |
| 😊 | Happy to Be Here | 1 DP, any length, signs with anyone. |

### How a negotiation goes

1. **He names an ask** for the length you pick. Behind it is a **floor** that you never see.
2. **You make an offer** of DP per season and years.
   - At or over the floor, he signs.
   - Under the floor, he tells you how far apart you are: *close*, *apart*, or *insulted* (under 70% of the floor).
3. **Each rejection** costs patience: 1 point, or 2 if he was insulted.
   - After *close* or *apart*, his ask comes halfway down toward the floor, so a patient negotiator can find it.
   - An insulting offer does not move his ask at all.
4. **When his patience runs out, he stops talking to you** for the rest of that phase.

Neither side rolls any dice. It is all arithmetic on the dealt personality, so reloading the page cannot re-roll a player.

### Spurned, and the AI's room (from the first balance probe)

The first run of an 8-team fantasy draft found a hole. The AI teams signed their whole draft class and finished at 10 of 10 players and 96–100 DP. That left year one's free agency with **zero** AI bids. A human could let every draftee walk and buy them all back in free agency, 20% cheaper by day 3, with nobody to outbid. Two rules close it:

- **Spurned.** A player asks **25% more** from the team that let him go this offseason, whether it renounced his rights or waived him. A Loyal player's discount cancels it out. The new season forgives everyone.
- **The AI keeps room.** A fantasy-drafting AI team drafts to a budget 12 DP under the cap and signs one spot short of a full roster, so it has a spot and the DP to bid with in year one.

## The first year

- **Bring your team.**
  - Your cards arrive on contracts at their fair value, with lengths dealt from 1 to 3 years. That staggering means some of them expire after year one.
  - The AI teams are built from the pool the way Season builds them, and they get staggered contracts too.
  - Year one starts straight away.
- **Fantasy draft.**
  1. **The draft.** Ten rounds in a snake, with a random order. You pick on your turn and the AI picks the rest. While you draft, the screen keeps a running total of what your picks will ask.
  2. **Signing (exclusive).** **[user]** You must spend DP to sign the players you drafted, under the 100 cap. A draftee you do not sign goes into free agency.
  3. **Free agency**, then year one.

## The offseason, in order

1. **The exclusive window.** **[user]** Contracts tick down, and every expiring player talks only to his own team. You negotiate with yours. The AI teams decide theirs on the spot. Anyone unsigned when you close the window goes into free agency.
2. **The lottery.** **[user]** "the worst team having better lottery odds just like real life."
   - Only the teams that missed the playoffs enter. Their odds fall off linearly: in a 4-team lottery the worst team has 40%, then 30%, 20%, 10%.
   - The lottery draws the top picks: half the lottery teams, at most 4. Everyone else picks in reverse order of the standings.
3. **The draft.** **[user]** "a draft that introduces new players outside of the player pool."
   - A draft class is made of **players who have no base card**. These are the special-set players: rookies, Super Seasons, Standouts, Dissonance and so on, with one card per person and his rookie card preferred.
   - There are about 110 such players. They are dealt into 9 classes when the dynasty is created, one class per offseason and up to two per team.
   - Picks go in lottery order. A second round, if the class runs that deep, uses the same order.
4. **Sign your picks.** **[user]** A draft pick signs on a **rookie scale**: 3 years at three-quarters of his fair value. You can sign him up to the apron, or renounce him and send him to free agency.
5. **Free agency.** **[user]** AI teams bid against you (the user's answer on 2026-09-07). It runs in **three days**:
   - Each day the AI teams place offers, and you can see the best rival offer on every player.
   - To sign a player, your offer has to clear his floor and also beat the rival offer. "Beat" means a better deal compared with each team's floor, so a Ring Chaser can take less from a contender.
   - Clicking "Next day" lets every rival offer that is still standing sign. Every unsigned player's floor then drops 10% as the market cools.
   - When free agency closes, the AI teams fill up to 8 with the cheapest players left.
6. **The preseason check.** You need 8 to 10 players. A single button fills you up to 8 with the cheapest free agents. Then the next season starts.

## Coins (the real economy)

- **Games** pay what every game pays. **[user]** The user mentioned "maybe playing a game even gets a small buff". That is not built: it would change the game-reward server path, and the user said "we can figure that out."
- **Each season** pays the Season title money for its length (champion / runner-up / playoffs), claimed once per year through a new callable, `claimDynastyReward`.
- **Finishing all ten years** pays **1,000** coins for a regular-length dynasty (600 short, 1,500 long), **plus 150 for every title** won along the way.
- **The fantasy-start NERF.** **[user]** Fantasy-draft dynasties pay **0.5×** on the title money and on the completion bonus.
  - The user corrected it on 2026-09-11: "I think I said fantasy draft should buff coin output -- I meant nerf." It had shipped as a 1.5× buff for a few hours, never deployed. 0.5 is the 2026-09-07 factor restored. It is one constant (`FANTASY_DYNASTY_FACTOR`).
  - A regular fantasy dynasty with three titles pays 0.5 × (1,000 + 450) = 725 coins on completion, plus 200 for each title year.
  - Why a nerf fits: a fantasy draft hands you any card in the set without owning it; bringing your own team is the collection-earned path.
- **Same trust model as Season.** The dynasty document is written by the client. The server recomputes the payout from that document's own history and refuses a second claim through `claims/dynasty:{id}:{year}`. A player who forges the document can forge a season too. That is accepted, as it was for seasons.

## Storage

- A dynasty is stored at `users/{uid}/dynasties/{id}`. When signed out it falls back to localStorage, as Season does.
- Rosters, contracts and draft classes are all card **keys**, and the live season is dehydrated the way `seasons.js` does it.
- There are no arrays inside arrays, because Firestore refuses them.
- **Deploy needs:** the Firestore rules (one new `match` line), and functions (`claimDynastyReward`).

## Round two: the user's answers (2026-09-11, evening)

The user answered the "not built" list below, then answered four follow-up questions.

1. **Trades.** AI trade logic weighing printed salary, DP salary, years remaining and positional need. The weights will be informed by Bill Simmons' Trade Value rankings (The Ringer): talent, age, contract value, years of control.
2. **Aging is a toggle.**
   - Off: today's ten-year dynasty, where nobody ages.
   - On:
     - **Starting age:** every card has an age on January 1 of its card's year. Base cards take their 2025-26 Basketball-Reference age.
     - **Aging:** everyone gains a year each season. A drafted player starts aging from the year he is drafted.
     - **Price:** asks fall past 31.
     - **Retirement:** the chance rises from 35, and retirement is certain at 40. Retired players never return.
     - **Length:** the dynasty is **open-ended**. The ten-year bonus still pays at ten.
   - **Built:**
     - **Ages.** A player's age is the card's age plus the seasons since he joined the league.
       - The card's age comes from its own `age`, or else from `card-data/generated/dynasty-ages.json`, which `scripts/dynasty/buildAges.mjs` writes: 400 ages, none missing.
       - A player still in the draft pool doesn't age.
     - **Price.** The ask is multiplied by `ageFactor`: 7% off per year past 31, never below 40% of his value.
     - **Retirement.** `retireChance` is 1 in 6 at 35, rising by a sixth a year, and certain at 40.
       - It's rolled at the turn of each year.
       - His contract ends with him, with no dead money.
     - **Ending.** `endDynasty` ends an aging dynasty between seasons.
     - **Claims.** A year's claim is no longer capped at ten.
3. **The draft pool.**
   - **The fantasy draft is 10 rounds; every offseason draft is 2.**
   - Players not taken in the fantasy draft go into the **draft pool, not free agency**.
   - Each offseason, the next 10×teams players in the pool form the class. Undrafted players return to the pool. Retired players never re-enter.
   - Free agency is only for players who have been in the league. My calls:
     - An own-team start therefore opens with an empty free-agent market. A short roster fills with **camp invites**: the cheapest players waiting in the draft pool, on one-year deals.
     - A team may **pass** on an offseason pick. The AI never passes; it renounces a pick it can't fit.
     - The fantasy draft's leftovers are shuffled into the pool. An offseason class's undrafted players go back on the end of the queue.
   - **Built** (probe: day-one AI bids 2/7/10 at 4/8/12 teams; every AI roster ends 10 deep at 89–100 DP; the pool never runs dry at 339–419 players).
4. **Your collection.** No change. Dynasty cards exist only inside the dynasty.
5. **Point-differential coins, for every game.**
   - The win bonus scales with the margin, tuned so the average win still pays about 50.
   - A small consolation is paid for losing by 5 or fewer.
6. **Civ lengths and playoff series.**
   - Season lengths are named Online, Quick, Standard, Epic and Marathon, with coins scaled to the length.
   - **Series length is picked per round at setup** (best-of-1, 3, 5 or 7), in Season mode and in dynasties.
7. **Dynasty with friends:** yes, as a league the way shared seasons are.
8. **The buff size:** later.

**Build order:** 5, 6, 3, 2, 1, 7.

## Round three: trades, picks, max deals, the lottery (2026-09-11, late)

The user's corrections, and what was built from them.

- **Trades use Simmons' logic, not his order.** The user: "don't take the order of Simmons' trade-value rankings and prescribe them to our players … Just use the logic." And: "Because there is no skill incline/decline, a 38-year-old on a 1-year deal is the same as a 23-year-old on a 1-year deal."
  - An age curve fitted to the Ringer's list was built, then **removed before it was committed**.
  - A player's value to a team is made of:
    - **talent**, convex: fair DP^1.4, so a star is worth more than two halves of one;
    - **control**, 0.9× for one season up to 1.2× at four;
    - **the contract**, where each season underpaid adds value and each season overpaid subtracts it;
    - **need** at his position, where the targets are G 4 / F 4 / C 2;
    - **buyers and sellers:** a contender pays for talent now and minds money less, while a rebuilder pays for years and savings;
    - **age only as retirement risk**, in aging dynasties: the share of the deal he's expected to play, which a rebuilder weighs twice.
  - The AI accepts deals it wins by 8% and calls anything within 15% "close".
    - "What would it take?" names the cheapest single player or pick that gets the deal done.
    - Trades happen between seasons. Both rosters must end at ten or fewer, and neither payroll may grow past the apron.
  - AI teams trade with each other up to twice each offseason, when both sides gain. Half of the attempts are the buyer's deal: a contender's pick for a rebuilder's player.
- **Draft picks can be traded.** The user: "More valuable for bad teams?" Yes.
  - Each team owns its 1st and 2nd in the next two drafts.
  - A pick is worth the class player projected at the original team's slot, on a rookie-scale deal.
  - Picks a year further out are worth 0.75×. A rebuilder values a pick at 1.25×, a contender at 0.85×.
  - The owner makes the pick in the original team's slot, shown as "(via BOS)".
- **Max deals.** The user asked for these by DP and by years.
  - A max deal is 35 DP a season (35% of the cap) for up to 5 years. Security First now wants five years.
  - Asks and floors never pass the max, so stars ask for it and the haggling moves to the years.
- **The lottery is the NBA's, scaled down.**
  - The NBA's 14 slots are split into k equal shares, one per lottery team. Two lottery teams get 81.5/18.5, three get 61.5/31.5/7, four get 48/33/15/4, and six get 32.7/28.8/20/11.5/5/2.
  - Picks 1–3 are drawn. A 30-team dynasty isn't offered, since leagues run 4–12 teams.
- **With your own team, the AI fantasy-drafts the rest of the league around your ten** (the user: "the same way as if the user was in the draft too").
  - Each pick is made to a budget: the cap, less the 12 DP kept for free agency, less the cheapest cost of filling the rest of the roster.
  - Among players that fit, the AI takes the one its roster needs by position. The user: "not just grabbing the best player."
  - Then the AI signs its picks and settles free agency among itself.
  - The probe: AI rosters at 83–93 DP, 9–10 players, mostly 4 guards, 4–5 wings and 1–3 bigs.
- **Your own team is ten players, and they come out of the pool.** This was already true, now confirmed.
- **Overtime.** A tie after regulation plays another Crunch-Time section, again if it's still tied, in every game.

## Round four: a dynasty with friends (2026-09-11, night)

The user's four answers, and how each is built:

- **Drafts: "Async, on a clock".** A coach has 12 hours a pick (`PICK_CLOCK_MS`). When it runs out the AI picks for them, and the commissioner can force the pick early. The server keeps no timer [my call]: every move runs the clock on the server's time first, and so does the `tick` a coach's screen sends when it sees a clock at zero. If clocks stall because nobody opens the app, a scheduled tick is the fix.
- **Calendar: "All ready, host can force".** `setReady` / `advancePhase` close a phase for every coach at once. A draft ends by its picks and a season by its games; neither ends by readiness.
- **Free agency: "Sealed bid, but three advanceable 'weeks'".**
  - Each coach's bids live in `leagues/{id}/bids/{uid}`, which only that coach can read (firestore.rules).
  - When the week turns (`nextFaWeek`), every free agent weighs the coaches' bids and the AI's standing offers by his own lights: DP over his floor at that length. The best players choose first.
  - Up to ten bids a week [my call]. The preseason's leftovers are haggled, as they are alone.
- **Trades: "Propose / accept".** An offer waits for the other coach, while AI teams answer as they do alone. The commissioner can strike an open offer, or reverse an accepted trade while every piece is still where it went, in the same phase (`vetoable`).

How it runs:

- **The league.** A league of kind `dynasty` (league.js). Its settings add `startMode`, `series` and `aging`. An own start needs ten players per coach, and no player twice.
- **The start.** `startLeague` builds the dynasty on the server (`createFriendsDynasty`), never in the host's browser. The league's `state` is the packed dynasty (`seasonPack.js`), 23 KB for six teams.
- **The moves.** Every move goes through `dynastyAct` (`FRIEND_MOVES`); a week's sealed bids go through `dynastyBid`.
- **The money.** `settleDynasty` pays every coach each year's money as the year goes in the book, so there is nothing to claim. The completion bonus is paid when the dynasty ends.
- **The season.** It is played through the league, as a shared season is:
  - results go through `reportLeagueResult`;
  - coach-vs-coach games are played in `LeagueMatch` rooms;
  - the commissioner sims the AI games with `simLeagueAi`, now shared with shared seasons.
  - Playoff fixtures are per game (`fixtureOf` and `openFixtures` are series-aware), so each game of a series is reported with its own home side.
- **The client.** `dynasty/FriendsDynasty.jsx`. The offseason screens take `moves`: `soloMoves` alone, `friendsMoves` with friends. In a friends dynasty, `d.humanId` is set to the coach looking.

## Round five: real contracts on an own-team start (2026-09-12)

**[user]** "If a player just uses normal rosters/brings their team in, all players come in on their current contracts, Wemby included, and there is no signing period. This is the same for AI. Players who need to be re-signed or are free agents should ask for what their card is worth." And: "if your team comes in massively over the apron, you'll have to let some people walk or trade them to get under the apron NEXT season, or before you can re-sign anyone."

- **The arriving deal is real.** `contractFor(key)` reads this season's salary as a share of the NBA cap and pays the same share of the 100-DP cap, so a max contract lands on the 35-DP max. The years are the years left on THAT deal.
- **Everything after it prices the card.** Free agency, the exclusive window and rookie scale are untouched, which is the whole point: Wembanyama opens at 11 DP for one year and then asks 35.
- **No signing period in an own start.** The AI's teams are still fantasy-drafted around your ten, but they sign at their real contracts (`finishDraft(x, { real: true })`) and the league opens in the preseason.
- **Over the apron is legal on arrival** and nothing had to change to allow it: squad size is the only roster check, the cap gates every signing, and a trade that reduces an over-apron payroll is already allowed. A star-heavy ten opens near 281 DP against a 115 apron.
- **Cards with no current NBA deal** — retro, throwbacks, WNBA, and the 23 current players the source has no row for — arrive at what the card is worth on a one-to-three-year deal.
- **The data**: `scripts/dynasty/buildContracts.mjs` → `card-data/generated/dynasty-contracts.json`, built from basketball-reference.com/contracts (Spotrac blocks automated requests; the user's screenshots of it agreed with the pull). 325 of 348 base cards match.

## Not built, and worth asking the user

- **Trades.** There are none, AI or human.
- **Aging and retirement.** A card is the same card in year ten. A player could retire after N years in the league, or a card's fair value could decay.
- **In-season moves.** Every transaction happens in the offseason.
- **Multiple humans in one dynasty.** A league version, like shared seasons.
- **The small per-game coin buff.** See Coins above.
- **Free agency against other humans' rosters.** This only matters once there is a shared version.
