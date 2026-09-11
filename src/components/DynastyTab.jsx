// DYNASTY MODE — ten seasons in one finite league.
//
// The user (2026-09-11): two ways to start (your own team, or a fantasy draft
// from every card or a random smaller pool), Dynasty Points to sign who you
// drafted, personalities to haggle with, an exclusive window for your own
// free agents, free agency against the AI, a lottery draft of new players,
// and ten years with a coin bonus at the end. The design, with every number:
// docs/plans/2026-09-11-dynasty-design.md.
//
// ── THIS FILE IS THE SHELL ──────────────────────────────────────────────────
//
// The rules are src/game/modes/dynasty.js (the league) and dynastyMarket.js
// (the negotiation); the offseason screens are dynasty/DynastyScreens.jsx.
// This loads and saves, routes a phase to its screen, and runs each season on
// Season mode's own Dashboard — a dynasty year IS a season, played through
// the Play tab the same way, with its result routed back here by
// `returnTab: 'dynasty'` on the fixture (App.jsx).
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { useDialogs } from '../ui/dialogs.jsx';
import { listDynasties, saveDynasty, deleteDynasty } from '../firebase/dynasties.js';
import { claimDynastyReward } from '../firebase/serverWrites.js';
import { loadDecks } from '../firebase/savedDecks.js';
import { recordResult, isRecorded } from '../game/modes/season.js';
import SeriesPicker, { seriesFor } from './league/SeriesPicker.jsx';
import { LENGTHS, PICKABLE_LENGTHS, LEAGUE_SIZES, playoffCount, gamesPerTeam } from '../game/modes/schedule.js';
import {
  SEASON_REWARDS, DYNASTY_COMPLETION, DYNASTY_TITLE_BONUS, FANTASY_DYNASTY_FACTOR,
  dynastyCoinFactor, dynastyYearEarnings, dynastyCompletionEarnings,
} from '../game/modes/prizes.js';
import { createDynasty, START_MODES, DPHASE, simDraft, endSeason, endDynasty, isOffseason, summarizeDynasty, teamOf } from '../game/modes/dynasty.js';
import { CAP_DP } from '../game/modes/dynastyMarket.js';
import RosterPicker, { Choice } from './league/RosterPicker.jsx';
import { SeasonDashboard } from './SeasonTab.jsx';
import {
  PhaseTrack, FrontOffice, DraftRoom, SigningBoard, LotteryRoom, RookieSigning, FreeAgency, NewsFeed,
} from './dynasty/DynastyScreens.jsx';
import styles from './SeasonTab.module.css';
import dy from './dynasty/Dynasty.module.css';

/** A domain error as a sentence for a player. */
export function cleanError(e) {
  const msg = String(e?.message ?? e ?? 'Something went wrong').replace(/^dynasty:\s*/, '');
  return msg.charAt(0).toUpperCase() + msg.slice(1);
}

const ordinal = n => {
  if (!Number.isFinite(n)) return '—';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export default function DynastyTab({
  teamA = [],
  collection = {},
  onPlayFixture,
  pendingResult = null,
  onResultConsumed,
}) {
  const { user } = useAuth();
  const { ask } = useDialogs();
  const uid = user?.uid ?? null;
  const [list, setList] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const all = await listDynasties(uid);
      setList(all);
      // Straight into the one dynasty in progress — the common case is one.
      const live = all.filter(d => d.phase !== DPHASE.done);
      setActiveId(prev => prev ?? (live.length === 1 ? live[0].id : null));
    } catch (e) {
      setError(e?.message ?? 'Could not load your dynasties');
    } finally {
      setLoading(false);
    }
  }, [uid]);
  useEffect(() => { refresh(); }, [refresh]);

  const active = list.find(d => d.id === activeId) ?? null;

  /** Persist and show in one move — every change goes through here. */
  const commit = useCallback(async next => {
    setList(all => (all.some(d => d.id === next.id) ? all.map(d => (d.id === next.id ? next : d)) : [next, ...all]));
    try {
      await saveDynasty(uid, next);
    } catch (e) {
      setError(e?.message ?? 'That could not be saved');
    }
  }, [uid]);

  // A FIXTURE'S SCORE COMING BACK FROM THE PLAY TAB — the same guard as
  // SeasonTab's: keyed on the fixture, recorded once.
  const consumed = useRef(null);
  useEffect(() => {
    if (!pendingResult || loading) return;
    const d = list.find(x => x.season?.id === pendingResult.seasonId);
    if (!d) return;
    const key = `${pendingResult.seasonId}:${pendingResult.fixtureId}`;
    if (consumed.current === key) return;
    consumed.current = key;
    const s = d.season;
    const already = isRecorded(s, pendingResult.fixtureId);
    if (!already) {
      try {
        commit({ ...d, season: recordResult(s, pendingResult) });
      } catch (e) {
        setError(e?.message ?? 'That result could not be recorded');
      }
    }
    setActiveId(d.id);
    onResultConsumed?.();
  }, [pendingResult, loading, list, commit, onResultConsumed]);

  const start = useCallback(async cfg => {
    setError(null);
    try {
      let d = createDynasty({
        name: `${cfg.teamName} Dynasty`,
        human: { name: cfg.teamName, uid, roster: cfg.roster, deck: cfg.deck, deckName: cfg.deckName },
        size: cfg.size,
        length: cfg.length,
        startMode: cfg.startMode,
        series: cfg.series ?? null,
        aging: Boolean(cfg.aging),
      });
      // Into the draft room with the AI's picks before yours already made.
      if (d.phase === DPHASE.draft) d = simDraft(d);
      await saveDynasty(uid, d);
      setList(all => [d, ...all]);
      setActiveId(d.id);
      setSetup(false);
    } catch (e) {
      setError(cleanError(e));
    }
  }, [uid]);

  const remove = useCallback(async id => {
    const yes = await ask({
      title: 'Abandon this dynasty?',
      body: 'Every season, contract and draft pick in it is deleted. Coins already claimed stay yours. This cannot be undone.',
      confirmLabel: 'Abandon dynasty',
      tone: 'danger',
    });
    if (!yes) return;
    await deleteDynasty(uid, id);
    setList(all => all.filter(d => d.id !== id));
    setActiveId(prev => (prev === id ? null : prev));
  }, [uid, ask]);

  if (loading) return <div className={styles.wrap}><div className={styles.muted}>Loading dynasties…</div></div>;

  return (
    <div className={styles.wrap}>
      {error && <div className={styles.error} onClick={() => setError(null)}>{error}</div>}
      {setup ? (
        <DynastySetup teamA={teamA} collection={collection} uid={uid} onStart={start} onCancel={() => setSetup(false)} />
      ) : active ? (
        <DynastyView
          d={active}
          uid={uid}
          commit={commit}
          onPlayFixture={onPlayFixture}
          onBack={() => setActiveId(null)}
          onAbandon={() => remove(active.id)}
        />
      ) : (
        <DynastyList list={list} onOpen={setActiveId} onNew={() => setSetup(true)} onDelete={remove} />
      )}
    </div>
  );
}

// ── The list ────────────────────────────────────────────────────────────────

const PITCH = [
  { t: '💸 Dynasty Points', b: `A ${CAP_DP}-DP payroll. A player's ask comes from his salary: stars want a lot, $10 cards are just happy to be here.` },
  { t: '🤝 Personalities', b: 'Loyal, Ring Chaser, Mercenary, Security First, Bets on Himself, Easygoing — each haggles differently, and each runs out of patience.' },
  { t: '🎱 The lottery', b: 'Miss the playoffs for a shot at the top pick of a class of legends and rookies who have never been in the league.' },
  { t: '🏆 Ten years', b: `Title money every year and a bonus for seeing all ten through. A fantasy-draft start pays ${FANTASY_DYNASTY_FACTOR}×.` },
];

function DynastyList({ list, onOpen, onNew, onDelete }) {
  return (
    <>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Dynasty</h2>
          <p className={styles.sub}>
            Ten seasons in one league with one of every player. Sign them with Dynasty Points, haggle with their personalities,
            win the lottery, and outbid the AI in free agency.
          </p>
        </div>
        <button type="button" className={styles.primary} onClick={onNew}>New dynasty</button>
      </header>
      {list.length ? (
        <div className={styles.cards}>
          {list.map(d => {
            const s = summarizeDynasty(d);
            return (
              <div key={d.id} className={styles.seasonCard}>
                <div className={styles.seasonCardTop}>
                  <span className={styles.badge}>{START_MODES[d.startMode]?.label ?? d.startMode}</span>
                  <span className={styles.muted}>{d.phase === DPHASE.done ? 'Complete' : `Year ${s.year}${s.years ? ` of ${s.years}` : ''}`}</span>
                </div>
                <div className={styles.seasonCardLine}>{d.name}</div>
                <div className={styles.record}>{s.wins}–{s.losses}</div>
                <div className={styles.muted}>{s.phaseLabel}{s.titles ? ` · ${'🏆'.repeat(s.titles)}` : ''}</div>
                <div className={styles.seasonCardActions}>
                  <button type="button" className={styles.primary} onClick={() => onOpen(d.id)}>{d.phase === DPHASE.done ? 'Look back' : 'Continue'}</button>
                  <button type="button" className={styles.ghost} onClick={() => onDelete(d.id)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={dy.pitch}>
          {PITCH.map(p => <div key={p.t} className={dy.pitchItem}><strong>{p.t}</strong>{p.b}</div>)}
        </div>
      )}
    </>
  );
}

// ── Setup ───────────────────────────────────────────────────────────────────

function DynastySetup({ teamA, collection, uid, onStart, onCancel }) {
  const { user } = useAuth();
  const first = user?.displayName?.split(' ')[0];
  const [teamName, setTeamName] = useState(first ? `${first}'s Team` : 'My Team');
  const [mode, setMode] = useState('fantasy-full');
  const [size, setSize] = useState(8);
  const [length, setLength] = useState('online');
  const [pick, setPick] = useState({ roster: [], deck: null, deckName: null });
  const [series, setSeries] = useState(null);
  const [aging, setAging] = useState(false);
  const [decks, setDecks] = useState([]);
  const [deckId, setDeckId] = useState('default');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!uid) return;
    loadDecks(uid).then(setDecks).catch(() => setDecks([]));
  }, [uid]);

  const own = mode === 'own';
  const factor = dynastyCoinFactor(mode);
  const money = SEASON_REWARDS[length] ?? SEASON_REWARDS.regular;
  const bonus = DYNASTY_COMPLETION[length] ?? DYNASTY_COMPLETION.regular;
  const x = n => Math.floor(n * factor);
  const chosenDeck = decks.find(dk => dk.id === deckId) ?? null;
  const ok = !own || pick.roster.length > 0;

  const go = async () => {
    setBusy(true);
    await onStart({
      teamName: teamName.trim() || 'My Team',
      startMode: mode,
      size,
      length,
      roster: own ? pick.roster : [],
      deck: own ? pick.deck : (chosenDeck?.cards ?? null),
      deckName: own ? pick.deckName : (chosenDeck?.name ?? null),
      series: seriesFor(size, series),
      aging,
    });
    setBusy(false);
  };

  return (
    <>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>New dynasty</h2>
          <p className={styles.sub}>Ten seasons. Pick how the league is built, how big it is, and how long each year runs.</p>
        </div>
        <button type="button" className={styles.ghost} onClick={onCancel}>Cancel</button>
      </header>

      <div className={styles.setup}>
        <label className={styles.field}>
          <span className={styles.label}>Team name</span>
          <input className={styles.input} value={teamName} maxLength={28} onChange={e => setTeamName(e.target.value)} />
        </label>

        <div className={styles.field}>
          <span className={styles.label}>How the league is built</span>
          <div className={styles.choices}>
            {Object.values(START_MODES).map(m => (
              <Choice key={m.id} on={mode === m.id} onClick={() => setMode(m.id)} title={m.label} sub={m.blurb} />
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Players</span>
          <div className={styles.choices}>
            <Choice
              on={!aging} onClick={() => setAging(false)}
              title="Ten years"
              sub="Nobody ages. The dynasty ends after its tenth season."
            />
            <Choice
              on={aging} onClick={() => setAging(true)}
              title="Players age"
              sub="A year older every season: asks fall past 31, retirement from 35, certain at 40. Runs until you end it."
            />
          </div>
        </div>

        {own ? (
          <RosterPicker
            teamA={teamA}
            collection={collection}
            uid={uid}
            onChange={setPick}
            deckHint="Your cards arrive on contracts at their value, one to three years long. Short of eight, you sign the rest from free agency before year one."
          />
        ) : decks.length > 0 && (
          <label className={styles.field}>
            <span className={styles.label}>Strategy deck</span>
            <select className={styles.input} value={deckId} onChange={e => setDeckId(e.target.value)}>
              <option value="default">The default fifty</option>
              {decks.map(dk => <option key={dk.id} value={dk.id}>{dk.name}</option>)}
            </select>
          </label>
        )}

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
              <Choice
                key={l.id} on={length === l.id} onClick={() => setLength(l.id)}
                title={l.label}
                sub={`${gamesPerTeam(size, l.id)} games · ${gamesPerTeam(size, l.id) * 10} over ten years`}
              />
            ))}
          </div>
        </div>

        <SeriesPicker size={size} value={series} onChange={setSeries} label="Playoff series, every year" />

        <div className={styles.prize}>
          <strong>Coins{factor > 1 && <span className={dy.buff}>Fantasy draft ×{factor}</span>}</strong>
          <span>Every year: 🏆 {x(money.champion)} · 🥈 {x(money.runnerUp)} · playoffs {x(money.playoffs)}</span>
          <span>
            {aging ? 'Once ten seasons are in' : 'All ten years'}: {x(bonus)}, plus {x(DYNASTY_TITLE_BONUS)} for every title
          </span>
          <span className={styles.muted}>On top of the coins every game you play already pays.</span>
        </div>

        <button type="button" className={styles.primary} disabled={!ok || busy} onClick={go}>
          {busy ? 'Building the league…' : own ? (ok ? 'Start the dynasty' : 'Pick a roster') : 'To the draft room →'}
        </button>
      </div>
    </>
  );
}

// ── One dynasty ─────────────────────────────────────────────────────────────

function DynastyView({ d, uid, commit, onPlayFixture, onBack, onAbandon }) {
  const { toast, ask } = useDialogs();

  /**
   * Run one transition and save it. A refusal from the rules (the cap, a full
   * roster, the wrong phase) comes back as a toast, never as a broken screen.
   */
  const act = useCallback((fn, okMsg = null) => {
    try {
      const next = fn(d);
      commit(next);
      if (okMsg) toast(okMsg, { tone: 'success' });
      return next;
    } catch (e) {
      toast(cleanError(e), { tone: 'error' });
      return null;
    }
  }, [d, commit, toast]);

  const closeYear = () => {
    const next = act(x => endSeason(x));
    if (!next) return;
    const pay = dynastyYearEarnings(next, d.year);
    if (pay.coins) toast(`Year ${d.year}: ${pay.label} — claim ${pay.coins} coins under The years.`, { tone: 'success' });
  };

  if (d.phase === DPHASE.season && d.season) {
    return (
      <>
        <PhaseTrack d={d} />
        <SeasonDashboard
          season={d.season}
          uid={uid}
          commit={s => commit({ ...d, season: s })}
          onPlayFixture={onPlayFixture}
          onBack={onBack}
          onAbandon={onAbandon}
          title={`${d.name} · Year ${d.year}`}
          backLabel="All dynasties"
          presetExtra={{ returnTab: 'dynasty' }}
          finale={(
            <button type="button" className={styles.primary} onClick={closeYear}>
              {!d.aging && d.year >= d.years ? 'Close out the dynasty →' : `Close out Year ${d.year} — to the offseason →`}
            </button>
          )}
        />
        <FrontOffice d={d} act={act} />
        <HistoryPanel d={d} uid={uid} commit={commit} />
      </>
    );
  }

  const me = teamOf(d, d.humanId);
  let body = null;
  if (d.phase === DPHASE.draft || d.phase === DPHASE.rookieDraft) body = <DraftRoom d={d} act={act} />;
  else if (d.phase === DPHASE.signing) body = <SigningBoard d={d} act={act} kind="draft" />;
  else if (d.phase === DPHASE.resign) body = <SigningBoard d={d} act={act} kind="expiring" />;
  else if (d.phase === DPHASE.lottery) body = <LotteryRoom d={d} act={act} />;
  else if (d.phase === DPHASE.rookies) body = <RookieSigning d={d} act={act} />;
  else if (d.phase === DPHASE.freeAgency || d.phase === DPHASE.preseason) body = <FreeAgency d={d} act={act} />;
  else if (d.phase === DPHASE.done) body = <DynastyFinale d={d} uid={uid} commit={commit} />;

  return (
    <>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>{d.name}</h2>
          <p className={styles.sub}>
            {me?.name} · {START_MODES[d.startMode]?.label} · {d.teams.length} teams · {LENGTHS[d.length]?.label ?? d.length} seasons
          </p>
        </div>
        <div className={styles.headActions}>
          <button type="button" className={styles.ghost} onClick={onBack}>All dynasties</button>
          {/* An aging dynasty has no tenth-year finish: it ends when you end it. */}
          {d.aging && d.history.length > 0 && isOffseason(d) && (
            <button
              type="button"
              className={styles.ghost}
              onClick={async () => {
                const yes = await ask({
                  title: 'End the dynasty here?',
                  body: d.history.length >= 10
                    ? `After ${d.history.length} seasons. The ten-year bonus is yours to claim.`
                    : `After ${d.history.length} seasons — short of the ten that pay the completion bonus.`,
                  confirmLabel: 'End it',
                });
                if (yes) act(x => endDynasty(x));
              }}
            >
              End the dynasty
            </button>
          )}
          <button type="button" className={styles.ghost} onClick={onAbandon}>Abandon</button>
        </div>
      </header>
      <PhaseTrack d={d} />
      {body}
      {d.phase !== DPHASE.done && <FrontOffice d={d} act={act} />}
      <HistoryPanel d={d} uid={uid} commit={commit} />
      <NewsFeed d={d} />
    </>
  );
}

// ── The years, and what they paid ───────────────────────────────────────────

function useClaim(d, uid, commit) {
  const { toast } = useDialogs();
  const [busy, setBusy] = useState(null);
  const mark = which => commit({ ...d, claimed: { ...(d.claimed ?? {}), [which]: true } });
  const claim = async which => {
    setBusy(which);
    try {
      const res = await claimDynastyReward(uid, d.id, which);
      await mark(which);
      toast(`+${res.coins} coins — ${res.label}`, { tone: 'success' });
    } catch (e) {
      const msg = e?.message ?? 'Could not claim';
      toast(msg, { tone: 'error' });
      // An already-claimed year is a claimed year: stop offering the button.
      if (/already claimed/i.test(msg)) mark(which);
    } finally {
      setBusy(null);
    }
  };
  return { busy, claim };
}

function HistoryPanel({ d, uid, commit }) {
  const { busy, claim } = useClaim(d, uid, commit);
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
              const pay = dynastyYearEarnings(d, h.year);
              const finish = h.champion === me
                ? '🏆 Champions'
                : h.runnerUp === me
                  ? '🥈 Runner-up'
                  : (h.playoffSeeds ?? []).includes(me) ? 'Playoffs' : `${ordinal(row?.rank)}, missed`;
              return (
                <tr key={h.year} className={h.champion === me ? styles.meRow : ''}>
                  <td>{h.year}</td>
                  <td>{teamOf(d, h.champion)?.name ?? '—'}</td>
                  <td>{row ? `${row.w}–${row.l}` : '—'}</td>
                  <td>{finish}</td>
                  <td>
                    {!pay.coins ? <span className={styles.muted}>—</span>
                      : d.claimed?.[h.year] ? <span className={styles.muted}>+{pay.coins} paid</span>
                        : uid ? (
                          <button type="button" className={dy.linkBtn} disabled={busy != null} onClick={() => claim(h.year)}>
                            {busy === h.year ? 'Claiming…' : `Claim ${pay.coins}`}
                          </button>
                        ) : <span className={styles.muted}>{pay.coins} · sign in to claim</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Exported for the render smoke test (dynasty/dynastyScreens.test.jsx); the app reaches them through the tab.
export { DynastyView, DynastySetup };

function DynastyFinale({ d, uid, commit }) {
  const { busy, claim } = useClaim(d, uid, commit);
  const s = summarizeDynasty(d);
  const bonus = dynastyCompletionEarnings(d);
  return (
    <div className={styles.finale}>
      <div className={styles.finaleTitle}>
        {d.history.length === 10 ? 'Ten years.' : `${d.history.length} seasons.`}{' '}
        {s.titles ? '🏆'.repeat(s.titles) : 'No rings — but you saw it through.'}
      </div>
      <div className={styles.muted}>
        {s.wins}–{s.losses} across the decade · {s.titles} title{s.titles === 1 ? '' : 's'}
      </div>
      {bonus.coins > 0 && (
        d.claimed?.complete ? <div className={styles.muted}>{bonus.label} — paid</div>
          : uid ? (
            <button type="button" className={styles.primary} disabled={busy != null} onClick={() => claim('complete')}>
              {busy ? 'Claiming…' : `Claim ${bonus.coins} coins · ${bonus.label}`}
            </button>
          ) : <div className={styles.muted}>{bonus.label} — sign in to be paid</div>
      )}
    </div>
  );
}
