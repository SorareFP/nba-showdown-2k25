import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { useDialogs } from '../ui/dialogs.jsx';
import {
  onGameState, onPrivateData, onRoomMeta,
  writeGameState, writeGameStateIf, writePrivateData, forfeitGame, abandonGame,
} from '../firebase/pvpRoom.js';
import { placementSnapshot, canUndoPlacement, undoPlacement, takenBackName } from '../game/placement.js';
import {
  initializePvpGame, getWhoseTurn, extractPrivateData, stripPrivateData,
  fixFromFirebase, prepareForFirebase,
} from '../firebase/pvpGame.js';
import { ref, get, set } from 'firebase/database';
import { rtdb } from '../firebase/config.js';
import { doRoll, endSection, spendAssist, spendReboundBonus, getTeam, emptyAnalytics } from '../game/engine.js';
import { execCard, resolvePendingShotCheck } from '../game/execCard.js';
import { canPlayCard } from '../game/canPlay.js';
import CourtBoard from './game/CourtBoard.jsx';
import GameOver from './game/GameOver.jsx';
import GameLog from './game/GameLog.jsx';
import AnalyticsPanel from './game/AnalyticsPanel.jsx';
import Scoreboard from './game/Scoreboard.jsx';
import { reportLeagueResult } from '../firebase/serverWrites.js';
import styles from './PvpGame.module.css';

export default function PvpGame({ roomCode, myRole, onLeave }) {
  // A LEAGUE FIXTURE REPORTS ITSELF. When the room is tagged with a league and
  // the game is over (played out or forfeited), tell the league. Both players
  // may; the server records the first and refuses the second as already
  // played, which is fine — and it reads the scores from this room, not from
  // us. `onLeagueDone` lets App refresh the league screen.
  const leagueReported = useRef(false);
  const { user } = useAuth();
  const { toast, ask } = useDialogs();

  const [meta, setMeta]             = useState(null);
  const [publicGame, setPublicGame] = useState(null);
  const [privateData, setPrivateData] = useState(null);

  // Defensive: preserve last known good hand so it can't vanish during phase transitions
  const lastGoodHandRef = useRef(null);

  // ── RTDB listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    const unsubs = [
      onRoomMeta(roomCode, (m) => { console.log('[PvP] meta:', m?.status); setMeta(m); }),
      onGameState(roomCode, (g) => { console.log('[PvP] game state:', g?.phase, 'hand A:', g?.teamA?.hand?.length, 'hand B:', g?.teamB?.hand?.length); setPublicGame(g); }),
      onPrivateData(roomCode, myRole, (p) => {
        console.log('[PvP] private data:', {
          received: !!p,
          hand: p?.hand?.length ?? 'null',
          deck: p?.deck?.length ?? 'null',
          draftPool: p?.draftPool?.length ?? 'null',
          keys: p ? Object.keys(p) : null,
        });
        setPrivateData(p);
      }),
    ];
    return () => unsubs.forEach(fn => fn());
  }, [roomCode, myRole]);

  const [initError, setInitError] = useState(null);

  // ── Game initialization (host only) ─────────────────────────────────────
  useEffect(() => {
    if (
      meta?.hostReady && meta?.guestReady &&
      meta?.status === 'team_select' && myRole === 'host'
    ) {
      console.log('[PvP] Host initializing game...', { roomCode, hostUid: meta.hostUid, guestUid: meta.guestUid });
      initializePvpGame(roomCode, meta.hostUid, meta.guestUid)
        .then(() => console.log('[PvP] Game initialized successfully'))
        .catch((err) => {
          console.error('[PvP] Game initialization FAILED:', err);
          setInitError(err.message);
        });
    }
  }, [meta, myRole, roomCode]);

  // ── Derived values ──────────────────────────────────────────────────────
  const myTeamKey = useMemo(() => {
    if (!publicGame) return null;
    return (myRole === 'host') === (publicGame.hostIs === 'A') ? 'A' : 'B';
  }, [publicGame, myRole]);

  const localGame = useMemo(() => {
    if (!publicGame || !privateData) return null;
    const g = JSON.parse(JSON.stringify(publicGame));

    // Firebase RTDB drops empty objects/arrays — restore defaults
    g.tempEff     = g.tempEff     || {};
    g.ghosted     = g.ghosted     || {};
    g.ignFatigue  = g.ignFatigue  || {};
    g.blockedRolls = g.blockedRolls || {};
    g.endSectionVotes = g.endSectionVotes || { A: false, B: false };
    g.challengesUsed = g.challengesUsed || { A: 0, B: 0 };
    g.lastShotCheck = g.lastShotCheck || null;
    g.log         = g.log         || [];
    g.rollResults = g.rollResults || { A: [], B: [] };
    g.rollResults.A = g.rollResults.A || [];
    g.rollResults.B = g.rollResults.B || [];
    g.offMatchups = g.offMatchups || { A: [], B: [] };
    g.offMatchups.A = g.offMatchups.A || [];
    g.offMatchups.B = g.offMatchups.B || [];
    g.analytics = g.analytics || { A: emptyAnalytics(), B: emptyAnalytics() };
    if (!g.analytics.A) g.analytics.A = emptyAnalytics();
    if (!g.analytics.B) g.analytics.B = emptyAnalytics();
    if (g.teamA) {
      g.teamA.hand    = g.teamA.hand    || [];
      g.teamA.discard = g.teamA.discard || [];
      g.teamA.starters = g.teamA.starters || [];
      g.teamA.stats   = g.teamA.stats   || [];
      g.teamA.roster  = g.teamA.roster  || [];
    }
    if (g.teamB) {
      g.teamB.hand    = g.teamB.hand    || [];
      g.teamB.discard = g.teamB.discard || [];
      g.teamB.starters = g.teamB.starters || [];
      g.teamB.stats   = g.teamB.stats   || [];
      g.teamB.roster  = g.teamB.roster  || [];
    }

    // Inject my private data (hand, deck, draft pool)
    const team = myTeamKey === 'A' ? g.teamA : g.teamB;
    let effectiveHand = privateData.hand || [];

    // Defensive: if hand vanished but we had one before, use the preserved copy
    if (effectiveHand.length === 0 && lastGoodHandRef.current && lastGoodHandRef.current.length > 0) {
      console.warn('[LOCAL_GAME] ⚠ Hand lost! privateData.hand is empty but lastGoodHand has', lastGoodHandRef.current.length, 'cards. Restoring.');
      effectiveHand = lastGoodHandRef.current;
    }
    // Track the last known good hand
    if (effectiveHand.length > 0) {
      lastGoodHandRef.current = [...effectiveHand]; // store a copy
    }

    team.hand = effectiveHand;
    if (Array.isArray(privateData.deck)) team.deck = privateData.deck;
    console.log('[LOCAL_GAME]', myRole, 'myTeamKey:', myTeamKey, 'phase:', g.phase, 'hand:', team.hand.length, 'deck:', (team.deck || []).length, 'privateData.hand:', privateData?.hand?.length ?? 'null');

    if (g.draft) {
      g.draft.aReady = g.draft.aReady || false;
      g.draft.bReady = g.draft.bReady || false;
      if (g.phase === 'draft') {
        if (myTeamKey === 'A') g.draft.aPool = privateData.draftPool || [];
        else                    g.draft.bPool = privateData.draftPool || [];
      }
    }

    return g;
  }, [publicGame, privateData, myTeamKey]);

  const isMyTurn = useMemo(() => {
    if (!publicGame) return false;
    const turn = publicGame.whoseTurn ?? getWhoseTurn(publicGame);
    return turn === myRole || turn === 'both';
  }, [publicGame, myRole]);

  const opponentName = useMemo(() => {
    if (!meta) return '...';
    return myRole === 'host' ? meta.guestName : meta.hostName;
  }, [meta, myRole]);

  // ── Firebase sync helper ────────────────────────────────────────────────
  const syncToFirebase = useCallback(async (updatedGame) => {
    const teamKey = (myRole === 'host') === (updatedGame.hostIs === 'A') ? 'A' : 'B';
    const myPrivate = extractPrivateData(updatedGame, teamKey);
    const pubGame   = stripPrivateData(updatedGame);

    await Promise.all([
      writeGameState(roomCode, pubGame),
      writePrivateData(roomCode, myRole, myPrivate),
    ]);
  }, [roomCode, myRole]);

  // Sync both players' private data (for endSection, etc. that affect both hands/decks)
  const syncBothToFirebase = useCallback(async (updatedGame) => {
    const hostPrivate = extractPrivateData(updatedGame, updatedGame.hostIs);
    const guestTeamKey = updatedGame.hostIs === 'A' ? 'B' : 'A';
    const guestPrivate = extractPrivateData(updatedGame, guestTeamKey);
    const pubGame = stripPrivateData(updatedGame);

    console.log('[SYNC_BOTH] hostIs:', updatedGame.hostIs, 'guestTeamKey:', guestTeamKey);
    console.log('[SYNC_BOTH] hostPrivate hand:', hostPrivate.hand?.length, 'deck:', hostPrivate.deck?.length);
    console.log('[SYNC_BOTH] guestPrivate hand:', guestPrivate.hand?.length, 'deck:', guestPrivate.deck?.length);
    console.log('[SYNC_BOTH] teamA.hand:', updatedGame.teamA?.hand?.length, 'teamB.hand:', updatedGame.teamB?.hand?.length);

    await Promise.all([
      writeGameState(roomCode, pubGame),
      writePrivateData(roomCode, 'host', hostPrivate),
      writePrivateData(roomCode, 'guest', guestPrivate),
    ]);
  }, [roomCode]);

  // ── Action handlers ─────────────────────────────────────────────────────
  const handleRoll = useCallback(async (teamKey, idx) => {
    const updated = doRoll(JSON.parse(JSON.stringify(localGame)), teamKey, idx);
    await syncToFirebase(updated);
  }, [localGame, syncToFirebase]);

  const handleEndSection = useCallback(async () => {
    const clone = JSON.parse(JSON.stringify(localGame));
    const votes = clone.endSectionVotes || { A: false, B: false };
    votes[myTeamKey] = true;

    // Check if both teams have voted
    const otherKey = myTeamKey === 'A' ? 'B' : 'A';
    if (votes[otherKey]) {
      // Both voted — actually end the section
      clone.endSectionVotes = { A: false, B: false };
      const updated = endSection(clone);
      await syncBothToFirebase(updated);
    } else {
      // Only my vote — save it and wait for opponent
      clone.endSectionVotes = votes;
      clone.log = [...clone.log, { team: myTeamKey, msg: `${myTeamKey === 'A' ? localGame.teamA.name : localGame.teamB.name} voted to end section.` }];
      await syncToFirebase(clone);
    }
  }, [localGame, myTeamKey, syncToFirebase, syncBothToFirebase]);

  const handleExecCard = useCallback(async (teamKey, cardId, opts) => {
    console.log('[PvP] execCard:', { teamKey, cardId, opts });
    const clone = JSON.parse(JSON.stringify(localGame));
    console.log('[PvP] localGame phase:', clone.phase, 'matchupTurn:', clone.matchupTurn);
    const result = execCard(clone, teamKey, cardId, opts);
    console.log('[PvP] execCard result:', { ok: result.ok, msg: result.msg });
    if (!result.ok) { toast(result.msg, { tone: 'error' }); return; }
    try {
      await syncToFirebase(result.game);
      console.log('[PvP] syncToFirebase succeeded');
    } catch (err) {
      console.error('[PvP] syncToFirebase FAILED:', err);
    }
  }, [localGame, syncToFirebase]);

  const handleResolve = useCallback(async () => {
    const updated = resolvePendingShotCheck(JSON.parse(JSON.stringify(localGame)));
    await syncToFirebase(updated);
  }, [localGame, syncToFirebase]);

  const handleSpendAssist = useCallback(async (teamKey, spendType, playerIdx) => {
    const result = spendAssist(JSON.parse(JSON.stringify(localGame)), teamKey, spendType, playerIdx);
    if (!result.ok) { toast(result.msg, { tone: 'error' }); return; }
    await syncToFirebase(result.game);
  }, [localGame, syncToFirebase]);

  const handleSpendRebound = useCallback(async (teamKey, rebType, playerIdx) => {
    const result = spendReboundBonus(JSON.parse(JSON.stringify(localGame)), teamKey, rebType, playerIdx);
    if (!result.ok) { toast(result.msg, { tone: 'error' }); return; }
    await syncToFirebase(result.game);
  }, [localGame, syncToFirebase]);

  const handleSetGame = useCallback(async (updatedGame) => {
    updatedGame.hostIs = publicGame.hostIs;
    await syncToFirebase(updatedGame);
  }, [publicGame, syncToFirebase]);

  // ── PvP Blind Pick: submit my 5 picks, wait for opponent ────────────────
  // KEY FIX: We NEVER write to private data during draft. Private data (hand,
  // deck) was set at game init and must stay untouched. Draft picks go to a
  // separate Firebase path (rooms/${code}/draftPicks/${role}).
  const handleDraftSubmit = useCallback(async (selectedPlayerIds) => {
    console.log('[DRAFT] handleDraftSubmit called', { selectedPlayerIds, myTeamKey, myRole });
    const clone = JSON.parse(JSON.stringify(localGame));
    clone.hostIs = publicGame.hostIs;

    // Mark me as ready in public state
    if (myTeamKey === 'A') clone.draft.aReady = true;
    else clone.draft.bReady = true;

    // Check if opponent already submitted
    const oppReady = myTeamKey === 'A' ? clone.draft.bReady : clone.draft.aReady;
    console.log('[DRAFT] ready state', { myReady: true, oppReady, aReady: clone.draft.aReady, bReady: clone.draft.bReady });

    if (oppReady) {
      // ── RESOLVER: Both ready — resolve starters from picks + pools ────
      const oppRole = myRole === 'host' ? 'guest' : 'host';

      // Read opponent's draft picks (separate path) and pool (from private data)
      const [oppPicksSnap, oppPrivSnap] = await Promise.all([
        get(ref(rtdb, `rooms/${roomCode}/draftPicks/${oppRole}`)),
        get(ref(rtdb, `rooms/${roomCode}/private/${oppRole}`)),
      ]);

      const oppPicks = fixFromFirebase(oppPicksSnap.val()) || [];
      const oppPrivate = fixFromFirebase(oppPrivSnap.val());
      const oppPool = oppPrivate?.draftPool || [];

      // My pool is already in localGame (injected from my privateData)
      const myPool = myTeamKey === 'A' ? clone.draft.aPool : clone.draft.bPool;

      console.log('[DRAFT] Resolver:', { myPool: myPool?.length, oppPool: oppPool?.length, oppPicks: oppPicks?.length });

      // Starters start EMPTY — players are placed one at a time via snake order.
      clone.teamA.starters = [];
      clone.teamB.starters = [];

      // Reduce pools to the 5 that each coach did NOT pick (= bench candidates).
      // These are revealed once placement completes (step === 10).
      const myUnpicked = myPool.filter(p => !selectedPlayerIds.includes(p.id));
      const oppUnpicked = oppPool.filter(p => !oppPicks.includes(p.id));
      if (myTeamKey === 'A') {
        clone.draft.aPool = myUnpicked;
        clone.draft.bPool = oppUnpicked;
      } else {
        clone.draft.bPool = myUnpicked;
        clone.draft.aPool = oppUnpicked;
      }

      // Store the ORDERED pick lists for each side so the placement handler
      // knows whose picks are whose.
      clone.draft.aPicks = myTeamKey === 'A' ? selectedPlayerIds : oppPicks;
      clone.draft.bPicks = myTeamKey === 'A' ? oppPicks : selectedPlayerIds;

      clone.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
      clone.phase = 'matchup_strats';
      clone.placementStep = 0;
      clone.placementOrder = ['A','B','B','A','A','B','B','A','A','B'];
      clone.bench = null;
      clone.matchupTurn = 'A';
      clone.matchupPasses = 0;
      clone.log = [...clone.log, { team: null, msg: 'Lineups locked — begin placement.' }];

      // Write ONLY the public game state. Private data is NEVER touched.
      const pubGame = stripPrivateData(clone);
      await writeGameState(roomCode, pubGame);
    } else {
      // ── FIRST SUBMITTER: store picks in a separate path, update game state ──
      console.log('[DRAFT] First to submit — storing picks at draftPicks/' + myRole);

      const pubGame = stripPrivateData(clone);
      pubGame.log = [...pubGame.log, { team: myTeamKey, msg: `${myTeamKey === 'A' ? clone.teamA.name : clone.teamB.name} locked in their lineup.` }];

      // Store picks separately — do NOT touch private data (hand/deck)
      await Promise.all([
        writeGameState(roomCode, pubGame),
        set(ref(rtdb, `rooms/${roomCode}/draftPicks/${myRole}`), prepareForFirebase(selectedPlayerIds)),
      ]);
    }
  }, [localGame, publicGame, myTeamKey, myRole, roomCode]);

  // ── Undo my last placement (placement.js), until the opponent answers ──
  // The snapshot is my game from just before the pick. Undoing is often out
  // of turn (the opponent is up next), so it is written only if the room
  // still holds exactly the game it was judged against; a pick or a card
  // they got in first wins, and I am told.
  const [placeUndo, setPlaceUndo] = useState(null);
  const canUndoPlace = canUndoPlacement(localGame, placeUndo, { pvp: true });
  const handleUndoPlace = useCallback(async () => {
    if (!canUndoPlacement(localGame, placeUndo, { pvp: true })) return;
    const seen = { step: localGame.placementStep ?? 10, logLen: (localGame.log ?? []).length };
    const undone = stripPrivateData(undoPlacement(localGame, placeUndo));
    setPlaceUndo(null);
    const ok = await writeGameStateIf(roomCode, undone,
      cur => (cur?.placementStep ?? 10) === seen.step && (cur?.log ?? []).length === seen.logLen);
    if (!ok) toast('Too late to undo: your opponent has already moved.', { tone: 'error' });
  }, [localGame, placeUndo, roomCode, toast]);

  // ── PvP Snake Placement: place one of my picks into the next open slot ─
  const handlePlacePlayer = useCallback(async (playerId) => {
    const step = publicGame.placementStep ?? 10;
    if (step >= 10) return;
    const order = publicGame.placementOrder || ['A','B','B','A','A','B','B','A','A','B'];
    const activeTeam = order[step];
    if (activeTeam !== myTeamKey) {
      console.warn('[PLACE] Not your turn to place');
      return;
    }

    // Look up the full player object from my privateData.draftPool
    const player = (privateData?.draftPool || []).find(p => p.id === playerId);
    if (!player) {
      console.error('[PLACE] Player not found in draftPool:', playerId);
      return;
    }

    const clone = JSON.parse(JSON.stringify(localGame));
    const team = activeTeam === 'A' ? clone.teamA : clone.teamB;
    // Guard against double-placement
    if (team.starters.find(p => p.id === playerId)) {
      console.warn('[PLACE] Player already placed:', playerId);
      return;
    }
    team.starters.push(player);
    clone.placementStep = step + 1;
    clone.log = [...clone.log, { team: activeTeam, msg: `${player.name} takes the floor.` }];

    // If placement just completed, compute bench and reset pass counters
    if (clone.placementStep === 10) {
      // Bench = full 10-player pool minus the 5 placed starters, per team.
      // We need each coach's full pool. My own is in privateData.draftPool.
      // Opponent's is at rooms/{code}/private/{oppRole}.draftPool.
      const oppRole = myRole === 'host' ? 'guest' : 'host';
      const oppSnap = await get(ref(rtdb, `rooms/${roomCode}/private/${oppRole}`));
      const oppPrivate = fixFromFirebase(oppSnap.val());
      const oppPool = oppPrivate?.draftPool || [];

      const myPool = privateData?.draftPool || [];
      const myTeamBench = myPool.filter(p => !clone[myTeamKey === 'A' ? 'teamA' : 'teamB'].starters.find(s => s.id === p.id));
      const oppTeamKey = myTeamKey === 'A' ? 'B' : 'A';
      const oppTeamBench = oppPool.filter(p => !clone[oppTeamKey === 'A' ? 'teamA' : 'teamB'].starters.find(s => s.id === p.id));

      clone.bench = {
        [myTeamKey]: myTeamBench,
        [oppTeamKey]: oppTeamBench,
      };
      clone.matchupTurn = 'A';
      clone.matchupPasses = 0;

      // Clear hot/cold for benched players (moved here from draft resolver)
      ['A', 'B'].forEach(k => {
        const t = k === 'A' ? clone.teamA : clone.teamB;
        t.stats.forEach(ps => {
          if (!t.starters.find(p => p.id === ps.id)) {
            ps.hot = 0; ps.cold = 0;
            const m = ps.minutes || 0;
            ps.minutes = m <= 8 ? 0 : Math.max(0, m - 8);
          }
        });
      });

      clone.log = [...clone.log, { team: null, msg: 'All ten on the floor — matchup strategy continues.' }];
    }

    const pubGame = stripPrivateData(clone);
    await writeGameState(roomCode, pubGame);
    setPlaceUndo(placementSnapshot(localGame));   // the game before this pick
  }, [localGame, publicGame, privateData, myTeamKey, myRole, roomCode]);

  // ── End-game actions ────────────────────────────────────────────────────
  const handleForfeit = useCallback(async () => {
    const yes = await ask({
      title: 'Forfeit this game?',
      body: 'Your opponent is declared the winner straight away.',
      confirmLabel: 'Forfeit',
      tone: 'danger',
    });
    if (!yes) return;
    await forfeitGame(roomCode, myRole);
  }, [roomCode, myRole, ask]);

  const handleAbandon = useCallback(async () => {
    const yes = await ask({
      title: 'Abandon this game?',
      body: 'It is marked abandoned for both players — nobody wins it.',
      confirmLabel: 'Abandon',
      tone: 'danger',
    });
    if (!yes) return;
    await abandonGame(roomCode);
  }, [roomCode, ask]);

  // ── Terminal states ─────────────────────────────────────────────────────
  useEffect(() => {
    const tag = meta?.league;
    if (!tag || leagueReported.current) return;
    const over = Boolean(localGame?.done) || (meta?.status === 'forfeit' && Boolean(meta?.winner));
    if (!over) return;
    leagueReported.current = true;
    reportLeagueResult(null, { leagueId: tag.id, fixtureId: tag.fixtureId, roomCode }).catch(e => {
      // "already has a result" is the other player getting there first.
      if (!/already/i.test(e?.message ?? '')) console.warn('league result:', e?.message ?? e);
    });
  }, [meta?.league, meta?.status, meta?.winner, localGame?.done, roomCode]);

  if (meta?.status === 'forfeit') {
    const iWon = meta.winner === myRole;
    return (
      <div className={styles.gameOverWrap}>
        <h2>{iWon ? 'You Win!' : 'You Lose'}</h2>
        <p>{iWon ? 'Your opponent forfeited.' : 'You forfeited the game.'}</p>
        <button className={styles.leaveBtn} onClick={onLeave}>Back to Lobby</button>
      </div>
    );
  }

  if (meta?.status === 'abandoned') {
    return (
      <div className={styles.gameOverWrap}>
        <h2>Game Abandoned</h2>
        <p>This game has been abandoned.</p>
        <button className={styles.leaveBtn} onClick={onLeave}>Back to Lobby</button>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────
  if (!localGame) {
    return (
      <div className={styles.loading}>
        <p>Loading game...</p>
        {initError && (
          <p style={{ color: '#ff6b6b', marginTop: '1rem' }}>
            Error: {initError}
          </p>
        )}
        <p style={{ color: '#888', fontSize: '0.85rem', marginTop: '0.5rem' }}>
          Role: {myRole} | Meta: {meta?.status || 'null'} | Game: {publicGame ? 'yes' : 'no'} | Private: {privateData ? 'yes' : 'no'}
        </p>
      </div>
    );
  }

  // ── Natural game over ───────────────────────────────────────────────────
  if (localGame.done) {
    return (
      <div className={styles.gameOverWrap}>
        <GameOver game={localGame} onPlayAgain={onLeave} isPvp myTeamKey={myTeamKey} />
      </div>
    );
  }

  // ── Active game ─────────────────────────────────────────────────────────
  return (
    <div className={styles.wrap}>
      {/* PvP header bar */}
      <div className={styles.pvpBar}>
        <div className={styles.opponent}>vs. {opponentName}</div>
        <div className={styles.pvpActions}>
          <button className={styles.forfeitBtn} onClick={handleForfeit}>Forfeit</button>
          <button className={styles.abandonBtn} onClick={handleAbandon}>Abandon</button>
        </div>
      </div>

      <div className={styles.layout}>
        <Scoreboard game={localGame} pvpMode={true} myTeamKey={myTeamKey} isMyTurn={isMyTurn} />
        <GameLog log={localGame.log} />
        <div className={styles.analyticsSlot}><AnalyticsPanel analytics={localGame.analytics} /></div>

        {/* Pending shot check / reaction banner — below game log for visibility */}
        {localGame.pendingShotCheck && (() => {
          const psc = localGame.pendingShotCheck;
          const offP = getTeam(localGame, psc.teamKey)?.starters?.[psc.playerIdx];
          const defKey = psc.teamKey === 'A' ? 'B' : 'A';
          const defHand = getTeam(localGame, defKey)?.hand || [];
          const hasCloseOut = defHand.includes('close_out');
          const coPlay = hasCloseOut ? canPlayCard(localGame, defKey, 'close_out') : null;
          const canICO = hasCloseOut && coPlay?.canPlay && defKey === myTeamKey;
          const canIResolve = psc.teamKey === myTeamKey || (psc.closeOutBonus != null);
          return (
            <div className={styles.pendingBanner}>
              <div className={styles.pendingInfo}>
                <span className={styles.pendingTitle}>⏸ {offP?.name} — {psc.cardLabel} at +{psc.bonus}</span>
                {psc.closeOutBonus != null && <span className={styles.pendingCO}>Close Out applied: net {psc.bonus + psc.closeOutBonus}</span>}
                {canICO && <span className={styles.pendingAvail}>⚡ You can play Close Out!</span>}
              </div>
              <div className={styles.pendingActions}>
                {canICO && <button className={styles.coBtn} onClick={() => handleExecCard(defKey, 'close_out', {})}>Close Out −3</button>}
                {canIResolve && <button className={styles.resolveBtn} onClick={handleResolve}>▶ Resolve</button>}
              </div>
            </div>
          );
        })()}

        <CourtBoard
          game={localGame}
          setGame={handleSetGame}
          onRoll={handleRoll}
          onEndSection={handleEndSection}
          onExecCard={handleExecCard}
          onResolve={handleResolve}
          onSpendAssist={handleSpendAssist}
          onSpendRebound={handleSpendRebound}
          onDraftSubmit={handleDraftSubmit}
          onPlacePlayer={handlePlacePlayer}
          onUndoPlace={canUndoPlace ? handleUndoPlace : null}
          undoPlaceName={canUndoPlace ? takenBackName(localGame, placeUndo) : null}
          pvpMode={true}
          myTeamKey={myTeamKey}
          isMyTurn={isMyTurn}
        />
      </div>
    </div>
  );
}
