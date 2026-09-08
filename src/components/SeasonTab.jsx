// SEASON MODE — the schedule you come back to.
//
// The user (2026-09-07): "play a certain amount of AI teams in the season. You
// can add other human users before you start the season with variable season
// lengths, which affects the amount of coins that you get for winning [and]
// winning the championship."
//
// ── THIS FILE IS THE SHELL, NOT THE RULES ───────────────────────────────────
//
// Everything a season IS lives in src/game/modes/ — the round-robin, the
// standings tiebreakers, the bracket, the headless simulator, the AI league.
// All of it is pure and tested without a browser. This component does three
// things and nothing else: it puts that state on screen, it hands one fixture
// at a time to the Play tab, and it saves the result. If you find yourself
// deciding a rule here, it belongs in modes/.
//
// ── WHY THE PLAY TAB AND NOT AN EMBEDDED BOARD ──────────────────────────────
//
// A season fixture is an ordinary game: same engine, same coach, same rewards.
// Re-mounting CourtBoard here would fork the one screen that has all the card
// windows in it, so instead App holds a `seasonPreset`, PlayTab starts a game
// from it, and the final score comes back through `pendingResult`. The season
// never learns how a game is played.
//
// ── SEASONS WITH FRIENDS ────────────────────────────────────────────────────
//
// A shared season is a LEAGUE (modes/league.js): one document the server
// owns, a lobby with a join code, and the same Dashboard below in `league`
// mode — every mutation becomes a callable (startLeague, reportLeagueResult,
// forfeitLeagueFixture) instead of a local save, your id is `h:<uid>` rather
// than MY_ID, a human-vs-human fixture gets a LeagueMatch seat into a PvP
// room instead of a Play button, and the host sims only the AI-vs-AI games.
// The result of your own game against an AI team still comes back through
// PlayTab and `pendingResult`; it is routed to the league by its season id.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { loadRemoteGame } from '../firebase/games.js';
import { readLocalGame } from '../game/gameSave.js';
import { useDialogs } from '../ui/dialogs.jsx';
import {
  createSeason, standings, roundFixtures, recordResult, rostersOf, decksOf, setDeck,
  simulateRound, simulatePlayoffRound, roundComplete, advance, totalRounds,
  teamsById, earningsFor, PHASE, teamSeasonStats, seasonLeaders,
} from '../game/modes/season.js';
import { getCardByKey } from '../game/cardSets.js';
import { simulateFixture } from '../game/modes/simulate.js';
import { LENGTHS, LEAGUE_SIZES, playoffCount, gamesPerTeam } from '../game/modes/schedule.js';
import { SEASON_REWARDS } from '../game/modes/prizes.js';
import { MIN_TO_PLAY } from '../game/teamRules.js';
import { loadDecks } from '../firebase/savedDecks.js';
import { logoSrc } from '../cards/CardTemplate.jsx';
import { listSeasons, saveSeason, deleteSeason } from '../firebase/seasons.js';
import {
  claimSeasonReward, createLeague, joinLeague, leaveLeague, cancelLeague, startLeague, reportLeagueResult, forfeitLeagueFixture,
} from '../firebase/serverWrites.js';
import {
  listMyLeagues, watchLeague, seasonOfLeague, seasonForStart, rosterOfEntrant, entrantFromTeam, teamIdFor, earningsByUid,
  summarizeLeague, LEAGUE_STATUS,
} from '../firebase/leagues.js';
import RosterPicker, { Choice } from './league/RosterPicker.jsx';
import LeagueLobby from './league/LeagueLobby.jsx';
import LeagueMatch from './league/LeagueMatch.jsx';
import PvpGame from './PvpGame.jsx';
import styles from './SeasonTab.module.css';
import lg from './league/League.module.css';

/** The id your team carries inside every season. */
export const MY_ID = 'you';

/** A playoff round's name counted from the END, so eight teams start in the quarters. */
const ROUND_NAMES = { 1: 'Final', 2: 'Semifinals', 3: 'Quarterfinals', 4: 'First Round' };
function playoffRoundName(round, rounds) {
  return ROUND_NAMES[rounds - round + 1] ?? `Round ${round}`;
}

export default function SeasonTab({
  teamA = [],
  collection = {},
  onPlayFixture,
  pendingResult = null,
  onResultConsumed,
}) {
  const { user } = useAuth();
  const { ask } = useDialogs();
  const uid = user?.uid ?? null;
  const [seasons, setSeasons] = useState([]);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState(null);
  // Shared seasons: the leagues of kind 'season' this account is in, which
  // one is open, the sub-screen for making or joining one, and the PvP room
  // a human-vs-human fixture is being played in.
  const [leagues, setLeagues] = useState([]);
  const [activeLeague, setActiveLeague] = useState(null);
  const [shared, setShared] = useState(null);   // 'new' | 'join' | null
  const [room, setRoom] = useState(null);       // { code, role }

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, mine] = await Promise.all([
        listSeasons(uid),
        uid ? listMyLeagues(uid).catch(() => []) : Promise.resolve([]),
      ]);
      setLeagues(mine.filter(l => l.kind === 'season'));
      setSeasons(list);
      // Drop straight into the one season in progress — the common case is one.
      const live = list.filter(s => s.phase !== PHASE.done);
      setActive(prev => (prev ? list.find(s => s.id === prev.id) ?? null : live.length === 1 ? live[0] : null));
    } catch (e) {
      setError(e?.message ?? 'Could not load your seasons');
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { refresh(); }, [refresh]);

  /** Persist and show in one move — every mutation goes through here. */
  const commit = useCallback(async next => {
    setActive(next);
    setSeasons(list => list.map(s => (s.id === next.id ? next : s)));
    try {
      await saveSeason(uid, next);
    } catch (e) {
      setError(e?.message ?? 'That round could not be saved');
    }
  }, [uid]);

  // THE RESULT COMING BACK FROM THE PLAY TAB. It arrives as a prop rather than
  // through a callback because this component may have been unmounted for the
  // whole game. The guard is the fixture's own result, so a score that lands
  // twice — a re-render, a reload with the prop still set — is recorded once.
  const consumedRef = useRef(null);
  useEffect(() => {
    if (!pendingResult || loading) return;
    const key = `${pendingResult.seasonId}:${pendingResult.fixtureId}`;
    if (consumedRef.current === key) return;
    // A shared season's result goes to the league, which records it and
    // pays nothing until the season ends; the league doc updates the screen.
    const lg2 = leagues.find(l => l.id === pendingResult.seasonId);
    if (lg2) {
      consumedRef.current = key;
      reportLeagueResult(uid, {
        leagueId: lg2.id, fixtureId: pendingResult.fixtureId,
        homeScore: pendingResult.homeScore, awayScore: pendingResult.awayScore,
        homeBox: pendingResult.homeBox ?? null, awayBox: pendingResult.awayBox ?? null,
      }).catch(e => setError(e?.message ?? 'That result could not be recorded'));
      onResultConsumed?.();
      return;
    }
    const target = active?.id === pendingResult.seasonId
      ? active
      : seasons.find(s => s.id === pendingResult.seasonId);
    if (!target) return;
    consumedRef.current = key;
    const already = target.phase === PHASE.playoffs
      ? target.bracket?.matches.some(m => m.id === pendingResult.fixtureId && m.winner)
      : target.fixtures.some(f => f.id === pendingResult.fixtureId && f.result);
    if (!already) {
      try {
        commit(recordResult(target, pendingResult));
      } catch (e) {
        setError(e?.message ?? 'That result could not be recorded');
      }
    } else {
      setActive(target);
    }
    onResultConsumed?.();
  }, [pendingResult, loading, active, seasons, leagues, uid, commit, onResultConsumed]);

  const start = useCallback(async draft => {
    setError(null);
    try {
      const season = createSeason({
        humans: [{ id: MY_ID, name: draft.name, uid, roster: draft.roster, deck: draft.deck, deckName: draft.deckName }],
        size: draft.size,
        length: draft.length,
      });
      await saveSeason(uid, season);
      setSeasons(list => [season, ...list]);
      setActive(season);
      setSetup(false);
    } catch (e) {
      setError(e?.message ?? 'That season could not be started');
    }
  }, [uid]);

  const remove = useCallback(async id => {
    const yes = await ask({
      title: 'Abandon this season?',
      body: 'Its schedule, standings and results are deleted. This cannot be undone.',
      confirmLabel: 'Abandon season',
      tone: 'danger',
    });
    if (!yes) return;
    await deleteSeason(uid, id);
    setSeasons(list => list.filter(s => s.id !== id));
    setActive(prev => (prev?.id === id ? null : prev));
  }, [uid, ask]);

  if (loading) return <div className={styles.wrap}><div className={styles.muted}>Loading seasons…</div></div>;

  if (room) {
    return (
      <div className={styles.wrap}>
        <PvpGame roomCode={room.code} myRole={room.role} onLeave={() => setRoom(null)} />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {error && <div className={styles.error} onClick={() => setError(null)}>{error}</div>}

      {shared === 'new' ? (
        <SharedSetup
          teamA={teamA}
          collection={collection}
          uid={uid}
          onCancel={() => setShared(null)}
          onCreated={id => { setShared(null); setActiveLeague(id); refresh(); }}
        />
      ) : shared === 'join' ? (
        <JoinShared
          teamA={teamA}
          collection={collection}
          uid={uid}
          onCancel={() => setShared(null)}
          onJoined={id => { setShared(null); setActiveLeague(id); refresh(); }}
        />
      ) : activeLeague ? (
        <LeagueSeason
          leagueId={activeLeague}
          uid={uid}
          onBack={() => { setActiveLeague(null); refresh(); }}
          onPlayFixture={onPlayFixture}
          onOpenRoom={(code, role) => setRoom({ code, role })}
        />
      ) : setup ? (
        <Setup
          teamA={teamA}
          collection={collection}
          uid={uid}
          onStart={start}
          onCancel={() => setSetup(false)}
        />
      ) : active ? (
        <Dashboard
          season={active}
          uid={uid}
          commit={commit}
          onPlayFixture={onPlayFixture}
          onBack={() => setActive(null)}
          onAbandon={() => remove(active.id)}
        />
      ) : (
        <SeasonList
          seasons={seasons}
          leagues={leagues}
          uid={uid}
          onOpen={setActive}
          onNew={() => setSetup(true)}
          onDelete={remove}
          onOpenLeague={setActiveLeague}
          onNewShared={() => setShared('new')}
          onJoinShared={() => setShared('join')}
        />
      )}
    </div>
  );
}

// ── The list of saved seasons ───────────────────────────────────────────────

function SeasonList({ seasons, leagues = [], uid, onOpen, onNew, onDelete, onOpenLeague, onNewShared, onJoinShared }) {
  return (
    <>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Season</h2>
          <p className={styles.sub}>
            Play a full schedule against a league of AI teams, then the playoffs.
            Every game pays what a game always pays; the title pays once more on top.
          </p>
        </div>
        <button className={styles.primary} onClick={onNew}>+ New season</button>
      </header>

      {seasons.length === 0 ? (
        <div className={styles.empty}>
          No seasons yet. A short one in a six-team league is five games — a good first schedule.
        </div>
      ) : (
        <div className={styles.cards}>
          {seasons.map(s => {
            const row = standings(s).find(t => t.id === MY_ID);
            const done = s.phase === PHASE.done;
            return (
              <div key={s.id} className={styles.seasonCard}>
                <div className={styles.seasonCardTop}>
                  <span className={styles.badge}>{LENGTHS[s.length]?.label ?? s.length}</span>
                  <span className={styles.muted}>{s.size} teams</span>
                </div>
                <div className={styles.seasonCardLine}>
                  {done
                    ? (s.champion === MY_ID ? '🏆 Champions' : 'Season complete')
                    : s.phase === PHASE.playoffs
                      ? 'Playoffs'
                      : `Round ${s.round} of ${totalRounds(s)}`}
                </div>
                <div className={styles.record}>{row ? `${row.w}–${row.l}` : '0–0'}</div>
                <div className={styles.seasonCardActions}>
                  <button className={styles.primary} onClick={() => onOpen(s)}>
                    {done ? 'View' : 'Resume'}
                  </button>
                  <button className={styles.ghost} onClick={() => onDelete(s.id)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {uid && (
        <>
          <header className={styles.head}>
            <div>
              <h3 className={styles.title} style={{ fontSize: 18 }}>With friends</h3>
              <p className={styles.sub}>
                The same schedule with other coaches in the league. Games between two of you are played in a PvP
                room; AI teams fill the other seats and the host sims their games.
              </p>
            </div>
            <div className={styles.headActions}>
              <button className={styles.ghost} onClick={onJoinShared}>Join with a code</button>
              <button className={styles.primary} onClick={onNewShared}>+ New shared season</button>
            </div>
          </header>
          {leagues.length > 0 && (
            <div className={styles.cards}>
              {leagues.map(l => {
                const sm = summarizeLeague(l, uid);
                return (
                  <div key={l.id} className={styles.seasonCard}>
                    <div className={styles.seasonCardTop}>
                      <span className={styles.badge}>{LENGTHS[l.settings.length]?.label ?? l.settings.length}</span>
                      <span className={styles.muted}>{l.settings.size} teams · {l.entrants.length} human</span>
                    </div>
                    <div className={styles.seasonCardLine}>{l.name}</div>
                    <div className={styles.muted}>
                      {sm.status === LEAGUE_STATUS.done
                        ? (sm.isChampion ? '🏆 Champions' : 'Season complete')
                        : sm.status === LEAGUE_STATUS.cancelled ? 'Cancelled' : sm.status === LEAGUE_STATUS.lobby ? `Lobby · ${sm.where}` : sm.where}
                      {sm.earned > 0 ? ` · +${sm.earned} coins` : ''}
                    </div>
                    <div className={styles.seasonCardActions}>
                      <button className={styles.primary} onClick={() => onOpenLeague(l.id)}>Open</button>
                      {sm.status === LEAGUE_STATUS.lobby && <span className={`${styles.muted} ${lg.mono}`}>{l.joinCode}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── Shared season: make one, join one, run one ──────────────────────────────

function SharedSetup({ teamA, collection, uid, onCancel, onCreated }) {
  const { user } = useAuth();
  const { toast } = useDialogs();
  const [leagueName, setLeagueName] = useState('Our League');
  const [name, setName] = useState(() => (user?.displayName ? `${user.displayName.split(' ')[0]}'s Team` : 'My Team'));
  const [size, setSize] = useState(8);
  const [length, setLength] = useState('regular');
  const [pick, setPick] = useState({ roster: [], deck: null, deckName: null });
  const [busy, setBusy] = useState(false);
  const ok = pick.roster.length >= MIN_TO_PLAY;
  const money = SEASON_REWARDS[length] ?? SEASON_REWARDS.regular;

  const create = async () => {
    setBusy(true);
    try {
      const entrant = entrantFromTeam(uid, { name: name.trim() || 'My Team', roster: pick.roster, deck: pick.deck, deckName: pick.deckName });
      const res = await createLeague(uid, { kind: 'season', name: leagueName.trim() || 'Our League', settings: { size, length, fee: 0 }, entrant });
      toast(`Lobby open — code ${res.joinCode}`, { tone: 'success' });
      onCreated(res.leagueId);
    } catch (e) {
      toast(e?.message ?? 'Could not open the lobby', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>New shared season</h2>
          <p className={styles.sub}>You are the commissioner. Friends join with the code; AI teams fill the rest when you start.</p>
        </div>
        <button className={styles.ghost} onClick={onCancel}>Cancel</button>
      </header>
      <div className={styles.setup}>
        <label className={styles.field}>
          <span className={styles.label}>League name</span>
          <input className={styles.input} value={leagueName} maxLength={40} onChange={e => setLeagueName(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Your team name</span>
          <input className={styles.input} value={name} maxLength={28} onChange={e => setName(e.target.value)} />
        </label>
        <RosterPicker teamA={teamA} collection={collection} uid={uid} onChange={setPick} deckHint="Fixed for the whole season." />
        <div className={styles.field}>
          <span className={styles.label}>League size</span>
          <div className={styles.choices}>
            {LEAGUE_SIZES.map(n => (
              <Choice key={n} on={size === n} onClick={() => setSize(n)} title={`${n} teams`} sub={`${playoffCount(n)} make the playoffs`} />
            ))}
          </div>
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Season length</span>
          <div className={styles.choices}>
            {Object.values(LENGTHS).map(l => (
              <Choice key={l.id} on={length === l.id} onClick={() => setLength(l.id)} title={l.label} sub={`${gamesPerTeam(size, l.id)} games · ${l.blurb}`} />
            ))}
          </div>
        </div>
        <div className={styles.prize}>
          <strong>Title money</strong>
          <span>🏆 {money.champion} · 🥈 {money.runnerUp} · playoffs {money.playoffs}</span>
          <span className={styles.muted}>Paid to every human's account when the season ends. Games pay what games always pay.</span>
        </div>
        <button className={styles.primary} disabled={!ok || busy} onClick={create}>
          {busy ? 'Opening…' : ok ? 'Open the lobby' : `Pick at least ${MIN_TO_PLAY} cards`}
        </button>
      </div>
    </>
  );
}

function JoinShared({ teamA, collection, uid, onCancel, onJoined }) {
  const { user } = useAuth();
  const { toast } = useDialogs();
  const [code, setCode] = useState('');
  const [name, setName] = useState(() => (user?.displayName ? `${user.displayName.split(' ')[0]}'s Team` : 'My Team'));
  const [pick, setPick] = useState({ roster: [], deck: null, deckName: null });
  const [busy, setBusy] = useState(false);
  const ok = pick.roster.length >= MIN_TO_PLAY && /^[A-Z0-9]{6}$/.test(code);

  const join = async () => {
    setBusy(true);
    try {
      const entrant = entrantFromTeam(uid, { name: name.trim() || 'My Team', roster: pick.roster, deck: pick.deck, deckName: pick.deckName });
      const res = await joinLeague(uid, { code, entrant });
      if (res.kind !== 'season') {
        toast(`${res.name} is a tournament — it is under the Tournament tab.`, { tone: 'success' });
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
          <h2 className={styles.title}>Join a shared season</h2>
          <p className={styles.sub}>The code is six characters. Your team is fixed for the season once you are in.</p>
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
          <input className={styles.input} value={name} maxLength={28} onChange={e => setName(e.target.value)} />
        </label>
        <RosterPicker teamA={teamA} collection={collection} uid={uid} onChange={setPick} deckHint="Fixed for the whole season." />
        <button className={styles.primary} disabled={!ok || busy} onClick={join}>
          {busy ? 'Joining…' : ok ? 'Join' : code.length < 6 ? 'Enter the code' : `Pick at least ${MIN_TO_PLAY} cards`}
        </button>
      </div>
    </>
  );
}

/** One shared season: its lobby, then the Dashboard in league mode. */
function LeagueSeason({ leagueId, uid, onBack, onPlayFixture, onOpenRoom }) {
  const { ask, toast } = useDialogs();
  const [league, setLeague] = useState(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => watchLeague(leagueId, setLeague), [leagueId]);
  const season = useMemo(() => (league?.state ? seasonOfLeague(league) : null), [league]);

  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast(okMsg, { tone: 'success' }); }
    catch (e) { toast(e?.message ?? 'That did not go through', { tone: 'error' }); }
    finally { setBusy(false); }
  }, [toast]);

  // THE HOST BUILDS THE SEASON and the server checks it: the human teams must
  // be exactly the entrants, the size and length the lobby's.
  const start = () => run(async () => {
    const humans = league.entrants.map(e => ({
      id: e.id, name: e.name, uid: e.uid, roster: rosterOfEntrant(e), deck: e.deck ?? null, deckName: e.deckName ?? null,
    }));
    const built = createSeason({ id: league.id, humans, size: league.settings.size, length: league.settings.length });
    await startLeague(uid, { leagueId: league.id, state: seasonForStart(built) });
  }, 'The season is under way.');

  const cancel = async () => {
    const yes = await ask({ title: 'Cancel this league?', body: 'The lobby closes and nothing is played.', confirmLabel: 'Cancel it', tone: 'danger' });
    if (!yes) return;
    run(async () => { await cancelLeague(uid, league.id); onBack(); });
  };
  const leave = async () => {
    const yes = await ask({ title: 'Leave this league?', body: 'You can join again with the code while it is still in the lobby.', confirmLabel: 'Leave' });
    if (!yes) return;
    run(async () => { await leaveLeague(uid, league.id); onBack(); });
  };

  /** The host runs every AI-vs-AI game left in the round; humans' games wait. */
  const simAi = () => run(async () => {
    const rosters = rostersOf(season);
    const by = teamsById(season);
    const list = season.phase === PHASE.playoffs
      ? (season.bracket?.matches ?? []).filter(m => m.round === season.round && m.a && m.b && !m.winner).map(m => ({ id: m.id, home: m.a, away: m.b }))
      : roundFixtures(season).filter(f => !f.result);
    let n = 0;
    for (const f of list) {
      if (by.get(f.home)?.human || by.get(f.away)?.human) continue;
      const r = simulateFixture(f, rosters);
      await reportLeagueResult(uid, { leagueId: league.id, fixtureId: f.id, homeScore: r.homeScore, awayScore: r.awayScore, homeBox: r.homeBox, awayBox: r.awayBox, simulated: true });
      n += 1;
    }
    if (!n) toast('No AI-vs-AI games left in this round.', { tone: 'success' });
  });

  const forfeit = async (fixtureId, loserTeamId, loserName) => {
    const yes = await ask({
      title: `${loserName} forfeits?`,
      body: 'Commissioner\'s call on a game that is not getting played. It goes in the book as 20–0.',
      confirmLabel: 'Record the forfeit',
      tone: 'danger',
    });
    if (!yes) return;
    run(() => forfeitLeagueFixture(uid, { leagueId: league.id, fixtureId, loserTeamId }), 'Forfeit recorded.');
  };

  if (league === undefined) return <div className={styles.muted}>Loading…</div>;
  if (league === null) return <div className={styles.empty}>That league is gone. <button className={styles.ghost} onClick={onBack}>Back</button></div>;
  if (league.status === LEAGUE_STATUS.lobby) {
    return <LeagueLobby league={league} uid={uid} busy={busy} onStart={start} onCancel={cancel} onLeave={leave} onBack={onBack} />;
  }
  if (league.status === LEAGUE_STATUS.cancelled || !season) {
    return (
      <>
        <header className={styles.head}>
          <div><h2 className={styles.title}>{league.name}</h2><p className={styles.sub}>This league was cancelled before it started.</p></div>
          <button className={styles.ghost} onClick={onBack}>All seasons</button>
        </header>
      </>
    );
  }
  return (
    <Dashboard
      season={season}
      uid={uid}
      commit={() => {}}
      onPlayFixture={onPlayFixture}
      onBack={onBack}
      onAbandon={null}
      league={league}
      busy={busy}
      onOpenRoom={onOpenRoom}
      onSimAi={simAi}
      onForfeit={forfeit}
    />
  );
}

// ── Setup ───────────────────────────────────────────────────────────────────

function Setup({ teamA, collection, uid, onStart, onCancel }) {
  const { user } = useAuth();
  const [name, setName] = useState(() => (user?.displayName ? `${user.displayName.split(' ')[0]}'s Team` : 'My Team'));
  const [size, setSize] = useState(8);
  const [length, setLength] = useState('regular');
  const [pick, setPick] = useState({ roster: [], deck: null, deckName: null });
  const roster = pick.roster;

  const ok = roster.length >= MIN_TO_PLAY;
  const money = SEASON_REWARDS[length] ?? SEASON_REWARDS.regular;

  return (
    <>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>New season</h2>
          <p className={styles.sub}>Pick the team you will carry all year, then how long the year is.</p>
        </div>
        <button className={styles.ghost} onClick={onCancel}>Cancel</button>
      </header>

      <div className={styles.setup}>
        <label className={styles.field}>
          <span className={styles.label}>Team name</span>
          <input className={styles.input} value={name} maxLength={28} onChange={e => setName(e.target.value)} />
        </label>

        <RosterPicker
          teamA={teamA}
          collection={collection}
          uid={uid}
          onChange={setPick}
          deckHint="You can change this between rounds — a season is long enough to change your mind."
        />

        <div className={styles.field}>
          <span className={styles.label}>League size</span>
          <div className={styles.choices}>
            {LEAGUE_SIZES.map(n => (
              <Choice
                key={n} on={size === n} onClick={() => setSize(n)}
                title={`${n} teams`}
                sub={`${playoffCount(n)} make the playoffs`}
              />
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Season length</span>
          <div className={styles.choices}>
            {Object.values(LENGTHS).map(l => (
              <Choice
                key={l.id} on={length === l.id} onClick={() => setLength(l.id)}
                title={l.label}
                sub={`${gamesPerTeam(size, l.id)} games · ${l.blurb}`}
              />
            ))}
          </div>
        </div>

        <div className={styles.prize}>
          <strong>Title money</strong>
          <span>🏆 {money.champion} · 🥈 {money.runnerUp} · playoffs {money.playoffs}</span>
          <span className={styles.muted}>On top of the coins every game in the season already pays.</span>
        </div>

        <button
          className={styles.primary}
          disabled={!ok}
          onClick={() => onStart({
            name: name.trim() || 'My Team', roster, size, length,
            deck: pick.deck,
            deckName: pick.deckName,
          })}
        >
          {ok ? `Start ${gamesPerTeam(size, length)}-game season` : `Pick at least ${MIN_TO_PLAY} cards`}
        </button>
      </div>
    </>
  );
}

// ── The season itself ───────────────────────────────────────────────────────

function Dashboard({
  season, uid, commit, onPlayFixture, onBack, onAbandon,
  league = null, busy = false, onOpenRoom = null, onSimAi = null, onForfeit = null,
}) {
  const { ask, toast } = useDialogs();
  // In a shared season you are `h:<uid>`; alone, you are myId.
  const myId = league ? teamIdFor(uid) : MY_ID;
  const isHost = Boolean(league && league.hostUid === uid);
  const [decks, setDecks] = useState([]);
  useEffect(() => {
    if (!uid) return;
    loadDecks(uid).then(setDecks).catch(() => setDecks([]));
  }, [uid]);
  const [claiming, setClaiming] = useState(false);
  const by = useMemo(() => teamsById(season), [season]);
  const me = by.get(myId);
  const table = useMemo(() => standings(season), [season]);
  const rounds = totalRounds(season);
  const berths = playoffCount(season.size);

  const isPlayoffs = season.phase === PHASE.playoffs;
  const isDone = season.phase === PHASE.done;
  const bracketRounds = season.bracket?.rounds ?? 0;

  /** This round's games, in one shape whichever phase we are in. */
  const games = useMemo(() => {
    if (!isPlayoffs) return roundFixtures(season);
    return (season.bracket?.matches ?? [])
      .filter(m => m.round === season.round)
      .map(m => ({
        id: m.id,
        home: m.a,
        away: m.b,
        result: m.winner
          ? { homeScore: m.result?.homeScore ?? 0, awayScore: m.result?.awayScore ?? 0, winner: m.winner }
          : null,
      }));
  }, [season, isPlayoffs]);

  const mine = games.find(g => g.home === myId || g.away === myId) ?? null;
  const myGameLeft = Boolean(mine && !mine.result && mine.home && mine.away);
  // Two humans in one fixture play it in a PvP room, seated by LeagueMatch.
  const isHH = Boolean(league && mine && by.get(mine.home)?.human && by.get(mine.away)?.human);
  const isAi = g => Boolean(g.home && g.away && !by.get(g.home)?.human && !by.get(g.away)?.human);
  const aiLeft = Boolean(league) && games.some(g => !g.result && isAi(g));
  const hhOpen = league ? games.filter(g => g !== mine && !g.result && g.home && g.away && by.get(g.home)?.human && by.get(g.away)?.human) : [];
  const leagueEarned = league ? (earningsByUid(league)[uid] ?? 0) : 0;

  // A FIXTURE ALREADY IN PROGRESS is resumed, not re-dealt — PlayTab checks
  // this browser's own save (a reload) and the account's roaming save (the
  // phone it was started on). The screen says which, so the button reads as
  // what it will do. Read once per round; the saves change only in Play.
  const [roaming, setRoaming] = useState(null);
  useEffect(() => {
    if (!uid) { setRoaming(null); return undefined; }
    let live = true;
    loadRemoteGame(uid)
      .then(s => { if (live) setRoaming(s?.game && !s.game.done ? s : null); })
      .catch(() => { if (live) setRoaming(null); });
    return () => { live = false; };
  }, [uid, season.id, season.round]);
  const inProgress = useMemo(() => {
    if (!mine || mine.result) return null;
    const isMine = s => s?.game && !s.game.done && s.preset?.seasonId === season.id && s.preset?.fixtureId === mine.id;
    const local = readLocalGame();
    if (isMine(local)) return 'here';
    if (isMine(roaming) && (!local?.game || (roaming.at || 0) > (local.at || 0))) return 'account';
    return null;
  }, [mine, roaming, season.id]);
  const othersLeft = games.some(g => g !== mine && !g.result && g.home && g.away);
  const complete = isPlayoffs
    ? games.every(g => g.result || !g.home || !g.away)
    : roundComplete(season);

  const play = useCallback(() => {
    if (!mine || !me) return;
    const homeIsMine = mine.home === myId;
    const opp = by.get(homeIsMine ? mine.away : mine.home);
    if (!opp) return;
    // A set regenerated under a running season can take cards out from under a
    // roster (hydrate drops what no longer exists). Five is a team.
    if (me.roster.length < MIN_TO_PLAY || opp.roster.length < MIN_TO_PLAY) {
      toast('A team in this fixture is short of five cards — it can only be simmed.', { tone: 'error' });
      return;
    }
    onPlayFixture?.({
      key: `${season.id}:${mine.id}`,
      seasonId: season.id,
      fixtureId: mine.id,
      home: mine.home,
      away: mine.away,
      humanIsHome: homeIsMine,
      rosterA: me.roster,
      rosterB: opp.roster,
      // Your deck for your side; the AI plays the default fifty, as it does in
      // every simulated fixture in the league.
      deckA: me.deck ?? null,
      nameA: me.name,
      nameB: opp.name,
      label: isPlayoffs
        ? `${playoffRoundName(season.round, bracketRounds)} · ${homeIsMine ? 'vs' : 'at'} ${opp.name}`
        : `Round ${season.round} · ${homeIsMine ? 'vs' : 'at'} ${opp.name}`,
    });
  }, [mine, me, by, season, isPlayoffs, bracketRounds, onPlayFixture, toast]);

  /** Swap decks between rounds. Games already in the book are not re-run. */
  const changeDeck = useCallback(id => {
    const chosen = decks.find(d => d.id === id);
    commit(setDeck(season, myId, chosen?.cards ?? null, chosen?.name ?? null));
    toast(chosen ? `Playing ${chosen.name} from here on.` : 'Back to the default fifty.', { tone: 'success' });
  }, [decks, season, commit, toast]);

  // Commissioner tools, the user's own list: force-sim your own game, or run
  // the rest of the round without waiting on anyone.
  const simMine = useCallback(async () => {
    if (!mine) return;
    const yes = await ask({
      title: 'Sim your own game?',
      body: 'The result counts in the standings, but you will not play it — and a simmed game pays no coins.',
      confirmLabel: 'Sim it',
    });
    if (!yes) return;
    commit(recordResult(season, simulateFixture(mine, rostersOf(season))));
  }, [mine, season, commit, ask]);

  const simRest = useCallback(() => {
    const skip = myGameLeft && mine ? [mine.id] : [];
    commit(isPlayoffs ? simulatePlayoffRound(season, { skip }) : simulateRound(season, { skip }));
  }, [season, isPlayoffs, myGameLeft, mine, commit]);

  // THE PLAYOFFS ADVANCE THEMSELVES and this button must not offer to help.
  //
  // `recordResult` already sets `round = currentRound(bracket)` after every
  // playoff match, so the moment a round's last game resolves the bracket is
  // on the next one. The button was reachable only through a bye — and it
  // incremented a round that had already incremented, skipping one. Regular
  // season only now; `advance` is the only thing that moves a season on.
  const next = useCallback(() => commit(advance(season)), [season, commit]);

  const earnings = isDone ? earningsFor(season, myId) : { coins: 0, label: null };
  const claim = useCallback(async () => {
    setClaiming(true);
    try {
      const res = await claimSeasonReward(uid, season.id);
      await commit({ ...season, paid: true });
      toast(`+${res.coins} coins — ${res.label}`, { tone: 'success' });
    } catch (e) {
      const msg = e?.message ?? 'Could not claim';
      toast(msg, { tone: 'error' });
      // An already-claimed season is a claimed season: stop offering the button.
      if (/already claimed/i.test(msg)) commit({ ...season, paid: true });
    } finally {
      setClaiming(false);
    }
  }, [uid, season, commit, toast]);

  return (
    <>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>{league ? league.name : (me?.name ?? 'Season')}</h2>
          <p className={styles.sub}>
            {league ? `${me?.name ?? 'Your team'} · ` : ''}
            {LENGTHS[season.length]?.label ?? season.length} season · {season.size} teams ·{' '}
            {isDone
              ? 'Complete'
              : isPlayoffs
                ? playoffRoundName(season.round, bracketRounds)
                : `Round ${season.round} of ${rounds}`}
          </p>
        </div>
        <div className={styles.headActions}>
          <button className={styles.ghost} onClick={onBack}>All seasons</button>
          {onAbandon && <button className={styles.ghost} onClick={onAbandon}>Abandon</button>}
        </div>
      </header>

      {isDone && (
        <div className={styles.finale}>
          <div className={styles.finaleTitle}>
            {season.champion === myId
              ? '🏆 Champions'
              : `${by.get(season.champion)?.name ?? 'Someone else'} won it`}
          </div>
          {league ? (
            <div className={styles.muted}>
              {leagueEarned > 0 ? `+${leagueEarned} coins · ${earnings.label ?? 'season'} — paid to your account` : 'No title money this time'}
            </div>
          ) : earnings.coins > 0 && (
            season.paid ? (
              <div className={styles.muted}>{earnings.label} — paid</div>
            ) : uid ? (
              <button className={styles.primary} disabled={claiming} onClick={claim}>
                {claiming ? 'Claiming…' : `Claim ${earnings.coins} coins · ${earnings.label}`}
              </button>
            ) : (
              <div className={styles.muted}>{earnings.label} — sign in to be paid for a season</div>
            )
          )}
        </div>
      )}

      {!isDone && (
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>
            {isPlayoffs ? playoffRoundName(season.round, bracketRounds) : `Round ${season.round}`}
          </h3>

          {mine ? (
            <div className={styles.myGame}>
              <div className={styles.myGameLine}>
                <TeamChip team={by.get(mine.home)} won={mine.result ? mine.result.homeScore > mine.result.awayScore : false} />
                <span className={styles.vs}>
                  {mine.result ? `${mine.result.homeScore} – ${mine.result.awayScore}` : 'vs'}
                </span>
                <TeamChip team={by.get(mine.away)} right won={mine.result ? mine.result.awayScore > mine.result.homeScore : false} />
              </div>
              {myGameLeft && inProgress === 'account' && (
                <div className={styles.hint}>In progress on another device — Resume picks it up where you left off.</div>
              )}
              {myGameLeft && isHH && (
                <LeagueMatch league={league} fixture={mine} uid={uid} onOpenRoom={onOpenRoom} />
              )}
              {myGameLeft && !isHH && (
                <div className={styles.myGameActions}>
                  <button className={styles.primary} onClick={play}>{inProgress ? '▶ Resume this game' : '▶ Play this game'}</button>
                  {!league && (
                    <button
                      className={styles.ghost}
                      onClick={simMine}
                      title="Commissioner tool: resolve it without playing. A simmed game pays nothing."
                    >
                      Sim it
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className={styles.muted}>
              {isPlayoffs ? 'You are not in this round.' : 'Bye — no game for you this round.'}
            </div>
          )}

          <div className={styles.fixtures}>
            {games.filter(g => g !== mine).map(g => <FixtureRow key={g.id} game={g} by={by} />)}
          </div>

          {!league && decks.length > 0 && (
            <label className={styles.deckRow}>
              <span className={styles.label}>Your deck</span>
              <select
                className={styles.deckSelect}
                value={decks.find(d => d.name === me?.deckName)?.id ?? 'default'}
                onChange={e => changeDeck(e.target.value)}
              >
                <option value="default">The default fifty</option>
                {decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}

          {league ? (
            <>
              <div className={styles.rowActions}>
                {isHost && aiLeft && (
                  <button className={styles.ghost} disabled={busy} onClick={onSimAi}>{busy ? 'Simming…' : 'Sim the AI games'}</button>
                )}
                {!isHost && othersLeft && <span className={styles.muted}>The commissioner sims the AI games; the round moves on when every game is in.</span>}
                {isHost && !aiLeft && othersLeft && <span className={styles.muted}>Waiting on the games between coaches.</span>}
              </div>
              {isHost && hhOpen.length > 0 && (
                <div className={styles.fixtures}>
                  <div className={styles.legend}>Commissioner · a game between coaches that is not getting played can be forfeited.</div>
                  {hhOpen.map(g => (
                    <div key={g.id} className={styles.fixture}>
                      <span className={styles.chipName}>{by.get(g.home)?.name}</span>
                      <span className={styles.score}>{league.rooms?.[g.id]?.code ? `room ${league.rooms[g.id].code}` : 'no room'}</span>
                      <span className={styles.chipName}>{by.get(g.away)?.name}</span>
                      <button className={styles.ghost} disabled={busy} onClick={() => onForfeit?.(g.id, g.home, by.get(g.home)?.name)}>{by.get(g.home)?.name} forfeits</button>
                      <button className={styles.ghost} disabled={busy} onClick={() => onForfeit?.(g.id, g.away, by.get(g.away)?.name)}>{by.get(g.away)?.name} forfeits</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className={styles.rowActions}>
              {othersLeft && <button className={styles.ghost} onClick={simRest}>Sim the rest of the round</button>}
              {complete && !isPlayoffs && (
                <button className={styles.primary} onClick={next}>
                  {season.round < rounds ? 'Next round →' : 'Start the playoffs →'}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {(isPlayoffs || isDone) && <BracketView season={season} by={by} />}

      <SeasonStatsPanel season={season} by={by} myId={myId} />

      <section className={styles.panel}>
        <h3 className={styles.panelTitle}>Standings</h3>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>PF</th><th>PA</th><th>Diff</th></tr>
            </thead>
            <tbody>
              {table.map(row => (
                <tr
                  key={row.id}
                  className={`${row.id === myId ? styles.meRow : ''} ${row.rank === berths ? styles.cutRow : ''}`}
                >
                  <td>{row.rank}</td>
                  <td><TeamChip team={by.get(row.id)} /></td>
                  <td>{row.w}</td>
                  <td>{row.l}</td>
                  <td>{row.pf}</td>
                  <td>{row.pa}</td>
                  <td className={row.diff >= 0 ? styles.pos : styles.neg}>
                    {row.diff > 0 ? '+' : ''}{row.diff}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.legend}>Top {berths} make the playoffs.</div>
      </section>
    </>
  );
}

/**
 * PLAYER STATS ACROSS THE SEASON — your team by default, any team, or the
 * league's leaders. Totals with the per-game beside them; the season folds
 * every played and simulated game's box score into `season.stats`.
 */
function SeasonStatsPanel({ season, by, myId }) {
  const [view, setView] = useState(myId);
  const teamId = view === 'leaders' ? null : view;
  const rows = useMemo(() => (teamId ? teamSeasonStats(season, teamId) : seasonLeaders(season, { by: 'ppg', limit: 10 })), [season, teamId]);
  const nameOf = key => getCardByKey(key)?.name ?? key;
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  return (
    <section className={styles.panel}>
      <div className={styles.deckRow}>
        <h3 className={styles.panelTitle}>Player stats</h3>
        <select className={styles.deckSelect} value={view} onChange={e => setView(e.target.value)}>
          <option value="leaders">League leaders (PPG)</option>
          {(season.teams ?? []).map(t => <option key={t.id} value={t.id}>{t.name}{t.id === myId ? ' (you)' : ''}</option>)}
        </select>
      </div>
      {rows.length === 0 ? (
        <div className={styles.muted}>No games in the book yet.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Player</th>{!teamId && <th>Team</th>}<th>G</th><th>PTS</th><th>PPG</th><th>REB</th><th>RPG</th><th>AST</th><th>APG</th><th>3PM</th><th>MIN</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.team}:${r.key}`} className={r.team === myId && !teamId ? styles.meRow : ''}>
                  <td>{nameOf(r.key)}</td>
                  {!teamId && <td><TeamChip team={by.get(r.team)} /></td>}
                  <td>{r.g}</td>
                  <td>{r.pts}</td><td>{f1(r.ppg)}</td>
                  <td>{r.reb}</td><td>{f1(r.rpg)}</td>
                  <td>{r.ast}</td><td>{f1(r.apg)}</td>
                  <td>{r.tpm}</td>
                  <td>{r.min}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.legend}>Every game counts, played or simmed. Games recorded before this panel existed have no lines.</div>
    </section>
  );
}

function FixtureRow({ game, by }) {
  const home = by.get(game.home);
  const away = by.get(game.away);
  if (!home || !away) {
    return <div className={styles.fixture}><span className={styles.muted}>Waiting on an earlier round</span></div>;
  }
  const r = game.result;
  return (
    <div className={styles.fixture}>
      <TeamChip team={home} won={r ? r.homeScore > r.awayScore : false} />
      <span className={styles.score}>{r ? `${r.homeScore} – ${r.awayScore}` : 'vs'}</span>
      <TeamChip team={away} right won={r ? r.awayScore > r.homeScore : false} />
    </div>
  );
}

function TeamChip({ team, right = false, won = false }) {
  if (!team) return <span className={styles.muted}>TBD</span>;
  const src = team.logo ? logoSrc(team.logo) : null;
  return (
    <span className={`${styles.chip} ${right ? styles.chipRight : ''} ${won ? styles.chipWon : ''}`}>
      {src
        ? <img className={styles.crest} src={src} alt="" />
        : <span className={styles.crestDot} style={{ background: team.primary ?? 'var(--orange)' }} />}
      <span className={styles.chipName}>{team.name}</span>
    </span>
  );
}

function BracketView({ season, by }) {
  const bracket = season.bracket;
  if (!bracket) return null;
  const rounds = Array.from({ length: bracket.rounds }, (_, i) => i + 1);
  return (
    <section className={styles.panel}>
      <h3 className={styles.panelTitle}>Playoffs</h3>
      <div className={styles.bracket}>
        {rounds.map(r => (
          <div key={r} className={styles.bracketCol}>
            <div className={styles.bracketHead}>{playoffRoundName(r, bracket.rounds)}</div>
            {bracket.matches.filter(m => m.round === r).map(m => (
              <div key={m.id} className={styles.bracketMatch}>
                <BracketSide team={by.get(m.a)} won={m.winner === m.a} score={m.result?.homeScore} />
                <BracketSide team={by.get(m.b)} won={m.winner === m.b} score={m.result?.awayScore} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function BracketSide({ team, won, score }) {
  return (
    <div className={`${styles.bracketSide} ${won ? styles.bracketWon : ''}`}>
      <span className={styles.chipName}>{team?.name ?? 'TBD'}</span>
      <span className={styles.muted}>{Number.isFinite(score) ? score : ''}</span>
    </div>
  );
}

// Exported for the render smoke test (league/leagueScreens.test.jsx); the app reaches it through the tab.
export { Dashboard as SeasonDashboard };
