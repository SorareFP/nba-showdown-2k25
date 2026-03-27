import { useReducer, useCallback } from 'react';
import { newGame, doRoll, endSection, spendAssist, spendReboundBonus } from '../game/engine.js';
import { execCard, resolvePendingShotCheck } from '../game/execCard.js';
import { CARDS } from '../game/cards.js';
import CourtBoard from './game/CourtBoard.jsx';
import GameOver from './game/GameOver.jsx';
import GameLog from './game/GameLog.jsx';
import Scoreboard from './game/Scoreboard.jsx';
import styles from './PlayTab.module.css';

function gameReducer(state, action) {
  if (!state && action.type !== 'SET') return state;
  switch (action.type) {
    case 'SET':         return action.game;
    case 'ROLL':        return doRoll(state, action.teamKey, action.idx);
    case 'END_SECTION': return endSection(state);
    case 'EXEC_CARD': {
      const { game, ok, msg } = execCard(state, action.teamKey, action.cardId, action.opts || {});
      if (!ok) { alert(msg); return state; }
      return game;
    }
    case 'SPEND_ASSIST': {
      const { game, ok, msg } = spendAssist(state, action.teamKey, action.spendType, action.playerIdx);
      if (!ok) { alert(msg); return state; }
      return game;
    }
    case 'SPEND_REBOUND': {
      const { game, ok, msg } = spendReboundBonus(state, action.teamKey, action.rebType, action.playerIdx);
      if (!ok) { alert(msg); return state; }
      return game;
    }
    case 'RESOLVE_CHECK': return resolvePendingShotCheck(state);
    case 'UPDATE':      return action.game;
    default:            return state;
  }
}

export default function PlayTab({ teamA: rosterA, teamB: rosterB }) {
  const [game, dispatch] = useReducer(gameReducer, null);

  const startGame = useCallback((rA, rB) => {
    dispatch({ type: 'SET', game: newGame(rA, rB) });
  }, []);

  const handlers = {
    setGame:      (g)                     => dispatch({ type: 'UPDATE', game: g }),
    onRoll:       (teamKey, idx)          => dispatch({ type: 'ROLL', teamKey, idx }),
    onSpendAssist:(teamKey, spendType, playerIdx) => dispatch({ type: 'SPEND_ASSIST', teamKey, spendType, playerIdx }),
    onSpendRebound:(teamKey, rebType, playerIdx) => dispatch({ type: 'SPEND_REBOUND', teamKey, rebType, playerIdx }),
    onEndSection: ()                      => dispatch({ type: 'END_SECTION' }),
    onExecCard:   (teamKey, cardId, opts) => dispatch({ type: 'EXEC_CARD', teamKey, cardId, opts }),
    onResolve:    ()                      => dispatch({ type: 'RESOLVE_CHECK' }),
    onPlayAgain:  ()                      => dispatch({ type: 'SET', game: null }),
  };

  if (!game) return (
    <NoGame
      canUseBuilt={rosterA.length >= 5 && rosterB.length >= 5}
      rosterA={rosterA} rosterB={rosterB}
      onStart={startGame}
    />
  );

  if (game.done) return <GameOver game={game} onPlayAgain={handlers.onPlayAgain} />;

  return (
    <div className={styles.layout}>
      <Scoreboard game={game} />
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
      <GameLog log={game.log} />
    </div>
  );
}

function NoGame({ canUseBuilt, rosterA, rosterB, onStart }) {
  const quickStart = () => {
    const sh = [...CARDS].sort(() => Math.random() - 0.5);
    onStart(sh.slice(0, 10), sh.slice(10, 20));
  };
  return (
    <div className={styles.noGame}>
      <div className={styles.noGameCard}>
        <div className={styles.noGameIcon}>🏀</div>
        <h2>NBA Showdown 2K25</h2>
        <p>D20 Basketball Card Game — 306 Players · Strategy Deck System</p>
        <p style={{ fontSize:12, color:'var(--text-dim)', marginBottom:'1.5rem' }}>Draft order: A → B → B → A → A → B → B → A → A → B</p>
        <div className={styles.noGameBtns}>
          {canUseBuilt && (
            <button className={styles.btnPri} onClick={() => onStart(rosterA, rosterB)}>
              🏀 Start with Team Builder Rosters
            </button>
          )}
          <button className={styles.btnSec} onClick={quickStart}>🎲 Quick Match (random teams)</button>
        </div>
        {!canUseBuilt && <p className={styles.hint}>Build rosters in the Team Builder tab first.</p>}
      </div>
    </div>
  );
}
