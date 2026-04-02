import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import {
  onGameState, onPrivateData, onRoomMeta,
  writeGameState, writePrivateData, forfeitGame, abandonGame,
} from '../firebase/pvpRoom.js';
import {
  initializePvpGame, getWhoseTurn, extractPrivateData, stripPrivateData,
  fixFromFirebase,
} from '../firebase/pvpGame.js';
import { ref, get } from 'firebase/database';
import { rtdb } from '../firebase/config.js';
import { doRoll, endSection, spendAssist, spendReboundBonus, getTeam, emptyAnalytics } from '../game/engine.js';
import { execCard, resolvePendingShotCheck } from '../game/execCard.js';
import { canPlayCard } from '../game/canPlay.js';
import CourtBoard from './game/CourtBoard.jsx';
import GameOver from './game/GameOver.jsx';
import GameLog from './game/GameLog.jsx';
import AnalyticsPanel from './game/AnalyticsPanel.jsx';
import Scoreboard from './game/Scoreboard.jsx';
import styles from './PvpGame.module.css';

export default function PvpGame({ roomCode, myRole, onLeave }) {
  const { user } = useAuth();

  const [meta, setMeta]             = useState(null);
  const [publicGame, setPublicGame] = useState(null);
  const [privateData, setPrivateData] = useState(null);

  // ── RTDB listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    const unsubs = [
      onRoomMeta(roomCode, (m) => { console.log('[PvP] meta:', m?.status); setMeta(m); }),
      onGameState(roomCode, (g) => { console.log('[PvP] game state:', g ? 'received' : 'null'); setPublicGame(g); }),
      onPrivateData(roomCode, myRole, (p) => { console.log('[PvP] private data:', p ? 'received' : 'null'); setPrivateData(p); }),
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
    team.hand = privateData.hand || [];
    if (Array.isArray(privateData.deck)) team.deck = privateData.deck;

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
    if (!result.ok) { alert(result.msg); return; }
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
    if (!result.ok) { alert(result.msg); return; }
    await syncToFirebase(result.game);
  }, [localGame, syncToFirebase]);

  const handleSpendRebound = useCallback(async (teamKey, rebType, playerIdx) => {
    const result = spendReboundBonus(JSON.parse(JSON.stringify(localGame)), teamKey, rebType, playerIdx);
    if (!result.ok) { alert(result.msg); return; }
    await syncToFirebase(result.game);
  }, [localGame, syncToFirebase]);

  const handleSetGame = useCallback(async (updatedGame) => {
    updatedGame.hostIs = publicGame.hostIs;
    await syncToFirebase(updatedGame);
  }, [publicGame, syncToFirebase]);

  // ── PvP Blind Pick: submit my 5 picks privately, wait for opponent ─────
  const handleDraftSubmit = useCallback(async (selectedPlayerIds) => {
    const clone = JSON.parse(JSON.stringify(localGame));
    clone.hostIs = publicGame.hostIs;

    // Store my picks in private data
    const myTeam = myTeamKey === 'A' ? clone.teamA : clone.teamB;
    myTeam._draftPicks = selectedPlayerIds;

    // Mark me as ready
    if (myTeamKey === 'A') clone.draft.aReady = true;
    else clone.draft.bReady = true;

    // Check if opponent already submitted
    const oppReady = myTeamKey === 'A' ? clone.draft.bReady : clone.draft.aReady;

    if (oppReady) {
      // Both ready — read opponent's private picks and reveal lineups
      const oppRole = myRole === 'host' ? 'guest' : 'host';
      const oppTeamKey = myTeamKey === 'A' ? 'B' : 'A';

      // Read opponent's private data to get their picks
      const oppSnap = await get(ref(rtdb, `rooms/${roomCode}/private/${oppRole}`));
      const oppPrivate = fixFromFirebase(oppSnap.val());
      const oppPicks = oppPrivate?.draftPicks || [];

      // Set my starters
      const myPool = myTeamKey === 'A' ? clone.draft.aPool : clone.draft.bPool;
      const myPicks = selectedPlayerIds.map(id => myPool.find(p => p.id === id)).filter(Boolean);
      if (myTeamKey === 'A') {
        clone.teamA.starters = myPicks;
        clone.draft.aPool = myPool.filter(p => !selectedPlayerIds.includes(p.id));
      } else {
        clone.teamB.starters = myPicks;
        clone.draft.bPool = myPool.filter(p => !selectedPlayerIds.includes(p.id));
      }

      // Set opponent starters
      const oppPool = oppTeamKey === 'A' ? clone.draft.aPool : clone.draft.bPool;
      const oppStarters = oppPicks.map(id => oppPool.find(p => p.id === id)).filter(Boolean);
      if (oppTeamKey === 'A') {
        clone.teamA.starters = oppStarters;
        clone.draft.aPool = oppPool.filter(p => !oppPicks.includes(p.id));
      } else {
        clone.teamB.starters = oppStarters;
        clone.draft.bPool = oppPool.filter(p => !oppPicks.includes(p.id));
      }

      // Clear hot/cold for benched players
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

      // Clean up private draft data
      delete clone.teamA._draftPicks;
      delete clone.teamB._draftPicks;

      clone.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
      clone.phase = 'matchup_strats';
      clone.log = [...clone.log, { team: null, msg: 'Both lineups locked — Matchup Strategy Phase.' }];

      await syncBothToFirebase(clone);
    } else {
      // Only my vote — save and wait
      clone.log = [...clone.log, { team: myTeamKey, msg: `${myTeamKey === 'A' ? clone.teamA.name : clone.teamB.name} locked in their lineup.` }];
      await syncToFirebase(clone);
    }
  }, [localGame, publicGame, myTeamKey, myRole, roomCode, syncToFirebase, syncBothToFirebase]);

  // ── End-game actions ────────────────────────────────────────────────────
  const handleForfeit = useCallback(async () => {
    if (!confirm('Are you sure you want to forfeit? Your opponent will be declared the winner.')) return;
    await forfeitGame(roomCode, myRole);
  }, [roomCode, myRole]);

  const handleAbandon = useCallback(async () => {
    if (!confirm('Abandon this game? It will be marked as abandoned for both players.')) return;
    await abandonGame(roomCode);
  }, [roomCode]);

  // ── Terminal states ─────────────────────────────────────────────────────
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
        <GameOver game={localGame} onPlayAgain={onLeave} />
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
        <AnalyticsPanel analytics={localGame.analytics} />

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
          pvpMode={true}
          myTeamKey={myTeamKey}
          isMyTurn={isMyTurn}
        />
      </div>
    </div>
  );
}
