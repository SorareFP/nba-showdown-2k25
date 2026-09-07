import { useReducer, useCallback, useState, useEffect, useRef } from 'react';
import { newGame, doRoll, endSection, spendAssist, spendReboundBonus, applyMatchups, spendTimeout, endTimeout, clutchAvailable, passTurn } from '../game/engine.js';
import { aiTurn, aiScoringDecision, aiRollDecision, aiSpendDecision, aiReactionDecision, aiCrunchDecision, aiSetMatchups } from '../game/ai.js';
import { CLUTCH_DICE } from '../game/clutchAwards.js';
import { execCard, resolvePendingShotCheck } from '../game/execCard.js';
import { randomizeTeam, MIN_TO_PLAY } from '../game/teamRules.js';
import { resultFromPlayed } from '../game/modes/season.js';
// A REDUCER CANNOT HOLD A HOOK, and must not have side effects at all — so a
// rejected play reports through the module-level sink rather than through
// useDialogs(). See notify() in ui/dialogs.jsx.
import { useDialogs, notify } from '../ui/dialogs.jsx';
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
      if (!ok) { if (!action.silent) notify(msg, { tone: 'error' }); return state; }
      // The coach draws it up: the timeout's defensive re-set, computed by
      // the same matchup brain the AI uses — for either team.
      const reset = aiSetMatchups(game, action.teamKey);
      return reset?.matchups ? applyMatchups(game, action.teamKey, reset.matchups) : game;
    }
    case 'END_TIMEOUT': return endTimeout(state);
    case 'END_SECTION': return endSection(state);
    case 'EXEC_CARD': {
      const { game, ok, msg } = execCard(state, action.teamKey, action.cardId, action.opts || {});
      if (!ok) { if (!action.silent) notify(msg, { tone: 'error' }); return state; }
      return game;
    }
    case 'SPEND_ASSIST': {
      const { game, ok, msg } = spendAssist(state, action.teamKey, action.spendType, action.playerIdx);
      if (!ok) { if (!action.silent) notify(msg, { tone: 'error' }); return state; }
      return game;
    }
    case 'SPEND_REBOUND': {
      const { game, ok, msg } = spendReboundBonus(state, action.teamKey, action.rebType, action.playerIdx);
      if (!ok) { if (!action.silent) notify(msg, { tone: 'error' }); return state; }
      return game;
    }
    case 'RESOLVE_CHECK': return resolvePendingShotCheck(state);
    case 'UPDATE':      return action.game;
    default:            return state;
  }
}

const AI_DELAY = 700;

/**
 * `preset` is a game somebody else decided on: a season fixture, handed down
 * from App. It carries the two rosters, which side of the fixture you are, and
 * the ids needed to report the score back. When one is set the pre-game screen
 * is skipped entirely and the results screen leaves to the season instead of
 * offering Play Again — the schedule decides what comes next, not this tab.
 */
export default function PlayTab({ teamA: rosterA, teamB: rosterB, preset = null, onPresetFinish = null }) {
  const [game, dispatch] = useReducer(gameReducer, null);
  const { ask } = useDialogs();

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

  // A FIXTURE STARTS ITSELF. The ref is the "which one" — without it every
  // re-render while a season game is in progress would deal a fresh game over
  // the top of it. Clearing it when the preset goes away is what lets the same
  // fixture be started again after you abandon one.
  const presetRef = useRef(null);
  useEffect(() => {
    if (!preset) { presetRef.current = null; return; }
    if (presetRef.current === preset.key) return;
    presetRef.current = preset.key;
    const deal = () => {
      setOpponent('ai');
      dispatch({ type: 'SET', game: newGame(preset.rosterA, preset.rosterB, null, null, { clutchDice: CLUTCH_DICE }) });
    };
    // A sandbox game in progress is somebody's evening. Dealing a fixture over
    // the top of it would discard it with no warning and no way back, so the
    // fixture asks first and bounces to the season if the answer is no. The
    // ask is a promise, so the effect sets up and lets the answer arrive.
    if (!game || game.done) { deal(); return; }
    let live = true;
    ask({
      title: 'Start this season fixture?',
      body: 'The game you have going will be discarded.',
      confirmLabel: 'Discard and play the fixture',
      cancelLabel: 'Keep my game',
      tone: 'danger',
    }).then(yes => {
      if (!live) return;
      if (yes) deal();
      else { presetRef.current = null; onPresetFinish?.(null); }
    });
    return () => { live = false; };
    // `preset` alone, deliberately: `game` is read once, when a preset first
    // arrives, and listing it would re-run this on every roll of the game it
    // just dealt.
  }, [preset]);

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

  // One frame of the pre-game screen before the effect above deals the fixture
  // would read as a flicker, so a pending preset shows nothing at all.
  if (!game) return preset ? null : (
    <NoGame
      canUseBuilt={rosterA.length >= 5 && rosterB.length >= 5}
      rosterA={rosterA} rosterB={rosterB}
      opponent={opponent} setOpponent={setOpponent}
      onStart={startGame}
    />
  );

  if (game.done) {
    if (!preset) return <GameOver game={game} onPlayAgain={handlers.onPlayAgain} />;
    // The score as the FIXTURE sees it — see resultFromPlayed for why the
    // home/away mapping is not written out here.
    const result = { seasonId: preset.seasonId, ...resultFromPlayed(preset, game.teamA.score, game.teamB.score) };
    return (
      <GameOver
        game={game}
        onLeave={() => { dispatch({ type: 'SET', game: null }); onPresetFinish?.(result); }}
        leaveLabel="Back to the season →"
      />
    );
  }

  // THE WAY OUT. A game used to hold the tab until it finished: start a
  // random one, decide you wanted your built rosters instead, and the first
  // game sat there with no exit but playing it through. Same reset the
  // results screen uses, behind a confirm because it discards the game.
  const abandon = async () => {
    const yes = await ask(preset
      ? { title: 'Leave this fixture?', body: 'It stays unplayed and you can come back to it.', confirmLabel: 'Leave it' }
      : { title: 'Abandon this game?', body: 'Nothing about it is saved.', confirmLabel: 'Abandon', tone: 'danger' });
    if (!yes) return;
    dispatch({ type: 'SET', game: null });
    // No result: the season clears the preset and leaves the fixture open.
    if (preset) onPresetFinish?.(null);
  };

  return (
    <div className={styles.layout}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
          {preset ? preset.label : ''}
        </div>
        <button className={styles.btnSec} onClick={abandon} style={{ fontSize: 12, padding: '4px 12px' }}>
          {preset ? '✕ Leave fixture' : '✕ Abandon game'}
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
