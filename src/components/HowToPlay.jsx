// src/components/HowToPlay.jsx
//
// THE RULES AS THE ENGINE PLAYS THEM. Every number here is read off engine.js
// (fatigueForMinutes, REST_RECOVERY, SPEND_COSTS, CRUNCH_MARGIN, SNAKE,
// clutchDiceFor), rarity.js (STRAT_COPY_CAPS) and packEngine.js (PACK_TYPES).
// When a rule moves, move it here the same day — the 2026-09-07 rewrite found
// this page still describing free defensive assignment, automatic And-Ones,
// 8-minute rest and a Crunch Time that was "coming soon".
import { useState, useRef, useEffect } from 'react';
import s from './HowToPlay.module.css';

const SECTIONS = [
  { id: 'overview',   title: 'Overview & Winning' },
  { id: 'team',       title: 'Building Your Team' },
  { id: 'draft',      title: 'Lineups, then Placement' },
  { id: 'matchup',    title: 'Matchup Card Window' },
  { id: 'scoring',    title: 'Scoring Window & Rolling' },
  { id: 'checks',     title: 'Shot Checks' },
  { id: 'cards',      title: 'Strategy Cards & Your Deck' },
  { id: 'assists',    title: 'Assists, Rebounds & Spends' },
  { id: 'fatigue',    title: 'Fatigue & Substitutions' },
  { id: 'crunch',     title: 'Crunch Time' },
  { id: 'collection', title: 'Your Collection & Game Modes' },
  { id: 'glossary',   title: 'Glossary' },
];

function AccordionSection({ id, title, open, onToggle, children }) {
  const contentRef = useRef(null);
  return (
    <div className={`${s.section} ${open ? s.open : ''}`} id={`rules-${id}`}>
      <button className={s.sectionHeader} onClick={onToggle} aria-expanded={open}>
        <span className={s.sectionTitle}>{title}</span>
        <span className={s.chevron}>{open ? '▾' : '▸'}</span>
      </button>
      <div className={s.sectionBody} ref={contentRef} style={{ maxHeight: open ? contentRef.current?.scrollHeight + 'px' : '0' }}>
        <div className={s.sectionContent}>{children}</div>
      </div>
    </div>
  );
}

export default function HowToPlay({ scrollToSection, onStartTutorial, tutorialRunning = false }) {
  const [openSections, setOpenSections] = useState(new Set());

  // Deep-link: scroll to and open a specific section
  useEffect(() => {
    if (scrollToSection) {
      setOpenSections(prev => new Set([...prev, scrollToSection]));
      setTimeout(() => {
        const el = document.getElementById(`rules-${scrollToSection}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [scrollToSection]);

  const toggle = (id) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const sec = (id) => ({ id, title: SECTIONS.find(x => x.id === id).title, open: openSections.has(id), onToggle: () => toggle(id) });

  return (
    <div className={s.wrap}>
      {/* Hero: Tutorial Launcher */}
      <div className={s.hero}>
        <h1 className={s.heroTitle}>How to Play</h1>
        <p className={s.heroSub}>NBA Showdown 2026 — D20 Basketball Card Game</p>
        <div className={s.tutorialCard}>
          <div className={s.tutorialInfo}>
            <h2>{tutorialRunning ? 'Your tutorial is waiting' : 'Interactive Tutorial'}</h2>
            <p>{tutorialRunning
              ? 'The game is paused exactly where you left it. Read what you came for, then head back.'
              : 'Learn by playing a guided quarter against the coach. Covers the placement draft, the card windows, rolling, fatigue and substitutions.'}</p>
            {!tutorialRunning && <span className={s.tutorialTime}>~12–15 minutes</span>}
          </div>
          <button className={s.tutorialBtn} onClick={onStartTutorial}>
            {tutorialRunning ? '← Back to the tutorial' : 'Play Tutorial'}
          </button>
        </div>
      </div>

      {/* Accordion Rules */}
      <div className={s.rules}>
        <AccordionSection {...sec('overview')}>
          <p>NBA Showdown 2026 pits two managers against each other. Build a 10-player roster under the salary cap, then play <strong>4 quarters</strong> of <strong>3 four-minute sections</strong> each — 12 sections in all.</p>
          <p>Every section runs the same way: a secret <strong>lineup pick</strong>, a <strong>placement snake</strong> that decides who guards whom, a <strong>matchup card window</strong>, a <strong>scoring card window</strong>, then <strong>rolling</strong> — each of your five starters rolls a D20, modified by their matchup, fatigue, markers and cards, and reads the result off their scoring chart.</p>
          <p>Most points after 12 sections wins. If the final section starts with the score within 20, it is <strong>Crunch Time</strong> and its own rules apply.</p>
        </AccordionSection>

        <AccordionSection {...sec('team')}>
          <p>A team is <strong>10 players</strong> under a <strong>$5,500 salary cap</strong>. You draft five of them each section, so the other five are always resting. Player attributes:</p>
          <ul>
            <li><strong>Speed:</strong> quickness and perimeter play.</li>
            <li><strong>Power:</strong> strength and interior play.</li>
            <li><strong>Scoring Chart:</strong> the rows a modified roll lands in, each paying points, rebounds and assists. The arrow marks the Shot Line.</li>
            <li><strong>Shot Line:</strong> what a shot check has to reach. Lower is a better shooter.</li>
            <li><strong>3PT Bonus / Paint Bonus:</strong> added to that kind of shot check. Many cards require one.</li>
            <li><strong>Def Boost:</strong> a positive boost <em>neutralises</em> an attacker's advantage but never turns it into a penalty. A negative Def Boost is a hole: it lowers the defender's effective Speed and Power, and it can be attacked.</li>
          </ul>
          <p>Balance stars with role players. A roster of five stars and five scrubs plays the scrubs a lot.</p>
        </AccordionSection>

        <AccordionSection {...sec('draft')}>
          <p>Each section opens with <strong>Lineup Selection</strong>: both managers pick five of their ten in secret and lock them in. Neither side sees the other's five until both have locked. The five left out sit the section, recover fatigue and lose their hot and cold markers.</p>
          <p>Then <strong>Placement</strong>, one player at a time, in this order:</p>
          <p className={s.draftOrder}>A &rarr; B &rarr; B &rarr; A &rarr; A &rarr; B &rarr; B &rarr; A &rarr; A &rarr; B</p>
          <p>Each placement takes the <strong>next open row</strong>, and <strong>the two players in a row are the matchup</strong> — they guard each other for the whole section. Placement <em>is</em> the defensive assignment; there is no separate step. When you place into a row the opponent has already filled, the preview shows both directions of the pairing (your edge and theirs), so a late placement can counter what is already on the floor.</p>
          <p>Nobody re-deals the pairings afterwards. Only a <strong>switching card</strong> (High Screen &amp; Roll, Veer Switch, Switch Everything) or the Crunch Time <strong>timeout</strong> moves a defender. Matchup cards can be played alongside placement, and the matchup window carries on once the tenth player is down. Online PvP follows the same two steps, synchronised across the room.</p>
        </AccordionSection>

        <AccordionSection {...sec('matchup')}>
          <p>With the pairings set — during placement and after it — managers take turns in the <strong>matchup card window</strong>. The turn rule is the same in every card window:</p>
          <ul>
            <li><strong>Playing a card</strong> hands the turn to the other side and resets the pass count.</li>
            <li><strong>Passing</strong> hands the turn over and counts. <strong>Two passes in a row</strong> close the window.</li>
          </ul>
          <p>Matchup cards are mostly about <strong>switching</strong>: High Screen &amp; Roll swaps the defenders of two of your players; the opponent can answer a screen-and-roll with <strong>Go Under</strong>, <strong>Fight Over</strong> or <strong>Veer Switch</strong>, each cancelling it with a different consolation. Switch Everything lets a defence reassign itself entirely, at the price of doubling every opposing advantage.</p>
          <p><strong>Matchup advantage</strong> is the difference in Speed and in Power between attacker and defender, after the defender's Def Boost. Your roll bonus is the larger of the two; if both are negative, the less bad one is your penalty.</p>
        </AccordionSection>

        <AccordionSection {...sec('scoring')}>
          <p>The <strong>scoring card window</strong> follows, under the same play-or-pass rule. When both sides have passed, <strong>rolling opens</strong>.</p>
          <p>Rolling <strong>alternates</strong>: you roll one player, the coach rolls one, and you get the floor back before their next die. That gap is where reactions live — a card that answers a roll or an announced shot check is played there. A side with nobody left to roll stands aside and the other finishes.</p>
          <h4>Roll Calculation</h4>
          <p className={s.formula}>Final Roll = D20 + Matchup Bonus + Fatigue + Hot/Cold + Card Bonuses</p>
          <p>The modified roll is looked up on the player's <strong>scoring chart</strong>: points, rebounds and assists. A roll that reaches the chart's <strong>last row</strong> is a "top tier" result, which cards like Heat Check key off.</p>
          <h4>Natural Roll Effects</h4>
          <ul>
            <li>Natural 1 or 2 &rarr; a <strong>cold marker</strong> (&minus;2 to that player's later rolls and checks).</li>
            <li>Natural 19 or 20 &rarr; a <strong>hot marker</strong> (+2). Markers stack, and a player can hold both.</li>
          </ul>
          <p>When every eligible player has rolled, <strong>End Section</strong>: effects clear, minutes are added, the rebound track pays out, and both hands refill.</p>
        </AccordionSection>

        <AccordionSection {...sec('checks')}>
          <p>A <strong>shot check</strong> is a separate D20 that a card or a spend gives a player. It succeeds when the total reaches the player's <strong>Shot Line</strong> — tie or better.</p>
          <ul>
            <li><strong>3PT check:</strong> D20 + 3PT Bonus &ge; Shot Line &rarr; 3 points</li>
            <li><strong>Paint check:</strong> D20 + Paint Bonus &ge; Shot Line &rarr; 2 points</li>
            <li><strong>Free throw:</strong> D20 + 10 &ge; Shot Line &rarr; 1 point</li>
          </ul>
          <p>Hot and cold markers and fatigue apply to checks as well as rolls. A 3PT or paint check is also <strong>contested</strong>: the shooter's matchup defender subtracts their Def Boost from it (one more in Crunch Time). Free throws are never contested.</p>
          <p>A 3PT or paint check is <strong>announced</strong> before it is rolled, and the defence may answer: <strong>Close Out</strong> takes 3 off a 3PT check and chills the shooter on a miss; <strong>Coach's Challenge</strong> forces a re-roll of any check, twice per game. The log itemises every check — <code>🎲8 +1 card +1 3PT +2 🔥 = 12 vs 13</code> — so you can see what made it or missed it.</p>
        </AccordionSection>

        <AccordionSection {...sec('cards')}>
          <p>You play from a <strong>50-card deck</strong> of strategy cards, holding a hand of <strong>7</strong> that refills to 7 at the end of every section. Copies per card are capped by rarity: <strong>5 common, 4 uncommon, 3 rare, 1 legendary</strong>. The Deck Builder enforces it when you save.</p>
          <h4>Card Phases</h4>
          <ul>
            <li><strong>Matchup:</strong> the matchup window — switches and their counters.</li>
            <li><strong>Scoring:</strong> the scoring window — boosts, shot checks, defensive schemes like Double Team and This Is My House.</li>
            <li><strong>Pre-roll:</strong> played on a player who has not rolled yet, in the rolling phase.</li>
            <li><strong>Post-roll:</strong> triggered by a result — Heat Check on a top-tier roll, for instance.</li>
            <li><strong>Reaction:</strong> played in answer to the opponent — a switch, an announced check, a natural 1.</li>
          </ul>
          <p>Cards marked <strong>Locked</strong> cannot be cancelled once played. Some cards stand for the rest of the section (Twin Towers, Run the Floor) and keep paying while their players are on the floor.</p>
          <p>The first time a team's assist total reaches <strong>5</strong>, it draws a bonus card. See the Strategy Cards tab for every card with its art and full text.</p>
        </AccordionSection>

        <AccordionSection {...sec('assists')}>
          <h4>Assist Track</h4>
          <p>Assists accumulate across the game and are a currency:</p>
          <ul>
            <li><strong>1 AST:</strong> +1 to a player's next shot check.</li>
            <li><strong>5 AST:</strong> a 3PT check for a player with a 3PT Bonus.</li>
            <li><strong>5 AST:</strong> a paint check for a player with a Paint Bonus.</li>
          </ul>
          <h4>Rebound Track</h4>
          <p>Rebounds accumulate too, and the <strong>difference</strong> between the teams is what pays:</p>
          <ul>
            <li><strong>Leading at section end:</strong> +1 stored assist.</li>
            <li><strong>Leading by 3 or more:</strong> a second-chance paint check, for 5 REB.</li>
          </ul>
        </AccordionSection>

        <AccordionSection {...sec('fatigue')}>
          <p>Every section on the floor adds <strong>4 minutes</strong> to a player's tracker:</p>
          <ul>
            <li><strong>Under 8 minutes:</strong> no penalty — two sections are free.</li>
            <li><strong>8 minutes:</strong> &minus;2 to all rolls and checks.</li>
            <li><strong>12 minutes:</strong> &minus;6.</li>
            <li><strong>16 minutes:</strong> &minus;12.</li>
          </ul>
          <p><strong>Rest:</strong> a section on the bench takes <strong>4 minutes</strong> off — the same amount a section of play adds. A star at 12 rests to 8 and is still at &minus;2; it takes three sections off to get back to fresh. Benching also clears hot and cold markers.</p>
          <p><strong>Halftime:</strong> all fatigue and all markers reset at the start of Q3.</p>
          <p>Second Wind lets a tired player ignore the penalty for one section, at the cost of extra minutes afterwards. Sitting a cold, tired star for one section is usually the better play.</p>
        </AccordionSection>

        <AccordionSection {...sec('crunch')}>
          <p>Crunch Time is the <strong>final section of Q4</strong>, and it arms only when the score is within <strong>20</strong> as that section starts. The board shows a banner and the log says whether it armed. A blowout plays out as an ordinary section.</p>
          <ul>
            <li><strong>Your crunch cards come to hand.</strong> The moment Crunch Time arms, every crunch-only card still in your deck is drawn — so a card you built the deck around is there for the section it exists for.</li>
            <li><strong>Clutch Possession:</strong> once per team, chosen at roll time, one player rolls <strong>2 dice</strong> and keeps the better. An MVP or Clutch Player award on the card adds a die each. A player at &minus;6 fatigue or worse cannot use it.</li>
            <li><strong>Extra defensive intensity:</strong> every defender with a positive Def Boost contests shot checks 1 harder.</li>
            <li><strong>The Timeout:</strong> one per team per game, Crunch Time only. It pauses play, lets you fully re-set your defensive matchups, and opens the window for the <strong>timeout riders</strong>: ATO Masterpiece (a chosen player takes a check at +2 out of the huddle), Fresh Legs (two players shed 4 minutes), Ice the Hot Hand (strip an opponent's hot markers), Reset (clear your own cold markers).</li>
            <li><strong>Desperation Press:</strong> trailing only — the next opposing top-tier roll must be re-rolled.</li>
            <li><strong>Second Closer:</strong> a second Clutch Possession, for a different player.</li>
            <li><strong>Unethical Hoops:</strong> the card every new account starts with. A player of yours with a Speed or Power advantage draws the foul: two free-throw checks at +4.</li>
          </ul>
        </AccordionSection>

        <AccordionSection {...sec('collection')}>
          <h4>Starting Out</h4>
          <p><strong>Sign in with Google first</strong> — the Starter Pack, your collection, your seasons and a game in progress all live on the account; signed out, the game is a sandbox. Your free <strong>Starter Pack</strong> holds 20 players and 30 strategy cards plus Unethical Hoops. Before you open it you pick a <strong>favourite team</strong>, NBA or WNBA, and the pack carries three commons and an uncommon from it. You can only choose once.</p>
          <h4>Cards, Coins, Packs</h4>
          <ul>
            <li>Playing earns <strong>coins</strong>: wins, milestones and a daily first-win bonus. Coins buy packs, from the 100-coin Booster up to the 6,000-coin Legendary Chase. Special sets — Super Season, Rookie, Summer Standouts and their WNBA counterparts — appear in ordinary packs at reduced odds.</li>
            <li>A pulled card is a <strong>spare</strong> until you press <strong>Collect</strong>. Collected cards count towards set goals and rewards; spares can be listed on the <strong>market</strong> or <strong>burned</strong> for coins.</li>
            <li>Build teams and decks from what you own. A team carries its own deck.</li>
          </ul>
          <h4>Ways to Play</h4>
          <ul>
            <li><strong>Quick Match</strong> against the coach, by salary band, or your team against a random opponent.</li>
            <li><strong>Hotseat</strong>: two managers at one screen.</li>
            <li><strong>Online PvP</strong>: rooms with a live opponent.</li>
            <li><strong>Season</strong>: a round-robin schedule against the league — Short (everyone once), Regular (home and away) or Long — with standings, playoffs and a title purse.</li>
          </ul>
          <p>A game in progress <strong>saves itself</strong>. Reload the page and you are back where you were.</p>
        </AccordionSection>

        <AccordionSection {...sec('glossary')}>
          <dl className={s.glossary}>
            <dt>Speed / Power</dt><dd>The two attributes a matchup is measured on. The larger advantage is the roll bonus.</dd>
            <dt>Matchup</dt><dd>The two players in a placement row. Set by placement; moved only by a switching card or the crunch timeout.</dd>
            <dt>Def Boost</dt><dd>Neutralises an attacker's advantage, never penalises them. Also subtracted from their 3PT and paint checks. Negative values are holes.</dd>
            <dt>Shot Line</dt><dd>What a shot check must reach, tie or better. The arrow on the chart marks it.</dd>
            <dt>Shot Check</dt><dd>A D20 given by a card or a spend: 3PT (3 pts), paint (2), free throw (1, at +10).</dd>
            <dt>Announced Check</dt><dd>A 3PT or paint check the defence may react to before it is rolled.</dd>
            <dt>Top Tier</dt><dd>A roll that reaches the last row of a player's chart.</dd>
            <dt>Hot / Cold Marker</dt><dd>+2 / &minus;2 per marker to rolls and checks. From natural 19–20 / 1–2. Cleared by a section on the bench, or at halftime.</dd>
            <dt>Card Window</dt><dd>The matchup or scoring phase before rolling. Play hands the turn over; two passes in a row close it.</dd>
            <dt>Priority</dt><dd>Whose turn it is in a card window. Playing a card gives it away.</dd>
            <dt>Standing Card</dt><dd>A card that stays in effect for the section while its players are on the floor.</dd>
            <dt>Snake</dt><dd>The placement order A-B-B-A-A-B-B-A-A-B.</dd>
            <dt>Section</dt><dd>One of 3 per quarter, 12 per game: lineup pick, placement, matchup window, scoring window, rolling.</dd>
            <dt>Crunch Time</dt><dd>The final section, when the margin is 20 or less as it starts.</dd>
            <dt>Clutch Possession</dt><dd>Roll 2 dice (plus award dice) and keep the best. Once per team in Crunch Time.</dd>
            <dt>Timeout</dt><dd>One per game, Crunch Time only: re-set the defence and play a rider.</dd>
            <dt>Salary Cap</dt><dd>$5,500 across 10 players.</dd>
          </dl>
        </AccordionSection>
      </div>
    </div>
  );
}
