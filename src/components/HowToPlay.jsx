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
              : 'Learn by playing a guided first quarter and a Crunch-Time finish against the coach. Covers the lineup pick, the placement snake, the card windows, rolling, fatigue and substitutions, and the timeout, Clutch and overtime at the end.'}</p>
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
          <p>Most points after 12 sections wins. If the final section starts with the score within 20, it is <strong>Crunch Time</strong> and its own rules apply. Tied at the end? <strong>Overtime</strong>: another Crunch-Time section, as many as it takes.</p>
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
          <p>Each placement takes the <strong>next open row</strong>, and <strong>the two players in a row are the matchup</strong> — they guard each other for the whole section. Once four rows are set, the <strong>last pair places itself</strong>: each side has one player and one row left. Placement <em>is</em> the defensive assignment; there is no separate step. When you place into a row the opponent has already filled, the preview shows both directions of the pairing (your edge and theirs), so a late placement can counter what is already on the floor.</p>
          <p>Put the wrong player down? <strong>↩ Undo</strong> in the bar takes back your last placement. Against the coach it lasts until you place your next player, and the coach's reply comes back with it, so the coach answers your corrected pick. In PvP it lasts until your opponent places. Playing a card, passing or locking ends it.</p>
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
          <p>The <strong>scoring card window</strong> follows, under the same play-or-pass rule. When both sides have passed, <strong>rolling opens</strong>; nobody rolls before then.</p>
          <p>Rolling <strong>alternates</strong>: you roll one player, the coach rolls one, and you get the floor back before their next die. That gap is where reactions live — a card that answers a roll or an announced shot check is played there. A side with nobody left to roll stands aside and the other finishes. And when you hold a card that answers what the coach just did — Glass Cleaner or Rebound and Push after its miss, Box Out or Passing Lane after its roll, Putback Specialist or Kick-Out Three after your own miss — <strong>the coach waits</strong>: play the card, or press Continue.</p>
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
          <p>A 3PT or paint check is <strong>announced</strong> before it is rolled, and the defence may answer: <strong>Close Out</strong> takes 3 off a 3PT check and chills the shooter on a miss; <strong>Blitz</strong> makes the offense hand a 3PT or paint check to another player on the floor (same card bonus; only that check moves), and Close Out and the other answers can still follow it; <strong>Coach's Challenge</strong> forces a re-roll of the opponent's best made check this section — the most points, the most recent if tied, never a miss — twice per game; the card names the check and the re-roll's chance to miss before you commit. The log itemises every check — <code>🎲8 +1 card +1 3PT +2 🔥 = 12 vs 13</code> — so you can see what made it or missed it.</p>
        </AccordionSection>

        <AccordionSection {...sec('cards')}>
          <p>You play from a <strong>50-card deck</strong> of strategy cards, holding a hand of <strong>7</strong> that refills to 7 at the end of every section. Copies per card are capped by rarity: <strong>5 common, 4 uncommon, 3 rare, 1 legendary</strong>. The Deck Builder enforces it when you save.</p>
          <p><strong>A card that replaces a roll</strong> &mdash; Green Light, You Stand Over There, Five-Out Offense, Cross-Court Dime &mdash; is worth its shot checks <em>minus the roll it gives up</em>. Your best scorer is usually the <em>worst</em> player to spend it on: a star's roll pays in points, rebounds and assists that two checks rarely match. Below Prince, and always in the tutorial, the picker shows that number beside each player. The coach reads the same one.</p>
          <p><strong>Coach difficulty</strong> runs Settler to Deity. <strong>Prince is a fair game</strong> &mdash; the coach plays its full search against an even roster &mdash; and pays the standard rate. Below it the coach is worse at its job and a game pays less. Above it the coach is never made smarter than fair and <em>your</em> players are never made worse: its <strong>team</strong> is better, drawn to a richer cap you can see on its cards, and it weighs more of your possible lineups before it places. A <strong>win</strong> at King pays 125%, at Deity 150%; a <strong>loss pays the standard rate</strong> at every rung from Prince up (below Prince the cut applies win or lose). The premium is for beating a team the coach <strong>drew itself</strong>: a game where you built the coach's team (Team Builder Rosters), picked the coach's deck, or played a Quick Match pays at most the standard rate. A game keeps the difficulty it was dealt at — changing the setting moves the next game, not this one. A season remembers the rung it was built at: you can turn the coach down any time, but a game in it never pays above that rung. A dynasty is played at its own rung: every game in it is coached and paid at the rung the league was built at, whatever this setting says. Two people in PvP play on their own logic, and a PvP game pays the <strong>top rate</strong> &mdash; the same as Deity &mdash; because a person is the best opponent there is.</p>
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
            <li><strong>5 AST:</strong> a 3PT check for any player. Their 3PT Bonus, plus or minus, rides on the die; the button shows the roll they need.</li>
            <li><strong>5 AST:</strong> a paint check for any player, the same way with their Paint Bonus.</li>
          </ul>
          <h4>Rebound Track</h4>
          <p>Rebounds count twice. The <strong>track</strong> is every rebound your team has <strong>won</strong> this game against theirs; spending never moves it. The number beside it is what you <strong>hold</strong>, and you spend that the way you spend assists:</p>
          <ul>
            <li><strong>5 REB:</strong> a paint check for any player, any time. Their Paint Bonus rides on the die; the button shows the roll they need.</li>
          </ul>
          <p>A card that <strong>cancels</strong> rebounds (Box Out, Cold Spell, Offensive Foul) takes them off the track too, since they were never won. The <strong>track</strong> pays two ways:</p>
          <ul>
            <li><strong>Leading by 3 or more, at any moment:</strong> your next paint check is at <strong>+2</strong>, whether you bought it with rebounds or assists or a card called it. Once a section.</li>
            <li><strong>Leading at the end of a section:</strong> +1 stored assist.</li>
          </ul>
          <p>A <strong>strategy card that spends rebounds</strong> needs your team to lead the track by at least what it spends.</p>
        </AccordionSection>

        <AccordionSection {...sec('fatigue')}>
          <p>Every section on the floor adds <strong>4 minutes</strong> to a player's tracker:</p>
          <ul>
            <li><strong>Under 8 minutes:</strong> no penalty — two sections are free.</li>
            <li><strong>8 minutes:</strong> &minus;2 to scoring rolls and to 3PT and paint checks (free throws are exempt).</li>
            <li><strong>12 minutes:</strong> &minus;6.</li>
            <li><strong>16 minutes:</strong> &minus;12, and &minus;6 more for every section after that (20 minutes &minus;18, 24 minutes &minus;24). It does not stop.</li>
          </ul>
          <p><strong>Twelve straight is the limit.</strong> A player with 12 minutes or more on the tracker <strong>must sit the next section</strong> &mdash; except in the <strong>fourth quarter and overtime</strong>, when anyone can play through. The coach lives by the same rule.</p>
          <p><strong>Rest:</strong> a section on the bench <strong>clears the tracker at 8 minutes or under</strong> — two sections on, one off, and a player is fresh again. Above 8 a rest takes <strong>4 minutes</strong> off: a star at 12 rests to 8, still at &minus;2, and needs a second rest to be fresh. Benching also clears hot and cold markers.</p>
          <p><strong>Halftime:</strong> all fatigue and all markers reset at the start of Q3.</p>
          <p>Second Wind lets a tired player ignore the penalty for one section, at the cost of extra minutes afterwards. Sitting a cold, tired star for one section is usually the better play.</p>
        </AccordionSection>

        <AccordionSection {...sec('crunch')}>
          <p>Crunch Time is the <strong>final section of Q4</strong>, and it arms only when the score is within <strong>20</strong> as that section starts. The board shows a banner and the log says whether it armed. A blowout plays out as an ordinary section. A game <strong>tied</strong> after it goes to <strong>overtime</strong>: another Crunch-Time section at any margin, with a fresh timeout and Clutch Possession for each team — and another after that if it is still tied.</p>
          <ul>
            <li><strong>Crunch-only cards wait for Crunch Time.</strong> One drawn in any earlier section goes straight to the bottom of your deck and you draw again. They come to hand only when drawn into the crunch section — or through <strong>the timeout search</strong>: during your timeout you may take <strong>one</strong> crunch-only card from your deck into hand and shuffle the rest.</li>
            <li><strong>Clutch Possession:</strong> once per team, chosen at roll time, one player rolls <strong>2 dice</strong> and keeps the better. An MVP or Clutch Player award on the card adds a die each. A player at &minus;6 fatigue or worse cannot use it.</li>
            <li><strong>Extra defensive intensity:</strong> every defender with a positive Def Boost contests shot checks 1 harder.</li>
            <li><strong>The Timeout:</strong> one per team per game, and one more in each overtime, Crunch Time only, called once <strong>the other team has rolled</strong> in the section (your own roll does not open it). It pauses play, lets you fully re-set your defensive matchups, lets you search the deck for one crunch-only card, and opens the window for the <strong>timeout riders</strong>: ATO Masterpiece (a chosen player takes a check at +2 out of the huddle), Fresh Legs (two players shed 4 minutes), Ice the Hot Hand (strip an opponent's hot markers), Reset (clear your own cold markers).</li>
            <li><strong>Desperation Press:</strong> trailing only — the next opposing top-tier roll must be re-rolled.</li>
            <li><strong>Second Closer:</strong> a second Clutch Possession, for a different player.</li>
            <li><strong>Unethical Hoops:</strong> the card every new account starts with. A player of yours with a Speed or Power advantage draws the foul: four free-throw checks, no bonus &mdash; a free throw carries its own +10.</li>
          </ul>
        </AccordionSection>

        <AccordionSection {...sec('collection')}>
          <h4>Starting Out</h4>
          <p><strong>Sign in with Google first</strong> — the Starter Pack, your collection, your seasons and a game in progress all live on the account; signed out, the game is a sandbox. Your free <strong>Starter Pack</strong> holds 20 players and 30 strategy cards plus Unethical Hoops. Before you open it you pick a <strong>favourite team</strong>, NBA or WNBA, and the pack carries three commons and an uncommon from it. You can only choose once.</p>
          <h4>Cards, Coins, Packs</h4>
          <ul>
            <li>Playing earns <strong>coins</strong>: every finished game, a win bonus that grows with the margin (20 for a one-point win up to 100 for a 50-point blowout), 15 for losing by five or fewer, milestones by your own players (a triple-double, a 50-point game) and a daily first-win bonus; the coach's rung scales it (above), and PvP pays half again, win or lose. Each game is <strong>paid once</strong> — reloading its results screen shows what it paid. Coins buy packs, from the 100-coin Booster up to the 6,000-coin Legendary Chase. Special sets — Super Season, Rookie, Summer Standouts and their WNBA counterparts — appear in ordinary packs at reduced odds. <strong>Record Breakers</strong> (a season a record was set, in a platinum frame with the record on a lit plaque) deals only its blocks and steals records in packs; its other cards are earned by matching the feat, which is coming soon.</li>
            <li>A pulled card is a <strong>spare</strong> until you press <strong>Collect</strong>. Collected cards count towards set goals and rewards; spare player cards can be listed on the <strong>market</strong> (never below the card's burn value) or <strong>burned</strong> for coins. Strategy cards are not burned by hand: a copy past a card's deck limit is burned for coins as it arrives.</li>
            <li>Build teams and decks from what you own. A team carries its own deck.</li>
          </ul>
          <h4>Ways to Play</h4>
          <ul>
            <li><strong>Quick Match</strong> against the coach, by salary band, or your team against a random opponent.</li>
            <li><strong>Hotseat</strong>: two managers at one screen.</li>
            <li><strong>Online PvP</strong>: rooms with a live opponent.</li>
            <li><strong>The Climb</strong> (from the Play tab): bring <strong>five or six of your players under a $2,200 cap</strong> — a sixth is a bench to rotate, bought with a cheaper five (save <strong>Climb teams</strong> ahead in Collection → My Teams, or with Save this team on the start screen) and climb <strong>three acts</strong> of seven floors, each to a <strong>classic team</strong> — one franchise's Super Seasons, Throwbacks and reward cards. Each game is <strong>one quarter</strong>, from Q4 section 1, Crunch Time and overtime as in any game, the coach at the rung you chose. At <strong>Training Camp</strong> you pick a playbook (Speed, Paint or Defense: sixteen strategy cards, the switching basics plus nine of its own, a crunch card among them) and one of three boons. The <strong>Map, Deck and Team</strong> buttons at the top show your run from any Climb screen, and from the board during a run's game. Each playbook has a <strong>system</strong>: a player who fits it is <strong>In System</strong> — Speed 12+ for Speed, Power 12+ for Paint, +1 on their shot checks; Defense +1 or better for Defense, the checks against them −1. Training Camp shows how many of your players fit each one, and a player offer who fits glows. Games are <strong>at home</strong> — the coach places first and you answer — while Rivalries and the boss are on the road. Act I coaches play one copy of each card, and the boss's deck is its kit plus three cards, none rare. The map branches: <strong>Games</strong>, harder <strong>Rivalries</strong>, <strong>Rest Days</strong> and <strong>❓ stops</strong>, with a Rest Day before the boss. Every team on the map plays its coach's <strong>style</strong>, a strength with a hole in it (Splash: their 3PT checks +1, their whole team −1 Power), named on its stop and in the boss's scouting; in Act I's Games only the hole plays. An Act I or Act II boss can be taken at <strong>Full Strength</strong>, its strength doubled, for one more strategy-card pick and a boss's perk from four. A <strong>❓ stop</strong> is a scene with a choice, and many cost you something whichever way you go — a trade call, a two-way contract, a veteran on the minimum, an injury scare, a holdout, a flu bug, budget cuts, a back-to-back and more, each once a run. Like a Rest Day it clears the floor and raises the cap. One ❓ in four is a <strong>Makeup Game</strong>: a Game behind the ❓, played and paid like any Game, and a loss there ends the run. After every win take one of three strategy cards or skip it — a tight deck sees its best cards more often — and a player for this run (after every Rivalry; after a Game half the time, the odds rising each time one does not come). Your cap rises $450 a floor and a roster tops out at ten: when a player does not fit, you sign them by <strong>releasing one of yours</strong>, who leaves the run with their perks. <strong>Fatigue carries over</strong>: between games every tracker comes down 10 minutes (12 after a win by 10 or more, 14 by 20 or more). A Rest Day <strong>rests</strong> everyone, <strong>upgrades one copy</strong> of a card to its "+", or <strong>cuts one card</strong> from your deck for good (a deck keeps at least seven). Every card a run can offer has a "+" (the legendaries do not): a bigger number, a looser condition, no discard, or a card drawn. A "+" that says <strong>Run It Back</strong> goes back into your deck after you play it, so it can come again that game; one that says <strong>Innate</strong> starts the game in your hand. The map <strong>scouts the boss</strong> from floor 1 — its best five, its playbook and its rares — so you know what you are building to beat. Wins fill the <strong>pot</strong> — 30 coins at floor 1 up to 60 at floor 7 for a Game, 70 for a Rivalry, 120 and a Booster for Act I's boss, all at the rung's pay — paid only when you <strong>retire between games</strong> or bank it after a boss. After the Act I and Act II bosses you choose: <strong>take the pot and stop</strong>, or <strong>keep climbing</strong>. The next act is harder (bigger teams with deeper decks and rares, a bigger classic boss; in Act III every team is a classic team), its wins add 1.5× (Act II) or 2× (Act III) as much to the pot, and its boss adds a Rare Deluxe (Act II) or a <strong>Mega Deluxe</strong> (Act III). Your players start each act rested, and the boss you beat pays a card (one of them rare), a player and a boss's perk. <strong>One loss ends the run and the whole pot with it</strong>, every act's; a tie after the last overtime is a loss. A <strong>Rivalry</strong> usually drops a <strong>perk</strong> for the rest of the run too (a Game now and then), one of three or none. Some build a player: Gym Rat (+1 Power), Track Work (+1 Speed), Lockdown Drills (+1 Defensive Bonus), Extra Reps (their Shot Line 1 better), Signature Move (+2 3PT Bonus) and Post Moves (+2 Paint Bonus), never two of the last three in one offer; Film Study practises a card now. No number on a player moves more than 3. The rest work for the team, each once a run. In every game: Scouting Report (a card more in your opening hand), Fast Start (+1 on your scoring rolls in the first section), Closers (+1 in Crunch Time), Rim Deterrent (the first Paint check against you is at −3) and Ball Movement Culture (every fifth strategy card you play draws one). Between games: Training Staff (2 more minutes off every tracker after a win), Shootaround (resting at a Rest Day brings a practice), Advance Scout (four strategy cards to choose from) and Scouting Network (every Game win offers a player). And the run: Sponsorship (every win after it adds 20% more to the pot) and Travel Day (three times, go to any stop on the next floor, linked or not). A <strong>boss's perk</strong> is bigger, usually at a price: Second Chance (once, a loss is replayed and the pot stays), Win-Now Trade (+$900 of cap, but a Rest Day can no longer rest), Max Contract (+2 Speed and +2 Power on a player, but Games add nothing to the pot after it), Heavy Minutes (+1 on your scoring rolls, but every starter adds a minute each section), Short Rotation (a card more each section, but at most two strategy cards a section) and Front Office Shake-Up (cut two cards and practise two, from the map). Some rewards are <strong>Climb-only cards</strong>, never found in a pack, and they lean to your playbook: Speed has Let It Fly (your threes +1 this game), Pace and Space (+1 Speed to everyone) and Splash (your threes +1 for every two your team has made this game, up to +3), Paint has Bruise Crew (your paint checks +1) and Weight Room (+3 Power on one player), Defense has Conditioning (fatigue costs nothing this game) and Shut the Door (their paint checks −1); any playbook can find Chemistry (every screen after it sets up your next roll at +1, then +2, then +3), On Fire (a player who makes three checks in a row is +3 on their checks until they miss), Stay Hot (your hot markers carry into the next game, two at most) and Ice Bath (after this game your fatigue is cleared; it then leaves your deck). The second wave adds <strong>Powers</strong> that pay on a trigger for the rest of the game — Get Stops (each defense card you play is a Rebound), Talk on Defense (each switching card is +1 Speed on defense for your five that section), Ball Movement (each made three is an Assist), Wear Them Down (each made paint check costs that defender a Power for the game, three at most) and Film Session (a card more as each section opens) — plus Signature Set (+2 to a player's roll, and 1 more for the rest of the run each game you play it, up to +6) and Leave It All Out There (+3 to every roll this section; it then leaves your deck). The <strong>Grind</strong> cards cost minutes, added at the end of the section so they never hurt the roll they help: Up-Tempo (draw 2; every starter +1 minute), Ride Your Star (+4 to your highest-paid starter; +3 minutes), Full-Court Press (+3 Speed on defense for all five; +2 minutes each), Crash Every Board (+3 Rebounds; +2 minutes for your two biggest), Play Through Contact (a Paint check at +3, a hot marker on a make; +3 minutes) and Two-a-Days (after the game, practise a card from the map; your players carry 4 more minutes into the next game; it then leaves your deck). A reward card one of your players fits glows and names them, and a player offer comes at three prices so you are not always signing up to the cap. Every run game also <strong>pays a quarter of a game</strong> as you go, win or lose: a quarter of finishing one, and of the win bonus (on the margin a full game would carry) or a close loss's consolation, at the rung's rate. Your own players' lifetime stats count too.</li>
            <li><strong>Season</strong>: a round-robin schedule against the league — Short (everyone once), Regular (home and away) or Long — with standings, playoffs and a title purse, paid by the <strong>share of your own games you played</strong> — a game you sim counts against it. Player stats keep every game, and when the regular season ends the league names its MVP, Defensive Player of the Year, Sixth Player, Rookie of the Year and scoring champion.</li>
            <li><strong>Dynasty</strong>: ten seasons in one league, paying players in <strong>Dynasty Points</strong>. Every team fits a <strong>100-DP cap</strong>; re-signing your own players, signing your draft picks and claiming a player off waivers may take you past it, up to your <strong>130-DP apron</strong>. Bring your own team and it arrives on real contracts, over the apron if it must — then you shed salary to get under it before you can re-sign anyone. AI teams arrive <strong>under the cap</strong> and may re-sign up to <strong>115</strong>, both scaled up by the league's coach rung. AI teams must <strong>also</strong> keep their roster's <strong>card salary under $5,500 × the rung</strong> (the Team Builder cap: $5,500 up to Prince, $5,775 at King, $6,160 at Deity) through every draft pick, signing, re-signing, waiver claim and trade, keeping room as it goes for the cards its coming picks will carry and about $150 for each seat it is still short of eight — an AI team already over it adds no salary until it is back under; nobody is cut. The one way past it is the floor: a team short of eight with no room left fills the seat with the cheapest card there is. Your team answers to DP alone. A dynasty game's coach plays at the league's rung, not this device's difficulty — the Coach picker beside Play does not reach a dynasty game. A trade holds each side to its own apron — an AI team already past it only trades down — and a side over the cap afterwards takes back at most 125% of the DP it sends out. Each offseason a <strong>draft class</strong> of two players a team plus four is drawn from the pool a year ahead, by rarity — one rare guaranteed, a super-rare more often than not and two in about 15% of classes, a legendary about one year in seven — and two rounds are drafted. A pick signs on the <strong>rookie scale, priced by the slot</strong>: 10 DP at the first pick down to 5 at the end of round one, 3 down to 2 in round two, three years. A drafted player is your <strong>rights until the season starts</strong> — sign them at the scale any time before, up to the apron; unsigned at tip-off, they become a free agent. AI teams draft only what their books can sign and keep room for their picks when they re-sign; a team short of eight players may sign its pick past its apron rather than a free agent past it. A player you <strong>waive</strong> goes <strong>on waivers</strong> until the league next moves on (the next phase, week of free agency or round): the teams are asked worst record first, and the first to claim them takes their contract — and <strong>their DP comes off your books</strong>. Unclaimed, they are a free agent and their DP stays on your cap that season as dead money. Claim someone else's from the waiver wire in your front office, if they fit under your apron with a roster spot. <strong>Trades:</strong> a side that would end with more than ten players <strong>waives its weakest to make room</strong> — one player at most, onto waivers, their DP on that side's books this season unless they are claimed — and the AI takes a deal like that only if it still wins without them. AI teams trade among themselves (up to three deals an offseason, only when both sides come out ahead) and <strong>make you offers</strong>: each turn of the offseason and each round up to the trade deadline, one a team at most, never below 90% of what they ask you to give by your own team's needs. An offer waits under Trade offers until the next turn and is checked again when you accept it — one the league has moved past says why and cannot be taken. With friends, a trade between coaches is an offer the other coach answers, the commissioner can veto it until the next phase (never a trade with an AI team), and a coach can have ten offers waiting at once.</li>
            <li><strong>Players age</strong> (an aging dynasty, which runs until you end it): everyone is a year older each offseason, and from 35 a player may retire at the turn of the year — one in six at 35, more each year, certain at 40. Their contract ends with them, with no dead money. The offseason <strong>opens on the retirements</strong>: who went, yours first with the deal that went with them, and which of your players face the roll next year. Nobody gets better or worse with age; asks fall past 31.</li>
            <li><strong>Staff</strong>: Franchise Points also hire a front office, three tiers a role, kept for the dynasty — a <strong>Head Scout</strong> (a graded class and the AI's mock board, +25% lottery weight, a steal after the last pick), a <strong>Cap Strategist</strong> (every free agent's personality and floor shown, your own players re-sign 10% under their ask, a 125-DP apron) and, in an aging dynasty, <strong>Sports Science</strong> (retirement risk starts later, one protected player a year, the whole window two years later). Tiers cost 3, 6 and 12.</li>
            <li><strong>Franchise Points</strong>: a currency of the dynasty itself, paid to every coach as a year closes — your regular-season finish (first of the league is 10, last is 0), 3 for each playoff series you win, 10 for the title, all weighted by the coach rung. Spend them in the offseason to <strong>bring a card you own into the league</strong>: a common for 2, an uncommon 4, a rare 8, a super-rare 16, a legendary 32; the player signs at their value for two years under the cap, and the card stays in your collection. Your <strong>strategy deck is never frozen</strong>: change it in the Front Office or between rounds, alone or with friends.</li>
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
            <dt>Card Window</dt><dd>The matchup or scoring phase before rolling. Play hands the turn over; two passes in a row close it. The home side opens every scoring phase.</dd>
            <dt>Priority</dt><dd>Whose turn it is in a card window. Playing a card gives it away.</dd>
            <dt>Standing Card</dt><dd>A card that stays in effect for the section while its players are on the floor.</dd>
            <dt>Snake</dt><dd>The placement order A-B-B-A-A-B-B-A-A-B. In a season the visitor leads and the home side answers; in a sandbox game Team A leads.</dd>
            <dt>Section</dt><dd>One of 3 per quarter, 12 per game: lineup pick, placement, matchup window, scoring window, rolling.</dd>
            <dt>Crunch Time</dt><dd>The final section, when the margin is 20 or less as it starts.</dd>
            <dt>Overtime</dt><dd>Another Crunch-Time section when the game is tied after regulation — repeated until someone leads.</dd>
            <dt>Clutch Possession</dt><dd>Roll 2 dice (plus award dice) and keep the best. Once per team in Crunch Time.</dd>
            <dt>Timeout</dt><dd>One per game, Crunch Time only, once the other team has rolled in the section: re-set the defence and play a rider.</dd>
            <dt>Salary Cap</dt><dd>$5,500 across 10 players.</dd>
          </dl>
        </AccordionSection>
      </div>
    </div>
  );
}
