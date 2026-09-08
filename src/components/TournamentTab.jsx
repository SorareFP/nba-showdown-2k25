// TOURNAMENT MODE — a bracket of people, an entry fee, a pool.
//
// The user (2026-09-07): tournaments are fully PvP with variable sizes and an
// entry fee that forms the prize pool — half to the champion, half split
// across every match win.
//
// ── THIS FILE IS THE SHELL ──────────────────────────────────────────────────
//
// What a tournament IS lives in src/game/modes/league.js (shared with the
// server) and bracket.js; every change to one goes through a callable in
// serverWrites.js, because coins move. This component lists yours, collects
// what a lobby needs (a name, a size, a fee, the team you bring), shows the
// bracket, and seats you in a PvP room for your match — LeagueMatch does the
// seating, PvpGame plays it and reports it.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { useDialogs } from '../ui/dialogs.jsx';
import {
  listMyLeagues, watchLeague, entrantFromTeam, summarizeLeague, openFixtures, humanFor, teamIdFor,
  earningsByUid, LEAGUE_STATUS,
} from '../firebase/leagues.js';
import { createLeague, joinLeague, leaveLeague, cancelLeague, startLeague, forfeitLeagueFixture } from '../firebase/serverWrites.js';
import { TOURNAMENT_SIZES, ENTRY_FEES, tournamentPayouts } from '../game/modes/prizes.js';
import RosterPicker, { Choice, MIN_TO_PLAY } from './league/RosterPicker.jsx';
import LeagueLobby from './league/LeagueLobby.jsx';
import LeagueMatch from './league/LeagueMatch.jsx';
import LeagueBracket, { roundName } from './league/LeagueBracket.jsx';
import PvpGame from './PvpGame.jsx';
import styles from './SeasonTab.module.css';
import lg from './league/League.module.css';

export default function TournamentTab({ teamA = [], collection = {} }) {
  const { user } = useAuth();
  const { toast } = useDialogs();
  const uid = user?.uid ?? null;
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');   // list | new | join | open
  const [openId, setOpenId] = useState(null);
  const [room, setRoom] = useState(null);     // { code, role }

  const refresh = useCallback(async () => {
    if (!uid) { setList([]); setLoading(false); return; }
    setLoading(true);
    try {
      const all = await listMyLeagues(uid);
      setList(all.filter(l => l.kind === 'tournament'));
    } catch (e) {
      toast(e?.message ?? 'Could not load your tournaments', { tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [uid, toast]);
  useEffect(() => { refresh(); }, [refresh]);

  const open = id => { setOpenId(id); setView('open'); };
  const back = () => { setView('list'); setOpenId(null); refresh(); };

  if (!uid) {
    return (
      <div className={styles.wrap}>
        <div className={styles.empty}>Sign in to enter a tournament.</div>
      </div>
    );
  }

  if (room) {
    return (
      <div className={styles.wrap}>
        <PvpGame roomCode={room.code} myRole={room.role} onLeave={() => setRoom(null)} />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {view === 'list' && (
        <TournamentList list={list} loading={loading} uid={uid} onOpen={open} onNew={() => setView('new')} onJoin={() => setView('join')} />
      )}
      {view === 'new' && (
        <NewTournament teamA={teamA} collection={collection} uid={uid} onCancel={back} onCreated={open} />
      )}
      {view === 'join' && (
        <JoinTournament teamA={teamA} collection={collection} uid={uid} onCancel={back} onJoined={open} />
      )}
      {view === 'open' && openId && (
        <Tournament leagueId={openId} uid={uid} onBack={back} onOpenRoom={(code, role) => setRoom({ code, role })} />
      )}
    </div>
  );
}

// ── The list ────────────────────────────────────────────────────────────────

function TournamentList({ list, loading, uid, onOpen, onNew, onJoin }) {
  return (
    <>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Tournament</h2>
          <p className={styles.sub}>
            A single-elimination bracket of real coaches. Everyone pays the entry; half the pool goes to the
            champion and the other half is split across every match won.
          </p>
        </div>
        <div className={styles.headActions}>
          <button className={styles.ghost} onClick={onJoin}>Join with a code</button>
          <button className={styles.primary} onClick={onNew}>+ New tournament</button>
        </div>
      </header>

      {loading ? (
        <div className={styles.muted}>Loading tournaments…</div>
      ) : list.length === 0 ? (
        <div className={styles.empty}>
          No tournaments yet. Start one and send the code to the people you want in, or join one with a code.
        </div>
      ) : (
        <div className={styles.cards}>
          {list.map(l => {
            const s = summarizeLeague(l, uid);
            return (
              <div key={l.id} className={styles.seasonCard}>
                <div className={styles.seasonCardTop}>
                  <span className={styles.badge}>{s.status}</span>
                  <span className={styles.muted}>{s.size} teams · {s.fee ? `${s.fee} in` : 'free'}</span>
                </div>
                <div className={styles.seasonCardLine}>{l.name}</div>
                <div className={styles.muted}>
                  {s.status === LEAGUE_STATUS.done
                    ? (s.isChampion ? '🏆 You won it' : `${humanFor(l, s.champion)?.name ?? 'Someone'} won it`)
                    : s.status === LEAGUE_STATUS.cancelled ? 'Cancelled' : s.where}
                  {s.earned > 0 ? ` · +${s.earned} coins` : ''}
                </div>
                <div className={styles.seasonCardActions}>
                  <button className={styles.primary} onClick={() => onOpen(l.id)}>Open</button>
                  {s.status === LEAGUE_STATUS.lobby && <span className={`${styles.muted} ${lg.mono}`}>{l.joinCode}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── New / join ──────────────────────────────────────────────────────────────

function useTeamName(user) {
  return useState(() => (user?.displayName ? `${user.displayName.split(' ')[0]}'s Team` : 'My Team'));
}

function NewTournament({ teamA, collection, uid, onCancel, onCreated }) {
  const { user } = useAuth();
  const { toast } = useDialogs();
  const [name, setName] = useState('Friday Night Bracket');
  const [teamName, setTeamName] = useTeamName(user);
  const [size, setSize] = useState(4);
  const [fee, setFee] = useState(100);
  const [pick, setPick] = useState({ roster: [], deck: null, deckName: null });
  const [busy, setBusy] = useState(false);
  const pay = tournamentPayouts(size, fee);
  const ok = pick.roster.length >= MIN_TO_PLAY;

  const create = async () => {
    setBusy(true);
    try {
      const entrant = entrantFromTeam(uid, { name: teamName.trim() || 'My Team', roster: pick.roster, deck: pick.deck, deckName: pick.deckName });
      const res = await createLeague(uid, { kind: 'tournament', name: name.trim() || 'Tournament', settings: { size, fee }, entrant });
      toast(`Tournament open — code ${res.joinCode}`, { tone: 'success' });
      onCreated(res.leagueId);
    } catch (e) {
      toast(e?.message ?? 'Could not create it', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>New tournament</h2>
          <p className={styles.sub}>You enter first. Your entry is charged now and refunded if the bracket never starts.</p>
        </div>
        <button className={styles.ghost} onClick={onCancel}>Cancel</button>
      </header>

      <div className={styles.setup}>
        <label className={styles.field}>
          <span className={styles.label}>Tournament name</span>
          <input className={styles.input} value={name} maxLength={40} onChange={e => setName(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Your team name</span>
          <input className={styles.input} value={teamName} maxLength={28} onChange={e => setTeamName(e.target.value)} />
        </label>

        <RosterPicker teamA={teamA} collection={collection} uid={uid} onChange={setPick} deckHint="Fixed for the whole bracket." />

        <div className={styles.field}>
          <span className={styles.label}>Bracket size</span>
          <div className={styles.choices}>
            {TOURNAMENT_SIZES.map(n => (
              <Choice key={n} on={size === n} onClick={() => setSize(n)} title={`${n} teams`} sub={`${Math.log2(n)} rounds`} />
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Entry fee</span>
          <div className={styles.choices}>
            {ENTRY_FEES.map(f => (
              <Choice key={f} on={fee === f} onClick={() => setFee(f)} title={f ? `${f} coins` : 'Free'} sub={f ? `pool ${f * size}` : 'bragging rights'} />
            ))}
          </div>
        </div>

        <div className={styles.prize}>
          <strong>Prize pool · {pay.pool} coins</strong>
          <span>🏆 champion {pay.champion} · every match won {pay.perWin}</span>
        </div>

        <button className={styles.primary} disabled={!ok || busy} onClick={create}>
          {busy ? 'Opening…' : ok ? `Open the tournament${fee ? ` · pay ${fee}` : ''}` : `Pick at least ${MIN_TO_PLAY} cards`}
        </button>
      </div>
    </>
  );
}

function JoinTournament({ teamA, collection, uid, onCancel, onJoined }) {
  const { user } = useAuth();
  const { toast } = useDialogs();
  const [code, setCode] = useState('');
  const [teamName, setTeamName] = useTeamName(user);
  const [pick, setPick] = useState({ roster: [], deck: null, deckName: null });
  const [busy, setBusy] = useState(false);
  const ok = pick.roster.length >= MIN_TO_PLAY && /^[A-Z0-9]{6}$/.test(code);

  const join = async () => {
    setBusy(true);
    try {
      const entrant = entrantFromTeam(uid, { name: teamName.trim() || 'My Team', roster: pick.roster, deck: pick.deck, deckName: pick.deckName });
      const res = await joinLeague(uid, { code, entrant });
      if (res.kind !== 'tournament') {
        toast(`${res.name} is a season — it is under the Season tab.`, { tone: 'success' });
        onCancel();
        return;
      }
      toast(`You are in ${res.name}.`, { tone: 'success' });
      onJoined(res.leagueId);
    } catch (e) {
      toast(e?.message ?? 'Could not join', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Join a tournament</h2>
          <p className={styles.sub}>The code is six characters. The entry fee is charged when you join.</p>
        </div>
        <button className={styles.ghost} onClick={onCancel}>Cancel</button>
      </header>

      <div className={styles.setup}>
        <label className={styles.field}>
          <span className={styles.label}>Join code</span>
          <input
            className={`${styles.input} ${lg.codeInput}`}
            value={code}
            maxLength={6}
            placeholder="ABC123"
            onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Your team name</span>
          <input className={styles.input} value={teamName} maxLength={28} onChange={e => setTeamName(e.target.value)} />
        </label>
        <RosterPicker teamA={teamA} collection={collection} uid={uid} onChange={setPick} deckHint="Fixed for the whole bracket." />
        <button className={styles.primary} disabled={!ok || busy} onClick={join}>
          {busy ? 'Joining…' : ok ? 'Join' : code.length < 6 ? 'Enter the code' : `Pick at least ${MIN_TO_PLAY} cards`}
        </button>
      </div>
    </>
  );
}

// ── One tournament: lobby, bracket, your match ──────────────────────────────

function Tournament({ leagueId, uid, onBack, onOpenRoom }) {
  const { ask, toast } = useDialogs();
  const [league, setLeague] = useState(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => watchLeague(leagueId, setLeague), [leagueId]);

  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast(okMsg, { tone: 'success' }); }
    catch (e) { toast(e?.message ?? 'That did not go through', { tone: 'error' }); }
    finally { setBusy(false); }
  }, [toast]);

  const start = () => run(() => startLeague(uid, { leagueId }), 'The bracket is dealt.');
  const cancel = async () => {
    const yes = await ask({ title: 'Cancel this tournament?', body: 'Every entry fee goes back to its coach.', confirmLabel: 'Cancel it', tone: 'danger' });
    if (!yes) return;
    run(async () => { await cancelLeague(uid, leagueId); onBack(); });
  };
  const leave = async () => {
    const yes = await ask({ title: 'Leave this tournament?', body: 'Your entry fee comes back.', confirmLabel: 'Leave' });
    if (!yes) return;
    run(async () => { await leaveLeague(uid, leagueId); onBack(); });
  };
  const forfeit = async (fixture, loserId) => {
    const loser = humanFor(league, loserId)?.name ?? loserId;
    const yes = await ask({ title: `${loser} forfeits?`, body: 'Commissioner\'s call on a match that is not getting played. The other side advances with a 20–0.', confirmLabel: 'Record the forfeit', tone: 'danger' });
    if (!yes) return;
    run(() => forfeitLeagueFixture(uid, { leagueId, fixtureId: fixture.id, loserTeamId: loserId }), 'Forfeit recorded.');
  };

  const mineId = teamIdFor(uid);
  const openNow = useMemo(() => (league ? openFixtures(league) : []), [league]);
  const myMatch = openNow.find(f => f.home === mineId || f.away === mineId) ?? null;
  const isHost = league?.hostUid === uid;

  if (league === undefined) return <div className={styles.muted}>Loading…</div>;
  if (league === null) return <div className={styles.empty}>That tournament is gone. <button className={styles.ghost} onClick={onBack}>Back</button></div>;

  if (league.status === LEAGUE_STATUS.lobby) {
    return <LeagueLobby league={league} uid={uid} busy={busy} onStart={start} onCancel={cancel} onLeave={leave} onBack={onBack} />;
  }

  const s = summarizeLeague(league, uid);
  const earned = earningsByUid(league)[uid] ?? 0;
  const rounds = league.bracket?.rounds ?? 0;

  return (
    <>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>{league.name}</h2>
          <p className={styles.sub}>
            {s.size}-team bracket · pool {s.pool} coins ·{' '}
            {league.status === LEAGUE_STATUS.done ? 'Complete' : league.status === LEAGUE_STATUS.cancelled ? 'Cancelled' : `${roundName(Number(String(s.where).replace('round ', '')) || 1, rounds)}`}
          </p>
        </div>
        <div className={styles.headActions}>
          <button className={styles.ghost} onClick={onBack}>All tournaments</button>
        </div>
      </header>

      {league.status === LEAGUE_STATUS.done && (
        <div className={styles.finale}>
          <div className={styles.finaleTitle}>
            {s.isChampion ? '🏆 Champion' : `${humanFor(league, s.champion)?.name ?? 'Someone'} won it`}
          </div>
          <div className={styles.muted}>{earned > 0 ? `+${earned} coins — paid to your account` : 'No winnings this time'}</div>
        </div>
      )}

      {league.status === LEAGUE_STATUS.live && (
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>Your match</h3>
          {myMatch ? (
            <div className={styles.myGame}>
              <div className={styles.myGameLine}>
                <span className={styles.chipName}>{humanFor(league, myMatch.home)?.name}</span>
                <span className={styles.vs}>vs</span>
                <span className={styles.chipName}>{humanFor(league, myMatch.away)?.name}</span>
              </div>
              <LeagueMatch league={league} fixture={myMatch} uid={uid} onOpenRoom={onOpenRoom} />
            </div>
          ) : (
            <div className={styles.muted}>
              {league.bracket?.matches.some(m => (m.a === mineId || m.b === mineId) && m.winner && m.winner !== mineId)
                ? 'You are out of the bracket.'
                : 'Waiting on another match to finish.'}
            </div>
          )}
          {earned > 0 && <div className={styles.muted}>Won so far: +{earned} coins, paid as each game ended.</div>}
          {isHost && openNow.filter(f => f !== myMatch).length > 0 && (
            <div className={styles.fixtures}>
              <div className={styles.legend}>Commissioner · matches still open</div>
              {openNow.filter(f => f !== myMatch).map(f => (
                <div key={f.id} className={styles.fixture}>
                  <span className={styles.chipName}>{humanFor(league, f.home)?.name}</span>
                  <span className={styles.score}>{league.rooms?.[f.id]?.code ? `room ${league.rooms[f.id].code}` : 'no room'}</span>
                  <span className={styles.chipName}>{humanFor(league, f.away)?.name}</span>
                  <button className={styles.ghost} disabled={busy} onClick={() => forfeit(f, f.home)}>{humanFor(league, f.home)?.name} forfeits</button>
                  <button className={styles.ghost} disabled={busy} onClick={() => forfeit(f, f.away)}>{humanFor(league, f.away)?.name} forfeits</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <LeagueBracket league={league} uid={uid} />
    </>
  );
}
