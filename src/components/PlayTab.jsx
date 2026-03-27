import { useReducer, useCallback } from 'react';
import { newGame, doRoll, endSection } from '../game/engine.js';
import { CARDS } from '../game/cards.js';
import Scoreboard from './game/Scoreboard.jsx';
import DraftPhase from './game/DraftPhase.jsx';
import MatchupPhase from './game/MatchupPhase.jsx';
import ScoringPhase from './game/ScoringPhase.jsx';
import GameOver from './game/GameOver.jsx';
import FatigueLegend from './game/FatigueLegend.jsx';
import GameLog from './game/GameLog.jsx';
import styles from './PlayTab.module.css';

// ── Reducer ────────────────────────────────────────────────────────────────
function gameReducer(state, action) {
  if (!state) return state;
  switch (action.type) {
    case 'SET':  return action.game;
    case 'ROLL': return doRoll(state, action.teamKey, action.idx);
    case 'END_SECTION': return endSection(state);
    default: return state;
  }
}

export default function PlayTab({ teamA: rosterA, teamB: rosterB }) {
  const [game, dispatch] = useReducer(gameReducer, null);

  const startGame = useCallback((rA, rB) => {
    dispatch({ type: 'SET', game: newGame(rA, rB) });
  }, []);

  const setGame = useCallback((g) => {
    dispatch({ type: 'SET', game: g });
  }, []);

  const roll = useCallback((teamKey, idx) => {
    dispatch({ type: 'ROLL', teamKey, idx });
  }, []);

  const endSec = useCallback(() => {
    dispatch({ type: 'END_SECTION' });
  }, []);

  if (!game) {
    return (
      <NoGame
        canUseBuilt={rosterA.length >= 5 && rosterB.length >= 5}
        rosterA={rosterA} rosterB={rosterB}
        onStart={startGame}
      />
    );
  }

  if (game.done) {
    return <GameOver game={game} onPlayAgain={() => dispatch({ type: 'SET', game: null })} />;
  }

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <Scoreboard game={game} />
        <FatigueLegend />

        {game.phase === 'draft' && (
          <DraftPhase game={game} setGame={setGame} />
        )}
        {game.phase === 'matchup_strats' && (
          <MatchupPhase game={game} setGame={setGame} />
        )}
        {game.phase === 'scoring' && (
          <ScoringPhase game={game} setGame={setGame} onRoll={roll} onEndSection={endSec} />
        )}
      </div>

      <div className={styles.sidebar}>
        <GameLog log={game.log} />
      </div>
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
        <h2>Start a Game</h2>
        <p>Each team draws 7 strategy cards. Draft order: A → B → B → A → A → B → B → A → A → B</p>
        <div className={styles.noGameBtns}>
          {canUseBuilt && (
            <button className={styles.btnPri} onClick={() => onStart(rosterA, rosterB)}>
              Start with Team Builder Rosters
            </button>
          )}
          <button className={styles.btnSec} onClick={quickStart}>
            🎲 Quick Match (random teams)
          </button>
        </div>
        {!canUseBuilt && (
          <p className={styles.hint}>Build your rosters in the Team Builder tab first for a custom game.</p>
        )}
      </div>
    </div>
  );
}
