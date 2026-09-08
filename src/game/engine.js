// NBA Showdown 2026 — Core Game Engine
// Pure functions — no React, no side effects. State is a plain object.

import { CRUNCH_CARDS } from './strats.js';
import { lookupChart } from './cards.js';
import { getStrat } from './strats.js';

// ── Constants ──────────────────────────────────────────────────────────────
export const CAP = 5500;
export const ROSTER_SIZE = 10;
export const STARTERS = 5;
export const SNAKE = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1]; // 0=A, 1=B

// ── Deck ───────────────────────────────────────────────────────────────────
import { STRATS } from './strats.js';
import { DEFAULT_DECK_COPIES } from './defaultDeckWeights.js';

export function buildDeck(deckConfig) {
  let d = [];
  if (deckConfig && typeof deckConfig === 'object') {
    // Custom deck: { cardId: count }
    for (const [cardId, count] of Object.entries(deckConfig)) {
      for (let i = 0; i < count; i++) d.push(cardId);
    }
  } else if (DEFAULT_DECK_COPIES && Object.keys(DEFAULT_DECK_COPIES).length) {
    // The SIM-LEARNED default: every card at least once, proven value with
    // extras — see defaultDeckWeights.js. The old path truncated STRATS in
    // definition order at fifty copies, which silently made 21 of 43 cards
    // unreachable in any default game (every reaction, every post-roll).
    for (const [cardId, count] of Object.entries(DEFAULT_DECK_COPIES)) {
      for (let i = 0; i < count; i++) d.push(cardId);
    }
  } else {
    // Fallback when no learned weights exist: STRATS copies, untruncated.
    for (const s of STRATS) {
      for (let i = 0; i < (s.copies || 2); i++) d.push(s.id);
    }
  }
  // Shuffle
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export function drawCards(hand, deck, n) {
  const newHand = [...hand];
  const newDeck = [...deck];
  for (let i = 0; i < n; i++) {
    if (newHand.length >= 7) break;
    if (!newDeck.length) break; // deck exhausted
    newHand.push(newDeck.pop());
  }
  return { hand: newHand, deck: newDeck };
}

// ── New Game ───────────────────────────────────────────────────────────────
function makeTeam(roster, name, deckConfig) {
  const builtDeck = buildDeck(deckConfig);
  const { hand, deck } = drawCards([], builtDeck, 7);
  return {
    name,
    roster,
    starters: [],
    score: 0,
    assists: 0,
    rebounds: 0,
    hand,
    deck,
    discard: [],
    stats: roster.map(c => ({
      id: c.id,
      pts: 0, reb: 0, ast: 0,
      minutes: 0,       // fatigue tracker (decremented by rest)
      totalMinutes: 0,   // actual minutes played (never decreases)
      hot: 0, cold: 0,
      threepm: 0, threepa: 0,
      ftm: 0, fta: 0,
      pm: 0,
    })),
  };
}

function emptyAnalytics() {
  return {
    chartPts: 0,
    shotCheckPts: 0,
    assistSpendPts: 0,
    reboundBonusPts: 0,
    freeThrowPts: 0,
    totalShotChecks: 0,
    totalShotCheckHits: 0,
    assistsGenerated: 0,
    assistsFromCards: 0,
    reboundsGenerated: 0,
    cardsPlayed: 0,
  };
}

/** Crunch Time arms in Q4's final section only when the margin is this close. */
export const CRUNCH_MARGIN = 20; // was 10; the user raised it 2026-09-06 after a full game never armed

/**
 * WHEN THIS FILE LAST CHANGED, baked in by vite.config.js at transform time.
 *
 * A copied game log carries it, so a report can say which engine produced
 * it. It exists because of one evening's confusion: a game kept running on
 * the engine it had loaded while hot reload swapped in a newer log panel, and
 * the log looked like proof the new code did nothing.
 */
/* global __ENGINE_STAMP__ */
export const ENGINE_STAMP = typeof __ENGINE_STAMP__ !== 'undefined' ? __ENGINE_STAMP__ : 'unstamped';

export function newGame(rosterA, rosterB, deckConfigA, deckConfigB, opts = {}) {
  return {
    // Card id -> extra Clutch Possession dice (MVP and CPOY each add one —
    // the MLB Showdown icon system reborn). Injected rather than imported so
    // the engine stays pure; src/game/clutchAwards.js carries the data.
    clutchDice: opts.clutchDice ?? {},
    // Set by endSection when the final section begins within the margin —
    // { active, margin, used: {A,B}, extra: {A,B}, timeoutUsed: {A,B} }.
    crunch: null,
    // CARDS THAT OUTLIVE A SECTION. Run the Floor and Twin Towers "stay in
    // play until at least one of these players goes to the bench", which is
    // the only thing in the game that survives the section reset below.
    // Entries are { cardId, teamKey, playerIds, lastSection }; see
    // pruneStanding, which runs when the next scoring phase opens because
    // that is the first moment the new lineup is known.
    standing: [],
    timeoutActive: null,
    pressArmed: {},
    teamA: makeTeam(rosterA, 'Team A', deckConfigA),
    teamB: makeTeam(rosterB, 'Team B', deckConfigB),
    quarter: 1,
    section: 1,
    phase: 'draft', // draft | matchup_strats | scoring | done
    draft: {
      aPool: rosterA.slice(),
      bPool: rosterB.slice(),
      aReady: false,
      bReady: false,
    },
    offMatchups: { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] },
    matchupsSet: {},
    matchupTurn: 'A',
    matchupPasses: 0,
    placementStep: 10,                    // 10 = all placed (solo default). PvP overrides to 0.
    placementOrder: ['A','B','B','A','A','B','B','A','A','B'],
    lastMatchupCard: null,
    lastDefSwitch: null,    // the opponent's last defensive switch — what Overhelp / Burned on the Switch answer
    scoringTurn: 'B',
    scoringPasses: 0,
    pendingShotCheck: null,
    lastShotCheck: null, // { teamKey, playerIdx, playerId, type, result, pts, cardLabel }
    challengesUsed: { A: 0, B: 0 },
    rollResults: { A: [], B: [] },
    tempEff: {},
    ghosted: {},
    ignFatigue: {},
    blockedRolls: {},
    log: [],
    done: false,
    analytics: { A: emptyAnalytics(), B: emptyAnalytics() },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────
export function getTeam(g, key) {
  return key === 'A' ? g.teamA : g.teamB;
}

export function getOpp(g, key) {
  return key === 'A' ? g.teamB : g.teamA;
}

export function getPS(g, key, id) {
  return getTeam(g, key).stats.find(s => s.id === id);
}

export function roll20() {
  return Math.floor(Math.random() * 20) + 1;
}

// ── Advantage Calculation ──────────────────────────────────────────────────
// Rules:
//   - Both Speed AND Power negative → penalty = max(rawSpeed, rawPower) (least negative)
//   - A POSITIVE DefBoost only reduces advantages, never creates negatives
//   - A NEGATIVE DefBoost is carried by the DEFENDER: he guards at lower
//     effective Speed and Power, each floored at 0
//   - Hot/cold: ±2 per marker
//   - tempDefEff: { [defSlot]: { speedBoost, powerBoost } } from Defensive Stopper etc.
export function calcAdv(off, def, tempEff = {}, idx = 0, tempDefEff = null, defIdx = null) {
  // Defensive temp boosts (e.g. Defensive Stopper +5/+5)
  let defSpeedExtra = 0, defPowerExtra = 0, dbExtra = 0;
  if (tempDefEff && defIdx !== null && tempDefEff[defIdx]) {
    defSpeedExtra = tempDefEff[defIdx].speedBoost || 0;
    defPowerExtra = tempDefEff[defIdx].powerBoost || 0;
    dbExtra = tempDefEff[defIdx].dbExtra || 0;   // Defensive Anchor: the bonus counts double
  }

  // A NEGATIVE Def Boost is worn by the DEFENDER rather than handed to the
  // attacker as a bonus: a poor defender simply guards at lower effective Speed
  // and Power. Those bottom out at 0 — he can be reduced to nothing, but never
  // to less than nothing — so Nick Richards (Speed 2, Power 4, Def -3) defends
  // as Speed 0, Power 1.
  //
  // The floor sits on the STAT, not on the boost, and that is the whole point:
  // flooring the boost instead (the old rule) made every negative cosmetic, so
  // a third of the set advertised a weakness it never actually had.
  const defPenalty = Math.min(0, def.defBoost || 0);
  const defSpeed = Math.max(0, def.speed + defSpeedExtra + defPenalty);
  const defPower = Math.max(0, def.power + defPowerExtra + defPenalty);

  const rawSpeed = off.speed - defSpeed + (tempEff['s' + idx] || 0);
  const rawPower = off.power - defPower + (tempEff['p' + idx] || 0);
  // A POSITIVE Def Boost keeps its original job: it eats into an advantage the
  // attacker already has and never manufactures a penalty out of a standoff.
  const db = Math.max(0, (def.defBoost || 0) + dbExtra);

  if (rawSpeed <= 0 && rawPower <= 0) {
    const rollBonus = Math.max(rawSpeed, rawPower);
    return { speedAdv: rawSpeed, powerAdv: rawPower, rawSpeedDiff: rawSpeed, rawPowerDiff: rawPower, db, rollBonus, hasPenalty: true };
  }

  let speedAdv = Math.max(0, rawSpeed - db);
  let powerAdv = Math.max(0, rawPower - db);
  // SWITCH EVERYTHING'S PRICE: every POSITIVE advantage the offence holds is
  // doubled for the section. The card set `tempEff.doubleAdv` from the day it
  // was written and nothing ever read it (the user, 2026-09-08: "Jackson
  // should have had a +10 here"). It lives here so the roll, the board's
  // matchup line and the AI's reading all say the same number. A penalty is
  // handled above and is not doubled — the card doubles advantages.
  if (tempEff?.doubleAdv) { speedAdv *= 2; powerAdv *= 2; }
  return { speedAdv, powerAdv, rawSpeedDiff: rawSpeed, rawPowerDiff: rawPower, db, rollBonus: Math.max(speedAdv, powerAdv), hasPenalty: false };
}

// ── Fatigue ────────────────────────────────────────────────────────────────
// Progressive fatigue based on consecutive minutes:
//   0-8 min: no penalty (2 sections free)
//   9-12 min: -2
//   13-16 min: -6
//   16+ min: -12 (should be benched)
/**
 * The fatigue roll penalty for a minutes total. Exported so the AI values a
 * bench player by the same table the roll uses — it used to keep a private
 * copy of the thresholds with made-up weights attached.
 */
export function fatigueForMinutes(min) {
  if (min >= 16) return -12;
  if (min >= 12) return -6;
  if (min >= 8) return -2;
  return 0;
}

/**
 * Minutes a section on the bench takes off the tracker.
 *
 * FOUR, NOT EIGHT (2026-09-05). Eight meant three straight sections then one
 * rest came back fully fresh — 12 to 4, under the first threshold — so the
 * fatigue a star built up over a whole quarter vanished in one sitting. The
 * user's call: "he only should have recovered a little bit." Four is what a
 * section of play adds, so rest and play are symmetric: 12 rests to 8 (−2),
 * and it takes three sections off to get back to zero. Halftime still resets
 * everything.
 */
export const REST_RECOVERY = 4;

/**
 * Did this player sit out the previous section? The flag is written at every
 * section end; a save from before it existed falls back to the old test.
 */
export function satOutLast(g, teamKey, player) {
  const ps = player ? getPS(g, teamKey, player.id) : null;
  if (!ps) return false;
  if (ps.wasBenched != null) return Boolean(ps.wasBenched);
  return (ps.minutes || 0) === 0 && !(g.quarter === 1 && g.section === 1);
}

/**
 * PUT A CARD BACK. A hand card goes to the BOTTOM of the deck (index 0 —
 * drawCards pops from the end), any time, at no cost in turns: the hand
 * refills to seven at the section end as ever. The user (2026-09-08): "I
 * should be able to discard strategy cards and return them into my deck at
 * any point." A played card stays played.
 */
export function returnCardToDeck(g, teamKey, handIdx) {
  const ng = deepClone(g);
  const t = getTeam(ng, teamKey);
  if (!t?.hand || handIdx < 0 || handIdx >= t.hand.length) return g;
  const [id] = t.hand.splice(handIdx, 1);
  t.deck = [id, ...(t.deck || [])];
  const name = getStrat(id)?.name ?? id;
  ng.log = [...ng.log, { team: teamKey, msg: `${t.name} returns ${name} to the bottom of the deck` }];
  return ng;
}

/** Minutes left on the tracker after one section on the bench, floored at zero. */
export function restMinutes(min) {
  return Math.max(0, (min || 0) - REST_RECOVERY);
}

/** A section on the bench: markers go cold, minutes recover. Mutates `ps`. */
export function benchRest(ps) {
  ps.hot = 0;
  ps.cold = 0;
  ps.minutes = restMinutes(ps.minutes);
}

export function getFatigue(g, key, idx) {
  const player = getTeam(g, key).starters[idx];
  if (!player) return 0;
  const ps = getPS(g, key, player.id);
  if (g.ignFatigue?.[`${key}_${idx}`]) return 0;
  return fatigueForMinutes(ps?.minutes || 0);
}

/**
 * What a shot check costs in banked currency.
 *
 * NAMED rather than inlined so the balance work can sweep them. Conversion --
 * every point that reaches the score through `shotCheck` rather than off the
 * chart -- is 8.9% of scoring measured over thousands of simulated games, and
 * these four numbers are the only dial on it that does not touch a card.
 */
export const SPEND_COSTS = {
  /** 1 AST: +1 to a player's next shot check. */
  assistBoost: 1,
  /** 5 AST: a 3PT check, 3 points, needs a 3PT boost. */
  assistThree: 5,
  /** 5 AST: a paint check, 2 points, needs a Paint boost. */
  assistPaint: 5,
  /** 5 REB: the +3-differential paint check. */
  reboundPaint: 5,
};

// ── Shot Check ─────────────────────────────────────────────────────────────
// No speed/power advantage — only player's own boost + hot/cold + card bonus

/**
 * The passive contest: the ORIGINAL rules give Defensive Bonus "increased
 * contest effectiveness", and the recovered Crunch Time rules assume contests
 * exist as a standing mechanic ("+1 to all defensive contests"). Every 3PT and
 * paint shot check is contested by the shooter's assigned matchup defender for
 * that defender's Defensive Bonus. Free throws are never contested — nobody
 * guards the line. Negative defBoost never HELPS a shooter (floor at 0),
 * matching calcAdv's treatment.
 *
 * This is the single seam Crunch Time's Extra Defensive Intensity will add its
 * +1 through.
 */
/**
 * Sim-only escape hatch: analysis scripts flip this off to run the exact same
 * games without the passive contest, isolating its effect. The app never
 * touches it.
 */
export const contestConfig = { enabled: true };

export function matchupContest(g, teamKey, idx, type) {
  if (!contestConfig.enabled) return 0;
  if (type === 'ft') return 0;
  const defIdx = (g.offMatchups?.[teamKey] || [])[idx] ?? idx;
  const def = getOpp(g, teamKey).starters?.[defIdx];
  const defKey = teamKey === 'A' ? 'B' : 'A';
  const extra = g.tempDefEff?.[defKey]?.[defIdx]?.dbExtra || 0;   // Defensive Anchor
  const base = Math.max(0, (def?.defBoost || 0) + extra);
  // Extra Defensive Intensity (recovered original rules, Section 9): in
  // Crunch Time, a defender WITH a Defensive Bonus contests one harder.
  if (base > 0 && g.crunch?.active) return base + 1;
  return base;
}

// ── Crunch Time ────────────────────────────────────────────────────────────

/** Clutch Possessions this team still holds (1 base + Second Closer extras). */
export function clutchAvailable(g, teamKey) {
  if (!g.crunch?.active) return 0;
  const allowed = 1 + (g.crunch.extra?.[teamKey] || 0);
  return Math.max(0, allowed - (g.crunch.used?.[teamKey] || 0));
}

/**
 * The dice a player rolls on a Clutch Possession: two for everyone (roll
 * twice, keep the better — the recovered original rule), plus one per MVP or
 * CPOY on his card — the MLB Showdown icon system reborn. 25-26 Shai: four.
 */
export function clutchDiceFor(g, player) {
  return 2 + (g.clutchDice?.[player?.id] || 0);
}

/** The original fatigue gate: a gassed player cannot go clutch. */
export function clutchEligible(g, teamKey, idx) {
  return getFatigue(g, teamKey, idx) > -6;
}

/**
 * The Timeout: one per team per game, Crunch Time only. Spending it lets the
 * team fully re-set its defensive matchups mid-section (the caller follows
 * with applyMatchups) and opens the window the timeout-rider cards play in.
 */
export function spendTimeout(g, teamKey) {
  if (!g.crunch?.active) return { game: g, ok: false, msg: 'Timeouts are a Crunch Time resource' };
  if (g.phase !== 'scoring') return { game: g, ok: false, msg: 'Timeouts are called during the Scoring Phase' };
  if (g.crunch.timeoutUsed?.[teamKey]) return { game: g, ok: false, msg: 'Timeout already used' };
  if (g.timeoutActive) return { game: g, ok: false, msg: 'A timeout is already in progress' };
  const ng = deepClone(g);
  ng.crunch.timeoutUsed[teamKey] = true;
  ng.timeoutActive = teamKey;
  ng.log = [...ng.log, { team: teamKey, msg: '⏸ TIMEOUT — the defense re-sets, and the clipboard comes out.' }];
  return { game: ng, ok: true };
}

export function endTimeout(g) {
  if (!g.timeoutActive) return g;
  const ng = deepClone(g);
  ng.log = [...ng.log, { team: ng.timeoutActive, msg: 'Play resumes.' }];
  ng.timeoutActive = null;
  return ng;
}

export function shotCheck(player, type, extra, ps) {
  const die = roll20();
  // WHERE THE BONUS CAME FROM, not just how big it is.
  //
  // The log printed a lump — "8+4=12 vs 13" — and a player reading it sees a
  // shot line of 13 and their own printed 3PT bonus of +1 and concludes the
  // card should have made it. The +1 is already INSIDE the +4, which the line
  // gave no way to know (the user, 2026-09-07). `parts` is that breakdown; the
  // arithmetic is untouched.
  // `extra` is a number (a card's bonus, labelled as such) or an ARRAY of
  // { label, n } parts — the spend checks pass the assist boost and the
  // defender's contest separately so the line can show them.
  const parts = [];
  let bonus = 0;
  if (Array.isArray(extra)) {
    for (const part of extra) if (part && part.n) { bonus += part.n; parts.push({ label: part.label, n: part.n }); }
  } else {
    bonus = extra || 0;
    if (extra) parts.push({ label: 'card', n: extra });
  }
  const boost = type === '3pt' ? (player.threePtBoost || 0)
    : type === 'paint' ? (player.paintBoost || 0)
      : 0;
  if (boost) { bonus += boost; parts.push({ label: type === '3pt' ? '3PT' : 'Paint', n: boost }); }
  if (type === 'ft') { bonus += 10; parts.push({ label: 'FT', n: 10 }); }
  const marker = ((ps?.hot || 0) - (ps?.cold || 0)) * 2;
  if (marker) { bonus += marker; parts.push({ label: marker > 0 ? '🔥' : '🧊', n: marker }); }
  const total = die + bonus;
  const hit = total >= player.shotLine;
  const pts = hit ? (type === '3pt' ? 3 : type === 'paint' ? 2 : 1) : 0;
  return { die, bonus, total, line: player.shotLine, hit, pts, type, parts };
}

/**
 * A shot check as one log line, ITEMISED: "🎲8 −1 Paint +2 🔥 −1 contest = 8
 * vs 14 → MISS". The spend checks used to print only the net bonus, so a
 * hot marker that was counted could not be told from one that was not (the
 * user, 2026-09-08, on Jaren Jackson Jr.'s rebound check reading "🎲8=8").
 */
export function checkLine(r) {
  const sign = n => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;
  const detail = r.parts?.length
    ? ` ${r.parts.map(p => `${sign(p.n)} ${p.label}`).join(' ')}`
    : (r.bonus ? ` ${sign(r.bonus)}` : '');
  return `🎲${r.die}${detail} = ${r.total} vs ${r.line} → ${r.hit ? `${r.pts}pts!` : 'MISS'}`;
}

/** The parts of a spend check's bonus: the banked assist boost and the matchup contest. */
function spendParts(astBonus, contest) {
  return [{ label: 'AST', n: astBonus || 0 }, { label: 'contest', n: -(contest || 0) }];
}

// ── Assist Spending ────────────────────────────────────────────────────────
// Costs live in SPEND_COSTS above — that block is the single source of truth
// for both the engine checks here and the buttons in CourtBoard.
export function spendAssist(g, teamKey, type, playerIdx) {
  const ng = deepClone(g);
  const myT = getTeam(ng, teamKey);
  const player = myT.starters[playerIdx];
  if (!player) return { game: ng, ok: false, msg: 'Invalid player' };
  const ps = getPS(ng, teamKey, player.id) || {};

  if (type === 'boost') {
    if (myT.assists < SPEND_COSTS.assistBoost) return { game: ng, ok: false, msg: `Need ${SPEND_COSTS.assistBoost} assist (have ${myT.assists})` };
    myT.assists -= SPEND_COSTS.assistBoost;
    if (!ng.tempEff[teamKey]) ng.tempEff[teamKey] = {};
    ng.tempEff[teamKey]['astBoost_' + playerIdx] = (ng.tempEff[teamKey]['astBoost_' + playerIdx] || 0) + 1;
    ng.log = [...ng.log, { team: teamKey, msg: `Spent 1 AST: ${player.name} gets +1 to next shot check` }];
    return { game: ng, ok: true };
  }

  if (type === '3pt') {
    if (myT.assists < SPEND_COSTS.assistThree) return { game: ng, ok: false, msg: `Need ${SPEND_COSTS.assistThree} assists (have ${myT.assists})` };
    if (!(player.threePtBoost > 0)) return { game: ng, ok: false, msg: `${player.name} needs a 3PT Bonus` };
    myT.assists -= SPEND_COSTS.assistThree;
    const astBonus = ng.tempEff?.[teamKey]?.['astBoost_' + playerIdx] || 0;
    const r = shotCheck(player, '3pt', spendParts(astBonus, matchupContest(ng, teamKey, playerIdx, '3pt')), ps);
    if (r.hit) {
      myT.score += r.pts;
      const ps2 = myT.stats.find(s => s.id === player.id);
      if (ps2) { ps2.pts += r.pts; ps2.threepa = (ps2.threepa || 0) + 1; ps2.threepm = (ps2.threepm || 0) + 1; }
      if (ng.analytics?.[teamKey]) ng.analytics[teamKey].assistSpendPts += r.pts;
    } else {
      const ps2 = myT.stats.find(s => s.id === player.id);
      if (ps2) ps2.threepa = (ps2.threepa || 0) + 1;
    }
    if (r.die <= 2) ps.cold = (ps.cold || 0) + 1;
    if (r.die >= 19) ps.hot = (ps.hot || 0) + 1;
    if (ng.tempEff?.[teamKey]) delete ng.tempEff[teamKey]['astBoost_' + playerIdx];
    ng.log = [...ng.log, { team: teamKey, msg: `Spent ${SPEND_COSTS.assistThree} AST: ${player.name} 3PT check ${checkLine(r)}` }];
    return { game: ng, ok: true };
  }

  if (type === 'paint') {
    if (myT.assists < SPEND_COSTS.assistPaint) return { game: ng, ok: false, msg: `Need ${SPEND_COSTS.assistPaint} assists (have ${myT.assists})` };
    if (!(player.paintBoost > 0)) return { game: ng, ok: false, msg: `${player.name} needs a Paint Bonus` };
    myT.assists -= SPEND_COSTS.assistPaint;
    const astBonus = ng.tempEff?.[teamKey]?.['astBoost_' + playerIdx] || 0;
    const r = shotCheck(player, 'paint', spendParts(astBonus, matchupContest(ng, teamKey, playerIdx, 'paint')), ps);
    if (r.hit) {
      myT.score += r.pts;
      const ps2 = myT.stats.find(s => s.id === player.id);
      if (ps2) ps2.pts += r.pts;
      if (ng.analytics?.[teamKey]) ng.analytics[teamKey].assistSpendPts += r.pts;
    }
    if (r.die <= 2) ps.cold = (ps.cold || 0) + 1;
    if (r.die >= 19) ps.hot = (ps.hot || 0) + 1;
    if (ng.tempEff?.[teamKey]) delete ng.tempEff[teamKey]['astBoost_' + playerIdx];
    ng.log = [...ng.log, { team: teamKey, msg: `Spent ${SPEND_COSTS.assistPaint} AST: ${player.name} Paint check ${checkLine(r)}` }];
    return { game: ng, ok: true };
  }

  return { game: ng, ok: false, msg: 'Unknown assist spend type' };
}

// ── Rebound Bonus Shot Checks ──────────────────────────────────────────────
// +3 reb diff → Paint shot check for a chosen player (costs 3 REB)
export function spendReboundBonus(g, teamKey, type, playerIdx) {
  const ng = deepClone(g);
  const myT = getTeam(ng, teamKey);
  const player = myT.starters[playerIdx];
  if (!player) return { game: ng, ok: false, msg: 'Invalid player' };
  const ps = getPS(ng, teamKey, player.id) || {};

  if (type === 'paint_check') {
    // Second-chance paint shot check (from +3 reb advantage) — costs 3 REB
    if (myT.rebounds < SPEND_COSTS.reboundPaint) return { game: ng, ok: false, msg: `Need ${SPEND_COSTS.reboundPaint} rebounds (have ${myT.rebounds})` };
    myT.rebounds -= SPEND_COSTS.reboundPaint;
    const r = shotCheck(player, 'paint', spendParts(0, matchupContest(ng, teamKey, playerIdx, 'paint')), ps);
    if (r.hit) {
      myT.score += r.pts;
      const ps2 = myT.stats.find(s => s.id === player.id);
      if (ps2) ps2.pts += r.pts;
      if (ng.analytics?.[teamKey]) ng.analytics[teamKey].reboundBonusPts += r.pts;
    }
    if (r.die <= 2) ps.cold = (ps.cold || 0) + 1;
    if (r.die >= 19) ps.hot = (ps.hot || 0) + 1;
    // Mark as used
    if (ng.reboundBonuses?.[teamKey]) ng.reboundBonuses[teamKey].paintCheck = false;
    ng.log = [...ng.log, { team: teamKey, msg: `Rebound Paint Check (−${SPEND_COSTS.reboundPaint} REB): ${player.name} ${checkLine(r)}` }];
    return { game: ng, ok: true };
  }

  // THE PUTBACK IS GONE. It let a player who grabbed 2+ rebounds in a section
  // spend 2 REB on a paint check, and it was the one conversion route that
  // ignored shooting entirely -- the opportunity went to whoever rebounded, so
  // the points went to bigs regardless of whether they could finish. Measured
  // over 9,440 games it was 4.3% of ALL scoring, and 31.5% of every converted
  // point went to players on the worst shot line in the set. Removing it leaves
  // conversion gated on the boosts, which is what the boosts are for.
  //
  // The +3 rebound-differential paint check above is untouched: it is a TEAM
  // reward the player chooses a target for, so shooting still decides it.

  return { game: ng, ok: false, msg: 'Unknown rebound bonus type' };
}

/**
 * Assign who guards whom.
 *
 * `defendingKey` is the team CHOOSING its defensive assignments, and the array
 * it writes is THE OPPONENT'S. That inversion is the whole reason this is a
 * function rather than a line at the call site: `doRoll` reads
 * `offMatchups[teamKey][attackerIdx]` as an index into the OPPOSING bench, so
 * team B deciding how to guard team A must write `offMatchups.A`. Setting
 * `offMatchups.B` instead silently rearranges B's own attackers' opposition and
 * looks like it worked.
 *
 * `matchups[i]` is the defender index assigned to the attacker in slot i, which
 * is the shape `aiSetMatchups` returns.
 */
export function applyMatchups(g, defendingKey, matchups) {
  if (!Array.isArray(matchups) || matchups.length === 0) return g;
  const attackingKey = defendingKey === 'A' ? 'B' : 'A';
  const ng = deepClone(g);
  ng.offMatchups = { ...ng.offMatchups, [attackingKey]: matchups.slice() };
  // Marks the DEFENDER as having chosen, so an AI does not re-shuffle a defence
  // its opponent has already played cards against. Cleared by endSection.
  ng.matchupsSet = { ...(ng.matchupsSet || {}), [defendingKey]: true };

  // SHOW THE WORK. Every assignment — the AI's or a human's — writes what it
  // did and what it costs to the log, so a "the AI put Smith on Holiday for
  // +9" report can be checked against the alternatives rather than argued
  // about, and a MISSING line means the defence was never set at all.
  const def = getTeam(ng, defendingKey);
  const att = getTeam(ng, attackingKey);
  const parts = matchups.map((d, i) => {
    const a = att?.starters?.[i];
    const dp = def?.starters?.[d];
    if (!a || !dp) return null;
    const adv = calcAdv(a, dp, ng.tempEff?.[attackingKey] || {}, i, ng.tempDefEff?.[defendingKey], d).rollBonus;
    return `${dp.name} on ${a.name} (${adv > 0 ? '+' : ''}${adv})`;
  }).filter(Boolean);
  if (parts.length) ng.log = [...(ng.log || []), { team: defendingKey, msg: `Sets the defence — ${parts.join(' · ')}` }];
  return ng;
}

// ── Priority in the card windows ───────────────────────────────────────────
//
// THE CADENCE (2026-09-05, from play-testing): "if I play a strat, the other
// team can play or pass, repeat until I hit the pass button." The two card
// windows — the matchup phase, and the scoring phase before rolling opens —
// used to leave the turn where it was after a card, so whoever held it could
// keep playing, and the AI, which acts the instant it holds the turn, chained
// its whole hand. Nothing the AI decided was wrong; the window was.
//
// So it is priority, as in every card game with a stack: a card HANDS THE TURN
// OVER and resets the count of consecutive passes; a pass hands it over and
// counts; the second pass in a row closes the window. Passing and then seeing
// the opponent play gets you the turn back, which is what "repeat until I hit
// pass" means in practice. The AI plays at most one card per turn as a
// consequence, with no AI-specific rule anywhere.
//
// Both functions live here because the pass used to be written out three
// times — the board, the AI driver, and by implication PvP — and a card play
// touched the turn nowhere at all.

const other = k => (k === 'A' ? 'B' : 'A');

/** Is `g` inside a card window, and whose turn is it there? */
export function cardWindow(g) {
  if (g.phase === 'matchup_strats' && (g.placementStep ?? 10) >= 10) return { key: 'matchupTurn', passes: 'matchupPasses' };
  if (g.phase === 'scoring' && (g.scoringPasses || 0) < 99) return { key: 'scoringTurn', passes: 'scoringPasses' };
  return null;
}

/**
 * After `teamKey` has played a card: the turn goes to the other side and the
 * pass count resets. Only when the card was played IN a card window, ON the
 * player's own turn, and did not itself close the window — a reaction during a
 * roll, or a card that moved the phase on, leaves the turn alone.
 */
export function handOverPriority(before, after, teamKey) {
  const w = cardWindow(before);
  if (!w) return after;
  if (before[w.key] !== teamKey) return after;
  if (after.phase !== before.phase) return after;
  const ng = deepClone(after);
  ng[w.key] = other(teamKey);
  ng[w.passes] = 0;
  return ng;
}

/**
 * A DEFENSIVE SWITCH, recorded so the offence can answer it.
 *
 * `lastMatchupCard` records an offensive switch (High Screen & Roll) for the
 * three cancelers. Nothing recorded a DEFENSIVE one, so Overhelp and Burned
 * on the Switch — whose printed text is "opponent plays a defensive switching
 * card" / "opponent forces a matchup switch" — could only ever fire off the
 * opponent's High Screen & Roll, and Burned was dead in the AI's hands
 * outright (the audit's word). Veer Switch and Switch Everything now leave
 * this record: which attacking slots changed defender, from whom to whom, as
 * indices into the defence's starters. Consumed by the first reaction played
 * against it; cleared by endSection.
 */
export function recordDefSwitch(teamKey, cardId, before, after) {
  const changes = [];
  for (let slot = 0; slot < after.length; slot += 1) {
    if (before[slot] !== after[slot]) changes.push({ slot, origD: before[slot], newD: after[slot] });
  }
  return changes.length ? { teamKey, cardId, changes } : null;
}

/** The attacking slots a recorded switch handed a WEAKER defender — lower Speed OR lower Power. */
export function burnedSlots(g, sw) {
  if (!sw) return [];
  const def = getTeam(g, sw.teamKey)?.starters || [];
  return sw.changes
    .filter(c => {
      const o = def[c.origD];
      const n = def[c.newD];
      return o && n && ((n.speed || 0) < (o.speed || 0) || (n.power || 0) < (o.power || 0));
    })
    .map(c => c.slot);
}

/**
 * A player's id, if they are on the floor for `teamKey`.
 *
 * Standing cards name PLAYERS, not slots: a lineup can come back in a
 * different order and the card should not care, but it must notice when
 * somebody sits.
 */
function onFloor(g, teamKey, playerId) {
  return getTeam(g, teamKey).starters.some(p => p?.id === playerId);
}

/**
 * Drop any standing card whose named players are no longer all on the floor,
 * and take the card out of the hand it was sitting in.
 *
 * Called as the scoring phase opens, which is the earliest point the new
 * lineup exists — endSection clears the starters, so the bench cannot be
 * checked there.
 */
export function pruneStanding(g) {
  const kept = [];
  for (const entry of g.standing ?? []) {
    if ((entry.playerIds ?? []).every(id => onFloor(g, entry.teamKey, id))) { kept.push(entry); continue; }
    const team = getTeam(g, entry.teamKey);
    const at = team.hand.indexOf(entry.cardId);
    if (at >= 0) team.hand = [...team.hand.slice(0, at), ...team.hand.slice(at + 1)];
    g.log = [...g.log, {
      team: entry.teamKey,
      msg: `${entry.cardId.replace(/_/g, ' ')} leaves play — one of its players is on the bench`,
    }];
  }
  g.standing = kept;
  return g;
}

/** The standing entry for a team's card, or undefined. */
export function standingEntry(g, teamKey, cardId) {
  return (g.standing ?? []).find(e => e.teamKey === teamKey && e.cardId === cardId);
}

/** `teamKey` passes. Hands the turn over, or closes the window on the second pass. */
export function passTurn(g, teamKey) {
  const ng = deepClone(g);
  if (ng.phase === 'matchup_strats') {
    ng.matchupPasses = (ng.matchupPasses || 0) + 1;
    if (ng.matchupPasses >= 2) {
      ng.phase = 'scoring';
      ng.rollResults = { A: [], B: [] };
      ng.log = [...ng.log, { team: null, msg: 'Both passed — Scoring Phase!' }];
      pruneStanding(ng);
    } else {
      ng.matchupTurn = other(teamKey);
      ng.log = [...ng.log, { team: teamKey, msg: 'Passed.' }];
    }
    return ng;
  }
  ng.scoringPasses = (ng.scoringPasses || 0) + 1;
  if (ng.scoringPasses >= 2) {
    ng.scoringPasses = 99;
    ng.log = [...ng.log, { team: null, msg: 'Both passed — rolling begins!' }];
  } else {
    ng.scoringTurn = other(teamKey);
    ng.log = [...ng.log, { team: teamKey, msg: 'Passed scoring turn.' }];
  }
  return ng;
}

/**
 * Did this roll reach the player's TOP TIER — the last row of the chart?
 *
 * It used to mean "scored the chart's maximum points", and on a chart whose
 * top three rows all pay one point (Oso Ighodaro: 9-17, 18-23 and 24+ each
 * pay 1) a nine counted as top tier and lit Heat Check. The user's rule
 * (2026-09-05): the tier, not the points — "his highest tier is 24+, so he'd
 * have to hit a 24 or higher after bonuses." The one guard kept is that the
 * row pays something at all, so a chart of nothing cannot "hit top tier".
 */
export function hitsTopTier(card, finalRoll) {
  const chart = card?.chart;
  if (!Array.isArray(chart) || chart.length === 0) return false;
  const top = chart[chart.length - 1];
  const pays = (top.pts || 0) + (top.reb || 0) + (top.ast || 0) > 0;
  return pays && finalRoll >= top.lo;
}

// ── Scoring Roll ───────────────────────────────────────────────────────────
export function doRoll(g, teamKey, idx, opts = {}) {
  const myT = getTeam(g, teamKey);
  const oppT = getOpp(g, teamKey);
  const player = myT.starters[idx];
  if (!player) return g;

  const defIdx = (g.offMatchups[teamKey] || [])[idx] ?? idx;
  const defPlayer = oppT.starters[defIdx] || oppT.starters[0];
  if (!defPlayer) return g;

  // Clone state for immutability
  const ng = deepClone(g);
  const nMyT = getTeam(ng, teamKey);
  const nOppT = getOpp(ng, teamKey);
  const nPlayer = nMyT.starters[idx];
  const nDefPlayer = nOppT.starters[defIdx];

  const ghosted = ng.ghosted?.[`${teamKey}_${idx}`];
  let adv;
  if (ghosted) {
    adv = { speedAdv: 0, powerAdv: 0, rollBonus: 0, hasPenalty: false };
  } else {
    const oppKey = teamKey === 'A' ? 'B' : 'A';
    adv = calcAdv(nPlayer, nDefPlayer, ng.tempEff[teamKey], idx, ng.tempDefEff?.[oppKey], defIdx);
  }

  let bonus = adv.rollBonus;
  const te = ng.tempEff[teamKey] || {};
  // Defensive Anchor: whoever the anchored defender guards gets no POSITIVE
  // matchup bonus this period (a penalty still bites).
  // HELP DEFENDER: the helped defender's man gets no POSITIVE bonus this
  // roll. (Defensive Anchor set this flag too until 2026-09-08; it doubles the
  // defender's bonus inside calcAdv now — see execCard.)
  if (bonus > 0 && ng.tempDefEff?.[teamKey === 'A' ? 'B' : 'A']?.[defIdx]?.anchor) bonus = 0;
  if (te['r' + idx]) bonus += te['r' + idx];

  // Open-man bonus (Double Team's cost): rides on the next roll this team
  // chooses to make, then it's gone — the offense picks its beneficiary
  // through roll order.
  // A bare number is the OLD shape and still readable, so a game saved
  // mid-segment before this change does not throw.
  const open = ng.openMan?.[teamKey];
  const openPts = typeof open === 'number' ? open : (open?.pts ?? 0);
  const openExcept = typeof open === 'object' ? (open?.except ?? []) : [];
  if (openPts && !openExcept.includes(idx)) {
    bonus += openPts;
    delete ng.openMan[teamKey];
  }

  const fat = getFatigue(ng, teamKey, idx);
  const ps = getPS(ng, teamKey, nPlayer.id) || {};
  const mrkB = ((ps.hot || 0) - (ps.cold || 0)) * 2;

  // ── CLUTCH POSSESSION ────────────────────────────────────────────────────
  // Roll N dice, keep the best — 2 for anyone, +1 per MVP/CPOY on the card.
  // Validated here so a stray flag can never mint free rerolls: crunch must
  // be live, the team must hold a possession, and the player must have legs
  // (the original −4-fatigue gate, −6 on this scale).
  let clutchDice = 0;
  if (opts.clutch && clutchAvailable(ng, teamKey) > 0 && clutchEligible(ng, teamKey, idx)) {
    clutchDice = clutchDiceFor(ng, nPlayer);
    ng.crunch.used[teamKey] = (ng.crunch.used[teamKey] || 0) + 1;
  }
  // EVERY DIE ROLLED IS KEPT for the log. Unsung Hero rolled two and kept
  // the higher, and printed only the higher — so "Kennard 🎲12" looked like
  // one die and the card looked broken (the user, 2026-09-08). The line now
  // reads "🎲[12 7]→12" whenever more than one die was thrown.
  const dice = [roll20()];
  for (let extra = 1; extra < clutchDice; extra += 1) dice.push(roll20());
  let die = Math.max(...dice);
  // Unsung Hero (two dice, keep the higher) and Swarming Defense (two dice,
  // keep the lower) — both set by a card this section on this roller's slot.
  if (te['adv' + idx]) { const d = roll20(); dice.push(d); die = Math.max(die, d); }
  if (te['dis' + idx]) { const d = roll20(); dice.push(d); die = Math.min(die, d); }

  const totalBonus = bonus + fat + mrkB;
  let finalRoll = Math.max(1, Math.min(die + totalBonus, 99));
  let result = lookupChart(nPlayer, finalRoll);
  let isTop = hitsTopTier(nPlayer, finalRoll);

  // ── DESPERATION PRESS ────────────────────────────────────────────────────
  // The trailing team's armed press forces a re-roll of this team's next
  // TOP-TIER roll — second result stands, better or worse.
  let pressed = false;
  if (isTop && (ng.pressArmed?.[teamKey] || 0) > 0) {
    ng.pressArmed[teamKey] -= 1;
    pressed = true;
    die = roll20();
    dice.push(die);
    finalRoll = Math.max(1, Math.min(die + totalBonus, 99));
    result = lookupChart(nPlayer, finalRoll);
    isTop = hitsTopTier(nPlayer, finalRoll);
  }

  // Post Domination: this player's rebounds from scoring rolls are doubled.
  if (te['reb2' + idx] && result.reb) result = { ...result, reb: result.reb * 2 };
  if (!ng.rollResults[teamKey]) ng.rollResults[teamKey] = [];
  // defId/defDb: who was guarding this roll, for matchup plus-minus analysis.
  ng.rollResults[teamKey][idx] = { die, dice, bonus: totalBonus, finalRoll, pts: result.pts, reb: result.reb, ast: result.ast, isTop, defIdx, defId: nDefPlayer.id, defDb: nDefPlayer.defBoost || 0 };

  nMyT.score += result.pts;
  nMyT.assists += result.ast;
  nMyT.rebounds += result.reb;
  const ps2 = nMyT.stats.find(s => s.id === nPlayer.id);
  if (ps2) { ps2.pts += result.pts; ps2.reb += result.reb; ps2.ast += result.ast; }

  // Analytics: chart scoring roll
  if (ng.analytics?.[teamKey]) {
    ng.analytics[teamKey].chartPts += result.pts;
    ng.analytics[teamKey].assistsGenerated += result.ast;
    ng.analytics[teamKey].reboundsGenerated += result.reb;
  }

  // Auto hot/cold from natural roll
  const ps3 = getPS(ng, teamKey, nPlayer.id) || {};
  if (die <= 2) ps3.cold = (ps3.cold || 0) + 1;
  else if (die >= 19) ps3.hot = (ps3.hot || 0) + 1;

  ng.log = [...ng.log, {
    team: teamKey,
    msg: `${clutchDice ? `⭐ CLUTCH (${clutchDice} dice) ` : ''}${pressed ? '🛑 PRESSED — re-roll! ' : ''}${nPlayer.name} 🎲${dice.length > 1 ? `[${dice.join(' ')}]→${die}` : die}${totalBonus !== 0 ? (totalBonus > 0 ? '+' : '') + totalBonus : ''}=${finalRoll} → ${result.pts}pts ${result.reb}reb ${result.ast}ast${adv.hasPenalty && !ghosted ? ' ⚠️ penalty' : ''}${isTop ? ' ⭐' : ''}${die === 20 ? ' 🎯' : ''}`,
  }];

  // The roll Box Out can answer, and Spain Pick & Roll's assist for a score.
  ng.lastRoll = { teamKey, idx, reb: result.reb, pts: result.pts, boxed: false };
  if (te['astOnScore' + idx] && result.pts > 0) {
    nMyT.assists += 1;
    ng.log = [...ng.log, { team: teamKey, msg: `Spain Pick & Roll: ${nPlayer.name} scores — +1 AST` }];
  }
  // Check assist bonus draw
  const after = checkAssistDraw(ng);
  return after;
}

function checkAssistDraw(g) {
  let ng = g;
  ['A', 'B'].forEach(k => {
    const t = getTeam(ng, k);
    if (t.assists === 5) {
      const drawn = drawCards(t.hand, t.deck, 1);
      ng = {
        ...ng,
        [k === 'A' ? 'teamA' : 'teamB']: { ...t, hand: drawn.hand, deck: drawn.deck, assists: 6 },
        log: [...ng.log, { team: k, msg: `${t.name} reached 5 assists — bonus card drawn!` }],
      };
    }
  });
  return ng;
}

/**
 * CROWD FAVORITE'S BAR. Was five, and nobody cleared it: the card is for
 * players at $350 or under, whose charts top out at three on a roll, so the
 * flag it set was never read — there was no reader at all. The user,
 * 2026-09-07: "2+ is fine and can include shot checks."
 */
export const CROWD_FAVORITE_PTS = 2;

// ── Section End ────────────────────────────────────────────────────────────
export function endSection(g) {
  let ng = deepClone(g);

  // Clear previous section's rebound bonuses before calculating new ones
  ng.reboundBonuses = {};

  // +/- and minutes
  const segPtsA = (ng.rollResults.A || []).reduce((s, r) => s + (r?.pts || 0), 0);
  const segPtsB = (ng.rollResults.B || []).reduce((s, r) => s + (r?.pts || 0), 0);
  ['A', 'B'].forEach(k => {
    const segFor = k === 'A' ? segPtsA : segPtsB;
    const segAg  = k === 'A' ? segPtsB : segPtsA;
    getTeam(ng, k).starters.forEach(p => {
      const ps = getPS(ng, k, p.id);
      if (ps) {
        ps.minutes += 4;
        ps.totalMinutes = (ps.totalMinutes || 0) + 4;
        ps.pm = (ps.pm || 0) + (segFor - segAg);
        // Second Wind penalty: +4 extra minutes of fatigue
        if (ps.secondWindPenalty) { ps.minutes += 4; delete ps.secondWindPenalty; }
      }
    });
  });

  // Rebound track bonuses (based on differential)
  const rd = ng.teamA.rebounds - ng.teamB.rebounds;
  const absRd = Math.abs(rd);
  if (absRd > 0) {
    const wk = rd > 0 ? 'A' : 'B';
    const wTeam = getTeam(ng, wk);

    // Winning the rebound track at section end → +1 stored assist
    wTeam.assists++;
    ng.log = [...ng.log, { team: wk, msg: `Rebound Track lead → ${wTeam.name} +1 AST` }];

    // Track rebound bonuses earned this section for UI display
    if (!ng.reboundBonuses) ng.reboundBonuses = {};
    ng.reboundBonuses[wk] = { diff: absRd, paintCheck: absRd >= 3 };
  }

  // No putback detection: the rule was removed (see spendReboundBonus).

  // Reset section state
  // CROWD FAVORITE pays now, from the snapshot the card took when it was
  // played (execCard) against the player's points at the buzzer. A flag from
  // a game saved before the snapshot existed is `true`; it counts the whole
  // game, which is generous once and then gone.
  for (const k of ['A', 'B']) {
    const te = ng.tempEff?.[k] || {};
    for (const key of Object.keys(te)) {
      if (!key.startsWith('crowd_')) continue;
      const idx = Number(key.slice('crowd_'.length));
      const p = getTeam(ng, k).starters[idx];
      const ps = p && getPS(ng, k, p.id);
      if (!ps) continue;
      const at = typeof te[key] === 'object' ? (te[key].at || 0) : 0;
      const got = (ps.pts || 0) - at;
      if (got >= CROWD_FAVORITE_PTS) {
        ps.hot = (ps.hot || 0) + 1;
        ng.log = [...ng.log, { team: k, msg: `Crowd Favorite: ${p.name} scored ${got} this section → hot marker` }];
      } else {
        ng.log = [...ng.log, { team: k, msg: `Crowd Favorite: ${p.name} scored ${got} this section — no marker` }];
      }
    }
  }
  ng.tempEff = {}; ng.tempDefEff = {}; ng.ghosted = {}; ng.ignFatigue = {}; ng.openMan = {};
  ng.lastDoubleTeam = null; ng.lastRoll = null; ng.lastCheckMiss = null; ng.lastPaintScore = null;
  ng.matchupsSet = {};
  ng.rollResults = { A: [], B: [] }; ng.pendingShotCheck = null; ng.lastShotCheck = null;
  // reboundBonuses were set earlier in this function — they persist to the next section's scoring phase

  if (ng.section < 3) {
    ng.section++;
    ng.phase = 'draft';
  } else if (ng.quarter < 4) {
    ng.quarter++;
    ng.section = 1;
    ng.phase = 'draft';
    if (ng.quarter === 3) {
      // Halftime — reset all fatigue and hot/cold markers
      ['A', 'B'].forEach(k => getTeam(ng, k).stats.forEach(ps => { ps.minutes = 0; ps.hot = 0; ps.cold = 0; }));
      ng.log = [...ng.log, { team: null, msg: '=== HALFTIME — All fatigue & hot/cold reset. Q3 begins. ===' }];
    } else {
      ng.log = [...ng.log, { team: null, msg: `=== Q${ng.quarter} begins ===` }];
    }
  } else {
    ng.done = true;
    return ng;
  }

  // ── CRUNCH TIME ──────────────────────────────────────────────────────────
  // The final 4-minute section of Q4, and only when the game is close enough
  // to deserve the theatrics: the margin gate is checked HERE, once, as the
  // section begins — the engine decides silently and the UI shows a banner.
  // Recovered original rules (rules doc Section 9) + 2026-09-02 decisions.
  if (ng.quarter === 4 && ng.section === 3) {
    const margin = Math.abs(ng.teamA.score - ng.teamB.score);
    const active = margin <= CRUNCH_MARGIN;
    ng.crunch = { active, margin, used: {}, extra: {}, timeoutUsed: {} };
    // THE CRUNCH TUTOR. A crunch-only card in a fifty-card deck was in hand
    // for the one section it exists for about one time in seven; the user
    // asked that a player who runs one "be able to use it reasonably". So
    // when crunch time arms, every crunch card still in the deck comes to
    // hand — over the seven-card draw cap, which is a rule about DRAWING —
    // and both sides get the same treatment. Nothing happens on a blowout:
    // the section is not crunch, and the cards stay where they were.
    if (active) {
      for (const k of ['A', 'B']) {
        const t = getTeam(ng, k);
        const came = (t.deck || []).filter(id => CRUNCH_CARDS.includes(id));
        if (!came.length) continue;
        t.deck = t.deck.filter(id => !CRUNCH_CARDS.includes(id));
        t.hand = [...(t.hand || []), ...came];
        ng.log = [...ng.log, { team: k, msg: `Crunch Time: ${t.name} draws ${came.map(id => id.replace(/_/g, ' ')).join(', ')} from the deck` }];
      }
    }
    ng.log = [...ng.log, {
      team: null,
      msg: active
        ? `🚨 CRUNCH TIME — final section, margin ${margin}. Clutch Possessions and Timeouts are live.`
        : `Final section — margin ${margin}, no crunch (needs ≤${CRUNCH_MARGIN}).`,
    }];
  }

  // Auto draw to 7
  ['A', 'B'].forEach(k => {
    const t = getTeam(ng, k);
    const drawn = drawCards(t.hand, t.deck, 7 - t.hand.length);
    if (k === 'A') { ng.teamA = { ...ng.teamA, hand: drawn.hand, deck: drawn.deck }; }
    else           { ng.teamB = { ...ng.teamB, hand: drawn.hand, deck: drawn.deck }; }
  });

  // Save current starters before clearing for bench recovery check
  const prevStartersA = ng.teamA.starters.map(p => p.id);
  const prevStartersB = ng.teamB.starters.map(p => p.id);

  // Reset for new draft
  ng.draft = {
    aPool: ng.teamA.roster.slice(),
    bPool: ng.teamB.roster.slice(),
    aReady: false,
    bReady: false,
  };
  ng.teamA.starters = []; ng.teamB.starters = [];
  ng.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  ng.matchupTurn = 'A'; ng.matchupPasses = 0; ng.lastMatchupCard = null; ng.lastDefSwitch = null;
  ng.scoringTurn = 'B'; ng.scoringPasses = 0;
  ng.blockedRolls = {};
  ng.endSectionVotes = { A: false, B: false };

  // Clear hot/cold for benched players, recover fatigue (using previous starters)
  ng = clearBenchedMarkers(ng, { A: prevStartersA, B: prevStartersB });

  return ng;
}

// Bench rest recovery:
//   - Hot/cold markers reset immediately when benched
//   - First 8 min of fatigue decays at 2x rate (4 min rest = 8 min recovery)
//   - Beyond 8 min of fatigue, decay is 1:1 (4 min rest = 4 min recovery)
//   - So: 8 min fatigue → 1 section rest = fully rested
//         12 min fatigue → 1 section rest = 4 min fatigue (recover 8), need 1 more rest
//         16 min fatigue → 1 section rest = 8 min fatigue, 2nd rest = fully rested
function clearBenchedMarkers(g, prevStarters) {
  const ng = { ...g };
  ['A', 'B'].forEach(k => {
    const t = getTeam(ng, k);
    const wasPlaying = prevStarters[k] || [];
    t.stats.forEach(ps => {
      // WHO SAT OUT, recorded for everyone at every section end. Defensive
      // Stopper reads it; it used to read "zero minutes", and halftime zeroes
      // the whole roster (the user, 2026-09-08: the card "treats players who
      // were refreshed at halftime like they were benched").
      ps.wasBenched = !wasPlaying.includes(ps.id);
      if (!wasPlaying.includes(ps.id)) {
        // Was on the bench last segment — recover fatigue and reset markers
        ps.hot = 0; ps.cold = 0;
        const min = ps.minutes || 0;
        if (min <= 8) {
          // First 8 min decay at 2x: 4 min rest recovers all 8
          ps.minutes = 0;
        } else {
          // Beyond 8: first recover 8 at 2x rate, then 4 at 1:1 from the rest period
          // Net: 4 min rest recovers 8 min (2x portion) but only if we have >8
          // Actually: recover = min(8, fatigue) at 2x + remaining rest at 1:1
          // With 4 min rest: 2x portion covers first 4 → recovers 8 min
          ps.minutes = Math.max(0, min - 8);
        }
      }
    });
  });
  return ng;
}

// ── Deep Clone (simple - avoids React mutation issues) ─────────────────────
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export { checkAssistDraw, emptyAnalytics };
