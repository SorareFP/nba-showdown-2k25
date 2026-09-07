// src/game/ai.js
// NBA Showdown 2026 — AI Decision Engine
// Pure functions: takes game state + team key, returns an action object.
// No React, no side effects. Used by tutorial, solo mode, sim-to-end.

import { getTeam, getOpp, getPS, calcAdv, getFatigue, fatigueForMinutes, restMinutes, SPEND_COSTS, clutchAvailable, clutchEligible, burnedSlots } from './engine.js';
import { lookupChart } from './cards.js';
import { canPlayCard, helpTargets } from './canPlay.js';
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
//
// ── WHAT A LINEUP PICK IS WORTH ─────────────────────────────────────────────
//
// The old score was raw attributes with a flat fatigue deduction. A star's
// attributes run to forty-odd, so a star at −6 still beat a fresh bench player
// on paper and the AI played Kawhi through it. A −6 on a d20 is a third of the
// die; on most charts it is a whole tier.
//
// So a pick is valued by what the CHART pays at the roll the player would
// carry — fatigue and markers summed exactly as doRoll sums them, so three hot
// markers cancel a −6 here as they do there. Output alone is not enough,
// though: calibrated against real cards, a star at −6 still out-produces a
// $350 bench player THIS section. What a coach weighs is the next one too.
// Play him now and he is at −12 next section; rest him now and he is fresh —
// but resting clears his hot markers, which the engine does on the bench. So
// the score carries half of that difference. Against real cards that lands the
// cadence the minute maths was built for: a star plays at 0, 4 and (barely) 8
// minutes, rests at 12, and plays at 12 if he is carrying three hot markers.
//
// Attributes still count, at a small fraction: speed and power decide matchup
// advantage, which is a roll bonus the chart cannot see because the opponent's
// lineup is not known yet.

/** Average points a card pays over a d20 carrying `mod`; rebounds and assists at half. */
export function expectedOutput(card, mod = 0) {
  if (!Array.isArray(card?.chart) || card.chart.length === 0) return 0;
  let total = 0;
  for (let die = 1; die <= 20; die += 1) {
    const t = lookupChart(card, die + mod);
    total += (t.pts || 0) + 0.5 * (t.reb || 0) + 0.5 * (t.ast || 0);
  }
  return total / 20;
}

const SECTION_MINUTES = 4;
const HORIZON = 0.5;

/** The pick's score: this section's output, half of next section's swing, a little body. */
export function lineupValue(player, ps) {
  const min = ps?.minutes || 0;
  const markers = ps ? ((ps.hot || 0) - (ps.cold || 0)) * 2 : 0;

  const now = expectedOutput(player, fatigueForMinutes(min) + markers);
  const nextIfPlayed = expectedOutput(player, fatigueForMinutes(min + SECTION_MINUTES) + markers);
  const nextIfRested = expectedOutput(player, fatigueForMinutes(restMinutes(min))); // markers gone

  const body = 0.05 * (player.speed + player.power + (player.defBoost || 0));
  const shoot = 0.1 * ((player.threePtBoost || 0) + (player.paintBoost || 0));

  return now + HORIZON * (nextIfPlayed - nextIfRested) + body + shoot;
}

export function aiDraftPick(game, teamKey) {
  const pool = teamKey === 'A' ? game.draft.aPool : game.draft.bPool;
  if (!pool || pool.length === 0) return null;

  const scored = pool.map(player => ({
    player,
    score: lineupValue(player, getPS(game, teamKey, player.id)),
  }));
  scored.sort((a, b) => b.score - a.score);
  return { type: 'draft_pick', playerId: scored[0].player.id };
}

// ── Matchup Assignment ──────────────────────────────────────────────────────
// Assign defenders to minimize opponent's total roll bonus.
// Greedy: for each opponent starter, assign the best available defender.
/**
 * ASSIGN THE DEFENCE — every assignment scored by what it actually does.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 *
 * The old version ranked the opponent by threat and, for each, took the
 * defender with the best `speed + power + 3·defBoost`. The opponent's own
 * numbers were subtracted in the score but were the same for every candidate
 * defender, so they never changed the choice: it was a sorted pairing, best
 * remaining body onto biggest remaining threat, blind to FIT. A fast guard and
 * a slow centre with the same total were interchangeable to it. And when a
 * draft leaves both rosters in rough strength order, sorted pairing IS the
 * identity — which is why the AI looked like it never moved anyone.
 *
 * ── WHAT THIS DOES ──────────────────────────────────────────────────────────
 *
 * `calcAdv` is the engine's own verdict on one attacker against one defender:
 * the die modifier that roll will carry, temporary boosts on both sides
 * included. Five against five is 120 assignments, cheap enough to score every
 * one and keep the best — the one that gives the opponent the smallest total
 * modifier, weighted by salary so a +2 handed to their star costs more than a
 * +2 handed to their twelfth man. A penalty (negative modifier) is a gain.
 * Ties break toward the smaller worst case, so two equal totals prefer the
 * one without a blowout.
 *
 * Returns `matchups[i]` = index of MY starter guarding THEIR attacker in slot
 * i, the shape applyMatchups writes and doRoll reads.
 */
export function aiSetMatchups(game, teamKey) {
  const myT = getTeam(game, teamKey);
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const oppT = getTeam(game, oppKey);

  const attackers = oppT?.starters || [];
  const defenders = myT?.starters || [];
  const n = Math.min(attackers.length, defenders.length);
  if (n === 0) return null;

  const tempEff = game.tempEff?.[oppKey] || {};
  const tempDefEff = game.tempDefEff?.[teamKey] ?? null;
  const meanSal = attackers.reduce((t, p) => t + (p?.salary || 0), 0) / n || 1;

  // cost[a][d]: what attacker a gets against defender d, star-weighted.
  const cost = attackers.slice(0, n).map((att, a) =>
    defenders.slice(0, n).map((def, d) => {
      if (!att || !def) return 0;
      const adv = calcAdv(att, def, tempEff, a, tempDefEff, d);
      const weight = 0.5 + 0.5 * ((att.salary || meanSal) / meanSal);
      return adv.rollBonus * weight;
    })
  );

  let best = null;
  let bestTotal = Infinity;
  let bestWorst = Infinity;
  const perm = new Array(n);
  const used = new Array(n).fill(false);
  const walk = (a, total, worst) => {
    if (a === n) {
      if (total < bestTotal - 1e-9 || (Math.abs(total - bestTotal) < 1e-9 && worst < bestWorst)) {
        best = perm.slice();
        bestTotal = total;
        bestWorst = worst;
      }
      return;
    }
    for (let d = 0; d < n; d += 1) {
      if (used[d]) continue;
      used[d] = true;
      perm[a] = d;
      walk(a + 1, total + cost[a][d], Math.max(worst, cost[a][d]));
      used[d] = false;
    }
  };
  walk(0, 0, -Infinity);

  return { type: 'set_matchups', matchups: best };
}

// ── Placement: which player takes the floor next ────────────────────────────
//
// The snake places one player at a time, and the row a player lands in is the
// matchup he starts with. When the opponent has already placed someone in the
// AI's next row, counter-pick: the remaining player who defends them best, by
// the same score aiSetMatchups ranks defenders with. When the AI leads the
// row, spend threat early — the human counter-picks everything placed late.
export function aiPlacementPick(game, teamKey) {
  const myT = getTeam(game, teamKey);
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const oppT = getTeam(game, oppKey);
  const pickIds = teamKey === 'A' ? game.draft?.aPicks ?? [] : game.draft?.bPicks ?? [];
  const placed = new Set(myT.starters.map(pl => pl.id));
  const remainingIds = pickIds.filter(id => !placed.has(id));
  if (!remainingIds.length) return null;
  const roster = myT.roster || [];
  const remaining = remainingIds.map(id => roster.find(r => r.id === id)).filter(Boolean);
  if (!remaining.length) return null;

  const row = myT.starters.length;
  const oppPlayer = oppT.starters[row] || null;
  let best = remaining[0];
  let bestScore = -Infinity;
  for (const cand of remaining) {
    const score = oppPlayer
      ? (cand.speed + (cand.defBoost || 0) - oppPlayer.speed) +
        (cand.power + (cand.defBoost || 0) - oppPlayer.power) +
        (cand.defBoost || 0) * 2
      : cand.speed + cand.power + (cand.threePtBoost || 0) * 3 + (cand.paintBoost || 0) * 2;
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return { type: 'place_player', playerId: best.id };
}

// ── Conversion spends ───────────────────────────────────────────────────────
//
// The sim harness proved the value (the conversion channel is ~10% of all
// scoring) and the live AI never touched it — no spendAssist caller existed
// anywhere in this file. One decision per call, greedy: threes ahead of paint
// by the best boost in the lineup, rebound paint-checks when the section
// published one. The caller loops until null.
export function aiSpendDecision(game, teamKey) {
  const team = getTeam(game, teamKey);
  if (!team?.starters?.length) return null;
  const best = boost => {
    let bi = -1, bv = -Infinity;
    team.starters.forEach((p, i) => {
      const v = p?.[boost] ?? -99;
      if (p && v > bv) { bv = v; bi = i; }
    });
    return bi;
  };
  // spendAssist's type strings are '3pt' and 'paint', and it re-checks that
  // the chosen player actually carries the matching boost — so only nominate
  // a player whose boost is real, not merely the least-bad on the floor.
  const three = best('threePtBoost');
  if ((team.assists ?? 0) >= SPEND_COSTS.assistThree && three >= 0 && (team.starters[three]?.threePtBoost || 0) > 0) {
    return { type: 'spend_assist', spendType: '3pt', playerIdx: three };
  }
  const paint = best('paintBoost');
  const paintOk = paint >= 0 && (team.starters[paint]?.paintBoost || 0) > 0;
  if ((team.assists ?? 0) >= SPEND_COSTS.assistPaint && paintOk) {
    return { type: 'spend_assist', spendType: 'paint', playerIdx: paint };
  }
  const bonuses = game.reboundBonuses?.[teamKey];
  if ((team.rebounds ?? 0) >= SPEND_COSTS.reboundPaint && bonuses?.paintCheck) {
    // The rebound paint check has no boost requirement — any finisher works,
    // so take the best paint hand available even at +0.
    return { type: 'spend_rebound', rebType: 'paint_check', playerIdx: Math.max(paint, 0) };
  }
  return null;
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
/**
 * Would Switch Everything actually MOVE anybody? The AI sets its defence at
 * the start of every section (aiSetMatchups), so the "best" assignment the
 * card would apply is usually the one already on the floor — and the card's
 * cost, doubling every opponent advantage, is paid either way. The 600-game
 * audit had it played 400 times, nearly all for nothing. It is worth playing
 * only when the opponent's screen or a mid-section boost has left the current
 * assignment behind.
 */
export function switchEverythingChanges(game, teamKey) {
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const best = aiSetMatchups(game, teamKey)?.matchups;
  if (!best) return false;
  const now = game.offMatchups?.[oppKey] || [0, 1, 2, 3, 4];
  return best.some((d, i) => d !== now[i]);
}

function evaluateCard(game, teamKey, cardId, strat) {
  const phase = game.phase;
  if (cardId === 'switch_everything' && !switchEverythingChanges(game, teamKey)) return 0;

  // Phase gating — matchup cards only in matchup phase, etc.
  if (strat.phase === 'matchup' && phase !== 'matchup_strats') return 0;
  if (strat.phase === 'scoring' && phase !== 'scoring') return 0;
  if (strat.phase === 'pre_roll' && phase !== 'scoring') return 0;
  if (strat.phase === 'post_roll' && phase !== 'scoring') return 0;
  if (strat.phase === 'reaction') {
    // Reactions are ordinary plays on your own turn when their state
    // condition holds (canPlayCard already said yes before this runs) — the
    // old hard zero here is why the audit found the entire canceller economy
    // dead even after switch cards came alive.
    const reactionValues = {
      go_under: 7, fight_over: 6, veer_switch: 6, burned_switch: 5,
      offensive_foul: 5, cold_spell: 6, anticipate_pass: 5, overhelp: 5,
      offensive_board: 5, rebound_tap_out: 5, coaches_challenge: 6, close_out: 6,
      // Wave one (2026-09-06)
      find_the_open_man: 7, putback_specialist: 6, rim_protector: 7, drop_coverage: 5,
      smothering_defense: 5, denial: 4, hustle_play: 5, glass_cleaner: 6, box_out: 6,
      help_defender: 7,
    };
    return reactionValues[cardId] ?? 4;
  }

  // Base values by card type
  const values = {
    // Matchup phase
    high_screen_roll: 6,
    stagger_action: 7,
    second_wind: 5,
    chip_on_shoulder: 6,
    defensive_stopper: 7,
    pick_up_full_court: 5,

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
    energy_injection: 4,
    crowd_favorite: 3,
    switch_everything: 6,
    this_is_my_house: 8,
    delayed_slip: 4,
    double_team: 6,

    // Crunch Time (canPlay gates them to the window; riders to the timeout)
    desperation_press: 8,
    second_closer: 7,
    ato_masterpiece: 8,
    fresh_legs: 6,
    ice_the_hot_hand: 7,
    reset: 6,

    // Wave one (2026-09-06)
    spain_pick_roll: 6, mismatch_hunter: 6, strength_in_numbers: 8, energizer: 5,
    defensive_identity: 6, defensive_anchor: 6, swarming_defense: 5,
    five_out: 6, hammer_set: 4, iso_heavy: 5, three_point_barrage: 8, crash_and_kick: 5,
    pick_and_pop: 5, extra_pass: 4, lob_city: 8, stretch_five: 6, post_domination: 6,
    unsung_hero: 6, transition_outlet: 5,
    // Wave two (2026-09-07). Outside Pick costs a card, so it is priced under
    // the free threes; Maestro is high because a 5+ mismatch is the best paint
    // check in the game; Inside-Out is a free three off a bucket you already
    // have; Short-Roll is a slow burn that only pays if the big scores inside.
    outside_pick: 6, pick_and_roll_maestro: 8, inside_out: 7, short_roll_playmaker: 5,
    // The standing pair are worth more than one play, because they are not one
    // play — they come back every period until a big sits down.
    run_the_floor: 9, twin_towers: 9,
    // Post-roll
    heat_check: 7,
    burst_of_momentum: 6,
    flare_screen: 7,

    // Defensive scoring
    dogged: 4,
    offensive_board: 5,
    rebound_tap_out: 5,
  };

  // A called timeout exists FOR its riders: while your own window is open
  // they outrank everything else in hand, or the window closes unspent.
  if (game.timeoutActive === teamKey
    && ['ato_masterpiece', 'fresh_legs', 'ice_the_hot_hand', 'reset'].includes(cardId)) {
    return (values[cardId] || 3) + 4;
  }
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
      // THE OPTS CONTRACT IS swapSlot1/swapSlot2 — playerIdx was a drift that
      // made every AI attempt fail at execCard, which is why the audit found
      // the game's flagship switch card at zero plays and the whole
      // canceller economy dead behind it. And rather than blindly swapping
      // the two worst matchups, evaluate every pair: the swap that gains the
      // most total roll bonus is the one a coach would call.
      const bonusFor = (offIdx, defIdx) => {
        const p = starters[offIdx];
        const dp = oppT.starters[defIdx];
        return p && dp ? calcAdv(p, dp, game.tempEff?.[teamKey] || {}, offIdx).rollBonus : 0;
      };
      const mu = game.offMatchups?.[teamKey] || [0, 1, 2, 3, 4];
      let best = null;
      for (let i = 0; i < starters.length; i += 1) {
        for (let j = i + 1; j < starters.length; j += 1) {
          const now = bonusFor(i, mu[i] ?? i) + bonusFor(j, mu[j] ?? j);
          const swapped = bonusFor(i, mu[j] ?? j) + bonusFor(j, mu[i] ?? i);
          const delta = swapped - now;
          if (!best || delta > best.delta) best = { i, j, delta };
        }
      }
      if (!best || best.delta <= 0) return { swapSlot1: 0, swapSlot2: 1 };
      return { swapSlot1: best.i, swapSlot2: best.j };
    }

    case 'stagger_action': {
      // Two DIFFERENT players. The fallback used to be slot 1 — which is the
      // Speed-13 player himself whenever he sits in slot 1, and the card went
      // down as "Jamal Murray & Jamal Murray". Seen in the browser 2026-09-05.
      const spd13 = starters.findIndex(p => p.speed >= 13);
      const first = spd13 >= 0 ? spd13 : 0;
      const three = starters.findIndex((p, i) => i !== first && (p.threePtBoost || 0) > 0);
      const other = three >= 0 ? three : starters.findIndex((_, i) => i !== first);
      return { playerIdx: first, player2Idx: other >= 0 ? other : first };
    }

    case 'veer_switch': {
      // Keep the pair or trade it — the only two arrangements the card allows.
      // Trade when it lowers what the two screened attackers get, in total.
      const lc = game.lastMatchupCard;
      if (!lc?.opts) return {};
      const offT = getOpp(game, teamKey);
      const a1 = offT.starters[lc.opts.swapSlot1];
      const a2 = offT.starters[lc.opts.swapSlot2];
      const d1 = starters[lc.opts.origD1];
      const d2 = starters[lc.opts.origD2];
      if (!a1 || !a2 || !d1 || !d2) return {};
      const eff = game.tempEff?.[lc.teamKey] || {};
      const keep = calcAdv(a1, d1, eff, lc.opts.swapSlot1).rollBonus + calcAdv(a2, d2, eff, lc.opts.swapSlot2).rollBonus;
      const trade = calcAdv(a1, d2, eff, lc.opts.swapSlot1).rollBonus + calcAdv(a2, d1, eff, lc.opts.swapSlot2).rollBonus;
      return { veerSwap: trade < keep };
    }

    case 'overhelp': {
      // The +3 goes to the best attacker still to roll; salary is the price
      // the game puts on a chart, so it is the ranking used here.
      const rolled = game.rollResults?.[teamKey] || [];
      let best = -1;
      let bestSal = -1;
      starters.forEach((p, i) => {
        if (rolled[i] == null && (p?.salary || 0) > bestSal) { best = i; bestSal = p?.salary || 0; }
      });
      return { playerIdx: best >= 0 ? best : 0 };
    }

    case 'burned_switch': {
      // The slot the switch actually burned — the engine refuses any other.
      return { playerIdx: burnedSlots(game, game.lastDefSwitch)[0] ?? 0 };
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

    case 'bully_ball': {
      // execCard re-checks the CHOSEN player's power ADVANTAGE, so picking by
      // raw power can nominate a star who is out-muscled in his matchup and
      // fail at the door (canPlay only asks whether SOMEONE has an edge).
      const best = starters.reduce((b, p, i) => {
        const di = (game.offMatchups?.[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return b;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        return adv.powerAdv > (b.adv || 0) ? { idx: i, adv: adv.powerAdv } : b;
      }, { idx: 0, adv: 0 });
      return { playerIdx: best.idx };
    }

    case 'back_to_basket': {
      // execCard needs the chosen player at Power 13+ WITH a Paint Bonus.
      const cand = starters.findIndex((p, i) => rolls[i] == null && p.power >= 13 && (p.paintBoost || 0) > 0);
      if (cand >= 0) return { playerIdx: cand };
      const any = starters.findIndex(p => p.power >= 13 && (p.paintBoost || 0) > 0);
      return { playerIdx: any >= 0 ? any : 0 };
    }

    case 'power_move': {
      // Pure buff, no exec gate — highest power still waiting to roll.
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
      return result ? { assignments: result.matchups } : {};
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

    case 'ato_masterpiece': {
      // Best converter, best channel: 3PT beats paint when both boosts exist.
      let bestAto = { i: 0, v: -99, type: '3pt' };
      starters.forEach((p, i) => {
        const t3 = (p.threePtBoost || 0) * 3;
        const tp = (p.paintBoost || 0) * 2;
        const v = Math.max(t3, tp);
        if (v > bestAto.v) bestAto = { i, v, type: t3 >= tp ? '3pt' : 'paint' };
      });
      return { playerIdx: bestAto.i, checkType: bestAto.type };
    }

    case 'fresh_legs': {
      const byMin = starters
        .map((p, i) => ({ i, min: getPS(game, teamKey, p.id)?.minutes || 0 }))
        .sort((a, b) => b.min - a.min);
      return { playerIdx: byMin[0]?.i ?? 0, player2Idx: byMin[1]?.i };
    }

    case 'ice_the_hot_hand': {
      let bestIce = { i: 0, hot: -1 };
      (oppT.starters || []).forEach((p, i) => {
        const hot = getPS(game, oppKey, p.id)?.hot || 0;
        if (hot > bestIce.hot) bestIce = { i, hot };
      });
      return { targetIdx: bestIce.i };
    }

    case 'reset': {
      let bestReset = { i: 0, cold: -1 };
      starters.forEach((p, i) => {
        const cold = getPS(game, teamKey, p.id)?.cold || 0;
        if (cold > bestReset.cold) bestReset = { i, cold };
      });
      return { playerIdx: bestReset.i };
    }

    case 'desperation_press':
    case 'second_closer': {
      return {};
    }

    case 'pick_up_full_court': {
      // Hound the star with the most tired legs: minutes weigh double so the
      // press pushes someone over a fatigue threshold, chart ceiling breaks ties.
      let best = { i: 0, score: -1 };
      (oppT.starters || []).forEach((p, i) => {
        if (!p) return;
        const ps = getPS(game, oppKey, p.id);
        const min = ps?.minutes || 0;
        const top = p.chart?.length ? p.chart[p.chart.length - 1].pts : 0;
        const score = min * 2 + top;
        if (score > best.score) best = { i, score };
      });
      return { targetIdx: best.i };
    }

    case 'double_team': {
      // Trap the biggest remaining threat — chart ceiling plus the roll
      // bonus they carry right now. The open man is the opponent's to find.
      const oppRolls = game.rollResults[oppKey] || [];
      const myMu = game.offMatchups?.[oppKey] || [];
      let best = { i: 0, threat: -99 };
      (oppT.starters || []).forEach((p, i) => {
        if (!p || oppRolls[i] != null) return;
        const dIdx = myMu[i] ?? i;
        const myDef = (getTeam(game, teamKey).starters || [])[dIdx];
        const rb = myDef ? calcAdv(p, myDef, game.tempEff?.[oppKey] || {}, i).rollBonus : 0;
        const top = p.chart?.length ? p.chart[p.chart.length - 1].pts : 0;
        if (top + rb > best.threat) best = { i, threat: top + rb };
      });
      return { targetIdx: best.i };
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

    // ═══ WAVE ONE (2026-09-06) — pick the player the engine will accept ═══════
    case 'spain_pick_roll': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => {
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        return p && dp && p.speed > dp.speed;
      }).sort((u, v) => v.p.speed - u.p.speed);
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'mismatch_hunter': {
      const best = starters.reduce((b, p, i) => {
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        if (!p || !dp) return b;
        const a = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        const m = Math.max(a.speedAdv, a.powerAdv);
        return m > b.m ? { idx: i, m } : b;
      }, { idx: 0, m: -99 });
      return { playerIdx: best.idx };
    }
    case 'energizer': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.salary || 0) < 250)
        .sort((u, v) => ((v.p.defBoost || 0) - (u.p.defBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'defensive_anchor': {
      // The anchor with the biggest bonus, guarding the attacker with the
      // largest positive matchup bonus if there is one.
      const guards = game.offMatchups?.[oppKey] || [];
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => (p?.defBoost || 0) >= 3);
      const scored = cand.map(({ p, i }) => {
        const offSlot = guards.indexOf(i);
        const off = oppT.starters[offSlot];
        const rb = off ? calcAdv(off, p, game.tempEff?.[oppKey] || {}, offSlot).rollBonus : 0;
        return { i, rb };
      }).sort((u, v) => v.rb - u.rb);
      return { playerIdx: scored[0]?.i ?? cand[0]?.i ?? 0 };
    }
    case 'five_out': {
      const cand = starters.map((p, i) => ({ p, i }))
        .filter(({ p, i }) => p && rolls[i] == null && (p.threePtBoost || 0) > 0)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'hammer_set': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => {
        if (!p || (p.threePtBoost || 0) > 0) return false;
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        return dp && calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i).speedAdv > 0;
      }).sort((u, v) => (u.p.shotLine ?? 18) - (v.p.shotLine ?? 18));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'iso_heavy': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && rolls[i] == null)
        .sort((u, v) => expectedOutput(v.p) - expectedOutput(u.p));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'three_point_barrage': {
      // The extra check goes to the best shooter if an assist is spare.
      const shooters = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.threePtBoost || 0) > 0)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return myT.assists >= 2 && shooters[0] ? { extraShooterIdx: shooters[0].i } : {};
    }
    case 'crash_and_kick': case 'extra_pass': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0, checkType: '3pt' };
    }
    case 'pick_and_pop': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.threePtBoost || 0) > 0)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'lob_city': case 'denial': {
      const others = (myT.hand || []).filter(id => id !== cardId);
      return { discardId: others[others.length - 1] };
    }

    // ═══ WAVE TWO (2026-09-07) ═══════════════════════════════════════════════
    case 'outside_pick': {
      // The best shooter takes it; the cheapest card in hand pays for it.
      const shooters = starters.map((p, i) => ({ p, i })).filter(({ p }) => p)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      const others = (myT.hand || []).filter(id => id !== cardId);
      return { playerIdx: shooters[0]?.i ?? 0, discardId: others[others.length - 1] };
    }
    case 'short_roll_playmaker': {
      // Of the players who clear 8/8, the one most likely to score inside.
      const cand = starters.map((p, i) => ({ p, i }))
        .filter(({ p }) => p && (p.speed || 0) >= 8 && (p.power || 0) >= 8)
        .sort((u, v) => ((v.p.paintBoost || 0) - (u.p.paintBoost || 0)) || (v.p.power - u.p.power));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'pick_and_roll_maestro': {
      // The fastest qualifying handler, then the swap that buys the biggest
      // gap — the card is that choice, so the AI makes it properly.
      const mu = game.offMatchups?.[teamKey] || [];
      const fast = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.speed || 0) >= 14)
        .sort((u, v) => v.p.speed - u.p.speed);
      const who = fast[0];
      if (!who) return { playerIdx: 0 };
      const mate = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && i !== who.i)
        .map(({ i }) => ({ i, gap: (who.p.speed || 0) - (oppT.starters[mu[i] ?? i]?.speed || 0) }))
        .sort((u, v) => v.gap - u.gap);
      return { playerIdx: who.i, player2Idx: mate[0]?.i ?? (who.i === 0 ? 1 : 0) };
    }
    case 'inside_out': {
      // Anyone but the man who just scored inside; the best shooter of them.
      const scorer = game.lastPaintScore?.playerIdx;
      const mates = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && i !== scorer)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return { playerIdx: scorer ?? 0, player2Idx: mates[0]?.i ?? 0 };
    }
    case 'stretch_five': {
      const big = starters.map((p, i) => ({ p, i })).find(({ p }) => p && String(p.pos || '').split(/[-/]/).some(t => t === 'C' || t === 'PF') && ((p.shotLine ?? 18) - (p.threePtBoost || 0)) <= 14);
      const mate = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && i !== big?.i)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.paintBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.paintBoost || 0)));
      return { playerIdx: big?.i ?? 0, player2Idx: mate[0]?.i ?? 1 };
    }
    case 'post_domination': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => (p?.power || 0) >= 15)
        .sort((u, v) => expectedOutput(v.p) - expectedOutput(u.p));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'unsung_hero': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && rolls[i] == null && (p.salary || 0) <= 400)
        .sort((u, v) => expectedOutput(v.p) - expectedOutput(u.p));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'transition_outlet': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => {
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        return p && dp && calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i).speedAdv > 0;
      }).sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0, checkType: '3pt' };
    }
    case 'help_defender': {
      // Send help at the worst mismatch, from the defender guarding the
      // attacker with least to gain — the man you leave open should be the
      // one who punishes it least.
      const targets = helpTargets(game, teamKey);
      if (!targets.length) return {};
      const worst = targets.reduce((b, t) => (t.adv > b.adv ? t : b), targets[0]);
      const guards = game.offMatchups?.[oppKey] || [];
      const cost = starters
        .map((p, i) => ({ i, slot: guards.indexOf(i) }))
        .filter(({ i, slot }) => i !== worst.defIdx && slot >= 0)
        .map(({ i, slot }) => ({ i, value: expectedOutput(oppT.starters[slot]) }))
        .sort((u, v) => u.value - v.value);
      return { targetIdx: worst.offSlot, helperIdx: cost[0]?.i ?? starters.findIndex((_, i) => i !== worst.defIdx) };
    }

    case 'find_the_open_man': {
      const dt = game.lastDoubleTeam;
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && rolls[i] == null && i !== dt?.targetIdx)
        .sort((u, v) => expectedOutput(v.p) - expectedOutput(u.p));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'putback_specialist': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.paintBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.paintBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'hustle_play': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.salary || 0) < 400 && (p.defBoost || 0) > 0)
        .sort((u, v) => (v.p.defBoost || 0) - (u.p.defBoost || 0));
      return { playerIdx: cand[0]?.i ?? 0 };
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
  const pick = candidates[0];

  // CLUTCH POSSESSION: in crunch, spend it on the best remaining chart —
  // extra dice are worth most where the top tiers are worth most — as long
  // as that player is the one rolling now and his legs allow it.
  if (clutchAvailable(game, teamKey) > 0) {
    const ceiling = i => {
      const ch = myT.starters[i]?.chart;
      return ch?.length ? ch[ch.length - 1].pts + (game.clutchDice?.[myT.starters[i].id] || 0) * 2 : 0;
    };
    const bestCeiling = Math.max(...candidates.map(c => ceiling(c.idx)));
    if (ceiling(pick.idx) >= bestCeiling && clutchEligible(game, teamKey, pick.idx)) {
      return { type: 'roll', playerIdx: pick.idx, clutch: true };
    }
  }
  return { type: 'roll', playerIdx: pick.idx };
}

/**
 * The Crunch Time timeout brain: call the one timeout when the moment is
 * right — trailing, or a rider in hand worth the stoppage — then the caller
 * re-sets the defense, plays the best rider, and resumes.
 */
export function aiCrunchDecision(game, teamKey) {
  if (!game.crunch?.active || game.phase !== 'scoring') return null;
  if (game.crunch.timeoutUsed?.[teamKey] || game.timeoutActive) return null;
  const team = getTeam(game, teamKey);
  const opp = getOpp(game, teamKey);
  const riders = ['ato_masterpiece', 'fresh_legs', 'ice_the_hot_hand', 'reset'];
  const holdsRider = (team.hand || []).some(id => riders.includes(id));
  const trailing = team.score < opp.score;
  if (trailing || holdsRider) return { type: 'timeout' };
  return null;
}

// ── Reaction Card Decision ──────────────────────────────────────────────────
// Check if AI should play a reaction card in response to opponent's action.
export function aiReactionDecision(game, teamKey, trigger) {
  const team = getTeam(game, teamKey);
  const hand = team.hand || [];

  // An announced shot check: one answer, the strongest legal one. Paint
  // checks have their own answers (Rim Protector, Drop Coverage); Close Out
  // is the three-point one; the rest answer either.
  if (trigger === 'shot_check') {
    const psc = game.pendingShotCheck;
    if (!psc || psc.reacted) return null;
    const order = psc.type === 'paint'
      ? ['rim_protector', 'drop_coverage', 'smothering_defense', 'hustle_play', 'denial']
      : ['close_out', 'smothering_defense', 'hustle_play', 'denial'];
    for (const cardId of order) {
      if (!hand.includes(cardId)) continue;
      if (canPlayCard(game, teamKey, cardId).canPlay) {
        return { type: 'play_card', cardId, opts: aiBuildCardOpts(game, teamKey, cardId) };
      }
    }
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
        if (check.canPlay) return { type: 'play_card', cardId, opts: aiBuildCardOpts(game, teamKey, cardId) };
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
    // THE PLACEMENT SNAKE IS THE MATCHUP ASSIGNMENT. Row by row, A places and
    // B answers in the same row (or the other way round), and the pairing
    // that leaves is the matchup — the AI's defensive choice is made in
    // aiPlacementPick, when it counters what just took the floor. Only a
    // switching card (or the crunch-time timeout re-set) moves anyone after
    // that. For four days the AI also re-dealt every pairing here through
    // aiSetMatchups; the user, reading the log on 2026-09-06: "the AI is just
    // setting the defense after the matchups have been laid down... Only
    // switching cards can change that." aiSetMatchups stays for the cards.
    //
    // A matchup card, otherwise pass.
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
