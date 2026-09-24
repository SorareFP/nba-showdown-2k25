import { useReducer, useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { newGame, doRoll, endSection, spendAssist, spendReboundBonus, applyMatchups, spendTimeout, endTimeout, clutchAvailable, passTurn, pendingRolls, rollGate, coachCardWindow, searchCrunchCard } from '../game/engine.js';
import { aiTurn, aiScoringDecision, aiRollDecision, aiSpendDecision, aiReactionDecision, aiCrunchDecision, aiCrunchSearch, aiSetMatchups, aiGoUnderChoice } from '../game/ai.js';
import { CLUTCH_DICE } from '../game/clutchAwards.js';
import { execCard, resolvePendingShotCheck, resolveGoUnder } from '../game/execCard.js';
import { randomizeTeam, MIN_TO_PLAY } from '../game/teamRules.js';
import { resultFromPlayed } from '../game/modes/season.js';
import { AI_LEVELS, iqOf, capOf, samplesOf, loadAiLevel, saveAiLevel, payNote } from '../game/aiLevels.js';
import { boxScoreFor } from '../game/boxScore.js';
// A REDUCER CANNOT HOLD A HOOK, and must not have side effects at all — so a
// rejected play reports through the module-level sink rather than through
// useDialogs(). See notify() in ui/dialogs.jsx.
import { useDialogs, notify } from '../ui/dialogs.jsx';
import { useIsWide, useIsRoomy } from '../ui/useIsWide.js';
import { playCrunch, playBuzzer } from '../game/gameAudio.js';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { loadDecks } from '../firebase/savedDecks.js';
import { loadRemoteGame, saveRemoteGameIfCurrent, loadRemoteBackup, clearRemoteBackup } from '../firebase/games.js';
import {
  readLocalGame, writeLocalGame, makeSave, describeSave, createRemoteSaver, newGameId, remoteDecision, fixtureDecision, samePreset, gameTerms, termsOf, claimIdOf,
  readBackups, dropBackup, recoverable, takePendingRecover, RECOVER_EVENT,
} from '../game/gameSave.js';
import { rungDrawFor, stampBelongs } from '../game/gameClaim.js';
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
  const wide = useIsWide();
  // 1600-2200px: the zig-zag court, and the log moves under it, open.
  const roomy = useIsRoomy();
  const { ask, toast } = useDialogs();
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  // WHICH GAME, AND HOW FRESH (see "Which game, and which copy" in
  // gameSave.js). `gameId` names a non-fixture game; `heldAt` is the stamp of
  // this device's newest save; `baseAt` the stamp of the last copy the
  // account had from, or gave to, this device. An account write is refused
  // once the account has moved past it (saveRemoteGameIfCurrent).
  // A save from before ids existed gets one now (2026-09-18), so its claim
  // can carry a receipt key: it is paid once and stamped, like any other.
  const gameId = useRef(saved?.id ?? (saved?.game && !saved.preset?.key ? newGameId() : null));
  // THE GAME'S PAY TERMS (gameSave.js gameTerms), fixed when it was dealt and
  // restored with it — never re-read from this device's settings, which is
  // what let a reloaded hotseat game claim as a game against the coach and a
  // Settler game claim at Deity (2026-09-18). `paid` is the claim's stamp: a
  // paid game's results screen shows what it was paid and never re-sends.
  const [terms, setTermsState] = useState(() => (saved?.game ? termsOf(saved, loadAiLevel()) : null));
  const termsRef = useRef(terms);
  const setTerms = useCallback(t => { termsRef.current = t; setTermsState(t); }, []);
  const [paid, setPaidState] = useState(saved?.paid ?? null);
  const paidRef = useRef(saved?.paid ?? null);
  const setPaid = useCallback(p => { paidRef.current = p; setPaidState(p); }, []);
  // An old save's new id and terms are written back to THIS device once, with
  // its own stamp kept — re-stamping on mount would make it look newer than
  // another device's real progress — so a reload finds the same id and terms.
  useEffect(() => {
    if (saved?.game && (!saved.terms || (!saved.id && !saved.preset?.key))) {
      writeLocalGame({ ...saved, ...(gameId.current ? { id: gameId.current } : {}), terms: termsRef.current });
    }
    // Once, for the save read at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  // A REFUSED SAVE IS SAID OUT LOUD (2026-09-23), once a sitting: the
  // browser is out of room or blocking storage, and a game with nothing
  // behind it must not look like one that is saved.
  const storageWarned = useRef(false);
  // Set by abandon(): the game about to be cleared was let go on purpose.
  const abandoning = useRef(false);
  useEffect(() => {
    // The preset by KEY (samePreset): opening a fixture from the season hands
    // over a new object for the same fixture, and that is not a change.
    if (written.current.game === game && samePreset(written.current.preset, livePreset)) return;
    written.current = { game, preset: livePreset };
    const save = makeSave(game, livePreset, gameId.current, { terms: termsRef.current, paid: paidRef.current });
    const stored = writeLocalGame(save, { abandoned: abandoning.current });
    abandoning.current = false;
    // A cleared game went to the backups just now, after this render read them.
    if (!save) setBackupsSeen(n => n + 1);
    if (!stored && save && !storageWarned.current) {
      storageWarned.current = true;
      toast(uid
        ? 'This browser refused to store your game (it may be out of room). It is still saving to your account.'
        : 'This browser refused to store your game (it may be out of room). Sign in so it saves to your account.',
      { tone: 'error' });
    }
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
  //
  // `opponent` is the pre-game CHOICE; a game in progress plays by its saved
  // terms (gameOpponent), so a reload cannot turn a hotseat game into a game
  // against the coach (2026-09-18).
  const [opponent, setOpponent] = useState(() => (saved?.game ? termsOf(saved).opponent : 'ai'));
  const gameOpponent = terms?.opponent ?? opponent;
  // COACH DIFFICULTY — the matchup IQ lever (aiLevels.js), remembered per
  // browser. Applies to every game against the coach, sandbox or season.
  const [aiLevel, setAiLevelState] = useState(() => loadAiLevel());
  const setAiLevel = id => { setAiLevelState(id); saveAiLevel(id); };
  // Back on this tab, the device setting is read again (2026-09-18): the tab
  // stays mounted once visited, and the Season tab's Coach picker writes the
  // same setting, so the picker here would otherwise show — and a new game be
  // dealt at — the rung read at mount. A game in progress plays by its terms.
  useEffect(() => { if (active) setAiLevelState(loadAiLevel()); }, [active]);
  // ONE SETTING, EVERYWHERE, AND CHANGEABLE. The user, 2026-09-14: "we'll want
  // in-game AI difficulty to be changeable in a dynasty/season probably."
  //
  // An earlier version of this pinned the rung to the dynasty, because the same
  // number also drafted its AI teams and letting it move would have allowed a
  // league drafted against Settler to be played against Deity. The draft no
  // longer reads it (createDynasty: the AI always drafts at full strength), so
  // the exploit is gone and the rung is free to be what it should be — a knob
  // you can turn between games. A fixture may still carry one, for a mode that
  // wants to insist.
  //
  // 2026-09-18: and once a game is dealt, ITS rung (terms.aiLevel) is the one
  // it is played and paid at — the setting here, or on the Season tab, moves
  // the next game, never this one.
  const playedLevel = terms?.aiLevel ?? livePreset?.aiLevel ?? aiLevel;

  // THE PAID STAMP. The claim's answer goes into the save — local and the
  // account's copy — so a reload, or the same finished game on another
  // device, shows what it was paid and never claims it again. The server's
  // receipt (gameReceipts/{key}) is the guard that holds when this cannot run.
  //
  // ONLY THE GAME THAT WAS CLAIMED (2026-09-18). The answer can land seconds
  // late — after Play Again and a Quick Match, or 'Back to the season' and the
  // next fixture's deal — and this used to stamp whatever game was live then:
  // the new game was marked paid, never claimed, and its results screen
  // showed the old game's coins. The key must be the live game's key.
  const stampPaid = useCallback((claimKey, result) => {
    const { game: g, preset: p } = liveNow.current ?? {};
    if (!stampBelongs(claimKey, claimIdOf({ game: g, preset: p, id: gameId.current }))) return;
    const stamp = { coins: result?.coins ?? 0, breakdown: result?.breakdown ?? [], at: Date.now() };
    setPaid(stamp);
    if (!g) return;
    const save = makeSave(g, p, gameId.current, { terms: termsRef.current, paid: stamp });
    written.current = { game: g, preset: p };
    writeLocalGame(save);
    heldAt.current = save.at;
    remote.current?.push(save);
  }, [setPaid]);

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
    // The copy's own terms and stamp — the opponent is no longer forced back
    // to the coach (a hotseat game stays hotseat on every device).
    const t = termsOf(s, loadAiLevel());
    setTerms(t);
    setOpponent(t.opponent);
    setPaid(s.paid ?? null);
    setRestoredPreset(s.preset ?? null);
    gameId.current = s.id ?? (s.preset?.key ? null : newGameId());
    baseAt.current = s.at || 0;
    heldAt.current = s.at || 0;
    // Taken as it is: the same stamp here and on the account, no re-save.
    written.current = { game: s.game, preset: s.preset ?? null };
    hadGame.current = true;
    writeLocalGame(s);
    dispatch({ type: 'SET', game: s.game });
    if (note) toast(note);
  }, [toast, setTerms, setPaid]);
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
        setTerms(null);
        setPaid(null);
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
  }, [adopt, ask, toast, onPresetFinish, setTerms, setPaid]);
  syncRef.current = handleRemote;

  // ── Recovering a game (2026-09-23) ──────────────────────────────────────
  //
  // Every in-progress game a save replaced or cleared is kept (gameSave.js
  // backups, and the account's `previous`). Recovering one takes it as the
  // game here, NEWEST from this moment — so it also becomes the account's
  // copy — and whatever was going here goes to the backups in its place, so
  // a recovery can itself be undone.
  const recover = useCallback(s => {
    if (!s?.game) return;
    const fresh = { ...s, at: Date.now() };
    adopt(fresh, 'Recovered — back where you left off.');
    dropBackup(s);
    remote.current?.push(fresh);
  }, [adopt]);
  // Asked for from Home (requestRecover): by event while mounted, by the
  // pending key on mount.
  useEffect(() => {
    const pending = takePendingRecover();
    if (pending) recover(pending);
    const on = e => { takePendingRecover(); recover(e.detail); };
    window.addEventListener(RECOVER_EVENT, on);
    return () => window.removeEventListener(RECOVER_EVENT, on);
  }, [recover]);
  const [accountBackup, setAccountBackup] = useState(null);
  useEffect(() => {
    if (!uid) { setAccountBackup(null); return undefined; }
    let live = true;
    loadRemoteBackup(uid).then(r => { if (live) setAccountBackup(r); }).catch(() => {});
    return () => { live = false; };
  }, [uid, game === null]);
  const [backupsSeen, setBackupsSeen] = useState(0);
  const recoverList = useMemo(
    () => (game ? [] : recoverable(null, [...readBackups(), ...(accountBackup ? [accountBackup] : [])])),
    // Re-read when the game goes, a backup is forgotten, or the account's arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game, accountBackup, backupsSeen]
  );
  const forget = useCallback(s => {
    dropBackup(s);
    if (accountBackup && (accountBackup === s || accountBackup.at === s.at)) {
      setAccountBackup(null);
      if (uid) clearRemoteBackup(uid).catch(() => {});
    }
    setBackupsSeen(n => n + 1);
  }, [accountBackup, uid]);

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
  // The coach's level reaches every judgement it makes, not just the snake:
  // cards, the answer to a check, and what it does with its assists.
  const iq = iqOf(playedLevel);
  useEffect(() => {
    if (!game || game.done || gameOpponent !== 'ai') return undefined;
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
            const react = aiReactionDecision(game, 'B', 'shot_check', { iq });
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
        const action = aiTurn(game, 'B', { iq });
        // One card, then the turn is the human's (handOverPriority); or pass.
        if (action?.type === 'play_card' && tryCard(action.cardId, action.opts)) return;
        dispatch({ type: 'UPDATE', game: passTurn(game, 'B') });
        return;
      }

      if (phase === 'scoring') {
        const rollingOpen = (game.scoringPasses || 0) >= 99;

        if (!rollingOpen && game.scoringTurn === 'B') {
          const action = aiScoringDecision(game, 'B', { iq });
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
          // See rollGate in engine.js for the rule, which is the same one the
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
              const rider = aiScoringDecision(game, 'B', { iq });
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
            const cardAction = aiScoringDecision(game, 'B', { iq });
            if (cardAction?.type === 'play_card' && tryCard(cardAction.cardId, cardAction.opts)) return;
            const action = aiRollDecision(game, 'B');
            if (action?.playerIdx != null) {
              dispatch({ type: 'ROLL', teamKey: 'B', idx: action.playerIdx, opts: { clutch: action.clutch } });
              return;
            }
            // No rollable player despite open slots — fall through to spends.
          } else if (coachCardWindow(game, 'B')) {
            // THE COACH'S LAST CARD WINDOW (coachCardWindow, engine.js). Every
            // window above hangs off "does it still need to roll", so once its
            // five were in, the coach could not play another card all section
            // — while the human's hand stayed live. Both simulators have
            // always given the side a window here, and it is where the cards
            // whose conditions ripen late finally become legal.
            const late = aiScoringDecision(game, 'B', { iq });
            if (late?.type === 'play_card' && tryCard(late.cardId, late.opts)) return;
          }
          const spend = aiSpendDecision(game, 'B', { iq });
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
  }, [game, gameOpponent, iq]);

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

  // `rungDraw`: did the coach's side come from randomizeTeam at THIS rung's
  // cap — the only game a rung above Prince pays its premium for (the user,
  // 2026-09-18: "any game where the coach did not draw its own team at the
  // rung pays the fair Prince rate"). NoGame says so per button.
  const startGame = useCallback((rA, rB, deckA, deckB, { rungDraw = false } = {}) => {
    // A new game, named, and superseding whatever the account held before now.
    gameId.current = newGameId();
    baseAt.current = Date.now();
    setTerms(gameTerms({ opponent, aiLevel, rungDraw }));
    setPaid(null);
    dispatch({ type: 'SET', game: newGame(rA, rB, deckA, deckB, { clutchDice: CLUTCH_DICE }) });
  }, [opponent, aiLevel, setTerms, setPaid]);

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
      // A fixture's coach plays the league's team, not one drawn here, so the
      // client says rungDraw false and the SERVER decides: it reads the
      // league's own rung and pays a verified league game at the lower of the
      // two (functions/index.js claimGameReward).
      //
      // The rung is read FRESH from the device (2026-09-18): PlayTab stays
      // mounted once visited, so its own `aiLevel` is the one read at mount,
      // while the Season tab's Coach picker writes only the device setting.
      // Open Play at Deity, pick Settler on the Season tab ("pays 50%"), press
      // Play — the fixture was dealt, played and paid at Deity. The terms
      // freeze whatever is read here, so it has to be what the picker shows.
      const device = loadAiLevel();
      setAiLevelState(device);
      const level = preset.aiLevel ?? device;
      setTerms(gameTerms({ opponent: 'ai', aiLevel: level, rungDraw: false }));
      setPaid(null);
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
    onPlayAgain:  ()                      => { setTerms(null); setPaid(null); dispatch({ type: 'SET', game: null }); },
  };

  // One frame of the pre-game screen before the effect above deals the fixture
  // would read as a flicker, so a pending preset shows nothing at all.
  if (!game) return livePreset ? null : (
    <NoGame
      canUseBuilt={rosterA.length >= 5 && rosterB.length >= 5}
      rosterA={rosterA} rosterB={rosterB}
      opponent={opponent} setOpponent={setOpponent} aiLevel={aiLevel} setAiLevel={setAiLevel}
      onStart={startGame}
      recoverList={recoverList} onRecover={recover} onForget={forget}
    />
  );

  if (game.done) {
    // THE CLAIM IS PRICED FROM THE SAVED TERMS (2026-09-18) and keyed by the
    // game's identity, and a paid game carries its stamp. The rung only prices
    // a game the COACH played: hotseat is two people and the difficulty
    // setting never applied to it.
    const claimTerms = terms ?? gameTerms({ opponent: gameOpponent, aiLevel: null, rungDraw: false });
    const payProps = {
      claimId: claimIdOf({ game, preset: livePreset, id: gameId.current }),
      rungDraw: claimTerms.rungDraw,
      paid,
      onPaid: stampPaid,
    };
    if (!livePreset) return <GameOver game={game} mode={claimTerms.opponent === 'human' ? 'hotseat' : 'ai'} aiLevel={claimTerms.opponent === 'ai' ? claimTerms.aiLevel : null} onPlayAgain={handlers.onPlayAgain} {...payProps} />;
    // The score as the FIXTURE sees it — see resultFromPlayed for why the
    // home/away mapping is not written out here.
    // `returnTab`: a dynasty fixture goes back to the Dynasty tab, not Season.
    const result = { seasonId: livePreset.seasonId, returnTab: livePreset.returnTab ?? null, ...resultFromPlayed(livePreset, game.teamA.score, game.teamB.score, boxScoreFor(game, 'A'), boxScoreFor(game, 'B')) };
    return (
      <GameOver
        game={game}
        mode="ai"
        // What the game was played at — fixed in its terms when it was dealt.
        // The server re-reads a league's own rung and floors this by it.
        aiLevel={claimTerms.aiLevel ?? playedLevel}
        {...payProps}
        // WHERE THE FIXTURE CAME FROM: its season always, and its dynasty or
        // friends league when it has one. The SERVER checks each against the
        // account's own records before it pays a league's rung (the league
        // drew the coach's teams at it — season.js capOf(aiLevel)) floored by
        // min(built-at, played-at), or the dynasty rate (DYNASTY_GAME_FACTOR).
        // 2026-09-18: this was sent for dynasty and friends fixtures only, so
        // a plain season's game never reached that check — a Deity season's
        // win paid 1x as a "custom" game, and a Settler season played with the
        // dial at Prince escaped the league's floor. A shared (non-dynasty)
        // league's seasonId names no season of the player's, so it still
        // prices as a game the server cannot verify, at most the fair rate.
        fixtureFrom={livePreset.seasonId
          ? { dynastyId: livePreset.dynastyId ?? null, leagueId: livePreset.leagueId ?? null, seasonId: livePreset.seasonId }
          : null}
        onLeave={() => { dispatch({ type: 'SET', game: null }); setRestoredPreset(null); setTerms(null); setPaid(null); onPresetFinish?.(result); }}
        leaveLabel="Back to the season →"
      />
    );
  }

  // THE WAY OUT. A game used to hold the tab until it finished: start a
  // random one, decide you wanted your built rosters instead, and the first
  // game sat there with no exit but playing it through. Same reset the
  // results screen uses, behind a confirm because it discards the game.
  const abandon = async () => {
    // A FIXTURE IS LEFT, NOT THROWN AWAY (2026-09-24). The user, in a dynasty:
    // "Game state still is not saving upon leaving a game". Leaving asked
    // "Leave this fixture? It stays unplayed and you can come back to it" and
    // then cleared the game — the fixture stayed unplayed, the evening's
    // progress went to the backups, and "Resume" dealt a fresh game. Now the
    // game stays exactly where it is and the season or dynasty screen offers
    // "Resume this game". App drops its preset on the way out, so the restored
    // one has to carry the fixture, or the next save would forget which
    // fixture this is and the season could not find it again.
    if (livePreset) {
      setRestoredPreset(livePreset);
      toast('Your game is saved — Resume it from the fixture whenever you like.');
      onPresetFinish?.(null);
      return;
    }
    const yes = await ask({ title: 'Abandon this game?', body: 'It is set aside under Recover a game on the Play screen, in case you change your mind.', confirmLabel: 'Abandon', tone: 'danger' });
    if (!yes) return;
    abandoning.current = true;
    dispatch({ type: 'SET', game: null });
    setRestoredPreset(null);
    setTerms(null);
    setPaid(null);
  };

  const board = boardFor({ game, handlers, gameOpponent, playedLevel });

  return (
    <div className={styles.layout}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
          {livePreset ? livePreset.label : ''}
        </div>
        <button className={styles.btnSec} onClick={abandon} style={{ fontSize: 12, padding: '4px 12px' }}>
          {livePreset ? (livePreset.returnTab === 'dynasty' ? '↩ Back to the dynasty (saved)' : '↩ Back to the season (saved)') : '✕ Abandon game'}
        </button>
      </div>
      {wide ? (
        // A BIG MONITOR (useIsWide): the scoreboard and the court in the main
        // column, the log and the analytics docked open in a rail beside them.
        <div className={styles.wideGame}>
          <div className={styles.wideMain}>
            <Scoreboard game={game} rollGate={gameOpponent === 'ai' ? rollGate(game) : null} />
            {board}
            {/* UNDER THE COURT, OPEN (the user, 2026-09-24: "Game log did not
                move to under the cards"): the rail beside keeps the analytics. */}
            <GameLog log={game.log} defaultOpen />
          </div>
          <aside className={styles.wideRail} aria-label="Analytics">
            <div className={styles.railAnalytics}><AnalyticsPanel analytics={game.analytics} /></div>
          </aside>
        </div>
      ) : (
        <>
          {/* Whose die it is, where the a-b-a-b roll is enforced (2026-09-18). */}
          <Scoreboard game={game} rollGate={gameOpponent === 'ai' ? rollGate(game) : null} />
          {!roomy && <GameLog log={game.log} />}
          {/* Below the court on a phone (PlayTab.module.css .analyticsSlot). */}
          <div className={styles.analyticsSlot}><AnalyticsPanel analytics={game.analytics} /></div>
          {board}
          {/* A ROOMY SCREEN (1600-2200px, useIsRoomy) puts the log under the
              court, open (the user, 2026-09-24: "the Game Log can just be
              auto-expanded at the bottom of the page too"), so the court
              starts higher and the whole zig-zag fits the screen. */}
          {roomy && <GameLog log={game.log} defaultOpen />}
        </>
      )}
    </div>
  );
}

/** The court, the hands and the phase bar: one element, placed by PlayTab's layout. */
function boardFor({ game, handlers, gameOpponent, playedLevel }) {
  return (
      <CourtBoard
        game={game}
        setGame={handlers.setGame}
        // Only against the coach: hotseat is two humans at one screen and
        // they alternate by agreement, and PvP has its own turn machinery.
        rollGate={gameOpponent === 'ai' ? rollGate(game) : null}
        aiIq={gameOpponent === 'ai' ? iqOf(playedLevel) : 1}
        aiSamples={gameOpponent === 'ai' ? samplesOf(playedLevel) : undefined}
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
        defenceIsHuman={gameOpponent === 'human'}
        // The coach's hand goes face down and its roster status comes up in
        // that panel's place. Hotseat passes null: both hands belong to the
        // person at the screen, and hiding one from the other is theatre.
        coachTeam={gameOpponent === 'ai' ? 'B' : null}
      />
  );
}

/**
 * THE GAMES THAT CAN BE TAKEN BACK (2026-09-23): whatever a save replaced or
 * cleared while it was still going, newest first. Resume takes it as the game
 * here; Forget lets it go.
 */
export function RecoverList({ list = [], onRecover, onForget }) {
  if (!list.length) return null;
  return (
    <div className={styles.recover}>
      <div className={styles.recoverHead}>Recover a game</div>
      <p className={styles.hint} style={{ marginTop: 0 }}>A game in progress was replaced or cleared. It was kept — pick it back up here.</p>
      {list.map(s => (
        <div key={`${s.id ?? s.preset?.key ?? ''}:${s.at}`} className={styles.recoverRow}>
          <span className={styles.recoverLine}>{describeSave(s)}{s.abandoned ? ' (you abandoned it)' : ''}</span>
          <span className={styles.recoverBtns}>
            <button className={styles.btnPri} onClick={() => onRecover(s)}>Resume</button>
            {onForget && <button className={styles.btnSec} onClick={() => onForget(s)}>Forget</button>}
          </span>
        </div>
      ))}
    </div>
  );
}

function NoGame({ canUseBuilt, rosterA, rosterB, opponent, setOpponent, aiLevel, setAiLevel, onStart, recoverList = [], onRecover, onForget }) {
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

  const handleStart = (rA, rB, how = {}) => {
    onStart(rA, rB, getDeckConfig(deckA), getDeckConfig(deckB), how);
  };

  // Two rosters inside the salary band real teams live in — the same draw the
  // sandbox's dice button makes — rather than the first twenty cards of a
  // shuffle, which could put a $2,400 team against a $5,500 one.
  //
  // Both are drawn at the PLAIN cap, so above Prince the coach has not drawn
  // its own team at the rung and the game pays at most the fair rate
  // (2026-09-18); at or below Prince the plain cap IS the rung's cap.
  //
  // WHAT THE COACH PLAYS IS ITS DECK TOO (2026-09-18). The Team B deck picker
  // hands the coach a deck the human chose — an empty one, even — and a Deity
  // coach with no strategy cards won 45% where an honest one wins 74%, paid
  // at 1.5x. rungDrawFor counts a chosen Team B deck as a custom game.
  const how = button => ({ rungDraw: rungDrawFor(button, { opponent, aiLevel, deckB }) });
  const quickStart = () => {
    const a = randomizeTeam([], false, null);
    const b = randomizeTeam(a, false, null);
    onStart(a, b, getDeckConfig(deckA), getDeckConfig(deckB), how('quick'));
  };
  // THE BUTTONS SAY SO (2026-09-18): the picker promises "a win pays 150%",
  // and two of the three starts cannot pay it above Prince. Said here, not
  // discovered on the results screen.
  const premium = opponent === 'ai' && capOf(aiLevel) > 1;
  const customNote = 'pays at most the standard rate';
  const deckNote = premium && deckB !== 'default' ? `You chose the coach's deck: ${customNote}` : null;

  const hasSavedDecks = decks.length > 0;

  return (
    <div className={styles.noGame}>
      <div className={styles.noGameCard}>
        <RecoverList list={recoverList} onRecover={onRecover} onForget={onForget} />
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
              {/* The rate is on the option because it is part of the choice:
                  an easier coach loses by more, and the win bonus scales with
                  the margin, so without it the easiest rung would be the most
                  profitable one to grind (coinRewards.js AI_PAY). */}
              <select className={styles.deckSelect} value={aiLevel} onChange={e => setAiLevel(e.target.value)} title="How hard the coach plays — and what a game against it pays">
                {AI_LEVELS.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.label} — {l.blurb} · {payNote(l.id)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className={styles.noGameBtns}>
          {/* YOU BUILT THE COACH'S TEAM here, so no rung's premium applies
              (2026-09-18: the farm was a junk Team B at Deity, 263 a game). */}
          {canUseBuilt && (
            <button
              className={styles.btnPri}
              onClick={() => handleStart(rosterA, rosterB, how('built'))}
              title={premium ? `You built the coach's team: ${customNote}` : undefined}
            >
              🏀 Start with Team Builder Rosters
            </button>
          )}
          {rosterA.length >= MIN_TO_PLAY && (
            <button
              className={styles.btnSec}
              onClick={() => handleStart(rosterA, randomizeTeam(rosterA, false, null, opponent === 'ai' ? capOf(aiLevel) : 1), how('random'))}
              title={deckNote ?? 'Your Team A against a random roster in the salary band'}
            >
              🏀 Team A vs a random opponent
            </button>
          )}
          <button
            className={styles.btnSec}
            onClick={quickStart}
            title={premium ? `Both teams drawn at the plain cap: ${customNote}` : undefined}
          >
            🎲 Quick Match (random teams)
          </button>
        </div>
        {premium && (
          <p className={styles.hint}>
            {deckNote
              ? `${deckNote}.`
              : `Only “Team A vs a random opponent” with the default Team B deck pays this rung's win premium — the coach draws its own team at the rung. The other starts pay at most the standard rate.`}
          </p>
        )}
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
