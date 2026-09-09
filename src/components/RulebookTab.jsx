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
          Most points after 12 wins.
        </p>
      </Section>

      <Section id="setup">
        <ul>
          <li><strong>Team:</strong> <strong>10 players</strong> under a <strong>$5,500 salary cap</strong>. Five start each section; five rest.</li>
          <li><strong>Deck:</strong> <strong>50 strategy cards</strong>. Copies per card are capped by rarity — 5 common, 4 uncommon, 3 rare, 1 legendary. Shuffle, draw <strong>7</strong>.</li>
          <li><strong>Lineups and placement:</strong> each section both managers pick five in secret and lock them, then place them one at a time in the snake <strong>A-B-B-A-A-B-B-A-A-B</strong>; the row a player lands in is their matchup.</li>
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
          <li>Two passes in a row open rolling.</li>
        </ul>

        <div className={s.sub}>5. Rolling</div>
        <ul>
          <li>Rolling <strong>alternates</strong>, one player at a time, the human leading against the coach. A side with nobody left to roll stands aside.</li>
          <li>Between rolls either side may play <strong>pre-roll</strong> cards on a player who has not rolled, and <strong>reactions</strong> to what just happened.</li>
          <li>A player blocked by This Is My House does not roll. A player whose roll a card replaced (You Stand Over There) counts as rolled.</li>
        </ul>

        <div className={s.sub}>6. End of Section</div>
        <ul>
          <li>All temporary effects clear (boosts, ghosts, blocks, standing cards whose players left the floor).</li>
          <li>Each starter adds <strong>4 minutes</strong>; each benched player sheds <strong>4 minutes</strong>.</li>
          <li>The rebound track pays: the leader gains +1 stored assist.</li>
          <li>Both hands refill to <strong>7</strong>.</li>
          <li>At halftime (start of Q3) all fatigue and all hot and cold markers reset.</li>
          <li>Entering the final section, Crunch Time arms if the margin is 20 or less.</li>
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
          <li>When Crunch Time arms, every crunch-only card still in the deck is drawn to hand, even past 7.</li>
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
          <li>A 3PT or paint check is <strong>announced</strong> first; the defence may react (Close Out: −3 to a 3PT check and a cold marker on a miss; Coach's Challenge: re-roll).</li>
          <li>The log itemises every check: die, card bonus, shooting bonus, markers, and the line it had to reach.</li>
        </ul>

        <div className={s.sub}>Assist Track</div>
        <p>Assists accumulate across the game and can be spent:</p>
        <ul>
          <li><strong>1 AST:</strong> +1 to a player's next shot check.</li>
          <li><strong>5 AST:</strong> a 3PT check for any player; his 3PT Bonus, either sign, applies. The button shows the die he needs.</li>
          <li><strong>5 AST:</strong> a paint check for any player; his Paint Bonus applies the same way.</li>
          <li><strong>Reaching 5 for the first time</strong> draws a bonus strategy card.</li>
        </ul>

        <div className={s.sub}>Rebound Track</div>
        <p>Rebounds accumulate; the <strong>differential</strong> pays:</p>
        <ul>
          <li><strong>Leading at section end:</strong> +1 stored assist.</li>
          <li><strong>Leading by 3 or more:</strong> a second-chance paint check, for <strong>5 REB</strong>.</li>
        </ul>
      </Section>

      <Section id="fatigue">
        <p>Every section on the floor adds <strong>4 minutes</strong>. The penalty applies to scoring rolls and shot checks alike:</p>
        <div className={s.highlight}>
          <strong>8+ minutes:</strong> −2<br/>
          <strong>12+ minutes:</strong> −6<br/>
          <strong>16+ minutes:</strong> −12
        </div>
        <ul>
          <li><strong>Rest:</strong> a section on the bench takes <strong>4 minutes</strong> off. Play and rest are symmetric: 12 rests to 8 (still −2), and three sections off return a player to fresh.</li>
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
          <li><strong>Crunch cards to hand:</strong> when it arms, every crunch-only card still in either deck is drawn, even past the seven-card hand.</li>
          <li><strong>Clutch Possession:</strong> once per team, chosen at roll time. The player rolls <strong>2 dice</strong> and keeps the better; each MVP or Clutch Player of the Year award on the card adds a die. Not available at −6 fatigue or worse.</li>
          <li><strong>Extra defensive intensity:</strong> defenders with a positive Def Boost contest shot checks <strong>+1</strong> harder.</li>
          <li><strong>Timeout:</strong> one per team per game, Crunch Time only. Play pauses, the team <strong>re-sets its defensive matchups</strong>, and the timeout-rider window opens.</li>
        </ul>

        <div className={s.sub}>Crunch-only cards</div>
        <ul>
          <li><strong>Desperation Press</strong> (trailing only): the next opposing top-tier scoring roll is re-rolled; the second result stands.</li>
          <li><strong>Second Closer:</strong> a second Clutch Possession this game, for a different player.</li>
          <li><strong>ATO Masterpiece</strong> (timeout rider): out of the huddle, a chosen player takes a 3PT or paint check at +2.</li>
          <li><strong>Fresh Legs</strong> (timeout rider): up to two chosen players each shed 4 minutes.</li>
          <li><strong>Ice the Hot Hand</strong> (timeout rider): strip all hot markers from one opposing player.</li>
          <li><strong>Reset</strong> (timeout rider): clear all cold markers from one of your players.</li>
          <li><strong>Unethical Hoops</strong> (the sign-up card): a player of yours with a Speed or Power advantage draws the foul — four free-throw checks at +4.</li>
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
          <li>Games pay <strong>coins</strong>: wins, milestones, and a daily first-win bonus. Coins buy packs — Booster 100, Deluxe 200, Super 300, Rare Deluxe 750, Super Deluxe 1,500, Mega Deluxe 3,000, a 36-pack Booster Box 3,000, Legendary Chase 6,000 — plus Division and Conference packs.</li>
          <li>Special sets (Super Season, Rookie, Summer Standouts, and the WNBA equivalents) appear in ordinary packs at reduced odds within their rarity band.</li>
          <li>A pulled card is a <strong>spare</strong> until you press <strong>Collect</strong>. Collected copies count towards set goals and their rewards; spares can be <strong>listed</strong> on the market — at no less than the card's burn value — <strong>bought</strong>, or <strong>burned</strong> for coins.</li>
          <li>Teams and decks are built from owned cards only. A team carries its own deck.</li>
        </ul>
        <div className={s.sub}>Modes</div>
        <ul>
          <li><strong>Quick Match:</strong> against the coach by salary band, or your team against a random opponent.</li>
          <li><strong>Hotseat:</strong> two managers, one screen.</li>
          <li><strong>Online PvP:</strong> a room with a live opponent; secret lineups, then the placement snake.</li>
          <li><strong>Season:</strong> a round-robin against the league — Short (everyone once), Regular (home and away) or Long (three meetings) — with standings, playoffs that advance themselves, and a title purse claimed at the end.</li>
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
          <div className={s.glossaryDef}>4 minutes per section played. 8+ = −2, 12+ = −6, 16+ = −12. A section on the bench sheds 4.</div>

          <div className={s.glossaryTerm}>Snake</div>
          <div className={s.glossaryDef}>The placement order A-B-B-A-A-B-B-A-A-B.</div>

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
