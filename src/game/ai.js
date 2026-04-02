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
      if (!def) continue;
      // Score = how well this defender matches up (higher = better defense)
      const spdDiff = def.speed + (def.defBoost || 0) - opp.speed;
      const pwrDiff = def.power + (def.defBoost || 0) - opp.power;
      const score = spdDiff + pwrDiff + (def.defBoost || 0) * 2;
      if (score > bestScore) {
        bestScore = score;
        bestDef = defIdx;
      }
    }

    if (bestDef !== null) {
      matchups[oppIdx] = bestDef;
      available.delete(bestDef);
    }
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
export function aiBuildCardOpts(game, teamKey, cardId) {
  const myT = getTeam(game, teamKey);
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const oppT = getOpp(game, teamKey);
  const starters = myT.starters || [];
  const rolls = game.rollResults[teamKey] || [];

  if (!starters.length) return {};

  switch (cardId) {
    case 'high_screen_roll': {
      // Swap the two players with worst matchups
      const advs = starters.map((p, i) => {
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        const adv = dp ? calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i) : { rollBonus: 0 };
        return { idx: i, bonus: adv.rollBonus };
      }).sort((a, b) => a.bonus - b.bonus);
      return { playerIdx: advs[0].idx, player2Idx: advs.length > 1 ? advs[1].idx : 0 };
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
      for (let oi = 0; oi < (oppT.starters || []).length; oi++) {
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

  const candidates = (myT.starters || []).map((p, i) => {
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
