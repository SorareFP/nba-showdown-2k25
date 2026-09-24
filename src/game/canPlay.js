// NBA Showdown 2026 — Card playability rules
// Returns { canPlay: bool, reason: string }

import { CRUNCH_CARDS, TIMEOUT_RIDERS } from './strats.js';
import { getTeam, getOpp, getPS, getFatigue, calcAdv, burnedSlots, satOutLast } from './engine.js';

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
/**
 * STAGGER ACTION'S PAIR: one player with Speed 13+ and a DIFFERENT player
 * with a POSITIVE 3PT Bonus. The engine used to check only the speed and
 * the coach fell back to anyone at all, so Amen Thompson and Jalen Brunson
 * (negative 3PT) were staggered as "shooters" (the user, 2026-09-09).
 * Returns `{ fast, shooter }` slot indexes, or null.
 */
export function staggerPair(starters) {
  const list = starters || [];
  for (let i = 0; i < list.length; i += 1) {
    if (!list[i] || (list[i].speed || 0) < 13) continue;
    for (let j = 0; j < list.length; j += 1) {
      if (j === i || !list[j] || (list[j].threePtBoost || 0) <= 0) continue;
      return { fast: i, shooter: j };
    }
  }
  return null;
}

/**
 * FOUL TROUBLE — the opposing DEFENDERS worth attacking until they foul.
 *
 * A foul is what a beaten defender gives up, so the condition is the mismatch
 * itself: one of your players beating the man guarding him by 4 or more on
 * Speed or Power, the same bar Help Defender and Mismatch Hunter use. Read
 * through calcAdv, never off the printed numbers, so Defense and card effects
 * count (the eligibility rule, 2026-09-10).
 *
 * Returned as { slot, off, def, defIdx, adv } so the picker, the coach and the
 * engine all agree on who is eligible.
 */
export function foulTroubleTargets(g, teamKey) {
  const myT = getTeam(g, teamKey);
  const oppT = getOpp(g, teamKey);
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const guards = g.offMatchups?.[teamKey] || [];
  const already = new Set(g.foulTrouble?.[oppKey] || []);
  const out = [];
  (myT?.starters || []).forEach((off, slot) => {
    if (!off) return;
    const defIdx = guards[slot] ?? slot;
    const def = oppT?.starters?.[defIdx];
    if (!def || already.has(def.id)) return;
    const a = calcAdv(off, def, g.tempEff?.[teamKey] || {}, slot);
    const adv = Math.max(a.speedAdv, a.powerAdv);
    if (adv >= 4) out.push({ slot, off, def, defIdx, adv });
  });
  return out;
}

/**
 * CLAMP THE RESERVE's targets (2026-09-23): the OPPONENT's starters at $400
 * or less who are still to roll — Unsung Hero's door, on the other side.
 * The one list the playability check, the board's picker, the AI and the
 * engine's refusal all read, so a target offered is a target the engine
 * takes. Returns `{ p, origIdx }` in the opponent's slot order.
 */
export function clampTargets(g, teamKey) {
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const oppT = getTeam(g, oppKey);
  const rolls = g.rollResults?.[oppKey] || [];
  return (oppT?.starters || [])
    .map((p, origIdx) => ({ p, origIdx }))
    .filter(({ p, origIdx }) => p && rolls[origIdx] == null && (p.salary || 0) <= 400);
}

/**
 * THE GLASS CARDS' SHARED READS (2026-09-23). One list each, read by the
 * playability check, the board's picker, the coach and the engine's refusal,
 * so a player offered is a player the engine takes.
 *
 * kickOutTargets — Kick-Out Three: your own last check just missed (and no
 * card has claimed the board); a teammate OTHER than that shooter with a 3PT
 * Bonus of +1 or more. `{ p, origIdx }` in your slot order.
 */
export function kickOutTargets(g, teamKey) {
  const miss = g.lastCheckMiss;
  if (!miss || miss.teamKey !== teamKey || miss.claimed) return [];
  return (getTeam(g, teamKey)?.starters || [])
    .map((p, origIdx) => ({ p, origIdx }))
    .filter(({ p, origIdx }) => p && origIdx !== miss.playerIdx && (p.threePtBoost || 0) >= 1);
}

/** Rebound and Push — the slot of YOUR defender on the opponent who just missed, or null. */
export function pushGuardIdx(g, teamKey) {
  const miss = g.lastCheckMiss;
  if (!miss || miss.teamKey === teamKey || miss.claimed || miss.playerIdx == null) return null;
  const gi = (g.offMatchups?.[miss.teamKey] || [])[miss.playerIdx];
  return gi != null && getTeam(g, teamKey)?.starters?.[gi] ? gi : null;
}

/** Own the Glass — the lead on the Rebound Track it needs (the banks' difference, as the track shows it). */
export const OWN_THE_GLASS_LEAD = 6;

export function preRollTargets(g, teamKey, cond = () => true) {
  const rolls = g.rollResults?.[teamKey] || [];
  const blocked = g.blockedRolls?.[teamKey] || {};
  return (getTeam(g, teamKey)?.starters || [])
    .map((p, idx) => ({ p, idx }))
    .filter(({ p, idx }) => p && rolls[idx] == null && !blocked[idx] && cond(p, idx));
}

/**
 * HELP DEFENDER — the mismatches worth sending help at.
 *
 * An opposing attacker who has not rolled and is beating the defender the
 * placement snake gave him by +4 or more on Speed or Power. Returned as
 * `{ offSlot, off, def, defIdx, adv }` so the picker and the engine agree on
 * who is eligible, the pattern every other conditional card here follows.
 */
/**
 * BURST OF MOMENTUM'S PLAYERS: a top-tier roll of 3+ points this segment, and
 * no Burst yet this section. ONCE PER PLAYER PER SECTION (the user,
 * 2026-09-24: "Burst of Momentum should only be able to be applied once per
 * player per section"). Who has had one is kept by player id in tempEff,
 * which the engine clears at section end. Slot indices, like the others here,
 * so the picker, the engine and the coach agree.
 */
export function burstTargets(g, teamKey) {
  const rolls = g.rollResults?.[teamKey] || [];
  const starters = getTeam(g, teamKey)?.starters || [];
  const had = new Set(g.tempEff?.[teamKey]?.burstIds || []);
  const out = [];
  starters.forEach((p, i) => {
    if (rolls[i]?.isTop && (rolls[i]?.pts || 0) >= 3 && !had.has(p?.id)) out.push(i);
  });
  return out;
}

export function helpTargets(g, teamKey) {
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const myT = getTeam(g, teamKey);
  const oppT = getOpp(g, teamKey);
  const rolls = g.rollResults?.[oppKey] || [];
  const guards = g.offMatchups?.[oppKey] || [];
  const out = [];
  (oppT?.starters || []).forEach((off, offSlot) => {
    if (!off || rolls[offSlot] != null) return;
    if (g.blockedRolls?.[oppKey]?.[offSlot]) return;
    const defIdx = guards[offSlot];
    const def = myT?.starters?.[defIdx];
    if (!def) return;
    const a = calcAdv(off, def, g.tempEff?.[oppKey] || {}, offSlot);
    const adv = Math.max(a.speedAdv, a.powerAdv);
    if (adv >= 4) out.push({ offSlot, off, def, defIdx, adv });
  });
  return out;
}

/**
 * DOES THE DEFENDER ON THIS SLOT OWN IT? He out-speeds AND out-powers the
 * attacker, measured the way every roll measures a matchup — calcAdv, with
 * the same effects the roll passes: a NEGATIVE Defense lowers the defender's
 * Speed and Power, a positive one does not make him bigger, and active card
 * effects count on both sides (an attacker's boost, a Defensive Stopper).
 * Strictly higher on both: a tie is not "higher".
 *
 * The user, 2026-09-10: Kyrie Irving (S16/P5, Defense -1) shut out Isaiah Joe
 * (S13/P4) — "after Irving's defense -1, their power are equal". The raw
 * printed numbers were being compared.
 *
 * Returns `{ offSlot, off, def, defIdx, defSpeed, defPower }` — the defender's
 * numbers as he guards — or null. The one test the picker, the engine and the
 * coach all ask.
 */
export function myHouseHolds(g, teamKey, offSlot) {
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const off = getOpp(g, teamKey)?.starters?.[offSlot];
  const defIdx = (g.offMatchups?.[oppKey] || [])[offSlot];
  const def = getTeam(g, teamKey)?.starters?.[defIdx];
  if (!off || !def) return null;
  const eff = g.tempEff?.[oppKey] || {};
  const a = calcAdv(off, def, eff, offSlot, g.tempDefEff?.[teamKey] ?? null, defIdx);
  if (!(a.rawSpeedDiff < 0 && a.rawPowerDiff < 0)) return null;
  // The defender's guarding numbers, recovered from the same two differences.
  const defSpeed = off.speed + (eff['s' + offSlot] || 0) - a.rawSpeedDiff;
  const defPower = off.power + (eff['p' + offSlot] || 0) - a.rawPowerDiff;
  return { offSlot, off, def, defIdx, defSpeed, defPower };
}

export function myHouseTargets(g, teamKey) {
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const oppRolls = g.rollResults?.[oppKey] || [];
  return (getOpp(g, teamKey)?.starters || [])
    .map((off, offSlot) => (off && oppRolls[offSlot] == null ? myHouseHolds(g, teamKey, offSlot) : null))
    .filter(Boolean);
}

// The cards that answer an ANNOUNCED shot check (g.pendingShotCheck). One
// answer per check: the first reaction marks it `reacted`.
export const SHOT_REACTIONS = ['close_out', 'rim_protector', 'drop_coverage', 'smothering_defense', 'denial', 'hustle_play'];

/**
 * DOES THE DEFENCE ACTUALLY HOLD AN ANSWER TO THIS CHECK?
 *
 * The user's rule (2026-09-07): "Every card that cues a shot check of any sort
 * would be 'announcing' one. The game should only stop if there's an
 * oppositional card in the other player's hand that can be played." So every
 * check is announced, and this is the question that decides whether announcing
 * it costs anybody a click. A free throw can never be contested and never
 * pauses.
 *
 * Asked of the REAL hand and the REAL check, through canPlayCard itself, so a
 * card whose own conditions fail (Rim Protector without the power, Denial with
 * nothing to discard) does not stop the game for a window it cannot use.
 */
export function canAnswerCheck(g, check) {
  if (!check || check.type === 'ft') return false;
  const defKey = check.teamKey === 'A' ? 'B' : 'A';
  const hand = getTeam(g, defKey)?.hand ?? [];
  if (!hand.length) return false;
  const probe = { ...g, pendingShotCheck: check };
  return SHOT_REACTIONS.some(id => hand.includes(id) && canPlayCard(probe, defKey, id).canPlay);
}

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

/**
 * WHAT A CARD SPENDS FROM THE REBOUND BANK — every card that spends
 * rebounds, and the one table the lead rule below and the coach's reserve
 * (ai.js) read.
 */
export const REBOUND_CARD_COST = Object.freeze({
  offensive_board: 3, rebound_tap_out: 2, crash_and_kick: 3, transition_outlet: 1, putback_specialist: 2,
  kick_out_three: 2, grab_and_go: 3, rebound_and_push: 2, own_the_glass: 5,
});

/** How far `teamKey` leads the rebound battle (the Rebound Track): negative when it trails. */
export const reboundLead = (g, teamKey) =>
  (getTeam(g, teamKey)?.rebounds ?? 0) - (getOpp(g, teamKey)?.rebounds ?? 0);

/**
 * A CARD THAT SPENDS REBOUNDS NEEDS THE LEAD TO PAY FOR THEM (2026-09-24). The
 * user: "For cards that use rebounds, the player using it should need to LEAD
 * the rebounding battle by the cost it takes to play it. It shouldn't just
 * give unearned rebounds to the other team." The track is the difference of
 * the two banks, so a spend from a thin lead handed the lead — and its +1
 * assist and +2 check at the section's end — to a side that won nothing. With
 * the lead at least the cost, a spend leaves you ahead or level. The engine
 * refuses the same card (execCard.js). The 5-REB rebound paint check is not a
 * card and keeps its own rule (REBOUND_RULES). Null when the card may spend.
 */
export function reboundLeadProblem(g, teamKey, cardId) {
  const cost = REBOUND_CARD_COST[cardId];
  if (!cost) return null;
  const lead = reboundLead(g, teamKey);
  if (lead >= cost) return null;
  return `Lead the rebound battle by ${cost} to spend ${cost} REB (you ${lead > 0 ? `lead by ${lead}` : lead < 0 ? `trail by ${-lead}` : 'are level'})`;
}

export function canPlayCard(g, teamKey, cardId) {
  // The card's own conditions first (a wrong phase says so), then the lead.
  const verdict = cardVerdict(g, teamKey, cardId);
  if (!verdict.canPlay) return verdict;
  const lead = reboundLeadProblem(g, teamKey, cardId);
  return lead ? no(lead) : verdict;
}

function cardVerdict(g, teamKey, cardId) {
  const myT = getTeam(g, teamKey);
  const oppT = getOpp(g, teamKey);
  const phase = g.phase;

  if (phase === 'draft') return no('Cannot play cards during draft');

  // While a shot check is pending, only Close Out is allowed
  if (g.pendingShotCheck && !SHOT_REACTIONS.includes(cardId)) return no('Resolve pending shot check first');
  if (SHOT_REACTIONS.includes(cardId) && cardId !== 'close_out') return shotReaction(g, teamKey, cardId);

  // ── MATCHUP PHASE ──────────────────────────────────────────────────────
  if (['high_screen_roll','stagger_action','second_wind','chip_on_shoulder','defensive_stopper','pick_up_full_court',
    'spain_pick_roll','mismatch_hunter','strength_in_numbers','energizer','defensive_identity','defensive_anchor','swarming_defense',
    'short_roll_playmaker','pick_and_roll_maestro'].includes(cardId)) {
    if (phase !== 'matchup_strats') return no('Only playable during Matchup Strategy Phase');
    if (g.matchupTurn !== teamKey) return no("It's not your turn");
    const advOf = (p, i) => {
      const dp = oppT.starters[(g.offMatchups[teamKey] || [])[i] ?? i];
      return dp ? calcAdv(p, dp, g.tempEff[teamKey] || {}, i) : null;
    };
    if (cardId === 'short_roll_playmaker') {
      const eligible = myT.starters.filter(p => p && (p.speed || 0) >= 8 && (p.power || 0) >= 8);
      if (!eligible.length) return no('Need a player with Speed 8+ and Power 8+ on the floor');
      return ok('One player adds an assist on every paint score this period');
    }
    if (cardId === 'pick_and_roll_maestro') {
      if (!myT.starters.some(p => p && (p.speed || 0) >= 14)) return no('Need a player at Speed 14+ on the floor');
      return ok('Switch a Speed 14+ player onto a slower defender');
    }
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
      if (!myT.starters.some(p => (p?.defBoost || 0) >= 1)) return no('Need a defender with a Defensive Bonus');
      return ok('Their Defensive Bonus counts double this section');
    }
    if (cardId === 'swarming_defense') return ok('Their highest-paid player may roll twice, keep lower');

    if (cardId === 'high_screen_roll') return ok('Swap which defenders guard your players');

    if (cardId === 'pick_up_full_court') return ok('Hound one opposing player: −1 roll + 4 minutes of fatigue');

    if (cardId === 'stagger_action') {
      if (!staggerPair(myT.starters)) return no('Need a Speed 13+ player and a different player with a positive 3PT Bonus');
      return ok('Both gain +2 Speed this segment');
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
      // A starter who SAT OUT last segment — the flag the engine writes at
      // every section end, not "zero minutes", which halftime hands to all.
      if (!myT.starters.some(p => satOutLast(g, teamKey, p))) return no('Need a starter who was benched last segment');
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
  if (CRUNCH_CARDS.includes(cardId)) {
    if (!g.crunch?.active) return no('Crunch Time only — final section, close game');
    if (cardId === 'unethical_hoops') {
      const some = myT.starters.some((p, i) => {
        const dp = oppT.starters[(g.offMatchups[teamKey] || [])[i] ?? i];
        const a = p && dp && calcAdv(p, dp, g.tempEff?.[teamKey] || {}, i);
        return a && (a.speedAdv > 0 || a.powerAdv > 0);
      });
      if (!some) return no('Need a player with a Speed or Power advantage');
      // Four PLAIN free throws (the user, 2026-09-21: no boost on free-throw
      // checks); this line had said "two ... at +4" since the card was two.
      return ok('Draw the foul — four free throws');
    }
    if (cardId === 'desperation_press') {
      if (myT.score >= oppT.score) return no('Only playable while trailing');
      return ok('Their next top-tier roll must be re-rolled');
    }
    if (cardId === 'second_closer') {
      if ((g.crunch.extra?.[teamKey] || 0) >= 1) return no('One Second Closer per game');
      return ok('A second Clutch Possession, for a different player');
    }
    if (cardId === 'hack_a') {
      // Anyone who has yet to roll: the foul happens before he can go to work.
      if (preRollTargets(g, teamKey === 'A' ? 'B' : 'A').length === 0) return no('Every opponent has already rolled');
      return ok('Foul an opponent: no scoring roll, four free throws instead');
    }
    // The timeout riders (strats.js TIMEOUT_RIDERS): only during YOUR called timeout.
    if (TIMEOUT_RIDERS.includes(cardId) && g.timeoutActive !== teamKey) return no('Play during your Timeout');
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
    if (g.tempEff?.[teamKey]?.doubleTeamUsed) return no('Double Team is once per section');
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
    // A SLOT key only: 'p0'..'p4'. startsWith('p') also caught 'paintAst0',
    // the facilitator's assist counter, which is not a Power boost at all.
    const hasPowerBoost = Object.keys(oppEff).some(k => /^p[0-9]+$/.test(k) && oppEff[k] > 0);
    if (!hasPowerBoost) return no('Opponent must have played a card that boosts Power first');
    return ok('Halve opponent\'s Power boost, −1 Rebound');
  }

  if (cardId === 'beat_to_the_spot') {
    if (phase !== 'scoring' && phase !== 'matchup_strats') return no('Only playable during Matchup or Scoring Phase');
    // The Speed twin of Offensive Foul: the defender wins the drive with his
    // feet, so the burst a card just bought is cut in half.
    const oppKey = teamKey === 'A' ? 'B' : 'A';
    const oppEff = g.tempEff[oppKey] || {};
    const hasSpeedBoost = Object.keys(oppEff).some(k => /^s[0-9]+$/.test(k) && oppEff[k] > 0);
    if (!hasSpeedBoost) return no('Opponent must have played a card that boosts Speed first');
    return ok('Halve their Speed boost, −1 Assist');
  }

  if (cardId === 'foul_trouble') {
    if (phase !== 'matchup_strats' && phase !== 'scoring') return no('Only playable during Matchup or Scoring Phase');
    // A card that benches a man NEXT section needs a next section. Overtime
    // would give it one, but nobody knows that yet when the card is played.
    if (g.quarter === 4 && g.section === 3) return no('No section left for them to sit out');
    if ((oppT.roster || []).length < 6) return no('The opponent has no bench — nobody to replace them');
    const ft = foulTroubleTargets(g, teamKey);
    if (!ft.length) return no('Need one of your players beating their defender by 4+ on Speed or Power');
    return ok('Send a beaten defender to the bench for the whole next section');
  }

  if (cardId === 'switch_the_screen') {
    if (phase !== 'matchup_strats' && phase !== 'scoring') return no('Only playable during Matchup or Scoring Phase');
    // THE DEFENCE INITIATING A SWITCH. Until this card the only one was Switch
    // Everything, a rare — which left Overhelp and Burned on the Switch, both
    // offensive answers to a defensive switch, with almost nothing to answer
    // (the user, 2026-09-12).
    if ((oppT.starters || []).filter(Boolean).length < 2) return no('Need two opposing players to switch between');
    return ok('Swap the defenders on two opposing players');
  }

  if (cardId === 'verticality') {
    if (phase !== 'scoring' && phase !== 'matchup_strats') return no('Only playable during Matchup or Scoring Phase');
    const auto = g.lastAutoScore;
    if (!auto) return no('Play right after an opponent card scores with no roll and no check');
    if (auto.teamKey === teamKey) return no('Can only answer the opponent');
    const vdIdx = (g.offMatchups[auto.teamKey] || [])[auto.playerIdx] ?? auto.playerIdx;
    const vdef = (myT.starters || [])[vdIdx];
    if (!vdef) return no('No defender on that player');
    const vscorer = (oppT.starters || [])[auto.playerIdx];
    const stands = (vdef.defBoost || 0) > 0 || (vdef.power || 0) >= (vscorer?.power || 0);
    if (!stands) return no(vdef.name + ' needs a Defensive Bonus, or the Power to stand them up');
    return ok('Wipe the ' + auto.pts + ' points that card took for free');
  }

  if (cardId === 'dogged') {
    // A FATIGUED opponent, at any depth (2026-09-17, the user: "Dogged still
    // seems to be able to be played on players with minutes, not players who
    // are currently fatigued"). The penalty is the door — −2 at eight minutes
    // counts as much as −12 — not the tracker's minutes.
    if (phase !== 'scoring' && phase !== 'matchup_strats') return no('Only playable during Matchup or Scoring Phase');
    const oppKey = teamKey === 'A' ? 'B' : 'A';
    const anyTired = oppT.starters.some((p, i) => p && getFatigue(g, oppKey, i) < 0);
    if (!anyTired) return no('No fatigued opponent on the floor');
    return ok('Target a fatigued opponent for −2 Spd/Pwr until benched');
  }

  if (cardId === 'coaches_challenge') {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');
    const used = g.challengesUsed?.[teamKey] || 0;
    if (used >= 2) return no("Already used 2 Coach's Challenges this game");
    if (!g.lastShotCheck) return no('No recent shot check to challenge');
    if (g.lastShotCheck.teamKey === teamKey) return no("Can only challenge opponent's shot checks");
    // Name the target, so nobody challenges a check they did not mean to
    // (the user, 2026-09-18, whose Challenge hit an older Bully Ball miss).
    const lsc = g.lastShotCheck;
    const who = getOpp(g, teamKey)?.starters?.[lsc.playerIdx]?.name;
    return ok(`Re-roll ${who ? `${who}'s ` : ''}${lsc.cardLabel ?? 'last shot check'} (${lsc.result?.hit ? `a make, ${lsc.pts} pts` : 'a miss'})`);
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
    const rolled = (g.rollResults?.[teamKey] || []);
    const owed = g.tempEff?.[teamKey] || {};
    if (!myT.starters.some((p, i) => p && rolled[i] != null && typeof owed['extra_roll_' + i] !== 'number')) return no('Wait until one of your players has rolled');
    return ok('A player who has rolled takes a second scoring roll at −2');
  }

  if (cardId === 'rebound_tap_out') {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');
    if (myT.rebounds < 2) return no(`Need 2 rebounds (have ${myT.rebounds})`);
    if (!myT.starters.some(p => (p.threePtBoost || 0) > 0)) return no('Need a player with a 3PT Bonus in lineup');
    return ok();
  }

  // ── PRE-ROLL ───────────────────────────────────────────────────────────
  if (['ghost_screen','you_stand_over_there','putback_dunk','pin_down_screen','turnover','feeling_it','clamp_the_reserve'].includes(cardId)) {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');

    // Turnover's twin off the hot marker (2026-09-23).
    if (cardId === 'feeling_it') {
      const hasHot = myT.starters.some(p => { const ps = getPS(g, teamKey, p.id); return (ps?.hot || 0) > 0; });
      if (!hasHot) return no('One of your players needs a hot marker');
      return ok('Draw 2 strategy cards');
    }
    // Unsung Hero's defensive mirror (2026-09-23): the same shared list the
    // board's picker, the AI and the engine's refusal read.
    if (cardId === 'clamp_the_reserve') {
      if (clampTargets(g, teamKey).length === 0) return no('Need an opposing $400-or-less player still to roll');
      return ok('They roll two dice and keep the lower');
    }

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
      // ONCE PER SECTION (2026-09-18, the user: "Putback dunk should only be
      // able to be played once a section") — Double Team's rule and flag
      // shape: a tempEff mark endSection wipes.
      if (g.tempEff?.[teamKey]?.putbackUsed) return no('Putback Dunk is once per section');
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
    // 3+, not 5+ (2026-09-16): a top band pays 1-4 points; 5+ never came.
    const ok2 = (g.rollResults[teamKey] || []).some(r => r?.isTop && (r?.pts || 0) >= 3);
    if (!ok2) return no('Need a player who hit top tier AND scored 3+ pts');
    if (!burstTargets(g, teamKey).length) return no('Burst of Momentum is once per player per section');
    return ok();
  }

  if (cardId === 'flare_screen') {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');
    if (!(g.rollResults[teamKey] || []).some(r => r?.die === 20)) return no('A player must have rolled a natural 20');
    return ok();
  }

  // ── SCORING PHASE ──────────────────────────────────────────────────────
  if (phase !== 'scoring') return no('Only playable during Scoring Phase');

  if (cardId === 'help_defender') {
    if (phase !== 'scoring') return no('Only playable during Scoring Phase');
    if (helpTargets(g, teamKey).length === 0) {
      return no('No opponent yet to roll is beating their defender by +4');
    }
    return ok('Rotate a defender over — they lose their edge, someone else gets +3');
  }
  if (['find_the_open_man', 'putback_specialist', 'glass_cleaner', 'box_out', 'passing_lane', 'kick_out_three', 'rebound_and_push'].includes(cardId)) {
    // The glass cards (2026-09-23): the same missed-check window as Putback
    // Specialist (ours) and Glass Cleaner (theirs); whoever claims it first
    // has the board.
    if (cardId === 'kick_out_three') {
      const miss = g.lastCheckMiss;
      if (!miss || miss.teamKey !== teamKey || miss.claimed) return no('Your player must have just missed a shot check');
      if (myT.rebounds < 2) return no(`Need 2 rebounds (have ${myT.rebounds})`);
      if (!kickOutTargets(g, teamKey).length) return no('Need a teammate other than the shooter with a 3PT Bonus of +1 or more');
      return ok('−2 REB → a 3PT check for a shooter on the kick-out');
    }
    if (cardId === 'rebound_and_push') {
      const miss = g.lastCheckMiss;
      if (!miss || miss.teamKey === teamKey || miss.claimed) return no('The opponent must have just missed a shot check');
      if (myT.rebounds < 2) return no(`Need 2 rebounds (have ${myT.rebounds})`);
      const gi = pushGuardIdx(g, teamKey);
      if (gi == null) return no('None of your defenders is on the shooter');
      return ok(`−2 REB → ${myT.starters[gi]?.name ?? 'your defender'} pushes it: a Paint check at +1`);
    }
    // Box Out's twin for assists (2026-09-23).
    if (cardId === 'passing_lane') {
      const lr = g.lastRoll;
      if (!lr || lr.teamKey === teamKey || lr.deflected || !(lr.ast > 0)) return no('The opponent must have just won assists on a scoring roll');
      return ok(`Cancel their ${lr.ast} AST`);
    }
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
    case 'green_light':
      if (preRollTargets(g, teamKey).length === 0) return no('Everyone has rolled or is shut out');
      return ok('Three 3PT checks instead of the roll');
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
    case 'grab_and_go':
      if (myT.rebounds < 3) return no(`Need 3 rebounds (have ${myT.rebounds})`);
      return ok('−3 REB → +2 AST');
    case 'own_the_glass': {
      const lead = (myT.rebounds || 0) - (oppT.rebounds || 0);
      if (lead < OWN_THE_GLASS_LEAD) return no(`Lead the Rebound Track by ${OWN_THE_GLASS_LEAD} (you are at ${lead >= 0 ? '+' : ''}${lead})`);
      if (myT.rebounds < 5) return no(`Need 5 rebounds (have ${myT.rebounds})`);
      return ok('−5 REB → two Paint checks at +1');
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
    // ── WAVE TWO ────────────────────────────────────────────────────────
    case 'run_the_floor':
    case 'twin_towers': {
      const isFloor = cardId === 'run_the_floor';
      const standing = (g.standing ?? []).find(e => e.teamKey === teamKey && e.cardId === cardId);
      if (standing?.lastSection === `${g.quarter}-${g.section}`) return no('Already run this period');
      if (standing) return ok('Still in play — take the two checks again');
      const qualify = isFloor
        ? myT.starters.filter(p => p && (p.speed || 0) >= 12)
        : myT.starters.filter(p => p && (p.power || 0) >= 14);
      const need = isFloor ? 3 : 2;
      if (qualify.length < need) {
        return no(`Need ${need} players at ${isFloor ? 'Speed 12+' : 'Power 14+'} (have ${qualify.length})`);
      }
      return ok(isFloor
        ? 'Two paint checks at +2, an assist each — and it stays in play'
        : 'Two paint checks at +2, and their paint checks go to −2');
    }
    case 'outside_pick':
      if (myT.hand.filter(id => id !== 'outside_pick').length === 0) return no('No card to discard');
      return ok('A 3PT check at +5 — hit for 3 and an assist');
    case 'inside_out': {
      const ps = g.lastPaintScore;
      if (!ps || ps.teamKey !== teamKey) return no('Play it after one of your players scores in the paint');
      return ok('Kick it out — a teammate takes a free three');
    }
    case 'lob_city':
      if (!myT.starters.some(p => p && ((p.speed || 0) >= 15 || (p.power || 0) >= 15))) return no('Need a player with Speed or Power 15+');
      if (myT.hand.filter(id => id !== 'lob_city').length === 0) return no('No card to discard');
      return ok('Speed 15+ players add an assist, Power 15+ players score 2');
    case 'stretch_five': {
      const big = myT.starters.some(p => p && String(p.pos || '').split(/[-/]/).some(t => t === 'C' || t === 'PF') && ((p.shotLine ?? 18) - (p.threePtBoost || 0)) <= 14);
      if (!big) return no('Need a C or PF who converts threes at 14 or lower');
      return ok('Their 3PT check, then a teammate\'s paint check at +2');
    }
    case 'post_domination': {
      // REWORKED 2026-09-16. The door was two players at Power 15+ on the
      // floor: sixteen such players exist, nearly all $1,000+, and 3.4% of
      // cap-legal tens carry two. Now a MATCHUP door, read the way Bully
      // Ball reads it — through calcAdv, so a Defensive Bonus counts — for a
      // player still to roll, since a doubled rebound is worth nothing after.
      const edge = preRollTargets(g, teamKey, (p, i) => {
        const dp = oppT.starters[(g.offMatchups[teamKey] || [])[i] ?? i];
        return dp && calcAdv(p, dp, g.tempEff[teamKey] || {}, i).powerAdv > 0;
      });
      if (edge.length === 0) return no('Need a player with a Power advantage over his defender, still to roll');
      return ok('Double his rebounds this period');
    }
    case 'unsung_hero':
      if (preRollTargets(g, teamKey, p => (p.salary || 0) <= 400).length === 0) return no('Need a $400-or-less player still to roll');
      return ok('Two dice, keep the higher');
    case 'point_god': {
      // Post Domination's Speed twin (2026-09-23): the same matchup door, read
      // through calcAdv, for a player still to roll.
      const edge = preRollTargets(g, teamKey, (p, i) => {
        const dp = oppT.starters[(g.offMatchups[teamKey] || [])[i] ?? i];
        return dp && calcAdv(p, dp, g.tempEff[teamKey] || {}, i).speedAdv > 0;
      });
      if (edge.length === 0) return no('Need a player with a Speed advantage over his defender, still to roll');
      return ok('Double his assists this period');
    }
    case 'blow_by': {
      // Rimshaker's Speed twin (2026-09-23).
      const hasHot = myT.starters.some(p => { const ps = getPS(g, teamKey, p.id) || {}; return p.speed >= 13 && (ps.hot || 0) > 0; });
      if (!hasHot) return no('Need a Speed 13+ player with a hot marker');
      return ok('+2 pts and another hot marker');
    }
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
    case 'first_step':
      if (preRollTargets(g, teamKey).length === 0) return no('Everyone has rolled');
      return ok('Give a player +2 Speed (or +3 if Speed advantage ≥5)');
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
      return ok('2+ pts this section, rolls or shot checks → hot marker');
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
