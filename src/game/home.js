// THE HOME PAGE'S ARITHMETIC — what the signed-in landing shows, worked out
// from the collection, the seasons and the lifetime tracker with no React and
// no Firebase, so the tests can pin it.
//
// The user, 2026-09-10: "Can you build a homepage, so that it just doesn't
// show blank on the screen when you navigate to the site? Latest news (like
// get your starter pack, Unethical Hoops), closest collections with a link to
// the pack shop, seasons in progress with your current standing and next
// opponent, player stats, etc."
import { GOALS, goalProgress } from './collections.js';
import { PACK_TYPES } from './packEngine.js';
import { getCardByKey } from './cardSets.js';
import { standings, nextFixtureFor, teamsById, totalRounds, PHASE } from './modes/seasonCore.js';
import { LENGTHS } from './modes/schedule.js';
import { teamIdFor } from './modes/league.js';

// ── News ─────────────────────────────────────────────────────────────────────

/**
 * What changed, newest first. `to` is where the button goes: a tab id, or
 * 'shop' / 'goals' for a Collection section. Add an item the day a feature
 * ships; the page shows the latest few and the rest behind "All news".
 */
/**
 * THE COLLECTION PAGES HOME CAN OPEN, by the name a NEWS item or a Home link
 * uses (App.jsx homeGo). Anything else is a tab of its own.
 */
export const HOME_SECTIONS = { shop: 'shop', goals: 'goals', mycards: 'collection', freeagents: 'freeagents', market: 'market', friends: 'friends' };

export const NEWS = [
  {
    id: 'live-series', date: '2026-10-28', title: 'The Live Series is here',
    body: "Blue-trim cards of this season's players whose numbers move every night with the season: Speed, Power, shooting, chart and salary are rebuilt from the season's expected numbers and the games actually played, so the Live card you own can heat up or cool off. This season's rookies and players back in the league join as they get their photos. Find them in boosters and in the 100-coin Live Series Pack, and start on the Live Series collection.",
    to: 'shop', cta: 'The pack shop',
  },
  {
    id: 'climb-boss-packs', date: '2026-10-27', title: "The Climb: the bosses' packs climb with the coach",
    body: "Beating the Climb at a harder coach now pays harder-earned packs. Prince's bosses pay a Booster, a Rare Deluxe and a Super Deluxe; the Mega Deluxe is for King (a Booster, a Rare Deluxe and a Mega Deluxe) and Deity (a Rare Deluxe, a Super Deluxe and a Mega Deluxe), and the easier coaches pay less. The start screen shows every coach's packs under its pay. A climb already under way keeps the packs it started with.",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'pack-new-badge', date: '2026-10-27', title: 'Packs mark what is NEW',
    body: "Opening a pack now marks every player card you did not already own with a green NEW, beside its rarity and in the list of pulls. A second copy of it later in the same pack or box is not marked again.",
    to: 'shop', cta: 'The pack shop',
  },
  {
    id: 'climb-events', date: '2026-10-25', title: 'The Climb: ❓ stops',
    body: "Some stops on the map are a ❓ now: a scene with choices, and many of them cost you something whichever way you go. Take a trade call for your lowest-paid player, sign a two-way player for three games or a veteran on the minimum at half their salary, gamble on an injury scare or a hot streak, pay a holdout or lose them for two games, play through a flu bug, play a back-to-back for a sure perk or sit your star. Fifteen scenes, each once a run; a ❓ clears the floor and raises the cap as a Rest Day does. And one ❓ in four is a Makeup Game: a Game that plays and pays like any other, and a loss there ends the run. A climb already under way keeps its map; the next one you start has them.",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'climb-coach-styles', date: '2026-10-25', title: "The Climb: every coach has a style",
    body: "Every team on the map is its own franchise now, and its coach plays that franchise's style: a strength with a hole in it. Splash shoots threes at +1 but plays a Power down; Seven Seconds rolls +1 in the first section but tires faster; Heliocentric's star rolls +2 while the rest roll −1. Ten styles, named on each stop, so the route you take is a choice of who you play. In Act I's Games only the hole plays. And an Act I or Act II boss can be taken at Full Strength, its strength doubled, for a bigger reward: one more card pick and a boss's perk from four.",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'climb-sixth-player', date: '2026-10-25', title: 'The Climb: start with a sixth player',
    body: "A climb can start with five players or six, under the same $2,200 cap. A sixth means a cheaper five, but it gives you a bench from the first game, so your starters can rest between sections instead of carrying every minute. Climb fives in My Teams are Climb teams now, and hold a sixth too.",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'last-pair-places-itself', date: '2026-10-23', title: 'The last pair places itself',
    body: "Once four matchups are set, each side has one player and one row left, so the last pair now goes down by itself and the matchup window opens. Undo still takes back the last player you chose, along with the pair.",
    to: 'play', cta: 'Play',
  },
  {
    id: 'climb-perks-wave-two', date: '2026-10-22', title: 'The Climb: twenty new perks',
    body: "Perks are the Climb's relics, and there are twenty-four now. Build a player with Track Work (+1 Speed), Lockdown Drills (+1 Defensive Bonus) or Post Moves (+2 Paint Bonus); Signature Move is +2 on threes now, so it is a real choice against Extra Reps, and an offer never shows two shooting perks. Team perks last the run: Scouting Report, Fast Start, Closers, Rim Deterrent and Ball Movement Culture work in every game; Training Staff, Shootaround, Advance Scout and Scouting Network work between games; Sponsorship grows the pot and Travel Day lets you jump lanes. And each boss now offers a perk of its own, big and usually with a cost: Second Chance, Win-Now Trade, Max Contract, Heavy Minutes, Short Rotation and Front Office Shake-Up.",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'rosters-after-camp-cuts', date: '2026-10-22', title: 'Rosters after the camp cuts',
    body: "Walter Clayton Jr. is a Maverick now. And four more 2026-27 cards belong to players no NBA team kept after training camp: Bruce Brown, Micah Peavy, Dwight Powell and Drew Eubanks. They are Free Agents now, on the plain FA card: no collection asks for them and no pack deals them, and a copy you own still plays, burns and sells. When one signs, they join their new team and the packs again.",
    to: 'goals', cta: 'Collections',
  },
  {
    id: 'climb-sign-and-release', date: '2026-10-21', title: 'The Climb: every Rivalry pays a player, even at a full roster',
    body: "A Rivalry win always offers a player again, Act II and III included. A full roster of ten (or a cap with no room) used to empty the offer; now the three players come anyway, and you sign one by releasing a player of yours, who leaves the run with their perks. Game drops work the same way. With rosters that keep improving, Acts II and III were re-tuned to stay hard: Act II's teams and boss are bigger, and Act III is played against classic teams. And a timeout now holds the other team: nobody on the other side rolls until play resumes.",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'climb-three-acts', date: '2026-10-20', title: 'The Climb: three acts — take the pot or keep climbing',
    body: "The Climb is three acts now, like Slay the Spire. Beat an act's boss and choose: take the pot and stop, or keep climbing with the pot riding on. Each act is harder — bigger teams, deeper decks with rares, a bigger classic boss — and pays more: Act II's wins add half again as much to the pot and its boss adds a Rare Deluxe; Act III's add double, and beating its boss adds a Mega Deluxe. Your players start each act rested, and the boss you beat pays a card, a player and a perk. One loss in any act loses the whole pot. A run that has beaten Act I's boss and not banked can keep climbing too.",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'climb-wave-two', date: '2026-10-20', title: 'The Climb: thirteen new cards, and a player from every Rivalry',
    body: "Beat a Rivalry and you now always get a player to choose from. Thirteen new Climb-only cards join the rewards. Powers that pay all game: Get Stops (a defense card is a Rebound), Talk on Defense (a switch is +1 Speed on defense for your five), Ball Movement (a made three is an Assist), Wear Them Down (a made paint check wears that defender's Power down) and Film Session (an extra card each section; its + is in your opening hand, like Ball Movement+). Signature Set grows a little every game you play it, up to +6, and Leave It All Out There is +3 to every roll for one section, once. And the Grind cards trade minutes for an edge, the minutes landing after the section: Up-Tempo, Ride Your Star, Full-Court Press, Crash Every Board, Play Through Contact, and Two-a-Days, which practises a card after the game in return for tired legs.",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'climb-plus-every-card', date: '2026-10-20', title: 'The Climb: a "+" for every card',
    body: "A Rest Day can now practise any card a run can offer, not just the kit cards: seventy-nine new \"+\" versions, each one something a better-drilled team really does. Bigger numbers (Defensive Identity+ is +4/+4 to all five), looser doors (Blow-By+ and Rimshaker+ from 12), no discard (Lob City+, Pin-Down Screen+, Outside Pick+, Denial+), or a card drawn (Point God+, Post Domination+). Two new riders: Extra Pass+ Runs It Back — it goes back into your deck after you play it — and Chemistry+ is Innate, in your hand from the tip. Conditioning+ covers the next game too, and Ice Bath+ stays in your deck. Tell us which ones need a buff or a nerf.",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'climb-home-court', date: '2026-10-20', title: 'The Climb: home court and fairer coaches',
    body: "You were always the visitor in the Climb, so the coach answered every placement. Now every Game is at home: the coach places first and you answer. Rivalries and the boss are road games. Act I coaches play one copy of each card (no more doubled Bully Ball), and the boss brings its kit plus three cards, none of them rare — it already has the bigger cap and the better players. First Step and Point God now ask which player.",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'climb-bar', date: '2026-10-20', title: 'The Climb: your map, deck and team, any time',
    body: "Every Climb screen now has Map, Deck and Team buttons at the top, and so does the board during a run's game: the map with the stop you are on, every card in your deck (a practiced copy shows its + face) and your players with their fatigue, perks and who is In System. The start screen also has the team builder's search, filters and sorting for picking your five.",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'putback-rebound-and-their', date: '2026-10-20', title: 'Putback Specialist grabs the board',
    body: "A make on Putback Specialist's paint check now puts the rebound on the scorer's line, the way a putback is an offensive board. Every Climb-only card has art now, and every card, prompt and rules page says they and their for a player (Bruise Brothers is Bruise Crew).",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'climb-build-arounds', date: '2026-10-20', title: 'The Climb: build a team, not a pile',
    body: "A Rest Day can now cut a card from your deck for good, so the cards you built around come up more often. The map scouts the boss from the first floor: its best five, its playbook and the rares in its deck. And two new Climb-only cards reward a deck built for them: Splash (your threes get +1 for every two your team has made this game, up to +3) and On Fire (a player who makes three checks in a row is +3 until they miss). And every playbook now has a system: a player who fits it is In System — Speed 12+ for Speed or Power 12+ for Paint, +1 on their shot checks; Defense +1 or better for Defense, the checks against them −1. Player offers who fit glow.",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'climb-perks-chemistry', date: '2026-10-19', title: 'The Climb: perks and Climb-only cards',
    body: "Beat a Rivalry and it drops a perk for the rest of the run: Gym Rat (+1 Power on a player you choose), Extra Reps (their Shot Line 1 better), Signature Move (+1 3PT Bonus) or Film Study (practise a card on the spot). Take one of three, or none (a Rivalry usually drops one, a Game now and then). Your cap rises $450 a floor now, and rarer cards come more often as you climb, so every step up builds a bigger team. Rewards can now offer cards you will only ever find in a climb, each playbook its own: Let It Fly and Pace and Space for Speed, Bruise Crew and Weight Room for Paint, Conditioning and Shut the Door for Defense, and for anyone Chemistry, Stay Hot (your hot markers carry into the next game) and Ice Bath (after this game, your fatigue is gone). A reward card one of your players fits now glows and names them, and players are offered at three prices. And Second Closer, ATO Masterpiece, Hack-A-____ and Transition Outlet have their \"+\" versions to practise.",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'climb-pays-as-you-go', date: '2026-10-19', title: 'The Climb pays as you go, and Act I is fairer',
    body: "Every Climb game now pays a quarter of a regular game, win or lose: a quarter of finishing one and of the win bonus or a close loss's consolation, at your coach rung's rate. The pot is still yours on top when you retire or beat the boss. The first three floors are fairer too: those coaches play only their starting kit, like yours, with no rares, on cheaper rosters. The boss is as tough as ever. Every starting kit now carries a crunch card (Second Closer, ATO Masterpiece or Hack-A-____), and Defense trades a Close Out and Help Defender for two Transition Outlets, so it has shots of its own. And on a Rest Day you can look at the map to see what comes next before you choose.",
    to: 'climb', cta: 'The Climb',
  },
  {
    id: 'play-hub', date: '2026-10-19', title: 'Every game mode under Play',
    body: "Play opens on one page of every way to play: The Climb, a quick game, Season, Dynasty, Tournament and Online PvP, each as a card. Anything you have going says where you stand (the floor and pot of a climb, a dynasty's year, a season's next game) with a Resume button, and a game in progress sits first. Dynasty, Tournament and PvP have left the top bar for it, and every mode has a link back to All modes. On a phone, Home and the rules join the bottom bar.",
    to: 'modes', cta: 'Play',
  },
  {
    id: 'the-climb', date: '2026-10-18', title: 'The Climb',
    body: "A new way to play, from the Play tab: bring five of your players under a $2,200 cap (save a few Climb fives ahead in My Teams) and climb seven floors of one-quarter games to a classic team at the top, built from a franchise's Super Seasons, Throwbacks and reward cards. Pick a playbook at Training Camp, choose your path on the map, and after every win take a strategy card or a player for the run, or skip: a tight deck beats a big one. Fatigue carries from game to game; a Rest Day clears it, or upgrades one of your cards. Wins fill the pot, with a Booster for beating the boss. Retire between games to bank it. One loss and the pot is gone.",
    to: 'climb', cta: 'Start a climb',
  },
  {
    id: 'record-breakers', date: '2026-10-14', title: 'Record Breakers',
    body: "A new set for the seasons a record fell, in a platinum frame with the record lit up on a plaque across the photo. LeBron James' 2022-23 is the first (38,388, the night LeBron passed Kareem), with Curry and Ray Allen's three-point marks, Westbrook's 182nd triple-double, Karl Malone's free throws, Stockton's 1,164 assists, Calderón's free throws and Korver's threes. Those are earned by matching the feat, which is coming soon, never from a pack. Four blocks and steals records (Hakeem, Stockton, Mark Eaton, Alvin Robertson) join the boosters as their photos are finished. Curry's 2015-16, Westbrook's 2016-17 and Stockton's 1994-95 already carry the plaque.",
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'unsigned-players-free-agents', date: '2026-10-14', title: 'Unsigned players come off their teams',
    body: "Jordan Hawkins is a Bull now. And eight 2026-27 cards belong to players no NBA team has on its roster: Nicolas Batum, Sharife Cooper, Tyrese Martin, Gabe Vincent, Rob Dillingham, Gary Harris, Aaron Holiday and Jonas Valančiūnas. They are Free Agents now, on a plain FA card: no team, division, conference or set collection asks for them, and no pack deals them. A copy you own still plays, burns and sells. When one signs, they join their new team, its collection and the packs again.",
    to: 'goals', cta: 'Collections',
  },
  {
    id: 'collections-by-division', date: '2026-10-14', title: 'Collections by division',
    body: "A third sort on the Collections page: By division lays the NBA franchises out East then West, one heading per division, the way the Division and Conference packs are cut, so you can see which pack covers the teams you are closest to finishing. The WNBA, which has no divisions, stays A to Z.",
    to: 'goals', cta: 'Collections',
  },
  {
    id: 'wnba-team-rare-deluxe', date: '2026-10-14', title: 'WNBA Team Rare Deluxe',
    body: "A new pack in the shop: three players from one WNBA franchise, its legends included, every one rare or better, with a super rare one time in three and the same one-in-nine shot at a Legendary as the NBA Team Rare Deluxe, at the same 1,875 coins. It is stocked for every franchise with the cards to fill it; Toronto, Portland and Seattle join once their pools grow.",
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'coach-waits-for-your-answer', date: '2026-10-11', title: 'The coach waits for your Glass Cleaner',
    body: "The coach used to act again under a second after its own shot check or roll, so cards that answer one (Glass Cleaner, Rebound and Push, Box Out, Passing Lane, and Putback Specialist or Kick-Out Three for your own miss) were gone before you could reach them. Now, while you hold one that can answer, the coach waits, and a banner names the card with a Continue button. A miss on a check bought with 5 assists or 5 rebounds counts now too; those could never be answered before.",
    to: 'play', cta: 'Play',
  },
  {
    id: 'coach-no-impossible-checks', date: '2026-10-11', title: 'The coach stops throwing away shot checks',
    body: "With a big bank of assists or rebounds, the coach spent them on its best check even when that check needed a 21 to go in, at every level up to Deity. It never takes a check it cannot make now; the assists and rebounds wait for one that can go in, or for a card.",
    to: 'play', cta: 'Play',
  },
  {
    id: 'pick-up-full-court-once', date: '2026-10-11', title: 'Pick Up Full Court: once per player per section',
    body: "Pick Up Full Court can no longer hound the same player twice in a section. The picker offers only the players you have not pressed yet, the coach follows the same rule, and the card waits once all five have been hounded. Everyone is fair game again next section.",
    to: 'play', cta: 'Play',
  },
  {
    id: 'dynasty-import-offseason', date: '2026-10-11', title: 'Dynasty: Bring in a player now shows in the offseason',
    body: "Franchise Points bring a card you own into your dynasty, from the draftee signing through the preseason. But the offseason screen left the Bring in a player panel (and the deck picker) out of the Front Office, so it only appeared during the season, where every button was off. It is on the offseason screen now, where it works.",
    to: 'dynasty', cta: 'Dynasty',
  },
  {
    id: 'friends', date: '2026-10-11', title: 'Friends, and the cards they need',
    body: "Add friends in Collection → Friends: send your friend code, or tap anyone you've played in a league or head to head. When a friend is one or two cards from finishing a collection, any spare of those cards you could sell shows a note in My Collection under 'Spare to sell or burn': who needs it, for which collection, and a List it button that opens the usual sell form. A card you pack that a friend needs says so on the reveal. When a friend lists a card you need, it shows on Home and is tagged in the market. Listings stay public: anyone can still buy them.",
    to: 'friends', cta: 'Friends',
  },
  {
    id: 'glass-bonus-live', date: '2026-10-08', title: 'Lead the glass by 3 and your next paint check is +2, right away',
    body: "The +2 for a rebound lead of 3 only arrived after a section ended that far ahead, and only on the 5-rebound paint check, while the scoreboard promised it the moment you went up 3. Now it is live: whenever you lead the rebound track by 3 or more, your next paint check of any kind is at +2, whether you bought it with rebounds or assists or a card called it. Once a section. The court's REB tile shows the +2 while you hold it, every paint button's target includes it, and the check's line names it as Glass.",
    to: 'play', cta: 'Play',
  },
  {
    id: 'passing-lane-last-passer', date: '2026-10-07', title: "Passing Lane's extra assist comes off the last passer",
    body: "Passing Lane cancels the assists a roll just won, and those still come off the roller's line. The one extra assist it takes when your defender has the Speed edge was coming off the roller too, so they could lose an assist from an earlier roll. It now comes off whoever had the team's most recent assist before that roll, and the log names them.",
    to: 'play', cta: 'Play',
  },
  {
    id: 'free-agents-rebuilt', date: '2026-10-07', title: 'Requested cards rebuilt on the current rules',
    body: "The 25 Free Agents cards were built the day they were signed, so the September 30 card rules (finer three-point lines, no scoring cut for seasons over 36 minutes a game, rebounds and assists read per scoring band) never reached them. They are rebuilt now like every other set. Most moved $30 or less. Jawad Williams 2010-11 drops to common, and anyone holding one gets the coin difference, the same way as the other rarity changes.",
    to: 'collection', cta: 'Collection',
  },
  {
    id: 'twin-towers-spend-checks', date: '2026-10-07', title: 'Twin Towers guards the paint checks you pay for',
    body: "Twin Towers says the other team's paint checks are two harder while it stands. It only touched the paint checks a card calls for: the ones you buy with 5 assists or 5 rebounds ignored it. They now need two more on the die as well, and the banner itemises it before you pay.",
    to: 'play', cta: 'Play',
  },
  {
    id: 'collections-sort-and-team-delete', date: '2026-10-07', title: 'Sort collections by progress, and delete a team in one tap',
    body: "Collections has a Sort menu beside Hide claimed: A–Z as before, or Most complete, which puts a finished collection still to claim on top, then the rest by the share you own. Your saved teams have a Delete button you can see: on each row in Collection → My Teams, and beside each team in the Team Builder's load list. Thanks to the player who suggested both.",
    to: 'goals', cta: 'Collections',
  },
  {
    id: 'my-teams-one-card-a-player', date: '2026-10-07', title: 'One card a player in My Teams too',
    body: "The Team Builder already refused a second card of the same player. The editor in Collection → My Teams let one through, so a team could field two LeBrons. It now refuses as well, and a team saved with a player twice says so and asks you to remove one before it saves again.",
    to: 'collection', cta: 'My Teams',
  },
  {
    id: 'wnba-2026-awards', date: '2026-10-07', title: '2026 WNBA awards on the cards',
    body: "Jessica Shepard's Most Improved Player and Janelle Salaün's Sixth Player of the Year are now printed on their 2026 cards, beside Angel Reese's Defensive Player of the Year.",
    to: 'collection', cta: 'Collection',
  },
  {
    id: 'claim-reveals-the-card', date: '2026-10-07', title: 'Finishing a collection turns your reward card over',
    body: "Claiming a finished collection was meant to turn the reward card over on its own stage, with the flash, the stamp and the confetti, but it had been showing only the coins. The card now turns over first, at least with a super rare's celebration and with a legendary's when it is one, and the coins land in gold underneath. The card was always in your collection; it just never got its moment.",
    to: 'goals', cta: 'Collections',
  },
  {
    id: 'answered-checks-wait', date: '2026-10-05', title: 'See the coach\'s answer before you shoot',
    body: "When the coach answers one of your shot checks (Close Out, Drop Coverage, Rim Protector, Hustle Play, Smothering Defense, Denial), the check now waits instead of rolling at once. The banner shows the new target, what it needs on the die and every term behind it, and you press Resolve. The log names each term too (\"−2 Drop Coverage\", \"−1 contest (Gobert)\") where it used to fold them into one number. A check the coach lets go still rolls straight away.",
    to: 'play', cta: 'Play',
  },
  {
    id: 'strats-not-burned-by-hand', date: '2026-10-02', title: 'Strategy cards are no longer burned by hand',
    body: "The Burn button is gone from strategy cards in your collection. They leave one way now: a copy that would take a card past its deck limit (5 common, 4 uncommon, 3 rare, 1 legendary) is burned for its coins as it arrives, as it has been since September. Player cards are unchanged: a spare can still be burned or listed on the market.",
    to: 'collection', cta: 'Collection',
  },
  {
    id: 'aimed-rare-deluxe', date: '2026-10-02', title: 'Rare Deluxe packs you can aim, and a fairer premium shelf',
    body: "Four new packs in the shop: a Rare Deluxe for one division, one conference, one franchise or the WNBA. Each is three players, every one rare or better, with the same one-in-nine shot at a Legendary, and no card twice in a pack unless the pool has run out of that rarity. Division, conference and WNBA cost 750; one franchise costs 1,875 and reaches that team's special-set cards too. The premium packs were also rebalanced. A rare-or-better slot is now a super rare one time in three, in every one of these packs. The Super Deluxe's other two players are rare or better, where they were ordinary booster slots, so a second super rare is better than even instead of a 3% shot. The Legendary Chase now comes with two super rares beside its Legendary. The Rare Deluxe gives a little back: about one super rare a pack, down from one and a half.",
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'team-builder-every-set', date: '2026-10-01', title: 'Team Builder shows every card you own',
    body: "The Team Builder's pool only listed base-set NBA cards, so a Super Season, Rookie, Throwback or WNBA card you owned could not be picked there. It now lists every player card in your collection, and the dice draw from all of them too. One card a player on a team. Strategy decks are still built in Collection, under Strategy Decks, and chosen on the Play screen; the Team Builder now says so and links there.",
    to: 'collection', cta: 'Strategy Decks',
  },
  {
    id: 'lob-city-credits-players', date: '2026-10-01', title: 'Card stats go on the player who earned them',
    body: "Assists and rebounds a strategy card pays now land on a player's stat line, not only in the team's pool. Lob City's assists go to each Speed 15+ player. A shot check that pays assists on a make (Hammer Set, Pick-and-Pop, Outside Pick, Transition Outlet) credits the shooter. Short-Roll Playmaker and Spain Pick & Roll credit the scorer, Burst of Momentum and Delayed Slip the player the card names, Glass Cleaner and Rim Protector your defender on the shooter. Strength in Numbers gives one assist each to your three biggest edges, and Grab and Go gives its two to your leading rebounder on the floor. A cancelled stat comes off the line too: Passing Lane and Box Out take the assists or rebounds off the player who rolled them, and a make that Coach's Challenge overturns gives back the assists it paid. Pin-Down Screen's assist goes to the highest-salary guard beside the shooter, or the slowest forward when there is no guard. And the coach now pays the discard Pin-Down Screen asks for; it had been playing the card for free.",
    to: 'play', cta: 'Play',
  },
  {
    id: 'short-bad-seasons-as-played', date: '2026-10-01', title: 'Short, rough seasons are priced as they were played',
    body: "A short season that went badly used to be nudged up toward an average bench player, while a full season of the same play was not. Now a below-average season counts as it was played, however short. 39 rookie cards and a handful of others came down, most by about $30. Four cards went from uncommon to common, and each copy you held pays 3 coins, once.",
    to: 'collection', cta: 'Collection',
  },
  {
    id: 'suggestion-box', date: '2026-10-01', title: 'A suggestion box',
    body: "Found a bug, want a card, or have an idea? Home has a new Suggest something button. Pick what it is about, write it, and send. It goes straight to the people making the game.",
  },
  {
    id: 'dogged-until-benched-curry-11', date: '2026-10-01', title: 'Dogged lasts until benched; Curry shoots threes on 11',
    body: "Dogged now does what it says: the −2 Speed and −2 Power stay on the player in every section until they sit one, wherever they line up. It used to wear off at the end of the section. And Stephen Curry's 2015-16 card (45% from three on 11 attempts a game) is the one card in the game whose three-point check needs an 11. Every other card's floor stays at 12.",
    to: 'collection', cta: 'Collection',
  },
  {
    id: 'charts-from-real-games', date: '2026-09-30', title: 'More cards built from real games',
    body: "45 cards, most of them rookie cards, had been built from a fallback model because their game logs were missing. They now use their real games, and nearly all came down: Tim Duncan's rookie card went from $1,830 to $990. Five Super Seasons that those rookie cards had pushed out are back: Duncan 2001-02, David Robinson 1990-91, Yao 2008-09, Kirilenko 2004-05 and Marion 2006-07. Seasons over 36 minutes a game no longer lose scoring, so Jordan's 1987-88 rose from $1,560 to $2,030. Six Super Seasons moved to a more valuable season (Jordan 1988-89, Luka 2023-24, Kobe 2005-06, Tatum 2022-23, Pierce 2001-02, Wilkins 1987-88); if you hold one, you still have it. Short playoff runs like Daniel Gibson's 2007 now use their own games too. Jordan's 1984-85 rookie card is the Rookie set reward again. Cards that dropped a rarity pay the difference once, the same as this afternoon.",
    to: 'collection', cta: 'Collection',
  },
  {
    id: 'seven-new-cards', date: '2026-09-30', title: 'Jamison, Bynum, Webber, Rubio, Baron Davis, Maggette and Cousins',
    body: "Seven players get new cards. Super Seasons: Antawn Jamison's 2007-08 Wizards, Andrew Bynum's 2011-12 Lakers, Chris Webber's 1999-2000 Kings and Ricky Rubio's 2015-16 Timberwolves. Throwbacks: Baron Davis's 2006-07 We Believe Warriors, Corey Maggette's 2007-08 Clippers and DeMarcus Cousins' 2015-16 Kings. Jamison, Rubio, Baron Davis and Maggette also get rookie cards. The Super Season collection grows by four, so it's open again if you had finished it.",
    to: 'collection', cta: 'Collection',
  },
  {
    id: 'rewards-beat-the-collection', date: '2026-09-30', title: 'Every collection reward re-picked, and new cards',
    body: "A collection's reward now beats the best card that collection asks for, and is never a player on that team's current roster. New rewards include Derrick Rose's MVP season for Chicago, Dirk's 2011 title for Dallas, Larry Bird's 1985-86 for Boston, Yao Ming for Houston, Dr. J's 1980-81 MVP for Philadelphia and Alex English for Denver. The conference and full-set rewards are Set Rewards now, and each special set's reward is its own best card. A reward that left keeps its card: it went back to its set or became a Throwback, and anyone who earned it still has it. New cards: Super Seasons for Bernard King, Adrian Dantley, Arvydas Sabonis, DeMarcus Cousins, Kristaps Porzingis, Paul Millsap and Dell Curry; Rose's rookie card and three Dissonance cards; and Throwbacks for Blake Griffin, Lou Williams and Shawn Marion (those three join packs once their photos are in). Three-point lines also got finer: they used to land only on 12, 15, 18 or 20, and now use every number between.",
    to: 'collection', cta: 'Collection',
  },
  {
    id: 'green-light-once-hidden-bench', date: '2026-09-30', title: 'Green Light once per player; the coach\'s bench stays hidden while it places',
    body: "Green Light can be played on a player once per section now; a second one on the same shooter is refused, and the coach follows the same rule. And while the coach is still placing its five, its bench no longer shows the fatigue tracker, so you can't tell who has to sit before its lineup is down. Everything shows again once its fifth player is placed.",
    to: 'play', cta: 'Play',
  },
  {
    id: 'charts-rows-follow-points', date: '2026-09-30', title: 'New charts, and coins for cards that changed rarity',
    body: "Every card's chart was rebuilt. The rebounds and assists on each points row are now what the player actually averaged on the nights they scored that much, so a big scoring row no longer means more of everything, and a higher row is never worth less than the one below it. The points ladders are unchanged on nearly every card. A few cards crossed a rarity line with their new salaries. If you held any from before the change, you were paid once, on your next visit: the difference in burn value for every copy (40 coins for a rare that is now uncommon, 150 for a legendary that is now super-rare), with cards that moved up counted against it, and never below zero.",
    to: 'collection', cta: 'Collection',
  },
  {
    id: 'challenge-best-make', date: '2026-09-29', title: "Coach's Challenge re-rolls their best make",
    body: "Coach's Challenge no longer re-rolls whatever shot check happened last. It targets the opponent's best made check of the section: the most points, the most recent if tied, and never a miss. The card and the Challenge button name the check and give the re-roll's chance to miss before you commit.",
    to: 'play', cta: 'Play',
  },
  {
    id: 'dynasty-retirements-step', date: '2026-09-25', title: 'Dynasty: the offseason opens on retirements',
    body: 'In a dynasty where players age, the offseason now starts with its retirements: who retired, your own players first with the contract that went with them, the rest of the league, and which of your players could retire next year, with a Protect button if your Sports Science staff allows it. Then on to re-signing. Before this, a retirement only showed up in the league wire.',
    to: 'dynasty', cta: 'Dynasty',
  },
  {
    id: 'blitz-card', date: '2026-09-25', title: 'New reaction card: Blitz',
    body: 'When the other team announces a 3PT or paint check, Blitz sends two at the shooter: they have to hand that check to someone else on the floor, with the same card bonus. Only that check moves (the rest of a multi-check card stays with the original shooter, whose roll is still spent), and Close Out and the other answers can still follow it. Uncommon, now in packs. Placeholder art for now.',
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'dissonance-wave-two', date: '2026-09-24', title: 'Thirteen new Dissonance cards',
    body: 'More wrong jerseys: Patrick Ewing as a Sonic, Dominique Wilkins as a Celtic and a Spur, Shaq as a Celtic, Tony Parker as a Hornet, Gary Payton as a Buck, Allen Iverson as a Grizzly, Dennis Rodman as a Laker and a Maverick, Deron Williams, Ben Wallace and Lonzo Ball as Cavaliers, and Blake Griffin as a Celtic. Dominique Wilkins, Tony Parker and Deron Williams also get Super Season cards, and Wilkins, Parker, Deron Williams and Lonzo Ball get Rookie cards. Free Agents can now quote 1982-83 seasons too. Photos to come.',
    to: 'goals', cta: 'Collections',
  },
  {
    id: 'rebound-track-split', date: '2026-09-24', title: 'Spending rebounds never moves the track',
    body: 'The rebound track now counts the rebounds each team has won this game, and spending never moves it: a 5-rebound paint check used to hand the other team the lead (and its end-of-section assist). What you hold to spend is the number beside the track, spent like your assists. A card that cancels rebounds (Box Out, Cold Spell, Offensive Foul) takes them off the track too. Strategy cards that spend rebounds still need you to lead the track by what they cost.',
    to: 'play', cta: 'Play',
  },
  {
    id: 'fixture-kept', date: '2026-09-24', title: 'Leaving a fixture keeps your game',
    body: 'Stepping out of a season or dynasty fixture used to throw the game in progress away. Now "Back to the dynasty" keeps it exactly where you left it, through a page reload too, and the fixture offers "Resume this game". A fixture game you lost earlier may still be under Recover a game on the Play screen.',
    to: 'play', cta: 'Play',
  },
  {
    id: 'burst-once', date: '2026-09-24', title: 'Burst of Momentum: once per player per section',
    body: 'Burst of Momentum (+1 AST, +1 REB and a hot marker for a top-tier roll of 3+ points) can now be played on each player once per section. A second copy still works on a different player who earned it.',
    to: 'play', cta: 'Play',
  },
  {
    id: 'super-season-value', date: '2026-09-24', title: 'Every Super Season is a career\'s best card',
    body: 'A player\'s Super Season is now the season that makes their most valuable card, priced the same way as salary, not picked by a stats formula. 104 moved, among them Maya Moore to 2013, Michael Jordan to 1989-90, Larry Bird to 1987-88 and Kobe Bryant to 2008-09. A Super Season you own keeps its place and now shows the new year. Some replaced seasons come back as Throwbacks; the rest stay out of packs, and you can ask for any of them through Free Agents. Salaries were re-measured too, with rebounds and assists priced at what they buy in a game.',
    to: 'goals', cta: 'Collections',
  },
  {
    id: 'dogged-rare', date: '2026-09-24', title: 'Dogged is a rare',
    body: 'Dogged (−2 Speed and −2 Power on a fatigued opponent) was far stronger than a common, so it is now a rare: one printed copy and a rare\'s share of packs.',
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'zigzag-court', date: '2026-09-24', title: 'The court fits a big monitor',
    body: 'On a wide screen the ten players now stand as cards in two zig-zags, your five on the left and the coach\'s on the right, instead of five rows, so a whole game fits without scrolling. The number on each card pairs the matchups; hover a card to bring it to the front and outline the player it faces, and hold for a second to see the whole card. Laptops and phones keep the rows.',
    to: 'play', cta: 'Play',
  },
  {
    id: 'glass-cards', date: '2026-09-23', title: 'Four cards for the glass',
    body: 'New strategy cards for teams that win the boards, now in packs: Kick-Out Three (after your miss, 2 REB sends a 3PT check to a shooter on the kick-out), Grab and Go (3 REB become 2 AST), Rebound and Push (after their miss, 2 REB and your defender on the shooter takes a paint check at +1) and Own the Glass (lead the Rebound Track by 6: 5 REB for two paint checks at +1). Placeholder art for now.',
    to: 'shop', cta: 'Shop',
  },
  {
    id: 'rebounds-spend', date: '2026-09-23', title: 'Rebounds spend like assists',
    body: 'Your rebounds are a currency now: 5 REB buys a paint check for any player, any time, the same price as the assist paint check. Winning a section on the glass still pays: +1 assist, and a lead of 3 or more puts your next rebound check at +2. Teams used to finish games with 30 rebounds they could never use; a big front line now turns them into points.',
    to: 'play', cta: 'Play',
  },
  {
    id: 'wide-screens', date: '2026-09-23', title: 'Built for a big monitor',
    body: 'On a wide screen the app now uses the width: more cards per row in your collection, collection goals side by side, and in a game the court is a size larger with the game log and analytics open in a rail beside it, so a whole game reads without scrolling. Laptops and phones look exactly as before.',
    to: 'play', cta: 'Play',
  },
  {
    id: 'recover-game', date: '2026-09-23', title: 'A game in progress is never lost',
    body: 'Any game in progress that gets replaced or cleared — another device, a new game, a crash, even one you abandon — is kept. Play and Home offer it under "Recover a game", and Resume puts you back where you were. If a screen ever breaks, it now says so and offers to reload instead of going blank.',
    to: 'play', cta: 'Play',
  },
  {
    id: 'wave-two-twins', date: '2026-09-23', title: 'Five new strategy cards',
    body: 'The twins the deck was missing, now in packs: Blow-By (Speed 13+ and hot: +2 pts, another hot marker), Point God (a Speed edge before they roll: their assists doubled), Passing Lane (cancel a roll\'s assists, one more with the Speed edge), Clamp the Reserve (an opposing $400 player still to roll keeps the lower die) and Feeling It (your hot marker draws two). Placeholder art for now.',
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'dynasty-staff', date: '2026-09-23', title: 'Hire a front office',
    body: 'Franchise Points now hire staff, three tiers a role, kept for the dynasty: a Head Scout (a graded class, the AI\'s mock board, +25% lottery weight, a steal after the last pick), a Cap Strategist (every free agent\'s floor shown, your own players re-sign 10% under their ask, a 125-DP apron) and, in an aging dynasty, Sports Science (retirement starts later, one protected player a year). Tiers cost 3, 6 and 12 — a full role is a legendary\'s worth of points.',
    to: 'dynasty', cta: 'Dynasty',
  },
  {
    id: 'legendary-odds', date: '2026-09-23', title: 'Where the Legendaries are',
    body: 'Nobody had packed a Legendary yet — about one booster in seventy carries one. Now every premium pack carries its own chance, and the dearer the pack the better the rate: Rare Deluxe about one pack in nine, Super Deluxe one in four, Mega Deluxe one in two, the Chase still the only sure thing. The Super Season and Summer Standouts packs deal their sets\' own odds — most of a pack rare or better — and are priced for it: 450 and 350.',
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'pack-rip', date: '2026-09-23', title: 'Tear the pack open',
    body: 'Every pack now arrives sealed: drag across the top to tear it, or tap. A Super Rare or a Legendary lands with a flash, a stamp and confetti — and a horn for the Legendary. And a claimed collection\'s reward chip opens the reward card itself.',
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'franchise-points', date: '2026-09-22', title: 'Franchise Points, and a deck you can change',
    body: 'A dynasty now pays its coaches in Franchise Points as each year closes: your regular-season finish (first of the league is 10), 3 for every playoff series you win, 10 for the title, all weighted by the coach rung. Spend them in the offseason to bring a card you own into the league — a common for 2, a rare for 8, a legendary for 32 — and the player signs at their value for two years under the cap. And your strategy deck is no longer frozen at the start: change it in the Front Office or between rounds, alone or with friends.',
    to: 'dynasty', cta: 'Dynasty',
  },
  {
    id: 'reward-identities', date: '2026-09-22', title: 'Reward cards wear their identity',
    body: 'Every Team and Set reward now prints in the look of what it is — gold for a Super Season, green for a Rookie, the Throwback brush for a season that was neither, its own for a playoff run — with the reward pill on top. Three franchise rewards were re-picked after Kawhi Leonard\'s move to Toronto and Brandon Ingram\'s to the Clippers: Toronto pays Vince Carter\'s 1999-2000, Washington John Wall\'s 2016-17 (Wall\'s Super Season card), and the Clippers Elton Brand\'s 2002-03. New cards: Super Seasons for Wall, Brand (2005-06), Gilbert Arenas (2005-06), DeAndre Jordan (2014-15) and Anthony Parker (2006-07), Rookie cards for Wall, Brand, Arenas and Jordan, Bradley Beal\'s 2020-21 as a Throwback, and Ivica Zubac\'s 2024-25 back in Super Season. Because those sets grew, the Super Season and Rookie collections — and the East and West conference collections, which swapped Kawhi and Ingram — reopen for anyone who had finished them; the capstone you already earned is yours.',
    to: 'collection', cta: 'See the rewards',
  },
  {
    id: 'wnba-team-packs', date: '2026-09-21', title: 'WNBA Team Packs, and plain free throws',
    body: 'The Pack Shop sells a WNBA Team Pack: five players from one WNBA roster and a strat, 250 coins, priced against the NBA Team Pack by what comes out. And Unethical Hoops draws four plain free throws now: the +4 on each check is gone (a free throw carries its own +10).',
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'coin-fixes', date: '2026-09-18', title: 'What a game pays: four fixes',
    body: 'A harder coach\'s premium is now a win\'s: a loss pays the standard rate at King and Deity (below Prince the discount stays). A game where you built the coach\'s team or picked its deck, or a Quick Match, pays at most the standard rate — the premium is for beating a team the coach drew itself. A finished game is paid once, however often the page reloads, and it keeps the difficulty and the opponent it was dealt with. Season and dynasty title money is paid by the share of your own games you played — simmed ones do not count.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'tired-checks', date: '2026-09-16', title: 'Tired legs miss shots too',
    body: 'The fatigue tracker\'s penalty now applies to 3PT and paint checks the way it applies to scoring rolls — the rules pages had said so all along; the dice had not. Free throws are exempt. A trial: say so if it plays wrong.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'difficulty-ladder', date: '2026-09-16', title: 'The coach\'s ladder, reshaped',
    body: 'Prince is now the fair game and the default: the full search on an even roster, at the standard rate. Below it the coach is handicapped and games pay less. Above it the coach\'s team gets better — King and Deity draft to a richer cap and read more of your lineups — and games pay more, up to 1.5× on Deity. PvP pays the top rate. A season or dynasty pays at the rung it was built at, so turn the coach down whenever you like.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'twelve-minutes', date: '2026-09-16', title: 'Twelve straight minutes is the limit',
    body: 'A player at twelve minutes on the tracker sits the next section — you and the coach alike — and a section on the bench clears the tracker at eight minutes or under — two on, one off, fresh again — while a player pushed past eight gets only four back. The fourth quarter and overtime lift the limit; halftime resets everything. Season and dynasty sims follow the same rule, so the 40-point averages are gone.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'free-agent-filters', date: '2026-09-16', title: 'Free Agents: browse by season, team and salary',
    body: 'Pick a season or a team to see everyone the archive has — every 1995-96 Cavalier, best-paid first — and narrow by salary either way. A name still works on its own.',
    to: 'freeagents', cta: 'Free Agents',
  },
  {
    id: 'cards-reworked', date: '2026-09-16', title: 'Three cards reworked',
    body: 'Burst of Momentum fires on a top-tier roll of 3+ points (a top band never paid 5, so it never fired). Post Domination reads the matchup: a player with a Power advantage over their defender, before they roll, doubles their rebounds this period. Dogged fires at any opponent with minutes on the fatigue tracker. Burst and Post Domination join the default fifty; Cross-Court Dime and Turnover leave it.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'commissioner-tools', date: '2026-09-16', title: 'Commissioner\'s tools for a dynasty with friends',
    body: 'The host can sim the coaches\' games — it asks twice and refuses a game open in a room — and can delete the dynasty outright by typing its name. A declined Free Agents invoice can be sent again.',
    to: 'dynasty', cta: 'Go to Dynasty',
  },
  {
    id: 'season-in-dynasty', date: '2026-09-11', title: 'Seasons now live in Dynasty',
    body: 'One tab for leagues: a single season, a ten-year dynasty, or either with friends. Your seasons in progress are right where you left them — under One season in the Dynasty tab.',
    to: 'season', cta: 'Your seasons',
  },
  {
    id: 'dynasty-friends', date: '2026-09-11', title: 'Dynasty with friends',
    body: 'Run one dynasty together: each of you coaches a team and AI teams fill the rest. Draft on a twelve-hour clock, bid sealed through three weeks of free agency, trade with each other (the commissioner can veto), and move on when everyone is ready. Each year\'s title money goes straight to every coach.',
    to: 'dynasty', cta: 'Start one',
  },
  {
    id: 'dynasty', date: '2026-09-11', title: 'Dynasty mode: ten years, one league',
    body: 'Bring your own team or fantasy-draft the league, then sign everyone with Dynasty Points. Every player has a personality to haggle with, your own free agents talk only to you, the lottery hands out a class of legends and rookies, and the AI bids against you in free agency. Finish all ten years for a coin bonus; a fantasy-draft start pays half, so bring your own team for the full amount.',
    to: 'dynasty', cta: 'Start a dynasty',
  },
  {
    id: 'margin-coins', date: '2026-09-11', title: 'Wins pay by the margin',
    body: 'The victory bonus now scales with how much you win by: 20 coins for a one-point squeaker, up to 100 for a 50-point blowout (PvP pays half again). Losing by five or fewer, or a tie, pays 15 on top of the coins for finishing.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'overtime', date: '2026-09-11', title: 'No more ties: overtime',
    body: 'A game tied after regulation now goes to overtime — another Crunch-Time section at any margin, with a fresh timeout and Clutch Possession for each side, and another after that if it is still tied. In every game: against the coach, in PvP, and in every simulated season fixture.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'free-agents', date: '2026-09-10', title: 'Free Agents: ask for any season',
    body: 'Search any NBA player\'s season from 1984-85 on (plus 1975-76 and 1976-77), or a playoff run from 2002, and see what their card would cost. Request it, and when the card is built you can sign it for its price. Up to three requests can wait at once.',
    to: 'freeagents', cta: 'Free Agents',
  },
  {
    id: 'device-handoff', date: '2026-09-10', title: 'Pick up on any device',
    body: 'Start a game or a season fixture on your desktop and carry on from your phone, or the other way round: the newest copy of the game is picked up by itself, and a device left open can no longer overwrite the one you moved to.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'placement-undo', date: '2026-09-10', title: 'Undo a placement',
    body: 'Put the wrong player on the floor? Take it back. Against the coach, until you place your next player; in PvP, until your opponent places.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'awards', date: '2026-09-10', title: 'End-of-season awards',
    body: 'When the regular season ends the league names an MVP (value over replacement), a Defensive Player of the Year (fewest points allowed per minute, 16 minutes a game to qualify), a Sixth Player, a Rookie of the Year and a Scoring Title.',
    to: 'season', cta: 'Go to Season',
  },
  {
    id: 'matchup-pm', date: '2026-09-10', title: 'Matchup +/- and a deeper box score',
    body: 'Every point is now charged to the defender guarding the scorer. Season stats show each player\'s matchup +/-, plus starts, paint checks, blocks and points for and against while they were on the floor.',
    to: 'season', cta: 'See season stats',
  },
  {
    id: 'mobile', date: '2026-09-10', title: 'Showdown on your phone',
    body: 'A tab bar at the bottom, a compact court, and one section on screen at a time. Tell us what still does not fit.',
  },
  {
    id: 'pack-prices', date: '2026-09-09', title: 'Super Season and Standouts packs repriced',
    body: 'The Super Season Pack is now 300 coins and the Summer Standouts Pack 275, priced against what their cards are measured to be worth.',
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'timeout-search', date: '2026-09-09', title: 'Crunch-Time timeouts search your deck',
    body: 'Call your timeout in Crunch Time and take one crunch card from your deck, then shuffle it.',
    to: 'howtoplay', cta: 'Read the rules',
  },
  {
    id: 'unethical-hoops', date: '2026-09-07', title: 'Unethical Hoops, presented by Underdog',
    body: 'The sign-up card. In Crunch Time, a player of yours with a Speed or Power advantage draws the foul: four free-throw checks. One comes in every Starter Pack.',
    image: 'unethical_hoops',
  },
];

/** The starter pack, while it is still unopened: always the first item. */
export const STARTER_NEWS = {
  id: 'starter', date: null, title: 'Your Starter Pack is waiting',
  body: '20 players, 30 strategy cards and Unethical Hoops. Pick the team you support and the pack is built around them.',
  to: 'collection', cta: 'Open it', highlight: true, image: 'unethical_hoops',
};

/** The news in the order the page shows it. */
export function newsFor({ starterOpened = true } = {}) {
  const items = [...NEWS].sort((a, b) => b.date.localeCompare(a.date));
  return starterOpened ? items : [STARTER_NEWS, ...items];
}

// ── Collections ──────────────────────────────────────────────────────────────

/** Special sets with a pack of their own. Dissonance and the WNBA specials have none. */
const SET_PACKS = {
  'set-super-season': 'super_season',
  'set-rookie': 'rookie_pack',
  'set-summer-standouts': 'standouts',
};

/** The pack that feeds a goal, or null when no pack targets it. */
export function packForGoal(goal) {
  let id;
  if (goal.league === 'WNBA') id = goal.kind === 'team' || goal.id === 'wnba-set' ? 'wnba_booster' : null;
  else if (goal.kind === 'team' || goal.kind === 'conference' || goal.id === 'nba-set') id = 'nba_booster';
  else id = SET_PACKS[goal.id] ?? null;
  const def = id ? PACK_TYPES[id] : null;
  return def ? { id, name: def.name, price: def.price } : null;
}

/**
 * THE COLLECTIONS NEAREST DONE. A complete goal that has not been claimed
 * comes first, since a reward is waiting. Then the fewest cards missing, with
 * ties going to the larger share owned and then the name.
 *
 * A goal with nothing owned is not "close". It only fills the list when fewer
 * than `limit` goals have been started. This is the one list sorted by
 * progress: the Collections screen keeps its rows alphabetical (the user,
 * 2026-09-06), and this list exists to answer "which is closest".
 */
export function closestGoals(ownedKeys, { claimed = new Set(), limit = 4 } = {}) {
  const rows = GOALS.map(g => ({ ...goalProgress(g.id, ownedKeys, { missingLimit: 0 }), pack: packForGoal(g) }));
  const ready = rows.filter(r => r.claimable && !claimed.has(r.id)).map(r => ({ ...r, ready: true }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const byClose = (a, b) => a.missingCount - b.missingCount
    || b.owned / b.total - a.owned / a.total
    || a.label.localeCompare(b.label);
  const open = rows.filter(r => !r.complete && r.total > 0);
  const started = open.filter(r => r.owned > 0).sort(byClose);
  const fresh = open.filter(r => r.owned === 0).sort(byClose);
  return [...ready, ...started, ...fresh].slice(0, limit);
}

// ── Seasons ──────────────────────────────────────────────────────────────────

const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/**
 * Where one team stands in a season: the record, the rank out of how many,
 * games behind the leader, the stage, and the next opponent.
 */
export function seasonGlance(season, myId) {
  const table = standings(season);
  const by = teamsById(season);
  const me = table.find(t => t.id === myId) ?? null;
  const leader = table[0] ?? null;
  const gb = me && leader && leader.id !== myId ? ((leader.w - me.w) + (me.l - leader.l)) / 2 : 0;
  const done = season.phase === PHASE.done;
  const f = done ? null : nextFixtureFor(season, myId);
  let next = null;
  if (f) {
    const home = f.home === myId;
    const oppId = home ? f.away : f.home;
    const opp = oppId ? table.find(t => t.id === oppId) : null;
    next = {
      fixtureId: f.id,
      home,
      playoff: Boolean(f.playoff),
      opponent: oppId ? (by.get(oppId)?.name ?? 'TBD') : 'TBD',
      oppRecord: opp ? `${opp.w}–${opp.l}` : null,
      human: Boolean(oppId && by.get(oppId)?.human),
    };
  }
  const stage = done
    ? (season.champion === myId ? 'Champions' : 'Season complete')
    : season.phase === PHASE.playoffs
      ? (next ? 'Playoffs' : 'Out of the playoffs')
      : `Round ${season.round} of ${totalRounds(season)}`;
  return {
    team: by.get(myId)?.name ?? null,
    record: me ? `${me.w}–${me.l}` : '0–0',
    rank: me?.rank ?? null,
    place: me?.rank ? `${ordinal(me.rank)} of ${table.length}` : null,
    gb,
    stage,
    done,
    champion: done && season.champion === myId,
    next,
  };
}

/**
 * The seasons still being played, for the home page: solo seasons (your team
 * is the human one) and live shared seasons (your team is `h:<uid>`).
 * `shared` is `[{ league, season }]` with the season already hydrated.
 */
export function seasonsInProgress({ solo = [], shared = [], uid = null } = {}) {
  const out = [];
  for (const s of solo) {
    if (!s || s.phase === PHASE.done) continue;
    const me = s.teams.find(t => t.human);
    if (!me) continue;
    out.push({
      kind: 'solo', id: s.id,
      title: `${LENGTHS[s.length]?.label ?? 'A'} season · ${s.size} teams`,
      ...seasonGlance(s, me.id),
    });
  }
  for (const { league, season } of shared) {
    if (!league || league.kind !== 'season' || league.status !== 'live' || !season || !uid) continue;
    if (season.phase === PHASE.done) continue;
    out.push({ kind: 'league', id: league.id, title: league.name, ...seasonGlance(season, teamIdFor(uid)) });
  }
  return out;
}

// ── Lifetime stats ───────────────────────────────────────────────────────────

/**
 * Your players' lifetime leaders from the per-card tracker, most points
 * first, with per-game lines. A key whose card left the pool is skipped.
 */
export function careerLeaders(stats, { limit = 5 } = {}) {
  return Object.entries(stats ?? {})
    .map(([key, r]) => ({ key, card: getCardByKey(key), rec: r ?? {} }))
    .filter(r => r.card && (r.rec.games || 0) > 0)
    .sort((a, b) => (b.rec.pts || 0) - (a.rec.pts || 0) || (b.rec.games || 0) - (a.rec.games || 0) || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map(({ key, card, rec }) => {
      const g = rec.games;
      return {
        key, card, games: g, wins: rec.wins || 0, pts: rec.pts || 0,
        ppg: (rec.pts || 0) / g, rpg: (rec.reb || 0) / g, apg: (rec.ast || 0) / g,
      };
    });
}

/** How many of your cards have played, and their points between them. */
export function careerTotals(stats) {
  const rows = Object.values(stats ?? {}).filter(r => (r?.games || 0) > 0);
  return { cards: rows.length, pts: rows.reduce((t, r) => t + (r.pts || 0), 0) };
}
