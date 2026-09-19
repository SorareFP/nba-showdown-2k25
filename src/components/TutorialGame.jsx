import { useReducer, useEffect, useRef, useState } from 'react';
import { newGame, rollGate } from '../game/engine.js';
import { CARD_MAP } from '../game/cards.js';
import { CLUTCH_DICE } from '../game/clutchAwards.js';
import { TUTORIAL_TOOLTIPS, TUTORIAL_ROSTER_A_IDS, TUTORIAL_ROSTER_B_IDS, whatsNext } from '../game/tutorialData.js';
// The hands are shaped per section so each lesson has its prop — see the file.
import { teachingHands } from '../game/tutorialHands.js';
// The reducer, the skip to Crunch Time after Q1, and the coach's every move
// live in a plain module so they can be tested (2026-09-18).
import { tutorialReducer, tutorialCoachStep } from '../game/tutorialFlow.js';
import { markPlayed } from '../game/firstRun.js';
import TutorialOverlay from './game/TutorialOverlay.jsx';
import CourtBoard from './game/CourtBoard.jsx';
import Scoreboard from './game/Scoreboard.jsx';
import GameLog from './game/GameLog.jsx';
import styles from './TutorialGame.module.css';

// ── Resolve roster IDs to card objects ──────────────────────────────────────
function resolveRoster(ids) {
  return ids.map(id => CARD_MAP[id]).filter(Boolean);
}

// ── AI delay (ms) ───────────────────────────────────────────────────────────
const AI_DELAY = 800;

// ── Component ───────────────────────────────────────────────────────────────
export default function TutorialGame({ onExit }) {
  const rosterA = resolveRoster(TUTORIAL_ROSTER_A_IDS);
  const rosterB = resolveRoster(TUTORIAL_ROSTER_B_IDS);

  const [game, dispatch] = useReducer(tutorialReducer, null);
  const [completed, setCompleted] = useState(false);
  const mounted = useRef(true);

  // Initialize game on mount. The clutch dice are the real game's (PlayTab),
  // so the Crunch-Time section shows the same Clutch Possession the player
  // will meet — the coach's Shai rolls his award dice here too.
  useEffect(() => {
    mounted.current = true;
    dispatch({ type: 'SET', game: teachingHands(newGame(rosterA, rosterB, undefined, undefined, { clutchDice: CLUTCH_DICE })) });
    return () => { mounted.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers (same shape as PlayTab) ────────────────────────────────────
  const handlers = {
    setGame:       (g)                          => dispatch({ type: 'UPDATE', game: g }),
    onRoll:        (teamKey, idx, opts)         => dispatch({ type: 'ROLL', teamKey, idx, opts }),
    onSpendAssist: (teamKey, spendType, playerIdx) => dispatch({ type: 'SPEND_ASSIST', teamKey, spendType, playerIdx }),
    onSpendRebound:(teamKey, rebType, playerIdx) => dispatch({ type: 'SPEND_REBOUND', teamKey, rebType, playerIdx }),
    onEndSection:  ()                           => dispatch({ type: 'END_SECTION' }),
    onExecCard:    (teamKey, cardId, opts)       => dispatch({ type: 'EXEC_CARD', teamKey, cardId, opts }),
    onResolve:     ()                           => dispatch({ type: 'RESOLVE_CHECK' }),
    onTimeout:     (teamKey)                    => dispatch({ type: 'TIMEOUT', teamKey }),
    onEndTimeout:  ()                           => dispatch({ type: 'END_TIMEOUT' }),
    onSearchCrunch:(teamKey, cardId)            => dispatch({ type: 'SEARCH_CRUNCH', teamKey, cardId }),
  };

  // ── Progress: Q1 done counts as having played; the final whistle ends it ──
  // The tutorial used to end the moment Q1 did. It now skips to Q4's last
  // section for Crunch Time (tutorialFlow.js), so the completion screen waits
  // for the game to finish — overtime included, if the dice tie it.
  useEffect(() => {
    if (!game) return;
    if (game.quarter > 1) markPlayed();
    if (game.done && !completed) setCompleted(true);
  }, [game, completed]);

  // ── AI logic for Team B ─────────────────────────────────────────────────
  // The lineup needs nothing here: the board's lineup screen picks the
  // coach's five when you submit yours (CourtBoard BlindPickPhase), and the
  // board also runs the coach's placements. Every other move is
  // tutorialCoachStep's (tutorialFlow.js), a pure function the tests drive
  // (2026-09-18): the a-b-a-b roll gate, the demo canceller, the coach's
  // timeout order, and its checks waiting for YOUR ▶ Resolve all live there,
  // so none of them can quietly leave the tutorial. This effect only waits
  // AI_DELAY and dispatches what it returns; a new game state clears the
  // timer and asks again.
  useEffect(() => {
    if (!game || completed || game.done) return undefined;
    const action = tutorialCoachStep(game);
    if (!action) return undefined;
    const timer = setTimeout(() => { if (mounted.current) dispatch(action); }, AI_DELAY);
    return () => clearTimeout(timer);
  }, [game, completed]);

  // ── Completion screen ───────────────────────────────────────────────────
  if (completed) {
    const scoreA = game?.teamA?.score || 0;
    const scoreB = game?.teamB?.score || 0;
    return (
      <div className={styles.completionWrap}>
        <div className={styles.completionCard}>
          <h2 className={styles.completionTitle}>Tutorial Complete!</h2>
          <p className={styles.completionScore}>
            Final Score: <span className={styles.teamA}>Team A {scoreA}</span> &ndash; <span className={styles.teamB}>{scoreB} Team B</span>
          </p>
          <p className={styles.completionMsg}>
            You have learned lineups, placement, matchups, strategy cards, scoring rolls, fatigue, substitutions and Crunch Time.
            Head to How to Play for the full rules reference, or jump into a real game!
          </p>
          {/* Computed from the tables the game reads (tutorialData.js whatsNext). */}
          <div className={styles.nextTitle}>What you'll meet next</div>
          <ul className={styles.nextList}>
            {whatsNext().map(line => <li key={line}>{line}</li>)}
          </ul>
          <div className={styles.completionBtns}>
            <button className={styles.btnPri} onClick={onExit}>Back to How to Play</button>
          </div>
        </div>
      </div>
    );
  }

  if (!game) return null;

  return (
    <div className={styles.layout}>
      <div className={styles.topBar}>
        <span className={styles.tutorialBadge}>Tutorial Mode</span>
        <button className={styles.exitBtn} onClick={onExit}>Exit Tutorial</button>
      </div>
      <TutorialOverlay game={game} tooltips={TUTORIAL_TOOLTIPS} onSkip={onExit} />
      {/* Whose die it is — the tutorial enforces the a-b-a-b roll too. */}
      <Scoreboard game={game} rollGate={rollGate(game)} />
      <GameLog log={game.log} />
      <CourtBoard
        game={game}
        setGame={handlers.setGame}
        // The human leads the dice, the coach follows (rollGate) — the rule
        // s1_rolling_open teaches, now the board's too.
        rollGate={rollGate(game)}
        onRoll={handlers.onRoll}
        onEndSection={handlers.onEndSection}
        onExecCard={handlers.onExecCard}
        onResolve={handlers.onResolve}
        onSpendAssist={handlers.onSpendAssist}
        onSpendRebound={handlers.onSpendRebound}
        onTimeout={handlers.onTimeout}
        onEndTimeout={handlers.onEndTimeout}
        onSearchCrunch={handlers.onSearchCrunch}
        // The tutorial always shows the coach tips - it is where they teach.
        coachTips
        // The coach's hand stays face up (the lessons name its cards), so no
        // coachTeam; the coach's side is watch-only all the same — its ▶ and
        // ↩, slots and turn played FOR the coach (2026-09-18).
        watchOnlyTeam="B"
      />
    </div>
  );
}
