import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { createRoom, joinRoom, onRoomMeta, setTeamSelection, loadMyGames, removeFromMyGames } from '../firebase/pvpRoom.js';
import { loadTeams } from '../firebase/savedTeams.js';
import { loadDecks } from '../firebase/savedDecks.js';
import s from './PvpLobby.module.css';

// -------- helpers --------

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function statusBadge(status) {
  switch (status) {
    case 'active':      return { label: 'Active',      cls: s.badgeActive };
    case 'waiting':     return { label: 'Waiting',     cls: s.badgeWaiting };
    case 'team_select': return { label: 'Team Select', cls: s.badgeSelect };
    default:            return { label: status,         cls: s.badgeEnded };
  }
}

// ================================================================
// Component
// ================================================================

export default function PvpLobby({ onGameStart }) {
  const { user } = useAuth();

  // view: 'landing' | 'waiting' | 'team_select'
  const [view, setView] = useState('landing');
  const [roomCode, setRoomCode] = useState('');
  const [myRole, setMyRole] = useState(null);       // 'host' | 'guest'
  const [meta, setMeta] = useState(null);

  // landing
  const [joinCode, setJoinCode] = useState('');
  const [myGames, setMyGames] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(false);

  // team select
  const [teams, setTeams] = useState([]);
  const [decks, setDecks] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedDeckId, setSelectedDeckId] = useState('');
  const [isReady, setIsReady] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // -------- load active games on mount --------
  const refreshGames = useCallback(async () => {
    if (!user) return;
    setGamesLoading(true);
    try {
      const games = await loadMyGames(user.uid);
      setMyGames(games);
    } catch (e) {
      console.warn('Failed to load games:', e.message);
    }
    setGamesLoading(false);
  }, [user]);

  useEffect(() => { refreshGames(); }, [refreshGames]);

  // -------- room meta listener --------
  useEffect(() => {
    if (!roomCode) return;
    const unsub = onRoomMeta(roomCode, (m) => {
      setMeta(m);
      // auto-advance from waiting to team_select
      if (view === 'waiting' && m?.status === 'team_select') {
        setView('team_select');
      }
      // both ready → start game
      if (view === 'team_select' && m?.hostReady && m?.guestReady) {
        onGameStart(roomCode, myRole);
      }
    });
    return unsub;
  }, [roomCode, view, myRole, onGameStart]);

  // -------- load teams & decks when entering team_select --------
  useEffect(() => {
    if (view !== 'team_select' || !user) return;
    (async () => {
      try {
        const [t, d] = await Promise.all([loadTeams(user.uid), loadDecks(user.uid)]);
        setTeams(t);
        setDecks(d);
      } catch (e) {
        setError('Failed to load teams/decks.');
      }
    })();
  }, [view, user]);

  // -------- actions --------

  async function handleCreate() {
    setError('');
    setLoading(true);
    try {
      const code = await createRoom(user.uid, user.displayName);
      setRoomCode(code);
      setMyRole('host');
      setView('waiting');
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  async function handleJoin() {
    const code = joinCode.trim().toUpperCase();
    if (!code) { setError('Enter a room code.'); return; }
    setError('');
    setLoading(true);
    try {
      await joinRoom(code, user.uid, user.displayName);
      setRoomCode(code);
      setMyRole('guest');
      setView('team_select');
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  async function handleReady() {
    if (!selectedTeamId) return;
    setError('');
    setLoading(true);
    try {
      const team = teams.find((t) => t.id === selectedTeamId);
      const deck = selectedDeckId ? decks.find((d) => d.id === selectedDeckId) : null;

      await setTeamSelection(
        roomCode,
        myRole,
        team.players,
        deck ? deck.cards : null,
        team.name,
      );
      setIsReady(true);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  async function handleLeaveGame(code) {
    try {
      await removeFromMyGames(user.uid, code);
      setMyGames((prev) => prev.filter((g) => g.code !== code));
    } catch (e) {
      setError(e.message);
    }
  }

  function handleCancel() {
    setRoomCode('');
    setMyRole(null);
    setMeta(null);
    setView('landing');
    setError('');
    setIsReady(false);
    setSelectedTeamId('');
    setSelectedDeckId('');
    refreshGames();
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(roomCode); } catch {}
  }

  // ================================================================
  // Landing View
  // ================================================================
  if (view === 'landing') {
    return (
      <div className={s.lobby}>
        <div className={s.landing}>
          <h2>PvP Lobby</h2>
          <p>Challenge a friend to a head-to-head showdown</p>

          <button className={s.btnGold} onClick={handleCreate} disabled={loading}>
            {loading ? 'Creating...' : 'Create Room'}
          </button>

          <div className={s.divider}><span>or join a room</span></div>

          <div className={s.joinRow}>
            <input
              className={s.codeInput}
              placeholder="Room code"
              maxLength={6}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
            <button className={s.btnSec} onClick={handleJoin} disabled={loading}>
              Join
            </button>
          </div>

          {error && <div className={s.error}>{error}</div>}

          {/* Active Games */}
          <div className={s.gamesSection}>
            <h3>Active Games</h3>
            {gamesLoading && <p className={s.noGames}>Loading...</p>}
            {!gamesLoading && myGames.length === 0 && (
              <p className={s.noGames}>No active games</p>
            )}
            {myGames.length > 0 && (
              <div className={s.gamesList}>
                {myGames.map((g) => {
                  const badge = statusBadge(g.meta.status);
                  const opponentName =
                    g.role === 'host'
                      ? g.meta.guestName || 'Waiting...'
                      : g.meta.hostName || '???';
                  const canResume = ['active', 'team_select'].includes(g.meta.status);
                  const canLeave = ['waiting', 'abandoned', 'forfeit'].includes(g.meta.status);

                  return (
                    <div key={g.code} className={s.gameRow}>
                      <span className={s.gameCode}>{g.code}</span>
                      <span className={s.gameOpponent}>vs {opponentName}</span>
                      <span className={`${s.badge} ${badge.cls}`}>{badge.label}</span>
                      <span className={s.gameTime}>{relativeTime(g.meta.lastActionAt)}</span>
                      {canResume && (
                        <button
                          className={`${s.btnSmall} ${s.btnResume}`}
                          onClick={() => onGameStart(g.code, g.role)}
                        >
                          Resume
                        </button>
                      )}
                      {canLeave && (
                        <button
                          className={`${s.btnSmall} ${s.btnLeave}`}
                          onClick={() => handleLeaveGame(g.code)}
                        >
                          Leave
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ================================================================
  // Waiting Room
  // ================================================================
  if (view === 'waiting') {
    return (
      <div className={s.lobby}>
        <div className={s.waitingRoom}>
          <div className={s.roomCodeLabel}>Room Code</div>
          <div className={s.roomCodeDisplay}>
            <span className={s.roomCode}>{roomCode}</span>
            <button className={s.btnCopy} onClick={copyCode} title="Copy code">
              Copy
            </button>
          </div>
          <p className={s.shareHint}>Share this code with your opponent</p>
          <p className={s.waitingPulse}>Waiting for opponent to join...</p>
          <button className={s.btnSec} onClick={handleCancel}>Cancel</button>
          {error && <div className={s.error}>{error}</div>}
        </div>
      </div>
    );
  }

  // ================================================================
  // Team Select
  // ================================================================
  if (view === 'team_select') {
    const opponentReady =
      myRole === 'host' ? meta?.guestReady : meta?.hostReady;
    const roleLabel =
      myRole === 'host' ? 'You are the Home team' : 'You are the Away team';

    return (
      <div className={s.lobby}>
        <div className={s.teamSelect}>
          <h2>Team Select</h2>
          <div className={s.roleTag}>{roleLabel}</div>

          {/* Team picker */}
          <div className={s.selectGroup}>
            <label className={s.selectLabel}>Select Your Team</label>
            <select
              className={s.selectField}
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              disabled={isReady}
            >
              <option value="">-- choose a team --</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (${t.salary})
                </option>
              ))}
            </select>
          </div>

          {/* Deck picker */}
          <div className={s.selectGroup}>
            <label className={s.selectLabel}>Select Your Deck</label>
            <select
              className={s.selectField}
              value={selectedDeckId}
              onChange={(e) => setSelectedDeckId(e.target.value)}
              disabled={isReady}
            >
              <option value="">Default Deck</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.totalCards} cards)
                </option>
              ))}
            </select>
          </div>

          {/* Opponent status */}
          <div className={s.opponentStatus}>
            {opponentReady ? (
              <span className={s.oppReady}>Opponent: Ready &#10003;</span>
            ) : (
              <span className={s.oppWaiting}>Opponent: Selecting...</span>
            )}
          </div>

          {/* Ready button */}
          <button
            className={s.btnGold}
            onClick={handleReady}
            disabled={!selectedTeamId || isReady || loading}
          >
            {isReady ? 'Waiting for opponent...' : loading ? 'Submitting...' : 'Ready'}
          </button>

          {error && <div className={s.error}>{error}</div>}

          <div style={{ marginTop: '1rem', textAlign: 'center' }}>
            <button className={s.btnSec} onClick={handleCancel} disabled={isReady}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
