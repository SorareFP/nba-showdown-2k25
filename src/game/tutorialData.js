// src/game/tutorialData.js
// Tutorial tooltip content — data-driven for easy editing
// Each tooltip has: id, text, detail, section (1-4), trigger, priority

import {
  getTeam, calcAdv, matchupAdv, getPS, getFatigue, fatigueForMinutes, FATIGUE_STEP_PAST_16,
  restMinutes, REST_CLEARS_AT, REST_RECOVERY, MAX_STRAIGHT_MINUTES, restRuleLifted, mustRest,
  shotCheck, checkNeed, matchupContest, SPEND_COSTS, REBOUND_RULES, CRUNCH_MARGIN,
  clutchAvailable, clutchDiceFor, clutchEligible, crunchSearchOptions, lastReturnedCard, periodLabel, rollGate,
  canRollSlot, timeoutProblem,
} from './engine.js';
import { pairValue, FORFEIT_CARDS, forfeitNet } from './ai.js';
import { getStrat, TIMEOUT_RIDERS } from './strats.js';
import { canPlayCard } from './canPlay.js';
import { STRAT_COPY_CAPS } from './rarity.js';
import { AI_PAY } from './coinRewards.js';
import { DEFAULT_AI_LEVEL } from './aiLevels.js';
import { DEFAULT_DECK_COPIES } from './defaultDeckWeights.js';
import { isSkipPoint } from './tutorialFlow.js';
import { LINEUPS_LOCKED, DEFAULT_ORDER, CLOSING_LINE } from './placement.js';

// ── Lessons that read the board ──────────────────────────────────────────────
//
// The user (2026-09-08): "show why the AI chose the defender to matchup with
// the first player the user puts down", then "explain the matchup indicators",
// then "highlight that high screen & roll, and explain why you'd do it". Each
// of these is computed from the game with the SAME arithmetic the AI and the
// board use — aiPlacementPick's score, the placement picker's ⚔/🛡, and the
// High Screen & Roll pair search — so the lesson never disagrees with what the
// player sees.
const sgn = n => (n > 0 ? '+' : '') + n;
const who = p => `${p.name} (S${p.speed} P${p.power}${p.defBoost ? ` Def${sgn(p.defBoost)}` : ''})`;
const step = g => g.placementStep ?? 10;

/** Why the coach's row-1 answer was that player: aiPlacementPick's score, said out loud. */
function placementAnswer(g) {
  const a0 = getTeam(g, 'A').starters[0];
  const b0 = getTeam(g, 'B').starters[0];
  if (!a0 || !b0) return 'The coach answers every row you lead.';
  const mine = calcAdv(a0, b0, {}, 0);    // my roll against them
  const theirs = calcAdv(b0, a0, {}, 0);  // their roll against me
  const soaked = (b0.defBoost || 0) > 0 && (mine.rawSpeedDiff > 0 || mine.rawPowerDiff > 0) && mine.rollBonus < Math.max(mine.rawSpeedDiff, mine.rawPowerDiff);
  return `The coach answered your ${who(a0)} with ${who(b0)}. Against them your roll is ${sgn(mine.rollBonus)}${soaked ? ' — the Def Boost soaks part of your edge' : ''}, and theirs against you is ${sgn(theirs.rollBonus)}. The coach reads each pairing as points — what its player's chart pays at that bonus, less what yours pays — and plays the rest of the snake out in its head before it answers, so a good defender is not spent on a player who did not need one.`;
}

/** A's best remaining answer to the row the coach just led, by the coach's own score. */
function bestAnswer(g) {
  const A = getTeam(g, 'A');
  const B = getTeam(g, 'B');
  const opp = B.starters[A.starters.length];
  if (!opp) return null;
  const placed = new Set(A.starters.map(p => p.id));
  const picks = (g.draft?.aPicks ?? []).filter(id => !placed.has(id)).map(id => (A.roster || []).find(r => r.id === id)).filter(Boolean);
  let best = null;
  for (const c of picks) {
    const mine = calcAdv(c, opp, {}, 0);
    const theirs = calcAdv(opp, c, {}, 0);
    // The coach's own reading: the row in points, both charts.
    const score = pairValue(g, 'A', c, opp);
    if (!best || score > best.score) best = { c, mine, theirs, score };
  }
  return { opp, row: A.starters.length + 1, ...best };
}

function placementIndicators(g) {
  const r = bestAnswer(g);
  if (!r) return 'Now you answer a row the coach led. Open the picker and read the pairing both ways before you choose.';
  return `Now you answer row ${r.row}, where the coach led with ${who(r.opp)}. In the picker every one of your players shows the pairing both ways: ⚔ is your roll bonus attacking them, 🛡 is theirs attacking you. Green is good for you, red is bad, ⚠ marks a penalty.`;
}
function placementIndicatorsDetail(g) {
  const r = bestAnswer(g);
  if (!r?.c) return 'S and P are the raw Speed and Power differences; the roll bonus is the larger one after Def Boost.';
  return `S and P are the raw Speed and Power differences; the roll bonus is the larger one after Def Boost. Best answer right now, read as points on both charts: ${r.c.name} — ⚔ ${sgn(r.mine.rollBonus)}, 🛡 ${sgn(r.theirs.rollBonus)}.`;
}

/**
 * The swap of two defenders that gains the most roll bonus, read with
 * matchupAdv — the board's own "Roll" readout (2026-09-18). A bare calcAdv
 * left out the card effects on the slots (a Stagger Action's +2 Speed, a
 * Defensive Stopper, a ghost screen), so after a card the lesson quoted
 * "from −2 to +13" beside a board that read −1. The swapped side is the same
 * reader on the game with the two defenders traded, which is all High
 * Screen & Roll does (execCard): slot effects stay with the slot.
 */
function bestSwap(g) {
  const A = getTeam(g, 'A');
  const mu = g.offMatchups?.A || [0, 1, 2, 3, 4];
  const rollOn = (game, i) => matchupAdv(game, 'A', i)?.rollBonus ?? 0;
  let best = null;
  for (let i = 0; i < A.starters.length; i += 1) {
    for (let j = i + 1; j < A.starters.length; j += 1) {
      const traded = [...mu];
      traded[i] = mu[j] ?? j; traded[j] = mu[i] ?? i;
      const after = { ...g, offMatchups: { ...g.offMatchups, A: traded } };
      const ai = rollOn(g, i), aj = rollOn(g, j), bi = rollOn(after, i), bj = rollOn(after, j);
      const gain = bi + bj - ai - aj;
      if (!best || gain > best.gain) best = { i, j, gain, ai, aj, bi, bj };
    }
  }
  return best;
}
// ── The log, read from this section's start ──────────────────────────────────
// The lineup submit (placement.js beginPlacement, the one every board calls)
// logs LINEUPS_LOCKED every section, which is the anchor: a lesson about THIS
// section's switch must not fire off last section's line. Imported, not
// retyped, so the anchor cannot drift from the line the board writes.
function sectionLog(g) {
  const log = g.log || [];
  let start = 0;
  for (let i = log.length - 1; i >= 0; i -= 1) if (log[i].msg === LINEUPS_LOCKED) { start = i; break; }
  return log.slice(start);
}
const lastIn = (entries, re) => { for (let i = entries.length - 1; i >= 0; i -= 1) if (re.test(entries[i].msg)) return entries[i]; return null; };
// YOUR switch, not the last switch (2026-09-18): the coach sometimes answers
// a High Screen & Roll with one of its own, and reading the last line of
// either side killed both S1 lessons in 37% of tutorials.
const mySwitch = g => lastIn(sectionLog(g).filter(e => e.team === 'A'), /^High Screen & Roll: /);
// The COACH's cancel (2026-09-18): unfiltered, your own Go Under on the
// coach's switch was narrated as "the coach answered with Go Under", on the
// next lineup screen and again in section 2. A team-B cancel can only answer
// your switch.
const theirCancel = g => lastIn(sectionLog(g).filter(e => e.team === 'B'), /canceled HSR/);

/**
 * Where this section's matchup card window opened: the line after placement's
 * closing line. High Screen & Roll is playable DURING placement too, and the
 * coach's next team-B line then was its placement ("X takes the floor."),
 * which the lessons narrated as a card the coach played (2026-09-18). Only a
 * move inside the window can be the coach's answer. With no closing line
 * (a board that never placed) the window is the whole section.
 */
function windowStart(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) if (entries[i].team == null && CLOSING_LINE.test(entries[i].msg ?? '')) return i + 1;
  return 0;
}
const isPlacementLine = e => /takes the floor\.$/.test(e.msg ?? '');
/** The coach's moves in the matchup card window: passes and cards, never placements. */
function coachWindowMoves(g) {
  const entries = sectionLog(g);
  return entries.slice(windowStart(entries)).filter(e => e.team === 'B' && !isPlacementLine(e));
}
const moveOf = e => (/^Passed/.test(e.msg) ? { kind: 'pass' } : { kind: 'card', name: e.msg.split(':')[0] });

/**
 * The coach's move after my switch this section: a pass, a card, or nothing
 * yet. A switch played during placement is answered by the coach's first move
 * in the window, so until then there is no reply and the lessons wait.
 */
function coachReply(g) {
  const entries = sectionLog(g);
  const at = entries.indexOf(mySwitch(g));
  if (at < 0) return null;
  const from = Math.max(at + 1, windowStart(entries));
  const reply = entries.slice(from).find(e => e.team === 'B' && !isPlacementLine(e));
  return reply ? moveOf(reply) : null;
}
function switchLandedText(g) {
  const e = mySwitch(g);
  const what = e ? e.msg.replace(/^High Screen & Roll: /, '') : 'the two defenders traded places';
  const r = coachReply(g);
  const coach = r?.kind === 'card'
    ? (r.name === 'High Screen & Roll'
      ? 'The coach answered with a switch of its own — it holds no canceller, so it re-drew its own matchups instead.'
      : `The coach played ${r.name} instead of answering it — it holds no canceller.`)
    : 'The coach passed: it had nothing in hand to answer with.';
  return `Your switch went through — ${what}. ${coach}`;
}
/**
 * Go Under's price, said for the moment (2026-09-18). "Pick which of the two"
 * is an instruction only while the choice is waiting on YOU: it stayed up for
 * the rest of S2 after you had picked, and when you later cancelled the
 * coach's own switch with Go Under it told you to choose while the banner
 * read "Waiting for Team B to choose". Once taken, it is said in the past
 * tense from your resolve line (execCard resolveGoUnder).
 */
function goUnderPrice(g, cancel, rest) {
  const pc = g.pendingChoice;
  if (pc?.kind === 'go_under' && pc.teamKey === 'A') {
    return `Go Under's price is yours to spend: pick which of the two players takes a 3PT check at +2 — the banner shows the die each one needs. (${rest}.)`;
  }
  const entries = sectionLog(g);
  const at = entries.indexOf(cancel);
  const took = entries.slice(at + 1).find(x => x.team === 'A' && /^Go Under: .+ takes the 3PT check: /.test(x.msg));
  if (took) {
    const [shooter, result] = took.msg.replace(/^Go Under: /, '').split(' takes the 3PT check: ');
    return `Its price was yours: you chose ${shooter} for the 3PT check at +2, and ${/→ MISS/.test(result) ? 'he missed' : 'he hit'} (${result}).`;
  }
  return 'Its price was a 3PT check at +2 for one of the two players you screened, your choice of which.';
}
function switchCancelledText(g) {
  const e = theirCancel(g);
  if (!e) return 'The coach cancelled your switch.';
  const [card, rest] = e.msg.split(': canceled HSR — ');
  const lead = `The coach answered with ${card}: your switch is cancelled and the pairings stay as they were placed.`;
  if (card === 'Go Under') return `${lead} ${goUnderPrice(g, e, rest)}`;
  if (card === 'Fight Over') return `${lead} Fight Over's price: ${rest}.`;
  return `${lead} Veer Switch's twist: the coach chose the new assignments itself — ${rest}.`;
}

function screenRollText(g) {
  const A = getTeam(g, 'A');
  const lead = 'Your High Screen & Roll is lit. It swaps the defenders of two of your players, so the pairings the placement handed you are not final.';
  const s = bestSwap(g);
  if (!s || s.gain <= 0) return `${lead} Right now no swap gains anything — hold it for a section where the placement goes against you.`;
  const x = A.starters[s.i], y = A.starters[s.j];
  return `${lead} Best swap now: ${x.name} and ${y.name} trade defenders — ${x.name}'s roll goes from ${sgn(s.ai)} to ${sgn(s.bi)}, ${y.name}'s from ${sgn(s.aj)} to ${sgn(s.bj)} (net ${sgn(s.gain)}).`;
}

// ── The rules the lessons quote, read off the engine (2026-09-18) ────────────
//
// The standing rule: a tooltip that quotes a number computes it from the
// function the board uses. The rest text said "sheds 4" in three places for
// two days after the rule went back to its original two regimes (2026-09-16),
// because each copy was a literal. These are the one copy.

/**
 * Minutes a section on the floor puts on the tracker. endSection writes it as
 * a bare `+= 4`, so it cannot be imported; tutorialLessons.test.js runs a real
 * endSection and fails if the two ever disagree.
 */
export const SECTION_MINUTES = 4;
/** The natural dice that leave a marker (doRoll: `die >= 19` hot, `die <= 2` cold) — pinned by a test that rolls them. */
export const HOT_FROM = 19;
export const COLD_TO = 2;
/** The rebound-track lead at a section's end that puts the next REB paint check at +REB_LEAD_BONUS (REBOUND_RULES) — pinned by a test. */
export const REB_LEAD_FOR_BONUS = REBOUND_RULES.leadGate;
export const REB_LEAD_BONUS = REBOUND_RULES.leadBonus;
/** The hand every section draws back up to (newGame and endSection both write a bare 7) — pinned by a test. */
export const HAND_SIZE = 7;

const REST_EXAMPLES = [4, 8, 12, 16];
/** The rest rule in words: restMinutes, REST_CLEARS_AT and REST_RECOVERY, with the four cases a player meets. */
export function restRuleText() {
  const cases = REST_EXAMPLES.map(m => `${m} rests to ${restMinutes(m)}`).join(', ');
  return `A section on the bench clears the fatigue tracker at or under ${REST_CLEARS_AT} minutes and takes ${REST_RECOVERY} off above that (${cases}), and wipes hot and cold markers.`;
}

/** The fewest minutes (in whole sections) that carry a fatigue penalty: fatigueForMinutes. */
export function firstTiredMinutes() {
  for (let m = SECTION_MINUTES; m <= 40; m += SECTION_MINUTES) if (fatigueForMinutes(m) < 0) return m;
  return null;
}

/** The fatigue ladder in words, from fatigueForMinutes. */
export function fatigueLadderText() {
  const rungs = [8, 12, 16].map(m => `${m} min = ${fatigueForMinutes(m)}`).join(', ');
  return `${rungs}, then −${FATIGUE_STEP_PAST_16} more for every section past 16 (20 min = ${fatigueForMinutes(20)}).`;
}

/** What one hot or cold marker is worth: shotCheck's own sum, read with a marker and without. */
export function markerStep() {
  const probe = { shotLine: 99 };
  return shotCheck(probe, '3pt', 0, { hot: 1 }, 0).bonus - shotCheck(probe, '3pt', 0, {}, 0).bonus;
}

const CONTEST_PROBE = { offMatchups: { A: [0] }, teamA: { starters: [{}] }, teamB: { starters: [{ defBoost: 1 }] }, crunch: null };
/** What a Def Boost +1 defender takes off the checks of the man he guards outside Crunch Time: matchupContest. */
export function contestPerDefBoost() {
  return matchupContest(CONTEST_PROBE, 'A', 0, '3pt');
}
/** How much harder a defender with a Def Boost contests in Crunch Time: matchupContest, crunch on and off. */
export function crunchContestBump() {
  return matchupContest({ ...CONTEST_PROBE, crunch: { active: true } }, 'A', 0, '3pt') - contestPerDefBoost();
}

/** The fewest minutes at which clutchEligible says no — the fatigue gate on a Clutch Possession. */
export function clutchGateMinutes() {
  for (let m = 0; m <= 40; m += SECTION_MINUTES) {
    const g = { teamA: { starters: [{ id: 'x' }], stats: [{ id: 'x', minutes: m }] }, ignFatigue: {} };
    if (!clutchEligible(g, 'A', 0)) return m;
  }
  return null;
}

const article = n => ([8, 11, 18].includes(n) ? 'an' : 'a');
const needText = need => (need > 20 ? 'cannot convert' : need <= 1 ? 'converts on any die' : `needs ${article(need)} ${need}+`);
const listNames = names => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// ── Lineup lessons ───────────────────────────────────────────────────────────
// Keyed to phase 'draft' plus the period. They used to key on `draft.step`,
// which the secret-lineup rewrite dropped, so all six were dead and nothing
// said so — the first test in tutorialLessons.test.js now fails loudly if a
// fresh game's lineup screen has no lesson.
const inQ1 = (g, section) => g.quarter === 1 && g.section === section && !g.overtime;
const rosterWithMinutes = g => getTeam(g, 'A').roster.map(p => ({ p, min: getPS(g, 'A', p.id)?.minutes || 0 }));
/** The game with one player's tracker set to `minutes` — to ask the engine's own rules "what if". */
function withMinutes(g, teamKey, player, minutes) {
  const key = teamKey === 'A' ? 'teamA' : 'teamB';
  const t = g[key];
  return { ...g, [key]: { ...t, stats: t.stats.map(ps => (ps.id === player.id ? { ...ps, minutes } : ps)) } };
}

/**
 * Each player's OWN minutes (2026-09-18). This used to quote the first
 * starter's minutes for all five, so when the coach's Pick Up Full Court put
 * +4 on one of them the lesson told the other four they were at 8 and −2
 * while the board and s3_fatigue_warning said 4 and nothing.
 */
function secondLineupText(g) {
  const played = rosterWithMinutes(g).filter(r => r.min > 0);
  if (!played.length) return `Section 2 lineup. Last section's five have ${SECTION_MINUTES} minutes on the fatigue tracker.`;
  const byMin = new Map();
  [...played].sort((x, y) => y.min - x.min).forEach(r => byMin.set(r.min, [...(byMin.get(r.min) || []), r.p.name]));
  const penalty = m => (fatigueForMinutes(m) < 0 ? `${fatigueForMinutes(m)}` : 'no penalty');
  const groups = [...byMin].map(([min, names]) => {
    const one = names.length === 1;
    const next = min + SECTION_MINUTES;
    const now = `${listNames(names)} ${one ? 'has' : 'have'} ${min} minutes on the fatigue tracker — ${fatigueForMinutes(min) < 0 ? `${penalty(min)} already` : 'no penalty yet'}.`;
    // At the limit, the next section is a MUST REST, not a penalty
    // (2026-09-18): a hounded starter at 8 was told he would play at −6 on
    // 12, and at the S3 lineup his tile was disabled. mustRest decides it,
    // read on this game with his minutes moved on a section.
    const who = rosterWithMinutes(g).find(r => r.p.name === names[0]).p;
    if (mustRest(withMinutes(g, 'A', who, next), 'A', who)) {
      return `${now} Start ${one ? 'him' : 'them'} again and ${one ? 'he reaches' : 'they reach'} ${next}, the ${MAX_STRAIGHT_MINUTES}-minute limit: ${one ? 'he' : 'they'} must sit the section after.`;
    }
    return `${now} Start ${one ? 'him' : 'them'} again and ${one ? 'he reaches' : 'they reach'} ${next}: ${penalty(next)} on every scoring roll and every 3PT or paint check.`;
  });
  return `Section 2 lineup. ${[...groups, ...extraMinutesReasons(g, played)].join(' ')}`;
}

/**
 * Why a player carries more than one section's minutes at the S2 lineup
 * (2026-09-18): a man at 8 after one section looked like a board bug when
 * nothing said the coach's Pick Up Full Court had put 4 on him. Read from
 * the section just played (sectionLog starts at its lineup lock).
 */
function extraMinutesReasons(g, played) {
  const log = sectionLog(g);
  return played.filter(r => r.min > SECTION_MINUTES).map(r => {
    const extra = r.min - SECTION_MINUTES;
    const hounded = log.some(e => e.team === 'B' && e.msg.startsWith(`Pick Up Full Court: ${r.p.name} hounded`));
    return hounded
      ? `The coach's Pick Up Full Court put the extra ${extra} on ${r.p.name}.`
      : `${r.p.name} carries ${extra} more than one section puts on.`;
  });
}

function fatigueWarningText(g) {
  const tired = rosterWithMinutes(g).filter(r => fatigueForMinutes(r.min) < 0);
  const names = tired.map(r => `${r.p.name} (${r.min} min, ${fatigueForMinutes(r.min)})`);
  return `Section ${g.section} — check fatigue. ${listNames(names)} ${tired.length === 1 ? 'is' : 'are'} tired: the penalty rides on every scoring roll AND every 3PT and paint check. Consider resting ${tired.length === 1 ? 'him' : 'them'}.`;
}

/** The players one section from the twelve-straight limit, and any already over it. */
function nearLimit(g) {
  const rows = rosterWithMinutes(g);
  return {
    over: rows.filter(r => mustRest(g, 'A', r.p)),
    near: rows.filter(r => r.min < MAX_STRAIGHT_MINUTES && r.min + SECTION_MINUTES >= MAX_STRAIGHT_MINUTES),
  };
}
function twelveLimitText(g) {
  const { over, near } = nearLimit(g);
  const parts = [`${MAX_STRAIGHT_MINUTES} straight minutes is the limit: a player with ${MAX_STRAIGHT_MINUTES} or more on the tracker must sit the next section — his tile reads MUST REST and cannot be picked.`];
  if (over.length) parts.push(`${listNames(over.map(r => r.p.name))} ${over.length === 1 ? 'is' : 'are'} there now.`);
  // No names here (2026-09-18): s3_fatigue_warning has just named the same
  // players with their minutes, on the same screen.
  if (near.length) {
    const m = near[0].min;
    const one = near.length === 1;
    const whom = one ? near[0].p.name : near.length === 5 ? 'Your five' : `Your ${near.length}`;
    parts.push(`${whom} at ${m} minutes ${one ? 'is' : 'are'} one section from ${MAX_STRAIGHT_MINUTES}: start ${one ? 'him' : 'them'} now and ${one ? 'he sits' : 'they sit'} out the next section whether you like it or not.`);
  }
  // A player who rotated his fives has nobody near (2026-09-18) — and he is
  // the one s2_draft_reminder nudged to rotate, so the limit is still taught.
  if (!over.length && !near.length) {
    parts.push(`Nobody of yours is one section from it yet: a player who starts ${MAX_STRAIGHT_MINUTES / SECTION_MINUTES} sections in a row gets there.`);
  }
  // Said plainly, because the tutorial's next section is Q4's last, where the
  // rule is lifted: the lesson must not promise a MUST REST the player will
  // not see. Worded to read with or without the sentence before it.
  if (isSkipPoint(g)) parts.push("(In a full game the next section is the second quarter's first; the tutorial skips to the fourth quarter next, where the limit is lifted.)");
  return parts.join(' ');
}

function substitutionText() {
  const at8 = restMinutes(8);
  const at12 = restMinutes(12);
  return `Smart substitution: sit a tired player for a fresh one. A player at 8 minutes who sits this section comes back at ${at8}${at8 === 0 ? ' — fresh' : ''}; one at 12 comes back at ${at12}, still ${fatigueForMinutes(at12)}, and needs another section off. The bench also wipes his markers, hot and cold.`;
}

// ── Scoring lessons ──────────────────────────────────────────────────────────

/** Every slot on both sides rolled or blocked — PhaseBar's test for showing End Section. */
function allRolled(g) {
  const done = k => {
    const rr = g.rollResults?.[k] || [];
    const blocked = g.blockedRolls?.[k] || {};
    return [0, 1, 2, 3, 4].every(i => rr[i] != null || blocked[i] === true);
  };
  return done('A') && done('B');
}

/** A's starter carrying the heaviest fatigue penalty, or null. */
function tiredStarter(g) {
  const A = getTeam(g, 'A');
  let worst = null;
  A.starters.forEach((p, i) => {
    const fat = getFatigue(g, 'A', i);
    if (fat < 0 && (!worst || fat < worst.fat)) worst = { p, i, fat };
  });
  return worst;
}
function fatigueChecksText(g) {
  const t = tiredStarter(g);
  if (!t) return 'Fatigue rides on shot checks as well as rolls.';
  const three = checkNeed(g, 'A', t.i, '3pt');
  const paint = checkNeed(g, 'A', t.i, 'paint');
  return `${t.p.name} is carrying ${t.fat} from the fatigue tracker, and it is not only his scoring roll that pays: his 3PT and paint checks take it too. Right now a 3PT check ${needText(three.need)} on the die and a paint check ${needText(paint.need)}. Free throws are exempt.`;
}

/**
 * One of A's players ON THE FLOOR carrying a marker — one whose markers do not
 * cancel, when there is one. Starters only (2026-09-18): a man who went hot in
 * S2 and sits S3 keeps the marker until that section ends, and the lesson told
 * him "+2 on his scoring rolls" in a section he has no roll in.
 */
function markerHolder(g) {
  const carrying = (getTeam(g, 'A').starters || []).filter(Boolean)
    .map(p => ({ p, ps: getPS(g, 'A', p.id) || {} }))
    .filter(r => (r.ps.hot || 0) + (r.ps.cold || 0) > 0);
  return carrying.find(r => (r.ps.hot || 0) !== (r.ps.cold || 0)) || carrying[0] || null;
}
function markerText(g) {
  const r = markerHolder(g);
  const step = markerStep();
  const net = r ? ((r.ps.hot || 0) - (r.ps.cold || 0)) * step : 0;
  const carrying = r ? [r.ps.hot ? `${r.ps.hot} hot` : '', r.ps.cold ? `${r.ps.cold} cold` : ''].filter(Boolean).join(' and ') : '';
  // A hot and a cold on one man cancel (2026-09-18): "+0 on his rolls" read
  // as a bug to a new player.
  const head = !r
    ? 'Markers ride on rolls and checks alike.'
    : net === 0
      ? `${r.p.name} is carrying ${carrying} — they cancel out, so his scoring rolls and his 3PT and paint checks are back to even.`
      : `${r.p.name} is carrying ${carrying} — ${net > 0 ? '+' : ''}${net} on his scoring rolls AND his 3PT and paint checks.`;
  return `${head} A natural ${HOT_FROM}-20 on a roll or a check adds a hot marker (+${step}); a natural 1-${COLD_TO} adds a cold one (−${step}). They stack.`;
}

/** The forfeit-family card in A's hand, if any. */
const heldForfeit = g => getTeam(g, 'A').hand.find(id => FORFEIT_CARDS[id]) || null;
function forfeitRows(g) {
  const id = heldForfeit(g);
  if (!id) return [];
  return getTeam(g, 'A').starters.map((_, i) => forfeitNet(g, 'A', i, id)).filter(Boolean).sort((a, b) => b.net - a.net);
}
function forfeitText(g) {
  const id = heldForfeit(g);
  const name = getStrat(id)?.name ?? id;
  const rows = forfeitRows(g);
  const f = n => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;
  // Cross-Court Dime also costs assists, which forfeitNet takes off the net —
  // said, so "checks minus roll" is not left a number short (2026-09-18).
  const ast = FORFEIT_CARDS[id]?.assists || 0;
  const lead = `${name} replaces a player's scoring roll with shot checks, so its price is the roll he gives up${ast ? `, plus ${ast} assists` : ''}.`;
  if (!rows.length) return `${lead} Nobody on your floor is a legal target right now.`;
  const best = rows[0];
  const worst = rows[rows.length - 1];
  const why = r => `(checks ${r.checks.toFixed(1)} vs roll ${r.roll.toFixed(1)}${ast ? `, less ${r.cost.toFixed(1)} for the assists` : ''})`;
  const tail = worst !== best ? `; worst is ${worst.player.name} at ${f(worst.net)} ${why(worst)}` : '';
  // What the player SEES, not the prop's name (2026-09-18): "the coach tip"
  // read as the opponent's; the picker prints the net beside each name.
  return `${lead} When you play it, the player picker prints each player's net in expected points (the same sum the coach plays by): best now is ${best.player.name} at ${f(best.net)} ${why(best)}${tail}.`;
}
const FORFEIT_NAMES = Object.keys(FORFEIT_CARDS).map(id => getStrat(id)?.name ?? id);
/**
 * A hand card of YOURS, by id (2026-09-18). The tutorial deals the coach's
 * hand face up, so `[data-card-id]` lit the coach's copy too; CourtBoard's
 * hand cards carry `data-tutorial="card-<team>-<id>"` for this.
 */
export const myCard = id => `[data-tutorial="card-A-${id}"]`;
const FORFEIT_HIGHLIGHT = Object.keys(FORFEIT_CARDS).map(myCard).join(', ');

// ── Card windows, placement undo, the put-back ───────────────────────────────

function priorityText(g) {
  // The coach's last move is read from its last line IN the window, not from
  // a 0 on the count (2026-09-18): the window also OPENS at 0/2, so a switch
  // played during placement had this say the coach played a card before it
  // had moved at all. The count itself is still the board's.
  const passes = g.matchupPasses || 0;
  const moves = coachWindowMoves(g);
  const last = moves.length ? moveOf(moves[moves.length - 1]) : null;
  const now = !last
    ? `The window has just opened and the coach has not moved yet: ${passes}/2.`
    : last.kind === 'pass'
      ? `The coach just passed, so the count reads ${passes}/2 — pass now and the window closes.`
      : `The coach's last move was a card, which reset it again: ${passes}/2.`;
  return `Every card played hands the turn to the other side and resets the pass count to 0 — it takes two passes IN A ROW to close a window. ${now}`;
}

/**
 * Nothing but placements since YOUR last placement: what canUndoPlacement
 * needs besides the board's snapshot, which is taken at that placement. It
 * used to read from the lineup lock, so a card put back before your first
 * pick kept the lesson dead while the board offered ↩ Undo (2026-09-18).
 */
function onlyPlacements(g) {
  const log = sectionLog(g);
  let at = -1;
  for (let i = log.length - 1; i >= 0; i -= 1) if (log[i].team === 'A' && /takes the floor\.$/.test(log[i].msg)) { at = i; break; }
  return at >= 0 && log.slice(at + 1).every(e => e.team == null || (e.team === 'B' && /takes the floor\.$/.test(e.msg)));
}
function placementUndoText(g) {
  const mine = getTeam(g, 'A').starters[getTeam(g, 'A').starters.length - 1];
  return `Placed the wrong player? ↩ Undo in the bar takes ${mine ? mine.name : 'your last placement'} back off the floor — and the coach's reply with him — until you place again. The coach then answers the player you put down instead.`;
}

function putBackText(g) {
  const back = lastReturnedCard(g, 'A');
  return `${back ? back.name : 'That card'} is on the bottom of your deck. Changed your mind? ↩ Undo in your hand's header takes it back — for the rest of this section, as long as it is still the bottom card.`;
}

// ── Crunch Time ──────────────────────────────────────────────────────────────
const inCrunchSection = g => g.quarter === 4 && g.section === 3;
const crunchOn = g => Boolean(g.crunch?.active);
const rollingOpen = g => g.phase === 'scoring' && (g.scoringPasses || 0) >= 99;

function skipAheadText(g) {
  // The staged score is SAID (2026-09-18): stageCrunch writes what it changed
  // on the game, and a player who watched Q1 end 12–27 should not meet 23–27
  // unexplained.
  const st = g.tutorialStaged;
  const staged = st ? ` (The first quarter ended ${st.from.A}–${st.from.B}; the tutorial brought ${st.teamName} to within ${st.lead} so the finish is close.)` : '';
  return `That was your first quarter. The tutorial now skips to the final section of the fourth — ${periodLabel(g)} — with the score ${g.teamA.score}–${g.teamB.score}.${staged} Halftime wiped the fatigue tracker; the five who just played carry that one section (${SECTION_MINUTES} minutes). The ${MAX_STRAIGHT_MINUTES}-minute limit is ${restRuleLifted(g) ? 'lifted for the fourth quarter and overtime: anyone may play' : 'still on'}.`;
}
function crunchIntroText(g) {
  const m = g.crunch?.margin ?? Math.abs(g.teamA.score - g.teamB.score);
  if (!crunchOn(g)) return `The margin is ${m}, wider than ${CRUNCH_MARGIN}: no Crunch Time this game.`;
  // The contest is said before it is bumped (2026-09-18): no earlier lesson
  // teaches it, and "Def Boost" is the name every other lesson uses.
  const base = contestPerDefBoost();
  const bump = crunchContestBump();
  const contest = base > 0 && bump > 0
    ? ` A defender's Def Boost is always taken off the 3PT and paint checks of the man he guards — his contest; in Crunch Time he takes ${bump} more.`
    : '';
  return `🚨 Crunch Time is armed: the margin is ${m}, inside ${CRUNCH_MARGIN}. For this section each side holds one Clutch Possession and one Timeout, and crunch-only cards stay in hand when drawn.${contest}`;
}
function clutchText(g) {
  const A = getTeam(g, 'A');
  const base = clutchDiceFor(g, {});
  // Whose is whose (2026-09-18): the coach's award winners were listed right
  // after "one of your players", and read as yours.
  const mine = A.starters.filter(p => clutchDiceFor(g, p) > base).map(p => `your ${p.name} rolls ${clutchDiceFor(g, p)}`);
  const theirs = getTeam(g, 'B').starters.filter(p => clutchDiceFor(g, p) > base).map(p => `the coach's ${p.name} rolls ${clutchDiceFor(g, p)}`);
  const extra = [...mine, ...theirs];
  const gassed = A.starters.filter((p, i) => !clutchEligible(g, 'A', i)).map(p => p.name);
  const left = clutchAvailable(g, 'A');
  return `⭐ Clutch Possession: ${left === 1 ? 'once' : `${left} times`} this section, one of your players can roll ${base} dice and keep the best — press ⭐ Clutch instead of Roll.${extra.length ? ` An MVP or Clutch Player of the Year award on the card adds a die: ${listNames(extra)}.` : ''}${gassed.length ? ` ${listNames(gassed)} ${gassed.length === 1 ? 'is' : 'are'} too tired to go clutch.` : ''}`;
}
/** A slot of yours the ⭐ Clutch button is drawn on: it can still roll and the player is not gassed. */
const clutchSlotOpen = g => [0, 1, 2, 3, 4].some(i => canRollSlot(g, 'A', i) && clutchEligible(g, 'A', i));
// The timeout riders by name, from the one list canPlay gates on
// (2026-09-18): "timeout cards" was jargon no lesson defined.
const nameOf = id => getStrat(id)?.name ?? id;
const RIDER_NAMES = TIMEOUT_RIDERS.map(nameOf);
function timeoutText() {
  // Per Crunch-Time section, not per game: endSection hands out a fresh one
  // at every Q4 S3 and overtime (2026-09-18).
  // "the coach's matchup search" read as the opponent choosing your defence
  // (2026-09-18); it is aiSetMatchups drawing up YOUR best assignment.
  return `⏸ Timeout — one per team in Crunch Time (an overtime brings a fresh one), called during the rolling once the other team has rolled. It re-sets your whole defence to the best assignment the game can find for you, lets you search your deck for one crunch-only card, and opens a window for the cards that play only in your own timeout: ${listNames(RIDER_NAMES)}. The coach calls its own the moment it is allowed: right after your first roll.`;
}
function searchText(g) {
  const options = crunchSearchOptions(g, 'A');
  const names = options.map(nameOf);
  const riders = options.filter(id => TIMEOUT_RIDERS.includes(id)).map(nameOf);
  const ridersLine = riders.length
    ? ` Of these, ${listNames(riders)} ${riders.length === 1 ? 'plays' : 'play'} only in your own timeout: take ${riders.length === 1 ? 'it' : 'one'} and it must be played before ▶ Resume play, or it waits for another timeout.`
    : ` None of these plays in the timeout itself (that is ${listNames(RIDER_NAMES)}); what you take is for the rest of the section.`;
  return `Your timeout is on and the defence is re-set. 🔍 Search deck takes one crunch-only card from your deck into your hand — over the ${HAND_SIZE}-card limit — then shuffles the deck. In your deck now: ${listNames(names)}.${ridersLine}`;
}
/** What to do before ▶ Resume play: the timeout riders in YOUR hand, and whether each can be played now. */
function resumeText(g) {
  const held = getTeam(g, 'A').hand.filter(id => TIMEOUT_RIDERS.includes(id));
  const live = held.filter(id => canPlayCard(g, 'A', id).canPlay);
  const tail = 'then ▶ Resume play. Your timeout is spent for this section.';
  if (live.length) return `Play ${listNames(live.map(nameOf))} now — ${live.length === 1 ? 'it plays' : 'they play'} only while your timeout is on — ${tail}`;
  if (held.length) return `You hold ${listNames(held.map(nameOf))}, but ${held.length === 1 ? 'it has' : 'they have'} nothing to act on right now (a dimmed card says why): ${tail}`;
  return `You hold none of the cards that play in a timeout (${listNames(RIDER_NAMES)}), so ▶ Resume play. Your timeout is spent for this section.`;
}
function overtimeText(g) {
  // Which period ended tied (2026-09-18): at a second overtime this said
  // "after regulation" over the score the FIRST overtime ended on.
  const n = g.overtime || 1;
  const after = n === 1 ? 'regulation' : n === 2 ? 'the first overtime' : periodLabel({ ...g, overtime: n - 1 });
  return `Tied at ${g.teamA.score} after ${after}: ${periodLabel(g)}. Overtime is another Crunch-Time section — a fresh Clutch Possession, a fresh timeout and a fresh deck search — as many as it takes.`;
}

// ── What the tutorial leaves for the real game ───────────────────────────────
/** The completion screen's list, each line computed from the table the game reads. */
export function whatsNext() {
  const ladder = Object.values(AI_PAY);
  // The default rung, read from aiLevels (2026-09-18), not named here.
  const fair = AI_PAY[DEFAULT_AI_LEVEL];
  const easier = ladder.filter(r => r.pay < fair.pay);
  const harder = ladder.filter(r => r.pay > fair.pay);
  const deck = Object.values(DEFAULT_DECK_COPIES).reduce((a, b) => a + b, 0);
  const caps = STRAT_COPY_CAPS;
  return [
    // Short, as the spec asked: the limit plus one clause of the rest rule.
    `${MAX_STRAIGHT_MINUTES} straight minutes is the limit: a player at ${MAX_STRAIGHT_MINUTES}+ sits the next section, except in the fourth quarter and overtime. A section on the bench clears a tracker at ${REST_CLEARS_AT} minutes or less and takes ${REST_RECOVERY} off above that.`,
    `Coaches run from ${ladder[0].label} to ${ladder[ladder.length - 1].label}. ${fair.label} is the fair default and pays the standard rate (${fair.pay}×); ${listNames(easier.map(r => `${r.label} ${r.pay}×`))} are easier and pay less; ${listNames(harder.map(r => `${r.label} ${r.pay}×`))} field better-built teams and pay more.`,
    `A deck is ${deck} strategy cards, at most ${caps.common} copies of a common, ${caps.uncommon} of an uncommon, ${caps.rare} of a rare and ${caps.legendary} of a legendary.`,
    `Spends: ${SPEND_COSTS.assistBoost} AST for +1 on a shot check, ${SPEND_COSTS.assistThree} AST for a 3PT check, ${SPEND_COSTS.assistPaint} AST for a paint check, ${SPEND_COSTS.reboundPaint} REB for a paint check (at +${REB_LEAD_BONUS} the first time after a section you finish ${REB_LEAD_FOR_BONUS}+ ahead on the rebound track).`,
    'A tie after regulation goes to overtime: another Crunch-Time section, with a fresh Clutch Possession, timeout and deck search.',
  ];
}

export const TUTORIAL_TOOLTIPS = [
  // ── Section 1: Learn the Basics ──────────────────────────────────────────

  // Lineup
  {
    id: 's1_draft_intro',
    text: "Welcome! First, pick your five starters from the ten on your roster and lock them in. The coach picks its five at the same time, and neither side sees the other's until both have locked.",
    detail: "Look at each player's Speed, Power, and Shot Line. High Speed excels at perimeter play; high Power dominates inside. Low Shot Lines mean better shooters. Five sit out every section, so think about who rests.",
    section: 1,
    priority: 100,
    trigger: { phase: 'draft', condition: (g) => inQ1(g, 1) },
  },
  {
    // Shown after the intro's "Got it": the overlay orders live lessons by
    // priority and hides the dismissed, which is the only order it can see —
    // how many players are ticked lives in the board's own state.
    id: 's1_draft_pick1',
    // No salary talk or slang on the first screen (2026-09-18): "cheaper
    // legs" leaned on a salary nothing had introduced.
    text: "Balance the five. Players with a Def Boost neutralise an opponent's edge without a card, and starting your lesser players now keeps your stars fresh for later.",
    // Something the text does not already say (2026-09-18), from the engine.
    detail: () => `Each section on the floor adds ${SECTION_MINUTES} minutes to the fatigue tracker; at ${firstTiredMinutes()} a player is ${fatigueForMinutes(firstTiredMinutes())} on every scoring roll and every 3PT or paint check (free throws are exempt).`,
    section: 1,
    priority: 90,
    trigger: { phase: 'draft', condition: (g) => inQ1(g, 1) },
  },

  // Placement — the snake, then the coach's answer, then reading the picker
  {
    id: 's1_place_intro',
    // The order off the game (2026-09-18), not retyped: a season's visitor
    // leads, and the letters meant nothing until "A is you" was said.
    text: (g) => `Placement! You and the coach take turns placing your five in the snake ${(g.placementOrder ?? DEFAULT_ORDER).join('-')} (A is you). The row a player lands in is their matchup: the two players in a row guard each other all section.`,
    detail: "Lead a row with a player who does fine against anyone; keep your best scorer to counter-pick a row the coach has already filled. Nothing re-deals the pairings afterwards except a switching card.",
    section: 1,
    priority: 100,
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 1 && step(g) === 0 },
  },
  {
    id: 's1_place_answer',
    text: placementAnswer,
    detail: null,
    section: 1,
    priority: 100,
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 1 && step(g) === 3 },
  },
  {
    id: 's1_place_indicators',
    text: placementIndicators,
    detail: placementIndicatorsDetail,
    section: 1,
    priority: 90,
    // A's answering turns: step 3 (row 2) and step 7 (row 4).
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 1 && (step(g) === 3 || step(g) === 7) },
  },

  // Section 1's switch LANDS — the coach was dealt no canceller (tutorialHands.js)
  {
    id: 's1_switch_landed',
    text: switchLandedText,
    // The tutorial coach always answers (ai.js DEMO_CANCEL_VALUE), so the
    // detail no longer says it weighs the cost first (2026-09-18).
    detail: "A defence holding Go Under, Fight Over or Veer Switch can cancel a switch, each at a price. Next section this coach will be holding one, and in the tutorial it always answers — watch what it does.",
    section: 1,
    priority: 95,
    // Fires once the coach has replied to the switch — by passing or by playing
    // any card that is not a canceller — and the turn is back with the player.
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 1 && step(g) >= 10 && Boolean(mySwitch(g)) && !theirCancel(g) && Boolean(coachReply(g)) && g.matchupTurn === 'A' },
  },
  {
    // The priority rule's reset and the Lock shortcut, taught the moment a
    // card has been played and answered — the count on the bar is the proof.
    id: 's1_priority_reset',
    text: priorityText,
    detail: 'Lock → Scoring closes the matchup window at once, without waiting for the passes — use it when you have nothing left to play.',
    highlight: '[data-tutorial="lock-scoring"]',
    section: 1,
    priority: 85,
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 1 && step(g) >= 10 && Boolean(mySwitch(g)) && Boolean(coachReply(g)) && g.matchupTurn === 'A' },
  },

  // Matchup card window — the switch, and why
  {
    id: 's1_matchup_window',
    text: screenRollText,
    // Lock is taught here too (2026-09-18): s1_priority_reset needs your
    // switch AND the coach's reply, so a player who passed never met it.
    detail: "Play it with ▶ on the card, then pick the two players. The coach can answer with Go Under, Fight Over or Veer Switch — each cancels the switch for a price. Playing a card hands the turn over; two passes in a row close the window. Nothing to play? Lock → Scoring closes the window at once.",
    highlight: myCard('high_screen_roll'),
    section: 1,
    priority: 100,
    // While the card is in hand and not yet played (2026-09-18): after the
    // switch, a coach's card put the count back to 0 and this lit up again
    // over a card that was gone. And on your turn only (2026-09-18): on the
    // coach's the card is dimmed, and the lesson called it lit.
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 1 && step(g) >= 10 && g.matchupTurn === 'A' && (g.matchupPasses || 0) === 0 && !mySwitch(g) && getTeam(g, 'A').hand.includes('high_screen_roll') },
  },

  // Scoring
  {
    id: 's1_scoring_intro',
    text: "Scoring card window! Same rule: play a card or pass, and two passes in a row open rolling. Each player then rolls a D20 plus their matchup bonus to score.",
    detail: "Your roll is modified by matchup advantage, fatigue (none yet!), and hot/cold markers. The result is looked up on the player's scoring chart for points, rebounds, and assists.",
    section: 1,
    priority: 100,
    // The whole window, not just 0 passes (2026-09-18): the window opens on
    // the coach's turn, and when it passed first the lesson was gone before
    // the player could act.
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 1 && (g.scoringPasses || 0) < 2 },
  },
  {
    // The hover-and-click hand this described is gone (2026-09-18): cards
    // carry 👁 / ↩ / ▶ icons, and a play asks for a confirm.
    id: 's1_first_card',
    text: "Your hand (the Team A panel): ▶ on a card plays it — you confirm before it goes — and 👁 opens the whole card. A dimmed card says why it can't be played right now.",
    detail: "↩ puts a card on the bottom of your deck, any time, for free. Changed your mind? The ↩ Undo that appears in your hand's header takes it back for the rest of the section, as long as it is still the bottom card.",
    section: 1,
    priority: 80,
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 1 && g.scoringPasses < 2 },
  },
  {
    id: 's1_putback_undo',
    text: putBackText,
    detail: 'A card played stays played. A put-back draws nothing and shows the coach nothing it could not already read in the log, so taking it back costs nobody anything.',
    highlight: '[data-tutorial="hand-undo"]',
    section: 1,
    priority: 97,
    // Not on a lineup screen (2026-09-18): overtime keeps Q4 S3, so a
    // regulation put-back still reads as this section's there, and the lineup
    // screen draws no hand and no ↩ Undo to point at.
    trigger: { condition: (g) => g.phase !== 'draft' && Boolean(lastReturnedCard(g, 'A')) },
  },
  {
    // The a-b-a-b rule is now ENFORCED on the tutorial board (rollGate, as
    // PlayTab) — it was stated here and the coach rolled on a timer.
    id: 's1_rolling_open',
    // The reaction window is AFTER the coach's die lands, when rollGate hands
    // the turn back (2026-09-18) — its die lands 800 ms into its turn.
    text: "Rolling is open, and it takes turns: you roll one player, then the coach rolls one, and the turn comes back to you. That is when a reaction to its die, like Cold Spell on a natural 1 or 2, can be played. While it is the coach's die your buttons read 'Their roll'.",
    detail: () => `A natural ${HOT_FROM}-20 leaves a hot marker, a natural 1-${COLD_TO} a cold one: ±${markerStep()} each on that player's later rolls and checks.`,
    section: 1,
    priority: 90,
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 1 && g.scoringPasses >= 99 },
  },
  {
    id: 's1_markers',
    text: markerText,
    detail: 'A section on the bench clears them, and so does halftime.',
    section: 1,
    // 65, not 70: s2_assists_intro is 70 and live at the same moments in S2,
    // and a tie leaves the order to the array (2026-09-18).
    priority: 65,
    trigger: { phase: 'scoring', condition: (g) => Boolean(markerHolder(g)) },
  },
  {
    id: 's1_end_section',
    text: "All players have rolled! Review the section results. The team winning the rebound track gets +1 assist. Click 'End Section' to move on.",
    detail: () => `At the end of each section temporary effects clear, the five who played add ${SECTION_MINUTES} minutes to the fatigue tracker, and both teams draw back up to ${HAND_SIZE} cards. ${restRuleText()}`,
    section: 1,
    priority: 100,
    // The board's own test for End Section (PhaseBar): a slot is done when it
    // rolled OR was blocked. Requiring ten results missed every section where
    // This Is My House shut a roll out (2026-09-18).
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 1 && allRolled(g) },
  },

  // ── Section 2: Deeper Strategy ───────────────────────────────────────────

  {
    id: 's2_draft_reminder',
    text: secondLineupText,
    detail: restRuleText,
    section: 2,
    priority: 80,
    trigger: { phase: 'draft', condition: (g) => inQ1(g, 2) },
  },
  {
    // Undo is live from your placement until you place again; step 3 is the
    // first moment the coach has answered and you have not. The snapshot it
    // needs is the board's; the log test is the half the lesson can read.
    id: 's2_place_undo',
    text: placementUndoText,
    detail: 'A card played, a pass or a lock ends it: from then on the placement stands.',
    highlight: '[data-tutorial="placement-undo"]',
    section: 2,
    priority: 90,
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 2 && step(g) === 3 && onlyPlacements(g) },
  },
  // Section 2: the same switch, and the coach's answer to it
  {
    id: 's2_switch_again',
    text: "Play your High Screen & Roll again. This time the coach is holding a canceller — see what it does with it.",
    detail: null,
    highlight: myCard('high_screen_roll'),
    section: 2,
    priority: 100,
    // Not once the coach has cancelled (2026-09-18): a second High Screen &
    // Roll in hand after the lesson has played out is not "again".
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 2 && step(g) >= 10 && !mySwitch(g) && !theirCancel(g) && getTeam(g, 'A').hand.includes('high_screen_roll') },
  },
  {
    id: 's2_switch_cancelled',
    text: switchCancelledText,
    detail: "One canceller per switch. When you hold Go Under, Fight Over or Veer Switch yourself, they light up the moment the coach switches.",
    section: 2,
    priority: 100,
    // Never on a lineup screen (2026-09-18): there sectionLog still starts at
    // the section just played, and the lesson narrated its cancel as this
    // section's. From the S2 lock on, the log is S2's own.
    trigger: { condition: (g) => g.phase !== 'draft' && g.quarter === 1 && g.section === 2 && Boolean(theirCancel(g)) },
  },
  {
    id: 's2_assists_intro',
    text: "Did you notice your assist and rebound tracks? You can spend them on bonus shot checks! Check the buttons below each player.",
    detail: () => `${SPEND_COSTS.assistBoost} AST = +1 to a shot check. ${SPEND_COSTS.assistThree} AST = a 3PT check, ${SPEND_COSTS.assistPaint} AST = a paint check, for any player — their bonus rides on the die, and the button shows the roll he needs. Rebounds spend the same way: ${SPEND_COSTS.reboundPaint} REB buys a paint check for any player, at +${REB_LEAD_BONUS} the first time after a section you finish ${REB_LEAD_FOR_BONUS}+ ahead on the rebound track. The track counts rebounds won, so spending never moves it. The first time you reach 5 assists you draw a bonus card!`,
    section: 2,
    priority: 70,
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 2 && g.scoringPasses >= 99 },
  },
  {
    id: 's2_reaction_cards',
    text: "Keep an eye on your reaction cards — Close Out takes 3 off an opponent's announced 3PT check, and Cold Spell punishes a natural 1 or 2. The game asks you when one can be played.",
    section: 2,
    priority: 60,
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 2 && g.scoringPasses < 2 },
  },

  // ── Section 3: Fatigue & Substitutions ───────────────────────────────────

  {
    id: 's3_fatigue_warning',
    text: fatigueWarningText,
    // The ladder only (2026-09-18): s3_sub_strategy, next on this screen,
    // gives the rest numbers, and three lessons in a row said them.
    detail: () => `Fatigue: ${fatigueLadderText()} Halftime wipes the tracker and every marker.`,
    section: 3,
    priority: 100,
    // S3 only (2026-09-18): at S2 a hounded starter drew this, s3_twelve_limit
    // and s2_draft_reminder in a row, all on his 8 minutes, and used up the
    // S3 lessons; s2_draft_reminder gives each player's penalty at S2.
    trigger: { phase: 'draft', condition: (g) => inQ1(g, 3) && rosterWithMinutes(g).some(r => fatigueForMinutes(r.min) < 0) },
  },
  {
    // Forward text: at Q1S3 nobody is at twelve yet, but the five who have
    // started twice are one section from it. The highlight lands on the
    // lineup tile's minutes tag, which reads MUST REST once the rule bites.
    id: 's3_twelve_limit',
    text: twelveLimitText,
    detail: 'The limit lifts for the fourth quarter and any overtime. It bends before it breaks the game: with fewer than five rested enough, the limit is waived for that section and anyone may play (the coach takes its least tired first). Halftime wipes the tracker, so the count restarts for the second half.',
    highlight: '[data-tutorial="must-rest"], [data-tutorial="lineup-minutes"]',
    section: 3,
    priority: 95,
    // Q1 S3, the forward moment (2026-09-18): it had no section check and
    // fired at S2 too, which spent it before the screen it was written for.
    // And for everyone (2026-09-18): keyed on somebody near the limit, it
    // never reached a player who rotated his fives — the rule showed up only
    // on the completion screen.
    trigger: { phase: 'draft', condition: (g) => inQ1(g, 3) && !restRuleLifted(g) },
  },
  {
    id: 's3_sub_strategy',
    text: substitutionText,
    section: 3,
    priority: 90,
    trigger: { phase: 'draft', condition: (g) => inQ1(g, 3) },
  },
  {
    id: 's3_fatigue_checks',
    text: fatigueChecksText,
    detail: "The 'needs' number on the spend buttons already counts it.",
    section: 3,
    priority: 85,
    trigger: { phase: 'scoring', condition: (g) => Boolean(tiredStarter(g)) },
  },
  {
    // The coach tip the board prints on this family in the tutorial (and
    // below Deity), taught with the same forfeitNet it prints. teachingHands
    // deals one into Q1S3 when the deck still holds one.
    id: 's3_forfeit_tip',
    text: forfeitText,
    detail: `Your best scorer is usually the worst target: his roll is the most you give up. The family: ${listNames(FORFEIT_NAMES)}.`,
    highlight: FORFEIT_HIGHLIGHT,
    section: 3,
    priority: 80,
    // From Q1 S3 on (2026-09-18): a forfeit card drawn in S2 put it ahead of
    // s2_assists_intro, the first lesson to mention shot checks, in about a
    // quarter of tutorials. The Q4 section keeps it.
    trigger: { phase: 'scoring', condition: (g) => !(g.quarter === 1 && g.section < 3) && Boolean(heldForfeit(g)) && forfeitRows(g).length > 0 },
  },

  // ── Section 4: Crunch Time (the tutorial skips from Q1 to Q4's last section — tutorialFlow.js) ──

  {
    // Was the Q1-end message, keyed on a draft step and a quarter the tutorial
    // never showed a lesson in. It opens the skip-ahead section now.
    id: 's3_quarter_end',
    text: skipAheadText,
    detail: null,
    section: 4,
    priority: 100,
    trigger: { phase: 'draft', condition: (g) => inCrunchSection(g) && !g.overtime },
  },
  {
    id: 's4_crunch_intro',
    text: crunchIntroText,
    detail: null,
    section: 4,
    priority: 95,
    trigger: { phase: 'draft', condition: (g) => inCrunchSection(g) && !g.overtime && Boolean(g.crunch) },
  },
  {
    id: 's4_timeout',
    text: timeoutText,
    detail: 'An unused timeout does not carry over.',
    highlight: '[data-tutorial="timeout"]',
    section: 4,
    priority: 100,
    // When the timeout is LEGAL, not when rolling opens: the other team rolls
    // first (timeoutProblem, 2026-09-25), so the Clutch lesson comes first, on
    // your opening roll, and this one once the coach has answered it.
    trigger: { phase: 'scoring', condition: (g) => crunchOn(g) && rollingOpen(g) && !timeoutProblem(g, 'A') },
  },
  {
    id: 's4_timeout_search',
    text: searchText,
    detail: 'Once per timeout — a crunch card drawn outside Crunch Time goes to the bottom of the deck, which is why the deck still holds them.',
    highlight: '[data-tutorial="search-deck"]',
    section: 4,
    priority: 100,
    trigger: { phase: 'scoring', condition: (g) => g.timeoutActive === 'A' && crunchSearchOptions(g, 'A').length > 0 },
  },
  {
    id: 's4_timeout_resume',
    text: resumeText,
    detail: null,
    highlight: '[data-tutorial="resume-play"]',
    section: 4,
    priority: 95,
    trigger: { phase: 'scoring', condition: (g) => g.timeoutActive === 'A' && crunchSearchOptions(g, 'A').length === 0 },
  },
  {
    id: 's4_clutch',
    text: clutchText,
    detail: () => `A player with ${clutchGateMinutes()} or more minutes on the tracker cannot go clutch. The coach has a Clutch Possession of its own.`,
    highlight: '[data-tutorial="clutch-A"]',
    section: 4,
    priority: 90,
    // Exactly while the ⭐ Clutch button is drawn (2026-09-18): on your die,
    // on a slot that can still roll, for a player fresh enough to go clutch
    // (PlayerSlot's own test). rollGate alone reads A:true once every roll is
    // in, and the lesson outlived the button.
    trigger: { phase: 'scoring', condition: (g) => crunchOn(g) && rollingOpen(g) && !g.timeoutActive && clutchAvailable(g, 'A') > 0 && Boolean(rollGate(g).A) && clutchSlotOpen(g) },
  },
  {
    id: 's4_overtime',
    text: overtimeText,
    detail: null,
    section: 4,
    priority: 100,
    trigger: { phase: 'draft', condition: (g) => (g.overtime || 0) >= 1 },
  },
];

// ── Pre-set Tutorial Rosters ─────────────────────────────────────────────────
// Hand-picked balanced rosters that showcase diverse mechanics.
// These IDs match entries in CARD_MAP (FirstName_LastName format).
// Roster A: player-controlled, balanced mix of speed, power, shooting
// Roster B: AI-controlled opponent
export const TUTORIAL_ROSTER_A_IDS = [
  'Jayson_Tatum',         // Elite all-around
  'Anthony_Edwards',      // Speed star
  'Bam_Adebayo',          // Power/defense
  'Tyrese_Haliburton',    // Playmaker
  'Mikal_Bridges',        // 3&D role player
  'Jalen_Brunson',        // Mid-salary guard
  'Evan_Mobley',           // Defensive big
  'Desmond_Bane',          // Shooter
  'Derrick_Jones_Jr',      // Budget defender
  'Ayo_Dosunmu',           // Budget guard
];

export const TUTORIAL_ROSTER_B_IDS = [
  'Luka_Doncic',                 // Elite playmaker
  'Shai_Gilgeous_Alexander',     // Speed/scoring
  'Giannis_Antetokounmpo',       // Power monster
  'Damian_Lillard',              // Deep threat
  'Scottie_Barnes',              // Versatile
  'Darius_Garland',              // Mid guard
  'Jaren_Jackson_Jr',            // Rim protector
  'Tyler_Herro',                 // Shooter
  'Jose_Alvarado',               // Budget guard
  'Tari_Eason',                  // Budget forward
];
