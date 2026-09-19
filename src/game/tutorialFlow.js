// THE TUTORIAL'S GAME FLOW, pure, so it can be tested without a browser.
//
// TutorialGame.jsx used to keep its reducer inline and drive the coach's
// lineup by hand off `draft.step`, a field the secret-lineup rewrite dropped —
// every lineup lesson went dead and nothing failed (2026-09-18). The reducer
// lives here now, beside the two rules the tutorial adds to the real game:
//
//   1. A FOURTH SECTION. After Q1 the tutorial skips to the final section of
//      Q4 so the player meets Crunch Time, Clutch Possession, the timeout and
//      its deck search before they meet them for real (the user, 2026-09-17:
//      "I want to update the tutorial with all the logic we've added to the
//      game"). It arms crunch through the engine's OWN path — endSection at
//      Q4 section 2 — never by writing `crunch` by hand.
//   2. THE A-B-A-B ROLL. The rules pages and the rolling lesson both say the
//      human rolls, then the coach; the tutorial's coach rolled on a timer and
//      ignored it. coachMayRoll is rollGate, read the way PlayTab reads it.
import {
  endSection, doRoll, spendAssist, spendReboundBonus, spendTimeout, searchCrunchCard, endTimeout,
  applyMatchups, rollGate, pendingRolls, deepClone, passTurn, CRUNCH_MARGIN,
} from './engine.js';
import { execCard, resolvePendingShotCheck, resolveGoUnder } from './execCard.js';
import {
  aiSetMatchups, aiTurn, aiScoringDecision, aiRollDecision, aiReactionDecision, aiGoUnderChoice,
  aiCrunchDecision, aiCrunchSearch,
} from './ai.js';
import { teachingHands } from './tutorialHands.js';

/**
 * How far the leader is allowed to lead when the tutorial skips ahead: close
 * enough that one Clutch Possession matters, and well inside CRUNCH_MARGIN so
 * crunch arms.
 */
export const TUTORIAL_CRUNCH_LEAD = Math.min(4, CRUNCH_MARGIN);
/**
 * The first-quarter margin above which the tutorial closes the gap. It used to
 * be CRUNCH_MARGIN itself, and then 54% of staged finishes started more than 8
 * apart for a single four-minute section — Clutch Possession, the timeout and
 * overtime were academic (2026-09-18). Twice the staged lead: a gap one good
 * section can close is left alone.
 */
export const TUTORIAL_CLOSE_OVER = 2 * TUTORIAL_CRUNCH_LEAD;

/** The section after which the tutorial skips ahead: Q1's last. */
export const isSkipPoint = g => Boolean(g) && g.quarter === 1 && g.section === 3 && !g.overtime;

/**
 * THE SKIP TO CRUNCH TIME. `g` is the tutorial at the end of Q1's third
 * section, everyone rolled. The section the player actually played is closed
 * by the engine's endSection, relabelled as Q4's second so that the same call
 * advances to Q4 section 3 and decides Crunch Time on the margin — the one
 * place the game ever arms it.
 *
 * What the skipped quarters would have done is done honestly and said in the
 * log: halftime (Q3) wipes the fatigue tracker and every marker, so it is
 * wiped here before the close, and the five who played Q1's last section come
 * in with that one section on them. The score carries over; when the first
 * quarter ended more than TUTORIAL_CLOSE_OVER apart the trailing side is
 * brought to within TUTORIAL_CRUNCH_LEAD — the tutorial's job here is to show
 * a close finish. The log says so, `tutorialStaged` records it for the skip
 * lesson to say, and the raised side's secStart moves with its score so the
 * made-up points are nobody's on-floor points.
 */
export function stageCrunch(g) {
  const ng = deepClone(g);
  const log = [{ team: null, msg: '=== TUTORIAL — skipping ahead to the final section of Q4. Halftime has wiped fatigue and hot/cold markers. ===' }];
  const a = ng.teamA.score;
  const b = ng.teamB.score;
  if (Math.abs(a - b) > TUTORIAL_CLOSE_OVER) {
    const key = a < b ? 'A' : 'B';
    const trailing = key === 'A' ? ng.teamA : ng.teamB;
    const raised = Math.max(a, b) - TUTORIAL_CRUNCH_LEAD - trailing.score;
    trailing.score += raised;
    if (ng.secStart) ng.secStart = { ...ng.secStart, [key]: (ng.secStart[key] || 0) + raised };
    ng.tutorialStaged = { from: { A: a, B: b }, team: key, teamName: trailing.name, lead: TUTORIAL_CRUNCH_LEAD };
    log.push({ team: null, msg: `Tutorial: the first quarter ended ${a}–${b}; ${trailing.name} is brought to within ${TUTORIAL_CRUNCH_LEAD} so the finish is close.` });
  }
  for (const t of [ng.teamA, ng.teamB]) {
    for (const ps of t.stats) { ps.minutes = 0; ps.hot = 0; ps.cold = 0; }
  }
  ng.quarter = 4;
  ng.section = 2;
  ng.overtime = 0;
  ng.log = [...ng.log, ...log];
  return endSection(ng);
}

/** The tutorial's section end: the skip after Q1, the shaped hands before it, the plain engine after. */
export function tutorialEndSection(g) {
  if (isSkipPoint(g)) return stageCrunch(g);
  return teachingHands(endSection(g));
}

/**
 * May the coach throw a die now? Rolling open, a roll still owed, and
 * rollGate says it is B's turn — the human leads, the coach follows.
 */
export function coachMayRoll(g) {
  if (!g || g.phase !== 'scoring' || (g.scoringPasses || 0) < 99) return false;
  if (g.pendingShotCheck || g.pendingChoice) return false;
  return pendingRolls(g, 'B') > 0 && Boolean(rollGate(g).B);
}

/**
 * THE TUTORIAL'S COACH, one move at a time: the action TutorialGame
 * dispatches after its delay, or null when the move is not the coach's.
 *
 * It lived inline in TutorialGame's effect, where no test could reach it, and
 * the walk kit carried a hand-written copy — so the roll gate or the demo flag
 * could have gone from the component with every test still green
 * (2026-09-18). Both now call this. The order is PlayTab's:
 *
 *   - An announced check on YOUR shooter: the coach takes its reaction
 *     window (aiReactionDecision), then lets the die fly. The coach's OWN
 *     checks wait for your ▶ Resolve — announceCheck only pauses one when
 *     you hold an answer, and the tutorial used to resolve it 800 ms later,
 *     under a lesson saying the game would ask you.
 *   - A Go Under choice that is the coach's to make.
 *   - The matchup window (demo: the coach always answers your switch with
 *     the canceller it holds — ai.js DEMO_CANCEL_VALUE) and the scoring window.
 *   - Rolling: nothing while YOUR timeout is on (the tutorial is where the
 *     timeout is learned, so the coach waits while you draw it up); nothing
 *     unless coachMayRoll; then its timeout (search, rider, resume), its
 *     timeout call, its die.
 */
export function tutorialCoachStep(game) {
  if (!game || game.done) return null;
  const card = (cardId, opts) => {
    const res = execCard(game, 'B', cardId, opts || {});
    return res.ok ? { type: 'UPDATE', game: res.game } : null;
  };
  const pass = () => ({ type: 'UPDATE', game: passTurn(game, 'B') });

  const psc = game.pendingShotCheck;
  if (psc) {
    if (psc.teamKey !== 'A') return null;
    if (!psc.reacted) {
      const react = aiReactionDecision(game, 'B', 'shot_check');
      const played = react?.type === 'play_card' && card(react.cardId, react.opts);
      if (played) return played;
    }
    return { type: 'RESOLVE_CHECK' };
  }

  if (game.pendingChoice?.teamKey === 'B') {
    const r = resolveGoUnder(game, aiGoUnderChoice(game, 'B'));
    if (r.ok) return { type: 'UPDATE', game: r.game };
  }

  if (game.phase === 'matchup_strats') {
    if ((game.placementStep ?? 10) < 10 || game.matchupTurn !== 'B') return null;
    const action = aiTurn(game, 'B', { demo: true });
    return (action?.type === 'play_card' && card(action.cardId, action.opts)) || pass();
  }

  if (game.phase !== 'scoring') return null;
  if ((game.scoringPasses || 0) < 99) {
    if (game.scoringTurn !== 'B') return null;
    const action = aiScoringDecision(game, 'B');
    return (action?.type === 'play_card' && card(action.cardId, action.opts)) || pass();
  }

  if (game.timeoutActive === 'A') return null;
  if (!coachMayRoll(game)) return null;
  if (game.timeoutActive === 'B') {
    const wanted = aiCrunchSearch(game, 'B');
    if (wanted) return { type: 'SEARCH_CRUNCH', teamKey: 'B', cardId: wanted };
    const rider = aiScoringDecision(game, 'B');
    return (rider?.type === 'play_card' && card(rider.cardId, rider.opts)) || { type: 'END_TIMEOUT' };
  }
  if (!game.timeoutActive && aiCrunchDecision(game, 'B')?.type === 'timeout') return { type: 'TIMEOUT', teamKey: 'B' };
  const action = aiRollDecision(game, 'B');
  return action?.playerIdx != null ? { type: 'ROLL', teamKey: 'B', idx: action.playerIdx, opts: { clutch: action.clutch } } : null;
}

/** A played step that the engine refused leaves the game as it was, with the reason in the console. */
function orKeep(state, res, what) {
  if (res.ok) return res.game;
  console.warn(`Tutorial ${what} failed:`, res.msg);
  return state;
}

/** The tutorial's reducer: PlayTab's, plus the skip to Crunch Time. */
export function tutorialReducer(state, action) {
  if (!state && action.type !== 'SET') return state;
  switch (action.type) {
    case 'SET':            return action.game;
    case 'ROLL':           return doRoll(state, action.teamKey, action.idx, action.opts || {});
    case 'END_SECTION':    return tutorialEndSection(state);
    case 'EXEC_CARD':      return orKeep(state, execCard(state, action.teamKey, action.cardId, action.opts || {}), 'EXEC_CARD');
    case 'SPEND_ASSIST':   return orKeep(state, spendAssist(state, action.teamKey, action.spendType, action.playerIdx), 'SPEND_ASSIST');
    case 'SPEND_REBOUND':  return orKeep(state, spendReboundBonus(state, action.teamKey, action.rebType, action.playerIdx), 'SPEND_REBOUND');
    case 'TIMEOUT': {
      const res = spendTimeout(state, action.teamKey);
      if (!res.ok) return orKeep(state, res, 'TIMEOUT');
      // As PlayTab: the coach's matchup brain draws up the re-set, for either side.
      const reset = aiSetMatchups(res.game, action.teamKey);
      return reset?.matchups ? applyMatchups(res.game, action.teamKey, reset.matchups) : res.game;
    }
    case 'SEARCH_CRUNCH':  return orKeep(state, searchCrunchCard(state, action.teamKey, action.cardId), 'SEARCH_CRUNCH');
    case 'END_TIMEOUT':    return endTimeout(state);
    case 'RESOLVE_CHECK':  return resolvePendingShotCheck(state);
    case 'UPDATE':         return action.game;
    default:               return state;
  }
}
