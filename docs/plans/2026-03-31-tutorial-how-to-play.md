# Tutorial Mode + How to Play Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an AI engine, interactive tutorial, and unified "How to Play" page with accordion rules and contextual help buttons.

**Architecture:** Three modules — `src/game/ai.js` (pure decision engine), `src/components/HowToPlay.jsx` (top-level tab replacing RulebookTab), and `src/components/game/TutorialOverlay.jsx` (tooltip system). The AI engine reads game state and returns actions via existing engine functions. The tutorial runs a real game against AI with guided tooltip overlays.

**Tech Stack:** React 18, Vite, existing pure game engine (engine.js, execCard.js, canPlay.js, cards.js, strats.js)

---

### Task 1: AI Engine — Core Decision Framework

**Files:**
- Create: `src/game/ai.js`

**Step 1: Create the AI module skeleton**

```javascript
// src/game/ai.js
// NBA Showdown 2K25 — AI Decision Engine
// Pure functions: takes game state + team key, returns an action object.
// No React, no side effects. Used by tutorial, solo mode, sim-to-end.

import { getTeam, getOpp, getPS, calcAdv, getFatigue } from './engine.js';
import { canPlayCard } from './canPlay.js';
import { getStrat, STRATS } from './strats.js';

/**
 * AI action types:
 *   { type: 'draft_pick', playerId }
 *   { type: 'set_matchups', matchups: [defIdx, ...] }
 *   { type: 'play_card', cardId, opts }
 *   { type: 'pass' }
 *   { type: 'roll', playerIdx }
 *   { type: 'end_section' }
 *   { type: 'spend_assist', spendType, playerIdx }
 *   { type: 'spend_rebound', rebType, playerIdx }
 */

// ── Draft Decision ──────────────────────────────────────────────────────────
// Evaluate available pool and pick the best player based on:
//   - Balance: don't overload one attribute type
//   - Fatigue: prefer rested players over fatigued ones
//   - Value: high stats relative to salary
export function aiDraftPick(game, teamKey) {
  const team = getTeam(game, teamKey);
  const pool = teamKey === 'A' ? game.draft.aPool : game.draft.bPool;
  if (!pool || pool.length === 0) return null;

  const currentStarters = team.starters || [];

  // Score each available player
  const scored = pool.map(player => {
    const ps = getPS(game, teamKey, player.id);
    const fatigue = ps?.minutes || 0;
    const fatPenalty = fatigue >= 16 ? -40 : fatigue >= 12 ? -20 : fatigue >= 8 ? -8 : 0;

    // Base value: combined attributes
    const baseVal = player.speed + player.power + (player.threePtBoost || 0) * 2 + (player.paintBoost || 0) * 2 + (player.defBoost || 0);

    // Shooting versatility bonus
    const shootBonus = (player.shotLine <= 13 ? 3 : player.shotLine <= 15 ? 1 : 0);

    // Hot/cold bonus
    const hotCold = ps ? ((ps.hot || 0) * 3 - (ps.cold || 0) * 3) : 0;

    return {
      player,
      score: baseVal + shootBonus + hotCold + fatPenalty,
    };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  return { type: 'draft_pick', playerId: scored[0].player.id };
}

// ── Matchup Assignment ──────────────────────────────────────────────────────
// Assign defenders to minimize opponent's total roll bonus.
// Greedy: for each opponent starter, assign the best available defender.
export function aiSetMatchups(game, teamKey) {
  const myT = getTeam(game, teamKey);
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const oppT = getTeam(game, oppKey);

  if (!myT.starters.length || !oppT.starters.length) return null;

  const available = new Set([0, 1, 2, 3, 4]);
  const matchups = new Array(5).fill(0);

  // Rank opponent starters by threat level (highest combined attributes first)
  const threats = oppT.starters.map((p, i) => ({
    idx: i,
    threat: p.speed + p.power + (p.threePtBoost || 0) * 3 + (p.paintBoost || 0) * 2,
  })).sort((a, b) => b.threat - a.threat);

  for (const { idx: oppIdx } of threats) {
    const opp = oppT.starters[oppIdx];
    let bestDef = null;
    let bestScore = -Infinity;

    for (const defIdx of available) {
      const def = myT.starters[defIdx];
      // Score = how well this defender matches up (higher = better defense)
      const spdDiff = def.speed + (def.defBoost || 0) - opp.speed;
      const pwrDiff = def.power + (def.defBoost || 0) - opp.power;
      const score = spdDiff + pwrDiff + (def.defBoost || 0) * 2;
      if (score > bestScore) {
        bestScore = score;
        bestDef = defIdx;
      }
    }

    matchups[oppIdx] = bestDef;
    available.delete(bestDef);
  }

  return { type: 'set_matchups', matchups };
}

// ── Scoring Phase: Card or Pass ─────────────────────────────────────────────
// Evaluate all playable cards in hand, score them, play the best one or pass.
export function aiScoringDecision(game, teamKey) {
  const team = getTeam(game, teamKey);
  const hand = team.hand || [];

  // Find all playable cards with their value
  const playable = [];

  for (const cardId of hand) {
    const check = canPlayCard(game, teamKey, cardId);
    if (!check.canPlay) continue;

    const strat = getStrat(cardId);
    if (!strat) continue;

    // Only consider cards for the current game context
    const value = evaluateCard(game, teamKey, cardId, strat);
    if (value > 0) {
      playable.push({ cardId, value, strat });
    }
  }

  if (playable.length === 0) return { type: 'pass' };

  // Sort by value descending and play the best
  playable.sort((a, b) => b.value - a.value);
  const best = playable[0];

  // Build opts for the chosen card
  const opts = aiBuildCardOpts(game, teamKey, best.cardId);

  return { type: 'play_card', cardId: best.cardId, opts };
}

// ── Card Value Evaluation ───────────────────────────────────────────────────
function evaluateCard(game, teamKey, cardId, strat) {
  const phase = game.phase;

  // Phase gating — matchup cards only in matchup phase, etc.
  if (strat.phase === 'matchup' && phase !== 'matchup_strats') return 0;
  if (strat.phase === 'scoring' && phase !== 'scoring') return 0;
  if (strat.phase === 'pre_roll' && phase !== 'scoring') return 0;
  if (strat.phase === 'post_roll' && phase !== 'scoring') return 0;
  if (strat.phase === 'reaction') return 0; // AI reactions handled separately

  // Base values by card type
  const values = {
    // Matchup phase
    high_screen_roll: 6,
    stagger_action: 7,
    second_wind: 5,
    chip_on_shoulder: 6,
    defensive_stopper: 7,

    // Pre-roll
    ghost_screen: 5,
    you_stand_over_there: 7,
    putback_dunk: 8,
    pin_down_screen: 6,
    turnover: 4,

    // Scoring
    green_light: 8,
    from_way_downtown: 4,
    catch_and_shoot: 5,
    elevator_doors: 6,
    bully_ball: 7,
    power_move: 4,
    and_one: 6,
    rimshaker: 7,
    drive_the_lane: 5,
    uncontested_layup: 8,
    back_to_basket: 5,
    cross_court_dime: 7,
    energy_injection: 3,
    crowd_favorite: 3,
    switch_everything: 6,
    this_is_my_house: 8,
    delayed_slip: 4,

    // Post-roll
    heat_check: 7,
    burst_of_momentum: 6,
    flare_screen: 7,

    // Defensive scoring
    dogged: 4,
    offensive_board: 5,
    rebound_tap_out: 5,
  };

  return values[cardId] || 3;
}

// ── Build Card Options ──────────────────────────────────────────────────────
// For cards that need player selection, pick the best target.
function aiBuildCardOpts(game, teamKey, cardId) {
  const myT = getTeam(game, teamKey);
  const oppT = getOpp(game, teamKey);
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const starters = myT.starters || [];
  const rolls = game.rollResults[teamKey] || [];

  switch (cardId) {
    case 'high_screen_roll': {
      // Swap the two players with worst matchups
      const advs = starters.map((p, i) => {
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        const adv = dp ? calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i) : { rollBonus: 0 };
        return { idx: i, bonus: adv.rollBonus };
      }).sort((a, b) => a.bonus - b.bonus);
      return { playerIdx: advs[0].idx, player2Idx: advs[1].idx };
    }

    case 'stagger_action': {
      const spd13 = starters.findIndex(p => p.speed >= 13);
      const three = starters.findIndex((p, i) => i !== spd13 && (p.threePtBoost || 0) > 0);
      return { playerIdx: spd13 >= 0 ? spd13 : 0, player2Idx: three >= 0 ? three : 1 };
    }

    case 'second_wind': {
      const worst = starters.reduce((best, p, i) => {
        const fat = getFatigue(game, teamKey, i);
        return fat < (best.fat || 0) ? { idx: i, fat } : best;
      }, { idx: 0, fat: 0 });
      return { playerIdx: worst.idx };
    }

    case 'chip_on_shoulder': {
      const cheapIdx = starters.findIndex(p => p.salary <= 250);
      return { playerIdx: cheapIdx >= 0 ? cheapIdx : 0 };
    }

    case 'defensive_stopper': {
      const freshIdx = starters.findIndex(p => {
        const ps = getPS(game, teamKey, p.id);
        return (ps?.minutes || 0) === 0;
      });
      return { playerIdx: freshIdx >= 0 ? freshIdx : 0 };
    }

    case 'ghost_screen': {
      // Pick a Speed 12+ player with the worst penalty who hasn't rolled
      const candidates = starters.map((p, i) => {
        if (rolls[i] != null) return null;
        if (p.speed < 12) return null;
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return null;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        if (!adv.hasPenalty) return null;
        return { idx: i, penalty: adv.rollBonus };
      }).filter(Boolean).sort((a, b) => a.penalty - b.penalty);
      return { playerIdx: candidates.length ? candidates[0].idx : 0 };
    }

    case 'green_light':
    case 'you_stand_over_there':
    case 'from_way_downtown':
    case 'catch_and_shoot':
    case 'elevator_doors': {
      // Pick best 3PT shooter who hasn't rolled
      const best = starters.reduce((b, p, i) => {
        if (rolls[i] != null && !rolls[i]?.isReplaced) return b;
        const tpb = p.threePtBoost || 0;
        return tpb > (b.boost || -99) ? { idx: i, boost: tpb } : b;
      }, { idx: 0, boost: -99 });
      return { playerIdx: best.idx };
    }

    case 'bully_ball':
    case 'power_move':
    case 'back_to_basket': {
      // Pick highest power player
      const best = starters.reduce((b, p, i) => {
        if (rolls[i] != null) return b;
        return p.power > (b.pwr || 0) ? { idx: i, pwr: p.power } : b;
      }, { idx: 0, pwr: 0 });
      return { playerIdx: best.idx };
    }

    case 'and_one': {
      // Pick player with biggest advantage
      const best = starters.reduce((b, p, i) => {
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return b;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        const maxAdv = Math.max(adv.speedAdv, adv.powerAdv);
        return maxAdv > (b.adv || 0) ? { idx: i, adv: maxAdv } : b;
      }, { idx: 0, adv: 0 });
      return { playerIdx: best.idx };
    }

    case 'drive_the_lane': {
      const best = starters.reduce((b, p, i) => {
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return b;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        return adv.speedAdv > (b.adv || 0) ? { idx: i, adv: adv.speedAdv } : b;
      }, { idx: 0, adv: 0 });
      return { playerIdx: best.idx };
    }

    case 'uncontested_layup': {
      const candidate = starters.findIndex((p, i) => {
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return false;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        return adv.speedAdv >= 2 && adv.powerAdv >= 2;
      });
      return { playerIdx: candidate >= 0 ? candidate : 0 };
    }

    case 'rimshaker': {
      const hotPwr = starters.findIndex(p => {
        const ps = getPS(game, teamKey, p.id);
        return p.power >= 13 && (ps?.hot || 0) > 0;
      });
      return { playerIdx: hotPwr >= 0 ? hotPwr : 0 };
    }

    case 'heat_check': {
      const topRoller = rolls.findIndex(r => r?.isTop);
      return { playerIdx: topRoller >= 0 ? topRoller : 0 };
    }

    case 'burst_of_momentum': {
      const topBig = rolls.findIndex(r => r?.isTop && (r?.pts || 0) >= 5);
      return { playerIdx: topBig >= 0 ? topBig : 0 };
    }

    case 'flare_screen': {
      const nat20 = rolls.findIndex(r => r?.die === 20);
      return { playerIdx: nat20 >= 0 ? nat20 : 0 };
    }

    case 'energy_injection': {
      const cheap = starters.reduce((acc, p, i) => {
        if (p.salary < 400) acc.push(i);
        return acc;
      }, []);
      return { playerIdx: cheap[0] || 0, player2Idx: cheap[1] || 1 };
    }

    case 'cross_court_dime': {
      // Best shooter overall
      const best = starters.reduce((b, p, i) => {
        const val = (p.threePtBoost || 0) + (p.paintBoost || 0);
        return val > (b.val || 0) ? { idx: i, val } : b;
      }, { idx: 0, val: 0 });
      return { playerIdx: best.idx };
    }

    case 'crowd_favorite': {
      const cheapIdx = starters.findIndex(p => p.salary <= 350);
      return { playerIdx: cheapIdx >= 0 ? cheapIdx : 0 };
    }

    case 'switch_everything': {
      // Use the matchup AI to figure out best defense
      const result = aiSetMatchups(game, teamKey);
      return result ? { matchups: result.matchups } : {};
    }

    case 'this_is_my_house': {
      // Find a defender who has higher Speed AND Power than their offensive matchup
      const oppMatchups = game.offMatchups[oppKey] || [];
      for (let oi = 0; oi < 5; oi++) {
        const offP = oppT.starters[oi];
        const di = oppMatchups[oi] ?? oi;
        const defP = myT.starters[di];
        if (offP && defP && defP.speed > offP.speed && defP.power > offP.power) {
          return { playerIdx: oi }; // target the offensive player to block
        }
      }
      return { playerIdx: 0 };
    }

    case 'dogged': {
      const oppStarters = oppT.starters || [];
      const fatigued = oppStarters.findIndex((_, i) => getFatigue(game, oppKey, i) < 0);
      return { playerIdx: fatigued >= 0 ? fatigued : 0 };
    }

    case 'pin_down_screen': {
      // Discard worst card, pick best 3PT shooter
      const bestShooter = starters.reduce((b, p, i) => {
        return (p.threePtBoost || 0) > (b.boost || -99) ? { idx: i, boost: p.threePtBoost || 0 } : b;
      }, { idx: 0, boost: -99 });
      return { playerIdx: bestShooter.idx, discardIdx: 0 };
    }

    case 'putback_dunk': {
      const pwr14 = starters.findIndex(p => p.power >= 14);
      return { playerIdx: pwr14 >= 0 ? pwr14 : 0 };
    }

    case 'delayed_slip': {
      const eligible = starters.findIndex((p, i) => {
        if ((p.speed || 0) < 12 || (p.power || 0) < 10) return false;
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return false;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        return adv.rollBonus <= 0 && !adv.hasPenalty;
      });
      return { playerIdx: eligible >= 0 ? eligible : 0 };
    }

    case 'offensive_board': {
      // Pick highest power player who already rolled
      const best = starters.reduce((b, p, i) => {
        if (!rolls[i]) return b;
        return p.power > (b.pwr || 0) ? { idx: i, pwr: p.power } : b;
      }, { idx: 0, pwr: 0 });
      return { playerIdx: best.idx };
    }

    case 'rebound_tap_out': {
      const tpIdx = starters.findIndex(p => (p.threePtBoost || 0) > 0);
      return { playerIdx: tpIdx >= 0 ? tpIdx : 0 };
    }

    case 'turnover': {
      // Just needs to be played — targets cold opponent automatically
      return {};
    }

    case 'coaches_challenge': {
      // Target opponent's highest-scoring roll
      const oppRolls = game.rollResults[oppKey] || [];
      let bestIdx = 0, bestPts = 0;
      oppRolls.forEach((r, i) => {
        if (r && (r.pts || 0) > bestPts) { bestPts = r.pts; bestIdx = i; }
      });
      return { playerIdx: bestIdx };
    }

    case 'anticipate_pass': {
      return {};
    }

    case 'cold_spell': {
      const oppRolls = game.rollResults[oppKey] || [];
      const target = oppRolls.findIndex(r => r && (r.die === 1 || r.die === 2) && !r.coldSpellUsed);
      return { playerIdx: target >= 0 ? target : 0 };
    }

    default:
      return {};
  }
}

// ── Rolling Decision ────────────────────────────────────────────────────────
// Pick the next player to roll, prioritizing best matchups first.
export function aiRollDecision(game, teamKey) {
  const myT = getTeam(game, teamKey);
  const oppT = getOpp(game, teamKey);
  const rolls = game.rollResults[teamKey] || [];
  const blocked = game.blockedRolls?.[teamKey] || {};

  const candidates = myT.starters.map((p, i) => {
    if (rolls[i] != null || blocked[i]) return null;
    const di = (game.offMatchups[teamKey] || [])[i] ?? i;
    const dp = oppT.starters[di];
    if (!dp) return { idx: i, bonus: 0 };
    const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
    const fat = getFatigue(game, teamKey, i);
    const ps = getPS(game, teamKey, p.id) || {};
    const mrkB = ((ps.hot || 0) - (ps.cold || 0)) * 2;
    return { idx: i, bonus: adv.rollBonus + fat + mrkB };
  }).filter(Boolean);

  if (candidates.length === 0) return null;

  // Roll best matchups first
  candidates.sort((a, b) => b.bonus - a.bonus);
  return { type: 'roll', playerIdx: candidates[0].idx };
}

// ── Reaction Card Decision ──────────────────────────────────────────────────
// Check if AI should play a reaction card in response to opponent's action.
export function aiReactionDecision(game, teamKey, trigger) {
  const team = getTeam(game, teamKey);
  const hand = team.hand || [];

  // Close Out: always play if available and beneficial
  if (trigger === 'shot_check' && hand.includes('close_out')) {
    const check = canPlayCard(game, teamKey, 'close_out');
    if (check.canPlay) return { type: 'play_card', cardId: 'close_out', opts: {} };
  }

  // Cold Spell: always play on natural 1-2
  if (trigger === 'cold_roll' && hand.includes('cold_spell')) {
    const check = canPlayCard(game, teamKey, 'cold_spell');
    if (check.canPlay) {
      const opts = aiBuildCardOpts(game, teamKey, 'cold_spell');
      return { type: 'play_card', cardId: 'cold_spell', opts };
    }
  }

  // Screen reactions: pick the best one
  if (trigger === 'screen_card') {
    const reactions = ['veer_switch', 'fight_over', 'go_under'];
    for (const cardId of reactions) {
      if (hand.includes(cardId)) {
        const check = canPlayCard(game, teamKey, cardId);
        if (check.canPlay) return { type: 'play_card', cardId, opts: {} };
      }
    }
  }

  // Coach's Challenge: play on high-scoring rolls
  if (trigger === 'opp_scored' && hand.includes('coaches_challenge')) {
    const check = canPlayCard(game, teamKey, 'coaches_challenge');
    if (check.canPlay) {
      const opts = aiBuildCardOpts(game, teamKey, 'coaches_challenge');
      return { type: 'play_card', cardId: 'coaches_challenge', opts };
    }
  }

  return null; // No reaction
}

// ── Master AI Turn ──────────────────────────────────────────────────────────
// Given the current game state, decide what action to take.
// Returns an action object or null if no action needed.
export function aiTurn(game, teamKey) {
  const phase = game.phase;

  if (phase === 'draft') {
    return aiDraftPick(game, teamKey);
  }

  if (phase === 'matchup_strats') {
    // Try to play a matchup card first, otherwise pass
    const cardDecision = aiScoringDecision(game, teamKey);
    return cardDecision;
  }

  if (phase === 'scoring') {
    const scoringPasses = game.scoringPasses || 0;
    const rollingOpen = scoringPasses >= 99;

    if (rollingOpen) {
      // In rolling phase — roll next player
      return aiRollDecision(game, teamKey);
    }

    // In card-play phase — play a card or pass
    if (game.scoringTurn === teamKey) {
      const decision = aiScoringDecision(game, teamKey);
      return decision;
    }
  }

  return null;
}
```

**Step 2: Verify the module imports correctly**

Run: `cd /c/Users/hoops/OneDrive/Documents/showdown-app/showdown-app && node -e "import('./src/game/ai.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`

Note: This may fail since it's ESM/JSX. Instead verify via dev server — the tutorial component (Task 5) will be the integration test.

**Step 3: Commit**

```bash
git add src/game/ai.js
git commit -m "feat: add AI decision engine for tutorial, solo, and sim-to-end"
```

---

### Task 2: How to Play Page — Accordion Rules Reference

**Files:**
- Create: `src/components/HowToPlay.jsx`
- Create: `src/components/HowToPlay.module.css`
- Modify: `src/App.jsx` — replace RulebookTab with HowToPlay in nav

**Step 1: Create the HowToPlay component with accordion sections**

```javascript
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
        <span className={s.chevron}>{open ? '▾' : '▸'}</span>
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
          <p className={s.draftOrder}>A → B → B → A → A → B → B → A → A → B</p>
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
            <li><strong>3PT Check:</strong> D20 + 3PT Bonus ≥ Shot Line → 3 points</li>
            <li><strong>Paint Check:</strong> D20 + Paint Bonus ≥ Shot Line → 2 points</li>
            <li><strong>Free Throw:</strong> D20 + 10 ≥ Shot Line → 1 point</li>
          </ul>
          <h4>Natural Roll Effects</h4>
          <ul>
            <li>Natural 1 or 2 → <strong>Cold marker</strong> (−2 to future rolls)</li>
            <li>Natural 19 or 20 → <strong>Hot marker</strong> (+2 to future rolls)</li>
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
          <p>Cards marked <strong>🔒 Locked</strong> cannot be canceled once played.</p>
          <p>See the Strategy Cards tab for the full card list with descriptions.</p>
        </AccordionSection>

        <AccordionSection id="assists" title="Assists, Rebounds & Bonuses" open={openSections.has('assists')} onToggle={() => toggle('assists')}>
          <h4>Assist Track</h4>
          <p>Assists accumulate across the game and can be spent:</p>
          <ul>
            <li><strong>1 AST:</strong> +1 to any shot check</li>
            <li><strong>2 AST:</strong> Attempt a 3PT shot check (requires 3PT Bonus)</li>
            <li><strong>3 AST:</strong> Attempt a Paint shot check (requires Paint Bonus)</li>
            <li><strong>5 AST total:</strong> Draw a bonus strategy card</li>
          </ul>
          <h4>Rebound Track</h4>
          <p>The differential between teams unlocks bonuses at section end:</p>
          <ul>
            <li><strong>Winning:</strong> +1 stored assist</li>
            <li><strong>+3 differential:</strong> Second-chance Paint check (costs 2 REB)</li>
            <li><strong>+5 differential:</strong> Fast-break shot check (costs 3 REB)</li>
            <li><strong>Individual 2+ REB in a section:</strong> Putback opportunity (costs 2 REB)</li>
          </ul>
        </AccordionSection>

        <AccordionSection id="fatigue" title="Fatigue & Substitutions" open={openSections.has('fatigue')} onToggle={() => toggle('fatigue')}>
          <p>Each section played adds <strong>4 minutes</strong> of fatigue:</p>
          <ul>
            <li><strong>0–8 minutes:</strong> No penalty (2 sections free)</li>
            <li><strong>8–12 minutes:</strong> −2 to all rolls</li>
            <li><strong>12–16 minutes:</strong> −6 to all rolls</li>
            <li><strong>16+ minutes:</strong> −12 to all rolls</li>
          </ul>
          <p><strong>Recovery:</strong> Sitting on the bench for 1 section recovers up to 8 minutes of fatigue (2x rate for first 8 min).</p>
          <p><strong>Halftime:</strong> All fatigue and hot/cold markers reset at the start of Q3.</p>
          <p>Rotate your bench players to keep starters fresh for crucial moments.</p>
        </AccordionSection>

        <AccordionSection id="advanced" title="Advanced: Hot/Cold, And-One, Close Out" open={openSections.has('advanced')} onToggle={() => toggle('advanced')}>
          <h4>Hot/Cold Markers</h4>
          <ul>
            <li>Each hot marker: <strong>+2</strong> to all rolls. Each cold marker: <strong>−2</strong>.</li>
            <li>Markers stack and can coexist (a player can be hot AND cold).</li>
            <li>Clear when benched for a section, or at halftime.</li>
          </ul>
          <h4>And-One</h4>
          <p>When a player has Speed or Power advantage ≥3 over their defender:</p>
          <ul>
            <li><strong>Advantage 3–4:</strong> +1 point</li>
            <li><strong>Advantage 5+:</strong> +1 point AND a free throw check</li>
          </ul>
          <h4>Close Out</h4>
          <p>A defensive reaction card played when the opponent announces a 3PT Shot Check. Applies <strong>−3 to the check</strong>. If the shot misses after Close Out, the shooter gains a <strong>cold marker</strong>.</p>
        </AccordionSection>

        <AccordionSection id="glossary" title="Glossary" open={openSections.has('glossary')} onToggle={() => toggle('glossary')}>
          <dl className={s.glossary}>
            <dt>Speed (SPD)</dt><dd>Player quickness. Affects matchup advantage and perimeter cards.</dd>
            <dt>Power (PWR)</dt><dd>Player strength. Affects matchup advantage and paint cards.</dd>
            <dt>Shot Line</dt><dd>D20 threshold for shot checks. Lower = better shooter.</dd>
            <dt>Roll Bonus</dt><dd>Modifier from matchup advantage + fatigue + hot/cold + cards.</dd>
            <dt>Def Boost</dt><dd>Defensive bonus that neutralizes offensive advantages (never creates penalties).</dd>
            <dt>Hot/Cold Markers</dt><dd>±2 per marker to all future rolls. Clear on bench or halftime.</dd>
            <dt>Snake Draft</dt><dd>Alternating pick order: A-B-B-A-A-B-B-A-A-B.</dd>
            <dt>Section</dt><dd>One of 3 segments per quarter (12 total). Draft → Matchups → Scoring.</dd>
            <dt>Shot Check</dt><dd>Bonus roll triggered by cards. D20 + bonus vs Shot Line.</dd>
            <dt>Reaction Card</dt><dd>Played in response to opponent's action before it resolves.</dd>
          </dl>
        </AccordionSection>
      </div>
    </div>
  );
}
```

**Step 2: Create the CSS module**

```css
/* src/components/HowToPlay.module.css */
.wrap { max-width: 800px; margin: 0 auto; padding: 16px; }

/* Hero */
.hero { text-align: center; margin-bottom: 32px; }
.heroTitle { font-size: 28px; font-weight: 800; color: #F1F5F9; margin: 0 0 4px; }
.heroSub { font-size: 14px; color: #94A3B8; margin: 0 0 20px; }

.tutorialCard {
  background: linear-gradient(135deg, rgba(234,88,12,0.15), rgba(37,99,235,0.15));
  border: 1px solid rgba(234,88,12,0.3);
  border-radius: 12px;
  padding: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  text-align: left;
}
.tutorialInfo h2 { font-size: 18px; color: #F1F5F9; margin: 0 0 8px; }
.tutorialInfo p { font-size: 13px; color: #94A3B8; margin: 0 0 8px; line-height: 1.5; }
.tutorialTime { font-size: 12px; color: #64748B; }
.tutorialBtn {
  background: var(--orange);
  color: #fff;
  border: none;
  padding: 12px 28px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.tutorialBtn:hover { background: #C2410C; }

/* Accordion */
.rules { display: flex; flex-direction: column; gap: 2px; }

.section {
  background: rgba(10, 22, 40, 0.7);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  overflow: hidden;
}
.section.open { border-color: rgba(255,255,255,0.15); }

.sectionHeader {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: none;
  border: none;
  color: #F1F5F9;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}
.sectionHeader:hover { background: rgba(255,255,255,0.04); }
.chevron { font-size: 14px; color: #64748B; }

.sectionBody {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease;
}
.sectionContent {
  padding: 0 16px 16px;
  color: #CBD5E1;
  font-size: 13px;
  line-height: 1.7;
}
.sectionContent h4 { color: #F1F5F9; font-size: 14px; margin: 16px 0 6px; }
.sectionContent ul, .sectionContent ol { padding-left: 20px; margin: 8px 0; }
.sectionContent li { margin-bottom: 4px; }
.sectionContent p { margin: 8px 0; }

.draftOrder {
  font-family: monospace;
  font-size: 14px;
  color: var(--orange);
  font-weight: 700;
  text-align: center;
  padding: 8px;
  background: rgba(234,88,12,0.08);
  border-radius: 6px;
}

.formula {
  font-family: monospace;
  font-size: 13px;
  color: #F1F5F9;
  background: rgba(255,255,255,0.06);
  padding: 8px 12px;
  border-radius: 6px;
  text-align: center;
}

.glossary { display: grid; grid-template-columns: 140px 1fr; gap: 6px 12px; }
.glossary dt { color: #F1F5F9; font-weight: 600; font-size: 13px; }
.glossary dd { color: #94A3B8; font-size: 13px; margin: 0; }
```

**Step 3: Update App.jsx — replace Rulebook with How to Play**

In `src/App.jsx`, make these changes:

1. Replace `import RulebookTab` with `import HowToPlay`
2. Update both `GUEST_TABS` and `AUTH_TABS` to use `'howtoplay'` instead of `'rules'`
3. Replace the `{tab === 'rules' && <RulebookTab />}` render with the HowToPlay component
4. Add tutorial launch handler that switches to play tab with tutorial mode

```javascript
// Import change:
// import RulebookTab from './components/RulebookTab.jsx';
import HowToPlay from './components/HowToPlay.jsx';

// Tab arrays:
const GUEST_TABS = [
  { id: 'cards',     label: '📋 Cards' },
  { id: 'strats',    label: '🃏 Strategy Cards' },
  { id: 'builder',   label: '🏗 Team Builder' },
  { id: 'play',      label: '🏀 Play' },
  { id: 'howtoplay', label: '📖 How to Play' },
];
const AUTH_TABS = [
  { id: 'builder',   label: '🏗 Team Builder' },
  { id: 'play',      label: '🏀 Play' },
  { id: 'pvp',       label: '⚔️ PvP' },
  { id: 'collection',label: '💾 Collection' },
  { id: 'howtoplay', label: '📖 How to Play' },
];

// Render change:
// {tab === 'rules' && <RulebookTab />}
{tab === 'howtoplay' && (
  <HowToPlay
    scrollToSection={null}
    onStartTutorial={() => { setTutorialMode(true); setTab('play'); }}
  />
)}
```

Add `tutorialMode` state:
```javascript
const [tutorialMode, setTutorialMode] = useState(false);
```

**Step 4: Commit**

```bash
git add src/components/HowToPlay.jsx src/components/HowToPlay.module.css src/App.jsx
git commit -m "feat: add How to Play page with accordion rules, replacing Rulebook tab"
```

---

### Task 3: Tutorial Overlay System

**Files:**
- Create: `src/components/game/TutorialOverlay.jsx`
- Create: `src/components/game/TutorialOverlay.module.css`

**Step 1: Create the tooltip overlay component**

```javascript
// src/components/game/TutorialOverlay.jsx
import { useState, useEffect } from 'react';
import s from './TutorialOverlay.module.css';

/**
 * Tutorial tooltip data format:
 * {
 *   id: string,              // unique tooltip ID
 *   text: string,            // main message
 *   detail: string|null,     // optional secondary text
 *   anchor: string,          // CSS selector or element ID to anchor near
 *   position: 'top'|'bottom'|'left'|'right',
 *   trigger: {               // when to show this tooltip
 *     phase: string,         // game phase (draft, matchup_strats, scoring)
 *     condition: function,   // (game) => boolean
 *   },
 *   section: number,         // which tutorial section (1, 2, 3)
 *   priority: number,        // higher = shown first when multiple match
 * }
 */

export default function TutorialOverlay({ game, tooltips, onDismiss, onSkip }) {
  const [dismissed, setDismissed] = useState(new Set());

  // Find the highest-priority tooltip that matches current game state
  const activeTooltip = tooltips
    .filter(t => !dismissed.has(t.id))
    .filter(t => {
      if (t.trigger.phase && t.trigger.phase !== game.phase) return false;
      if (t.trigger.condition && !t.trigger.condition(game)) return false;
      return true;
    })
    .sort((a, b) => b.priority - a.priority)[0] || null;

  const handleDismiss = () => {
    if (!activeTooltip) return;
    setDismissed(prev => new Set([...prev, activeTooltip.id]));
    onDismiss?.(activeTooltip.id);
  };

  if (!activeTooltip) return null;

  return (
    <>
      <div className={s.overlay} />
      <div className={`${s.tooltip} ${s[activeTooltip.position || 'bottom']}`}>
        <div className={s.tooltipText}>{activeTooltip.text}</div>
        {activeTooltip.detail && <div className={s.tooltipDetail}>{activeTooltip.detail}</div>}
        <div className={s.tooltipActions}>
          <button className={s.gotIt} onClick={handleDismiss}>Got it</button>
          <button className={s.skip} onClick={onSkip}>Skip Tutorial</button>
        </div>
      </div>
    </>
  );
}
```

**Step 2: Create CSS module**

```css
/* src/components/game/TutorialOverlay.module.css */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 100;
  pointer-events: none;
}

.tooltip {
  position: fixed;
  bottom: 20%;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, #1E293B, #0F172A);
  border: 1px solid rgba(234, 88, 12, 0.4);
  border-radius: 12px;
  padding: 16px 20px;
  max-width: 420px;
  z-index: 101;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.tooltipText {
  color: #F1F5F9;
  font-size: 14px;
  line-height: 1.6;
  margin-bottom: 8px;
}

.tooltipDetail {
  color: #94A3B8;
  font-size: 12px;
  line-height: 1.5;
  margin-bottom: 12px;
  padding-top: 8px;
  border-top: 1px solid rgba(255,255,255,0.08);
}

.tooltipActions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.gotIt {
  background: var(--orange);
  color: #fff;
  border: none;
  padding: 6px 20px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.gotIt:hover { background: #C2410C; }

.skip {
  background: none;
  border: none;
  color: #64748B;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
}
.skip:hover { color: #94A3B8; }
```

**Step 3: Commit**

```bash
git add src/components/game/TutorialOverlay.jsx src/components/game/TutorialOverlay.module.css
git commit -m "feat: add tutorial tooltip overlay component"
```

---

### Task 4: Tutorial Tooltip Data

**Files:**
- Create: `src/game/tutorialData.js`

**Step 1: Create tooltip definitions for all 3 sections**

```javascript
// src/game/tutorialData.js
// Tutorial tooltip content — data-driven for easy editing
// Each tooltip has: id, text, detail, section (1-3), trigger, priority

import { getFatigue, getTeam, getPS } from './engine.js';

export const TUTORIAL_TOOLTIPS = [
  // ── Section 1: Learn the Basics ──────────────────────────────────────────

  // Draft
  {
    id: 's1_draft_intro',
    text: "Welcome to the Draft! You'll pick 5 starters from your 10-player roster using a snake draft: A → B → B → A → A → B → B → A → A → B.",
    detail: "Look at each player's Speed, Power, and Shot Line. High Speed excels at perimeter play; high Power dominates inside. Low Shot Lines mean better shooters.",
    section: 1,
    priority: 100,
    trigger: { phase: 'draft', condition: (g) => g.quarter === 1 && g.section === 1 && g.draft.step === 0 },
  },
  {
    id: 's1_draft_pick1',
    text: "For your first pick, choose your best all-around player — someone with high Speed AND Power gives you flexibility in matchups.",
    detail: "Tip: Players with Defensive Boosts are valuable because they can neutralize opponent advantages without strategy cards.",
    section: 1,
    priority: 90,
    trigger: { phase: 'draft', condition: (g) => g.quarter === 1 && g.section === 1 && g.draft.step <= 1 },
  },

  // Matchup
  {
    id: 's1_matchup_intro',
    text: "Matchup Strategy Phase! Assign your defenders, then play strategy cards or pass. Two passes from both teams ends the phase.",
    detail: "Check matchup advantages: green numbers mean your player has the edge. Red numbers mean the defender has the advantage. Try to create favorable matchups before scoring begins.",
    section: 1,
    priority: 100,
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 1 && g.matchupPasses === 0 },
  },

  // Scoring
  {
    id: 's1_scoring_intro',
    text: "Scoring Phase! Take turns playing strategy cards, then both pass to open rolling. Each player rolls a D20 + their matchup bonus to score.",
    detail: "Your roll is modified by matchup advantage, fatigue (none yet!), and hot/cold markers. The result is looked up on the player's scoring chart for points, rebounds, and assists.",
    section: 1,
    priority: 100,
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 1 && g.scoringPasses === 0 },
  },
  {
    id: 's1_first_card',
    text: "Look at your hand on the left. Cards with a green border are playable right now. Hover over a card to see what it does, then click to play it!",
    detail: "Each card has a phase (when it can be played) and requirements. If a card is grayed out, check its tooltip for why.",
    section: 1,
    priority: 80,
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 1 && g.scoringPasses < 2 },
  },
  {
    id: 's1_rolling_open',
    text: "Rolling is open! Click on any of your players to roll their D20. The roll gets modified by their matchup bonus, then checked against their scoring chart.",
    detail: "Natural 19-20 = Hot marker (+2 to future rolls). Natural 1-2 = Cold marker (-2). Watch for these!",
    section: 1,
    priority: 90,
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 1 && g.scoringPasses >= 99 },
  },
  {
    id: 's1_end_section',
    text: "All players have rolled! Review the section results. The team winning the rebound track gets +1 assist. Click 'End Section' to move on.",
    detail: "At the end of each section, temporary effects clear, starters gain +4 minutes of fatigue, and both teams draw back up to 7 cards.",
    section: 1,
    priority: 100,
    trigger: {
      phase: 'scoring',
      condition: (g) => {
        if (g.quarter !== 1 || g.section !== 1) return false;
        const rA = g.rollResults?.A || [], rB = g.rollResults?.B || [];
        return [0,1,2,3,4].every(i => rA[i] != null) && [0,1,2,3,4].every(i => rB[i] != null);
      },
    },
  },

  // ── Section 2: Deeper Strategy ───────────────────────────────────────────

  {
    id: 's2_draft_reminder',
    text: "Section 2 draft. Your starters from last section now have 4 minutes of fatigue — they're still fine, but after another section they'll start to slow down.",
    section: 2,
    priority: 80,
    trigger: { phase: 'draft', condition: (g) => g.quarter === 1 && g.section === 2 && g.draft.step === 0 },
  },
  {
    id: 's2_assists_intro',
    text: "Did you notice your assist and rebound tracks? You can spend assists for bonus shot checks! Check the buttons below each player.",
    detail: "1 AST = +1 to a shot check. 2 AST = free 3PT check. 3 AST = free Paint check. Reaching 5 total assists draws a bonus card!",
    section: 2,
    priority: 70,
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 2 && g.scoringPasses >= 99 },
  },
  {
    id: 's2_reaction_cards',
    text: "Keep an eye on your reaction cards — Close Out can reduce opponent 3PT checks by -3, and Cold Spell punishes natural 1-2 rolls. These are played automatically when triggered.",
    section: 2,
    priority: 60,
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 2 && g.scoringPasses < 2 },
  },

  // ── Section 3: Fatigue & Substitutions ───────────────────────────────────

  {
    id: 's3_fatigue_warning',
    text: "Section 3 — check your players' fatigue! Anyone with 8+ minutes now has a -2 penalty to all rolls. Consider resting tired players this section.",
    detail: "Fatigue thresholds: 8 min = -2, 12 min = -6, 16 min = -12. Benching a player for 1 section recovers up to 8 minutes. At halftime (Q3), all fatigue resets.",
    section: 3,
    priority: 100,
    trigger: {
      phase: 'draft',
      condition: (g) => {
        if (g.quarter !== 1 || g.section !== 3) return false;
        if (g.draft.step !== 0) return false;
        // Check if any player is fatigued
        const team = getTeam(g, 'A');
        return team.stats.some(ps => (ps.minutes || 0) >= 8);
      },
    },
  },
  {
    id: 's3_sub_strategy',
    text: "Smart substitution: draft a fresh bench player instead of your tired star. They'll perform better this section, and your star recovers fatigue for next time.",
    section: 3,
    priority: 90,
    trigger: {
      phase: 'draft',
      condition: (g) => g.quarter === 1 && g.section === 3 && g.draft.step >= 1 && g.draft.step <= 3,
    },
  },
  {
    id: 's3_quarter_end',
    text: "Great work! You've completed your first quarter of NBA Showdown. The game has 4 quarters (12 total sections). You now understand drafting, matchups, scoring, cards, and fatigue management!",
    detail: "Continue playing to explore deeper strategy, or head to How to Play for the full rules reference. Good luck!",
    section: 3,
    priority: 100,
    trigger: {
      phase: 'draft',
      condition: (g) => g.quarter === 2 && g.section === 1 && g.draft.step === 0,
    },
  },
];

// ── Pre-set Tutorial Rosters ─────────────────────────────────────────────────
// Hand-picked balanced rosters that showcase diverse mechanics.
// These IDs should match entries in CARD_MAP.
// Roster A: balanced mix of speed, power, shooting
// Roster B: AI-controlled opponent
export const TUTORIAL_ROSTER_A_IDS = [
  'jayson_tatum',      // Elite all-around (S14 P13, 3PT+2)
  'anthony_edwards',   // Speed star (S15 P12)
  'bam_adebayo',       // Power/defense (P15, Def+3)
  'tyrese_haliburton', // Playmaker (S14, high assists on chart)
  'mikal_bridges',     // 3&D role player (S13, 3PT+1, Def+1)
  'jalen_brunson',     // Mid-salary guard (S13 P11)
  'evan_mobley',       // Defensive big (P13, Def+3)
  'desmond_bane',      // Shooter (3PT+2)
  'herb_jones',        // Budget defender (low salary, Def+2)
  'ayo_dosunmu',       // Budget guard (low salary)
];

export const TUTORIAL_ROSTER_B_IDS = [
  'luka_doncic',       // Elite playmaker (S13 P13, 3PT+2)
  'shai_gilgeous_alexander', // Speed/scoring (S15 P12)
  'giannis_antetokounmpo',  // Power monster (P16)
  'damian_lillard',    // Deep threat (3PT+3)
  'scottie_barnes',    // Versatile (S13 P13)
  'darius_garland',    // Mid guard (S14)
  'jaren_jackson_jr',  // Rim protector (P14, Def+2)
  'tyler_herro',       // Shooter (3PT+2)
  'jose_alvarado',     // Budget guard
  'tari_eason',        // Budget forward
];
```

**Step 2: Commit**

```bash
git add src/game/tutorialData.js
git commit -m "feat: add tutorial tooltip data and pre-set rosters"
```

---

### Task 5: Tutorial Game Integration

**Files:**
- Create: `src/components/TutorialGame.jsx`
- Modify: `src/App.jsx` — wire up tutorial launch
- Modify: `src/components/PlayTab.jsx` — add tutorial mode support

**Step 1: Create TutorialGame component**

This component wraps the existing CourtBoard with AI opponent logic and tutorial overlays.

```javascript
// src/components/TutorialGame.jsx
import { useReducer, useCallback, useState, useEffect, useRef } from 'react';
import { newGame, doRoll, endSection, spendAssist, spendReboundBonus } from '../game/engine.js';
import { execCard, resolvePendingShotCheck } from '../game/execCard.js';
import { CARD_MAP } from '../game/cards.js';
import { aiTurn, aiRollDecision, aiSetMatchups, aiReactionDecision } from '../game/ai.js';
import { TUTORIAL_TOOLTIPS, TUTORIAL_ROSTER_A_IDS, TUTORIAL_ROSTER_B_IDS } from '../game/tutorialData.js';
import CourtBoard from './game/CourtBoard.jsx';
import GameLog from './game/GameLog.jsx';
import GameOver from './game/GameOver.jsx';
import Scoreboard from './game/Scoreboard.jsx';
import TutorialOverlay from './game/TutorialOverlay.jsx';
import styles from './PlayTab.module.css';

function gameReducer(state, action) {
  if (!state && action.type !== 'SET') return state;
  switch (action.type) {
    case 'SET':         return action.game;
    case 'ROLL':        return doRoll(state, action.teamKey, action.idx);
    case 'END_SECTION': return endSection(state);
    case 'EXEC_CARD': {
      const { game, ok, msg } = execCard(state, action.teamKey, action.cardId, action.opts || {});
      if (!ok) { console.warn('[Tutorial] execCard failed:', msg); return state; }
      return game;
    }
    case 'SPEND_ASSIST': {
      const { game, ok, msg } = spendAssist(state, action.teamKey, action.spendType, action.playerIdx);
      if (!ok) { console.warn('[Tutorial] spendAssist failed:', msg); return state; }
      return game;
    }
    case 'SPEND_REBOUND': {
      const { game, ok, msg } = spendReboundBonus(state, action.teamKey, action.rebType, action.playerIdx);
      if (!ok) return state;
      return game;
    }
    case 'RESOLVE_CHECK': return resolvePendingShotCheck(state);
    case 'UPDATE':      return action.game;
    default:            return state;
  }
}

const AI_TEAM = 'B'; // AI always plays Team B
const PLAYER_TEAM = 'A';
const AI_DELAY = 800; // ms delay for AI actions to feel natural

export default function TutorialGame({ onExit }) {
  const [game, dispatch] = useReducer(gameReducer, null);
  const [tutorialActive, setTutorialActive] = useState(true);
  const aiRunning = useRef(false);

  // Initialize tutorial game
  useEffect(() => {
    const rosterA = TUTORIAL_ROSTER_A_IDS.map(id => CARD_MAP[id]).filter(Boolean);
    const rosterB = TUTORIAL_ROSTER_B_IDS.map(id => CARD_MAP[id]).filter(Boolean);

    if (rosterA.length < 10 || rosterB.length < 10) {
      console.error('[Tutorial] Invalid roster IDs — some players not found in CARD_MAP');
      // Fallback: use first 10 from CARD_MAP
      const allCards = Object.values(CARD_MAP);
      const fallbackA = rosterA.length >= 10 ? rosterA : allCards.slice(0, 10);
      const fallbackB = rosterB.length >= 10 ? rosterB : allCards.slice(10, 20);
      dispatch({ type: 'SET', game: newGame(fallbackA, fallbackB) });
    } else {
      dispatch({ type: 'SET', game: newGame(rosterA, rosterB) });
    }
  }, []);

  // AI auto-play logic
  useEffect(() => {
    if (!game || game.done || aiRunning.current) return;

    const phase = game.phase;
    const isAiDraftTurn = phase === 'draft' && (() => {
      const SNAKE = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1];
      const step = game.draft.step;
      return step < 10 && SNAKE[step] === 1; // 1 = Team B
    })();

    const isAiMatchupTurn = phase === 'matchup_strats' && game.matchupTurn === AI_TEAM;
    const isAiScoringTurn = phase === 'scoring' && game.scoringTurn === AI_TEAM && game.scoringPasses < 99;
    const isRollingOpen = phase === 'scoring' && game.scoringPasses >= 99;

    // AI draft pick
    if (isAiDraftTurn) {
      aiRunning.current = true;
      const timer = setTimeout(() => {
        const action = aiTurn(game, AI_TEAM);
        if (action?.type === 'draft_pick') {
          // Execute draft pick for AI
          const g = JSON.parse(JSON.stringify(game));
          const pool = g.draft.bPool;
          const pIdx = pool.findIndex(p => p.id === action.playerId);
          if (pIdx >= 0) {
            g.teamB.starters.push(pool[pIdx]);
            g.draft.bPool = pool.filter((_, i) => i !== pIdx);
            g.draft.step++;
            dispatch({ type: 'UPDATE', game: g });
          }
        }
        aiRunning.current = false;
      }, AI_DELAY);
      return () => clearTimeout(timer);
    }

    // AI matchup decisions
    if (isAiMatchupTurn) {
      aiRunning.current = true;
      const timer = setTimeout(() => {
        // Try to play a matchup card
        const cardAction = aiTurn(game, AI_TEAM);
        if (cardAction?.type === 'play_card') {
          dispatch({ type: 'EXEC_CARD', teamKey: AI_TEAM, cardId: cardAction.cardId, opts: cardAction.opts });
        } else {
          // Pass
          const g = JSON.parse(JSON.stringify(game));
          g.matchupPasses++;
          if (g.matchupPasses >= 2) {
            g.phase = 'scoring';
            g.rollResults = { A: [], B: [] };
            g.log = [...g.log, { team: null, msg: 'Both passed — Scoring Phase!' }];
          } else {
            g.matchupTurn = g.matchupTurn === 'A' ? 'B' : 'A';
            g.log = [...g.log, { team: AI_TEAM, msg: 'AI passed.' }];
          }
          dispatch({ type: 'UPDATE', game: g });
        }
        aiRunning.current = false;
      }, AI_DELAY);
      return () => clearTimeout(timer);
    }

    // AI scoring card turn
    if (isAiScoringTurn) {
      aiRunning.current = true;
      const timer = setTimeout(() => {
        const cardAction = aiTurn(game, AI_TEAM);
        if (cardAction?.type === 'play_card') {
          dispatch({ type: 'EXEC_CARD', teamKey: AI_TEAM, cardId: cardAction.cardId, opts: cardAction.opts });
        } else {
          // Pass
          const g = JSON.parse(JSON.stringify(game));
          g.scoringPasses++;
          if (g.scoringPasses >= 2) {
            g.scoringPasses = 99;
            g.log = [...g.log, { team: null, msg: 'Both passed — rolling begins!' }];
          } else {
            g.scoringTurn = g.scoringTurn === 'A' ? 'B' : 'A';
            g.log = [...g.log, { team: AI_TEAM, msg: 'AI passed scoring turn.' }];
          }
          dispatch({ type: 'UPDATE', game: g });
        }
        aiRunning.current = false;
      }, AI_DELAY);
      return () => clearTimeout(timer);
    }

    // AI rolls during open rolling
    if (isRollingOpen) {
      const aiRolls = game.rollResults[AI_TEAM] || [];
      const aiBlocked = game.blockedRolls?.[AI_TEAM] || {};
      const hasUnrolled = [0,1,2,3,4].some(i => aiRolls[i] == null && !aiBlocked[i]);

      if (hasUnrolled) {
        aiRunning.current = true;
        const timer = setTimeout(() => {
          const action = aiRollDecision(game, AI_TEAM);
          if (action?.type === 'roll') {
            dispatch({ type: 'ROLL', teamKey: AI_TEAM, idx: action.playerIdx });
          }
          aiRunning.current = false;
        }, AI_DELAY);
        return () => clearTimeout(timer);
      }
    }
  }, [game]);

  // End tutorial after Q1 (3 sections)
  const tutorialDone = game && (game.quarter > 1 || game.done);

  const handlers = {
    setGame:       (g) => dispatch({ type: 'UPDATE', game: g }),
    onRoll:        (teamKey, idx) => dispatch({ type: 'ROLL', teamKey, idx }),
    onEndSection:  () => dispatch({ type: 'END_SECTION' }),
    onExecCard:    (teamKey, cardId, opts) => dispatch({ type: 'EXEC_CARD', teamKey, cardId, opts }),
    onResolve:     () => dispatch({ type: 'RESOLVE_CHECK' }),
    onSpendAssist: (teamKey, spendType, playerIdx) => dispatch({ type: 'SPEND_ASSIST', teamKey, spendType, playerIdx }),
    onSpendRebound:(teamKey, rebType, playerIdx) => dispatch({ type: 'SPEND_REBOUND', teamKey, rebType, playerIdx }),
  };

  if (!game) return <div style={{ color: '#F1F5F9', padding: 32 }}>Loading tutorial...</div>;

  if (tutorialDone) {
    return (
      <div style={{ maxWidth: 600, margin: '40px auto', textAlign: 'center', color: '#F1F5F9' }}>
        <h2>Tutorial Complete!</h2>
        <p style={{ color: '#94A3B8', marginBottom: 24 }}>
          You've played through a full quarter of NBA Showdown. You now understand
          drafting, matchups, scoring, strategy cards, and fatigue management.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button onClick={onExit} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            Back to How to Play
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Tutorial header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(234,88,12,0.1)', border: '1px solid rgba(234,88,12,0.2)', borderRadius: 8, marginBottom: 8 }}>
        <span style={{ color: '#F59E0B', fontWeight: 700, fontSize: 13 }}>
          Tutorial — Q{game.quarter} Section {game.section}/3
        </span>
        <button onClick={onExit} style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 12, cursor: 'pointer' }}>
          Exit Tutorial
        </button>
      </div>

      <Scoreboard game={game} />
      <GameLog log={game.log} />
      <CourtBoard game={game} {...handlers} />

      {/* Tutorial overlay */}
      {tutorialActive && (
        <TutorialOverlay
          game={game}
          tooltips={TUTORIAL_TOOLTIPS}
          onDismiss={(id) => console.log('[Tutorial] Dismissed:', id)}
          onSkip={() => setTutorialActive(false)}
        />
      )}
    </div>
  );
}
```

**Step 2: Wire up in App.jsx**

Add import and render:

```javascript
import TutorialGame from './components/TutorialGame.jsx';

// In AppInner, add state:
const [tutorialMode, setTutorialMode] = useState(false);

// In render, add before the PlayTab render:
{tutorialMode && (
  <div style={{ display: tab === 'play' || tutorialMode ? 'block' : 'none' }}>
    <TutorialGame onExit={() => { setTutorialMode(false); setTab('howtoplay'); }} />
  </div>
)}
```

Update HowToPlay render to pass the handler:

```javascript
{tab === 'howtoplay' && (
  <HowToPlay
    scrollToSection={null}
    onStartTutorial={() => { setTutorialMode(true); setTab('play'); }}
  />
)}
```

**Step 3: Commit**

```bash
git add src/components/TutorialGame.jsx src/App.jsx
git commit -m "feat: add tutorial game with AI opponent and guided tooltips"
```

---

### Task 6: Contextual "?" Help Buttons

**Files:**
- Modify: `src/components/game/CourtBoard.jsx` — add ? button to PhaseBar
- Modify: `src/components/game/Scoreboard.jsx` — add ? button
- Modify: `src/components/game/CourtBoard.module.css` — add ? button styles
- Modify: `src/App.jsx` — handle deep-link navigation from ? buttons

**Step 1: Add a shared help button component**

Add to the top of `CourtBoard.jsx`:

```javascript
function HelpBtn({ section, className }) {
  // Dispatch a custom event that App.jsx listens for
  const handleClick = (e) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('showdown-help', { detail: { section } }));
  };
  return (
    <button className={className || styles.helpBtn} onClick={handleClick} title="How to Play">?</button>
  );
}
```

**Step 2: Add ? buttons to PhaseBar**

In the PhaseBar component, add after the phase label:

```jsx
<HelpBtn section={phase === 'draft' ? 'draft' : phase === 'matchup_strats' ? 'matchup' : 'scoring'} />
```

**Step 3: Add ? button to HandPanel header**

After the hand title, add:

```jsx
<HelpBtn section="cards" />
```

**Step 4: Add CSS for help button**

```css
.helpBtn {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.2);
  color: #94A3B8;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 6px;
  flex-shrink: 0;
}
.helpBtn:hover { background: rgba(255,255,255,0.15); color: #F1F5F9; }
```

**Step 5: Listen for help events in App.jsx**

```javascript
const [helpSection, setHelpSection] = useState(null);

useEffect(() => {
  const handler = (e) => {
    setHelpSection(e.detail.section);
    setTab('howtoplay');
  };
  window.addEventListener('showdown-help', handler);
  return () => window.removeEventListener('showdown-help', handler);
}, []);

// Pass to HowToPlay:
{tab === 'howtoplay' && (
  <HowToPlay
    scrollToSection={helpSection}
    onStartTutorial={() => { setTutorialMode(true); setTab('play'); }}
  />
)}
```

**Step 6: Commit**

```bash
git add src/components/game/CourtBoard.jsx src/components/game/CourtBoard.module.css src/components/game/Scoreboard.jsx src/App.jsx
git commit -m "feat: add contextual ? help buttons that deep-link to How to Play sections"
```

---

### Task 7: Validate Tutorial Roster IDs

**Files:**
- Modify: `src/game/tutorialData.js` — verify and fix roster IDs against CARD_MAP

**Step 1: Check that all tutorial roster IDs exist in CARD_MAP**

Run: search `rawCards.js` for the player IDs used in `tutorialData.js`. Fix any mismatched IDs (the underscore format vs actual CARD_MAP keys).

Common ID format in rawCards.js is usually `first_last` (lowercase, underscore). Verify:
- `jayson_tatum`, `anthony_edwards`, `bam_adebayo`, `tyrese_haliburton`, `mikal_bridges`
- `jalen_brunson`, `evan_mobley`, `desmond_bane`, `herb_jones`, `ayo_dosunmu`
- `luka_doncic`, `shai_gilgeous_alexander`, `giannis_antetokounmpo`, `damian_lillard`, `scottie_barnes`
- `darius_garland`, `jaren_jackson_jr`, `tyler_herro`, `jose_alvarado`, `tari_eason`

Update any IDs that don't match. The tutorial will still work with fallback rosters if IDs are wrong, but correct IDs give the designed experience.

**Step 2: Commit if changes needed**

```bash
git add src/game/tutorialData.js
git commit -m "fix: correct tutorial roster IDs to match CARD_MAP"
```

---

### Task 8: Integration Testing

**Step 1: Start dev server**

Run: `cd /c/Users/hoops/OneDrive/Documents/showdown-app/showdown-app && npm run dev`

**Step 2: Verify How to Play tab**

1. Click "How to Play" tab
2. Verify accordion sections expand/collapse
3. Verify "Play Tutorial" button is visible

**Step 3: Verify Tutorial flow**

1. Click "Play Tutorial"
2. Verify game initializes with pre-set rosters
3. Verify AI makes draft picks on its turns
4. Verify tutorial tooltips appear with "Got it" dismiss
5. Verify AI plays through matchup and scoring phases
6. Verify AI rolls its players during open rolling
7. Verify tutorial ends after Q1 (3 sections)

**Step 4: Verify ? buttons**

1. Start a regular solo game
2. Click ? on PhaseBar → navigates to How to Play, scrolls to correct section
3. Click ? on HandPanel → navigates to Strategy Cards section

**Step 5: Fix any issues found**

**Step 6: Final commit**

```bash
git add -A
git commit -m "fix: integration fixes for tutorial mode"
```

---

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/game/ai.js` | Create | AI decision engine |
| `src/game/tutorialData.js` | Create | Tutorial tooltips and pre-set rosters |
| `src/components/HowToPlay.jsx` | Create | How to Play page with accordion |
| `src/components/HowToPlay.module.css` | Create | How to Play styles |
| `src/components/TutorialGame.jsx` | Create | Tutorial game wrapper with AI + overlays |
| `src/components/game/TutorialOverlay.jsx` | Create | Tooltip overlay component |
| `src/components/game/TutorialOverlay.module.css` | Create | Tooltip overlay styles |
| `src/App.jsx` | Modify | Add How to Play tab, tutorial mode, ? event listener |
| `src/components/game/CourtBoard.jsx` | Modify | Add HelpBtn component and ? buttons |
| `src/components/game/CourtBoard.module.css` | Modify | Add .helpBtn styles |
| `src/components/game/Scoreboard.jsx` | Modify | Add ? button |
