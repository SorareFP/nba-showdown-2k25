// src/components/HowToPlay.jsx
import { useState, useRef, useEffect } from 'react';
import s from './HowToPlay.module.css';

const SECTIONS = [
  { id: 'overview',    title: 'Overview & Winning' },
  { id: 'team',        title: 'Building Your Team' },
  { id: 'draft',       title: 'The Draft Phase' },
  { id: 'matchup',     title: 'Matchup Strategy Phase' },
  { id: 'scoring',     title: 'Scoring Phase' },
  { id: 'cards',       title: 'Strategy Cards' },
  { id: 'assists',     title: 'Assists, Rebounds & Bonuses' },
  { id: 'fatigue',     title: 'Fatigue & Substitutions' },
  { id: 'advanced',    title: 'Advanced: Hot/Cold, And-One, Close Out' },
  { id: 'glossary',    title: 'Glossary' },
];

function AccordionSection({ id, title, open, onToggle, children }) {
  const contentRef = useRef(null);
  return (
    <div className={`${s.section} ${open ? s.open : ''}`} id={`rules-${id}`}>
      <button className={s.sectionHeader} onClick={onToggle} aria-expanded={open}>
        <span className={s.sectionTitle}>{title}</span>
        <span className={s.chevron}>{open ? '\u25BE' : '\u25B8'}</span>
      </button>
      <div className={s.sectionBody} ref={contentRef} style={{ maxHeight: open ? contentRef.current?.scrollHeight + 'px' : '0' }}>
        <div className={s.sectionContent}>{children}</div>
      </div>
    </div>
  );
}

export default function HowToPlay({ scrollToSection, onStartTutorial }) {
  const [openSections, setOpenSections] = useState(new Set());
  const sectionRefs = useRef({});

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

  return (
    <div className={s.wrap}>
      {/* Hero: Tutorial Launcher */}
      <div className={s.hero}>
        <h1 className={s.heroTitle}>How to Play</h1>
        <p className={s.heroSub}>NBA Showdown 2K25 — D20 Basketball Card Game</p>
        <div className={s.tutorialCard}>
          <div className={s.tutorialInfo}>
            <h2>Interactive Tutorial</h2>
            <p>Learn by playing a guided quarter against the AI. Covers drafting, matchups, scoring, fatigue, and substitutions.</p>
            <span className={s.tutorialTime}>~12–15 minutes</span>
          </div>
          <button className={s.tutorialBtn} onClick={onStartTutorial}>
            Play Tutorial
          </button>
        </div>
      </div>

      {/* Accordion Rules */}
      <div className={s.rules}>
        <AccordionSection id="overview" title="Overview & Winning" open={openSections.has('overview')} onToggle={() => toggle('overview')}>
          <p>NBA Showdown 2K25 pits two managers against each other in a game of basketball strategy. Build a 10-player roster under a $5,500 salary cap, then compete across <strong>4 quarters</strong>, each divided into <strong>3 four-minute sections</strong> (12 total).</p>
          <p>Each section follows three phases: <strong>Draft</strong> your starting five, set <strong>Matchups</strong> with strategy cards, then <strong>Score</strong> by rolling a D20 modified by matchup advantages, fatigue, and card effects.</p>
          <p>The team with the most points after 12 sections wins.</p>
        </AccordionSection>

        <AccordionSection id="team" title="Building Your Team" open={openSections.has('team')} onToggle={() => toggle('team')}>
          <p>Each team has <strong>10 players</strong> with a total <strong>salary cap of $5,500</strong>. Players have attributes:</p>
          <ul>
            <li><strong>Speed (SPD):</strong> Quickness and perimeter play</li>
            <li><strong>Power (PWR):</strong> Strength and interior play</li>
            <li><strong>Shot Line:</strong> The D20 threshold for shot checks (lower = better shooter)</li>
            <li><strong>3PT Bonus:</strong> Added to three-point shot check rolls</li>
            <li><strong>Paint Bonus:</strong> Added to paint shot check rolls</li>
            <li><strong>Def Boost:</strong> Increases defensive effectiveness (only neutralizes advantages, never creates penalties)</li>
          </ul>
          <p>Balance expensive stars with affordable role players. You'll rotate all 10 players across sections to manage fatigue.</p>
        </AccordionSection>

        <AccordionSection id="draft" title="The Draft Phase" open={openSections.has('draft')} onToggle={() => toggle('draft')}>
          <p>Each section starts with a <strong>snake draft</strong> to pick 5 starters from your roster:</p>
          <p className={s.draftOrder}>A &rarr; B &rarr; B &rarr; A &rarr; A &rarr; B &rarr; B &rarr; A &rarr; A &rarr; B</p>
          <p>Players not drafted sit on the bench and <strong>recover fatigue</strong>. Consider resting tired players and bringing in fresh legs strategically.</p>
        </AccordionSection>

        <AccordionSection id="matchup" title="Matchup Strategy Phase" open={openSections.has('matchup')} onToggle={() => toggle('matchup')}>
          <p>After drafting, assign which opponent each of your players will defend. Then managers alternate turns playing <strong>matchup strategy cards</strong> or passing.</p>
          <ul>
            <li><strong>Offensive cards</strong> (e.g., High Screen & Roll) modify matchups in your favor</li>
            <li><strong>Defensive reactions</strong> (Go Under, Fight Over, Veer Switch) cancel opponent switches</li>
            <li>Two consecutive passes end the phase and begin scoring</li>
          </ul>
          <p><strong>Matchup advantage</strong> = the difference in Speed and Power between attacker and defender. Positive advantages become roll bonuses; negative differences become penalties.</p>
        </AccordionSection>

        <AccordionSection id="scoring" title="Scoring Phase" open={openSections.has('scoring')} onToggle={() => toggle('scoring')}>
          <p>Managers alternate turns playing scoring strategy cards or passing. After both pass, <strong>rolling opens</strong> and all players may roll.</p>
          <h4>Roll Calculation</h4>
          <p className={s.formula}>Final Roll = D20 + Matchup Bonus + Fatigue + Hot/Cold + Card Bonuses</p>
          <p>The modified roll is looked up on the player's <strong>scoring chart</strong> to determine points, rebounds, and assists.</p>
          <h4>Shot Checks</h4>
          <p>Many strategy cards trigger shot checks — separate D20 rolls against the player's Shot Line:</p>
          <ul>
            <li><strong>3PT Check:</strong> D20 + 3PT Bonus &ge; Shot Line &rarr; 3 points</li>
            <li><strong>Paint Check:</strong> D20 + Paint Bonus &ge; Shot Line &rarr; 2 points</li>
            <li><strong>Free Throw:</strong> D20 + 10 &ge; Shot Line &rarr; 1 point</li>
          </ul>
          <h4>Natural Roll Effects</h4>
          <ul>
            <li>Natural 1 or 2 &rarr; <strong>Cold marker</strong> (&minus;2 to future rolls)</li>
            <li>Natural 19 or 20 &rarr; <strong>Hot marker</strong> (+2 to future rolls)</li>
          </ul>
        </AccordionSection>

        <AccordionSection id="cards" title="Strategy Cards" open={openSections.has('cards')} onToggle={() => toggle('cards')}>
          <p>Each team starts with a deck of ~50 strategy cards, drawing 7 to start and refilling to 7 after each section.</p>
          <h4>Card Phases</h4>
          <ul>
            <li><strong>Matchup:</strong> Played during matchup strategy phase (e.g., High Screen & Roll, Stagger Action)</li>
            <li><strong>Pre-Roll:</strong> Played before a player rolls (e.g., Ghost Screen, Pin-Down Screen)</li>
            <li><strong>Scoring:</strong> Played during scoring phase (e.g., Green Light, Bully Ball, And One)</li>
            <li><strong>Post-Roll:</strong> Triggered by roll results (e.g., Heat Check on top tier, Flare Screen on natural 20)</li>
            <li><strong>Reaction:</strong> Played in response to opponent actions (e.g., Close Out, Cold Spell, Coach's Challenge)</li>
          </ul>
          <p>Cards marked <strong>Locked</strong> cannot be canceled once played.</p>
          <p>See the Strategy Cards tab for the full card list with descriptions.</p>
        </AccordionSection>

        <AccordionSection id="assists" title="Assists, Rebounds & Bonuses" open={openSections.has('assists')} onToggle={() => toggle('assists')}>
          <h4>Assist Track</h4>
          <p>Assists accumulate across the game and can be spent:</p>
          <ul>
            <li><strong>1 AST:</strong> +1 to any shot check</li>
            <li><strong>4 AST:</strong> Attempt a 3PT shot check (requires 3PT Bonus)</li>
            <li><strong>3 AST:</strong> Attempt a Paint shot check (requires Paint Bonus)</li>
            <li><strong>5 AST total:</strong> Draw a bonus strategy card</li>
          </ul>
          <h4>Rebound Track</h4>
          <p>The differential between teams unlocks bonuses at section end:</p>
          <ul>
            <li><strong>Winning:</strong> +1 stored assist</li>
            <li><strong>+3 differential:</strong> Second-chance Paint check (costs 3 REB)</li>
            <li><strong>Individual 2+ REB in a section:</strong> Putback opportunity (costs 2 REB)</li>
          </ul>
        </AccordionSection>

        <AccordionSection id="fatigue" title="Fatigue & Substitutions" open={openSections.has('fatigue')} onToggle={() => toggle('fatigue')}>
          <p>Each section played adds <strong>4 minutes</strong> of fatigue:</p>
          <ul>
            <li><strong>0–8 minutes:</strong> No penalty (2 sections free)</li>
            <li><strong>8–12 minutes:</strong> &minus;2 to all rolls</li>
            <li><strong>12–16 minutes:</strong> &minus;6 to all rolls</li>
            <li><strong>16+ minutes:</strong> &minus;12 to all rolls</li>
          </ul>
          <p><strong>Recovery:</strong> Sitting on the bench for 1 section recovers up to 8 minutes of fatigue (2x rate for first 8 min).</p>
          <p><strong>Halftime:</strong> All fatigue and hot/cold markers reset at the start of Q3.</p>
          <p>Rotate your bench players to keep starters fresh for crucial moments.</p>
        </AccordionSection>

        <AccordionSection id="advanced" title="Advanced: Hot/Cold, And-One, Close Out" open={openSections.has('advanced')} onToggle={() => toggle('advanced')}>
          <h4>Hot/Cold Markers</h4>
          <ul>
            <li>Each hot marker: <strong>+2</strong> to all rolls. Each cold marker: <strong>&minus;2</strong>.</li>
            <li>Markers stack and can coexist (a player can be hot AND cold).</li>
            <li>Clear when benched for a section, or at halftime.</li>
          </ul>
          <h4>And-One</h4>
          <p>When a player has Speed or Power advantage &ge;3 over their defender:</p>
          <ul>
            <li><strong>Advantage 3–4:</strong> +1 point</li>
            <li><strong>Advantage 5+:</strong> +1 point AND a free throw check</li>
          </ul>
          <h4>Close Out</h4>
          <p>A defensive reaction card played when the opponent announces a 3PT Shot Check. Applies <strong>&minus;3 to the check</strong>. If the shot misses after Close Out, the shooter gains a <strong>cold marker</strong>.</p>
        </AccordionSection>

        <AccordionSection id="glossary" title="Glossary" open={openSections.has('glossary')} onToggle={() => toggle('glossary')}>
          <dl className={s.glossary}>
            <dt>Speed (SPD)</dt><dd>Player quickness. Affects matchup advantage and perimeter cards.</dd>
            <dt>Power (PWR)</dt><dd>Player strength. Affects matchup advantage and paint cards.</dd>
            <dt>Shot Line</dt><dd>D20 threshold for shot checks. Lower = better shooter.</dd>
            <dt>Roll Bonus</dt><dd>Modifier from matchup advantage + fatigue + hot/cold + cards.</dd>
            <dt>Def Boost</dt><dd>Defensive bonus that neutralizes offensive advantages (never creates penalties).</dd>
            <dt>Hot/Cold Markers</dt><dd>&plusmn;2 per marker to all future rolls. Clear on bench or halftime.</dd>
            <dt>Snake Draft</dt><dd>Alternating pick order: A-B-B-A-A-B-B-A-A-B.</dd>
            <dt>Section</dt><dd>One of 3 segments per quarter (12 total). Draft &rarr; Matchups &rarr; Scoring.</dd>
            <dt>Shot Check</dt><dd>Bonus roll triggered by cards. D20 + bonus vs Shot Line.</dd>
            <dt>Reaction Card</dt><dd>Played in response to opponent's action before it resolves.</dd>
          </dl>
        </AccordionSection>
      </div>
    </div>
  );
}
