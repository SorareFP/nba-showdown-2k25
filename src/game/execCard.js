// NBA Showdown 2026 — Card Execution Engine
// Pure function: takes game state + card + opts, returns new state
// Never mutates — always returns a new object via deepClone

import { handOverPriority, getTeam, getOpp, getPS, calcAdv, shotCheck, matchupContest, drawCards, deepClone, getFatigue, recordDefSwitch, burnedSlots, roll20 } from './engine.js';
import { helpTargets } from './canPlay.js';
import { lookupChart } from './cards.js';
import { getStrat } from './strats.js';

// ── Analytics helper ────────────────────────────────────────────────────────
function trackShotCheck(g, teamKey, r, type, playerIdx) {
  // Every check leaves the record Glass Cleaner and Putback Specialist read:
  // the latest miss (a hit clears it), gone at section end. Free throws are
  // not a shot anyone crashes for.
  if (type !== 'ft') g.lastCheckMiss = r.hit ? null : { teamKey, type, playerIdx: playerIdx ?? null, claimed: false };
  if (!g.analytics?.[teamKey]) return;
  g.analytics[teamKey].totalShotChecks++;
  if (r.hit) {
    g.analytics[teamKey].totalShotCheckHits++;
    g.analytics[teamKey].shotCheckPts += r.pts;
    if (type === 'ft') g.analytics[teamKey].freeThrowPts += r.pts;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function scStr(r, ps) {
  const hotCold = ps ? ((ps.hot || 0) - (ps.cold || 0)) : 0;
  const hcTag = hotCold > 0 ? ` 🔥×${ps.hot}` : hotCold < 0 ? ` 🧊×${ps.cold}` : '';
  return `🎲${r.die}${r.bonus !== 0 ? (r.bonus > 0 ? '+' : '') + r.bonus : ''}=${r.total} vs ${r.line} → ${r.hit ? r.pts + 'pts ✓' : 'MISS'}${hcTag}`;
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
/**
 * Play a card. The body below resolves what the card DOES; this wrapper is the
 * one place that resolves what playing a card COSTS in the card windows — the
 * turn. See handOverPriority in engine.js. Every caller (the board, the AI
 * driver, PvP) comes through here, so none of them can forget it.
 */
export function execCard(game, teamKey, cardId, opts = {}) {
  const res = resolveCard(game, teamKey, cardId, opts);
  if (!res.ok) return res;
  return { ...res, game: handOverPriority(game, res.game, teamKey) };
}

function resolveCard(game, teamKey, cardId, opts = {}) {
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
  // Wrap shotCheck to automatically include the assist bonus AND the passive
  // matchup contest: every card-initiated 3PT/paint check here shoots with the
  // card's chosen player (idx), so their assigned defender's Defensive Bonus
  // contests it in one place.
  const _shotCheck = (p, type, extra, pStats) =>
    shotCheck(p, type, (extra || 0) + _assistShotBonus - matchupContest(g, teamKey, idx, type), pStats);

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
      if (idx === idx2) return fail('Pick two different players');
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
      // Mark for +4 bonus fatigue at section end
      const swPs = getPS(g, teamKey, player.id);
      if (swPs) swPs.secondWindPenalty = true;
      addLog(g, teamKey, `Second Wind: ${player?.name} ignores fatigue this segment (+4 min penalty after)`);
      break;
    }

    case 'chip_on_shoulder': {
      if ((player?.salary || 0) > 250) return fail(player?.name + ' salary must be ≤$250');
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['s' + idx] = (g.tempEff[teamKey]['s' + idx] || 0) + 3;
      g.tempEff[teamKey]['p' + idx] = (g.tempEff[teamKey]['p' + idx] || 0) + 3;
      const dp = oppT.starters[(g.offMatchups[teamKey] || [])[idx] ?? idx];
      let msg = `Chip on the Shoulder: ${player?.name} +3 Spd/Pwr`;
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

    // ── CRUNCH TIME ─────────────────────────────────────────────────────────
    case 'desperation_press': {
      if (!g.crunch?.active) return fail('Crunch Time only');
      if (myT.score >= oppT.score) return fail('Only playable while trailing');
      const dpOpp = teamKey === 'A' ? 'B' : 'A';
      if (!g.pressArmed) g.pressArmed = {};
      g.pressArmed[dpOpp] = (g.pressArmed[dpOpp] || 0) + 1;
      addLog(g, teamKey, 'Desperation Press: their next top-tier roll gets re-rolled. The second result stands.');
      break;
    }

    case 'second_closer': {
      if (!g.crunch?.active) return fail('Crunch Time only');
      if ((g.crunch.extra?.[teamKey] || 0) >= 1) return fail('One Second Closer per game');
      g.crunch.extra[teamKey] = (g.crunch.extra[teamKey] || 0) + 1;
      addLog(g, teamKey, 'Second Closer: a second Clutch Possession is live.');
      break;
    }

    case 'ato_masterpiece': {
      if (g.timeoutActive !== teamKey) return fail('Play during your Timeout');
      const atoType = opts.checkType === 'paint' ? 'paint' : '3pt';
      const r = _shotCheck(player, atoType, 2, ps);
      recordShot(g, teamKey, player?.id, atoType, r.hit);
      trackShotCheck(g, teamKey, r, atoType);
      if (r.hit) myT.score += r.pts;
      addLog(g, teamKey, `ATO Masterpiece: out of the huddle, ${scStr(r)}`);
      break;
    }

    case 'fresh_legs': {
      if (g.timeoutActive !== teamKey) return fail('Play during your Timeout');
      const legs = [idx, opts.player2Idx].filter(i => i != null && myT.starters[i]);
      if (!legs.length) return fail('Choose up to two players');
      for (const i of new Set(legs)) {
        const p = myT.starters[i];
        const pps = getPS(g, teamKey, p.id);
        if (pps) pps.minutes = Math.max(0, (pps.minutes || 0) - 4);
      }
      addLog(g, teamKey, `Fresh Legs: ${[...new Set(legs)].map(i => myT.starters[i].name).join(' & ')} shed 4 minutes of fatigue`);
      break;
    }

    case 'ice_the_hot_hand': {
      if (g.timeoutActive !== teamKey) return fail('Play during your Timeout');
      const iceOpp = teamKey === 'A' ? 'B' : 'A';
      const target = oppT.starters[opts.targetIdx ?? 0];
      if (!target) return fail('Choose an opposing player');
      const tps = getPS(g, iceOpp, target.id);
      const had = tps?.hot || 0;
      if (!had) return fail(`${target.name} holds no hot markers`);
      tps.hot = 0;
      addLog(g, teamKey, `Ice the Hot Hand: ${target.name} loses ${had} hot marker${had > 1 ? 's' : ''}. The run stops here.`);
      break;
    }

    case 'reset': {
      if (g.timeoutActive !== teamKey) return fail('Play during your Timeout');
      const rps = getPS(g, teamKey, player?.id);
      const hadCold = rps?.cold || 0;
      if (!hadCold) return fail(`${player?.name} holds no cold markers`);
      rps.cold = 0;
      addLog(g, teamKey, `Reset: ${player?.name} clears ${hadCold} cold marker${hadCold > 1 ? 's' : ''}. Deep breath.`);
      break;
    }

    case 'pick_up_full_court': {
      const pufcOpp = teamKey === 'A' ? 'B' : 'A';
      const hounded = oppT.starters[opts.targetIdx];
      if (!hounded) return fail('Choose an opposing player to pressure');
      if (!g.tempEff[pufcOpp]) g.tempEff[pufcOpp] = {};
      g.tempEff[pufcOpp]['r' + opts.targetIdx] = (g.tempEff[pufcOpp]['r' + opts.targetIdx] || 0) - 1;
      // The press taxes the legs in the same currency Second Wind's penalty
      // uses: 4 extra minutes on the fatigue tracker. Rest still clears it.
      const houndedPs = getPS(g, pufcOpp, hounded.id);
      if (houndedPs) houndedPs.minutes = (houndedPs.minutes || 0) + 4;
      addLog(g, teamKey, `Pick Up Full Court: ${hounded.name} hounded — −1 roll this segment, +4 min fatigue`);
      break;
    }

    case 'double_team': {
      const dtOpp = teamKey === 'A' ? 'B' : 'A';
      const tIdx = opts.targetIdx;
      const target = oppT.starters[tIdx];
      if (!target) return fail('Choose an opposing player to trap');
      const oppRolls = g.rollResults[dtOpp] || [];
      if (oppRolls[tIdx] != null) return fail(target.name + ' has already rolled');
      // The trap: the target's assigned defender doubles with help.
      const dIdx = (g.offMatchups[dtOpp] || [])[tIdx] ?? tIdx;
      if (!g.tempDefEff) g.tempDefEff = {};
      if (!g.tempDefEff[teamKey]) g.tempDefEff[teamKey] = {};
      const cur = g.tempDefEff[teamKey][dIdx] || { speedBoost: 0, powerBoost: 0 };
      g.tempDefEff[teamKey][dIdx] = { speedBoost: cur.speedBoost + 6, powerBoost: cur.powerBoost + 6 };
      // The cost: somebody's open, and the OFFENSE finds him — the +3 rides
      // on the next roll the opponent chooses to make (roll order is theirs).
      if (!g.openMan) g.openMan = {};
      g.openMan[dtOpp] = (g.openMan[dtOpp] || 0) + 3;
      g.lastDoubleTeam = { teamKey, targetIdx: tIdx };
      addLog(g, teamKey, `Double Team: ${target.name} trapped (+6/+6 defense) — someone's open, Team ${dtOpp} gets +3 on their next roll`);
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
        const r = shotCheck(offPlayer, '3pt', 2 - matchupContest(g, lc.teamKey, targetSlot, '3pt'), offPs);
        trackShotCheck(g, lc.teamKey, r, '3pt');
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
      // The matchups as the offence had them after its screen — what the veer
      // switches AWAY from, and what Burned on the Switch compares against.
      const veerBefore = [...mu];
      mu[lc.opts.swapSlot1] = lc.opts.origD1;
      mu[lc.opts.swapSlot2] = lc.opts.origD2;
      // ONLY THE TWO DEFENDERS IN THE SCREEN CAN SWITCH. A veer is the late
      // switch between the two men the screen involved: the defence either
      // keeps them where they were or trades them — it does not get to pull a
      // third defender across the floor (the user, 2026-09-06: "a lot of
      // times, there are only two players who can switch"). `veerSwap` is the
      // short form; explicit defenders are accepted only as that same pair.
      const pair = [lc.opts.origD1, lc.opts.origD2];
      let swap = opts.veerSwap === true;
      if (opts.newDefender1 !== undefined || opts.newDefender2 !== undefined) {
        const d1 = opts.newDefender1;
        const d2 = opts.newDefender2;
        const legal = (d1 === pair[0] && d2 === pair[1]) || (d1 === pair[1] && d2 === pair[0]);
        if (!legal) return fail('Veer Switch only reassigns the two defenders in the screen');
        swap = d1 === pair[1];
      }
      if (swap) {
        mu[lc.opts.swapSlot1] = pair[1];
        mu[lc.opts.swapSlot2] = pair[0];
      }
      const offT = getTeam(g, lc.teamKey);
      const vp1 = offT.starters[lc.opts.swapSlot1], vp2 = offT.starters[lc.opts.swapSlot2];
      const nd1 = myT.starters[mu[lc.opts.swapSlot1]], nd2 = myT.starters[mu[lc.opts.swapSlot2]];
      addLog(g, teamKey, `Veer Switch: canceled HSR — ${vp1?.name} now guarded by ${nd1?.name}, ${vp2?.name} by ${nd2?.name}`);
      g.lastMatchupCard = null;
      g.lastDefSwitch = recordDefSwitch(teamKey, 'veer_switch', veerBefore, mu);
      break;
    }

    // ── SCORING REACTIONS ─────────────────────────────────────────────────────
    case 'close_out': {
      if (!g.pendingShotCheck) return fail('No shot check in progress to close out');
      g.pendingShotCheck.closeOutBonus = -3;
      g.pendingShotCheck.closeOutTeam = teamKey;
      g.pendingShotCheck.reacted = teamKey;
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
      const sw = g.lastDefSwitch;
      if (!sw || sw.teamKey === teamKey) return fail('Opponent must play a defensive switch first');
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['r' + idx] = (g.tempEff[teamKey]['r' + idx] || 0) + 3;
      addLog(g, teamKey, `Overhelp: ${player?.name} +3 to scoring roll (found the mismatch)`);
      g.lastDefSwitch = null;
      break;
    }

    case 'burned_switch': {
      // The engine knows which switch happened and who got the worse of it —
      // it used to ask the caller for defender indices, which the AI never
      // supplied, so the card failed every time it was tried.
      const sw = g.lastDefSwitch;
      if (!sw || sw.teamKey === teamKey) return fail('Opponent must force a matchup switch first');
      const burned = burnedSlots(g, sw);
      if (!burned.length) return fail('No defender got worse on that switch');
      const slot = opts.playerIdx !== undefined && burned.includes(opts.playerIdx) ? opts.playerIdx : burned[0];
      const change = sw.changes.find(c => c.slot === slot);
      const def = oppT.starters;
      const attacker = myT.starters[slot];
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['r' + slot] = (g.tempEff[teamKey]['r' + slot] || 0) + 3;
      addLog(g, teamKey, `Burned on the Switch: ${def[change.newD]?.name} weaker than ${def[change.origD]?.name} → ${attacker?.name} +3 roll`);
      g.lastDefSwitch = null;
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
      if (g.analytics?.[teamKey]) g.analytics[teamKey].assistsFromCards++;
      const r = _shotCheck(player, '3pt', 1, ps);
      recordShot(g, teamKey, player?.id, '3pt', r.hit);
      trackShotCheck(g, teamKey, r, '3pt');
      if (r.die <= 2)  pss().cold = (pss().cold || 0) + 1;
      if (r.die >= 19) pss().hot  = (pss().hot  || 0) + 1;
      if (r.hit) myT.score += r.pts;
      addLog(g, teamKey, `Rebound Tap-Out (−2 REB, +1 AST): ${scStr(r)}`);
      break;
    }

    case 'switch_everything': {
      const oppTeam = teamKey === 'A' ? 'B' : 'A';
      if (opts.assignments && opts.assignments.length === 5) {
        const seBefore = [...(g.offMatchups[oppTeam] || [0, 1, 2, 3, 4])];
        g.offMatchups[oppTeam] = [...opts.assignments];
        g.lastDefSwitch = recordDefSwitch(teamKey, 'switch_everything', seBefore, g.offMatchups[oppTeam]);
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
      trackShotCheck(g, teamKey, r, '3pt');
      if (r.die <= 2)  pss().cold = (pss().cold || 0) + 1;
      if (r.die >= 19) pss().hot  = (pss().hot  || 0) + 1;
      if (r.hit) { myT.score += r.pts; pss().hot = (pss().hot || 0) + 1; }
      addLog(g, teamKey, `Heat Check: ${player.name} ${scStr(r, pss())}${r.hit ? ' 🔥' : ''}`);
      break;
    }

    case 'green_light': {
      const existingRoll = (g.rollResults[teamKey] || [])[idx];
      if (existingRoll && !existingRoll.isReplaced) return fail(player?.name + ' has already rolled this segment.');
      let tot = 0;
      for (let i = 0; i < 3; i++) {
        const r = _shotCheck(player, '3pt', 0, ps);
        recordShot(g, teamKey, player?.id, '3pt', r.hit);
        trackShotCheck(g, teamKey, r, '3pt');
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
      if (g.analytics?.[teamKey]) g.analytics[teamKey].cardsPlayed++;
      g.pendingShotCheck = { teamKey, playerIdx: idx, type: '3pt', bonus: 1, cardLabel: 'From Way Downtown', specialRoll: 'fwd' };
      addLog(g, teamKey, `From Way Downtown: ${player?.name} announces 3PT check at +1. Opponent may play Close Out.`);
      return { game: g, ok: true };
    }

    case 'you_stand_over_there': {
      if (g.rollResults[teamKey]?.[idx] != null) return fail(`${player?.name} has already rolled this segment.`);
      let tot = 0;
      for (let i = 0; i < 2; i++) {
        const r = _shotCheck(player, '3pt', 0, ps);
        recordShot(g, teamKey, player?.id, '3pt', r.hit);
        trackShotCheck(g, teamKey, r, '3pt');
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
      if (g.analytics?.[teamKey]) g.analytics[teamKey].cardsPlayed++;
      g.pendingShotCheck = { teamKey, playerIdx: idx, type: '3pt', bonus: 2, cardLabel: 'Catch & Shoot', onHit: 'ast' };
      addLog(g, teamKey, `Catch & Shoot: ${player?.name} announces 3PT check at +2. Opponent may play Close Out.`);
      return { game: g, ok: true };
    }

    case 'elevator_doors': {
      if (!((player?.threePtBoost || 0) > 0)) return fail(player?.name + ' needs a 3PT Bonus');
      removeFromHand(myT, cardId);
      if (g.analytics?.[teamKey]) g.analytics[teamKey].cardsPlayed++;
      g.pendingShotCheck = { teamKey, playerIdx: idx, type: '3pt', bonus: 3, cardLabel: 'Elevator Doors' };
      addLog(g, teamKey, `Elevator Doors: ${player?.name} announces 3PT check at +3. Opponent may play Close Out.`);
      return { game: g, ok: true };
    }

    case 'pin_down_screen': {
      if (opts.discardId) removeFromHand(myT, opts.discardId);
      const r = _shotCheck(player, '3pt', 5, ps);
      recordShot(g, teamKey, player?.id, '3pt', r.hit);
      trackShotCheck(g, teamKey, r, '3pt');
      if (r.die <= 2)  pss().cold = (pss().cold || 0) + 1;
      if (r.die >= 19) pss().hot  = (pss().hot  || 0) + 1;
      if (r.hit) { myT.score += r.pts; myT.assists++; if (g.analytics?.[teamKey]) g.analytics[teamKey].assistsFromCards++; }
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
        trackShotCheck(g, teamKey, r, 'paint');
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
      // SPEED OR POWER, whichever is larger — never the two added together.
      // The log names the stat and shows both, because "advantage 6" on a
      // Speed +2 / Power +4 matchup read as a sum when it was a +2 Power boost
      // (the user, 2026-09-06).
      const maxA = Math.max(adv.speedAdv, adv.powerAdv);
      if (maxA < 3) return fail(`Need Spd/Pwr advantage ≥3 (has ${maxA})`);
      const stat = adv.powerAdv >= adv.speedAdv ? 'Power' : 'Speed';
      myT.score += 1;
      if (g.analytics?.[teamKey]) g.analytics[teamKey].shotCheckPts += 1;
      addLog(g, teamKey, `And One!!! +1pt (${stat} advantage +${maxA} — Speed +${adv.speedAdv}, Power +${adv.powerAdv})`);
      if (maxA >= 5) {
        const r = _shotCheck(player, 'ft', 0, ps);
        recordShot(g, teamKey, player?.id, 'ft', r.hit);
        trackShotCheck(g, teamKey, r, 'ft');
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
      if (g.analytics?.[teamKey]) g.analytics[teamKey].shotCheckPts += 2;
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
        trackShotCheck(g, teamKey, r, 'ft');
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
      if (g.analytics?.[teamKey]) g.analytics[teamKey].shotCheckPts += 2;
      addLog(g, teamKey, `Uncontested Layup: ${player?.name} auto 2pts`);
      break;
    }

    case 'back_to_basket': {
      if ((player?.power || 0) < 13) return fail('Need Power 13+');
      if (!((player?.paintBoost || 0) > 0)) return fail(player?.name + ' needs a Paint Bonus');
      // Announced, not instant: the paint check the defence can answer with
      // Rim Protector or Drop Coverage (resolvePendingShotCheck rolls it).
      g.pendingShotCheck = { teamKey, playerIdx: idx, type: 'paint', bonus: _assistShotBonus, cardLabel: 'Back to the Basket' };
      addLog(g, teamKey, `Back to the Basket: ${player?.name} announces a Paint check. Opponent may react.`);
      break;
    }

    case 'putback_dunk': {
      if (myT.rebounds <= oppT.rebounds) return fail('Team must lead in rebounds');
      if ((player?.power || 0) < 14) return fail('Need Power 14+');
      myT.score += 2;
      if (g.analytics?.[teamKey]) g.analytics[teamKey].shotCheckPts += 2;
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
      if (g.analytics?.[teamKey]) { g.analytics[teamKey].assistsFromCards++; g.analytics[teamKey].reboundsGenerated++; }
      pss().hot = (pss().hot || 0) + 1;
      addLog(g, teamKey, `Burst of Momentum: ${player?.name} +1 AST +1 REB 🔥`);
      break;
    }

    case 'flare_screen': {
      const rr = (g.rollResults[teamKey] || [])[idx];
      if (rr?.die !== 20) return fail('Player must have rolled a natural 20');
      const r = _shotCheck(player, '3pt', 0, ps);
      recordShot(g, teamKey, player?.id, '3pt', r.hit);
      trackShotCheck(g, teamKey, r, '3pt');
      if (r.die <= 2)  pss().cold = (pss().cold || 0) + 1;
      if (r.die >= 19) pss().hot  = (pss().hot  || 0) + 1;
      if (r.hit) {
        myT.score += r.pts;
        const drawn = drawCards(myT.hand, myT.deck || [], 1);
        myT.hand = drawn.hand;
      }
      addLog(g, teamKey, `Flare Screen: ${scStr(r, pss())}${r.hit ? ' + draw a card' : ''}`);
      break;
    }

    case 'cross_court_dime': {
      if (myT.assists < 3) return fail(`Need 3 assists (have ${myT.assists})`);
      if (g.rollResults[teamKey]?.[idx] != null) return fail(`${player?.name} has already rolled this segment.`);
      myT.assists -= 3;
      const r1 = _shotCheck(player, 'paint', 0, ps);
      const r2 = _shotCheck(player, '3pt',  0, ps);
      recordShot(g, teamKey, player?.id, '3pt', r2.hit);
      trackShotCheck(g, teamKey, r1, 'paint');
      trackShotCheck(g, teamKey, r2, '3pt');
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
        g.tempEff[teamKey]['r' + i] = (g.tempEff[teamKey]['r' + i] || 0) + 2;
        addLog(g, teamKey, `Energy Injection: ${p.name} +2 roll bonus`);
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
      const oppTeamKey = teamKey === 'A' ? 'B' : 'A';
      if (g.rollResults[oppTeamKey]?.[offSlot] != null) return fail(`${offPlayer.name} has already rolled — cannot skip their roll.`);
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
      // Re-roll opponent's most recent non-scoring shot check
      // Hard limit: 2 per game per team
      if (!g.challengesUsed) g.challengesUsed = { A: 0, B: 0 };
      if (g.challengesUsed[teamKey] >= 2) return fail("Coach's Challenge: already used 2 this game");

      const lsc = g.lastShotCheck;
      if (!lsc) return fail('No recent shot check to challenge');
      if (lsc.teamKey === teamKey) return fail("Can only challenge opponent's shot checks");

      const oppKey2 = lsc.teamKey;
      const ccPlayer = getTeam(g, oppKey2).starters[lsc.playerIdx];
      if (!ccPlayer) return fail('Cannot find the player who rolled');

      const ccPs = getPS(g, oppKey2, ccPlayer.id) || {};
      const oldResult = lsc.result;
      const oldPts = oldResult.pts || 0;

      // Reverse the original result
      const ccTeam = getTeam(g, oppKey2);
      ccTeam.score -= oldPts;
      if (ccPs) ccPs.pts = (ccPs.pts || 0) - oldPts;
      // Analytics: reverse the old shot check result
      if (g.analytics?.[oppKey2]) {
        g.analytics[oppKey2].shotCheckPts -= oldPts;
        if (oldResult.hit) g.analytics[oppKey2].totalShotCheckHits--;
        g.analytics[oppKey2].totalShotChecks--;
        if (oldResult.hit && oldResult.type === 'ft') g.analytics[oppKey2].freeThrowPts -= oldPts;
      }
      if (oldResult.hit && lsc.onHit === 'ast') { ccTeam.assists--; }
      // Reverse shot stats
      if (oldResult.type === '3pt') {
        if (ccPs) { ccPs.threepa = Math.max(0, (ccPs.threepa || 0) - 1); if (oldResult.hit) ccPs.threepm = Math.max(0, (ccPs.threepm || 0) - 1); }
      }
      if (oldResult.type === 'ft') {
        if (ccPs) { ccPs.fta = Math.max(0, (ccPs.fta || 0) - 1); if (oldResult.hit) ccPs.ftm = Math.max(0, (ccPs.ftm || 0) - 1); }
      }

      // Re-roll the shot check with same bonus
      const newR = shotCheck(ccPlayer, lsc.type, lsc.bonus || 0, ccPs);
      recordShot(g, oppKey2, ccPlayer.id, lsc.type, newR.hit);
      trackShotCheck(g, oppKey2, newR, lsc.type);

      // Apply new hot/cold
      if (lsc.specialRoll === 'fwd') {
        if (newR.die <= 3)  ccPs.cold = (ccPs.cold || 0) + 1;
        if (newR.die >= 18) ccPs.hot  = (ccPs.hot  || 0) + 1;
      } else {
        if (newR.die <= 2)  ccPs.cold = (ccPs.cold || 0) + 1;
        if (newR.die >= 19) ccPs.hot  = (ccPs.hot  || 0) + 1;
      }

      // Apply new result
      if (newR.hit) {
        ccTeam.score += newR.pts;
        if (ccPs) ccPs.pts += newR.pts;
        if (lsc.onHit === 'ast') ccTeam.assists++;
      }

      // Close Out cold marker on miss still applies if original had it
      if (lsc.closeOutApplied && !newR.hit) {
        ccPs.cold = (ccPs.cold || 0) + 1;
      }

      g.challengesUsed[teamKey]++;
      g.lastShotCheck = null; // Can't challenge the same check twice

      const diff = (newR.hit ? newR.pts : 0) - oldPts;
      addLog(g, teamKey, `Coach's Challenge: ${ccPlayer.name}'s ${lsc.cardLabel} re-rolled! ${scStr(oldResult)}→${scStr(newR)} (${diff >= 0 ? '+' : ''}${diff}pts)`);
      break;
    }

    case 'delayed_slip': {
      if ((player?.speed || 0) < 12) return fail(player?.name + ' needs Speed 12+');
      if ((player?.power || 0) < 10) return fail(player?.name + ' needs Power 10+');
      if (adv.rollBonus > 0) return fail(player?.name + ' already has a matchup advantage');
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['r' + idx] = (g.tempEff[teamKey]['r' + idx] || 0) + 2;
      myT.rebounds++;
      if (g.analytics?.[teamKey]) g.analytics[teamKey].reboundsGenerated++;
      addLog(g, teamKey, `Delayed Slip: ${player?.name} +2 scoring roll + 1 REB`);
      break;
    }

    // ═══ WAVE ONE OF THE DOCX BACKLOG (2026-09-06) ═══════════════════════════
    // An announced check (g.pendingShotCheck) is the only kind the defence can
    // answer; the multi-check plays roll on the spot, as Green Light does.
    case 'spain_pick_roll': {
      if (!defPlayer) return fail('No defender on that player');
      if ((player?.speed || 0) <= (defPlayer.speed || 0)) return fail(`${player?.name} is not faster than ${defPlayer.name}`);
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['r' + idx] = (g.tempEff[teamKey]['r' + idx] || 0) + 2;
      g.tempEff[teamKey]['astOnScore' + idx] = 1;
      addLog(g, teamKey, `Spain Pick & Roll: ${player?.name} +2 roll this period — a score adds +1 AST`);
      break;
    }
    case 'mismatch_hunter': {
      if (Math.max(adv.speedAdv, adv.powerAdv) < 4) return fail(`${player?.name} needs a Speed or Power advantage of +4`);
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['r' + idx] = (g.tempEff[teamKey]['r' + idx] || 0) + 2;
      addLog(g, teamKey, `Mismatch Hunter: ${player?.name} (advantage +${Math.max(adv.speedAdv, adv.powerAdv)}) +2 roll this period`);
      break;
    }
    case 'strength_in_numbers': {
      const allEdge = myT.starters.every((p, i) => {
        const dp = oppT.starters[(g.offMatchups[teamKey] || [])[i] ?? i];
        if (!p || !dp) return false;
        const a = calcAdv(p, dp, g.tempEff[teamKey] || {}, i);
        return Math.max(a.speedAdv, a.powerAdv) >= 1;
      });
      if (!allEdge) return fail('All five of your players need at least a +1 advantage');
      myT.assists += 3;
      addLog(g, teamKey, `Strength in Numbers: every matchup has an edge — +3 AST (${myT.assists})`);
      break; // the wrapper below removes the card and runs the 5-assist draw
    }
    case 'energizer': {
      if ((player?.salary || 0) >= 250) return fail(`${player?.name} must be under $250`);
      if (!g.tempDefEff) g.tempDefEff = {};
      if (!g.tempDefEff[teamKey]) g.tempDefEff[teamKey] = {};
      const cur = g.tempDefEff[teamKey][idx] || { speedBoost: 0, powerBoost: 0 };
      g.tempDefEff[teamKey][idx] = { ...cur, speedBoost: cur.speedBoost + 3, powerBoost: cur.powerBoost + 3 };
      addLog(g, teamKey, `Energizer: ${player?.name} +3/+3 on defense this period`);
      break;
    }
    case 'defensive_identity': {
      const withDb = myT.starters.filter(p => (p?.defBoost || 0) > 0).length;
      if (withDb < 3) return fail(`Need three players with a Defensive Bonus (have ${withDb})`);
      if (!g.tempDefEff) g.tempDefEff = {};
      if (!g.tempDefEff[teamKey]) g.tempDefEff[teamKey] = {};
      myT.starters.forEach((p, i) => {
        if (!p) return;
        const cur = g.tempDefEff[teamKey][i] || { speedBoost: 0, powerBoost: 0 };
        g.tempDefEff[teamKey][i] = { ...cur, speedBoost: cur.speedBoost + 2, powerBoost: cur.powerBoost + 2 };
      });
      addLog(g, teamKey, `Defensive Identity: ${withDb} defenders with a bonus — all five +2/+2 on defense this period`);
      break;
    }
    case 'defensive_anchor': {
      if ((player?.defBoost || 0) < 3) return fail(`${player?.name} needs a Defensive Bonus of +3`);
      if (!g.tempDefEff) g.tempDefEff = {};
      if (!g.tempDefEff[teamKey]) g.tempDefEff[teamKey] = {};
      const cur = g.tempDefEff[teamKey][idx] || { speedBoost: 0, powerBoost: 0 };
      g.tempDefEff[teamKey][idx] = { ...cur, anchor: true };
      const oppKeyA = teamKey === 'A' ? 'B' : 'A';
      const guarded = (g.offMatchups[oppKeyA] || []).indexOf(idx);
      const who = guarded >= 0 ? oppT.starters[guarded]?.name : 'his man';
      addLog(g, teamKey, `Defensive Anchor: ${player?.name} anchors — ${who} gets no positive matchup bonus this period`);
      break;
    }
    case 'swarming_defense': {
      const oppKeyS = teamKey === 'A' ? 'B' : 'A';
      let tIdx = 0;
      oppT.starters.forEach((p, i) => { if ((p?.salary || 0) > (oppT.starters[tIdx]?.salary || 0)) tIdx = i; });
      const target = oppT.starters[tIdx];
      if (!target) return fail('No opposing player to swarm');
      const d = roll20();
      if (d >= 11) {
        if (!g.tempEff[oppKeyS]) g.tempEff[oppKeyS] = {};
        g.tempEff[oppKeyS]['dis' + tIdx] = 1;
        addLog(g, teamKey, `Swarming Defense: 🎲${d} — ${target.name} rolls twice and keeps the lower this period`);
      } else {
        addLog(g, teamKey, `Swarming Defense: 🎲${d} — ${target.name} shakes it off (needed 11+)`);
      }
      break;
    }
    case 'five_out': {
      if (!((player?.threePtBoost || 0) > 0)) return fail(`${player?.name} needs a 3PT Bonus`);
      const existing = (g.rollResults[teamKey] || [])[idx];
      if (existing && !existing.isReplaced) return fail(`${player?.name} has already rolled this segment.`);
      let tot = 0;
      for (let i = 0; i < 2; i++) {
        const r = _shotCheck(player, '3pt', 1, ps);
        recordShot(g, teamKey, player?.id, '3pt', r.hit);
        trackShotCheck(g, teamKey, r, '3pt', idx);
        if (r.die <= 2)  pss().cold = (pss().cold || 0) + 1;
        if (r.die >= 19) pss().hot  = (pss().hot  || 0) + 1;
        tot += r.pts;
        addLog(g, teamKey, `Five-Out Offense #${i + 1}: ${scStr(r)}`);
      }
      myT.score += tot;
      if (!g.rollResults[teamKey]) g.rollResults[teamKey] = [];
      g.rollResults[teamKey][idx] = { die: 0, bonus: 0, finalRoll: 0, pts: tot, reb: 0, ast: 0, isTop: false, isReplaced: true, replacedBy: 'five_out' };
      break;
    }
    case 'hammer_set': {
      if ((player?.threePtBoost || 0) > 0) return fail(`${player?.name} has a 3PT Bonus — Hammer Set is for the non-shooter`);
      if (adv.speedAdv <= 0) return fail(`${player?.name} needs a Speed advantage`);
      g.pendingShotCheck = { teamKey, playerIdx: idx, type: '3pt', bonus: 0 + _assistShotBonus, cardLabel: 'Hammer Set', onHitAst: 2 };
      addLog(g, teamKey, `Hammer Set: ${player?.name} announces a 3PT check (hit = +2 AST). Opponent may react.`);
      break;
    }
    case 'iso_heavy': {
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['r' + idx] = (g.tempEff[teamKey]['r' + idx] || 0) + 3;
      myT.starters.forEach((p, i) => { if (p && i !== idx) g.tempEff[teamKey]['r' + i] = (g.tempEff[teamKey]['r' + i] || 0) - 2; });
      addLog(g, teamKey, `Iso-Heavy Offense: ${player?.name} takes over (+3 roll); teammates −2 this period`);
      break;
    }
    case 'three_point_barrage': {
      const shooters = myT.starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.threePtBoost || 0) > 0);
      if (shooters.length < 3) return fail(`Need three players with a 3PT Bonus (have ${shooters.length})`);
      let tot = 0;
      const fire = (p, i, tag) => {
        const pst = getPS(g, teamKey, p.id) || {};
        const r = shotCheck(p, '3pt', -matchupContest(g, teamKey, i, '3pt'), pst);
        recordShot(g, teamKey, p.id, '3pt', r.hit);
        trackShotCheck(g, teamKey, r, '3pt', i);
        if (r.die <= 2)  pst.cold = (pst.cold || 0) + 1;
        if (r.die >= 19) pst.hot  = (pst.hot  || 0) + 1;
        tot += r.pts;
        addLog(g, teamKey, `Three-Point Barrage${tag}: ${p.name} ${scStr(r)}`);
      };
      shooters.forEach(({ p, i }) => fire(p, i, ''));
      if (opts.extraShooterIdx !== undefined && opts.extraShooterIdx !== null) {
        const ex = myT.starters[opts.extraShooterIdx];
        if (!ex) return fail('No such player for the extra check');
        if (myT.assists < 1) return fail('Need 1 assist for the extra check');
        myT.assists -= 1;
        fire(ex, opts.extraShooterIdx, ' (extra, −1 AST)');
      }
      myT.score += tot;
      break;
    }
    case 'crash_and_kick': {
      if (myT.rebounds < 3) return fail(`Need 3 rebounds (have ${myT.rebounds})`);
      if (myT.assists < 1) return fail(`Need 1 assist (have ${myT.assists})`);
      myT.rebounds -= 3; myT.assists -= 1;
      g.pendingShotCheck = { teamKey, playerIdx: idx, type: '3pt', bonus: 2 + _assistShotBonus, cardLabel: 'Crash and Kick' };
      addLog(g, teamKey, `Crash and Kick: −3 REB −1 AST → ${player?.name} announces a 3PT check at +2. Opponent may react.`);
      break;
    }
    case 'pick_and_pop': {
      if (!((player?.threePtBoost || 0) > 0)) return fail(`${player?.name} needs a 3PT Bonus`);
      if (myT.assists < 2) return fail(`Need 2 assists (have ${myT.assists})`);
      myT.assists -= 2;
      g.pendingShotCheck = { teamKey, playerIdx: idx, type: '3pt', bonus: 1 + _assistShotBonus, cardLabel: 'Pick-and-Pop', onHitAst: 2 };
      addLog(g, teamKey, `Pick-and-Pop: −2 AST → ${player?.name} announces a 3PT check at +1 (hit = +2 AST back). Opponent may react.`);
      break;
    }
    case 'extra_pass': {
      if (myT.assists < 2) return fail(`Need 2 assists (have ${myT.assists})`);
      const kind = opts.checkType === 'paint' ? 'paint' : '3pt';
      myT.assists -= 2;
      // "Shot check bonuses from other strategy cards are negated": the
      // assist-boost option is not offered and the bonus is exactly 0.
      g.pendingShotCheck = { teamKey, playerIdx: idx, type: kind, bonus: 0, cardLabel: 'Extra Pass', noCardBonus: true };
      addLog(g, teamKey, `Extra Pass: −2 AST → ${player?.name} announces a ${kind === 'paint' ? 'Paint' : '3PT'} check (no card bonuses). Opponent may react.`);
      break;
    }
    case 'lob_city': {
      const has15 = myT.starters.some(p => p && ((p.speed || 0) >= 15 || (p.power || 0) >= 15));
      if (!has15) return fail('Need a player with Speed or Power 15+');
      const others = myT.hand.filter(id => id !== 'lob_city');
      if (others.length === 0) return fail('No card to discard');
      const discard = opts.discardId && others.includes(opts.discardId) ? opts.discardId : others[others.length - 1];
      removeFromHand(myT, discard);
      let ast = 0, pts = 0;
      myT.starters.forEach(p => {
        if (!p) return;
        if ((p.speed || 0) >= 15) ast += 1;
        if ((p.power || 0) >= 15) pts += 2;
      });
      myT.assists += ast; myT.score += pts;
      addLog(g, teamKey, `Lob City: discards ${discard.replace(/_/g, ' ')} — +${ast} AST (Speed 15+), +${pts} pts (Power 15+)`);
      break; // the wrapper below removes the card and runs the 5-assist draw
    }
    case 'stretch_five': {
      const isBig = String(player?.pos || '').split(/[-/]/).some(t => t === 'C' || t === 'PF');
      if (!isBig) return fail(`${player?.name} is not a C or PF`);
      const line = (player?.shotLine ?? 18) - (player?.threePtBoost || 0);
      if (line > 14) return fail(`${player?.name} converts threes at ${line}, not 14 or lower`);
      const mate = opts.player2Idx;
      const mateP = myT.starters[mate];
      if (mateP === undefined || mate === idx) return fail('Choose a teammate for the paint check');
      const r1 = _shotCheck(player, '3pt', 0, ps);
      recordShot(g, teamKey, player?.id, '3pt', r1.hit);
      trackShotCheck(g, teamKey, r1, '3pt', idx);
      const ps2 = getPS(g, teamKey, mateP.id) || {};
      const r2 = shotCheck(mateP, 'paint', 2 - matchupContest(g, teamKey, mate, 'paint'), ps2);
      trackShotCheck(g, teamKey, r2, 'paint', mate);
      myT.score += r1.pts + r2.pts;
      addLog(g, teamKey, `Stretch Five: ${player?.name} 3PT ${scStr(r1)}; ${mateP.name} paint at +2 ${scStr(r2)}`);
      break;
    }
    case 'post_domination': {
      const bigs = myT.starters.filter(p => p && (p.power || 0) >= 15).length;
      if (bigs < 2) return fail(`Need two players at Power 15+ (have ${bigs})`);
      if ((player?.power || 0) < 15) return fail(`${player?.name} is not Power 15+`);
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['reb2' + idx] = 1;
      addLog(g, teamKey, `Post Domination: ${player?.name}'s rebounds are doubled this period`);
      break;
    }
    case 'unsung_hero': {
      if ((player?.salary || 0) > 400) return fail(`${player?.name} must be $400 or less`);
      if ((g.rollResults[teamKey] || [])[idx] != null) return fail(`${player?.name} has already rolled this segment.`);
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['adv' + idx] = 1;
      addLog(g, teamKey, `Unsung Hero: ${player?.name} rolls two dice and keeps the higher this period`);
      break;
    }
    case 'transition_outlet': {
      if (myT.rebounds < 1 || myT.assists < 1) return fail('Need 1 rebound and 1 assist to spend');
      if (adv.speedAdv <= 0) return fail(`${player?.name} needs a Speed advantage`);
      const kind = opts.checkType === 'paint' ? 'paint' : '3pt';
      myT.rebounds -= 1; myT.assists -= 1;
      g.pendingShotCheck = { teamKey, playerIdx: idx, type: kind, bonus: 2 + _assistShotBonus, cardLabel: 'Transition Outlet', onHitAst: 1 };
      addLog(g, teamKey, `Transition Outlet: −1 REB −1 AST → ${player?.name} announces a ${kind === 'paint' ? 'Paint' : '3PT'} check at +2 (hit = +1 AST). Opponent may react.`);
      break;
    }
    case 'find_the_open_man': {
      const dt = g.lastDoubleTeam;
      if (!dt || dt.teamKey === teamKey) return fail('The opponent has no Double Team on the floor');
      if (idx === dt.targetIdx) return fail(`${player?.name} is the one being trapped — pick the open man`);
      if ((g.rollResults[teamKey] || [])[idx] != null) return fail(`${player?.name} has already rolled this segment.`);
      if (!g.tempEff[teamKey]) g.tempEff[teamKey] = {};
      g.tempEff[teamKey]['r' + idx] = (g.tempEff[teamKey]['r' + idx] || 0) + 4;
      g.lastDoubleTeam = null;
      addLog(g, teamKey, `Find the Open Man: ${oppT.starters[dt.targetIdx]?.name} is trapped — ${player?.name} +4 roll`);
      break;
    }
    case 'putback_specialist': {
      const miss = g.lastCheckMiss;
      if (!miss || miss.teamKey !== teamKey || miss.claimed) return fail('Your player must have just missed a shot check');
      if (myT.rebounds < 2) return fail(`Need 2 rebounds (have ${myT.rebounds})`);
      myT.rebounds -= 2;
      miss.claimed = true;
      g.pendingShotCheck = { teamKey, playerIdx: idx, type: 'paint', bonus: 3 + _assistShotBonus, cardLabel: 'Putback Specialist' };
      addLog(g, teamKey, `Putback Specialist: −2 REB → ${player?.name} announces a Paint check at +3. Opponent may react.`);
      break;
    }
    case 'rim_protector': case 'drop_coverage': case 'smothering_defense': case 'denial': case 'hustle_play': {
      const psc = g.pendingShotCheck;
      if (!psc) return fail('No shot check in progress');
      if (psc.teamKey === teamKey) return fail('Can only answer the opponent\'s shot checks');
      if (psc.reacted) return fail('This shot check has already been answered');
      if (psc.type === 'ft') return fail('A free throw cannot be contested');
      const shooter = oppT.starters[psc.playerIdx];
      const guardIdx = (g.offMatchups[psc.teamKey] || [])[psc.playerIdx];
      const guard = myT.starters[guardIdx];
      const shooterName = shooter?.name || 'the shooter';
      if (cardId === 'rim_protector') {
        if (psc.type !== 'paint') return fail('Rim Protector answers a Paint check');
        if (!guard || (guard.power || 0) + (guard.defBoost || 0) < 15) return fail('Your defender on the shooter needs Power + Defensive Bonus of 15');
        psc.contest = (psc.contest || 0) - 4;
        psc.rimProtector = teamKey;
        addLog(g, teamKey, `Rim Protector: ${guard.name} meets ${shooterName} at the rim — check −4, a miss is +2 REB`);
      } else if (cardId === 'drop_coverage') {
        if (psc.type !== 'paint') return fail('Drop Coverage answers a Paint check');
        if (!guard || (guard.defBoost || 0) <= 0) return fail('Your defender on the shooter needs a Defensive Bonus');
        psc.contest = (psc.contest || 0) - 2;
        addLog(g, teamKey, `Drop Coverage: ${guard.name} drops on ${shooterName} — check −2`);
      } else if (cardId === 'smothering_defense') {
        if (!guard || (guard.defBoost || 0) <= 0) return fail('Your defender on the shooter needs a Defensive Bonus');
        psc.smother = 3;
        addLog(g, teamKey, `Smothering Defense: ${guard.name} smothers ${shooterName} — the check's card bonus −3 (min 0)`);
      } else if (cardId === 'denial') {
        const others = myT.hand.filter(id => id !== 'denial');
        if (others.length === 0) return fail('No card to discard');
        const discard = opts.discardId && others.includes(opts.discardId) ? opts.discardId : others[others.length - 1];
        removeFromHand(myT, discard);
        psc.denial = true;
        addLog(g, teamKey, `Denial: discards ${discard.replace(/_/g, ' ')} — ${shooterName}'s team loses 2 AST, or the check is at −3`);
      } else {
        if ((shooter?.salary || 0) <= 800) return fail('Hustle Play answers a shooter paid above $800');
        const cheap = myT.starters
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => p && (p.salary || 0) < 400 && (p.defBoost || 0) > 0);
        if (cheap.length === 0) return fail('Need a player under $400 with a Defensive Bonus');
        const pick = (opts.playerIdx !== undefined && cheap.some(c => c.i === opts.playerIdx))
          ? cheap.find(c => c.i === opts.playerIdx)
          : cheap.reduce((b, c) => ((c.p.defBoost || 0) > (b.p.defBoost || 0) ? c : b), cheap[0]);
        psc.contest = (psc.contest || 0) - (pick.p.defBoost || 0);
        addLog(g, teamKey, `Hustle Play: ${pick.p.name} ($${pick.p.salary}) contests ${shooterName} — check −${pick.p.defBoost}`);
      }
      psc.reacted = teamKey;
      break;
    }
    case 'help_defender': {
      // HELP DEFENCE, NOT A SWITCH. Nobody's assignment changes — the snake's
      // pairing stands (see the placement rule in ai.js). A second defender
      // rotates over for one possession, and the man he left is open, which
      // is what help defence actually costs. The user approved this shape
      // 2026-09-07 over the docx draft, which could never fire: it asked for
      // "a teammate not yet matched up" and the snake matches all five.
      const targets = helpTargets(g, teamKey);
      if (!targets.length) return fail('No opponent yet to roll is beating his defender by +4');
      const pick = targets.find(t => t.offSlot === opts.targetIdx) ?? targets[0];
      const helpOppKey = teamKey === 'A' ? 'B' : 'A';
      const guards = g.offMatchups[helpOppKey] || [];
      const helper = opts.helperIdx;
      if (helper === undefined || helper === null) return fail('Choose which defender rotates over');
      if (helper === pick.defIdx) return fail(`${pick.def?.name} is already guarding him — pick another defender`);
      const helpMan = myT.starters[helper];
      if (!helpMan) return fail('No such defender');
      // The attacker loses his edge: the same flag Defensive Anchor sets.
      if (!g.tempDefEff) g.tempDefEff = {};
      if (!g.tempDefEff[teamKey]) g.tempDefEff[teamKey] = {};
      const cur = g.tempDefEff[teamKey][pick.defIdx] || { speedBoost: 0, powerBoost: 0 };
      g.tempDefEff[teamKey][pick.defIdx] = { ...cur, anchor: true };
      // And the helper's own man is open: the same +3 Double Team pays, but
      // aimed at a player the DEFENCE chose rather than one the offence picks.
      const openSlot = guards.indexOf(helper);
      if (!g.tempEff[helpOppKey]) g.tempEff[helpOppKey] = {};
      let openName = 'nobody';
      if (openSlot >= 0) {
        g.tempEff[helpOppKey]['r' + openSlot] = (g.tempEff[helpOppKey]['r' + openSlot] || 0) + 3;
        openName = oppT.starters[openSlot]?.name ?? 'his man';
      }
      addLog(g, teamKey, `Help Defender: ${helpMan.name} rotates onto ${pick.off?.name} (+${pick.adv} edge gone) — ${openName} is open, +3 on his next roll`);
      break;
    }

    case 'glass_cleaner': {
      const miss = g.lastCheckMiss;
      if (!miss || miss.teamKey === teamKey || miss.claimed) return fail('The opponent must have just missed a shot check');
      miss.claimed = true;
      let gain = 2;
      const shooter = miss.playerIdx != null ? oppT.starters[miss.playerIdx] : null;
      const guard = shooter ? myT.starters[(g.offMatchups[miss.teamKey] || [])[miss.playerIdx]] : null;
      if (shooter && guard && (guard.power || 0) > (shooter.power || 0)) gain += 1;
      myT.rebounds += gain;
      addLog(g, teamKey, `Glass Cleaner: ${shooter ? shooter.name + ' misses — ' : ''}+${gain} REB${gain === 3 ? ` (${guard.name} out-muscles him)` : ''}`);
      break;
    }
    case 'box_out': {
      const lr = g.lastRoll;
      if (!lr || lr.teamKey === teamKey || lr.boxed || !(lr.reb > 0)) return fail('The opponent must have just won rebounds on a scoring roll');
      const roller = oppT.starters[lr.idx];
      const guard = myT.starters[(g.offMatchups[lr.teamKey] || [])[lr.idx]];
      let take = lr.reb;
      if (roller && guard && (guard.power || 0) > (roller.power || 0)) take += 1;
      const before = oppT.rebounds;
      oppT.rebounds = Math.max(0, oppT.rebounds - take);
      lr.boxed = true;
      addLog(g, teamKey, `Box Out: ${guard?.name || 'your defender'} boxes out ${roller?.name || 'the roller'} — ${before - oppT.rebounds} REB cancelled`);
      break;
    }

    default:
      addLog(g, teamKey, `${s?.name || cardId}: played — see card text`);
      break;
  }

  // Remove card from hand (cards that return early have already removed)
  removeFromHand(myT, cardId);

  // Analytics: count cards played
  if (g.analytics?.[teamKey]) g.analytics[teamKey].cardsPlayed++;

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

  // The card's own bonus first (Smothering Defense trims it, never below 0),
  // then the defence's answers, then the passive matchup contest.
  let bonus = psc.bonus || 0;
  if (psc.smother) bonus = Math.max(0, bonus - psc.smother);
  if (psc.closeOutBonus) bonus += psc.closeOutBonus;
  if (psc.contest) bonus += psc.contest;
  if (psc.denial) {
    if (myT.assists >= 2) { myT.assists -= 2; g.log = [...g.log, { team: psc.teamKey, msg: `Denial: ${myT.name} loses 2 AST` }]; }
    else { bonus -= 3; g.log = [...g.log, { team: psc.teamKey, msg: `Denial: fewer than 2 AST to lose — the check is at −3` }]; }
  }
  bonus -= matchupContest(g, psc.teamKey, psc.playerIdx, psc.type);
  const hitAst = psc.onHitAst ?? (psc.onHit === 'ast' ? 1 : 0);

  const r = shotCheck(player, psc.type, bonus, ps);
  recordShot(g, psc.teamKey, player?.id, psc.type, r.hit);
  trackShotCheck(g, psc.teamKey, r, psc.type, psc.playerIdx);

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
    if (hitAst) {
      myT.assists += hitAst;
      if (g.analytics?.[psc.teamKey]) g.analytics[psc.teamKey].assistsFromCards += hitAst;
    }
  } else if (psc.rimProtector) {
    getTeam(g, psc.rimProtector).rebounds += 2;
  }

  const label = psc.cardLabel || psc.type.toUpperCase();
  let msg = `${label}: ${scStr(r)}`;
  if (psc.closeOutBonus && !r.hit) {
    ps.cold = (ps.cold || 0) + 1;
    msg += ' — Close Out! Miss → ❄️ cold marker';
  }
  if (r.hit && hitAst) msg += ` +${hitAst} AST`;
  if (!r.hit && psc.rimProtector) msg += ' — Rim Protector! +2 REB for the defence';

  g.log = [...g.log, { team: psc.teamKey, msg }];

  // Track for Coach's Challenge
  g.lastShotCheck = {
    teamKey: psc.teamKey, playerIdx: psc.playerIdx, playerId: player?.id,
    type: psc.type, result: r, pts: r.pts, cardLabel: label,
    bonus: bonus, specialRoll: psc.specialRoll, onHit: psc.onHit,
    closeOutApplied: !!psc.closeOutBonus,
  };

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
