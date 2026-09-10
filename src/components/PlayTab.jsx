import { useReducer, useCallback, useState, useEffect, useRef } from 'react';
import { newGame, doRoll, endSection, spendAssist, spendReboundBonus, applyMatchups, spendTimeout, endTimeout, clutchAvailable, passTurn, pendingRolls, searchCrunchCard } from '../game/engine.js';
import { aiTurn, aiScoringDecision, aiRollDecision, aiSpendDecision, aiReactionDecision, aiCrunchDecision, aiCrunchSearch, aiSetMatchups, aiGoUnderChoice } from '../game/ai.js';
import { CLUTCH_DICE } from '../game/clutchAwards.js';
import { execCard, resolvePendingShotCheck, resolveGoUnder } from '../game/execCard.js';
import { randomizeTeam, MIN_TO_PLAY } from '../game/teamRules.js';
import { resultFromPlayed } from '../game/modes/season.js';
import { AI_LEVELS, iqOf, loadAiLevel, saveAiLevel } from '../game/aiLevels.js';
import { boxScoreFor } from '../game/boxScore.js';
// A REDUCER CANNOT HOLD A HOOK, and must not have side effects at all — so a
// rejected play reports through the module-level sink rather than through
// useDialogs(). See notify() in ui/dialogs.jsx.
import { useDialogs, notify } from '../ui/dialogs.jsx';
import { playCrunch, playBuzzer } from '../game/gameAudio.js';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { loadDecks } from '../firebase/savedDecks.js';
import { loadRemoteGame, saveRemoteGameIfCurrent } from '../firebase/games.js';
import { readLocalGame, writeLocalGame, makeSave, describeSave, createRemoteSaver, newGameId, remoteDecision, fixtureDecision, samePreset } from '../game/gameSave.js';
import { markPlayed } from '../game/firstRun.js';
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
    case 'SEARCH_CRUNCH': {
      const { game, ok, msg } = searchCrunchCard(state, action.teamKey, action.cardId);
      if (!ok) { if (!action.silent) notify(msg, { tone: 'error' }); return state; }
      return game;
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
 * A GAME SURVIVES A RELOAD.
 *
 * The game lived in a useReducer and nowhere else, so a refresh, a hot reload
 * from an edit, or a tab the browser decided to discard threw a whole game
 * away mid-section. The user, 2026-09-07, after an edit of mine reloaded the
 * dev server under him: "game-states might need to save so that people don't
 * get booted from their games."
 *
 * Saved on every change, restored as the reducer's initial state. The season
 * preset rides along, because a restored fixture still has to report its score
 * back — App's copy of the preset is gone after a reload, so PlayTab keeps its
 * own. Cleared when the game is abandoned or played out and left.
 *
 * localStorage can be absent or refuse (a private window, a browser set to
 * block site data), so every access is guarded and a game that cannot be
 * saved is still a game that can be played.
 *
 * AND A GAME FOLLOWS THE ACCOUNT (2026-09-07). Signed in, the same save also
 * goes to users/{uid}/games/current, debounced, so the game started on a
 * phone can be resumed on a desktop — the user: "I started my season game on
 * my phone and then moved to my desktop and cannot resume that game." The
 * newest save wins across devices and the device with the older copy asks
 * before taking the newer one. The helpers live in src/game/gameSave.js and
 * src/firebase/games.js.
 */

/**
 * WHO MAY ROLL NEXT, once both sides have passed and the dice are live.
 *
 * Strict alternation with the human leading: the human rolls, the coach rolls,
 * and the human gets the floor back — to roll again or to play a reaction —
 * before the coach's next die. A side with nobody left to roll stands aside
 * and the other finishes. `pending` counts slots that are neither rolled nor
 * blocked, so a This Is My House block does not stall the rotation.
 *
 * Returns { A, B }: whether each side may roll right now. Used by the AI
 * driver for B and by CourtBoard to enable the human's buttons for A.
 */
function rollGate(game) {
  // Second rolls (Offensive Board Mastery) count as rolls still to make.
  const pending = key => pendingRolls(game, key);
  const a = pending('A');
  const b = pending('B');
  return {
    A: b === 0 || a >= b,   // the human leads: equal counts means it is A's turn
    B: a === 0 || b > a,    // the coach follows: it rolls only once it is behind
  };
}

/**
 * `preset` is a game somebody else decided on: a season fixture, handed down
 * from App. It carries the two rosters, which side of the fixture you are, and
 * the ids needed to report the score back. When one is set the pre-game screen
 * is skipped entirely and the results screen leaves to the season instead of
 * offering Play Again — the schedule decides what comes next, not this tab.
 */
export default function PlayTab({ teamA: rosterA, teamB: rosterB, preset = null, onPresetFinish = null, active = true }) {
  // The save, read once. Its preset is the one PlayTab uses when App has none
  // — which after a reload is always.
  const [saved] = useState(readLocalGame);
  const [game, dispatch] = useReducer(gameReducer, saved?.game ?? null);
  const [restoredPreset, setRestoredPreset] = useState(saved?.preset ?? null);
  const livePreset = preset ?? restoredPreset;
  const { ask, toast } = useDialogs();
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  // WHICH GAME, AND HOW FRESH (see "Which game, and which copy" in
  // gameSave.js). `gameId` names a non-fixture game; `heldAt` is the stamp of
  // this device's newest save; `baseAt` the stamp of the last copy the
  // account had from, or gave to, this device. An account write is refused
  // once the account has moved past it (saveRemoteGameIfCurrent).
  const gameId = useRef(saved?.id ?? null);
  const heldAt = useRef(saved?.at ?? 0);
  const baseAt = useRef(saved?.at ?? 0);
  const syncRef = useRef(null);      // the current handleRemote, for the saver's refusals
  const syncing = useRef(false);     // a decision (maybe a dialog) is in flight
  const arriving = useRef(false);    // a season fixture is being set up

  // THE ROAMING COPY: one debounced writer per signed-in account, flushed
  // when the page is hidden or left so the last change is not lost inside
  // the debounce window, disposed when the account changes.
  const remote = useRef(null);
  useEffect(() => {
    if (!uid) { remote.current = null; return undefined; }
    // Guarded: refused when the account moved on since this device last saw
    // it, and the account's copy is then weighed like any other (handleRemote).
    const guarded = async s => {
      const r = await saveRemoteGameIfCurrent(uid, s, baseAt.current);
      if (r.ok && s) baseAt.current = s.at;
      return r;
    };
    const saver = createRemoteSaver({
      save: guarded,
      clear: () => guarded(null),
      onConflict: newer => syncRef.current?.(newer),
      onError: e => console.warn('game save (account):', e?.message ?? e),
    });
    remote.current = saver;
    const flush = () => { saver.flush(); };
    const onHide = () => { if (document.visibilityState === 'hidden') saver.flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      saver.flush();
      saver.dispose();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      if (remote.current === saver) remote.current = null;
    };
  }, [uid]);

  // Every CHANGE goes to the save — local always, the account's copy when
  // signed in. Identity decides what counts as a change: the game restored
  // at mount is the very object that was saved, and re-stamping it on mount
  // would make this device's copy look newer than a phone's real progress,
  // which is the one comparison the resume prompt depends on. A null game
  // clears the local copy always and the account's copy only once a game has
  // been held here — on a fresh mount with nothing local, the account may be
  // holding exactly the game the player came here to resume.
  const written = useRef({ game: saved?.game ?? null, preset: saved?.preset ?? null });
  const hadGame = useRef(Boolean(saved?.game));
  useEffect(() => {
    // The preset by KEY (samePreset): opening a fixture from the season hands
    // over a new object for the same fixture, and that is not a change.
    if (written.current.game === game && samePreset(written.current.preset, livePreset)) return;
    written.current = { game, preset: livePreset };
    const save = makeSave(game, livePreset, gameId.current);
    writeLocalGame(save);
    if (save) heldAt.current = save.at;
    if (save) { hadGame.current = true; remote.current?.push(save); markPlayed(); }
    else if (hadGame.current) { hadGame.current = false; remote.current?.push(null); }
  }, [game, livePreset]);

  // WHO PLAYS TEAM B. 'ai' hands B to the coach below; 'human' switches the
  // coach off and the game is hotseat — you play both sides, which is what
  // the UI did before the coach existed and still allows outside PvP (every
  // control gate in CourtBoard is `pvpMode && ...`). Hotseat is how you test
  // a specific outcome: steer both teams to the score you want and see what
  // the results screen pays. Chosen on the pre-game screen, fixed for the game.
  const [opponent, setOpponent] = useState('ai');
  // COACH DIFFICULTY — the matchup IQ lever (aiLevels.js), remembered per
  // browser. Applies to every game against the coach, sandbox or season.
  const [aiLevel, setAiLevelState] = useState(() => loadAiLevel());
  const setAiLevel = id => { setAiLevelState(id); saveAiLevel(id); };

  // ── Meeting the account's copy ──────────────────────────────────────────
  //
  // On opening Play, on coming back to this tab or window, and when a write
  // was refused, the account's copy is weighed by remoteDecision (gameSave.js).
  // A newer copy of THIS game is simply taken: the same evening, further along
  // on the other device. The user (2026-09-10): the game state did not "shift
  // elegantly from desktop to mobile". Only a DIFFERENT game over one going
  // here is asked about. A season fixture arriving makes its own call below.
  const liveNow = useRef(null);
  liveNow.current = { game, preset: livePreset };
  const adopt = useCallback((s, note) => {
    setOpponent('ai');
    setRestoredPreset(s.preset ?? null);
    gameId.current = s.id ?? null;
    baseAt.current = s.at || 0;
    heldAt.current = s.at || 0;
    // Taken as it is: the same stamp here and on the account, no re-save.
    written.current = { game: s.game, preset: s.preset ?? null };
    hadGame.current = true;
    writeLocalGame(s);
    dispatch({ type: 'SET', game: s.game });
    if (note) toast(note);
  }, [toast]);
  const handleRemote = useCallback(async remote => {
    if (!remote || syncing.current || arriving.current) return;
    const { game: g, preset: p } = liveNow.current;
    const held = g ? { game: g, preset: p, ...(gameId.current ? { id: gameId.current } : {}), at: heldAt.current } : null;
    const decision = remoteDecision({ held, remote, baseAt: baseAt.current });
    if (decision === 'none') return;
    syncing.current = true;
    try {
      if (decision === 'adopt') {
        adopt(remote, 'Picked up where you left off on your other device.');
      } else if (decision === 'drop') {
        // Finished over there, and reported and paid over there: the stale
        // copy here just goes, and the account keeps the finished one.
        baseAt.current = remote.at || 0;
        hadGame.current = false;
        dispatch({ type: 'SET', game: null });
        setRestoredPreset(null);
        toast('That game was finished on your other device.');
        if (p) onPresetFinish?.(null);
      } else {
        const yes = await ask({
          title: 'Your other device has a newer game',
          body: `${describeSave(remote)} Taking it discards the game you have here.`,
          confirmLabel: 'Take it',
          cancelLabel: 'Keep this one',
        });
        if (yes) adopt(remote, null);
        else baseAt.current = remote.at || 0;   // this device's next move overwrites it
      }
    } finally {
      syncing.current = false;
    }
  }, [adopt, ask, toast, onPresetFinish]);
  syncRef.current = handleRemote;
  const lastSync = useRef(0);
  const syncNow = useCallback(() => {
    if (!uid || Date.now() - lastSync.current < 2000) return;
    lastSync.current = Date.now();
    loadRemoteGame(uid).then(r => { if (r) syncRef.current?.(r); }).catch(() => {});
  }, [uid]);
  useEffect(() => {
    if (!uid) return undefined;
    // Back to the tab (visibility), or back to the window (focus — the page
    // was never hidden, only behind another window or on another monitor).
    const onVisible = () => { if (document.visibilityState === 'visible') syncNow(); };
    const onFocus = () => syncNow();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [uid, syncNow]);
  // Opening Play is a check too: this tab stays mounted behind the others, so
  // coming back to it is not a mount.
  useEffect(() => { if (active) syncNow(); }, [active, syncNow]);

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

      // A Go Under check waiting on the coach's choice: name the shooter first.
      if (game.pendingChoice?.teamKey === 'B') {
        const slot = aiGoUnderChoice(game, 'B');
        const r = resolveGoUnder(game, slot);
        if (r.ok) { dispatch({ type: 'UPDATE', game: r.game }); return; }
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
          const needsRoll = pendingRolls(game, 'B') > 0;
          // A-B-A-B, NOT B-B-B-B-B. This effect re-fires on every game change,
          // so once rolling opened the coach rolled all five of its players
          // back to back and every reaction window between them was gone
          // before a human could reach it — Anticipate the Pass most visibly
          // (the user, 2026-09-07: "the CPU just goes and goes and goes").
          // Both simulators already alternate; the live driver now does too.
          // See rollGate below for the rule, which is the same one the
          // human's Roll buttons obey from the other side.
          const gate = rollGate(game);
          if (needsRoll && gate.B) {
            // Crunch Time: the AI calls its timeout (defensive re-set via the
            // reducer), then next tick plays its best rider from the open
            // window, then resumes.
            if (game.timeoutActive === 'B') {
              // First the search: one crunch card out of the deck, then riders.
              const wanted = aiCrunchSearch(game, 'B');
              if (wanted) { dispatch({ type: 'SEARCH_CRUNCH', teamKey: 'B', cardId: wanted, silent: true }); return; }
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

  // ── The two moments the game announces about itself ───────────────────────
  //
  // Both fire on a FLIP, guarded by a ref rather than by the effect alone:
  // StrictMode runs effects twice in development, and a double buzzer is the
  // kind of thing you hear.
  const crunchArmed = Boolean(game?.crunch?.active);
  const lastCrunch = useRef(false);
  useEffect(() => {
    if (crunchArmed && !lastCrunch.current) playCrunch();
    lastCrunch.current = crunchArmed;
  }, [crunchArmed]);

  const over = Boolean(game?.done);
  const lastOver = useRef(false);
  useEffect(() => {
    if (over && !lastOver.current) playBuzzer();
    lastOver.current = over;
  }, [over]);

  const startGame = useCallback((rA, rB, deckA, deckB) => {
    // A new game, named, and superseding whatever the account held before now.
    gameId.current = newGameId();
    baseAt.current = Date.now();
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
    // What is here, as a save: the game and the preset it was restored with.
    const held = game ? { game, preset: restoredPreset, ...(gameId.current ? { id: gameId.current } : {}), at: heldAt.current } : null;
    const deal = () => {
      // A fresh preset from App supersedes anything restored, and a new game
      // supersedes whatever the account held before this moment.
      setRestoredPreset(null);
      gameId.current = null;
      baseAt.current = Date.now();
      setOpponent('ai');
      // The season's own deck for your side; the opponent plays the default.
      // THE VISITOR PLACES FIRST. Leading a row gives information away, so
      // home court is answering the snake: when you are at home the coach
      // (B) leads; on the road you do (the user, 2026-09-09).
      dispatch({ type: 'SET', game: newGame(preset.rosterA, preset.rosterB, preset.deckA ?? null, null, { clutchDice: CLUTCH_DICE, placementFirst: preset.humanIsHome ? 'B' : 'A' }) });
    };
    // WHICH COPY TO PLAY (fixtureDecision): the newest copy of this fixture,
    // here or on the account, is simply played. The stale phone copy used to
    // win, and a different game here used to hide the account's copy. A game
    // in progress that the fixture would replace is somebody's evening, so that
    // alone is asked about, and "no" bounces back to the season.
    let live = true;
    let decided = false;
    arriving.current = true;
    const bounce = () => { presetRef.current = null; onPresetFinish?.(null); };
    (async () => {
      try {
        const remote = uid ? await loadRemoteGame(uid).catch(() => null) : null;
        if (!live) return;
        const d = fixtureDecision({ held, remote, preset });
        if (d.use === 'finished') {
          decided = true;
          toast('This fixture was finished on your other device. Record the result there.', { tone: 'error' });
          bounce();
          return;
        }
        if (d.use === 'local') { decided = true; return; }
        if (d.discards) {
          const yes = await ask(d.use === 'remote'
            ? { title: 'Resume this fixture from your other device?', body: `${describeSave(d.save)} The game you have going here will be discarded.`, confirmLabel: 'Resume the fixture', cancelLabel: 'Keep my game', tone: 'danger' }
            : { title: 'Start this season fixture?', body: 'The game you have going will be discarded.', confirmLabel: 'Discard and play the fixture', cancelLabel: 'Keep my game', tone: 'danger' });
          if (!live) return;
          decided = true;
          if (!yes) { bounce(); return; }
        }
        decided = true;
        if (d.use === 'remote') adopt(d.save, 'Picked up where you left off on your other device.');
        else deal();
      } finally {
        if (live) arriving.current = false;
      }
    })();
    // StrictMode runs this twice on a first mount. A run cut short before it
    // decided hands the fixture back, so the second run can take it.
    return () => {
      live = false;
      arriving.current = false;
      if (!decided) presetRef.current = null;
    };
    // `preset` alone, deliberately: `game` is read once, when a preset first
    // arrives, and listing it would re-run this on every roll of the game it
    // just dealt.
  }, [preset]);

  const handlers = {
    setGame:      (g)                     => dispatch({ type: 'UPDATE', game: g }),
    onRoll:       (teamKey, idx, opts)    => dispatch({ type: 'ROLL', teamKey, idx, opts }),
    onTimeout:    (teamKey)               => dispatch({ type: 'TIMEOUT', teamKey }),
    onEndTimeout: ()                      => dispatch({ type: 'END_TIMEOUT' }),
    onSearchCrunch: (teamKey, cardId)     => dispatch({ type: 'SEARCH_CRUNCH', teamKey, cardId }),
    onSpendAssist:(teamKey, spendType, playerIdx) => dispatch({ type: 'SPEND_ASSIST', teamKey, spendType, playerIdx }),
    onSpendRebound:(teamKey, rebType, playerIdx) => dispatch({ type: 'SPEND_REBOUND', teamKey, rebType, playerIdx }),
    onEndSection: ()                      => dispatch({ type: 'END_SECTION' }),
    onExecCard:   (teamKey, cardId, opts) => dispatch({ type: 'EXEC_CARD', teamKey, cardId, opts }),
    onResolve:    ()                      => dispatch({ type: 'RESOLVE_CHECK' }),
    onPlayAgain:  ()                      => dispatch({ type: 'SET', game: null }),
  };

  // One frame of the pre-game screen before the effect above deals the fixture
  // would read as a flicker, so a pending preset shows nothing at all.
  if (!game) return livePreset ? null : (
    <NoGame
      canUseBuilt={rosterA.length >= 5 && rosterB.length >= 5}
      rosterA={rosterA} rosterB={rosterB}
      opponent={opponent} setOpponent={setOpponent} aiLevel={aiLevel} setAiLevel={setAiLevel}
      onStart={startGame}
    />
  );

  if (game.done) {
    if (!livePreset) return <GameOver game={game} mode={opponent} onPlayAgain={handlers.onPlayAgain} />;
    // The score as the FIXTURE sees it — see resultFromPlayed for why the
    // home/away mapping is not written out here.
    const result = { seasonId: livePreset.seasonId, ...resultFromPlayed(livePreset, game.teamA.score, game.teamB.score, boxScoreFor(game, 'A'), boxScoreFor(game, 'B')) };
    return (
      <GameOver
        game={game}
        mode="ai"
        onLeave={() => { dispatch({ type: 'SET', game: null }); setRestoredPreset(null); onPresetFinish?.(result); }}
        leaveLabel="Back to the season →"
      />
    );
  }

  // THE WAY OUT. A game used to hold the tab until it finished: start a
  // random one, decide you wanted your built rosters instead, and the first
  // game sat there with no exit but playing it through. Same reset the
  // results screen uses, behind a confirm because it discards the game.
  const abandon = async () => {
    const yes = await ask(livePreset
      ? { title: 'Leave this fixture?', body: 'It stays unplayed and you can come back to it.', confirmLabel: 'Leave it' }
      : { title: 'Abandon this game?', body: 'Nothing about it is kept.', confirmLabel: 'Abandon', tone: 'danger' });
    if (!yes) return;
    dispatch({ type: 'SET', game: null });
    setRestoredPreset(null);
    // No result: the season clears the preset and leaves the fixture open.
    if (livePreset) onPresetFinish?.(null);
  };

  return (
    <div className={styles.layout}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
          {livePreset ? livePreset.label : ''}
        </div>
        <button className={styles.btnSec} onClick={abandon} style={{ fontSize: 12, padding: '4px 12px' }}>
          {livePreset ? '✕ Leave fixture' : '✕ Abandon game'}
        </button>
      </div>
      <Scoreboard game={game} />
      <GameLog log={game.log} />
      {/* Below the court on a phone (PlayTab.module.css .analyticsSlot). */}
      <div className={styles.analyticsSlot}><AnalyticsPanel analytics={game.analytics} /></div>
      <CourtBoard
        game={game}
        setGame={handlers.setGame}
        // Only against the coach: hotseat is two humans at one screen and
        // they alternate by agreement, and PvP has its own turn machinery.
        rollGate={opponent === 'ai' ? rollGate(game) : null}
        aiIq={opponent === 'ai' ? iqOf(aiLevel) : 1}
        onRoll={handlers.onRoll}
        onEndSection={handlers.onEndSection}
        onExecCard={handlers.onExecCard}
        onResolve={handlers.onResolve}
        onSpendAssist={handlers.onSpendAssist}
        onSpendRebound={handlers.onSpendRebound}
        onTimeout={handlers.onTimeout}
        onEndTimeout={handlers.onEndTimeout} onSearchCrunch={handlers.onSearchCrunch}
        // Hotseat means a real person is sitting on the other side, so the
        // defence gets to make the choices that are the defence's — see
        // allocateStandingChecks. Against the coach, the engine allocates.
        defenceIsHuman={opponent === 'human'}
      />
    </div>
  );
}

function NoGame({ canUseBuilt, rosterA, rosterB, opponent, setOpponent, aiLevel, setAiLevel, onStart }) {
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
          {opponent === 'ai' && (
            <div className={styles.deckPicker}>
              <label className={styles.deckLabel} style={{ color: 'var(--blue)' }}>Coach difficulty</label>
              <select className={styles.deckSelect} value={aiLevel} onChange={e => setAiLevel(e.target.value)} title="How often the coach finds the right matchup in the placement snake">
                {AI_LEVELS.map(l => <option key={l.id} value={l.id}>{l.label} — {l.blurb}</option>)}
              </select>
            </div>
          )}
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
