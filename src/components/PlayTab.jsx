import { useReducer, useCallback, useState, useEffect } from 'react';
import { newGame, doRoll, endSection, spendAssist, spendReboundBonus } from '../game/engine.js';
import { execCard, resolvePendingShotCheck } from '../game/execCard.js';
import { CARDS } from '../game/cards.js';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { loadDecks } from '../firebase/savedDecks.js';
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

  const startGame = useCallback((rA, rB, deckA, deckB) => {
    dispatch({ type: 'SET', game: newGame(rA, rB, deckA, deckB) });
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

function NoGame({ canUseBuilt, rosterA, rosterB, onStart }) {
  const { user } = useAuth();
  const [decks, setDecks] = useState([]);
  const [deckA, setDeckA] = useState('default');
  const [deckB, setDeckB] = useState('default');
  const [loadingDecks, setLoadingDecks] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoadingDecks(true);
    loadDecks(user.uid).then(d => { setDecks(d); setLoadingDecks(false); }).catch(() => setLoadingDecks(false));
  }, [user]);

  const getDeckConfig = (selection) => {
    if (selection === 'default') return null; // engine uses default buildDeck
    const deck = decks.find(d => d.id === selection);
    return deck?.cards || null;
  };

  const handleStart = (rA, rB) => {
    onStart(rA, rB, getDeckConfig(deckA), getDeckConfig(deckB));
  };

  const quickStart = () => {
    const sh = [...CARDS].sort(() => Math.random() - 0.5);
    onStart(sh.slice(0, 10), sh.slice(10, 20), getDeckConfig(deckA), getDeckConfig(deckB));
  };

  const hasSavedDecks = decks.length > 0;

  return (
    <div className={styles.noGame}>
      <div className={styles.noGameCard}>
        <div className={styles.noGameIcon}>🏀</div>
        <h2>NBA Showdown 2K25</h2>
        <p>D20 Basketball Card Game — 306 Players · Strategy Deck System</p>
        <p style={{ fontSize:12, color:'var(--text-dim)', marginBottom:'1rem' }}>Draft order: A → B → B → A → A → B → B → A → A → B</p>

        {user && hasSavedDecks && (
          <div className={styles.deckPickers}>
            <DeckPicker label="Team A Deck" value={deckA} onChange={setDeckA} decks={decks} color="var(--orange)" />
            <DeckPicker label="Team B Deck" value={deckB} onChange={setDeckB} decks={decks} color="var(--blue)" />
          </div>
        )}

        <div className={styles.noGameBtns}>
          {canUseBuilt && (
            <button className={styles.btnPri} onClick={() => handleStart(rosterA, rosterB)}>
              🏀 Start with Team Builder Rosters
            </button>
          )}
          <button className={styles.btnSec} onClick={quickStart}>🎲 Quick Match (random teams)</button>
        </div>
        {!canUseBuilt && <p className={styles.hint}>Build rosters in the Team Builder tab first.</p>}
        {user && !hasSavedDecks && !loadingDecks && (
          <p className={styles.hint}>No saved decks — using default deck. Build one in the Collection tab.</p>
        )}
      </div>
    </div>
  );
}

function DeckPicker({ label, value, onChange, decks, color }) {
  return (
    <div className={styles.deckPicker}>
      <label className={styles.deckLabel} style={{ color }}>{label}</label>
      <select className={styles.deckSelect} value={value} onChange={e => onChange(e.target.value)}>
        <option value="default">Default Deck</option>
        {decks.map(d => (
          <option key={d.id} value={d.id}>{d.name} ({d.totalCards} cards)</option>
        ))}
      </select>
    </div>
  );
}
