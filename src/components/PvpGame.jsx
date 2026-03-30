import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import {
  onGameState, onPrivateData, onRoomMeta,
  writeGameState, writePrivateData, forfeitGame, abandonGame,
} from '../firebase/pvpRoom.js';
import {
  initializePvpGame, getWhoseTurn, extractPrivateData, stripPrivateData,
} from '../firebase/pvpGame.js';
import { doRoll, endSection, spendAssist, spendReboundBonus } from '../game/engine.js';
import { execCard, resolvePendingShotCheck } from '../game/execCard.js';
import CourtBoard from './game/CourtBoard.jsx';
import GameOver from './game/GameOver.jsx';
import GameLog from './game/GameLog.jsx';
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
      onRoomMeta(roomCode, setMeta),
      onGameState(roomCode, setPublicGame),
      onPrivateData(roomCode, user.uid, setPrivateData),
    ];
    return () => unsubs.forEach(fn => fn());
  }, [roomCode, user.uid]);

  // ── Game initialization (host only) ─────────────────────────────────────
  useEffect(() => {
    if (
      meta?.hostReady && meta?.guestReady &&
      meta?.status === 'team_select' && myRole === 'host'
    ) {
      initializePvpGame(roomCode, meta.hostUid, meta.guestUid);
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
    const team = myTeamKey === 'A' ? g.teamA : g.teamB;

    // Inject my private data
    team.hand = privateData.hand || [];

    if (g.phase === 'draft' && g.draft) {
      if (myTeamKey === 'A') g.draft.aPool = privateData.draftPool || [];
      else                    g.draft.bPool = privateData.draftPool || [];
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
      writePrivateData(roomCode, user.uid, myPrivate),
    ]);
  }, [roomCode, myRole, user.uid]);

  // ── Action handlers ─────────────────────────────────────────────────────
  const handleRoll = useCallback(async (teamKey, idx) => {
    const updated = doRoll(JSON.parse(JSON.stringify(localGame)), teamKey, idx);
    await syncToFirebase(updated);
  }, [localGame, syncToFirebase]);

  const handleEndSection = useCallback(async () => {
    const updated = endSection(JSON.parse(JSON.stringify(localGame)));
    await syncToFirebase(updated);
  }, [localGame, syncToFirebase]);

  const handleExecCard = useCallback(async (teamKey, cardId, opts) => {
    const result = execCard(JSON.parse(JSON.stringify(localGame)), teamKey, cardId, opts);
    if (!result.ok) { alert(result.msg); return; }
    await syncToFirebase(result.game);
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
        <div className={`${styles.turnIndicator} ${isMyTurn ? styles.myTurn : styles.theirTurn}`}>
          {isMyTurn ? '\u{1F7E2} Your Turn' : "\u{1F534} Opponent's Turn"}
        </div>
        <div className={styles.pvpActions}>
          <button className={styles.forfeitBtn} onClick={handleForfeit}>Forfeit</button>
          <button className={styles.abandonBtn} onClick={handleAbandon}>Abandon</button>
        </div>
      </div>

      <div className={styles.layout}>
        <Scoreboard game={localGame} />
        <GameLog log={localGame.log} />
        <CourtBoard
          game={localGame}
          setGame={handleSetGame}
          onRoll={handleRoll}
          onEndSection={handleEndSection}
          onExecCard={handleExecCard}
          onResolve={handleResolve}
          onSpendAssist={handleSpendAssist}
          onSpendRebound={handleSpendRebound}
          pvpMode={true}
          myTeamKey={myTeamKey}
          isMyTurn={isMyTurn}
        />
      </div>
    </div>
  );
}
