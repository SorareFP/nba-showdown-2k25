// A DYNASTY WITH FRIENDS (2026-09-11) — the lobby, then the same screens as a
// dynasty alone (DynastyScreens.jsx), with every click a call to the server
// instead of a local save. The user's four answers:
//   * drafts are async, on a twelve-hour pick clock — the AI picks when it
//     runs out, and the commissioner can force it;
//   * a phase moves on when every coach is ready — the commissioner can force it;
//   * free agency is three weeks of SEALED bids;
//   * trades between coaches are offers the other coach answers, and the
//     commissioner can veto.
//
// The league document IS the dynasty, changed only by the server
// (modes/dynastyFriends.js, functions/index.js dynastyAct); watching it is
// how every coach's screen moves. A coach's sealed bids are a separate
// document only they can read (dynastyBid). The season in the middle of each
// year is Season mode's Dashboard in league mode, played exactly as a shared
// season is — a coach-vs-coach game in a PvP room, the commissioner simming
// the AI's games.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../../firebase/AuthProvider.jsx';
import { useDialogs } from '../../ui/dialogs.jsx';
import {
  createLeague, joinLeague, leaveLeague, cancelLeague, deleteLeague, startLeague, forfeitLeagueFixture, dynastyAct, dynastyBid,
} from '../../firebase/serverWrites.js';
import { coachFixturesOpen } from '../../game/modes/league.js';
import { teamsById } from '../../game/modes/season.js';
import {
  watchLeague, watchMyBids, readJoinCode, dynastyOfLeague, entrantFromTeam, teamIdFor, earningsByUid, LEAGUE_STATUS,
} from '../../firebase/leagues.js';
import { loadDecks } from '../../firebase/savedDecks.js';
import { START_MODES, DPHASE, MAX_ROSTER, humanIds, teamOf, isOffseason, summarizeDynasty, pickLabel } from '../../game/modes/dynasty.js';
import { AI_LEVELS, loadAiLevel, levelById } from '../../game/aiLevels.js';
import { clockLeft, canAdvance, vetoable } from '../../game/modes/dynastyFriends.js';
import { SEASON_REWARDS, DYNASTY_COMPLETION, DYNASTY_TITLE_BONUS, dynastyCoinFactor, dynastyYearEarnings } from '../../game/modes/prizes.js';
import { LENGTHS, PICKABLE_LENGTHS, LEAGUE_SIZES, playoffCount, gamesPerTeam } from '../../game/modes/schedule.js';
import { getCardByKey } from '../../game/cardSets.js';
import RosterPicker, { Choice } from '../league/RosterPicker.jsx';
import SeriesPicker, { seriesFor } from '../league/SeriesPicker.jsx';
import LeagueLobby from '../league/LeagueLobby.jsx';
import { SeasonDashboard, simLeagueAi, simLeagueCoaches } from '../SeasonTab.jsx';
import {
  PhaseTrack, FrontOffice, DraftRoom, SigningBoard, LotteryRoom, RookieSigning, FreeAgency, NewsFeed, TradeDesk, PhaseButton,
} from './DynastyScreens.jsx';
import styles from '../SeasonTab.module.css';
import dy from './Dynasty.module.css';

const bare = deal => ({ to: deal.to, give: deal.give, get: deal.get, givePicks: deal.givePicks, getPicks: deal.getPicks });
const noop = () => {};

/**
 * The moves the dynasty screens call (DynastyScreens.jsx soloMoves has the
 * same names), each a call to the server. `send(op, args)` resolves to the
 * server's answer, or null when it refused (it says why in a toast).
 */
export function friendsMoves({ d, me, isHost = false, send, setBids = async () => false, bids = [] }) {
  const ready = d.ready ?? {};
  return {
    friends: true,
    isHost,
    ready: {
      mine: Boolean(ready[me]),
      waiting: humanIds(d).filter(h => !ready[h]).map(h => (h === me ? 'you' : teamOf(d, h)?.name ?? 'a coach')),
      set: v => send('ready', { ready: v }),
    },
    bids,
    setBids,
    waive: key => send('waive', { key }),
    offer: async (key, dp, years) => (await send('offer', { key, dp, years }))?.result ?? null,
    renounce: key => send('renounce', { key }),
    signRookie: key => send('signRookie', { key }),
    fill: () => send('fill'),
    pick: key => send('pick', { key }),
    pass: () => send('pass'),
    trade: async deal => Boolean(await send('tradeAi', { deal: bare(deal) })),
    propose: async deal => Boolean(await send('propose', { deal: bare(deal) })),
    respond: (id, accept) => send('respond', { id, accept }),
    withdraw: id => send('withdraw', { id }),
    veto: id => send('veto', { id }),
    force: () => send('force'),
    end: () => send('end'),
    tick: () => send('tick'),
    // Alone, these close a phase; with friends the phase button readies you
    // instead (PhaseButton), so nothing reaches them.
    simToMe: noop, autoDraft: noop, finishDraft: noop, closeSigning: noop, closeResign: noop,
    drawLottery: noop, closeRookies: noop, nextWeek: noop, startSeason: noop,
  };
}

// ── Making one, joining one ─────────────────────────────────────────────────

function DeckSelect({ uid, value, onChange }) {
  const [decks, setDecks] = useState([]);
  useEffect(() => {
    if (!uid) return;
    loadDecks(uid).then(setDecks).catch(() => setDecks([]));
  }, [uid]);
  if (!decks.length) return null;
  return (
    <label className={styles.field}>
      <span className={styles.label}>Strategy deck</span>
      <select className={styles.input} value={value?.id ?? 'default'} onChange={e => onChange(decks.find(dk => dk.id === e.target.value) ?? null)}>
        <option value="default">The default fifty</option>
        {decks.map(dk => <option key={dk.id} value={dk.id}>{dk.name}</option>)}
      </select>
    </label>
  );
}

const firstName = user => user?.displayName?.split(' ')[0] ?? null;

export function FriendsSetup({ teamA, collection, uid, onCancel, onCreated }) {
  const { user } = useAuth();
  const { toast } = useDialogs();
  const first = firstName(user);
  const [leagueName, setLeagueName] = useState(first ? `${first}'s Dynasty` : 'Our Dynasty');
  const [teamName, setTeamName] = useState(first ? `${first}'s Team` : 'My Team');
  const [mode, setMode] = useState('fantasy-full');
  const [size, setSize] = useState(8);
  const [length, setLength] = useState('online');
  const [series, setSeries] = useState(null);
  const [aging, setAging] = useState(false);
  // The rung the league is built at; starts at this device's current dial.
  const [aiLevel, setAiLevel] = useState(() => loadAiLevel());
  const [pick, setPick] = useState({ roster: [], deck: null, deckName: null });
  const [deck, setDeck] = useState(null);
  const [busy, setBusy] = useState(false);
  const own = mode === 'own';
  const ok = !own || pick.roster.length === MAX_ROSTER;
  const factor = dynastyCoinFactor(mode);
  const money = SEASON_REWARDS[length] ?? SEASON_REWARDS.regular;
  const bonus = DYNASTY_COMPLETION[length] ?? DYNASTY_COMPLETION.regular;
  const x = n => Math.floor(n * factor);

  const create = async () => {
    setBusy(true);
    try {
      const entrant = entrantFromTeam(uid, {
        name: teamName.trim() || 'My Team',
        roster: own ? pick.roster : [],
        deck: own ? pick.deck : (deck?.cards ?? null),
        deckName: own ? pick.deckName : (deck?.name ?? null),
      });
      const res = await createLeague(uid, {
        kind: 'dynasty',
        name: leagueName.trim() || 'Our Dynasty',
        settings: { size, length, fee: 0, startMode: mode, series: seriesFor(size, series), aging, aiLevel },
        entrant,
      });
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
          <h2 className={styles.title}>New dynasty with friends</h2>
          <p className={styles.sub}>You are the commissioner. Friends join with the code; AI teams take the other seats when you start.</p>
        </div>
        <button type="button" className={styles.ghost} onClick={onCancel}>Cancel</button>
      </header>
      <div className={styles.setup}>
        <label className={styles.field}>
          <span className={styles.label}>Dynasty name</span>
          <input className={styles.input} value={leagueName} maxLength={40} onChange={e => setLeagueName(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Your team name</span>
          <input className={styles.input} value={teamName} maxLength={28} onChange={e => setTeamName(e.target.value)} />
        </label>
        <div className={styles.field}>
          <span className={styles.label}>How the league is built</span>
          <div className={styles.choices}>
            {Object.values(START_MODES).map(m => (
              <Choice key={m.id} on={mode === m.id} onClick={() => setMode(m.id)} title={m.label} sub={own && m.id === 'own' ? 'Every coach brings ten of their own — one of each player across all of you.' : m.blurb} />
            ))}
          </div>
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Players</span>
          <div className={styles.choices}>
            <Choice on={!aging} onClick={() => setAging(false)} title="Ten years" sub="Nobody ages. The dynasty ends after its tenth season." />
            <Choice on={aging} onClick={() => setAging(true)} title="Players age" sub="Asks fall past 31, retirement from 35. Runs until the commissioner ends it." />
          </div>
        </div>
        {own
          ? <RosterPicker teamA={teamA} collection={collection} uid={uid} onChange={setPick} deckHint={`A dynasty team is ${MAX_ROSTER} players.`} />
          : <DeckSelect uid={uid} value={deck} onChange={setDeck} />}
        <div className={styles.field}>
          <span className={styles.label}>League size</span>
          <div className={styles.choices}>
            {LEAGUE_SIZES.map(n => (
              <Choice key={n} on={size === n} onClick={() => setSize(n)} title={`${n} teams`} sub={`${playoffCount(n)} make the playoffs`} />
            ))}
          </div>
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Each season</span>
          <div className={styles.choices}>
            {PICKABLE_LENGTHS.map(l => (
              <Choice key={l.id} on={length === l.id} onClick={() => setLength(l.id)} title={l.label} sub={`${gamesPerTeam(size, l.id)} games`} />
            ))}
          </div>
        </div>
        <SeriesPicker size={size} value={series} onChange={setSeries} label="Playoff series, every year" />
        {/* THE LEAGUE'S RUNG (2026-09-16), the same choice a solo dynasty
            makes at the door: above Prince the AI teams draft to a richer cap
            for every coach, and a game here never pays above it. */}
        <div className={styles.field}>
          <span className={styles.label}>The other coaches</span>
          <div className={styles.choices}>
            {AI_LEVELS.map(l => (
              <Choice
                key={l.id} on={aiLevel === l.id} onClick={() => setAiLevel(l.id)}
                title={l.label}
                sub={`${l.blurb} · games pay ${Math.round(l.pay * 100)}%`}
              />
            ))}
          </div>
          <span className={styles.muted}>
            Prince is a fair game at the standard rate. Above it their teams are better and games pay more. Fixed for the league; any coach can turn the coach down game by game, never up.
          </span>
        </div>
        <div className={styles.prize}>
          <strong>Coins{factor !== 1 && <span className={factor > 1 ? dy.buff : dy.nerf}>Fantasy draft ×{factor}</span>}</strong>
          <span>Every year, to every coach by their finish: 🏆 {x(money.champion)} · 🥈 {x(money.runnerUp)} · playoffs {x(money.playoffs)}</span>
          <span>{aging ? 'Once ten seasons are in' : 'All ten years'}: {x(bonus)}, plus {x(DYNASTY_TITLE_BONUS)} a title</span>
          <span className={styles.muted}>Paid to your account as each year goes in the book — nothing to claim.</span>
        </div>
        <button type="button" className={styles.primary} disabled={!ok || busy} onClick={create}>
          {busy ? 'Opening…' : ok ? 'Open the lobby' : `A dynasty team is ${MAX_ROSTER} players — this one has ${pick.roster.length}`}
        </button>
      </div>
    </>
  );
}

export function JoinFriends({ teamA, collection, uid, onCancel, onJoined }) {
  const { user } = useAuth();
  const { toast } = useDialogs();
  const first = firstName(user);
  const [code, setCode] = useState('');
  const [info, setInfo] = useState(null);
  const [teamName, setTeamName] = useState(first ? `${first}'s Team` : 'My Team');
  const [pick, setPick] = useState({ roster: [], deck: null, deckName: null });
  const [deck, setDeck] = useState(null);
  const [busy, setBusy] = useState(false);
  // The code says what it opens before anyone joins: a dynasty, and whether to bring a team.
  useEffect(() => {
    if (code.length !== 6) { setInfo(null); return undefined; }
    let live = true;
    readJoinCode(code)
      .then(i => { if (live) setInfo(i ?? { missing: true }); })
      .catch(() => { if (live) setInfo({ missing: true }); });
    return () => { live = false; };
  }, [code]);
  const dyn = info?.kind === 'dynasty';
  const own = dyn && info.startMode === 'own';
  const open = dyn && info.status === LEAGUE_STATUS.lobby;
  const ok = open && (!own || pick.roster.length === MAX_ROSTER);
  const note = !info ? null
    : info.missing ? 'No league with that code.'
      : !dyn ? (info.kind === 'tournament'
        ? 'That code is a tournament — join it under the Tournament tab.'
        : 'That code is a shared season — join it under One season, with "Join a shared season".')
        : !open ? 'That dynasty has already started.'
          : own ? `A dynasty you bring your own ten to.` : `A fantasy-draft dynasty — bring nothing but a deck.`;

  const join = async () => {
    setBusy(true);
    try {
      const entrant = entrantFromTeam(uid, {
        name: teamName.trim() || 'My Team',
        roster: own ? pick.roster : [],
        deck: own ? pick.deck : (deck?.cards ?? null),
        deckName: own ? pick.deckName : (deck?.name ?? null),
      });
      const res = await joinLeague(uid, { code, entrant });
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
          <h2 className={styles.title}>Join a dynasty</h2>
          <p className={styles.sub}>The code is six characters, from the commissioner.</p>
        </div>
        <button type="button" className={styles.ghost} onClick={onCancel}>Cancel</button>
      </header>
      <div className={styles.setup}>
        <label className={styles.field}>
          <span className={styles.label}>Join code</span>
          <input
            className={styles.input}
            value={code}
            maxLength={6}
            placeholder="ABC123"
            onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
        </label>
        {note && <div className={styles.muted}>{note}</div>}
        {open && (
          <>
            <label className={styles.field}>
              <span className={styles.label}>Your team name</span>
              <input className={styles.input} value={teamName} maxLength={28} onChange={e => setTeamName(e.target.value)} />
            </label>
            {own
              ? <RosterPicker teamA={teamA} collection={collection} uid={uid} onChange={setPick} deckHint={`A dynasty team is ${MAX_ROSTER} players.`} />
              : <DeckSelect uid={uid} value={deck} onChange={setDeck} />}
          </>
        )}
        <button type="button" className={styles.primary} disabled={!ok || busy} onClick={join}>
          {busy ? 'Joining…' : code.length < 6 ? 'Enter the code' : ok ? 'Join' : own && open ? `Pick ${MAX_ROSTER} players` : 'Join'}
        </button>
      </div>
    </>
  );
}

// ── One dynasty with friends ────────────────────────────────────────────────

export function FriendsDynastyView({ leagueId, uid, onBack, onPlayFixture, onOpenRoom }) {
  const { ask, askText, toast } = useDialogs();
  const [league, setLeague] = useState(undefined);
  const [bidDoc, setBidDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => watchLeague(leagueId, setLeague), [leagueId]);
  useEffect(() => (uid ? watchMyBids(leagueId, uid, setBidDoc) : undefined), [leagueId, uid]);
  // The pick clock is read against the wall clock, so the screen re-reads it.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);

  const me = teamIdFor(uid);
  const d = useMemo(() => dynastyOfLeague(league, uid), [league, uid]);
  const isHost = league?.hostUid === uid;
  const bids = useMemo(
    () => (d?.phase === DPHASE.freeAgency && bidDoc?.year === d.year && bidDoc?.day === d.fa?.day ? (bidDoc.bids ?? []) : []),
    [d, bidDoc],
  );

  const send = useCallback(async (op, args = {}) => {
    setBusy(true);
    try {
      return (await dynastyAct(uid, { leagueId, op, args })) ?? true;
    } catch (e) {
      toast(e?.message ?? 'That did not go through', { tone: 'error' });
      return null;
    } finally {
      setBusy(false);
    }
  }, [uid, leagueId, toast]);
  const setBids = useCallback(async list => {
    try {
      await dynastyBid(uid, { leagueId, bids: list });
      return true;
    } catch (e) {
      toast(e?.message ?? 'That bid did not go in', { tone: 'error' });
      return false;
    }
  }, [uid, leagueId, toast]);
  const moves = useMemo(() => (d ? friendsMoves({ d, me, isHost, send, setBids, bids }) : null), [d, me, isHost, send, setBids, bids]);

  // THE PICK CLOCK has no timer on the server: when this screen sees it run
  // out, it asks the server to run it (once per pick), and the AI picks.
  const left = d ? clockLeft(d, now) : null;
  const ticked = useRef(null);
  useEffect(() => {
    if (left !== 0 || !d?.draft) return;
    const at = `${d.year}:${d.draft.clockFor}`;
    if (ticked.current === at) return;
    ticked.current = at;
    send('tick');
  }, [left, d, send]);

  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast(okMsg, { tone: 'success' }); }
    catch (e) { toast(e?.message ?? 'That did not go through', { tone: 'error' }); }
    finally { setBusy(false); }
  }, [toast]);

  if (league === undefined) return <div className={styles.muted}>Loading…</div>;
  if (league === null) return <div className={styles.empty}>That dynasty is gone. <button type="button" className={styles.ghost} onClick={onBack}>Back</button></div>;

  if (league.status === LEAGUE_STATUS.lobby) {
    const cancel = async () => {
      const yes = await ask({ title: 'Cancel this dynasty?', body: 'The lobby closes and nothing is played.', confirmLabel: 'Cancel it', tone: 'danger' });
      if (yes) run(async () => { await cancelLeague(uid, league.id); onBack(); });
    };
    const leave = async () => {
      const yes = await ask({ title: 'Leave this dynasty?', body: 'You can join again with the code while it is still in the lobby.', confirmLabel: 'Leave' });
      if (yes) run(async () => { await leaveLeague(uid, league.id); onBack(); });
    };
    return (
      <LeagueLobby
        league={league} uid={uid} busy={busy} onBack={onBack} onCancel={cancel} onLeave={leave}
        onStart={() => run(() => startLeague(uid, { leagueId: league.id }), 'The dynasty is under way.')}
      />
    );
  }
  if (!d || !moves) {
    return (
      <header className={styles.head}>
        <div><h2 className={styles.title}>{league.name}</h2><p className={styles.sub}>This dynasty was cancelled before it started.</p></div>
        <button type="button" className={styles.ghost} onClick={onBack}>All dynasties</button>
      </header>
    );
  }

  const drafting = d.phase === DPHASE.draft || d.phase === DPHASE.rookieDraft;
  const canForce = isHost && (drafting ? left != null : canAdvance(d));
  const force = async () => {
    const yes = await ask({
      title: drafting ? 'Make this pick now?' : 'Move everyone on?',
      body: drafting ? 'The AI makes the pick for whoever is on the clock.' : 'Commissioner\'s call: the phase closes for every coach, ready or not.',
      confirmLabel: 'Force it',
    });
    if (yes) moves.force();
  };
  const endIt = async () => {
    const yes = await ask({
      title: 'End the dynasty here?',
      body: `After ${d.history.length} seasons, for every coach.${d.history.length >= 10 ? ' The ten-year bonus is paid.' : ' Short of the ten that pay the completion bonus.'}`,
      confirmLabel: 'End it',
      tone: 'danger',
    });
    if (yes) moves.end();
  };
  const simAi = () => run(async () => {
    const n = await simLeagueAi(uid, league.id, d.season);
    if (!n) toast('No AI-vs-AI games left in this round.', { tone: 'success' });
  });
  // THE COMMISSIONER SIMS THE COACHES' GAMES (2026-09-16, the user: "only
  // for the host, and add multiple checks before doing it"). Four gates: the
  // button exists for the host alone and only while a coach's game is open
  // (SeasonDashboard); a dialog names every game it would decide and what
  // that means; the word SIM has to be typed; and the server checks the host
  // again and refuses any game that is open in a room (reportLeagueResult).
  const simCoaches = async () => {
    const open = coachFixturesOpen(league);
    if (!open.length) { toast('No coach\'s game is open this round.'); return; }
    const by = teamsById(d.season);
    const nameOf = id => by.get(id)?.name ?? id;
    const yes = await ask({
      title: `Sim ${open.length === 1 ? 'this game' : `these ${open.length} games`} for the coaches?`,
      body: 'The computer plays each one with both rosters and decks. The coaches in them do not get to play it, a game already open in a room is refused, and a result cannot be undone.',
      lines: open.map(f => `${nameOf(f.home)} vs ${nameOf(f.away)}${f.room ? ` · room ${f.room} is open` : ''}`),
      confirmLabel: 'Next',
      tone: 'danger',
    });
    if (!yes) return;
    const word = await askText({
      title: 'Type SIM to confirm',
      body: 'Every coach will see these results marked as the commissioner\'s sim.',
      placeholder: 'SIM', maxLength: 3, confirmLabel: 'Sim them', tone: 'danger',
    });
    if (word == null) return;
    if (word.trim().toUpperCase() !== 'SIM') { toast('Not simmed — that was not SIM.', { tone: 'error' }); return; }
    run(async () => {
      const out = await simLeagueCoaches(uid, league.id, d.season, open.map(f => f.id));
      const lines = out.done.map(r => `${nameOf(r.home)} ${r.homeScore}–${r.awayScore} ${nameOf(r.away)}`);
      const fails = out.failed.map(r => `${nameOf(r.home)} vs ${nameOf(r.away)}: ${r.error}`);
      toast([...lines, ...fails].join(' · ') || 'Nothing to sim.', { tone: fails.length ? 'error' : 'success' });
    });
  };
  // DELETE THE DYNASTY (2026-09-16, the user: "Need the ability to delete a
  // dynasty if you're the host"). Two dialogs — what it means, then the
  // dynasty's name typed out — and the server asks for the name again.
  const deleteIt = async () => {
    const yes = await ask({
      title: 'Delete this dynasty?',
      body: `It disappears for all ${humanIds(d).length} coaches — every season, trade and contract in it. Coins already paid stay paid; nothing is refunded. This cannot be undone.`,
      confirmLabel: 'Next',
      tone: 'danger',
    });
    if (!yes) return;
    const typed = await askText({
      title: 'Type the dynasty\'s name to delete it',
      body: `“${league.name}”`,
      placeholder: league.name, confirmLabel: 'Delete it', tone: 'danger',
    });
    if (typed == null) return;
    if (typed.trim() !== String(league.name ?? '').trim()) { toast('Not deleted — the name did not match.', { tone: 'error' }); return; }
    run(async () => { await deleteLeague(uid, { leagueId: league.id, name: typed.trim() }); onBack(); }, 'The dynasty is deleted.');
  };
  const forfeit = async (fixtureId, loserTeamId, loserName) => {
    const yes = await ask({
      title: `${loserName} forfeits?`,
      body: 'Commissioner\'s call on a game that is not getting played. It goes in the book as 20–0.',
      confirmLabel: 'Record the forfeit',
      tone: 'danger',
    });
    if (yes) run(() => forfeitLeagueFixture(uid, { leagueId: league.id, fixtureId, loserTeamId }), 'Forfeit recorded.');
  };

  const below = (
    <>
      <TradeInbox d={d} moves={moves} />
      {(isOffseason(d) || d.phase === DPHASE.season) && <TradeDesk d={d} moves={moves} />}
      {d.phase !== DPHASE.done && <FrontOffice d={d} moves={moves} />}
      <FriendsYears d={d} />
      <NewsFeed d={d} />
      {isHost && (
        <div className={styles.rowActions}>
          <button type="button" className={styles.ghost} disabled={busy} onClick={deleteIt}>Delete this dynasty</button>
        </div>
      )}
    </>
  );

  if (d.phase === DPHASE.season && d.season) {
    const last = !d.aging && d.year >= d.years;
    return (
      <>
        <PhaseTrack d={d} />
        <SeasonDashboard
          season={d.season}
          uid={uid}
          commit={noop}
          onPlayFixture={onPlayFixture}
          onBack={onBack}
          onAbandon={null}
          league={league}
          busy={busy}
          onOpenRoom={onOpenRoom}
          onSimAi={simAi}
          onSimCoaches={simCoaches}
          onForfeit={forfeit}
          title={`${league.name} · Year ${d.year}`}
          backLabel="All dynasties"
          presetExtra={{ returnTab: 'dynasty', leagueId: league.id }}
          finale={(
            <span className={dy.readyWrap}>
              <PhaseButton moves={moves} onDone={noop} label={last ? 'Close out the dynasty →' : `Close out Year ${d.year} →`} />
              {canForce && <button type="button" className={styles.ghost} onClick={force}>Force it on</button>}
            </span>
          )}
        />
        {below}
      </>
    );
  }

  let body = null;
  if (drafting) body = <DraftRoom d={d} moves={moves} />;
  else if (d.phase === DPHASE.signing) body = <SigningBoard d={d} moves={moves} kind="draft" />;
  else if (d.phase === DPHASE.resign) body = <SigningBoard d={d} moves={moves} kind="expiring" />;
  else if (d.phase === DPHASE.lottery) body = <LotteryRoom d={d} moves={moves} />;
  else if (d.phase === DPHASE.rookies) body = <RookieSigning d={d} moves={moves} />;
  else if (d.phase === DPHASE.freeAgency || d.phase === DPHASE.preseason) body = <FreeAgency d={d} moves={moves} />;
  else if (d.phase === DPHASE.done) body = <FriendsFinale d={d} league={league} uid={uid} />;
  const host = league.entrants.find(e => e.uid === league.hostUid)?.name;

  return (
    <>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>{league.name}</h2>
          <p className={styles.sub}>
            {teamOf(d, me)?.name} · {START_MODES[d.startMode]?.label} · {d.teams.length} teams, {humanIds(d).length} coaches ·{' '}
            {LENGTHS[d.length]?.label ?? d.length} seasons · {levelById(d.aiLevel ?? 'prince').label}{host ? ` · commissioner ${host}` : ''}
          </p>
        </div>
        <div className={styles.headActions}>
          <button type="button" className={styles.ghost} onClick={onBack}>All dynasties</button>
          {canForce && <button type="button" className={styles.ghost} disabled={busy} onClick={force}>{drafting ? 'Force this pick' : 'Force it on'}</button>}
          {isHost && d.aging && d.history.length > 0 && isOffseason(d) && (
            <button type="button" className={styles.ghost} onClick={endIt}>End the dynasty</button>
          )}
        </div>
      </header>
      <PhaseTrack d={d} />
      {body}
      {below}
    </>
  );
}

// ── Trade offers between coaches ────────────────────────────────────────────

/**
 * The offers waiting on you, the ones you made, and — for the commissioner —
 * every trade still open to a veto.
 */
export function TradeInbox({ d, moves }) {
  const { ask } = useDialogs();
  const me = d.humanId;
  const offers = [...(d.offers ?? [])].reverse();
  const toMe = offers.filter(o => o.status === 'open' && o.to === me);
  const fromMe = offers.filter(o => o.status === 'open' && o.from === me);
  const watch = moves.isHost ? offers.filter(o => vetoable(d, o) && !(o.status === 'open' && (o.to === me || o.from === me))) : [];
  if (!toMe.length && !fromMe.length && !watch.length) return null;
  const side = (keys = [], picks = []) => [...keys.map(k => getCardByKey(k)?.name ?? k), ...picks.map(id => pickLabel(d, id))].join(', ') || 'nothing';
  const text = o => `${teamOf(d, o.from)?.name} send ${side(o.give, o.givePicks)} to ${teamOf(d, o.to)?.name} for ${side(o.get, o.getPicks)}`;
  const veto = async o => {
    const yes = await ask({
      title: 'Veto this trade?',
      body: o.status === 'accepted' ? 'It is undone: every piece goes back where it was.' : 'The offer is struck before it is answered.',
      confirmLabel: 'Veto it',
      tone: 'danger',
    });
    if (yes) moves.veto(o.id);
  };
  return (
    <section className={styles.panel}>
      <div className={dy.panelHead}><h3 className={styles.panelTitle}>Trade offers</h3></div>
      <div className={dy.offers}>
        {toMe.map(o => (
          <div key={o.id} className={`${dy.offerLine} ${dy.offerMine}`}>
            <span>{text(o)}</span>
            <span className={dy.clockActions}>
              <button type="button" className={styles.primary} onClick={() => moves.respond(o.id, true)}>Accept</button>
              <button type="button" className={styles.ghost} onClick={() => moves.respond(o.id, false)}>Decline</button>
            </span>
          </div>
        ))}
        {fromMe.map(o => (
          <div key={o.id} className={dy.offerLine}>
            <span>{text(o)} <span className={styles.muted}>· waiting on them</span></span>
            <button type="button" className={styles.ghost} onClick={() => moves.withdraw(o.id)}>Withdraw</button>
          </div>
        ))}
        {watch.map(o => (
          <div key={o.id} className={dy.offerLine}>
            <span>{text(o)} <span className={styles.muted}>· {o.status === 'accepted' ? 'done' : 'open'}</span></span>
            <button type="button" className={dy.linkBtn} onClick={() => veto(o)}>Veto</button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── The years ───────────────────────────────────────────────────────────────

function FriendsYears({ d }) {
  if (!d.history.length) return null;
  const me = d.humanId;
  return (
    <section className={styles.panel}>
      <h3 className={styles.panelTitle}>The years</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>Year</th><th>Champion</th><th>You</th><th>Finish</th><th>Coins</th></tr>
          </thead>
          <tbody>
            {[...d.history].reverse().map(h => {
              const row = h.table.find(r => r.id === me);
              const pay = dynastyYearEarnings(d, h.year, me);
              const finish = h.champion === me ? '🏆 Champions'
                : h.runnerUp === me ? '🥈 Runner-up'
                  : (h.playoffSeeds ?? []).includes(me) ? 'Playoffs' : 'Missed';
              return (
                <tr key={h.year} className={h.champion === me ? styles.meRow : ''}>
                  <td>{h.year}</td>
                  <td>{teamOf(d, h.champion)?.name ?? '—'}</td>
                  <td>{row ? `${row.w}–${row.l}` : '—'}</td>
                  <td>{finish}</td>
                  <td>{pay.coins ? `+${pay.coins} paid` : <span className={styles.muted}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FriendsFinale({ d, league, uid }) {
  const s = summarizeDynasty(d, d.humanId);
  const paid = earningsByUid(league)[uid] ?? 0;
  return (
    <div className={styles.finale}>
      <div className={styles.finaleTitle}>
        {d.history.length} season{d.history.length === 1 ? '' : 's'}. {s.titles ? '🏆'.repeat(s.titles) : 'No rings this time.'}
      </div>
      <div className={styles.muted}>
        {s.wins}–{s.losses} · {paid ? `${paid} coins paid to your account along the way` : 'No title money this time'}
      </div>
    </div>
  );
}
