// NBA Showdown 2K25 — Card Execution Engine
// Pure function: takes game state + card + opts, returns new state
// Never mutates — always returns a new object via deepClone

import { getTeam, getOpp, getPS, calcAdv, shotCheck, drawCards, deepClone, getFatigue } from './engine.js';
import { lookupChart } from './cards.js';
import { getStrat } from './strats.js';

// ── Helpers ─────────────────────────────────────────────────────────────────
function scStr(r) {
  return `🎲${r.die}${r.bonus !== 0 ? (r.bonus > 0 ? '+' : '') + r.bonus : ''}=${r.total} vs ${r.line} → ${r.hit ? r.pts + 'pts ✓' : 'MISS'}`;
}

function recordShot(g, teamKey, playerId, type, hit) {
  const ps = getPS(g, teamKey, playerId);
  if (!ps) return;
  if (type === '3pt')   { ps.threepa = (ps.threepa || 0) + 1; if (hit) ps.threepm = (ps.threepm || 0) + 1; }
  if (type === 'ft')    { ps.fta = (ps.fta || 0) + 1;         if (hit) ps.ftm = (ps.ftm || 0) + 1; }
}

function addLog(g, team, msg) {
  g.log = [...g.log, { team, msg }];
}

function removeFromHand(team, cardId) {
  const i = team.hand.indexOf(cardId);
  if (i !== -1) team.hand = team.hand.filter((_, idx) => idx !== i);
}

function drawN(team, deck, n) {
  const result = drawCards(team.hand, deck, n);
  team.hand = result.hand;
  return result.deck;
}

// ── Main execCard ─────────────────────────────────────────────────────────────
// Returns { game, ok, msg } — game is new state, ok=false means validation failed
export function execCard(game, teamKey, cardId, opts = {}) {
  const s = getStrat(cardId);
  if (!s) return { game, ok: false, msg: 'Unknown card: ' + cardId };

  // Deep clone so we never mutate
  const g = deepClone(game);
  const myT = getTeam(g, teamKey);
  const oppT = getOpp(g, teamKey);

  const idx  = opts.playerIdx  !== undefined ? opts.playerIdx  : 0;
  const idx2 = opts.player2Idx !== undefined ? opts.player2Idx : 1;

  // Spend 1 assist for +1 to shot checks if requested
  const _assistShotBonus = (opts.spendAssistBoost && myT.assists >= 1) ? 1 : 0;
  if (_assistShotBonus) {
    myT.assists -= 1;
    addLog(g, teamKey, 'Spent 1 AST → +1 to shot check');
  }
  // Wrap shotCheck to automatically include assist bonus
  const _shotCheck = (p, type, extra, pStats) => shotCheck(p, type, (extra || 0) + _assistShotBonus, pStats);

  const player    = myT.starters[idx];
  const ps        = getPS(g, teamKey, player?.id) || {};
  const defIdx    = (g.offMatchups[teamKey] || [])[idx] ?? idx;
  const defPlayer = oppT.starters[defIdx];
  const adv       = (player && defPlayer)
    ? calcAdv(player, defPlayer, g.tempEff[teamKey] || {}, idx)
    : { speedAdv: 0, powerAdv: 0, rollBonus: 0, rawSpeedDiff: 0, rawPowerDiff: 0, db: 0, hasPenalty: false };

  const fail = (msg) => ({ game, ok: false, msg });
  const pss  = () => getPS(g, teamKey, player?.id) || ps;

  // ── MATCHUP PHASE ──────────────────────────────────────────────────────────
  switch (cardId) {

    case 'high_screen_roll': {
      if (opts.swapSlot1 === undefined || opts.swapSlot2 === undefined)
        return fail('Select two of your own players to swap their defenders.');
      const s1 = opts.swapSlot1, s2 = opts.swapSlot2;
      if (s1 === s2) return fail('Select two different players.');
      const mu = g.offMatchups[teamKey];
      const d1 = mu[s1], d2 = mu[s2];
      mu[s1] = d2; mu[s2] = d1;
      const myP1 = myT.starters[s1], myP2 = myT.starters[s2];
      const oppD1 = oppT.starters[d1], oppD2 = oppT.starters[d2];
      g.lastMatchupCard = { cardId, teamKey, opts: { swapSlot1: s1, swapSlot2: s2, origD1: d1, origD2: d2 } };
      addLog(g, teamKey, `High Screen & Roll: ${myP1?.name} now guarded by ${oppD2?.name}, ${myP2?.name} now guarded by ${oppD1?.name}`);
      break;
    }

    case 'stagger_action': {
      const p1 = myT.starters[idx], p2 = myT.starters[idx2];
      if ((p1?.speed || 0) < 13 && (p2?.speed || 0) < 13)
        return fail('Need one player with Speed 13+');
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['s' + idx]  = (g.tempEff[teamKey]['s' + idx]  || 0) + 2;
      g.tempEff[teamKey]['s' + idx2] = (g.tempEff[teamKey]['s' + idx2] || 0) + 2;
      addLog(g, teamKey, `Stagger Action: ${p1?.name} & ${p2?.name} each +2 Speed this segment`);
      break;
    }

    case 'second_wind': {
      if (!g.ignFatigue) g.ignFatigue = {};
      g.ignFatigue[teamKey + '_' + idx] = true;
      addLog(g, teamKey, `Second Wind: ${player?.name} ignores fatigue this segment`);
      break;
    }

    case 'chip_on_shoulder': {
      if ((player?.salary || 0) > 250) return fail(player?.name + ' salary must be ≤$250');
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['s' + idx] = (g.tempEff[teamKey]['s' + idx] || 0) + 2;
      g.tempEff[teamKey]['p' + idx] = (g.tempEff[teamKey]['p' + idx] || 0) + 2;
      const dp = oppT.starters[(g.offMatchups[teamKey] || [])[idx] ?? idx];
      let msg = `Chip on the Shoulder: ${player?.name} +2 Spd/Pwr`;
      if (dp) {
        const newAdv = calcAdv(player, dp, g.tempEff[teamKey], idx);
        if (newAdv.rollBonus > 0) {
          const drawn = drawCards(myT.hand, myT.deck || [], 1);
          myT.hand = drawn.hand;
          msg += ` — now +${newAdv.rollBonus} roll bonus → draw a card!`;
        }
      }
      addLog(g, teamKey, msg);
      break;
    }

    case 'defensive_stopper': {
      if (!g.tempDefEff) g.tempDefEff = {};
      if (!g.tempDefEff[teamKey]) g.tempDefEff[teamKey] = {};
      g.tempDefEff[teamKey][idx] = { speedBoost: 5, powerBoost: 5 };
      addLog(g, teamKey, `Defensive Stopper: ${player?.name} +5 Spd/Pwr on defense this segment`);
      break;
    }

    // ── REACTION — SWITCH CANCELERS ───────────────────────────────────────────
    case 'go_under': {
      if (!g.lastMatchupCard) return fail('No switch card to react to');
      const lc = g.lastMatchupCard;
      const mu = g.offMatchups[lc.teamKey];
      mu[lc.opts.swapSlot1] = lc.opts.origD1;
      mu[lc.opts.swapSlot2] = lc.opts.origD2;
      // Use player-chosen target, default to swapSlot1
      const targetSlot = opts.goUnderTarget !== undefined ? opts.goUnderTarget : lc.opts.swapSlot1;
      const offPlayer = getTeam(g, lc.teamKey).starters[targetSlot];
      const offPs = getPS(g, lc.teamKey, offPlayer?.id) || {};
      if (offPlayer) {
        const r = shotCheck(offPlayer, '3pt', 2, offPs);
        if (r.hit) getTeam(g, lc.teamKey).score += r.pts;
        if (offPs && r.die <= 2)  offPs.cold = (offPs.cold || 0) + 1;
        if (offPs && r.die >= 19) offPs.hot  = (offPs.hot  || 0) + 1;
        addLog(g, teamKey, `Go Under: canceled HSR — ${offPlayer.name} 3PT check: ${scStr(r)}`);
      }
      g.lastMatchupCard = null;
      break;
    }

    case 'fight_over': {
      if (!g.lastMatchupCard) return fail('No switch card to react to');
      const lc = g.lastMatchupCard;
      const mu = g.offMatchups[lc.teamKey];
      mu[lc.opts.swapSlot1] = lc.opts.origD1;
      mu[lc.opts.swapSlot2] = lc.opts.origD2;
      const offT = getTeam(g, lc.teamKey);
      const p1 = offT.starters[lc.opts.swapSlot1];
      const p2 = offT.starters[lc.opts.swapSlot2];
      const beneficiary = ((p1?.speed || 0) >= (p2?.speed || 0)) ? p1 : p2;
      const bIdx = offT.starters.indexOf(beneficiary);
      if (!g.tempEff[lc.teamKey]) g.tempEff[lc.teamKey] = {};
      g.tempEff[lc.teamKey]['r' + bIdx] = (g.tempEff[lc.teamKey]['r' + bIdx] || 0) + 2;
      addLog(g, teamKey, `Fight Over: canceled HSR — ${beneficiary?.name} gets +2 to scoring roll`);
      g.lastMatchupCard = null;
      break;
    }

    case 'veer_switch': {
      if (!g.lastMatchupCard) return fail('No switch card to react to');
      const lc = g.lastMatchupCard;
      const mu = g.offMatchups[lc.teamKey];
      mu[lc.opts.swapSlot1] = lc.opts.origD1;
      mu[lc.opts.swapSlot2] = lc.opts.origD2;
      if (opts.newDefender1 !== undefined) mu[lc.opts.swapSlot1] = opts.newDefender1;
      if (opts.newDefender2 !== undefined) mu[lc.opts.swapSlot2] = opts.newDefender2;
      const offT = getTeam(g, lc.teamKey);
      const vp1 = offT.starters[lc.opts.swapSlot1], vp2 = offT.starters[lc.opts.swapSlot2];
      const nd1 = myT.starters[mu[lc.opts.swapSlot1]], nd2 = myT.starters[mu[lc.opts.swapSlot2]];
      addLog(g, teamKey, `Veer Switch: canceled HSR — ${vp1?.name} now guarded by ${nd1?.name}, ${vp2?.name} by ${nd2?.name}`);
      g.lastMatchupCard = null;
      break;
    }

    // ── SCORING REACTIONS ─────────────────────────────────────────────────────
    case 'close_out': {
      if (!g.pendingShotCheck) return fail('No shot check in progress to close out');
      g.pendingShotCheck.closeOutBonus = -3;
      g.pendingShotCheck.closeOutTeam = teamKey;
      const target = getTeam(g, g.pendingShotCheck.teamKey).starters[g.pendingShotCheck.playerIdx];
      addLog(g, teamKey, `Close Out: ${target?.name}'s ${g.pendingShotCheck.type.toUpperCase()} check reduced by −3. Miss = cold marker!`);
      break;
    }

    case 'cold_spell': {
      const oppRolls = g.rollResults[teamKey === 'A' ? 'B' : 'A'] || [];
      const rollIdx = opts.playerIdx || 0;
      const targetRoll = oppRolls[rollIdx];
      if (!targetRoll || (targetRoll.die !== 1 && targetRoll.die !== 2))
        return fail(`That player's roll was not a natural 1 or 2 (die=${targetRoll?.die})`);
      if (targetRoll.coldSpellUsed) return fail('Cold Spell already used on this roll');
      targetRoll.coldSpellUsed = true;
      const targetPlayer = oppT.starters[rollIdx];
      const targetPs = getPS(g, teamKey === 'A' ? 'B' : 'A', targetPlayer?.id) || {};
      targetPs.cold = (targetPs.cold || 0) + 1;
      oppT.rebounds = Math.max(0, oppT.rebounds - 1);
      addLog(g, teamKey, `Cold Spell: ${targetPlayer?.name} ❄️ cold marker + opponent REB Track −1`);
      break;
    }

    case 'anticipate_pass': {
      if (oppT.assists < 6) return fail(`Opponent needs 6+ assists (has ${oppT.assists})`);
      if (myT.assists < 1)  return fail('Need at least 1 assist to spend');
      myT.assists--;
      oppT.assists -= 2;
      addLog(g, teamKey, 'Anticipate the Pass: −1 your AST, −2 opponent AST');
      break;
    }

    case 'overhelp': {
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['r' + idx] = (g.tempEff[teamKey]['r' + idx] || 0) + 2;
      addLog(g, teamKey, `Overhelp: ${player?.name} +2 to scoring roll (found the mismatch)`);
      break;
    }

    case 'burned_switch': {
      const origDef = oppT.starters[opts.originalDefIdx];
      const newDef  = oppT.starters[opts.newDefIdx];
      if (!origDef || !newDef) return fail('Invalid defender indices');
      if (newDef.speed >= origDef.speed && newDef.power >= origDef.power)
        return fail('New defender is not worse in Speed or Power than original');
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['r' + idx] = (g.tempEff[teamKey]['r' + idx] || 0) + 3;
      addLog(g, teamKey, `Burned on the Switch: ${newDef.name} weaker than ${origDef.name} → ${player?.name} +3 roll`);
      break;
    }

    case 'offensive_board': {
      if (myT.rebounds < 3) return fail(`Need 3 rebounds (have ${myT.rebounds})`);
      myT.rebounds -= 3;
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['extra_roll_' + idx] = -2;
      addLog(g, teamKey, `Offensive Board Mastery: −3 REB → ${player?.name} gets a second scoring roll at −2`);
      break;
    }

    case 'rebound_tap_out': {
      if (myT.rebounds < 2) return fail(`Need 2 rebounds (have ${myT.rebounds})`);
      if (!((player?.threePtBoost || 0) > 0)) return fail(player?.name + ' needs a 3PT Bonus');
      myT.rebounds -= 2;
      myT.assists++;
      const r = _shotCheck(player, '3pt', 1, ps);
      recordShot(g, teamKey, player?.id, '3pt', r.hit);
      if (r.die <= 2)  pss().cold = (pss().cold || 0) + 1;
      if (r.die >= 19) pss().hot  = (pss().hot  || 0) + 1;
      if (r.hit) myT.score += r.pts;
      addLog(g, teamKey, `Rebound Tap-Out (−2 REB, +1 AST): ${scStr(r)}`);
      break;
    }

    case 'switch_everything': {
      const oppTeam = teamKey === 'A' ? 'B' : 'A';
      if (opts.assignments && opts.assignments.length === 5) {
        g.offMatchups[oppTeam] = [...opts.assignments];
        addLog(g, teamKey, `Switch Everything: ${myT.name} reassigned their entire defense`);
      }
      if (!g.tempEff[oppTeam]) g.tempEff[oppTeam] = {};
      g.tempEff[oppTeam]['doubleAdv'] = true;
      addLog(g, teamKey, '⚠️ All opponent offensive advantages doubled this segment!');
      break;
    }

    // ── SCORING PHASE CARDS ───────────────────────────────────────────────────
    case 'heat_check': {
      const rr = (g.rollResults[teamKey] || [])[idx];
      if (!rr?.isTop) return fail(player?.name + ' didn\'t hit highest tier.');
      const r = _shotCheck(player, '3pt', -2, ps);
      recordShot(g, teamKey, player?.id, '3pt', r.hit);
      if (r.die <= 2)  pss().cold = (pss().cold || 0) + 1;
      if (r.die >= 19) pss().hot  = (pss().hot  || 0) + 1;
      if (r.hit) { myT.score += r.pts; pss().hot = (pss().hot || 0) + 1; }
      addLog(g, teamKey, `Heat Check: ${player.name} ${scStr(r)}${r.hit ? ' 🔥' : ''}`);
      break;
    }

    case 'green_light': {
      let tot = 0;
      for (let i = 0; i < 3; i++) {
        const r = _shotCheck(player, '3pt', 0, ps);
        recordShot(g, teamKey, player?.id, '3pt', r.hit);
        if (r.die <= 2)  pss().cold = (pss().cold || 0) + 1;
        if (r.die >= 19) pss().hot  = (pss().hot  || 0) + 1;
        tot += r.pts;
        addLog(g, teamKey, `Green Light #${i + 1}: ${scStr(r)}`);
      }
      myT.score += tot;
      if (!g.rollResults[teamKey]) g.rollResults[teamKey] = [];
      g.rollResults[teamKey][idx] = { die: '-', bonus: 0, finalRoll: '-', pts: tot, reb: 0, ast: 0, isTop: false, isReplaced: true };
      break;
    }

    case 'from_way_downtown': {
      // Sets pendingShotCheck — resolved by resolvePendingShotCheck
      removeFromHand(myT, cardId);
      g.pendingShotCheck = { teamKey, playerIdx: idx, type: '3pt', bonus: 1, cardLabel: 'From Way Downtown', specialRoll: 'fwd' };
      addLog(g, teamKey, `From Way Downtown: ${player?.name} announces 3PT check at +1. Opponent may play Close Out.`);
      return { game: g, ok: true };
    }

    case 'you_stand_over_there': {
      let tot = 0;
      for (let i = 0; i < 2; i++) {
        const r = _shotCheck(player, '3pt', 0, ps);
        recordShot(g, teamKey, player?.id, '3pt', r.hit);
        if (r.die <= 2)  pss().cold = (pss().cold || 0) + 1;
        if (r.die >= 19) pss().hot  = (pss().hot  || 0) + 1;
        tot += r.pts;
        addLog(g, teamKey, `You Stand Over There #${i + 1}: ${scStr(r)}`);
      }
      myT.score += tot;
      if (!g.rollResults[teamKey]) g.rollResults[teamKey] = [];
      g.rollResults[teamKey][idx] = { die: '-', bonus: 0, finalRoll: '-', pts: tot, reb: 0, ast: 0, isTop: false, isReplaced: true };
      break;
    }

    case 'catch_and_shoot': {
      if ((player?.speed || 0) < 12) return fail(player?.name + ' needs Speed 12+');
      removeFromHand(myT, cardId);
      g.pendingShotCheck = { teamKey, playerIdx: idx, type: '3pt', bonus: 2, cardLabel: 'Catch & Shoot', onHit: 'ast' };
      addLog(g, teamKey, `Catch & Shoot: ${player?.name} announces 3PT check at +2. Opponent may play Close Out.`);
      return { game: g, ok: true };
    }

    case 'elevator_doors': {
      if (!((player?.threePtBoost || 0) > 0)) return fail(player?.name + ' needs a 3PT Bonus');
      removeFromHand(myT, cardId);
      g.pendingShotCheck = { teamKey, playerIdx: idx, type: '3pt', bonus: 3, cardLabel: 'Elevator Doors' };
      addLog(g, teamKey, `Elevator Doors: ${player?.name} announces 3PT check at +3. Opponent may play Close Out.`);
      return { game: g, ok: true };
    }

    case 'pin_down_screen': {
      if (opts.discardId) removeFromHand(myT, opts.discardId);
      const r = _shotCheck(player, '3pt', 5, ps);
      recordShot(g, teamKey, player?.id, '3pt', r.hit);
      if (r.die <= 2)  pss().cold = (pss().cold || 0) + 1;
      if (r.die >= 19) pss().hot  = (pss().hot  || 0) + 1;
      if (r.hit) { myT.score += r.pts; myT.assists++; }
      addLog(g, teamKey, `Pin-Down Screen: ${scStr(r)}${r.hit ? ' +1 AST' : ''}`);
      break;
    }

    case 'bully_ball': {
      if (adv.powerAdv <= 0) return fail(player?.name + ' needs a Power advantage');
      const pb = adv.powerAdv >= 4 ? 2 : 0;
      let tot = 0;
      for (let i = 0; i < 2; i++) {
        const r = _shotCheck(player, 'paint', pb, ps);
        recordShot(g, teamKey, player?.id, 'paint', r.hit);
        tot += r.pts;
        addLog(g, teamKey, `Bully Ball paint #${i + 1}: ${scStr(r)}`);
      }
      myT.score += tot;
      break;
    }

    case 'power_move': {
      const bonus = adv.powerAdv >= 5 ? 3 : 2;
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['p' + idx] = (g.tempEff[teamKey]['p' + idx] || 0) + bonus;
      addLog(g, teamKey, `Power Move: ${player?.name} +${bonus} Power this segment`);
      break;
    }

    case 'and_one': {
      const maxA = Math.max(adv.speedAdv, adv.powerAdv);
      if (maxA < 3) return fail(`Need Spd/Pwr advantage ≥3 (has ${maxA})`);
      myT.score += 1;
      addLog(g, teamKey, `And One!!! +1pt (advantage ${maxA})`);
      if (maxA >= 5) {
        const r = _shotCheck(player, 'ft', 0, ps);
        recordShot(g, teamKey, player?.id, 'ft', r.hit);
        if (r.die <= 2)  pss().cold = (pss().cold || 0) + 1;
        if (r.die >= 19) pss().hot  = (pss().hot  || 0) + 1;
        if (r.hit) myT.score += r.pts;
        addLog(g, teamKey, `Free throw: ${scStr(r)}`);
      }
      break;
    }

    case 'rimshaker': {
      if ((player?.power || 0) < 13) return fail('Need Power 13+');
      if (!(ps.hot > 0)) return fail(player?.name + ' needs a hot marker');
      myT.score += 2;
      pss().hot = (pss().hot || 0) + 1;
      addLog(g, teamKey, `Rimshaker: ${player?.name} +2pts + extra 🔥`);
      break;
    }

    case 'drive_the_lane': {
      if (adv.speedAdv <= 0) return fail(player?.name + ' needs a Speed advantage');
      let tot = 0;
      for (let i = 0; i < 2; i++) {
        const r = _shotCheck(player, 'ft', 0, ps);
        recordShot(g, teamKey, player?.id, 'ft', r.hit);
        if (r.die <= 2)  pss().cold = (pss().cold || 0) + 1;
        if (r.die >= 19) pss().hot  = (pss().hot  || 0) + 1;
        tot += r.pts;
        addLog(g, teamKey, `Drive FT #${i + 1}: ${scStr(r)}`);
      }
      myT.score += tot;
      if (adv.speedAdv >= 5 && defPlayer) {
        const dk = teamKey === 'A' ? 'B' : 'A';
        const dps = getPS(g, dk, defPlayer.id) || {};
        dps.cold = (dps.cold || 0) + 1;
        addLog(g, teamKey, `Speed adv 5+: ${defPlayer.name} gets ❄️ cold marker`);
      }
      break;
    }

    case 'uncontested_layup': {
      const ucDi = (g.offMatchups[teamKey] || [])[idx] ?? idx;
      const ucDp = oppT.starters[ucDi];
      if (!ucDp) return fail('No defender found');
      const ucAdv = calcAdv(player, ucDp, g.tempEff[teamKey] || {}, idx);
      if (ucAdv.speedAdv < 2 || ucAdv.powerAdv < 2)
        return fail(`${player?.name} needs +2 Spd AND +2 Pwr advantage (has +${ucAdv.speedAdv} Spd, +${ucAdv.powerAdv} Pwr)`);
      myT.score += 2;
      addLog(g, teamKey, `Uncontested Layup: ${player?.name} auto 2pts`);
      break;
    }

    case 'back_to_basket': {
      if ((player?.power || 0) < 13) return fail('Need Power 13+');
      if (!((player?.paintBoost || 0) > 0)) return fail(player?.name + ' needs a Paint Bonus');
      const r = _shotCheck(player, 'paint', 0, ps);
      if (r.die <= 2)  pss().cold = (pss().cold || 0) + 1;
      if (r.die >= 19) pss().hot  = (pss().hot  || 0) + 1;
      if (r.hit) myT.score += r.pts;
      addLog(g, teamKey, `Back to the Basket: ${scStr(r)}`);
      break;
    }

    case 'putback_dunk': {
      if (myT.rebounds <= oppT.rebounds) return fail('Team must lead in rebounds');
      if ((player?.power || 0) < 14) return fail('Need Power 14+');
      myT.score += 2;
      addLog(g, teamKey, `Putback Dunk: ${player?.name} auto 2pts!`);
      break;
    }

    case 'ghost_screen': {
      if ((player?.speed || 0) < 12) return fail('Need Speed 12+');
      if (!g.ghosted) g.ghosted = {};
      g.ghosted[teamKey + '_' + idx] = true;
      addLog(g, teamKey, `Ghost Screen: ${player?.name} — roll penalty negated to 0`);
      break;
    }

    case 'burst_of_momentum': {
      const rr = (g.rollResults[teamKey] || [])[idx];
      if (!rr?.isTop) return fail('Player must hit highest scoring tier');
      if ((rr?.pts || 0) < 5) return fail(`Player scored ${rr?.pts} pts (need 5+)`);
      myT.assists++;
      myT.rebounds++;
      pss().hot = (pss().hot || 0) + 1;
      addLog(g, teamKey, `Burst of Momentum: ${player?.name} +1 AST +1 REB 🔥`);
      break;
    }

    case 'flare_screen': {
      const rr = (g.rollResults[teamKey] || [])[idx];
      if (rr?.die !== 20) return fail('Player must have rolled a natural 20');
      const r = _shotCheck(player, '3pt', 0, ps);
      recordShot(g, teamKey, player?.id, '3pt', r.hit);
      if (r.die <= 2)  pss().cold = (pss().cold || 0) + 1;
      if (r.die >= 19) pss().hot  = (pss().hot  || 0) + 1;
      if (r.hit) {
        myT.score += r.pts;
        const drawn = drawCards(myT.hand, myT.deck || [], 1);
        myT.hand = drawn.hand;
      }
      addLog(g, teamKey, `Flare Screen: ${scStr(r)}${r.hit ? ' + draw a card' : ''}`);
      break;
    }

    case 'cross_court_dime': {
      if (myT.assists < 3) return fail(`Need 3 assists (have ${myT.assists})`);
      myT.assists -= 3;
      const r1 = _shotCheck(player, 'paint', 0, ps);
      const r2 = _shotCheck(player, '3pt',  0, ps);
      recordShot(g, teamKey, player?.id, '3pt', r2.hit);
      if (r1.hit) myT.score += r1.pts;
      if (r2.hit) myT.score += r2.pts;
      addLog(g, teamKey, `Cross-Court Dime (−3 AST): Paint ${scStr(r1)} | 3PT ${scStr(r2)}`);
      if (!g.rollResults[teamKey]) g.rollResults[teamKey] = [];
      g.rollResults[teamKey][idx] = { die: '-', bonus: 0, finalRoll: '-', pts: r1.pts + r2.pts, reb: 0, ast: 0, isTop: false, isReplaced: true };
      break;
    }

    case 'energy_injection': {
      let found = 0;
      [idx, idx2].forEach(i => {
        const p = myT.starters[i];
        if (!p || p.salary >= 400) return;
        if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
        g.tempEff[teamKey]['r' + i] = (g.tempEff[teamKey]['r' + i] || 0) + 1;
        addLog(g, teamKey, `Energy Injection: ${p.name} +1 roll bonus`);
        found++;
      });
      if (!found) return fail('No players with salary <$400 in selected slots');
      break;
    }

    case 'crowd_favorite': {
      if ((player?.salary || 0) > 350) return fail(player?.name + ' salary must be ≤$350');
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['crowd_' + idx] = true;
      addLog(g, teamKey, `Crowd Favorite: if ${player?.name} scores 5+ pts this segment → hot marker`);
      break;
    }

    case 'this_is_my_house': {
      const offSlot = opts.offSlot !== undefined ? opts.offSlot : idx;
      const offPlayer = oppT.starters[offSlot];
      if (!offPlayer) return fail('No offensive player at that slot');
      const myDefIdx = (g.offMatchups[teamKey === 'A' ? 'B' : 'A'] || [])[offSlot];
      const myDef = myT.starters[myDefIdx];
      if (!myDef) return fail('No defender assigned to that slot');
      if (!(myDef.speed > offPlayer.speed && myDef.power > offPlayer.power))
        return fail(`${myDef.name} must have higher Speed AND Power than ${offPlayer.name} (Def S${myDef.speed}/P${myDef.power} vs Off S${offPlayer.speed}/P${offPlayer.power})`);
      if (!g.blockedRolls) g.blockedRolls = {};
      const oppTeam = teamKey === 'A' ? 'B' : 'A';
      if (!g.blockedRolls[oppTeam]) g.blockedRolls[oppTeam] = {};
      g.blockedRolls[oppTeam][offSlot] = true;
      addLog(g, teamKey, `THIS IS MY HOUSE! 🏠 ${myDef.name} (S${myDef.speed}/P${myDef.power}) shuts out ${offPlayer.name} — they skip their scoring roll!`);
      break;
    }

    case 'turnover': {
      const oppKey4 = teamKey === 'A' ? 'B' : 'A';
      const hasOppCold = oppT.starters.some(p => {
        const pst = getPS(g, oppKey4, p?.id);
        return pst && (pst.cold || 0) > 0;
      });
      if (!hasOppCold) return fail('Opponent needs a player with a cold marker');
      const drawn = drawCards(myT.hand, myT.deck || [], 2);
      myT.hand = drawn.hand;
      addLog(g, teamKey, 'Turnover: drew 2 strategy cards');
      break;
    }

    case 'offensive_foul': {
      // Halve last Power boost applied by opponent, -1 REB
      // The "last power boost" is tracked via tempEff — find any 'p' keys on opponent
      const oppKey = teamKey === 'A' ? 'B' : 'A';
      const oppEff = g.tempEff[oppKey] || {};
      let halved = false;
      for (const key of Object.keys(oppEff)) {
        if (key.startsWith('p') && oppEff[key] > 0) {
          const orig = oppEff[key];
          oppEff[key] = Math.floor(orig / 2);
          addLog(g, teamKey, `Offensive Foul: Power boost on slot ${key.slice(1)} halved (${orig} → ${oppEff[key]})`);
          halved = true;
        }
      }
      if (!halved) addLog(g, teamKey, 'Offensive Foul: no active Power boosts found, −1 REB still applies');
      oppT.rebounds = Math.max(0, oppT.rebounds - 1);
      addLog(g, teamKey, 'Offensive Foul: opponent −1 Rebound');
      break;
    }

    case 'dogged': {
      // Target an opposing fatigued player: −2 Speed and −2 Power until benched
      const oppKey3 = teamKey === 'A' ? 'B' : 'A';
      const targetIdx = opts.playerIdx !== undefined ? opts.playerIdx : 0;
      const targetP = oppT.starters[targetIdx];
      if (!targetP) return fail('Invalid target');
      const targetFat = getFatigue(g, oppKey3, targetIdx);
      if (targetFat >= 0) return fail(targetP.name + ' is not fatigued');
      if (!g.tempEff[oppKey3]) g.tempEff[oppKey3] = {};
      g.tempEff[oppKey3]['s' + targetIdx] = (g.tempEff[oppKey3]['s' + targetIdx] || 0) - 2;
      g.tempEff[oppKey3]['p' + targetIdx] = (g.tempEff[oppKey3]['p' + targetIdx] || 0) - 2;
      addLog(g, teamKey, `Dogged: ${targetP.name} (fatigued) suffers additional −2 Spd/−2 Pwr until benched`);
      break;
    }

    case 'coaches_challenge': {
      // Re-roll opponent's most recent scoring roll
      const oppKey2 = teamKey === 'A' ? 'B' : 'A';
      const oppRolls = g.rollResults[oppKey2] || [];
      // Find last roll result
      let lastIdx = -1;
      for (let i = oppRolls.length - 1; i >= 0; i--) {
        if (oppRolls[i] && oppRolls[i].pts !== undefined && !oppRolls[i].isReplaced) { lastIdx = i; break; }
      }
      if (lastIdx === -1) return fail('No opponent scoring roll to challenge');
      const origResult = oppRolls[lastIdx];
      const ccPlayer = oppT.starters[lastIdx];
      if (!ccPlayer) return fail('Cannot find the player who rolled');
      const oldPts = origResult.pts || 0;
      const oldReb = origResult.reb || 0;
      const oldAst = origResult.ast || 0;
      // Re-roll: new D20 die with same bonus
      const newDie = Math.floor(Math.random() * 20) + 1;
      const newFinal = Math.max(1, Math.min(newDie + (origResult.bonus || 0), 99));
      const newResult = lookupChart(ccPlayer, newFinal);
      const topPts = ccPlayer.chart[ccPlayer.chart.length - 1].pts;
      const newIsTop = newResult.pts >= topPts && newResult.pts > 0;
      // Adjust opponent's score/assists/rebounds by the difference
      oppT.score += (newResult.pts - oldPts);
      oppT.assists += (newResult.ast - oldAst);
      oppT.rebounds += (newResult.reb - oldReb);
      // Update player stats
      const ccPs = getPS(g, oppKey2, ccPlayer.id);
      if (ccPs) {
        ccPs.pts += (newResult.pts - oldPts);
        ccPs.reb += (newResult.reb - oldReb);
        ccPs.ast += (newResult.ast - oldAst);
      }
      // Update roll result record
      oppRolls[lastIdx] = { ...origResult, die: newDie, finalRoll: newFinal, pts: newResult.pts, reb: newResult.reb, ast: newResult.ast, isTop: newIsTop };
      // Auto hot/cold on new die
      if (newDie <= 2 && ccPs) ccPs.cold = (ccPs.cold || 0) + 1;
      if (newDie >= 19 && ccPs) ccPs.hot = (ccPs.hot || 0) + 1;
      const diff = newResult.pts - oldPts;
      addLog(g, teamKey, `Coach's Challenge: ${ccPlayer.name}'s roll re-rolled! 🎲${origResult.die}→🎲${newDie} (${newFinal}) → ${newResult.pts}pts ${diff >= 0 ? '+' : ''}${diff}`);
      break;
    }

    case 'delayed_slip': {
      if ((player?.speed || 0) < 12) return fail(player?.name + ' needs Speed 12+');
      if ((player?.power || 0) < 10) return fail(player?.name + ' needs Power 10+');
      if (adv.rollBonus > 0) return fail(player?.name + ' already has a matchup advantage');
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['r' + idx] = (g.tempEff[teamKey]['r' + idx] || 0) + 2;
      myT.rebounds++;
      addLog(g, teamKey, `Delayed Slip: ${player?.name} +2 scoring roll + 1 REB`);
      break;
    }

    default:
      addLog(g, teamKey, `${s?.name || cardId}: played — see card text`);
      break;
  }

  // Remove card from hand (cards that return early have already removed)
  removeFromHand(myT, cardId);

  // Check assist bonus draw
  const checkAssist = (t, k) => {
    if (t.assists === 5) {
      const drawn = drawCards(t.hand, t.deck || [], 1);
      t.hand = drawn.hand;
      addLog(g, k, `${t.name} reached 5 assists — bonus card drawn!`);
      t.assists = 6;
    }
  };
  checkAssist(g.teamA, 'A');
  checkAssist(g.teamB, 'B');

  return { game: g, ok: true };
}

// ── Resolve Pending Shot Check (after Close Out window) ───────────────────────
export function resolvePendingShotCheck(game) {
  const psc = game.pendingShotCheck;
  if (!psc) return game;

  const g = deepClone(game);
  const myT = getTeam(g, psc.teamKey);
  const player = myT.starters[psc.playerIdx];
  const ps = getPS(g, psc.teamKey, player?.id) || {};

  let bonus = psc.bonus || 0;
  if (psc.closeOutBonus) bonus += psc.closeOutBonus;

  const r = shotCheck(player, psc.type, bonus, ps);
  recordShot(g, psc.teamKey, player?.id, psc.type, r.hit);

  // Auto hot/cold from natural roll
  // FWD uses wider range (1-3 cold, 18-20 hot) instead of standard (1-2, 19-20)
  if (psc.specialRoll === 'fwd') {
    if (r.die <= 3)  ps.cold = (ps.cold || 0) + 1;
    if (r.die >= 18) ps.hot  = (ps.hot  || 0) + 1;
  } else {
    if (r.die <= 2)  ps.cold = (ps.cold || 0) + 1;
    if (r.die >= 19) ps.hot  = (ps.hot  || 0) + 1;
  }

  if (r.hit) {
    myT.score += r.pts;
    if (psc.onHit === 'ast') myT.assists++;
  }

  const label = psc.cardLabel || psc.type.toUpperCase();
  let msg = `${label}: ${scStr(r)}`;
  if (psc.closeOutBonus && !r.hit) {
    ps.cold = (ps.cold || 0) + 1;
    msg += ' — Close Out! Miss → ❄️ cold marker';
  }
  if (r.hit && psc.onHit === 'ast') msg += ' +1 AST';

  g.log = [...g.log, { team: psc.teamKey, msg }];
  g.pendingShotCheck = null;

  // Check assist draw
  const t = myT;
  if (t.assists === 5) {
    const drawn = drawCards(t.hand, t.deck || [], 1);
    t.hand = drawn.hand;
    g.log = [...g.log, { team: psc.teamKey, msg: `${t.name} reached 5 assists — bonus card drawn!` }];
    t.assists = 6;
  }

  return g;
}
