// A HUMAN-VS-HUMAN FIXTURE'S SEAT AT THE TABLE.
//
// Two people in one fixture need a PvP room. The HOME side opens it (the room
// is tagged with the league and the fixture, and attached to the league so
// the other side can find the code); the AWAY side joins it. Both are seated
// with the team they entered — no picking, the roster is the league's — and
// when both are ready either of them can enter the game. PvpGame reports the
// result to the league when it ends; the server reads this room to verify it.
//
// Nothing here decides a rule. Who hosts is roomHostFor (home), who plays
// what is the entrant record, and whether the result counts is the server's.
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../firebase/AuthProvider.jsx';
import { useDialogs } from '../../ui/dialogs.jsx';
import { createRoom, joinRoom, onRoomMeta, setTeamSelection } from '../../firebase/pvpRoom.js';
import { attachLeagueRoom } from '../../firebase/serverWrites.js';
import { humanFor, roomHostFor, teamIdFor } from '../../firebase/leagues.js';
import styles from '../SeasonTab.module.css';
import lg from './League.module.css';

export default function LeagueMatch({ league, fixture, uid, onOpenRoom, compact = false }) {
  const { user } = useAuth();
  const { toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState(null);

  const room = league.rooms?.[fixture.id] ?? null;
  const hostUid = roomHostFor(league, fixture);
  const me = humanFor(league, teamIdFor(uid));
  const home = humanFor(league, fixture.home);
  const away = humanFor(league, fixture.away);
  const iHost = hostUid === uid;

  useEffect(() => {
    if (!room?.code) { setMeta(null); return undefined; }
    return onRoomMeta(room.code, setMeta);
  }, [room?.code]);

  const myRole = useMemo(() => {
    if (meta) return meta.hostUid === uid ? 'host' : 'guest';
    return iHost ? 'host' : 'guest';
  }, [meta, uid, iHost]);
  const seated = myRole === 'host' ? Boolean(meta?.hostReady) : Boolean(meta?.guestReady);
  const bothReady = Boolean(meta?.hostReady && meta?.guestReady);
  const joined = Boolean(meta?.guestUid);

  const run = async fn => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(e?.message ?? 'That did not go through', { tone: 'error' }); } finally { setBusy(false); }
  };

  /** My seat: the team I entered with, as the room stores a team. */
  const seat = (code, role) => setTeamSelection(code, role, me.roster, me.deck ?? null, me.name);

  const open = () => run(async () => {
    const code = await createRoom(uid, user?.displayName, { league: { id: league.id, fixtureId: fixture.id } });
    await attachLeagueRoom(uid, { leagueId: league.id, fixtureId: fixture.id, code });
    await seat(code, 'host');
  });

  const join = () => run(async () => {
    if (!meta?.guestUid) await joinRoom(room.code, uid, user?.displayName);
    await seat(room.code, 'guest');
  });

  const takeSeat = () => run(() => seat(room.code, myRole));
  const enter = () => onOpenRoom?.(room.code, myRole);

  const oppName = (iHost ? away : home)?.name ?? 'the other coach';
  let line;
  let action = null;
  if (!room) {
    line = iHost ? `You are the home side — open the room and ${oppName} joins it.` : `${home?.name ?? 'The home side'} opens the room; you join it from here.`;
    if (iHost) action = <button className={styles.primary} disabled={busy} onClick={open}>{busy ? 'Opening…' : 'Open the room'}</button>;
  } else if (!meta) {
    line = `Room ${room.code} — reading it…`;
  } else if (meta.status === 'abandoned') {
    line = `Room ${room.code} was abandoned. ${iHost ? 'Open a new one.' : `${home?.name ?? 'The home side'} can open a new one.`}`;
    if (iHost) action = <button className={styles.primary} disabled={busy} onClick={open}>{busy ? 'Opening…' : 'Open a new room'}</button>;
  } else if (meta.status === 'forfeit' || meta.game === undefined && meta.status === 'done') {
    line = `Room ${room.code} has ended.`;
  } else if (meta.status === 'waiting') {
    line = iHost ? `Room ${room.code} is open — waiting for ${oppName} to join.` : `Room ${room.code} is open.`;
    if (!iHost) action = <button className={styles.primary} disabled={busy} onClick={join}>{busy ? 'Joining…' : 'Join the room'}</button>;
  } else if (meta.status === 'team_select') {
    if (!seated) {
      line = `Room ${room.code} — take your seat with ${me?.name ?? 'your team'}.`;
      action = <button className={styles.primary} disabled={busy} onClick={takeSeat}>{busy ? 'Seating…' : 'Take your seat'}</button>;
    } else if (!bothReady) {
      line = `Seated. Waiting for ${oppName} to take their seat.`;
    } else {
      line = iHost ? 'Both seated — the room deals the game when you enter.' : 'Both seated — enter the game.';
      action = <button className={styles.primary} onClick={enter}>▶ Enter the game</button>;
    }
  } else if (meta.status === 'active') {
    line = 'The game is on.';
    action = <button className={styles.primary} onClick={enter}>▶ {joined ? 'Back to the game' : 'Enter the game'}</button>;
  } else {
    line = `Room ${room.code} · ${meta.status}`;
  }

  return (
    <div className={compact ? lg.matchCompact : lg.match}>
      <div className={styles.hint}>{line}</div>
      {action && <div className={styles.myGameActions}>{action}</div>}
    </div>
  );
}
