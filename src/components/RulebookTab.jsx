// THE RULEBOOK, as the engine plays it. Numbers come from engine.js
// (fatigueForMinutes, REST_RECOVERY, SPEND_COSTS, CRUNCH_MARGIN, SNAKE,
// clutchDiceFor, clutchEligible), rarity.js (STRAT_COPY_CAPS) and
// packEngine.js (PACK_TYPES). Rewritten 2026-09-07; before that it described
// free defensive assignment, a Crunch Time "coming soon", 8-minute rest and a
// 2-assist three, none of which the game did. Keep it honest: a rule that
// moves in the engine moves here the same day.
import { useRef } from 'react';
import s from './RulebookTab.module.css';

const SECTIONS = [
  { id: 'intro',      num: 1,  title: 'Introduction' },
  { id: 'setup',      num: 2,  title: 'Game Setup' },
  { id: 'attributes', num: 3,  title: 'Player Attributes & Matchups' },
  { id: 'turns',      num: 4,  title: 'Turn Structure' },
  { id: 'strats',     num: 5,  title: 'Strategy Cards & Decks' },
  { id: 'scoring',    num: 6,  title: 'Scoring System' },
  { id: 'fatigue',    num: 7,  title: 'Fatigue & Substitutions' },
  { id: 'crunch',     num: 8,  title: 'Crunch Time Rules' },
  { id: 'collection', num: 9,  title: 'Collection & Game Modes' },
  { id: 'glossary',   num: 10, title: 'Glossary' },
];

export default function RulebookTab() {
  const refs = useRef({});

  const scrollTo = (id) => {
    refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const setRef = (id) => (el) => { refs.current[id] = el; };

  const Section = ({ id, children }) => {
    const meta = SECTIONS.find(x => x.id === id);
    return (
      <div className={s.section} ref={setRef(id)}>
        <div className={s.sectionNum}>Section {meta.num}</div>
        <div className={s.sectionTitle}>{meta.title}</div>
        <div className={s.body}>{children}</div>
      </div>
    );
  };

  return (
    <div className={s.rulebook}>
      <div className={s.title}>NBA Showdown 2026 Rulebook</div>
      <div className={s.subtitle}>Official rules for the D20 Basketball Card Game</div>

      {/* Table of Contents */}
      <div className={s.toc}>
        <div className={s.tocTitle}>Table of Contents</div>
        <ol className={s.tocList}>
          {SECTIONS.map(sec => (
            <li key={sec.id}>
              <a className={s.tocLink} onClick={() => scrollTo(sec.id)}>
                {sec.num}. {sec.title}
              </a>
            </li>
          ))}
        </ol>
      </div>

      <Section id="intro">
        <p>
          NBA Showdown 2026 is a competitive basketball strategy card game. Two managers build
          teams under a salary cap, place their starters against each other, play strategy
          cards, and roll a D20 to score. Fatigue, hot and cold streaks, the assist and rebound
          tracks and a late-game Crunch Time sit on top of the dice.
        </p>
        <p>
          A game is 4 quarters of 3 four-minute sections — 12 sections. Every section is a
          secret lineup pick, a placement snake, two card windows and a round of rolling.
          Most points after 12 wins; a tie goes to overtime — another Crunch-Time section, as many as it takes.
        </p>
      </Section>

      <Section id="setup">
        <ul>
          <li><strong>Team:</strong> <strong>10 players</strong> under a <strong>$5,500 salary cap</strong>. Five start each section; five rest.</li>
          <li><strong>Deck:</strong> <strong>50 strategy cards</strong>. Copies per card are capped by rarity — 5 common, 4 uncommon, 3 rare, 1 legendary. Shuffle, draw <strong>7</strong>.</li>
          <li><strong>Lineups and placement:</strong> each section both managers pick five in secret and lock them, then place them one at a time in the snake <strong>A-B-B-A-A-B-B-A-A-B</strong>; the row a player lands in is their matchup. After the eighth placement each side has one player left, and the last pair goes down by itself, in snake order. Leading a row gives information away, so in a season the <strong>visitor places first</strong> and the home side answers; a sandbox game has Team A lead.</li>
          <li><strong>Length:</strong> 4 quarters × 3 sections. Halftime is the start of Q3.</li>
          <li><strong>Bench:</strong> the five not placed recover fatigue and lose their markers.</li>
        </ul>
      </Section>

      <Section id="attributes">
        <p>Each player card carries:</p>
        <ul>
          <li><strong>Speed</strong> and <strong>Power</strong> — the two numbers a matchup is measured on.</li>
          <li><strong>Scoring Chart</strong> — rows of modified-roll ranges paying points, rebounds and assists. The chart's last row is its <strong>top tier</strong>.</li>
          <li><strong>Shot Line</strong> — the total a shot check must reach, tie or better. The arrow on the chart marks it.</li>
          <li><strong>3PT Bonus</strong> and <strong>Paint Bonus</strong> — added to that kind of shot check. Many cards require one.</li>
          <li><strong>Def Boost</strong> — see below.</li>
        </ul>

        <div className={s.sub}>Matchup advantage</div>
        <ul>
          <li>Compare the attacker's Speed with the defender's, and Power with Power. The differences are the attacker's <strong>Speed advantage</strong> and <strong>Power advantage</strong>.</li>
          <li>A <strong>positive Def Boost</strong> is subtracted from each advantage, but only down to zero — it <em>neutralises</em>, it never creates a penalty.</li>
          <li>A <strong>negative Def Boost</strong> lowers the defender's effective Speed and Power. It is a hole, and it can be attacked.</li>
          <li><strong>Roll Bonus</strong> = the larger of the two advantages. If both are negative, the less negative one is the penalty.</li>
          <li>Cards that read "Speed or Power advantage" read the larger one, never the sum.</li>
        </ul>

        <div className={s.example}>
          Evan Mobley (S13 P13, Def+3) guards Jayson Tatum (S14 P13). Tatum's raw edge is Speed +1,
          Power 0. Mobley's +3 neutralises the +1 and stops there — Tatum rolls at <strong>+0</strong>,
          not −2. Swap in a defender with Def −2 and Tatum's edge becomes Speed +3, Power +2.
        </div>

        <div className={s.sub}>Shot checks are contested</div>
        <p>
          The shooter's matchup defender subtracts their positive Def Boost from any 3PT or paint
          check the shooter takes (one more in Crunch Time). Free throws are never contested.
        </p>
      </Section>

      <Section id="turns">
        <p>Each of the 12 sections follows this structure:</p>

        <div className={s.sub}>1. Lineup Selection</div>
        <ul>
          <li>Both managers choose <strong>five of their ten</strong> and lock the lineup. Neither sees the other's five until both have locked.</li>
          <li>The five left out sit the section: they shed fatigue and lose their markers.</li>
        </ul>

        <div className={s.sub}>2. Placement</div>
        <ul>
          <li>Managers place their five one at a time: <strong>A → B → B → A → A → B → B → A → A → B</strong>.</li>
          <li>Each placement takes the <strong>next open row</strong>. <strong>The two players in a row guard each other</strong> for the section. This is the defensive assignment; there is no other.</li>
          <li>When placing into a row the opponent has filled, the board previews both directions of the pairing.</li>
          <li>Nothing re-deals the pairings afterwards except a <strong>switching card</strong> or the Crunch Time <strong>timeout</strong>.</li>
          <li>Matchup cards may be played alongside placement; the window below continues once the tenth player is down.</li>
          <li><strong>Undo</strong> takes back your last placement. Against the coach it lasts until you place your next player, and the coach's reply is taken back with it. In PvP it lasts until your opponent places. Any card, pass or lock ends it.</li>
        </ul>

        <div className={s.sub}>3. Matchup Card Window</div>
        <ul>
          <li>Managers alternate. <strong>Playing a card</strong> hands the turn to the other side and resets the pass count. <strong>Passing</strong> hands it over and counts.</li>
          <li><strong>Two passes in a row</strong> close the window.</li>
          <li>Matchup-phase cards play here: switches (High Screen &amp; Roll, Switch Everything), and their reactions (Go Under, Fight Over, Veer Switch — one screen-cancelling card per switch).</li>
        </ul>

        <div className={s.sub}>4. Scoring Card Window</div>
        <ul>
          <li>The same play-or-pass rule. Scoring-phase cards play here: boosts, shot checks, Double Team, This Is My House, standing cards.</li>
          <li>Two passes in a row open rolling. No scoring roll before then.</li>
        </ul>

        <div className={s.sub}>5. Rolling</div>
        <ul>
          <li>Rolling <strong>alternates</strong>, one player at a time, the human leading against the coach. A side with nobody left to roll stands aside.</li>
          <li>Between rolls either side may play <strong>pre-roll</strong> cards on a player who has not rolled, and <strong>reactions</strong> to what just happened.</li>
          <li>Against the coach, while you hold a card that can answer its latest check or roll (Glass Cleaner, Rebound and Push, Box Out, Passing Lane; Putback Specialist and Kick-Out Three for your own miss), the coach waits until you play it or press Continue. Every check counts, including the ones bought with 5 assists or 5 rebounds.</li>
          <li>A player blocked by This Is My House or Hack-A-____ does not roll. A player whose roll a card replaced (You Stand Over There) counts as rolled.</li>
          <li>This Is My House needs the defender <strong>higher</strong> on both Speed and Power, counted as they guard: a minus Defense lowers both, and card effects count. A tie is not higher.</li>
        </ul>

        <div className={s.sub}>6. End of Section</div>
        <ul>
          <li>A player sent off by <strong>Foul Trouble</strong> is not in the pool for the next section — the whole section, both ends of the floor — and they are back the section after.</li>
          <li>All temporary effects clear (boosts, ghosts, blocks, standing cards whose players left the floor).</li>
          <li>Each starter adds <strong>4 minutes</strong>; a section on the bench <strong>clears</strong> a tracker at 8 minutes or under and takes <strong>4 minutes</strong> off above that.</li>
          <li>The rebound track (rebounds won, not what is left to spend) pays: the leader gains +1 stored assist. Each team's once-a-section +2 on a paint check comes back.</li>
          <li>Both hands refill to <strong>7</strong>.</li>
          <li>At halftime (start of Q3) all fatigue and all hot and cold markers reset.</li>
          <li>Entering the final section, Crunch Time arms if the margin is 20 or less.</li>
          <li>Tied after the final section: <strong>overtime</strong> — another Crunch-Time section at any margin, the clock still reading Q4, with a fresh timeout, Clutch Possession and deck search for each team. Still tied, again (up to ten overtimes, after which a tie stands).</li>
        </ul>
      </Section>

      <Section id="strats">
        <p>Strategy cards must be played in their phase:</p>
        <ul>
          <li><strong>Matchup:</strong> switches and their counters.</li>
          <li><strong>Scoring:</strong> boosts, shot checks, defensive schemes.</li>
          <li><strong>Pre-roll:</strong> on a player who has not rolled, during rolling.</li>
          <li><strong>Post-roll:</strong> triggered by a result (Heat Check on a top-tier roll).</li>
          <li><strong>Reaction:</strong> in answer to an opponent's action — a switch, an announced check, a natural 1 — before it resolves.</li>
        </ul>

        <div className={s.restriction}>
          Cards labelled <strong>Locked</strong> cannot be cancelled once played.
          <strong> Coach's Challenge</strong> re-rolls the opponent's best made shot check of the section (the most points, the most recent among equals; never a miss), at most twice per game per team.
          <strong> Crunch-only</strong> cards can be played only while Crunch Time is active.
        </div>

        <div className={s.sub}>Decks</div>
        <ul>
          <li><strong>50 cards.</strong> Per-card copies: <strong>5 common, 4 uncommon, 3 rare, 1 legendary</strong>. The strategy deck builder (Collection, Strategy Decks) refuses to save a deck over a cap.</li>
          <li>Hand of <strong>7</strong>, refilled to 7 at the end of every section.</li>
          <li>The first time a team's assists reach <strong>5</strong>, it draws one bonus card.</li>
          <li>A crunch-only card drawn outside Crunch Time goes to the bottom of the deck and the draw continues; it reaches a hand only in the crunch section or through the timeout search (see Crunch Time). A card that says "draw" draws past seven.</li>
          <li>A team carries its own deck; the default deck is a designed fifty for players who have not built one.</li>
        </ul>

        <p>
          The <strong>Strategy Cards tab</strong> lists every card with its art, phase, rarity and full text.
        </p>
      </Section>

      <Section id="scoring">
        <div className={s.sub}>Roll Calculation</div>
        <div className={s.highlight}>
          <strong>Final Roll</strong> = D20 + Roll Bonus + Fatigue + Hot/Cold Markers + Card Bonuses<br/>
          (minimum 1, no upper cap)
        </div>
        <p>The final roll is looked up on the player's chart for points, rebounds and assists.</p>

        <div className={s.sub}>Natural rolls</div>
        <ul>
          <li>Natural <strong>1 or 2</strong>: a <strong>cold marker</strong> (−2 to that player's later rolls and checks).</li>
          <li>Natural <strong>19 or 20</strong>: a <strong>hot marker</strong> (+2).</li>
          <li>Markers stack, and a player can hold both kinds. They clear when the player is benched for a section, and at halftime.</li>
        </ul>

        <div className={s.sub}>Shot Checks</div>
        <ul>
          <li><strong>3PT check:</strong> D20 + 3PT Bonus, reach the Shot Line → <strong>3 points</strong>.</li>
          <li><strong>Paint check:</strong> D20 + Paint Bonus, reach the Shot Line → <strong>2 points</strong>.</li>
          <li><strong>Free throw:</strong> D20 + 10, reach the Shot Line → <strong>1 point</strong>.</li>
          <li>Markers and fatigue apply. 3PT and paint checks are contested by the defender's Def Boost. Natural 19–20 and 1–2 on a check give markers too.</li>
          <li>A 3PT or paint check is <strong>announced</strong> first; the defence may react (Close Out: −3 to a 3PT check and a cold marker on a miss; Blitz: the offense gives a 3PT or paint check to another player on the floor, same card bonus, and it does not use up the defence's one other answer; Coach's Challenge: a re-roll of their best made check this section).</li>
          <li>The log itemises every check: die, card bonus, shooting bonus, markers, and the line it had to reach.</li>
        </ul>

        <div className={s.sub}>Assist Track</div>
        <p>Assists accumulate across the game and can be spent:</p>
        <ul>
          <li><strong>1 AST:</strong> +1 to a player's next shot check.</li>
          <li><strong>5 AST:</strong> a 3PT check for any player; their 3PT Bonus, either sign, applies. The button shows the die they need.</li>
          <li><strong>5 AST:</strong> a paint check for any player; their Paint Bonus applies the same way.</li>
          <li><strong>Reaching 5 for the first time</strong> draws a bonus strategy card.</li>
        </ul>

        <div className={s.sub}>Rebound Track</div>
        <p>Rebounds count twice. The <strong>track</strong> is the differential of rebounds <strong>won</strong> this game; spending never moves it, and a cancelled rebound (Box Out, Cold Spell, Offensive Foul) comes off it. The <strong>bank</strong> is what a team holds, spent like assists:</p>
        <ul>
          <li><strong>5 REB:</strong> a paint check for any player, at any time; their Paint Bonus applies.</li>
        </ul>
        <p>The <strong>track</strong> pays:</p>
        <ul>
          <li><strong>Leading by 3 or more, at any moment:</strong> the team's next paint check of any kind (5 REB, 5 AST, or one a card calls) is at <strong>+2</strong>, once a section.</li>
          <li><strong>Leading at section end:</strong> +1 stored assist.</li>
        </ul>
        <p>A strategy card that spends rebounds needs a lead on the track at least as big as what it spends.</p>
      </Section>

      <Section id="fatigue">
        <p>Every section on the floor adds <strong>4 minutes</strong>. The penalty applies to scoring rolls and to 3PT and paint checks alike (free throws are exempt):</p>
        <div className={s.highlight}>
          <strong>8+ minutes:</strong> −2<br/>
          <strong>12+ minutes:</strong> −6<br/>
          <strong>16 minutes:</strong> −12, then −6 more per section (20 → −18, 24 → −24)
        </div>
        <ul>
          <li><strong>Twelve straight is the limit:</strong> a player with 12+ minutes on the tracker <strong>must sit the coming section</strong>. The rule lifts for the <strong>fourth quarter and every overtime</strong>. If fewer than five players are rested enough, the least-tired fill the floor.</li>
          <li><strong>Rest:</strong> a section on the bench clears the tracker at <strong>8 minutes or under</strong> (8 rests to 0); above 8 it takes <strong>4 minutes</strong> off (12 rests to 8, 16 to 12).</li>
          <li><strong>Markers:</strong> a section on the bench clears hot and cold markers.</li>
          <li><strong>Halftime:</strong> all fatigue and markers reset at the start of Q3.</li>
          <li><strong>Second Wind</strong> ignores the penalty for one section and charges extra minutes afterwards.</li>
          <li>A player at <strong>−6 or worse</strong> cannot use Clutch Possession.</li>
        </ul>
      </Section>

      <Section id="crunch">
        <p>
          Crunch Time is the <strong>final section of Q4</strong>. It arms as that section begins if the
          margin is <strong>20 or less</strong>; the board shows a banner and the log records the margin
          either way. In a blowout the section is ordinary.
        </p>
        <ul>
          <li><strong>The timeout search:</strong> during your timeout you may take one crunch-only card from your deck into hand, even past the seven-card hand, and the deck is shuffled behind it. Once per timeout.</li>
          <li><strong>Clutch Possession:</strong> once per team, chosen at roll time. The player rolls <strong>2 dice</strong> and keeps the better; each MVP or Clutch Player of the Year award on the card adds a die. Not available at −6 fatigue or worse.</li>
          <li><strong>Extra defensive intensity:</strong> defenders with a positive Def Boost contest shot checks <strong>+1</strong> harder.</li>
          <li><strong>Timeout:</strong> one per team per game, Crunch Time only, and not until <strong>the other team has rolled</strong> in the section — your own roll does not open it. Play pauses, the team <strong>re-sets its defensive matchups</strong>, may <strong>search the deck</strong> for one crunch-only card, and the timeout-rider window opens.</li>
        </ul>

        <div className={s.sub}>Crunch-only cards</div>
        <ul>
          <li><strong>Desperation Press</strong> (trailing only): the next opposing top-tier scoring roll is re-rolled; the second result stands.</li>
          <li><strong>Second Closer:</strong> a second Clutch Possession this game, for a different player.</li>
          <li><strong>ATO Masterpiece</strong> (timeout rider): out of the huddle, a chosen player takes a 3PT or paint check at +2.</li>
          <li><strong>Fresh Legs</strong> (timeout rider): up to two chosen players each shed 4 minutes.</li>
          <li><strong>Ice the Hot Hand</strong> (timeout rider): strip all hot markers from one opposing player.</li>
          <li><strong>Reset</strong> (timeout rider): clear all cold markers from one of your players.</li>
          <li><strong>Unethical Hoops</strong> (the sign-up card): a player of yours with a Speed or Power advantage draws the foul — four free-throw checks, no bonus (a free throw carries its own +10).</li>
          <li><strong>Hack-A-____:</strong> foul an opponent who has not rolled. They skip their scoring roll and shoot two free throws at −3 instead (crunch-time pressure) — about 1.4 points off a shot line of 14 and 1.0 off an 18, against a scoring roll worth about 1.5, so pick the one whose roll you fear and whose free throws you don't.</li>
        </ul>
      </Section>

      <Section id="collection">
        <div className={s.sub}>Starting out</div>
        <ul>
          <li>The free <strong>Starter Pack</strong>: 20 players, 30 strategy cards, and Unethical Hoops.</li>
          <li>Before opening it you choose a <strong>favourite team</strong>, NBA or WNBA. The pack carries three commons and an uncommon from that team. The choice is permanent.</li>
        </ul>
        <div className={s.sub}>Cards and coins</div>
        <ul>
          <li>Games pay <strong>coins</strong>: 75 for finishing; a win bonus by the margin — 20 for a one-point win, rising evenly to 100 at 50 points; 15 for a loss by five or fewer or a tie; milestones by your own players (a triple-double, a 50-point game — the coach's do not count), and a daily first-win bonus. <strong>The coach's rung</strong> multiplies everything but the milestones: Settler 50%, Chieftain 70%, Warlord 85% on every game; Prince the standard rate; King 125% and Deity 150% on a <strong>win only</strong> — a loss from Prince up pays the standard rate — and only against a team the coach drew itself at that rung (a game against a team you built or a deck you picked for the coach, or a Quick Match, pays at most the standard rate). A league game pays at the lower of the league's rung and the rung it was played at. PvP pays 150%, win or lose. A game keeps the rung and the opponent it was dealt with, and is <strong>paid once</strong>, however often its results screen is reloaded. A season's title purse is paid by the <strong>share of your own games you played</strong>, regular season and playoffs: sim half of them and it pays half (a season with friends keeps its own rules). Coins buy packs — Booster 100, Deluxe 200, Super 300, Rare Deluxe 750, Super Deluxe 1,500, Mega Deluxe 3,000, a 36-pack Booster Box 3,000, Legendary Chase 6,000 — plus Division and Conference packs.</li>
          <li>Special sets (Super Season, Rookie, Summer Standouts, and the WNBA equivalents) appear in ordinary packs at reduced odds within their rarity band. Record Breakers deals only its blocks and steals records that way; its other cards are earned by feats (coming soon), never from a pack.</li>
          <li>A pulled card is a <strong>spare</strong> until you press <strong>Collect</strong>. Collected copies count towards set goals and their rewards; spare player cards can be <strong>listed</strong> on the market — at no less than the card's burn value — <strong>bought</strong>, or <strong>burned</strong> for coins. A <strong>strategy card</strong> cannot be burned by hand; a copy past the card's deck limit (5 common, 4 uncommon, 3 rare, 1 legendary) is burned for its coins as it arrives.</li>
          <li>Teams and decks are built from owned cards only. A team carries its own deck.</li>
        </ul>
        <div className={s.sub}>Modes</div>
        <ul>
          <li><strong>Quick Match:</strong> against the coach by salary band, or your team against a random opponent.</li>
          <li><strong>Hotseat:</strong> two managers, one screen.</li>
          <li><strong>Online PvP:</strong> a room with a live opponent; secret lineups, then the placement snake.</li>
          <li><strong>Season:</strong> a round-robin against the league — Short (everyone once), Regular (home and away) or Long (three meetings) — with standings, playoffs that advance themselves, and a title purse claimed at the end, paid by the share of your own games you played (a game you sim counts against it). When the regular season ends the league names its <strong>awards</strong> from regular-season games only: MVP, Sixth Player and Rookie of the Year by value over replacement, Defensive Player of the Year by the fewest points allowed per minute (at least 16 minutes a game over half their team's games), and the scoring title. A player's <strong>matchup +/-</strong> is their points minus what the player they guarded scored on them; a <strong>block</strong> is a miss their Defensive Bonus contest turned.</li>
          <li><strong>The Climb:</strong> a run of one-quarter games up three acts, each seven floors to a boss. <strong>Start:</strong> a coach rung and five or six owned players, one card a player, at most $2,200 in all — picked on the spot or from a <strong>Climb team</strong> saved in My Teams (a saved team that no longer qualifies says why). <strong>Training Camp:</strong> a playbook — Speed, Paint or Defense, sixteen cards: the core seven (High Screen &amp; Roll ×2, Switch the Screen, Veer Switch, Go Under, Overhelp, Burned on the Switch) and its nine, a crunch card among them — and one of three boons drawn from five (two picks after each of the next three wins; cut two starting cards; +$400 cap; a random rare card; a free Rest Day to take any time). <strong>In System:</strong> the playbook pays the players who fit it, by their numbers as they stand in the game (perks and cards included) — Speed: Speed 12+, +1 on their shot checks; Paint: Power 12+, +1 on their shot checks; Defense: Defense +1 or better, the checks taken against them −1; never a free throw, and the coach's team has no system. <strong>The map:</strong> three lanes, each stop leading to one or two above with no crossing paths; floor 1 all Games, floor 7 all Rest Days, and every path meets a Rivalry and a Rest Day on floors 2-6, never two Rest Days in a row; about one stop in six on floors 2-6 is a ❓ (a climb started before them keeps its map), and on a map drawn since 2026-10-27 one ❓ in four is a <strong>Makeup Game</strong>: a Game behind the ❓, whose scene's one choice, Play it, starts it, and which plays, pays and clears as a Game (at home), a loss ending the run. The boss is <strong>scouted from floor 1</strong>: its franchise, its best five by salary, its playbook, its style and the rares in its deck. <strong>Coaches' styles:</strong> every stop is its own franchise, and its coach plays that franchise's style, a strength and a hole, three franchises to a style — Seven Seconds (PHX, SAC, IND: their rolls +1 in the first section; they tire a minute faster each section), Grit and Grind (MEM, MIA, NYK: your paint checks −1; their 3PT checks −1), Splash (GSW, BOS, ATL: their 3PT checks +1; their whole team −1 Power), Bully Ball (CLE, MIN, NOP: their paint checks +1; their whole team −1 Speed), Heliocentric (DAL, LAL, MIL: their highest-paid player's rolls +2; their other starters' rolls −1), Bench Mob (TOR, SAS, UTA: a player of theirs who sits a section comes back fresh; their opening hand is a card short), Closers (LAC, CHI, DEN: their rolls +1 in Crunch Time; −1 in the first section), Glass Eaters (DET, OKC, POR: +1 rebound on each of their scoring rolls that scores nothing; their whole team −1 Speed), Pace and Space (CHA, HOU, ORL: their whole team +1 Speed; −1 Power) and Process (PHI, WAS, BKN: they draw a card more each section; their Defensive Bonus −1). Act I's Games play only the hole; a Rivalry, a boss and every game of Acts II and III play both. <strong>Full Strength:</strong> before an Act I or Act II boss you may take it at Full Strength — its strength's numbers doubled — and beating it adds one more strategy-card pick to its reward and offers the boss's perk from four. <strong>❓ stops:</strong> a scene drawn from the run's seed among those the run can play as it stands, each once a run; any choice clears the floor and raises the cap $450, as a Rest Day does, and "the next game" is the next one played. A player told to sit does so only while five are left to play; a coin flip's result is shown as you leave the scene. Trade Call (your lowest-paid player for one of three paid more than their card, whom the cap can take in their place; or hang up). Locker-Room Dispute (with six or more: your highest-paid player sits the next game, or every player carries 4 more minutes into it). Film Room (practise a card into its "+" from the map, or cut two). Two-Way Contract (one of three players at $250 or less, off the cap and the roster, plays with you for three games; or pass). Summer-League Tape (a random rare card and a <strong>Bad Contract</strong>, a dead card that is never played — put it back under the deck, or cut it at a Rest Day; or pass). Injury Scare (with six or more, a random player of yours: let them play it out, and half the time they miss the next game, half the time they start it with 2 hot markers; or rest them, and they sit it with a cleared tracker). Veteran Minimum (one of three players 32 or older at $600 or less, half their salary counted against the cap; or pass). Team Meeting (clear every tracker, or practise a card from the map). Front-Office Leak (the best three of every team on the next two floors shown on the map, or +$200 of cap). Hot Streak (ride your stars: a coin flip, your two highest-paid players start the next game with 2 hot markers each or with a cold marker each; or slow it down: every player of yours +1 Power and −1 Speed in it). Contract Year (a random player of yours +1 Speed and +1 Power for the run and $150 more on their salary, if the cap takes the raise; or not now). Back-to-Back (every player carries 4 more minutes into the next game and a win there pays a perk for sure; or, with six or more, your highest-paid player sits it and every tracker is cleared). Holdout (with six or more, one of your three highest-paid players: $200 more on their salary for the run, if the cap takes it; or they sit the next two games). Flu Bug (a random player of yours sits the next game, with six or more; or every player of yours −1 Speed and −1 Power in it). Budget Cuts ($300 less cap room; or one of your rare or "+" cards, at random, leaves the deck). <strong>Games:</strong> each starts at Q4 section 1 with your players' carried minutes on their trackers; the coach's team is a franchise sized like yours (five players at floors 1-2 up to seven at 5-6) at the floor's cap ($1,200, $1,250 and $1,350 for floors 1-3, then $2,000, $2,100 and $2,350, a Rivalry $250 more, all times the rung's cap), the boss a classic team of eight at $4,800 times the rung's cap; the coach plays its playbook's starter kit with one copy of each card for floors 1-3, adding 3, 5 and 6 cards from its archetype's deck on floors 4-6, and the boss plays its kit, one of each, plus three cards, none of them rare. <strong>Home court:</strong> a Game is at home, so the coach places first and you answer; a Rivalry and the boss are on the road, so you place first. <strong>After a win:</strong> the cap rises $450 (a Rest Day raises it too); every tracker comes down 10 minutes, 12 after a win by 10+, 14 after a win by 20+; take one of three strategy cards (two leaning to your playbook, a third from anywhere, half the time a Climb-only card while any are left; each rare with a chance rising from 10% at floor 1 to 45% at floor 7; a Rivalry always offers one rare; never a card already at its copy limit) or skip. A win may also drop a <strong>player</strong> for the run (a Game 50%; a Rivalry always) — one of three at three prices of your room; at a full roster, or with no one under the room, the three are priced against the room a release would make (your priciest player's salary on top) and signing one <strong>releases a player of yours</strong>, who leaves the run with their perks and fatigue — and a <strong>perk</strong> (a Game 10%, a Rivalry 70%); each time one does not come the next chance rises (10 points for a player, 5 for a perk), and each time one does it falls back (a Rivalry's sure player leaves the chance where it was). A roster tops out at ten. <strong>Perks</strong> last the run. A win's offer is three of these, never two of Extra Reps, Signature Move and Post Moves together. On a player: Gym Rat (+1 Power), Track Work (+1 Speed), Lockdown Drills (+1 Defensive Bonus), Extra Reps (Shot Line 1 better), Signature Move (+2 3PT Bonus), Post Moves (+2 Paint Bonus); no number on a player moves more than 3, and a released player takes theirs. Film Study: one copy to its "+" now. The team's, each taken once: Scouting Report (an eight-card opening hand every game), Fast Start (+1 on your scoring rolls in the game's first section), Closers (+1 on your scoring rolls in Crunch Time), Rim Deterrent (the first Paint check taken against you each game is at −3), Ball Movement Culture (every fifth strategy card you play in a game draws a card), Training Staff (every tracker 2 minutes lower after each win), Shootaround (resting at a Rest Day also leaves a practice on the map), Advance Scout (strategy-card rewards show four), Scouting Network (every Game win offers a player), Sponsorship (every win after it adds 20% more to the pot, priced by the server) and Travel Day (three times a run, go to any stop on the next floor, linked or not; the server counts them). <strong>A boss's reward</strong> offers its own three: Second Chance (once a run, a loss — a tie after the last overtime too — is replayed instead of ending the run; the pot stays), Win-Now Trade (+$900 of cap now; from then on a Rest Day practises or cuts, never rests), Max Contract (+2 Speed and +2 Power on a player; from then on a Game adds nothing to the pot, Rivalries and bosses still do), Heavy Minutes (+1 on your scoring rolls; every starter adds a minute each section), Short Rotation (a card past the seven as each section opens, and one more in the opening hand; at most two strategy cards a section) and Front Office Shake-Up (cut two copies and practise two, taken from the map). <strong>Climb-only cards</strong> are never in a pack and last the game they are played in: Let It Fly (your 3PT checks +1), Pace and Space (+1 Speed to everyone), Splash (your 3PT checks +1 for every two threes your team has made, up to +3), Bruise Crew (your paint checks +1), Weight Room (+3 Power on one player), Conditioning (fatigue costs nothing), Shut the Door (their paint checks −1), Chemistry (every screen after it sets up your next roll at +1, then +2, then +3), On Fire (three makes in a row puts a player On Fire: +3 on their checks until they miss), Stay Hot (two hot markers carry into the next game) and Ice Bath (after the game your fatigue is cleared; it then leaves your deck). <strong>Powers</strong> (set up in the matchup, once a game): Get Stops (each defense card you play after it is +1 Rebound to your top rebounder on the floor), Talk on Defense (each Switch the Screen, Veer Switch, Switch Everything, Go Under or Fight Over is +1 Speed on defense for all five that section), Ball Movement (each made 3PT check is +1 Assist, to the teammate with the most assists; a Challenge takes it back), Wear Them Down (each made paint check is −1 Power for the game on the defender, three at most each) and Film Session (one card past the seven as each section opens). <strong>Signature Set</strong> (before the player rolls): +2 to their scoring roll this section; each game it is played in adds 1 for the rest of the run, up to +6. <strong>Leave It All Out There</strong> (matchup): +3 to every player's scoring roll this section; the copy leaves the deck after the game. <strong>Grind cards</strong> cost minutes, added to the tracker at the end of the section: Up-Tempo (draw 2; every starter +1), Ride Your Star (+4 to the highest-salary starter, who must still be to roll; +3), Full-Court Press (+3 Speed on defense for all five; +2 each), Crash Every Board (+3 Rebounds, credited to the two highest-Power starters; +2 each to them), Play Through Contact (a player with a Power edge takes a Paint check at +3, a hot marker on a make; +3) and Two-a-Days (matchup; after the game every player carries 4 more minutes, and a practice waits on the map; the copy leaves the deck). <strong>Rest Day:</strong> clear every tracker, upgrade one copy of a card to its "+" (every card a run can offer has one; the legendaries do not), or cut one copy from the deck for good (a deck keeps at least seven). <strong>Run It Back</strong> (a "+" rider): after the copy is played it goes back into the deck at a random place, so it can be drawn again that game. <strong>Innate</strong>: the copy starts the game in the opening hand. Conditioning+ covers the next game too, Stay Hot+ carries three markers, and Ice Bath+ stays in the deck. <strong>The pot:</strong> a Game adds 30 + 5 per floor above the first, a Rivalry 70, a boss 120, times the act's rate (Act I 1×, Act II 1.5×, Act III 2×) and the rung's pay; each beaten boss adds its rung's pack for its act — Settler none, none, a Booster; Chieftain none, a Booster, a Deluxe; Warlord a Booster, a Deluxe, a Rare Deluxe; Prince a Booster, a Rare Deluxe, a Super Deluxe; King a Booster, a Rare Deluxe, a Mega Deluxe; Deity a Rare Deluxe, a Super Deluxe, a Mega Deluxe (a climb started before 2026-10-27 keeps a Booster, a Rare Deluxe and a Mega Deluxe at every rung); it is priced and paid by the server, once, when you retire between stops or bank after a boss. <strong>Acts:</strong> beating the Act I or Act II boss offers <strong>take the pot and stop</strong> (bank) or <strong>keep climbing</strong>: the next act's map (seven floors, the same rules), every tracker cleared, the cap up $450, and the boss's reward — three strategy cards with the third rare, a player and a boss's perk, all sure. Act II: Game caps $3,900 to $5,700 (a Rivalry $400 more), teams of six to eight, the coach's kit with its doubles and 4 to 9 cards from its fifty, rares included; its boss a classic team of nine at $9,600 with 6 more cards; rare rewards 45% to 65%. Act III is played against <strong>classic teams</strong>, Games as well as the boss: Game caps $8,000 to $10,300 (a Rivalry $500 more), eight to ten deep, 8 to 12 cards; its boss a classic team of eleven at $14,000 with 9 more cards; rare rewards 65% to 85%. All caps times the rung's cap. Acts II and III set them as shares of the most you can field there (the starting $2,200 plus $450 for every stop before it, boons aside): Act II's Games about two-thirds of it and its boss 107%, Act III's Games about seven-eighths and its boss 112% — Act I's Games run about half and its boss 90%. Each act's boss is a different franchise, scouted from that act's first floor. Beating Act III's boss completes the climb. Every run game also pays a quarter of a game as it ends, win or lose. A loss in any act, or a tie after the last overtime, ends the run and forfeits the whole pot; a game that is started and never finished keeps the pot from banking.</li>
          <li><strong>Dynasty:</strong> ten seasons in one league on a <strong>Dynasty Point payroll</strong>: a <strong>100-DP cap</strong>, and a <strong>130-DP apron</strong> that only your own expiring players, your draft picks, minimum deals and waiver claims may take you up to. A brought team arrives on real contracts with no cap check — over the apron, you shed salary before you can re-sign anyone. AI teams arrive <strong>under the 100 cap</strong> and may re-sign up to <strong>115</strong>; a league above Prince scales both by the rung's cap. AI teams must <strong>also</strong> keep their roster's <strong>card salary under $5,500 × the rung</strong> (the Team Builder cap: $5,500 up to Prince, $5,775 at King, $6,160 at Deity) through every draft pick, signing, re-signing, waiver claim and trade, keeping room as it goes — for the cards its coming picks are projected to carry (the class card at each pick's projected slot), for its unsigned picks, and $150 for each seat it is still short of eight — and an AI team already over it adds no salary until it is back under; nobody is cut. The one way past it is the floor: an AI team short of eight with no room left fills the seat with the cheapest card there is, free agent or camp invite. Your team answers to DP alone. A dynasty game's coach plays, and is paid, at the league's rung, not this device's difficulty — the Coach picker beside Play does not reach a dynasty game. Trades: each side keeps to its own apron (a side already past it may only come down or stay even, and an AI team only down — taking any DP back, it sends out more), and a side over its cap after the deal takes back at most <strong>125%</strong> of the DP it sends out. <strong>The draft:</strong> each offseason's class is two a team plus four, drawn from the draft pool a year ahead (the players a pick is valued on in a trade are the players really in it), by rarity — a legendary at 15% (never two), a super-rare at 60% and a second after it at 25% (two super-rares in about 15% of classes), one rare guaranteed then more at 60/35/15%, the rest uncommon or common at even odds — and two rounds are drafted after a lottery scaled from the NBA's. <strong>The rookie scale</strong> is the slot's, not the player's: round one slides from 10 DP at the first pick to 5 at the last, round two from 3 to 2, three years each. <strong>Rights:</strong> a drafted player is their team's rights until the season starts, signable at the scale any time before while they fit under that team's apron (130 for you, 115 for an AI team) — except that an AI team short of eight players drafts and signs a pick past its apron rather than fill that seat with a free agent past it; nothing is renounced at the draft, and whoever is still unsigned at tip-off lapses to free agency. AI teams draft only a pick their books can sign, hold room for their picks when they re-sign, and with a full roster may shed their weakest player at the deadline to sign a better one. <strong>Waivers:</strong> a waived player's DP is booked as dead money for the season and they go on the waiver wire until the league next moves on — the next phase, the next week of free agency, or in season the next round. Then the teams are asked in waiver priority, worst record of the most recent regular season first (a seeded order before any season), never the team that waived them: an AI team claims when their contract fits under its apron with a roster spot and is worth more than it costs; a coach claims only if they put in a claim, and only while they fit under their 130 apron with a roster spot. The first to claim takes the contract as it stands and <strong>the dead money comes off the waiving team's books</strong>; unclaimed, the dead money stays and they are a free agent. An AI team's deadline shed goes through waivers too. <strong>Roster relief:</strong> a side of a trade that would end above ten players waives its weakest (least talent, then worst contract) as part of the deal — one player at most, never one coming in or going out; they go on waivers as any waived player, and their DP stays on that side's books as dead money unless they are claimed, so it counts in that side's apron check. A coach sees the cut in the deal before making it; an AI side takes it only if the deal still clears its edge with the player counted as given up. <strong>The AI's trades:</strong> at three points of each offseason (the close of re-signing, the close of free agency, and the start of the season) the AI teams search every pairing among themselves — a team over its cap shedding DP, a team short of eight filling a seat, a contender sending picks to a rebuilder for a player, and one-for-one and two-for-one swaps — and make a deal only when both sides clear the edge the AI asks of a coach, the best first, one a team at each point, three in all an offseason. <strong>Offers to you:</strong> each turn of the offseason (a phase, a day or week of free agency) and each round of the regular season up to the deadline, every AI team weighs the same kinds of deal with each coach and keeps its best that is legal, that it would take itself, and that gives the coach at least 90% of what they give by the coach's own team's needs — a deal you turned down or let lapse is not made again that year. The three best league-wide are posted; each lapses at the next turn, and accepting one checks the rules and the AI's mind again, since the league may have moved — an offer that no longer stands shows why and cannot be accepted. <strong>With friends:</strong> a trade between coaches is an offer the other coach accepts or declines; the commissioner can veto it while it is open, or undo it until the next phase while every piece is still where it put them. A trade with an AI team — made at the desk or by accepting its offer — is not the commissioner's to veto. A coach may have ten offers waiting at once, and the same deal only once.</li>
          <li><strong>Aging dynasty:</strong> no tenth-year finish; it runs until it is ended between seasons. Every player is a year older at each turn of the year, and anyone in the league aged 35 or more rolls to retire: (age − 34) in 6, so certain at 40 (Sports Science shifts a coach's players later, and Prime Extension skips one player's roll). A retiring player's contract or rights end with them, with no dead money, and they never return. <strong>Retirements are the first step of the offseason</strong>, ahead of the re-signing window: the league has already rolled, re-signed its AI teams and posted its offers, and the step shows who went (the coach's own first, with the deal that went with them) and which of the coach's players face the roll at the next turn. With friends, every coach readies past it. Age never changes a card; asks fall past 31.</li>
          <li><strong>Franchise Points:</strong> banked as a year closes — the regular-season finish (first of N is 10, last 0, straight between), 3 a playoff series won, 10 for the title — times the coach rung's pay factor, rounded. Spent in the offseason (draftee signing through the preseason) to bring a card the coach owns into the league: common 2, uncommon 4, rare 8, super-rare 16, legendary 32; the player signs at their value for two years under the 100-DP cap, needs a roster seat, and must not already be in the league. AI teams never import. The strategy deck is not frozen: a coach changes it in any phase, and a live season's fixtures read the change.</li>
        </ul>
        <p>A game in progress is saved on every change and restored on reload.</p>
      </Section>

      <Section id="glossary">
        <div className={s.glossary}>
          <div className={s.glossaryTerm}>Speed / Power</div>
          <div className={s.glossaryDef}>The attributes a matchup compares. The larger advantage is the roll bonus; cards reading "Speed or Power" read the larger one.</div>

          <div className={s.glossaryTerm}>Matchup</div>
          <div className={s.glossaryDef}>The two players in a placement row. Moved only by a switching card or the crunch timeout.</div>

          <div className={s.glossaryTerm}>Def Boost</div>
          <div className={s.glossaryDef}>Positive: neutralises the attacker's advantages (never below zero) and contests their 3PT and paint checks. Negative: a hole in the defender's own numbers.</div>

          <div className={s.glossaryTerm}>Roll Bonus</div>
          <div className={s.glossaryDef}>The modifier on a scoring roll: matchup, fatigue, markers, cards.</div>

          <div className={s.glossaryTerm}>Shot Line</div>
          <div className={s.glossaryDef}>What a shot check must reach, tie or better. Marked by the arrow on the chart.</div>

          <div className={s.glossaryTerm}>Shot Check</div>
          <div className={s.glossaryDef}>A D20 given by a card or a spend. 3PT = 3 pts, paint = 2, free throw = 1 (at +10, never contested).</div>

          <div className={s.glossaryTerm}>Announced Check</div>
          <div className={s.glossaryDef}>A 3PT or paint check declared before it is rolled, so the defence can react.</div>

          <div className={s.glossaryTerm}>Top Tier</div>
          <div className={s.glossaryDef}>A roll that reaches the last row of the chart. Heat Check and Desperation Press key off it.</div>

          <div className={s.glossaryTerm}>Hot / Cold Marker</div>
          <div className={s.glossaryDef}>+2 / −2 per marker. From natural 19–20 / 1–2. Cleared on the bench or at halftime.</div>

          <div className={s.glossaryTerm}>Card Window</div>
          <div className={s.glossaryDef}>The matchup or scoring phase before rolling. Playing hands the turn over; two passes in a row close it. The home side (the one that answers in the snake) opens every scoring phase.</div>

          <div className={s.glossaryTerm}>Standing Card</div>
          <div className={s.glossaryDef}>A card in effect for the whole section while its players are on the floor (Twin Towers, Run the Floor).</div>

          <div className={s.glossaryTerm}>Fatigue</div>
          <div className={s.glossaryDef}>4 minutes per section played. 8+ = −2, 12+ = −6, 16 = −12 and −6 more per section after that. A section on the bench clears a tracker at 8 or under, and takes 4 off above that (12 rests to 8).</div>

          <div className={s.glossaryTerm}>Snake</div>
          <div className={s.glossaryDef}>The placement order A-B-B-A-A-B-B-A-A-B — the visitor leads in a season, Team A in a sandbox game.</div>

          <div className={s.glossaryTerm}>Section</div>
          <div className={s.glossaryDef}>One of 3 per quarter, 12 per game: lineup pick, placement, matchup window, scoring window, rolling.</div>

          <div className={s.glossaryTerm}>Crunch Time</div>
          <div className={s.glossaryDef}>The final section when the margin is 20 or less as it starts.</div>

          <div className={s.glossaryTerm}>Clutch Possession</div>
          <div className={s.glossaryDef}>2 dice plus award dice, keep the best. Once per team in Crunch Time; Second Closer grants another.</div>

          <div className={s.glossaryTerm}>Timeout</div>
          <div className={s.glossaryDef}>One per game, Crunch Time only. Re-set the defence and open the rider window.</div>

          <div className={s.glossaryTerm}>Salary Cap</div>
          <div className={s.glossaryDef}>$5,500 across 10 players.</div>
        </div>
      </Section>
    </div>
  );
}
