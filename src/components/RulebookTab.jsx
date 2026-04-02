import { useRef } from 'react';
import s from './RulebookTab.module.css';

const SECTIONS = [
  { id: 'intro', num: 1, title: 'Introduction' },
  { id: 'setup', num: 2, title: 'Game Setup' },
  { id: 'attributes', num: 3, title: 'Player Attributes & Matchups' },
  { id: 'turns', num: 4, title: 'Turn Structure' },
  { id: 'strats', num: 5, title: 'Strategy Cards' },
  { id: 'scoring', num: 6, title: 'Scoring System' },
  { id: 'fatigue', num: 7, title: 'Fatigue & Substitutions' },
  { id: 'crunch', num: 8, title: 'Crunch Time Rules' },
  { id: 'glossary', num: 9, title: 'Glossary' },
];

export default function RulebookTab() {
  const refs = useRef({});

  const scrollTo = (id) => {
    refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const setRef = (id) => (el) => { refs.current[id] = el; };

  return (
    <div className={s.rulebook}>
      <div className={s.title}>NBA Showdown 2K25 Rulebook</div>
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

      {/* 1. Introduction */}
      <div className={s.section} ref={setRef('intro')}>
        <div className={s.sectionNum}>Section 1</div>
        <div className={s.sectionTitle}>Introduction</div>
        <div className={s.body}>
          <p>
            NBA Showdown 2K25 is a competitive basketball strategy card game where players
            construct teams, manage matchups, and utilize strategy cards to outplay their opponents.
            The game is designed to reflect modern NBA playstyles, including positionless basketball,
            three-point shooting, and tactical decision-making.
          </p>
          <p>
            Each game pits two managers against each other. They draft starting lineups from their
            10-player rosters, set defensive matchups, play strategy cards, and roll a D20 to
            determine scoring outcomes. Managing fatigue, hot/cold streaks, assists, and rebounds
            creates deep strategic layers on top of the dice rolls.
          </p>
        </div>
      </div>

      {/* 2. Game Setup */}
      <div className={s.section} ref={setRef('setup')}>
        <div className={s.sectionNum}>Section 2</div>
        <div className={s.sectionTitle}>Game Setup</div>
        <div className={s.body}>
          <ul>
            <li><strong>Team Construction:</strong> Each team consists of <strong>10 players</strong> with a total <strong>salary cap of $5,500</strong>.</li>
            <li><strong>Starting Lineup:</strong> Each section, managers draft <strong>5 starters</strong> via a snake draft (A-B-B-A-A-B-B-A-A-B).</li>
            <li><strong>Strategy Deck:</strong> Shuffle your strategy card deck and draw <strong>7 cards</strong> to start the game.</li>
            <li><strong>Game Length:</strong> 4 quarters, each divided into <strong>3 four-minute sections</strong> (12 total sections).</li>
            <li><strong>Bench Players:</strong> Players not drafted as starters sit on the bench and recover fatigue.</li>
          </ul>
        </div>
      </div>

      {/* 3. Player Attributes & Matchups */}
      <div className={s.section} ref={setRef('attributes')}>
        <div className={s.sectionNum}>Section 3</div>
        <div className={s.sectionTitle}>Player Attributes & Matchups</div>
        <div className={s.body}>
          <p>Each player card features key attributes that influence gameplay:</p>
          <ul>
            <li><strong>Speed:</strong> Determines quickness, transition plays, and perimeter defense.</li>
            <li><strong>Power:</strong> Represents strength, rebounding, and paint scoring ability.</li>
            <li><strong>Shot Line:</strong> The threshold a player must beat on shot checks (3PT, Paint, Free Throw).</li>
            <li><strong>Scoring Chart:</strong> Maps D20 roll results to points, rebounds, and assists.</li>
          </ul>

          <div className={s.sub}>Bonuses</div>
          <ul>
            <li><strong>Defensive Boost:</strong> Increases effective defensive Speed and Power. Can only <em>neutralize</em> offensive advantages — it cannot create disadvantages for the offensive player.</li>
            <li><strong>3PT Bonus:</strong> Added to three-point shot check rolls.</li>
            <li><strong>Paint Bonus:</strong> Added to paint scoring shot check rolls.</li>
          </ul>

          <div className={s.example}>
            Evan Mobley (S13 P13, Def+3) defends Jayson Tatum (S14 P13). Mobley's effective defense
            becomes S16 P16. Tatum's raw advantage is S+1 P+0, but Mobley's boost can only neutralize —
            so Tatum gets <strong>Roll +0</strong> (not a penalty).
          </div>

          <div className={s.sub}>Matchups</div>
          <ul>
            <li>Players can be assigned <strong>any matchup</strong> — there are no position restrictions.</li>
            <li>Matchup advantages are calculated from the <strong>difference</strong> in Speed and Power between the offensive and defensive players.</li>
            <li><strong>Roll Bonus</strong> = the larger of Speed advantage or Power advantage. If both are negative, the <em>least-negative</em> value becomes a penalty.</li>
          </ul>
        </div>
      </div>

      {/* 4. Turn Structure */}
      <div className={s.section} ref={setRef('turns')}>
        <div className={s.sectionNum}>Section 4</div>
        <div className={s.sectionTitle}>Turn Structure</div>
        <div className={s.body}>
          <p>Each of the 12 sections follows this structure:</p>

          <div className={s.sub}>Draft Phase</div>
          <ul>
            <li>Managers take turns selecting 5 starters from their roster via <strong>snake draft</strong>: A → B → B → A → A → B → B → A → A → B.</li>
            <li>Players not selected sit on the bench and recover fatigue.</li>
          </ul>

          <div className={s.sub}>Matchup Strategy Phase</div>
          <ul>
            <li>Managers take turns setting which opponent each of their players will defend.</li>
            <li><strong>Matchup phase strategy cards</strong> can be played (e.g., High Screen & Roll, Switch Everything).</li>
            <li>Opponents may respond with <strong>reaction cards</strong> (e.g., Go Under, Fight Over).</li>
            <li>Either manager may <strong>pass</strong>. Two consecutive passes end the phase.</li>
          </ul>

          <div className={s.sub}>Scoring Phase</div>
          <ul>
            <li>Managers alternate turns. On your turn, select a player to <strong>roll for scoring</strong> (D20 + matchup bonus + fatigue + hot/cold).</li>
            <li>The roll is looked up on that player's <strong>scoring chart</strong> to determine points, rebounds, and assists.</li>
            <li><strong>Pre-roll strategy cards</strong> can modify the upcoming roll (e.g., Ghost Screen, Drive the Lane).</li>
            <li><strong>Post-roll strategy cards</strong> trigger off results (e.g., Heat Check after hitting top tier, Flare Screen after natural 20).</li>
            <li>Either manager may <strong>pass</strong> instead of rolling. Two consecutive passes end the section.</li>
          </ul>

          <div className={s.sub}>End of Section</div>
          <ul>
            <li>All temporary effects (boosts, ghosts, blocks) are cleared.</li>
            <li>Each starter accumulates <strong>+4 minutes</strong> of play time.</li>
            <li>Benched players recover <strong>8 minutes</strong> of fatigue.</li>
            <li>Both managers draw back up to <strong>7 strategy cards</strong>.</li>
            <li>At halftime (start of Q3), <strong>all fatigue resets</strong>.</li>
          </ul>
        </div>
      </div>

      {/* 5. Strategy Cards */}
      <div className={s.section} ref={setRef('strats')}>
        <div className={s.sectionNum}>Section 5</div>
        <div className={s.sectionTitle}>Strategy Cards</div>
        <div className={s.body}>
          <p>Strategy cards provide tactical advantages and must be played in their designated phase:</p>
          <ul>
            <li><strong>Matchup Phase Cards:</strong> Adjust matchups, initiate switches, or counter opponent tactics.</li>
            <li><strong>Scoring Phase Cards:</strong> Modify rolls, initiate shot checks, or enable transition plays.</li>
            <li><strong>Reaction Cards:</strong> Played after an opponent's action to contest or disrupt. Only one screen-canceling card may be played per switch action.</li>
          </ul>

          <div className={s.restriction}>
            Cards labeled <strong>"Locked"</strong> cannot be canceled once played.
            Timing-sensitive cards must be played <strong>before</strong> specific actions occur.
          </div>

          <p>
            See the <strong>Strategy Cards tab</strong> for the full card list with art, phase tags,
            and detailed descriptions of every card in the game.
          </p>
        </div>
      </div>

      {/* 6. Scoring System */}
      <div className={s.section} ref={setRef('scoring')}>
        <div className={s.sectionNum}>Section 6</div>
        <div className={s.sectionTitle}>Scoring System</div>
        <div className={s.body}>
          <p>
            Each player card has a <strong>scoring chart</strong> that maps D20 roll results
            to points, rebounds, and assists. The roll is modified by matchup advantage, fatigue,
            and hot/cold markers before looking up the chart.
          </p>

          <div className={s.sub}>Roll Calculation</div>
          <div className={s.highlight}>
            <strong>Final Roll</strong> = D20 + Matchup Bonus + Fatigue Penalty + Hot/Cold Markers + Card Bonuses<br/>
            (minimum 1, no upper cap on modified roll)
          </div>

          <div className={s.sub}>Shot Checks</div>
          <ul>
            <li><strong>3PT Shot Check:</strong> Roll D20 + 3PT Bonus. Beat the player's Shot Line to score 3 points.</li>
            <li><strong>Paint Shot Check:</strong> Roll D20 + Paint Bonus. Beat the Shot Line to score 2 points.</li>
            <li><strong>Free Throw:</strong> Roll D20 + 10. Beat the Shot Line to score 1 point.</li>
          </ul>

          <div className={s.sub}>Hot & Cold Markers</div>
          <ul>
            <li>Rolling a <strong>natural 1 or 2</strong> gives the player a <strong>Cold marker</strong> (-2 to future rolls).</li>
            <li>Rolling a <strong>natural 19 or 20</strong> gives the player a <strong>Hot marker</strong> (+2 to future rolls).</li>
            <li>Markers stack. A player can be both hot and cold.</li>
            <li>Markers clear when the player is <strong>benched</strong> for a section.</li>
          </ul>

          <div className={s.sub}>Assist Track</div>
          <p>Each team tracks assists cumulatively across the game. Assists can be <strong>spent</strong> for powerful effects:</p>
          <ul>
            <li><strong>Spend 1 Assist:</strong> Add +1 to any shot check roll (once per roll).</li>
            <li><strong>Spend 2 Assists:</strong> Attempt a 3PT shot check (player must have a 3PT Bonus).</li>
            <li><strong>Spend 3 Assists:</strong> Attempt a contested Paint shot check (player must have a Paint Bonus).</li>
            <li><strong>5 Assists Bonus:</strong> When a team reaches 5 total assists, they draw 1 bonus strategy card.</li>
          </ul>

          <div className={s.sub}>Rebound Track</div>
          <p>Rebounds accumulate across the game. The <strong>differential</strong> between teams unlocks bonus opportunities:</p>
          <ul>
            <li><strong>Winning by 3+:</strong> Earn one second-chance Paint shot check (costs 3 REB).</li>
            <li><strong>Winning the track at section end:</strong> Gain +1 stored Assist for the next section.</li>
            <li><strong>Individual +2 REB in a section:</strong> That player may attempt a Putback shot check.</li>
          </ul>
        </div>
      </div>

      {/* 7. Fatigue & Substitutions */}
      <div className={s.section} ref={setRef('fatigue')}>
        <div className={s.sectionNum}>Section 7</div>
        <div className={s.sectionTitle}>Fatigue & Substitutions</div>
        <div className={s.body}>
          <p>Players accumulate fatigue the longer they stay on the court:</p>

          <div className={s.highlight}>
            <strong>8+ minutes played:</strong> -2 to all scoring rolls and shot checks<br/>
            <strong>12+ minutes played:</strong> -4 to all scoring rolls and shot checks
          </div>

          <ul>
            <li><strong>Recovery:</strong> Sitting on the bench for 1 section recovers 8 minutes of fatigue.</li>
            <li><strong>Halftime Reset:</strong> All fatigue resets at the start of Q3.</li>
            <li>Fatigue penalties apply to both the main scoring roll and any shot checks.</li>
          </ul>

          <p>
            Managing fatigue is critical. Playing your stars every section will wear them down
            by mid-game. Rotate your bench players strategically to keep your best players fresh
            for crucial moments.
          </p>
        </div>
      </div>

      {/* 8. Crunch Time Rules */}
      <div className={s.section} ref={setRef('crunch')}>
        <div className={s.sectionNum}>Section 8</div>
        <div className={s.sectionTitle}>Crunch Time Rules</div>
        <div className={s.body}>
          <p>Special rules apply during the final section of Q4:</p>
          <ul>
            <li><strong>Clutch Possession:</strong> Each manager selects one player to roll twice, keeping the better result.</li>
            <li><strong>Timeouts:</strong> Managers may play Timeout strategy cards to make last-minute defensive adjustments.</li>
          </ul>
          <p><em>Crunch Time rules are coming soon to the digital version.</em></p>
        </div>
      </div>

      {/* 9. Glossary */}
      <div className={s.section} ref={setRef('glossary')}>
        <div className={s.sectionNum}>Section 9</div>
        <div className={s.sectionTitle}>Glossary</div>
        <div className={s.body}>
          <div className={s.glossary}>
            <div className={s.glossaryTerm}>Speed (SPD)</div>
            <div className={s.glossaryDef}>Player quickness. Affects matchup advantage and perimeter-oriented cards.</div>

            <div className={s.glossaryTerm}>Power (PWR)</div>
            <div className={s.glossaryDef}>Player strength. Affects matchup advantage and paint-oriented cards.</div>

            <div className={s.glossaryTerm}>Shot Line</div>
            <div className={s.glossaryDef}>The D20 threshold a player must beat on shot checks (3PT, Paint, FT).</div>

            <div className={s.glossaryTerm}>Roll Bonus</div>
            <div className={s.glossaryDef}>The modifier applied to a D20 roll based on matchup advantage, fatigue, hot/cold, and card effects.</div>

            <div className={s.glossaryTerm}>Matchup Adv.</div>
            <div className={s.glossaryDef}>The Speed/Power difference between an offensive player and their assigned defender.</div>

            <div className={s.glossaryTerm}>Def Boost</div>
            <div className={s.glossaryDef}>A bonus that increases a defender's effective stats. Can only neutralize advantages, never create penalties.</div>

            <div className={s.glossaryTerm}>3PT Bonus</div>
            <div className={s.glossaryDef}>Added to 3-point shot check rolls. Some cards require a player to have this bonus.</div>

            <div className={s.glossaryTerm}>Paint Bonus</div>
            <div className={s.glossaryDef}>Added to paint shot check rolls. Boosts inside scoring opportunities.</div>

            <div className={s.glossaryTerm}>Hot Marker</div>
            <div className={s.glossaryDef}>+2 to future rolls. Earned by rolling a natural 19 or 20. Clears on bench.</div>

            <div className={s.glossaryTerm}>Cold Marker</div>
            <div className={s.glossaryDef}>-2 to future rolls. Earned by rolling a natural 1 or 2. Clears on bench.</div>

            <div className={s.glossaryTerm}>Fatigue</div>
            <div className={s.glossaryDef}>Penalty from extended play time. 8+ min = -2, 12+ min = -4. Bench 1 section = recover 8 min.</div>

            <div className={s.glossaryTerm}>Snake Draft</div>
            <div className={s.glossaryDef}>The alternating pick order: A-B-B-A-A-B-B-A-A-B. Ensures fairness in starter selection.</div>

            <div className={s.glossaryTerm}>Section</div>
            <div className={s.glossaryDef}>One of 3 segments per quarter (12 total). Each section: draft → matchups → scoring.</div>

            <div className={s.glossaryTerm}>Shot Check</div>
            <div className={s.glossaryDef}>A bonus roll triggered by cards/mechanics. Roll D20 + bonus, beat Shot Line to score.</div>

            <div className={s.glossaryTerm}>Reaction Card</div>
            <div className={s.glossaryDef}>A strategy card played in response to an opponent's action, before it resolves.</div>

            <div className={s.glossaryTerm}>Salary Cap</div>
            <div className={s.glossaryDef}>$5,500 total across 10 players. Constrains team building and rewards smart value picks.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
