import { useReducer, useCallback, useEffect, useRef, useState } from 'react';
import { newGame, doRoll, endSection, spendAssist, spendReboundBonus, getTeam, SNAKE } from '../game/engine.js';
import { execCard, resolvePendingShotCheck } from '../game/execCard.js';
import { CARD_MAP } from '../game/cards.js';
import { aiDraftPick, aiScoringDecision, aiRollDecision, aiTurn } from '../game/ai.js';
import { TUTORIAL_TOOLTIPS, TUTORIAL_ROSTER_A_IDS, TUTORIAL_ROSTER_B_IDS } from '../game/tutorialData.js';
import TutorialOverlay from './game/TutorialOverlay.jsx';
import CourtBoard from './game/CourtBoard.jsx';
import Scoreboard from './game/Scoreboard.jsx';
import GameLog from './game/GameLog.jsx';
import styles from './TutorialGame.module.css';

// ── Reducer (mirrors PlayTab) ───────────────────────────────────────────────
function gameReducer(state, action) {
  if (!state && action.type !== 'SET') return state;
  switch (action.type) {
    case 'SET':         return action.game;
    case 'ROLL':        return doRoll(state, action.teamKey, action.idx);
    case 'END_SECTION': return endSection(state);
    case 'EXEC_CARD': {
      const { game, ok, msg } = execCard(state, action.teamKey, action.cardId, action.opts || {});
      if (!ok) { console.warn('TutorialGame EXEC_CARD failed:', msg); return state; }
      return game;
    }
    case 'SPEND_ASSIST': {
      const { game, ok, msg } = spendAssist(state, action.teamKey, action.spendType, action.playerIdx);
      if (!ok) { console.warn('TutorialGame SPEND_ASSIST failed:', msg); return state; }
      return game;
    }
    case 'SPEND_REBOUND': {
      const { game, ok, msg } = spendReboundBonus(state, action.teamKey, action.rebType, action.playerIdx);
      if (!ok) { console.warn('TutorialGame SPEND_REBOUND failed:', msg); return state; }
      return game;
    }
    case 'RESOLVE_CHECK': return resolvePendingShotCheck(state);
    case 'UPDATE':      return action.game;
    default:            return state;
  }
}

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

  const [game, dispatch] = useReducer(gameReducer, null);
  const [completed, setCompleted] = useState(false);
  const aiRunning = useRef(false);
  const mounted = useRef(true);

  // Initialize game on mount
  useEffect(() => {
    mounted.current = true;
    dispatch({ type: 'SET', game: newGame(rosterA, rosterB) });
    return () => { mounted.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers (same shape as PlayTab) ────────────────────────────────────
  const handlers = {
    setGame:       (g)                          => dispatch({ type: 'UPDATE', game: g }),
    onRoll:        (teamKey, idx)               => dispatch({ type: 'ROLL', teamKey, idx }),
    onSpendAssist: (teamKey, spendType, playerIdx) => dispatch({ type: 'SPEND_ASSIST', teamKey, spendType, playerIdx }),
    onSpendRebound:(teamKey, rebType, playerIdx) => dispatch({ type: 'SPEND_REBOUND', teamKey, rebType, playerIdx }),
    onEndSection:  ()                           => dispatch({ type: 'END_SECTION' }),
    onExecCard:    (teamKey, cardId, opts)       => dispatch({ type: 'EXEC_CARD', teamKey, cardId, opts }),
    onResolve:     ()                           => dispatch({ type: 'RESOLVE_CHECK' }),
  };

  // ── Detect tutorial completion (Q1 finished → quarter > 1) ──────────────
  useEffect(() => {
    if (!game) return;
    if (game.quarter > 1 && !completed) {
      setCompleted(true);
    }
  }, [game, completed]);

  // ── AI logic for Team B ─────────────────────────────────────────────────
  useEffect(() => {
    if (!game || completed || aiRunning.current) return;

    // Pending shot check — resolve it first
    if (game.pendingShotCheck) {
      const timer = setTimeout(() => {
        if (!mounted.current) return;
        dispatch({ type: 'RESOLVE_CHECK' });
      }, AI_DELAY);
      return () => clearTimeout(timer);
    }

    const phase = game.phase;

    // ── Draft: AI picks when SNAKE[step] === 1 (Team B) ──────────────────
    if (phase === 'draft') {
      const step = game.draft.step;
      if (step >= 10) return; // draft done, waiting for "Continue"
      if (SNAKE[step] !== 1) return; // Team A's turn, player picks

      aiRunning.current = true;
      const timer = setTimeout(() => {
        if (!mounted.current) { aiRunning.current = false; return; }
        const action = aiDraftPick(game, 'B');
        if (action) {
          // Perform draft pick for Team B (same logic as CourtBoard pick())
          const g = JSON.parse(JSON.stringify(game));
          const card = g.draft.bPool.find(c => c.id === action.playerId);
          if (card) {
            g.teamB.starters.push(card);
            g.draft.bPool = g.draft.bPool.filter(c => c.id !== card.id);
            g.draft.step++;
            // If draft complete, transition to matchup phase
            if (g.teamA.starters.length === 5 && g.teamB.starters.length === 5) {
              g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
              ['A', 'B'].forEach(k => {
                const t = k === 'A' ? g.teamA : g.teamB;
                t.stats.forEach(ps => {
                  if (!t.starters.find(p => p.id === ps.id)) {
                    ps.hot = 0; ps.cold = 0;
                    const m = ps.minutes || 0;
                    ps.minutes = m <= 8 ? 0 : Math.max(0, m - 8);
                  }
                });
              });
              g.phase = 'matchup_strats';
              g.log = [...g.log, { team: null, msg: 'Draft complete — Matchup Strategy Phase.' }];
            }
            dispatch({ type: 'UPDATE', game: g });
          }
        }
        aiRunning.current = false;
      }, AI_DELAY);
      return () => { clearTimeout(timer); aiRunning.current = false; };
    }

    // ── Matchup Strats: AI plays or passes on its turn ───────────────────
    if (phase === 'matchup_strats' && game.matchupTurn === 'B') {
      aiRunning.current = true;
      const timer = setTimeout(() => {
        if (!mounted.current) { aiRunning.current = false; return; }
        const action = aiTurn(game, 'B');
        if (action && action.type === 'play_card') {
          dispatch({ type: 'EXEC_CARD', teamKey: 'B', cardId: action.cardId, opts: action.opts || {} });
        } else {
          // Pass in matchup phase
          const g = JSON.parse(JSON.stringify(game));
          g.matchupPasses++;
          if (g.matchupPasses >= 2) {
            g.phase = 'scoring';
            g.rollResults = { A: [], B: [] };
            g.log = [...g.log, { team: null, msg: 'Both passed — Scoring Phase!' }];
          } else {
            g.matchupTurn = 'A';
            g.log = [...g.log, { team: 'B', msg: 'Passed.' }];
          }
          dispatch({ type: 'UPDATE', game: g });
        }
        aiRunning.current = false;
      }, AI_DELAY);
      return () => { clearTimeout(timer); aiRunning.current = false; };
    }

    // ── Scoring: AI card play or pass, then rolling ──────────────────────
    if (phase === 'scoring') {
      const rollingOpen = game.scoringPasses >= 99;

      // Card-play phase: AI's turn to play a card or pass
      if (!rollingOpen && game.scoringTurn === 'B') {
        aiRunning.current = true;
        const timer = setTimeout(() => {
          if (!mounted.current) { aiRunning.current = false; return; }
          const action = aiScoringDecision(game, 'B');
          if (action && action.type === 'play_card') {
            dispatch({ type: 'EXEC_CARD', teamKey: 'B', cardId: action.cardId, opts: action.opts || {} });
          } else {
            // Pass in scoring phase
            const g = JSON.parse(JSON.stringify(game));
            g.scoringPasses++;
            if (g.scoringPasses >= 2) {
              g.scoringPasses = 99;
              g.log = [...g.log, { team: null, msg: 'Both passed — rolling begins!' }];
            } else {
              g.scoringTurn = 'A';
              g.log = [...g.log, { team: 'B', msg: 'Passed scoring turn.' }];
            }
            dispatch({ type: 'UPDATE', game: g });
          }
          aiRunning.current = false;
        }, AI_DELAY);
        return () => { clearTimeout(timer); aiRunning.current = false; };
      }

      // Rolling phase: AI rolls its players
      if (rollingOpen) {
        const rollsB = game.rollResults.B || [];
        const blockedB = game.blockedRolls?.B || {};
        const needsRoll = [0, 1, 2, 3, 4].some(i => rollsB[i] == null && !blockedB[i]);
        if (needsRoll) {
          aiRunning.current = true;
          const timer = setTimeout(() => {
            if (!mounted.current) { aiRunning.current = false; return; }
            const action = aiRollDecision(game, 'B');
            if (action) {
              dispatch({ type: 'ROLL', teamKey: 'B', idx: action.playerIdx });
            }
            aiRunning.current = false;
          }, AI_DELAY);
          return () => { clearTimeout(timer); aiRunning.current = false; };
        }
      }
    }
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
            You have learned drafting, matchups, strategy cards, scoring rolls, fatigue, and substitutions.
            Head to How to Play for the full rules reference, or jump into a real game!
          </p>
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
      <Scoreboard game={game} />
      <GameLog log={game.log} />
      <CourtBoard
        game={game}
        setGame={handlers.setGame}
        onRoll={handlers.onRoll}
        onEndSection={handlers.onEndSection}
        onExecCard={handlers.onExecCard}
        onResolve={handlers.onResolve}
        onSpendAssist={handlers.onSpendAssist}
        onSpendRebound={handlers.onSpendRebound}
      />
    </div>
  );
}
