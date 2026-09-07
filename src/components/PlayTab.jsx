import { useReducer, useCallback, useState, useEffect } from 'react';
import { newGame, doRoll, endSection, spendAssist, spendReboundBonus, applyMatchups, spendTimeout, endTimeout, clutchAvailable, passTurn } from '../game/engine.js';
import { aiTurn, aiScoringDecision, aiRollDecision, aiSpendDecision, aiReactionDecision, aiCrunchDecision, aiSetMatchups } from '../game/ai.js';
import { CLUTCH_DICE } from '../game/clutchAwards.js';
import { execCard, resolvePendingShotCheck } from '../game/execCard.js';
import { randomizeTeam, MIN_TO_PLAY } from '../game/teamRules.js';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { loadDecks } from '../firebase/savedDecks.js';
import CourtBoard from './game/CourtBoard.jsx';
import GameOver from './game/GameOver.jsx';
import GameLog from './game/GameLog.jsx';
import AnalyticsPanel from './game/AnalyticsPanel.jsx';
import Scoreboard from './game/Scoreboard.jsx';
import styles from './PlayTab.module.css';

function gameReducer(state, action) {
  if (!state && action.type !== 'SET') return state;
  switch (action.type) {
    case 'SET':         return action.game;
    case 'ROLL':        return doRoll(state, action.teamKey, action.idx, action.opts || {});
    case 'TIMEOUT': {
      const { game, ok, msg } = spendTimeout(state, action.teamKey);
      if (!ok) { if (!action.silent) alert(msg); return state; }
      // The coach draws it up: the timeout's defensive re-set, computed by
      // the same matchup brain the AI uses — for either team.
      const reset = aiSetMatchups(game, action.teamKey);
      return reset?.matchups ? applyMatchups(game, action.teamKey, reset.matchups) : game;
    }
    case 'END_TIMEOUT': return endTimeout(state);
    case 'END_SECTION': return endSection(state);
    case 'EXEC_CARD': {
      const { game, ok, msg } = execCard(state, action.teamKey, action.cardId, action.opts || {});
      if (!ok) { if (!action.silent) alert(msg); return state; }
      return game;
    }
    case 'SPEND_ASSIST': {
      const { game, ok, msg } = spendAssist(state, action.teamKey, action.spendType, action.playerIdx);
      if (!ok) { if (!action.silent) alert(msg); return state; }
      return game;
    }
    case 'SPEND_REBOUND': {
      const { game, ok, msg } = spendReboundBonus(state, action.teamKey, action.rebType, action.playerIdx);
      if (!ok) { if (!action.silent) alert(msg); return state; }
      return game;
    }
    case 'RESOLVE_CHECK': return resolvePendingShotCheck(state);
    case 'UPDATE':      return action.game;
    default:            return state;
  }
}

const AI_DELAY = 700;

export default function PlayTab({ teamA: rosterA, teamB: rosterB }) {
  const [game, dispatch] = useReducer(gameReducer, null);

  // WHO PLAYS TEAM B. 'ai' hands B to the coach below; 'human' switches the
  // coach off and the game is hotseat — you play both sides, which is what
  // the UI did before the coach existed and still allows outside PvP (every
  // control gate in CourtBoard is `pvpMode && ...`). Hotseat is how you test
  // a specific outcome: steer both teams to the score you want and see what
  // the results screen pays. Chosen on the pre-game screen, fixed for the game.
  const [opponent, setOpponent] = useState('ai');

  // ── The AI opponent's turn driver ─────────────────────────────────────────
  //
  // PlayTab has always LOOKED like a solo mode — the blind pick has the AI
  // choose Team B's five — but nothing ever drove B's turns, so every game
  // was secretly hotseat. This effect is the missing coach: matchup plays,
  // scoring plays, rolls, conversion spends (aiSpendDecision — the channel
  // the audit proved is ~10% of all scoring), and the shot-check reaction
  // window. The human keeps the same window through PendingBanner, which
  // pauses on the AI's checks with Close Out on offer — the MTG-style pause,
  // already built.
  useEffect(() => {
    if (!game || game.done || opponent !== 'ai') return undefined;
    const timer = setTimeout(() => {
      const phase = game.phase;

      // Validate every AI play against the pure engine BEFORE it reaches the
      // reducer. A dispatch that fails inside the reducer returns the same
      // state object, React bails out of the re-render, and this effect never
      // fires again — the game freezes on the AI's turn. Running execCard here
      // and dispatching the RESULT means a bad play simply becomes a pass.
      const tryCard = (cardId, opts) => {
        const res = execCard(game, 'B', cardId, opts || {});
        if (res.ok) { dispatch({ type: 'UPDATE', game: res.game }); return true; }
        return false;
      };

      // A pending check on the HUMAN's shooter: the AI takes its reaction
      // window, then lets the die fly. The AI's own checks wait for the human.
      if (game.pendingShotCheck) {
        const psc = game.pendingShotCheck;
        if (psc.teamKey === 'A') {
          if (!psc.reacted) {
            const react = aiReactionDecision(game, 'B', 'shot_check');
            if (react?.type === 'play_card' && tryCard(react.cardId, react.opts)) return;
          }
          dispatch({ type: 'RESOLVE_CHECK' });
        }
        return;
      }

      if (phase === 'matchup_strats' && (game.placementStep ?? 10) >= 10 && game.matchupTurn === 'B') {
        const action = aiTurn(game, 'B');
        // One card, then the turn is the human's (handOverPriority); or pass.
        if (action?.type === 'play_card' && tryCard(action.cardId, action.opts)) return;
        dispatch({ type: 'UPDATE', game: passTurn(game, 'B') });
        return;
      }

      if (phase === 'scoring') {
        const rollingOpen = (game.scoringPasses || 0) >= 99;

        if (!rollingOpen && game.scoringTurn === 'B') {
          const action = aiScoringDecision(game, 'B');
          if (action?.type === 'play_card' && tryCard(action.cardId, action.opts)) return;
          dispatch({ type: 'UPDATE', game: passTurn(game, 'B') });
          return;
        }
        if (rollingOpen) {
          const rollsB = game.rollResults?.B || [];
          const blockedB = game.blockedRolls?.B || {};
          const needsRoll = [0, 1, 2, 3, 4].some(i => rollsB[i] == null && !blockedB[i]);
          if (needsRoll) {
            // Crunch Time: the AI calls its timeout (defensive re-set via the
            // reducer), then next tick plays its best rider from the open
            // window, then resumes.
            if (game.timeoutActive === 'B') {
              const rider = aiScoringDecision(game, 'B');
              if (rider?.type === 'play_card' && tryCard(rider.cardId, rider.opts)) return;
              dispatch({ type: 'END_TIMEOUT' });
              return;
            }
            if (!game.timeoutActive && aiCrunchDecision(game, 'B')?.type === 'timeout') {
              dispatch({ type: 'TIMEOUT', teamKey: 'B', silent: true });
              return;
            }
            // Mid-roll card window before the next die — a Heat Check on a
            // fresh top-tier roll. One play per tick; a rejected play falls
            // through to the roll.
            const cardAction = aiScoringDecision(game, 'B');
            if (cardAction?.type === 'play_card' && tryCard(cardAction.cardId, cardAction.opts)) return;
            const action = aiRollDecision(game, 'B');
            if (action?.playerIdx != null) {
              dispatch({ type: 'ROLL', teamKey: 'B', idx: action.playerIdx, opts: { clutch: action.clutch } });
              return;
            }
            // No rollable player despite open slots — fall through to spends.
          }
          const spend = aiSpendDecision(game, 'B');
          if (spend?.type === 'spend_assist') {
            const res = spendAssist(game, 'B', spend.spendType, spend.playerIdx);
            if (res.ok) { dispatch({ type: 'UPDATE', game: res.game }); return; }
          }
          if (spend?.type === 'spend_rebound') {
            const res = spendReboundBonus(game, 'B', spend.rebType, spend.playerIdx);
            if (res.ok) { dispatch({ type: 'UPDATE', game: res.game }); return; }
          }
        }
      }
    }, AI_DELAY);
    return () => clearTimeout(timer);
  }, [game, opponent]);

  const startGame = useCallback((rA, rB, deckA, deckB) => {
    dispatch({ type: 'SET', game: newGame(rA, rB, deckA, deckB, { clutchDice: CLUTCH_DICE }) });
  }, []);

  const handlers = {
    setGame:      (g)                     => dispatch({ type: 'UPDATE', game: g }),
    onRoll:       (teamKey, idx, opts)    => dispatch({ type: 'ROLL', teamKey, idx, opts }),
    onTimeout:    (teamKey)               => dispatch({ type: 'TIMEOUT', teamKey }),
    onEndTimeout: ()                      => dispatch({ type: 'END_TIMEOUT' }),
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
      opponent={opponent} setOpponent={setOpponent}
      onStart={startGame}
    />
  );

  if (game.done) return <GameOver game={game} onPlayAgain={handlers.onPlayAgain} />;

  // THE WAY OUT. A game used to hold the tab until it finished: start a
  // random one, decide you wanted your built rosters instead, and the first
  // game sat there with no exit but playing it through. Same reset the
  // results screen uses, behind a confirm because it discards the game.
  const abandon = () => {
    if (!confirm('Abandon this game? Nothing about it is saved.')) return;
    dispatch({ type: 'SET', game: null });
  };

  return (
    <div className={styles.layout}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className={styles.btnSec} onClick={abandon} style={{ fontSize: 12, padding: '4px 12px' }}>
          ✕ Abandon game
        </button>
      </div>
      <Scoreboard game={game} />
      <GameLog log={game.log} />
      <AnalyticsPanel analytics={game.analytics} />
      <CourtBoard
        game={game}
        setGame={handlers.setGame}
        onRoll={handlers.onRoll}
        onEndSection={handlers.onEndSection}
        onExecCard={handlers.onExecCard}
        onResolve={handlers.onResolve}
        onSpendAssist={handlers.onSpendAssist}
        onSpendRebound={handlers.onSpendRebound}
        onTimeout={handlers.onTimeout}
        onEndTimeout={handlers.onEndTimeout}
      />
    </div>
  );
}

function NoGame({ canUseBuilt, rosterA, rosterB, opponent, setOpponent, onStart }) {
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

  // Two rosters inside the salary band real teams live in — the same draw the
  // sandbox's dice button makes — rather than the first twenty cards of a
  // shuffle, which could put a $2,400 team against a $5,500 one.
  const quickStart = () => {
    const a = randomizeTeam([], false, null);
    const b = randomizeTeam(a, false, null);
    onStart(a, b, getDeckConfig(deckA), getDeckConfig(deckB));
  };

  const hasSavedDecks = decks.length > 0;

  return (
    <div className={styles.noGame}>
      <div className={styles.noGameCard}>
        <div className={styles.noGameIcon}>🏀</div>
        <h2>NBA Showdown 2026</h2>
        <p>D20 Basketball Card Game — 306 Players · Strategy Deck System</p>
        <p style={{ fontSize:12, color:'var(--text-dim)', marginBottom:'1rem' }}>Draft order: A → B → B → A → A → B → B → A → A → B</p>

        {user && hasSavedDecks && (
          <div className={styles.deckPickers}>
            <DeckPicker label="Team A Deck" value={deckA} onChange={setDeckA} decks={decks} color="var(--orange)" />
            <DeckPicker label="Team B Deck" value={deckB} onChange={setDeckB} decks={decks} color="var(--blue)" />
          </div>
        )}

        <div className={styles.deckPickers}>
          <div className={styles.deckPicker}>
            <label className={styles.deckLabel} style={{ color: 'var(--blue)' }}>Team B is played by</label>
            <select className={styles.deckSelect} value={opponent} onChange={e => setOpponent(e.target.value)}>
              <option value="ai">🤖 The AI coach</option>
              <option value="human">🧑 Me — play both sides</option>
            </select>
          </div>
        </div>

        <div className={styles.noGameBtns}>
          {canUseBuilt && (
            <button className={styles.btnPri} onClick={() => handleStart(rosterA, rosterB)}>
              🏀 Start with Team Builder Rosters
            </button>
          )}
          {rosterA.length >= MIN_TO_PLAY && (
            <button
              className={styles.btnSec}
              onClick={() => handleStart(rosterA, randomizeTeam(rosterA, false, null))}
              title="Your Team A against a random roster in the salary band"
            >
              🏀 Team A vs a random opponent
            </button>
          )}
          <button className={styles.btnSec} onClick={quickStart}>🎲 Quick Match (random teams)</button>
        </div>
        {rosterA.length < MIN_TO_PLAY && <p className={styles.hint}>Load a team into Team A to play it — or Quick Match.</p>}
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
