// NBA Showdown 2K25 — Card playability rules
// Returns { canPlay: bool, reason: string }

import { getTeam, getOpp, getPS, getFatigue, calcAdv } from './engine.js';

const ok = (r = '') => ({ canPlay: true, reason: r });
const no = (r) => ({ canPlay: false, reason: r });

export function canPlayCard(g, teamKey, cardId) {
  const myT = getTeam(g, teamKey);
  const oppT = getOpp(g, teamKey);
  const phase = g.phase;

  if (phase === 'draft') return no('Cannot play cards during draft');

  // While a shot check is pending, only Close Out is allowed
  if (g.pendingShotCheck && cardId !== 'close_out') return no('Resolve pending shot check first');

  // ── MATCHUP PHASE ──────────────────────────────────────────────────────
  if (['high_screen_roll','stagger_action','second_wind','chip_on_shoulder','defensive_stopper'].includes(cardId)) {
    if (phase !== 'matchup_strats') return no('Only playable during Matchup Strategy Phase');
    if (g.matchupTurn !== teamKey) return no("It's not your turn");

    if (cardId === 'high_screen_roll') return ok('Swap which defenders guard your players');

    if (cardId === 'stagger_action') {
      const has13 = myT.starters.some(p => p.speed >= 13);
      const has3pt = myT.starters.some(p => (p.threePtBoost || 0) > 0);
      if (!has13) return no('Need a player with Speed 13+ in lineup');
      if (!has3pt) return no('Need a player with a 3PT Bonus in lineup');
      return ok();
    }

    if (cardId === 'second_wind') {
      if (g.quarter === 1 && g.section === 1) return no('No one can be fatigued in the first segment');
      const fatigued = myT.starters.some((_, i) => getFatigue(g, teamKey, i) < 0);
      if (!fatigued) return no('No fatigued players in lineup (need 8+ min played)');
      return ok();
    }

    if (cardId === 'chip_on_shoulder') {
      const cheap = myT.starters.some(p => p.salary <= 250);
      if (!cheap) return no('Need a player with salary ≤$250 in lineup');
      return ok();
    }

    if (cardId === 'defensive_stopper') {
      if (g.quarter === 1 && g.section === 1) return no('Cannot play in the first segment — no one has sat out yet');
      // Must target a player currently in starters who was BENCHED last segment
      const hasBenchedStarter = myT.starters.some(p => {
        const ps = getPS(g, teamKey, p.id);
        // If they played last segment their minutes would be > 0 from prior sections
        // A player who sat out last segment had their minutes reduced by 8 in clearBenchedMarkers
        // Simple check: they must be in prevBenched tracking or have low minutes relative to sections played
        return (ps?.wasBenched);
      });
      // Fallback: just check if any starter has 0 minutes (meaning they sat last section)
      const hasFreshStarter = myT.starters.some(p => {
        const ps = getPS(g, teamKey, p.id);
        return (ps?.minutes || 0) === 0 && !(g.quarter === 1 && g.section === 1);
      });
      if (!hasFreshStarter) return no('Need a starter who was benched last segment (0 minutes)');
      return ok();
    }
  }

  // ── REACTION CARDS ─────────────────────────────────────────────────────
  if (['go_under','fight_over','veer_switch'].includes(cardId)) {
    if (phase !== 'matchup_strats') return no('Only playable during Matchup Strategy Phase');
    if (!g.lastMatchupCard) return no('No switch card to react to');
    if (g.lastMatchupCard.teamKey === teamKey) return no('Cannot react to your own switch card');
    return ok('Cancel opponent\'s screen card');
  }

  if (cardId === 'close_out') {
    if (!g.pendingShotCheck) return no('Wait for opponent to announce a 3PT Shot Check');
    if (g.pendingShotCheck.teamKey === teamKey) return no('Can only close out opponent\'s shot checks');
    if (g.pendingShotCheck.type === 'ft') return no('Cannot close out a free throw');
    return ok('Reduce this shot check by −3 (miss = cold marker)');
  }

  if (cardId === 'cold_spell') {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');
    const oppRolls = Object.values(g.rollResults[teamKey === 'A' ? 'B' : 'A'] || {});
    const hasNat12 = oppRolls.some(r => r && (r.die === 1 || r.die === 2) && !r.coldSpellUsed);
    if (!hasNat12) return no('Wait for opponent to roll a natural 1 or 2 on their scoring roll');
    return ok('React to opponent\'s natural 1 or 2 scoring roll');
  }

  if (cardId === 'anticipate_pass') {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');
    if (oppT.assists < 6) return no(`Opponent needs 6+ assists (has ${oppT.assists})`);
    if (myT.assists < 1) return no('Need at least 1 assist to spend');
    return ok();
  }

  // Overhelp: only after opponent plays a defensive switching card (lastMatchupCard set by opponent)
  if (cardId === 'overhelp') {
    if (phase !== 'matchup_strats' && phase !== 'scoring') return no('Only playable during Matchup or Scoring Phase');
    if (!g.lastMatchupCard) return no('Opponent must play a switch card first (e.g. High Screen & Roll)');
    if (g.lastMatchupCard.teamKey === teamKey) return no('Cannot react to your own switch card');
    return ok('Opponent played a switch card — pick a player for +2 roll');
  }

  // Burned on the Switch: only after opponent forces a matchup switch (lastMatchupCard set by opponent)
  if (cardId === 'burned_switch') {
    if (phase !== 'matchup_strats' && phase !== 'scoring') return no('Only playable during Matchup or Scoring Phase');
    if (!g.lastMatchupCard) return no('Opponent must force a matchup switch first');
    if (g.lastMatchupCard.teamKey === teamKey) return no('Cannot react to your own switch card');
    return ok('Opponent forced a switch — check if new defender is weaker');
  }

  if (cardId === 'offensive_foul') {
    if (phase !== 'scoring' && phase !== 'matchup_strats') return no('Only playable during Matchup or Scoring Phase');
    // Must be played in reaction to an opponent's card that boosts Power
    const oppKey = teamKey === 'A' ? 'B' : 'A';
    const oppEff = g.tempEff[oppKey] || {};
    const hasPowerBoost = Object.keys(oppEff).some(k => k.startsWith('p') && oppEff[k] > 0);
    if (!hasPowerBoost) return no('Opponent must have played a card that boosts Power first');
    return ok('Halve opponent\'s Power boost, −1 Rebound');
  }

  if (cardId === 'dogged') {
    if (phase !== 'scoring' && phase !== 'matchup_strats') return no('Only playable during Matchup or Scoring Phase');
    const oppKey = teamKey === 'A' ? 'B' : 'A';
    const hasFatigued = oppT.starters.some((_, i) => getFatigue(g, oppKey, i) < 0);
    if (!hasFatigued) return no('No fatigued opponent players in lineup');
    return ok('Target a fatigued opponent for additional −2 Spd/Pwr');
  }

  if (cardId === 'coaches_challenge') {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');
    const used = g.challengesUsed?.[teamKey] || 0;
    if (used >= 2) return no("Already used 2 Coach's Challenges this game");
    if (!g.lastShotCheck) return no('No recent shot check to challenge');
    if (g.lastShotCheck.teamKey === teamKey) return no("Can only challenge opponent's shot checks");
    return ok("Re-roll opponent's last shot check");
  }

  if (cardId === 'delayed_slip') {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');
    const eligible = myT.starters.some((p, i) => {
      if ((p.speed || 0) < 12 || (p.power || 0) < 10) return false;
      const di = (g.offMatchups[teamKey] || [])[i] ?? i;
      const dp = oppT.starters[di];
      if (!dp) return false;
      const a = calcAdv(p, dp, g.tempEff[teamKey], i);
      return a.rollBonus <= 0 && !a.hasPenalty;
    });
    if (!eligible) return no('Need a Speed 12+/Power 10+ player with no matchup advantage');
    return ok();
  }

  if (cardId === 'offensive_board') {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');
    if (myT.rebounds < 3) return no(`Need 3 rebounds (have ${myT.rebounds})`);
    return ok();
  }

  if (cardId === 'rebound_tap_out') {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');
    if (myT.rebounds < 2) return no(`Need 2 rebounds (have ${myT.rebounds})`);
    if (!myT.starters.some(p => (p.threePtBoost || 0) > 0)) return no('Need a player with a 3PT Bonus in lineup');
    return ok();
  }

  // ── PRE-ROLL ───────────────────────────────────────────────────────────
  if (['ghost_screen','you_stand_over_there','putback_dunk','pin_down_screen','turnover'].includes(cardId)) {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');

    if (cardId === 'ghost_screen') {
      // Can't play on players who already rolled
      const rolls = g.rollResults[teamKey] || [];
      const hasPenalty = myT.starters.some((p, i) => {
        if (rolls[i] != null) return false; // already rolled
        const defIdx = (g.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[defIdx];
        if (!dp) return false;
        const adv = calcAdv(p, dp, g.tempEff[teamKey], i);
        return adv.hasPenalty && p.speed >= 12;
      });
      if (!hasPenalty) return no('Need a Speed 12+ player with a roll penalty who hasn\'t rolled yet');
      return ok();
    }

    if (cardId === 'putback_dunk') {
      if (myT.rebounds <= oppT.rebounds) return no('Your team must lead in rebounds');
      if (!myT.starters.some(p => p.power >= 14)) return no('Need a player with Power 14+ in lineup');
      return ok();
    }

    if (cardId === 'turnover') {
      const hasOppCold = oppT.starters.some(p => { const ps = getPS(g, teamKey === 'A' ? 'B' : 'A', p.id); return (ps?.cold || 0) > 0; });
      if (!hasOppCold) return no('Opponent needs a player with a cold marker');
      return ok();
    }

    return ok();
  }

  // ── POST-ROLL ──────────────────────────────────────────────────────────
  if (cardId === 'heat_check') {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');
    const anyHitTop = (g.rollResults[teamKey] || []).some(r => r?.isTop);
    if (!anyHitTop) return no('A player must have hit their highest chart tier this segment');
    return ok();
  }

  if (cardId === 'burst_of_momentum') {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');
    const ok2 = (g.rollResults[teamKey] || []).some(r => r?.isTop && (r?.pts || 0) >= 5);
    if (!ok2) return no('Need a player who hit top tier AND scored 5+ pts');
    return ok();
  }

  if (cardId === 'flare_screen') {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');
    if (!(g.rollResults[teamKey] || []).some(r => r?.die === 20)) return no('A player must have rolled a natural 20');
    return ok();
  }

  // ── SCORING PHASE ──────────────────────────────────────────────────────
  if (phase !== 'scoring') return no('Only playable during Scoring Phase');

  switch (cardId) {
    case 'green_light': return ok();
    case 'from_way_downtown': return ok();
    case 'catch_and_shoot':
      if (!myT.starters.some(p => p.speed >= 12)) return no('Need a player with Speed 12+ in lineup');
      return ok();
    case 'elevator_doors':
      if (!myT.starters.some(p => (p.threePtBoost || 0) > 0)) return no('Need a player with a 3PT Bonus in lineup');
      return ok();
    case 'bully_ball': {
      const hasAdv = myT.starters.some((p, i) => {
        const defIdx = (g.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[defIdx];
        return dp && calcAdv(p, dp, g.tempEff[teamKey], i).powerAdv > 0;
      });
      if (!hasAdv) return no('Need a player with a Power advantage in their matchup');
      return ok();
    }
    case 'power_move': return ok('Give a player +2 Power (or +3 if Power advantage ≥5)');
    case 'and_one': {
      const hasAdv3 = myT.starters.some((p, i) => {
        const defIdx = (g.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[defIdx];
        if (!dp) return false;
        const adv = calcAdv(p, dp, g.tempEff[teamKey], i);
        return Math.max(adv.speedAdv, adv.powerAdv) >= 3;
      });
      if (!hasAdv3) return no('Need a player with Speed or Power advantage ≥3');
      return ok();
    }
    case 'rimshaker': {
      const hasHot = myT.starters.some(p => { const ps = getPS(g, teamKey, p.id) || {}; return p.power >= 13 && (ps.hot || 0) > 0; });
      if (!hasHot) return no('Need a Power 13+ player with a hot marker');
      return ok();
    }
    case 'drive_the_lane': {
      const hasSpdAdv = myT.starters.some((p, i) => {
        const defIdx = (g.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[defIdx];
        return dp && calcAdv(p, dp, g.tempEff[teamKey], i).speedAdv > 0;
      });
      if (!hasSpdAdv) return no('Need a player with a Speed advantage in their matchup');
      return ok();
    }
    case 'uncontested_layup': {
      const hasDouble = myT.starters.some((p, i) => {
        const defIdx = (g.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[defIdx];
        if (!dp) return false;
        const adv = calcAdv(p, dp, g.tempEff[teamKey], i);
        return adv.speedAdv >= 2 && adv.powerAdv >= 2;
      });
      if (!hasDouble) return no('Need a player with +2 Speed AND +2 Power advantage');
      return ok();
    }
    case 'back_to_basket':
      if (!myT.starters.some(p => p.power >= 13 && (p.paintBoost || 0) > 0)) return no('Need Power 13+ player with a Paint Bonus');
      return ok();
    case 'cross_court_dime':
      if (myT.assists < 3) return no(`Need 3 assists (have ${myT.assists})`);
      return ok();
    case 'energy_injection': {
      const cheap = myT.starters.filter(p => p.salary < 400);
      if (cheap.length < 2) return no(`Need 2 players with salary <$400 (have ${cheap.length})`);
      return ok();
    }
    case 'crowd_favorite':
      if (!myT.starters.some(p => p.salary <= 350)) return no('Need a player with salary ≤$350 in lineup');
      return ok();
    case 'switch_everything': return ok('Reassign your entire defense — all opponent advantages doubled');
    case 'this_is_my_house': return ok('Play if your defender has higher Speed AND Power than their matchup');
    default: return ok();
  }
}
