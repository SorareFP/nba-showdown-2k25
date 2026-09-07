// NBA Showdown 2026 — Card playability rules
// Returns { canPlay: bool, reason: string }

import { getTeam, getOpp, getPS, getFatigue, calcAdv, burnedSlots } from './engine.js';

const ok = (r = '') => ({ canPlay: true, reason: r });
const no = (r) => ({ canPlay: false, reason: r });

/**
 * THIS IS MY HOUSE — the opponents who can actually be shut out.
 *
 * The rule has two halves and the picker used to know only one: it listed
 * every opponent who had not rolled yet, the player chose one, and the engine
 * then refused the choice with a pop-up because the defender guarding that
 * slot was not faster AND stronger. So the second half lives here, once, and
 * both the playability check and the picker read it: a card with nothing on
 * this list is greyed in the hand, and a card with something on it offers
 * exactly this list.
 *
 * `offMatchups[oppKey][slot]` is the index of MY starter guarding the
 * opponent's attacker at `slot` — the engine's convention, mirrored from
 * execCard so the two can never disagree about who is eligible. No fallback
 * when the guard is unassigned, because execCard has none either.
 */
/**
 * FROM WAY DOWNTOWN — who can still take the shot.
 *
 * A 3PT check is not a scoring roll, so a player whose roll was SKIPPED by
 * their own card (You Stand Over There records the roll as replaced) can still
 * take it — the user's rule, 2026-09-05. A roll BLOCKED by the other side's
 * This Is My House is different: that card exists to shut the player out, and
 * a +1 three through the back door would undercut it, so a blocked player stays
 * out. Same predicate Green Light already uses; the picker used to demand
 * "not rolled at all" and hid the replaced player.
 */
export function fwdTargets(g, teamKey) {
  const rolls = g.rollResults?.[teamKey] || [];
  const blocked = g.blockedRolls?.[teamKey] || {};
  return (getTeam(g, teamKey)?.starters || [])
    .map((p, idx) => ({ p, idx }))
    .filter(({ p, idx }) => p && !blocked[idx] && (rolls[idx] == null || rolls[idx]?.isReplaced));
}

/**
 * The players a PRE-ROLL card can still be played on: not rolled, not blocked,
 * and whatever the card itself asks for (`cond`).
 *
 * Five cards share this — Elevator Doors, Cross-Court Dime, Pin-Down Screen,
 * Power Move, You Stand Over There — and every one of them used to be checked
 * for its own condition but not for a roll still to come, so the card lit
 * with every roll in and the picker then found nobody. Elevator Doors was the
 * one the user hit: a 3PT shooter on the floor, all rolls in, "no one is
 * eligible." Playability and the picker now read this list.
 */
export function preRollTargets(g, teamKey, cond = () => true) {
  const rolls = g.rollResults?.[teamKey] || [];
  const blocked = g.blockedRolls?.[teamKey] || {};
  return (getTeam(g, teamKey)?.starters || [])
    .map((p, idx) => ({ p, idx }))
    .filter(({ p, idx }) => p && rolls[idx] == null && !blocked[idx] && cond(p, idx));
}

export function myHouseTargets(g, teamKey) {
  const myT = getTeam(g, teamKey);
  const oppT = getOpp(g, teamKey);
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const oppRolls = g.rollResults?.[oppKey] || [];
  const guards = g.offMatchups?.[oppKey] || [];
  const out = [];
  (oppT?.starters || []).forEach((off, offSlot) => {
    if (!off || oppRolls[offSlot] != null) return;
    const def = myT?.starters?.[guards[offSlot]];
    if (!def) return;
    if (def.speed > off.speed && def.power > off.power) out.push({ offSlot, off, def });
  });
  return out;
}

// The cards that answer an ANNOUNCED shot check (g.pendingShotCheck). One
// answer per check: the first reaction marks it `reacted`.
export const SHOT_REACTIONS = ['close_out', 'rim_protector', 'drop_coverage', 'smothering_defense', 'denial', 'hustle_play'];

function shotReaction(g, teamKey, cardId) {
  const psc = g.pendingShotCheck;
  if (!psc) return no('Wait for the opponent to announce a shot check');
  if (psc.teamKey === teamKey) return no('Can only answer the opponent\'s shot checks');
  if (psc.type === 'ft') return no('A free throw cannot be contested');
  if (psc.reacted) return no('This shot check has already been answered');
  const myT = getTeam(g, teamKey);
  const oppT = getOpp(g, teamKey);
  const shooter = oppT.starters[psc.playerIdx];
  const guard = myT.starters[(g.offMatchups[psc.teamKey] || [])[psc.playerIdx]];
  switch (cardId) {
    case 'rim_protector':
      if (psc.type !== 'paint') return no('Rim Protector answers a Paint check');
      if (!guard || (guard.power || 0) + (guard.defBoost || 0) < 15) return no('Your defender on the shooter needs Power + Defensive Bonus of 15');
      return ok('−4 to the check; a miss is +2 REB');
    case 'drop_coverage':
      if (psc.type !== 'paint') return no('Drop Coverage answers a Paint check');
      if (!guard || (guard.defBoost || 0) <= 0) return no('Your defender on the shooter needs a Defensive Bonus');
      return ok('−2 to the check');
    case 'smothering_defense':
      if (!guard || (guard.defBoost || 0) <= 0) return no('Your defender on the shooter needs a Defensive Bonus');
      if (!(psc.bonus > 0)) return no('That check carries no card bonus to smother');
      return ok('Their card bonus −3 (min 0)');
    case 'denial':
      if (myT.hand.filter(id => id !== 'denial').length === 0) return no('No card to discard');
      return ok('They lose 2 AST, or the check is at −3');
    case 'hustle_play':
      if ((shooter?.salary || 0) <= 800) return no('The shooter must be paid above $800');
      if (!myT.starters.some(p => p && (p.salary || 0) < 400 && (p.defBoost || 0) > 0)) return no('Need a player under $400 with a Defensive Bonus');
      return ok('A cheap defender subtracts their Defensive Bonus');
    default: return no('Not a shot-check reaction');
  }
}

export function canPlayCard(g, teamKey, cardId) {
  const myT = getTeam(g, teamKey);
  const oppT = getOpp(g, teamKey);
  const phase = g.phase;

  if (phase === 'draft') return no('Cannot play cards during draft');

  // While a shot check is pending, only Close Out is allowed
  if (g.pendingShotCheck && !SHOT_REACTIONS.includes(cardId)) return no('Resolve pending shot check first');
  if (SHOT_REACTIONS.includes(cardId) && cardId !== 'close_out') return shotReaction(g, teamKey, cardId);

  // ── MATCHUP PHASE ──────────────────────────────────────────────────────
  if (['high_screen_roll','stagger_action','second_wind','chip_on_shoulder','defensive_stopper','pick_up_full_court',
    'spain_pick_roll','mismatch_hunter','strength_in_numbers','energizer','defensive_identity','defensive_anchor','swarming_defense'].includes(cardId)) {
    if (phase !== 'matchup_strats') return no('Only playable during Matchup Strategy Phase');
    if (g.matchupTurn !== teamKey) return no("It's not your turn");
    const advOf = (p, i) => {
      const dp = oppT.starters[(g.offMatchups[teamKey] || [])[i] ?? i];
      return dp ? calcAdv(p, dp, g.tempEff[teamKey] || {}, i) : null;
    };
    if (cardId === 'spain_pick_roll') {
      const some = myT.starters.some((p, i) => { const dp = oppT.starters[(g.offMatchups[teamKey] || [])[i] ?? i]; return p && dp && p.speed > dp.speed; });
      if (!some) return no('Need a player faster than their defender');
      return ok('+2 roll this period; a score adds +1 AST');
    }
    if (cardId === 'mismatch_hunter') {
      const some = myT.starters.some((p, i) => { const a = p && advOf(p, i); return a && Math.max(a.speedAdv, a.powerAdv) >= 4; });
      if (!some) return no('Need a player with a +4 Speed or Power advantage');
      return ok('+2 roll for the mismatch');
    }
    if (cardId === 'strength_in_numbers') {
      const all = myT.starters.length === 5 && myT.starters.every((p, i) => { const a = p && advOf(p, i); return a && Math.max(a.speedAdv, a.powerAdv) >= 1; });
      if (!all) return no('All five players need at least a +1 advantage');
      return ok('+3 AST');
    }
    if (cardId === 'energizer') {
      if (!myT.starters.some(p => p && (p.salary || 0) < 250)) return no('Need a player under $250');
      return ok('+3/+3 on defense for a cheap player');
    }
    if (cardId === 'defensive_identity') {
      const n = myT.starters.filter(p => (p?.defBoost || 0) > 0).length;
      if (n < 3) return no(`Need three players with a Defensive Bonus (have ${n})`);
      return ok('All five +2/+2 on defense');
    }
    if (cardId === 'defensive_anchor') {
      if (!myT.starters.some(p => (p?.defBoost || 0) >= 3)) return no('Need a defender with a Defensive Bonus of +3');
      return ok('His man gets no positive matchup bonus');
    }
    if (cardId === 'swarming_defense') return ok('Their highest-paid player may roll twice, keep lower');

    if (cardId === 'high_screen_roll') return ok('Swap which defenders guard your players');

    if (cardId === 'pick_up_full_court') return ok('Hound one opposing player: −1 roll + 4 minutes of fatigue');

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
    if (g.pendingShotCheck.type !== '3pt') return no('Close Out answers a 3PT check');
    if (g.pendingShotCheck.reacted) return no('This shot check has already been answered');
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
    const sw = g.lastDefSwitch;
    if (!sw) return no('Opponent must play a defensive switch first (Veer Switch, Switch Everything)');
    if (sw.teamKey === teamKey) return no('Cannot react to your own switch');
    return ok('Opponent switched their defence — pick a player for +3 roll');
  }

  // ── CRUNCH TIME cards ───────────────────────────────────────────────────
  if (['desperation_press', 'ato_masterpiece', 'fresh_legs', 'ice_the_hot_hand', 'reset', 'second_closer'].includes(cardId)) {
    if (!g.crunch?.active) return no('Crunch Time only — final section, close game');
    if (cardId === 'desperation_press') {
      if (myT.score >= oppT.score) return no('Only playable while trailing');
      return ok('Their next top-tier roll must be re-rolled');
    }
    if (cardId === 'second_closer') {
      if ((g.crunch.extra?.[teamKey] || 0) >= 1) return no('One Second Closer per game');
      return ok('A second Clutch Possession, for a different player');
    }
    // The four timeout riders: only during YOUR called timeout.
    if (g.timeoutActive !== teamKey) return no('Play during your Timeout');
    if (cardId === 'ice_the_hot_hand') {
      const hasHot = oppT.starters.some(p => (getPS(g, teamKey === 'A' ? 'B' : 'A', p.id)?.hot || 0) > 0);
      if (!hasHot) return no('No opposing player holds a hot marker');
      return ok('Strip all hot markers from one opposing player');
    }
    if (cardId === 'reset') {
      const hasCold = myT.starters.some(p => (getPS(g, teamKey, p.id)?.cold || 0) > 0);
      if (!hasCold) return no('None of your players holds a cold marker');
      return ok('Clear all cold markers from one of your players');
    }
    if (cardId === 'fresh_legs') {
      const tired = myT.starters.some(p => (getPS(g, teamKey, p.id)?.minutes || 0) > 0);
      if (!tired) return no('Nobody has minutes to shed');
      return ok('Up to two players shed 4 minutes of fatigue');
    }
    return ok('Out of the huddle: a chosen player shoots at +2'); // ato_masterpiece
  }

  // Double Team: two opposing players must still be waiting to roll — one to
  // trap, and at least one other to be the open man they find.
  if (cardId === 'double_team') {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');
    const dtOpp = teamKey === 'A' ? 'B' : 'A';
    const oppRolls = g.rollResults[dtOpp] || [];
    const waiting = oppT.starters.filter((p, i) => p && oppRolls[i] == null).length;
    if (waiting < 2) return no('Need two opposing players who haven\'t rolled');
    return ok('Trap one opposing player (+6/+6 defense) — opponent gets +3 on their next roll');
  }

  // Burned on the Switch: only after opponent forces a matchup switch (lastMatchupCard set by opponent)
  if (cardId === 'burned_switch') {
    if (phase !== 'matchup_strats' && phase !== 'scoring') return no('Only playable during Matchup or Scoring Phase');
    const sw = g.lastDefSwitch;
    if (!sw) return no('Opponent must force a matchup switch first (Veer Switch, Switch Everything)');
    if (sw.teamKey === teamKey) return no('Cannot react to your own switch');
    if (burnedSlots(g, sw).length === 0) return no('No defender got worse on that switch');
    return ok('A weaker defender switched on — +3 to that player');
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

    // You Stand Over There and Pin-Down Screen: someone must still have a roll
    // to come, or the picker finds nobody. See preRollTargets.
    if (preRollTargets(g, teamKey).length === 0) return no('Everyone has rolled');
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

  if (['find_the_open_man', 'putback_specialist', 'glass_cleaner', 'box_out'].includes(cardId)) {
    if (cardId === 'find_the_open_man') {
      const dt = g.lastDoubleTeam;
      if (!dt || dt.teamKey === teamKey) return no('The opponent must have a Double Team on the floor');
      const open = preRollTargets(g, teamKey, (p, i) => i !== dt.targetIdx);
      if (open.length === 0) return no('Nobody open is still to roll');
      return ok('+4 roll to a player they are not trapping');
    }
    if (cardId === 'putback_specialist') {
      const miss = g.lastCheckMiss;
      if (!miss || miss.teamKey !== teamKey || miss.claimed) return no('Your player must have just missed a shot check');
      if (myT.rebounds < 2) return no(`Need 2 rebounds (have ${myT.rebounds})`);
      return ok('−2 REB → a Paint check at +3');
    }
    if (cardId === 'glass_cleaner') {
      const miss = g.lastCheckMiss;
      if (!miss || miss.teamKey === teamKey || miss.claimed) return no('The opponent must have just missed a shot check');
      return ok('+2 REB (+1 with a Power edge on the shooter)');
    }
    const lr = g.lastRoll;
    if (!lr || lr.teamKey === teamKey || lr.boxed || !(lr.reb > 0)) return no('The opponent must have just won rebounds on a scoring roll');
    return ok(`Cancel their ${lr.reb} REB`);
  }
  switch (cardId) {
    case 'green_light': return ok();
    case 'five_out':
      if (preRollTargets(g, teamKey, p => (p.threePtBoost || 0) > 0).length === 0) return no('Every 3PT shooter has already rolled');
      return ok('Two 3PT checks at +1 instead of the roll');
    case 'hammer_set': {
      const some = myT.starters.some((p, i) => {
        if (!p || (p.threePtBoost || 0) > 0) return false;
        const dp = oppT.starters[(g.offMatchups[teamKey] || [])[i] ?? i];
        return dp && calcAdv(p, dp, g.tempEff[teamKey] || {}, i).speedAdv > 0;
      });
      if (!some) return no('Need a non-shooter with a Speed advantage');
      return ok('A 3PT check at normal difficulty; hit = +2 AST');
    }
    case 'iso_heavy':
      if (preRollTargets(g, teamKey).length === 0) return no('Everyone has rolled');
      return ok('One player +3, teammates −2');
    case 'three_point_barrage': {
      const n = myT.starters.filter(p => (p?.threePtBoost || 0) > 0).length;
      if (n < 3) return no(`Need three players with a 3PT Bonus (have ${n})`);
      return ok(`${n} 3PT checks`);
    }
    case 'crash_and_kick':
      if (myT.rebounds < 3) return no(`Need 3 rebounds (have ${myT.rebounds})`);
      if (myT.assists < 1) return no(`Need 1 assist (have ${myT.assists})`);
      return ok('A 3PT check at +2');
    case 'pick_and_pop':
      if (myT.assists < 2) return no(`Need 2 assists (have ${myT.assists})`);
      if (!myT.starters.some(p => (p?.threePtBoost || 0) > 0)) return no('Need a player with a 3PT Bonus');
      return ok('A 3PT check at +1; hit = +2 AST back');
    case 'extra_pass':
      if (myT.assists < 2) return no(`Need 2 assists (have ${myT.assists})`);
      return ok('Any player, any check, no card bonuses');
    case 'lob_city':
      if (!myT.starters.some(p => p && ((p.speed || 0) >= 15 || (p.power || 0) >= 15))) return no('Need a player with Speed or Power 15+');
      if (myT.hand.filter(id => id !== 'lob_city').length === 0) return no('No card to discard');
      return ok('Speed 15+ players add an assist, Power 15+ players score 2');
    case 'stretch_five': {
      const big = myT.starters.some(p => p && String(p.pos || '').split(/[-/]/).some(t => t === 'C' || t === 'PF') && ((p.shotLine ?? 18) - (p.threePtBoost || 0)) <= 14);
      if (!big) return no('Need a C or PF who converts threes at 14 or lower');
      return ok('His 3PT check, then a teammate\'s paint check at +2');
    }
    case 'post_domination': {
      const bigs = myT.starters.filter(p => (p?.power || 0) >= 15).length;
      if (bigs < 2) return no(`Need two players at Power 15+ (have ${bigs})`);
      return ok('Double one big man\'s rebounds this period');
    }
    case 'unsung_hero':
      if (preRollTargets(g, teamKey, p => (p.salary || 0) <= 400).length === 0) return no('Need a $400-or-less player still to roll');
      return ok('Two dice, keep the higher');
    case 'transition_outlet': {
      if (myT.rebounds < 1 || myT.assists < 1) return no('Need 1 rebound and 1 assist to spend');
      const some = myT.starters.some((p, i) => {
        const dp = oppT.starters[(g.offMatchups[teamKey] || [])[i] ?? i];
        return p && dp && calcAdv(p, dp, g.tempEff[teamKey] || {}, i).speedAdv > 0;
      });
      if (!some) return no('Need a player with a Speed advantage');
      return ok('A check at +2; hit = +1 AST');
    }
    case 'from_way_downtown':
      if (fwdTargets(g, teamKey).length === 0) return no('Nobody left to shoot — every roll is in');
      return ok();
    case 'catch_and_shoot':
      if (!myT.starters.some(p => p.speed >= 12)) return no('Need a player with Speed 12+ in lineup');
      return ok();
    case 'elevator_doors': {
      if (!myT.starters.some(p => (p.threePtBoost || 0) > 0)) return no('Need a player with a 3PT Bonus in lineup');
      if (preRollTargets(g, teamKey, p => (p.threePtBoost || 0) > 0).length === 0) {
        return no('Every 3PT shooter has already rolled');
      }
      return ok();
    }
    case 'bully_ball': {
      const hasAdv = myT.starters.some((p, i) => {
        const defIdx = (g.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[defIdx];
        return dp && calcAdv(p, dp, g.tempEff[teamKey], i).powerAdv > 0;
      });
      if (!hasAdv) return no('Need a player with a Power advantage in their matchup');
      return ok();
    }
    case 'power_move':
      if (preRollTargets(g, teamKey).length === 0) return no('Everyone has rolled');
      return ok('Give a player +2 Power (or +3 if Power advantage ≥5)');
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
      if (preRollTargets(g, teamKey).length === 0) return no('Everyone has rolled');
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
    case 'this_is_my_house': {
      const targets = myHouseTargets(g, teamKey);
      if (targets.length === 0) {
        return no('No opponent still to roll whom your defender out-speeds AND out-powers');
      }
      return ok(`${targets.length} opponent${targets.length === 1 ? '' : 's'} your defender can shut out`);
    }
    default: return ok();
  }
}
