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
// ── MULTIPLE HUMANS ARE NOT WIRED YET ───────────────────────────────────────
//
// createSeason takes a list of humans and simulateRound already holds a round
// open for a fixture the simulator refuses to touch, so the domain is ready.
// What is missing is the room: two humans in one season fixture need the PvP
// lobby to seat them. Until that exists, a season is you against the league.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { useDialogs } from '../ui/dialogs.jsx';
import {
  createSeason, standings, roundFixtures, recordResult, rostersOf, decksOf, setDeck,
  simulateRound, simulatePlayoffRound, roundComplete, advance, totalRounds,
  teamsById, earningsFor, PHASE,
} from '../game/modes/season.js';
import { simulateFixture } from '../game/modes/simulate.js';
import { LENGTHS, LEAGUE_SIZES, playoffCount, gamesPerTeam } from '../game/modes/schedule.js';
import { SEASON_REWARDS } from '../game/modes/prizes.js';
import { randomizeTeam, MIN_TO_PLAY, MAX, capSal, ownedRoster } from '../game/teamRules.js';
import { loadTeams } from '../firebase/savedTeams.js';
import { loadDecks } from '../firebase/savedDecks.js';
import { CARD_MAP } from '../game/cards.js';
import { logoSrc } from '../cards/CardTemplate.jsx';
import { listSeasons, saveSeason, deleteSeason } from '../firebase/seasons.js';
import { claimSeasonReward } from '../firebase/serverWrites.js';
import styles from './SeasonTab.module.css';

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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listSeasons(uid);
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
  }, [pendingResult, loading, active, seasons, commit, onResultConsumed]);

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

  return (
    <div className={styles.wrap}>
      {error && <div className={styles.error} onClick={() => setError(null)}>{error}</div>}

      {setup ? (
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
          onOpen={setActive}
          onNew={() => setSetup(true)}
          onDelete={remove}
        />
      )}
    </div>
  );
}

// ── The list of saved seasons ───────────────────────────────────────────────

function SeasonList({ seasons, onOpen, onNew, onDelete }) {
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
    </>
  );
}

// ── Setup ───────────────────────────────────────────────────────────────────

function Setup({ teamA, collection, uid, onStart, onCancel }) {
  const { user } = useAuth();
  const [name, setName] = useState(() => (user?.displayName ? `${user.displayName.split(' ')[0]}'s Team` : 'My Team'));
  const [source, setSource] = useState(teamA.length >= MIN_TO_PLAY ? 'builder' : 'random');
  const [savedId, setSavedId] = useState('');
  const [saved, setSaved] = useState([]);
  const [decks, setDecks] = useState([]);
  const [deckId, setDeckId] = useState('default');
  const [size, setSize] = useState(8);
  const [length, setLength] = useState('regular');
  const [rolled, setRolled] = useState(null);

  useEffect(() => {
    if (!uid) return;
    loadTeams(uid).then(setSaved).catch(() => setSaved([]));
    loadDecks(uid).then(setDecks).catch(() => setDecks([]));
  }, [uid]);

  const ownedOnly = Object.keys(collection ?? {}).length > 0;
  const reroll = useCallback(() => setRolled(randomizeTeam([], ownedOnly, collection)), [ownedOnly, collection]);
  useEffect(() => { if (source === 'random' && !rolled) reroll(); }, [source, rolled, reroll]);

  const roster = useMemo(() => {
    if (source === 'builder') return teamA.slice(0, MAX);
    if (source === 'saved') {
      const team = saved.find(t => t.id === savedId);
      if (!team) return [];
      // Only the cards still owned — the same filter the Team Builder applies.
      const { roster: ids } = ownedRoster(team.players, collection);
      return ids.map(id => CARD_MAP[id]).filter(Boolean).slice(0, MAX);
    }
    return (rolled ?? []).slice(0, MAX);
  }, [source, teamA, saved, savedId, collection, rolled]);

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

        <div className={styles.field}>
          <span className={styles.label}>Your roster</span>
          <div className={styles.choices}>
            <Choice
              on={source === 'builder'} onClick={() => setSource('builder')}
              disabled={teamA.length < MIN_TO_PLAY}
              title="Team Builder"
              sub={teamA.length ? `${teamA.length} cards · $${capSal(teamA).toLocaleString()}` : 'Nothing built yet'}
            />
            <Choice
              on={source === 'saved'} onClick={() => setSource('saved')}
              disabled={!saved.length}
              title="Saved team"
              sub={saved.length ? `${saved.length} saved` : (uid ? 'None saved' : 'Sign in to save teams')}
            />
            <Choice
              on={source === 'random'} onClick={() => setSource('random')}
              title="Random legal team"
              sub={ownedOnly ? 'Drawn from your collection' : 'Drawn from the whole pool'}
            />
          </div>
          {source === 'saved' && (
            <select className={styles.input} value={savedId} onChange={e => setSavedId(e.target.value)}>
              <option value="">Choose a team…</option>
              {saved.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {source === 'random' && (
            <button className={styles.ghost} onClick={reroll}>🎲 Roll another</button>
          )}
          <div className={styles.rosterPeek}>
            {roster.length
              ? `${roster.length} cards · $${capSal(roster).toLocaleString()} — ${roster.map(c => c.name).join(', ')}`
              : 'No roster yet.'}
          </div>
        </div>

        {decks.length > 0 && (
          <label className={styles.field}>
            <span className={styles.label}>Strategy deck</span>
            <select className={styles.input} value={deckId} onChange={e => setDeckId(e.target.value)}>
              <option value="default">The default fifty</option>
              {decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <span className={styles.hint}>
              You can change this between rounds — a season is long enough to change your mind.
            </span>
          </label>
        )}

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
          onClick={() => {
            const chosen = decks.find(d => d.id === deckId);
            onStart({
              name: name.trim() || 'My Team', roster, size, length,
              deck: chosen?.cards ?? null,
              deckName: chosen?.name ?? null,
            });
          }}
        >
          {ok ? `Start ${gamesPerTeam(size, length)}-game season` : `Pick at least ${MIN_TO_PLAY} cards`}
        </button>
      </div>
    </>
  );
}

function Choice({ on, onClick, title, sub, disabled = false }) {
  return (
    <button
      type="button"
      className={`${styles.choice} ${on ? styles.choiceOn : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={styles.choiceTitle}>{title}</span>
      <span className={styles.choiceSub}>{sub}</span>
    </button>
  );
}

// ── The season itself ───────────────────────────────────────────────────────

function Dashboard({ season, uid, commit, onPlayFixture, onBack, onAbandon }) {
  const { ask, toast } = useDialogs();
  const [decks, setDecks] = useState([]);
  useEffect(() => {
    if (!uid) return;
    loadDecks(uid).then(setDecks).catch(() => setDecks([]));
  }, [uid]);
  const [claiming, setClaiming] = useState(false);
  const by = useMemo(() => teamsById(season), [season]);
  const me = by.get(MY_ID);
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

  const mine = games.find(g => g.home === MY_ID || g.away === MY_ID) ?? null;
  const myGameLeft = Boolean(mine && !mine.result && mine.home && mine.away);
  const othersLeft = games.some(g => g !== mine && !g.result && g.home && g.away);
  const complete = isPlayoffs
    ? games.every(g => g.result || !g.home || !g.away)
    : roundComplete(season);

  const play = useCallback(() => {
    if (!mine || !me) return;
    const homeIsMine = mine.home === MY_ID;
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
    commit(setDeck(season, MY_ID, chosen?.cards ?? null, chosen?.name ?? null));
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

  const earnings = isDone ? earningsFor(season, MY_ID) : { coins: 0, label: null };
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
          <h2 className={styles.title}>{me?.name ?? 'Season'}</h2>
          <p className={styles.sub}>
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
          <button className={styles.ghost} onClick={onAbandon}>Abandon</button>
        </div>
      </header>

      {isDone && (
        <div className={styles.finale}>
          <div className={styles.finaleTitle}>
            {season.champion === MY_ID
              ? '🏆 Champions'
              : `${by.get(season.champion)?.name ?? 'Someone else'} won it`}
          </div>
          {earnings.coins > 0 && (
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
              {myGameLeft && (
                <div className={styles.myGameActions}>
                  <button className={styles.primary} onClick={play}>▶ Play this game</button>
                  <button
                    className={styles.ghost}
                    onClick={simMine}
                    title="Commissioner tool: resolve it without playing. A simmed game pays nothing."
                  >
                    Sim it
                  </button>
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

          {decks.length > 0 && (
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

          <div className={styles.rowActions}>
            {othersLeft && <button className={styles.ghost} onClick={simRest}>Sim the rest of the round</button>}
            {complete && !isPlayoffs && (
              <button className={styles.primary} onClick={next}>
                {season.round < rounds ? 'Next round →' : 'Start the playoffs →'}
              </button>
            )}
          </div>
        </section>
      )}

      {(isPlayoffs || isDone) && <BracketView season={season} by={by} />}

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
                  className={`${row.id === MY_ID ? styles.meRow : ''} ${row.rank === berths ? styles.cutRow : ''}`}
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
