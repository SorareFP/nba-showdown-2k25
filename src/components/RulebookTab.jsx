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
          <li><strong>Lineups and placement:</strong> each section both managers pick five in secret and lock them, then place them one at a time in the snake <strong>A-B-B-A-A-B-B-A-A-B</strong>; the row a player lands in is their matchup. Leading a row gives information away, so in a season the <strong>visitor places first</strong> and the home side answers; a sandbox game has Team A lead.</li>
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
          <li>A player blocked by This Is My House or Hack-A-____ does not roll. A player whose roll a card replaced (You Stand Over There) counts as rolled.</li>
          <li>This Is My House needs the defender <strong>higher</strong> on both Speed and Power, counted as they guard: a minus Defense lowers both, and card effects count. A tie is not higher.</li>
        </ul>

        <div className={s.sub}>6. End of Section</div>
        <ul>
          <li>A player sent off by <strong>Foul Trouble</strong> is not in the pool for the next section — the whole section, both ends of the floor — and they are back the section after.</li>
          <li>All temporary effects clear (boosts, ghosts, blocks, standing cards whose players left the floor).</li>
          <li>Each starter adds <strong>4 minutes</strong>; a section on the bench <strong>clears</strong> a tracker at 8 minutes or under and takes <strong>4 minutes</strong> off above that.</li>
          <li>The rebound track (rebounds won, not what is left to spend) pays: the leader gains +1 stored assist, and a lead of 3 or more puts its next rebound paint check at +2.</li>
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
          <strong> Coach's Challenge</strong> re-rolls an opponent's shot check, at most twice per game per team.
          <strong> Crunch-only</strong> cards can be played only while Crunch Time is active.
        </div>

        <div className={s.sub}>Decks</div>
        <ul>
          <li><strong>50 cards.</strong> Per-card copies: <strong>5 common, 4 uncommon, 3 rare, 1 legendary</strong>. The Deck Builder refuses to save a deck over a cap.</li>
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
          <li>A 3PT or paint check is <strong>announced</strong> first; the defence may react (Close Out: −3 to a 3PT check and a cold marker on a miss; Blitz: the offense gives a 3PT or paint check to another player on the floor, same card bonus, and it does not use up the defence's one other answer; Coach's Challenge: re-roll).</li>
          <li>The log itemises every check: die, card bonus, shooting bonus, markers, and the line it had to reach.</li>
        </ul>

        <div className={s.sub}>Assist Track</div>
        <p>Assists accumulate across the game and can be spent:</p>
        <ul>
          <li><strong>1 AST:</strong> +1 to a player's next shot check.</li>
          <li><strong>5 AST:</strong> a 3PT check for any player; their 3PT Bonus, either sign, applies. The button shows the die he needs.</li>
          <li><strong>5 AST:</strong> a paint check for any player; their Paint Bonus applies the same way.</li>
          <li><strong>Reaching 5 for the first time</strong> draws a bonus strategy card.</li>
        </ul>

        <div className={s.sub}>Rebound Track</div>
        <p>Rebounds count twice. The <strong>track</strong> is the differential of rebounds <strong>won</strong> this game; spending never moves it, and a cancelled rebound (Box Out, Cold Spell, Offensive Foul) comes off it. The <strong>bank</strong> is what a team holds, spent like assists:</p>
        <ul>
          <li><strong>5 REB:</strong> a paint check for any player, at any time; their Paint Bonus applies.</li>
        </ul>
        <p>At section end the <strong>track</strong> pays:</p>
        <ul>
          <li><strong>Leading:</strong> +1 stored assist.</li>
          <li><strong>Leading by 3 or more:</strong> the next rebound paint check is at <strong>+2</strong>.</li>
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
          <li><strong>Hack-A-____:</strong> foul an opponent who has not rolled. They skip their scoring roll and shoot four free throws instead — worth about 3.4 points off a shot line of 14 and about 2.2 off a 19, so pick the one who cannot make them.</li>
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
          <li>Special sets (Super Season, Rookie, Summer Standouts, and the WNBA equivalents) appear in ordinary packs at reduced odds within their rarity band.</li>
          <li>A pulled card is a <strong>spare</strong> until you press <strong>Collect</strong>. Collected copies count towards set goals and their rewards; spares can be <strong>listed</strong> on the market — at no less than the card's burn value — <strong>bought</strong>, or <strong>burned</strong> for coins.</li>
          <li>Teams and decks are built from owned cards only. A team carries its own deck.</li>
        </ul>
        <div className={s.sub}>Modes</div>
        <ul>
          <li><strong>Quick Match:</strong> against the coach by salary band, or your team against a random opponent.</li>
          <li><strong>Hotseat:</strong> two managers, one screen.</li>
          <li><strong>Online PvP:</strong> a room with a live opponent; secret lineups, then the placement snake.</li>
          <li><strong>Season:</strong> a round-robin against the league — Short (everyone once), Regular (home and away) or Long (three meetings) — with standings, playoffs that advance themselves, and a title purse claimed at the end, paid by the share of your own games you played (a game you sim counts against it). When the regular season ends the league names its <strong>awards</strong> from regular-season games only: MVP, Sixth Player and Rookie of the Year by value over replacement, Defensive Player of the Year by the fewest points allowed per minute (at least 16 minutes a game over half their team's games), and the scoring title. A player's <strong>matchup +/-</strong> is their points minus what the player they guarded scored on them; a <strong>block</strong> is a miss their Defensive Bonus contest turned.</li>
          <li><strong>Dynasty:</strong> ten seasons in one league on a <strong>Dynasty Point payroll</strong>: a <strong>100-DP cap</strong>, and a <strong>130-DP apron</strong> that only your own expiring players, your draft picks, minimum deals and waiver claims may take you up to. A brought team arrives on real contracts with no cap check — over the apron, you shed salary before you can re-sign anyone. AI teams arrive <strong>under the 100 cap</strong> and may re-sign up to <strong>115</strong>; a league above Prince scales both by the rung's cap. AI teams must <strong>also</strong> keep their roster's <strong>card salary under $5,500 × the rung</strong> (the Team Builder cap: $5,500 up to Prince, $5,775 at King, $6,160 at Deity) through every draft pick, signing, re-signing, waiver claim and trade, keeping room as it goes — for the cards its coming picks are projected to carry (the class card at each pick's projected slot), for its unsigned picks, and $150 for each seat it is still short of eight — and an AI team already over it adds no salary until it is back under; nobody is cut. The one way past it is the floor: an AI team short of eight with no room left fills the seat with the cheapest card there is, free agent or camp invite. Your team answers to DP alone. A dynasty game's coach plays, and is paid, at the league's rung, not this device's difficulty — the Coach picker beside Play does not reach a dynasty game. Trades: each side keeps to its own apron (a side already past it may only come down or stay even, and an AI team only down — taking any DP back, it sends out more), and a side over its cap after the deal takes back at most <strong>125%</strong> of the DP it sends out. <strong>The draft:</strong> each offseason's class is two a team plus four, drawn from the draft pool a year ahead (the players a pick is valued on in a trade are the players really in it), by rarity — a legendary at 15% (never two), a super-rare at 60% and a second after it at 25% (two super-rares in about 15% of classes), one rare guaranteed then more at 60/35/15%, the rest uncommon or common at even odds — and two rounds are drafted after a lottery scaled from the NBA's. <strong>The rookie scale</strong> is the slot's, not the player's: round one slides from 10 DP at the first pick to 5 at the last, round two from 3 to 2, three years each. <strong>Rights:</strong> a drafted player is his team's rights until the season starts, signable at the scale any time before while he fits under that team's apron (130 for you, 115 for an AI team) — except that an AI team short of eight players drafts and signs a pick past its apron rather than fill that seat with a free agent past it; nothing is renounced at the draft, and whoever is still unsigned at tip-off lapses to free agency. AI teams draft only a pick their books can sign, hold room for their picks when they re-sign, and with a full roster may shed their weakest player at the deadline to sign a better one. <strong>Waivers:</strong> a waived player's DP is booked as dead money for the season and he goes on the waiver wire until the league next moves on — the next phase, the next week of free agency, or in season the next round. Then the teams are asked in waiver priority, worst record of the most recent regular season first (a seeded order before any season), never the team that waived him: an AI team claims when his contract fits under its apron with a roster spot and is worth more than it costs; a coach claims only if they put in a claim, and only while he fits under their 130 apron with a roster spot. The first to claim takes the contract as it stands and <strong>the dead money comes off the waiving team's books</strong>; unclaimed, the dead money stays and he is a free agent. An AI team's deadline shed goes through waivers too. <strong>Roster relief:</strong> a side of a trade that would end above ten players waives its weakest (least talent, then worst contract) as part of the deal — one man at most, never one coming in or going out; he goes on waivers as any waived player, and his DP stays on that side's books as dead money unless he is claimed, so it counts in that side's apron check. A coach sees the cut in the deal before making it; an AI side takes it only if the deal still clears its edge with the man counted as given up. <strong>The AI's trades:</strong> at three points of each offseason (the close of re-signing, the close of free agency, and the start of the season) the AI teams search every pairing among themselves — a team over its cap shedding DP, a team short of eight filling a seat, a contender sending picks to a rebuilder for a player, and one-for-one and two-for-one swaps — and make a deal only when both sides clear the edge the AI asks of a coach, the best first, one a team at each point, three in all an offseason. <strong>Offers to you:</strong> each turn of the offseason (a phase, a day or week of free agency) and each round of the regular season up to the deadline, every AI team weighs the same kinds of deal with each coach and keeps its best that is legal, that it would take itself, and that gives the coach at least 90% of what they give by the coach's own team's needs — a deal you turned down or let lapse is not made again that year. The three best league-wide are posted; each lapses at the next turn, and accepting one checks the rules and the AI's mind again, since the league may have moved — an offer that no longer stands shows why and cannot be accepted. <strong>With friends:</strong> a trade between coaches is an offer the other coach accepts or declines; the commissioner can veto it while it is open, or undo it until the next phase while every piece is still where it put them. A trade with an AI team — made at the desk or by accepting its offer — is not the commissioner's to veto. A coach may have ten offers waiting at once, and the same deal only once.</li>
          <li><strong>Franchise Points:</strong> banked as a year closes — the regular-season finish (first of N is 10, last 0, straight between), 3 a playoff series won, 10 for the title — times the coach rung's pay factor, rounded. Spent in the offseason (draftee signing through the preseason) to bring a card the coach owns into the league: common 2, uncommon 4, rare 8, super-rare 16, legendary 32; the player signs at his value for two years under the 100-DP cap, needs a roster seat, and must not already be in the league. AI teams never import. The strategy deck is not frozen: a coach changes it in any phase, and a live season's fixtures read the change.</li>
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
          <div className={s.glossaryDef}>The matchup or scoring phase before rolling. Playing hands the turn over; two passes in a row close it.</div>

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
