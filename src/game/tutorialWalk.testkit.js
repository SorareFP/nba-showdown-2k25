// A WHOLE TUTORIAL, PLAYED WITHOUT A BROWSER — for the tests (2026-09-18).
//
// Not a test file (vitest runs *.test.*), a kit the tests share. It plays the
// tutorial the way the board and TutorialGame do: the lineup screen's submit
// (placement.js submitSoloLineup, the function CourtBoard's lineup screen
// calls), the placement snake through placePlayer, the card windows through
// execCard and passTurn, the dice through rollGate, the coach through
// tutorialCoachStep, and every section end through the tutorial's own
// reducer. The kit itself writes no `phase`, `scoringPasses` or log anchor —
// only the game's own functions do — so a lesson keyed to a field the engine
// stops writing goes dead in the walk too, which is the point: the draft.step
// lessons were dead for weeks because the tests set the field themselves.
//
// The human's side is a fixed, simple policy that meets every lesson: the
// same five for Q1's first three sections (so they reach the limit's
// doorstep), a canceller on the coach's switch whenever one is lit in hand,
// High Screen & Roll whenever the switch lessons want it, one card put back
// and taken back in section 1, the timeout in Crunch Time, ▶ Resolve on every
// check the coach announces, and ⭐ Clutch when the coach's own roll brain
// would (or never, with `noClutch`). `noCards`: a human who plays and puts
// back no card at all and passes every window.
//
// The coach is NOT a copy: every coach move is tutorialCoachStep, the
// function TutorialGame dispatches from (2026-09-18).
import {
  newGame, getTeam, passTurn, pickablePool, pendingRolls, rollGate, returnCardToDeck, undoReturnCard,
  crunchSearchOptions, timeoutProblem,
} from './engine.js';
import { execCard, resolveChoice } from './execCard.js';
import { canPlayCard } from './canPlay.js';
import { aiDraftPick, aiPlacementPick, aiBuildCardOpts, aiRollDecision, aiChoice } from './ai.js';
import { placePlayer, beginPlacement, submitSoloLineup, LINEUPS_LOCKED } from './placement.js';
import { CARD_MAP } from './cards.js';
import { CLUTCH_DICE } from './clutchAwards.js';
import { TUTORIAL_ROSTER_A_IDS, TUTORIAL_ROSTER_B_IDS } from './tutorialData.js';
import { teachingHands } from './tutorialHands.js';
import { tutorialReducer, tutorialCoachStep } from './tutorialFlow.js';

/** A small seeded stream for Math.random, so a walk is the same walk every run. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The tutorial's opening state, as TutorialGame builds it. */
export function tutorialStart() {
  const A = TUTORIAL_ROSTER_A_IDS.map(id => CARD_MAP[id]);
  const B = TUTORIAL_ROSTER_B_IDS.map(id => CARD_MAP[id]);
  return teachingHands(newGame(A, B, undefined, undefined, { clutchDice: CLUTCH_DICE }));
}

export const FIRST_FIVE_A = TUTORIAL_ROSTER_A_IDS.slice(0, 5);

/**
 * The lineup screen's submit — the board's OWN (placement.js
 * submitSoloLineup, which CourtBoard's lineup screen calls with aiDraftPick),
 * not a copy of it (2026-09-18): the anchor line and the pick lists the
 * lessons read cannot drift between the two. The human's part is choosing
 * the five: `aIds`, with any the twelve-straight limit bars topped up from
 * the pickable pool, as the tiles only let you tick those. `bIds` pins the
 * coach's five instead (for tests that need it), through the same
 * beginPlacement the submit ends in.
 */
export function lockLineups(game, aIds, bIds = null) {
  const eligible = new Set(pickablePool(game, 'A', game.draft.aPool).map(p => p.id));
  const wanted = aIds.filter(id => eligible.has(id));
  for (const p of game.draft.aPool) { if (wanted.length >= 5) break; if (eligible.has(p.id) && !wanted.includes(p.id)) wanted.push(p.id); }
  if (bIds) return beginPlacement(game, wanted, bIds);
  return submitSoloLineup(game, wanted, (g, key) => aiDraftPick(g, key, { iq: 1 }));
}

/** Run the snake: A places its picks in order, B places them in order too, or by aiPlacementPick. */
export function runSnake(game, { coachPicks = true } = {}) {
  let g = game;
  while ((g.placementStep ?? 10) < 10) {
    const k = g.placementOrder[g.placementStep];
    const team = getTeam(g, k);
    const picks = k === 'A' ? g.draft.aPicks : g.draft.bPicks;
    const next = k === 'B' && coachPicks
      ? aiPlacementPick(g, 'B', { iq: 1 }).playerId
      : picks.find(id => !team.starters.some(p => p.id === id));
    g = placePlayer(g, next);
  }
  return g;
}

/** Both card windows passed out, the way the pass buttons do it: straight to open rolling. */
export function passToRolling(game) {
  let g = game;
  while (g.phase === 'matchup_strats') g = passTurn(g, g.matchupTurn);
  while (g.phase === 'scoring' && (g.scoringPasses || 0) < 99) g = passTurn(g, g.scoringTurn);
  return g;
}

/** Lineups, snake and both windows: a section's rolling, opened through the real steps. */
export function openRolling(game, aIds = FIRST_FIVE_A, bIds = null) {
  return passToRolling(runSnake(lockLineups(game, aIds, bIds), { coachPicks: !bIds }));
}

const logSince = (g, re) => {
  const log = g.log || [];
  for (let i = log.length - 1; i >= 0; i -= 1) {
    if (log[i].msg === LINEUPS_LOCKED) return false;
    if (log[i].team === 'A' && re.test(log[i].msg)) return true;
  }
  return false;
};

/**
 * Play the tutorial from `game` to its end, calling `onState(g)` at every
 * state the player could see. `tieAtEnd` levels the score before Q4 S3's end
 * so overtime is reached (the dice cannot be trusted to tie it). `noClutch`:
 * the human never presses ⭐ Clutch.
 */
export function walkTutorial(game, { onState = () => {}, tieAtEnd = false, noClutch = false, noCards = false, maxSteps = 6000 } = {}) {
  let g = game;
  let putBack = false;
  for (let n = 0; n < maxSteps; n += 1) {
    onState(g);
    if (g.done) return g;
    g = nextState(g, { tieAtEnd, noClutch, noCards, putBack: () => { const was = putBack; putBack = true; return was; }, onState });
  }
  throw new Error(`walkTutorial: no end after ${maxSteps} steps (Q${g.quarter} S${g.section} ${g.phase})`);
}

/** The cards that cancel a High Screen & Roll (canPlay.js lights them only against the other side's switch). */
const CANCELLERS = ['go_under', 'fight_over', 'veer_switch'];

function nextState(g, { tieAtEnd, noClutch, noCards, putBack, onState }) {
  // The human's own pauses first: a Go Under choice that is theirs, and the
  // coach's announced checks, which wait for their ▶ Resolve.
  if (g.pendingChoice?.teamKey === 'A') {
    const r = resolveChoice(g, aiChoice(g, 'A'));
    if (r.ok) return r.game;
    throw new Error(`walk: ${g.pendingChoice.kind} choice refused: ${r.msg}`);
  }
  if (g.pendingShotCheck && g.pendingShotCheck.teamKey !== 'A') return tutorialReducer(g, { type: 'RESOLVE_CHECK' });

  if (g.phase === 'draft') return lockLineups(g, FIRST_FIVE_A);
  if (g.phase === 'matchup_strats' && (g.placementStep ?? 10) < 10) return runSnakeStep(g);

  // The coach, exactly as TutorialGame drives it.
  const coach = tutorialCoachStep(g);
  if (coach) return tutorialReducer(g, coach);
  if (g.pendingShotCheck || g.pendingChoice) throw new Error(`walk: nobody moves on a pending ${g.pendingShotCheck ? 'check' : 'choice'}`);

  if (g.phase === 'matchup_strats') {
    if (g.matchupTurn !== 'A') throw new Error('walk: the coach did not move on its matchup turn');
    if (noCards) return passTurn(g, 'A');
    // The coach's switch, answered with a canceller you hold (2026-09-18):
    // the walk never did, and s2_switch_cancelled narrated YOUR cancel as the
    // coach's, on the next lineup screen, with every walk green.
    const canceller = CANCELLERS.find(id => getTeam(g, 'A').hand.includes(id) && canPlayCard(g, 'A', id).canPlay);
    if (canceller) {
      const res = execCard(g, 'A', canceller, aiBuildCardOpts(g, 'A', canceller));
      if (res.ok) return res.game;
    }
    const wantsSwitch = g.quarter === 1 && g.section <= 2 && getTeam(g, 'A').hand.includes('high_screen_roll') && !logSince(g, /^High Screen & Roll: /);
    if (wantsSwitch) {
      const res = execCard(g, 'A', 'high_screen_roll', aiBuildCardOpts(g, 'A', 'high_screen_roll'));
      if (res.ok) return res.game;
    }
    return passTurn(g, 'A');
  }

  if (g.phase !== 'scoring') throw new Error(`walk: unknown phase ${g.phase}`);
  if ((g.scoringPasses || 0) < 99) {
    if (g.scoringTurn !== 'A') throw new Error('walk: the coach did not move on its scoring turn');
    // Section 1: put a card back and take it back — the lesson's two states.
    if (!noCards && !putBack()) {
      const idx = getTeam(g, 'A').hand.findIndex(id => id !== 'high_screen_roll');
      const back = returnCardToDeck(g, 'A', idx);
      onState(back);
      return undoReturnCard(back, 'A');
    }
    return passTurn(g, 'A');
  }

  // Rolling.
  if (g.timeoutActive === 'A') {
    const options = crunchSearchOptions(g, 'A');
    if (options.length) return tutorialReducer(g, { type: 'SEARCH_CRUNCH', teamKey: 'A', cardId: options[0] });
    return tutorialReducer(g, { type: 'END_TIMEOUT' });
  }
  const gate = rollGate(g);
  if (gate.A && pendingRolls(g, 'A') > 0) {
    // The timeout the moment it is legal — after the first roll (timeoutProblem).
    if (!timeoutProblem(g, 'A')) return tutorialReducer(g, { type: 'TIMEOUT', teamKey: 'A' });
    const r = aiRollDecision(g, 'A');
    return tutorialReducer(g, { type: 'ROLL', teamKey: 'A', idx: r.playerIdx, opts: { clutch: noClutch ? false : r.clutch } });
  }
  if (pendingRolls(g, 'A') === 0 && pendingRolls(g, 'B') === 0) {
    let end = g;
    if (tieAtEnd && g.quarter === 4 && !g.overtime && g.teamA.score !== g.teamB.score) {
      end = JSON.parse(JSON.stringify(g));
      end.teamB.score = end.teamA.score;
    }
    return tutorialReducer(end, { type: 'END_SECTION' });
  }
  throw new Error(`walk: stuck at Q${g.quarter} S${g.section} rolling (gate ${JSON.stringify(gate)}, pending A${pendingRolls(g, 'A')} B${pendingRolls(g, 'B')})`);
}

function runSnakeStep(g) {
  const k = g.placementOrder[g.placementStep];
  if (k === 'B') return placePlayer(g, aiPlacementPick(g, 'B', { iq: 1 }).playerId);
  const next = g.draft.aPicks.find(id => !g.teamA.starters.some(p => p.id === id));
  return placePlayer(g, next);
}
