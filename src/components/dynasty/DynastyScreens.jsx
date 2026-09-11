// DYNASTY SCREENS — the front office, the draft room, the negotiating table,
// the lottery and free agency.
//
// Every rule lives in src/game/modes/dynasty.js and dynastyMarket.js. These
// put the state on screen and hand each click to `moves` — alone, each move
// is one pure transition run through `act` and saved (soloMoves, below, and
// DynastyTab.jsx); in a dynasty with friends it is a call to the server
// (friendsMoves, FriendsDynasty.jsx), and `d.humanId` is the coach looking.
// Either way the screen reads the same state. A screen that finds
// itself deciding whether something is legal should ask the domain instead —
// `quote` knows the ask, the room and the rival; `negotiate` refuses what
// cannot be signed.
import { useState, useMemo } from 'react';
import { useDialogs } from '../../ui/dialogs.jsx';
import {
  DPHASE, MIN_ROSTER, MAX_ROSTER, PHASE_LABEL, isOffseason, teamOf, rosterKeys, contractsOf, payroll, deadMoney,
  rightsOf, freeAgentKeys, quote, negotiate, renounce, waive, onClock, draftAvailable, draftPick, passPick, simDraft,
  finishDraft, projectedPayroll, closeSigning, closeResign, lotteryOdds, drawLottery, classFor, signRookie,
  closeRookies, nextFaDay, fillRoster, startSeason, rosterProblem, ageOf,
  tradeValue, evaluateTrade, makeTrade, suggestSweetener, picksOf, pickValue, pickLabel,
  tradesOpen, tradeDeadlineRound,
} from '../../game/modes/dynasty.js';
import {
  CAP_DP, APRON_DP, MIN_DP, MAX_DP, FA_DAYS, CONTRACT_YEARS, MOOD_TEXT, personality, rookieScale,
} from '../../game/modes/dynastyMarket.js';
import { clockLeft } from '../../game/modes/dynastyFriends.js';
import { BASE_SET, getCardByKey } from '../../game/cardSets.js';
import { getPlayerThumbUrl, getPlayerImageUrl, fallbackTo } from '../../game/cardImages.js';
import { POSITIONS } from '../../game/teamRules.js';
import styles from '../SeasonTab.module.css';
import dy from './Dynasty.module.css';

const cardOf = key => getCardByKey(key) ?? null;
const SET_WORD = {
  rookie: 'Rookie', 'super-season': 'Super Season', 'summer-standouts': 'Standouts', dissonance: 'Dissonance',
  'team-rewards': 'Team Reward', 'set-rewards': 'Set Reward', throwbacks: 'Throwback',
};
const HOW = { brought: 'brought', draft: 'drafted', resign: 're-signed', fa: 'free agent', rookie: 'rookie scale', fill: 'minimum' };
const YEARS = Array.from({ length: CONTRACT_YEARS.max - CONTRACT_YEARS.min + 1 }, (_, i) => CONTRACT_YEARS.min + i);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "PHI · 1996-97 Rookie" for a special card, the team for a base one. */
function tagOf(card) {
  if (!card) return '';
  if (!card.set || card.set === BASE_SET) return card.team;
  const season = card.seasonLabel ?? card.season ?? '';
  return `${card.team} · ${season} ${SET_WORD[card.set] ?? ''}`.trim();
}

export function Face({ cardKey, big = false }) {
  return (
    <img
      className={big ? dy.faceBig : dy.face}
      src={getPlayerThumbUrl(cardKey)}
      onError={fallbackTo(getPlayerImageUrl(cardKey), e => { e.currentTarget.style.visibility = 'hidden'; })}
      alt=""
      loading="lazy"
    />
  );
}

export function Trait({ pid, full = false }) {
  const p = personality(pid);
  return <span className={dy.trait} title={`${p.label} — ${p.blurb}`}>{p.icon}{full ? ` ${p.label}` : ''}</span>;
}

function PlayerCell({ cardKey, age = null }) {
  const c = cardOf(cardKey);
  return (
    <span className={dy.player}>
      <Face cardKey={cardKey} />
      <span className={dy.playerText}>
        <span className={dy.playerName}>{c?.name ?? cardKey}</span>
        <span className={dy.playerSub}>{c?.pos}{age != null ? ` · ${age}` : ''} · {tagOf(c)} · ${c?.salary}</span>
      </span>
    </span>
  );
}

// ── The year's track ────────────────────────────────────────────────────────

function stepsFor(d) {
  if (d.phase === DPHASE.done) return [];
  if (d.year === 1 && d.startMode !== 'own') return [DPHASE.draft, DPHASE.signing, DPHASE.freeAgency, DPHASE.preseason, DPHASE.season];
  if (d.year === 1) return [DPHASE.preseason, DPHASE.season];
  return [DPHASE.resign, DPHASE.lottery, DPHASE.rookieDraft, DPHASE.rookies, DPHASE.freeAgency, DPHASE.preseason, DPHASE.season];
}

export function PhaseTrack({ d }) {
  const steps = stepsFor(d);
  const at = steps.indexOf(d.phase);
  return (
    <div className={dy.track}>
      <span className={dy.trackYear}>{d.phase === DPHASE.done ? 'Complete' : `Year ${d.year}${d.aging ? '' : ` of ${d.years}`}`}</span>
      {steps.map((s, i) => (
        <span key={s} className={`${dy.step} ${i === at ? dy.stepOn : ''} ${i < at ? dy.stepDone : ''}`}>
          {i < at ? '✓ ' : ''}{PHASE_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

// ── The payroll ─────────────────────────────────────────────────────────────

function PayBar({ d, teamId, extra = 0 }) {
  const pay = payroll(d, teamId);
  const dead = deadMoney(d, teamId);
  const scale = Math.max(APRON_DP, pay + extra);
  const pct = v => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
  return (
    <div className={`${dy.pay} ${pay > CAP_DP ? dy.payOver : ''}`}>
      <div className={dy.payTrack} title={`Cap ${CAP_DP} · apron ${APRON_DP}`}>
        <div className={dy.payFill} style={{ width: pct(pay) }} />
        {extra > 0 && <div className={dy.payExtra} style={{ left: pct(pay), width: pct(extra) }} />}
        <div className={dy.payCap} style={{ left: pct(CAP_DP) }} />
      </div>
      <div className={dy.payLegend}>
        <strong>{pay} of {CAP_DP} DP</strong>
        {extra > 0 && <span> · {extra} more if your draftees sign at their asks</span>}
        {dead > 0 && <span> · {dead} of it dead money</span>}
        <span className={styles.muted}> · apron {APRON_DP} for your own players</span>
      </div>
    </div>
  );
}

// ── What a click does ───────────────────────────────────────────────────────

/**
 * Alone: every move is one pure transition run through `act`, which saves
 * what comes back and turns a refusal into a toast (DynastyTab.jsx). `ready`
 * is null — a phase closes when you close it. With friends the same names
 * call the server instead (friendsMoves, FriendsDynasty.jsx).
 */
export function soloMoves(act, me) {
  return {
    friends: false,
    isHost: false,
    ready: null,
    bids: [],
    setBids: async () => false,
    waive: key => act(x => waive(x, me, key)),
    offer: (key, dp, years) => {
      let out = null;
      act(x => {
        const r = negotiate(x, me, key, { dp, years });
        out = r.result;
        return r.dynasty;
      });
      return out;
    },
    renounce: key => act(x => renounce(x, me, key)),
    signRookie: key => act(x => signRookie(x, me, key)),
    fill: () => act(x => fillRoster(x, me)),
    pick: key => act(x => simDraft(draftPick(x, me, key))),
    pass: () => act(x => simDraft(passPick(x, me))),
    simToMe: () => act(x => simDraft(x)),
    autoDraft: () => act(x => simDraft(x, { all: true })),
    finishDraft: () => act(x => finishDraft(x)),
    closeSigning: () => act(x => closeSigning(x)),
    closeResign: () => act(x => closeResign(x)),
    drawLottery: () => act(x => drawLottery(x)),
    closeRookies: () => act(x => closeRookies(x)),
    nextWeek: () => act(x => nextFaDay(x)),
    startSeason: () => act(x => startSeason(x)),
    trade: deal => act(x => makeTrade(x, deal)),
    propose: async () => false,
  };
}

/**
 * A phase's "done" button. Alone it closes the phase (`onDone`); with
 * friends it says you are ready, and the phase moves on when every coach is —
 * so it shows who it is still waiting on. `confirm` runs first either way.
 */
export function PhaseButton({ moves, label, onDone, confirm = null, disabled = false }) {
  if (!moves.ready) {
    const go = async () => { if (confirm && !(await confirm())) return; onDone(); };
    return <button type="button" className={styles.primary} disabled={disabled} onClick={go}>{label}</button>;
  }
  const { mine, waiting, set } = moves.ready;
  const toggle = async () => {
    if (!mine && confirm && !(await confirm())) return;
    set(!mine);
  };
  const others = waiting.filter(w => w !== 'you');
  return (
    <span className={dy.readyWrap}>
      <button type="button" className={mine ? styles.ghost : styles.primary} disabled={disabled && !mine} onClick={toggle} title={label}>
        {mine ? '✓ Ready — undo' : `I'm ready · ${label.replace(/\s*→$/, '')}`}
      </button>
      <span className={styles.muted}>{others.length ? `Waiting on ${others.join(', ')}` : mine ? 'Everyone is ready' : 'Everyone else is ready'}</span>
    </span>
  );
}

/** "11h 40m", "25m" — a pick clock's time left. */
const formatLeft = ms => {
  const m = Math.ceil(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

export function FrontOffice({ d, moves }) {
  const { ask } = useDialogs();
  const me = d.humanId;
  const rows = contractsOf(d, me);
  const canMove = isOffseason(d);
  const cut = async k => {
    const yes = await ask({
      title: `Waive ${k.card.name}?`,
      body: `He becomes a free agent now, and his ${k.dp} DP stays on your cap for Year ${d.year} as dead money.`,
      confirmLabel: 'Waive him',
      tone: 'danger',
    });
    if (yes) moves.waive(k.key);
  };
  return (
    <section className={styles.panel}>
      <div className={dy.panelHead}>
        <h3 className={styles.panelTitle}>Front office</h3>
        <span className={styles.muted}>{rows.length} of {MAX_ROSTER} under contract · {MIN_ROSTER} to play a season</span>
      </div>
      <PayBar d={d} teamId={me} />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>Player</th><th>DP / season</th><th>Years left</th><th>Deal</th><th /></tr>
          </thead>
          <tbody>
            {rows.map(k => (
              <tr key={k.key}>
                <td><PlayerCell cardKey={k.key} age={ageOf(d, k.key)} /></td>
                <td><strong>{k.dp}</strong></td>
                <td>{k.years}</td>
                <td><Trait pid={k.pid} /> <span className={styles.muted}>{HOW[k.how] ?? k.how}</span></td>
                <td>{canMove && <button type="button" className={dy.linkBtn} onClick={() => cut(k)}>Waive</button>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className={styles.muted}>Nobody under contract yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── The negotiating table ───────────────────────────────────────────────────

/** A player at the top of a table: his face, his tag, his worth, his personality. */
function PlayerHead({ d, q, cardKey, onClose }) {
  const p = personality(q.pid);
  return (
    <div className={dy.negoTop}>
      <Face cardKey={cardKey} big />
      <div>
        <div className={dy.negoName}>{q.card.name}</div>
        <div className={styles.muted}>{q.card.pos} · age {ageOf(d, cardKey)} · {tagOf(q.card)}</div>
        <div className={styles.muted}>${q.card.salary} · worth about {q.fair} DP</div>
        <div className={dy.traitLine}><Trait pid={q.pid} full /></div>
        <div className={dy.blurb}>{p.blurb}</div>
      </div>
      {onClose && <button type="button" className={dy.close} onClick={onClose} aria-label="Close">×</button>}
    </div>
  );
}

/** The terms of an offer: how many years, and DP a season. */
function TermsPicker({ years, preferred, onYears, dp, onDp }) {
  const clamp = v => Math.min(MAX_DP, Math.max(MIN_DP, Math.floor(Number(v) || MIN_DP)));
  return (
    <>
      <div className={dy.yearsRow}>
        <span className={styles.label}>Years</span>
        {YEARS.map(y => (
          <button key={y} type="button" className={`${dy.yearBtn} ${y === years ? dy.yearOn : ''}`} onClick={() => onYears(y)}>
            {y}{y === preferred ? ' ★' : ''}
          </button>
        ))}
      </div>
      <div className={dy.offerRow}>
        <button type="button" className={dy.stepBtn} onClick={() => onDp(clamp(dp - 1))} aria-label="One less">−</button>
        <input
          className={dy.dpInput}
          type="number"
          min={MIN_DP}
          max={MAX_DP}
          value={dp}
          onChange={e => onDp(clamp(e.target.value))}
          aria-label="DP a season"
        />
        <button type="button" className={dy.stepBtn} onClick={() => onDp(clamp(dp + 1))} aria-label="One more">+</button>
        <span className={styles.muted}>DP a season · {dp * years} in all</span>
      </div>
    </>
  );
}

/**
 * One player, one offer at a time. Shows his ask (never his floor), who else
 * is bidding, and your room; the verdict and his new ask come back from
 * `negotiate`. Mounted with `key={cardKey}` so every player starts fresh.
 */
export function Negotiator({ d, cardKey, moves, onClose = null, letGo = null }) {
  const { toast } = useDialogs();
  const me = d.humanId;
  const first = quote(d, me, cardKey);
  const [years, setYears] = useState(first.preferred);
  const q = quote(d, me, cardKey, years);
  const [dp, setDp] = useState(q.ask);
  const [said, setSaid] = useState(null);
  const p = personality(q.pid);
  const pay = payroll(d, me);
  const full = rosterKeys(d, me).length >= MAX_ROSTER;
  const fits = amount => (amount <= MIN_DP ? pay + amount <= APRON_DP : pay + amount <= q.limit);
  const walked = q.talk.walked;
  const blocked = full
    ? `Your roster is full at ${MAX_ROSTER} — waive someone first.`
    : walked
      ? MOOD_TEXT.walked
      : !fits(dp)
        ? `${dp} DP does not fit — you have ${Math.max(0, q.room)} DP of room under your ${q.limit === APRON_DP ? 'apron' : 'cap'}.`
        : null;

  const send = async amount => {
    const out = await moves.offer(cardKey, amount, years);
    if (!out) return;
    setSaid(out);
    if (out.accepted) {
      toast(`${q.card.name} signs — ${amount} DP × ${plural(years, 'year')}`, { tone: 'success' });
      onClose?.();
    }
  };
  const pickYears = y => {
    setYears(y);
    setDp(quote(d, me, cardKey, y).ask);
  };

  const pips = p.flat ? '∞' : '●'.repeat(Math.max(0, q.talk.patience)) + '○'.repeat(Math.max(0, p.patience - q.talk.patience));

  return (
    <aside className={dy.nego}>
      <PlayerHead d={d} q={q} cardKey={cardKey} onClose={onClose} />

      <div className={dy.askLine}>
        His ask: <strong>{q.ask} DP</strong> a season for {plural(years, 'year')}
        {q.ask >= MAX_DP && <span className={dy.buff} title={`A max deal: ${MAX_DP} DP a season is the most anyone can ask`}>max</span>}
        {years !== q.preferred && <span className={styles.muted}> · he wants {q.preferred}</span>}
      </div>
      {q.rival && (
        <div className={dy.rival}>
          📨 {teamOf(d, q.rival.teamId)?.name} have offered {q.rival.dp} DP × {plural(q.rival.years, 'year')}.
          Beat it before the week is out or he signs there.
        </div>
      )}

      <TermsPicker years={years} preferred={q.preferred} onYears={pickYears} dp={dp} onDp={setDp} />

      <div className={dy.patience}>Patience <span className={dy.pips}>{pips}</span></div>
      {said && !said.accepted && (
        <div className={`${dy.mood} ${dy[`mood_${said.mood}`] ?? ''}`}>
          {MOOD_TEXT[said.mood]}{said.mood !== 'walked' && ` His ask is now ${said.ask}.`}
        </div>
      )}
      {blocked && <div className={dy.blocked}>{blocked}</div>}

      <div className={dy.negoActions}>
        <button type="button" className={styles.primary} disabled={Boolean(blocked)} onClick={() => send(dp)}>
          Offer {dp} × {years}
        </button>
        <button
          type="button"
          className={styles.ghost}
          disabled={full || walked || !fits(q.ask)}
          onClick={() => { setDp(q.ask); send(q.ask); }}
        >
          Meet his ask
        </button>
        {letGo && <button type="button" className={styles.ghost} onClick={letGo}>Let him go</button>}
      </div>
      <div className={styles.muted}>
        Room: {Math.max(0, q.room)} DP under your {q.limit === APRON_DP ? 'apron (Bird rights)' : 'cap'}. A {MIN_DP}-DP minimum deal always fits.
      </div>
    </aside>
  );
}

/**
 * A SEALED BID, in a dynasty with friends: his ask and your terms, kept from
 * the other coaches until the week turns — when he takes the best deal by his
 * own lights. Your standing bid on him, if you have one, fills the table.
 */
export function BidPanel({ d, cardKey, moves, onClose = null }) {
  const me = d.humanId;
  const all = moves.bids ?? [];
  const standing = all.find(b => b.key === cardKey) ?? null;
  const others = all.filter(b => b.key !== cardKey);
  const [years, setYears] = useState(standing?.years ?? quote(d, me, cardKey).preferred);
  const q = quote(d, me, cardKey, years);
  const [dp, setDp] = useState(standing?.dp ?? q.ask);
  const [busy, setBusy] = useState(false);
  const pay = payroll(d, me);
  const full = rosterKeys(d, me).length >= MAX_ROSTER;
  const fits = dp <= MIN_DP ? pay + dp <= APRON_DP : pay + dp <= q.limit;
  const blocked = full
    ? `Your roster is full at ${MAX_ROSTER} — waive someone first.`
    : !fits
      ? `${dp} DP does not fit — you have ${Math.max(0, q.room)} DP of room under your ${q.limit === APRON_DP ? 'apron' : 'cap'}.`
      : !standing && others.length >= 10 ? 'Ten bids a week at most.' : null;
  const save = async list => {
    setBusy(true);
    try { await moves.setBids(list); } finally { setBusy(false); }
  };
  const pickYears = y => {
    setYears(y);
    if (!standing) setDp(quote(d, me, cardKey, y).ask);
  };
  return (
    <aside className={dy.nego}>
      <PlayerHead d={d} q={q} cardKey={cardKey} onClose={onClose} />
      <div className={dy.askLine}>
        His ask: <strong>{q.ask} DP</strong> a season for {plural(years, 'year')}
        {q.ask >= MAX_DP && <span className={dy.buff} title={`A max deal: ${MAX_DP} DP a season is the most anyone can ask`}>max</span>}
        {years !== q.preferred && <span className={styles.muted}> · he wants {q.preferred}</span>}
      </div>
      {q.rival && (
        <div className={dy.rival}>
          📨 {teamOf(d, q.rival.teamId)?.name} have offered {q.rival.dp} DP × {plural(q.rival.years, 'year')}.
          He weighs it against the sealed bids when the week turns.
        </div>
      )}
      <TermsPicker years={years} preferred={q.preferred} onYears={pickYears} dp={dp} onDp={setDp} />
      {standing && <div className={`${dy.mood} ${dy.mood_close}`}>Your sealed bid: {standing.dp} DP × {plural(standing.years, 'year')}.</div>}
      {blocked && <div className={dy.blocked}>{blocked}</div>}
      <div className={dy.negoActions}>
        <button type="button" className={styles.primary} disabled={Boolean(blocked) || busy} onClick={() => save([...others, { key: cardKey, dp, years }])}>
          {standing ? `Change my bid to ${dp} × ${years}` : `Bid ${dp} × ${years}`}
        </button>
        {standing && <button type="button" className={styles.ghost} disabled={busy} onClick={() => save(others)}>Withdraw my bid</button>}
      </div>
      <div className={styles.muted}>
        No other coach sees it. Under his ask he may still take it, if it is the best he gets; under what he will take at all, it signs nobody.
      </div>
    </aside>
  );
}

function MarketRow({ d, cardKey, on, onClick, showRival = false }) {
  const q = quote(d, d.humanId, cardKey);
  return (
    <button type="button" className={`${dy.row} ${on ? dy.rowOn : ''}`} onClick={onClick}>
      <PlayerCell cardKey={cardKey} age={ageOf(d, cardKey)} />
      <Trait pid={q.pid} />
      <span className={dy.rowAsk}>
        {q.talk.walked ? <span className={styles.muted}>walked</span> : <><strong>{q.ask}</strong> × {q.years}</>}
      </span>
      {showRival
        ? <span className={dy.rowRival}>{q.rival ? `📨 ${teamOf(d, q.rival.teamId)?.abbr ?? 'AI'} ${q.rival.dp}` : ''}</span>
        : <span />}
    </button>
  );
}

// ── Signing your own: draftees, and the exclusive window ────────────────────

const SIGN_INTRO = {
  draft: `Your draftees only talk to you — for now. Each has an ask set by his salary and bent by his personality; offer less and he may take it, or walk. Everyone has to fit under the ${CAP_DP}-DP cap. Anyone you have not signed when you are done goes to free agency.`,
  expiring: `Your players whose deals ran out talk only to you in this window. Re-signing your own can take you past the cap, up to the ${APRON_DP} apron — the reward for keeping a team together. Anyone you let go hits free agency.`,
};

export function SigningBoard({ d, moves, kind }) {
  const { ask } = useDialogs();
  const me = d.humanId;
  const keys = rightsOf(d, me, kind);
  const [sel, setSel] = useState(keys[0] ?? null);
  const selected = keys.includes(sel) ? sel : null;
  const confirm = async () => !keys.length || ask({
    title: kind === 'draft' ? 'Done signing?' : 'Close the window?',
    body: `${plural(keys.length, 'unsigned player')} will go to free agency, where anyone can sign them.`,
    confirmLabel: 'Let them go',
  });
  return (
    <section className={styles.panel}>
      <div className={dy.panelHead}>
        <h3 className={styles.panelTitle}>{kind === 'draft' ? 'Sign your draftees' : 'Your free agents — the exclusive window'}</h3>
        <PhaseButton
          moves={moves}
          confirm={confirm}
          onDone={kind === 'draft' ? moves.closeSigning : moves.closeResign}
          label={kind === 'draft' ? 'Done — open free agency →' : 'Close the window →'}
        />
      </div>
      <p className={dy.intro}>{SIGN_INTRO[kind]}</p>
      {kind === 'draft' && <PayBar d={d} teamId={me} extra={projectedPayroll(d, me) - payroll(d, me)} />}
      <div className={dy.split}>
        <div className={dy.list}>
          {keys.map(k => <MarketRow key={k} d={d} cardKey={k} on={k === selected} onClick={() => setSel(k)} />)}
          {!keys.length && (
            <div className={styles.muted}>
              {kind === 'draft' ? 'Everyone you drafted is signed or gone.' : 'Nobody of yours is up for a new deal.'}
            </div>
          )}
        </div>
        {selected ? (
          <Negotiator
            key={selected}
            d={d}
            cardKey={selected}
            moves={moves}
            onClose={() => setSel(keys.find(k => k !== selected) ?? null)}
            letGo={() => moves.renounce(selected)}
          />
        ) : <div className={dy.negoEmpty}>Pick a player to talk terms.</div>}
      </div>
    </section>
  );
}

// ── The draft room — the fantasy draft and the rookie draft ─────────────────

function LotteryResult({ d }) {
  const L = d.lottery;
  if (!L?.moved?.length) return null;
  return (
    <div className={dy.lottoResult}>
      <span className={styles.label}>Lottery</span>
      {L.moved.map(m => (
        <span key={m.teamId} className={`${dy.lottoChip} ${m.to < m.from ? dy.lottoUp : ''}`}>
          {teamOf(d, m.teamId)?.name}: {m.from} → {m.to}{m.to < m.from ? ' ⬆' : m.to > m.from ? ' ⬇' : ''}
        </span>
      ))}
    </div>
  );
}

export function DraftRoom({ d, moves }) {
  const me = d.humanId;
  const fantasy = d.draft?.kind === 'fantasy';
  const clock = onClock(d);
  const mine = clock?.teamId === me;
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState('');
  const [limit, setLimit] = useState(60);

  const avail = useMemo(() => {
    const s = search.trim().toLowerCase();
    return draftAvailable(d)
      .map(cardOf)
      .filter(c => c && (!s || c.name.toLowerCase().includes(s)) && (!pos || String(c.pos ?? '').includes(pos)))
      .sort((a, b) => (b.salary ?? 0) - (a.salary ?? 0));
  }, [d, search, pos]);
  const keyOf = c => draftAvailable(d).find(k => cardOf(k) === c);
  const priceOf = key => (fantasy ? quote(d, me, key).ask : rookieScale(cardOf(key)).dp);

  const picks = d.draft?.picks ?? [];
  const mineSoFar = picks.filter(p => p.teamId === me && p.key);
  const upcoming = (d.draft?.order ?? []).slice(picks.length, picks.length + 12);
  const recent = [...picks].slice(-8).reverse();
  const extra = fantasy ? projectedPayroll(d, me) - payroll(d, me) : 0;

  const pick = key => moves.pick(key);
  // With friends a coach's pick is on a clock (dynastyFriends.js).
  const left = moves.friends ? clockLeft(d) : null;

  return (
    <section className={styles.panel}>
      <div className={dy.panelHead}>
        <h3 className={styles.panelTitle}>{fantasy ? 'The fantasy draft' : `The Year ${d.year} draft`}</h3>
        <span className={styles.muted}>{fantasy ? `${d.draft.order.length / d.teams.length} rounds, snaking` : 'Lottery order'}</span>
      </div>
      {!fantasy && <LotteryResult d={d} />}
      <p className={dy.intro}>
        {fantasy
          ? `Draft anyone — then you have to SIGN them, under a ${CAP_DP}-DP cap. The number beside each player is what he will ask you for; the bar keeps your running total.`
          : 'Players who have never been in the league. Two rounds; you can pass. A pick signs on the rookie scale — three years at three-quarters of his value — and can take you up to the apron. Everyone not taken goes back into the draft pool for a later year.'}
        {moves.friends && ' Every coach has twelve hours on the clock; when it runs out, the AI picks for them.'}
      </p>

      <div className={`${dy.clock} ${mine ? dy.clockMine : ''}`}>
        <span className={dy.clockText}>
          {!clock
            ? 'The draft is over.'
            : mine
              ? `You are on the clock — pick ${clock.n}, round ${clock.round}.`
              : `${teamOf(d, clock.teamId)?.name} are on the clock (pick ${clock.n}).`}
          {left != null && <span className={dy.clockLeft}> · {formatLeft(left)} left</span>}
        </span>
        <span className={dy.clockActions}>
          {moves.friends ? (
            mine && !fantasy && <button type="button" className={styles.ghost} onClick={moves.pass}>Pass</button>
          ) : (
            <>
              {clock && !mine && <button type="button" className={styles.ghost} onClick={moves.simToMe}>Sim to my pick</button>}
              {mine && !fantasy && <button type="button" className={styles.ghost} onClick={moves.pass}>Pass</button>}
              {clock && <button type="button" className={styles.ghost} onClick={moves.autoDraft}>Auto-draft the rest</button>}
              {!clock && <button type="button" className={styles.primary} onClick={moves.finishDraft}>{fantasy ? 'To signing →' : 'Sign your picks →'}</button>}
            </>
          )}
        </span>
      </div>

      {upcoming.length > 0 && (
        <div className={dy.ticker}>
          {upcoming.map((id, i) => (
            <span key={`${picks.length + i}`} className={`${dy.tick} ${id === me ? dy.tickMe : ''}`}>
              {picks.length + i + 1}. {id === me ? 'You' : (teamOf(d, id)?.abbr ?? teamOf(d, id)?.name)}
              {(() => {
                // A traded pick is made in its original team's slot.
                const origin = d.draft?.origin?.[picks.length + i];
                return origin && origin !== id ? ` (via ${origin === me ? 'you' : teamOf(d, origin)?.abbr ?? teamOf(d, origin)?.name})` : '';
              })()}
            </span>
          ))}
        </div>
      )}

      <div className={dy.split}>
        <div>
          <div className={dy.filters}>
            <input type="search" placeholder="Search players" value={search} onChange={e => setSearch(e.target.value)} />
            <select value={pos} onChange={e => setPos(e.target.value)}>
              <option value="">All positions</option>
              {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <span className={styles.muted}>{plural(avail.length, 'player')} left</span>
          </div>
          <div className={dy.list}>
            {avail.slice(0, limit).map(c => {
              const key = keyOf(c);
              return (
                <div key={key} className={dy.draftRow}>
                  <PlayerCell cardKey={key} age={ageOf(d, key)} />
                  <Trait pid={d.traits?.[key]} />
                  <span className={dy.rowAsk}>{fantasy ? <>asks <strong>{priceOf(key)}</strong></> : <><strong>{priceOf(key)}</strong> × 3</>}</span>
                  <button type="button" className={styles.primary} disabled={!mine} onClick={() => pick(key)}>Draft</button>
                </div>
              );
            })}
            {avail.length > limit && (
              <button type="button" className={`${styles.ghost} ${dy.more}`} onClick={() => setLimit(l => l + 60)}>Show more</button>
            )}
          </div>
        </div>

        <div className={dy.board}>
          <div className={dy.nego}>
            <div className={styles.label}>Your picks</div>
            {fantasy && <PayBar d={d} teamId={me} extra={extra} />}
            <div className={dy.boardList}>
              {mineSoFar.map(p => (
                <div key={p.key} className={dy.boardLine}>
                  <PlayerCell cardKey={p.key} age={ageOf(d, p.key)} />
                  <span className={styles.muted}>#{p.n}{fantasy ? ` · asks ${priceOf(p.key)}` : ''}</span>
                </div>
              ))}
              {!mineSoFar.length && <span className={styles.muted}>None yet.</span>}
            </div>
          </div>
          {recent.length > 0 && (
            <div className={dy.recent}>
              <span className={styles.label}>Recent picks</span>
              {recent.map(p => (
                <span key={p.n}>#{p.n} {p.teamId === me ? 'You' : teamOf(d, p.teamId)?.name}: {p.key ? cardOf(p.key)?.name : 'pass'}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── The lottery ─────────────────────────────────────────────────────────────

export function LotteryRoom({ d, moves }) {
  const odds = lotteryOdds(d);
  const cls = classFor(d);
  const last = d.history[d.history.length - 1];
  const me = d.humanId;
  return (
    <section className={styles.panel}>
      <div className={dy.panelHead}>
        <h3 className={styles.panelTitle}>The draft lottery</h3>
        <PhaseButton moves={moves} onDone={moves.drawLottery} label="Draw the lottery 🎱" />
      </div>
      <p className={dy.intro}>
        The teams that missed the playoffs, worst record first — the worse the record, the better the odds. The lottery draws
        the top {plural(odds.draws, 'pick')}; everyone else picks in reverse order of the standings.
        This class: the next {plural(cls.length, 'player')} in the draft pool, none of whom has played in this league. Two
        rounds are drafted and the rest go back into the pool.
      </p>
      {odds.entries.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Team</th><th>Record</th><th>Odds at #1</th></tr></thead>
            <tbody>
              {odds.entries.map(e => {
                const row = last.table.find(r => r.id === e.teamId);
                return (
                  <tr key={e.teamId} className={e.teamId === me ? styles.meRow : ''}>
                    <td>{teamOf(d, e.teamId)?.name}</td>
                    <td>{row ? `${row.w}–${row.l}` : '—'}</td>
                    <td>{e.pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <div className={styles.muted}>Everyone made the playoffs — the draft goes in reverse order of the standings.</div>}
      {cls.length > 0 && (
        <>
          <div className={styles.label} style={{ marginTop: 16 }}>The top of the class</div>
          <div className={dy.classPeek}>
            {[...cls].sort((a, b) => (cardOf(b)?.salary ?? 0) - (cardOf(a)?.salary ?? 0)).slice(0, 24).map(k => <PlayerCell key={k} cardKey={k} age={ageOf(d, k)} />)}
          </div>
        </>
      )}
    </section>
  );
}

// ── Signing your picks ──────────────────────────────────────────────────────

export function RookieSigning({ d, moves }) {
  const { ask } = useDialogs();
  const me = d.humanId;
  const keys = rightsOf(d, me, 'rookie');
  const full = rosterKeys(d, me).length >= MAX_ROSTER;
  const pay = payroll(d, me);
  const confirm = async () => !keys.length || ask({
    title: 'Done with your picks?',
    body: `${plural(keys.length, 'unsigned pick')} will go to free agency.`,
    confirmLabel: 'Let them go',
  });
  return (
    <section className={styles.panel}>
      <div className={dy.panelHead}>
        <h3 className={styles.panelTitle}>Sign your picks</h3>
        <PhaseButton moves={moves} confirm={confirm} onDone={moves.closeRookies} label="Done — open free agency →" />
      </div>
      <p className={dy.intro}>
        A pick signs on the rookie scale — no haggling — and can take you past the cap up to the {APRON_DP} apron. A full
        roster has to waive someone first (Front office, below).
      </p>
      <div className={dy.list}>
        {keys.map(k => {
          const scale = rookieScale(cardOf(k));
          const over = pay + scale.dp > APRON_DP;
          return (
            <div key={k} className={dy.draftRow}>
              <PlayerCell cardKey={k} age={ageOf(d, k)} />
              <span className={styles.muted}>pick #{d.rights[k]?.pick}</span>
              <span className={dy.rowAsk}><strong>{scale.dp}</strong> DP × {scale.years}</span>
              <span className={dy.clockActions}>
                <button type="button" className={styles.primary} disabled={full || over} onClick={() => moves.signRookie(k)} title={full ? 'Your roster is full' : over ? 'Past the apron' : ''}>Sign</button>
                <button type="button" className={styles.ghost} onClick={() => moves.renounce(k)}>Renounce</button>
              </span>
            </div>
          );
        })}
        {!keys.length && <div className={styles.muted}>No picks left to sign.</div>}
      </div>
    </section>
  );
}

// ── Free agency and the preseason ───────────────────────────────────────────

const SORTS = {
  salary: (a, b) => (b.card.salary ?? 0) - (a.card.salary ?? 0),
  ask: (a, b) => a.ask - b.ask || (b.card.salary ?? 0) - (a.card.salary ?? 0),
  rival: (a, b) => Number(Boolean(b.rival)) - Number(Boolean(a.rival)) || (b.card.salary ?? 0) - (a.card.salary ?? 0),
};

export function FreeAgency({ d, moves }) {
  const { ask } = useDialogs();
  const me = d.humanId;
  const pre = d.phase === DPHASE.preseason;
  const day = d.fa?.day ?? 1;
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState('');
  const [fitOnly, setFitOnly] = useState(false);
  const [sort, setSort] = useState('salary');
  const [limit, setLimit] = useState(60);
  const [sel, setSel] = useState(null);

  const market = useMemo(() => {
    const s = search.trim().toLowerCase();
    return freeAgentKeys(d)
      .map(k => quote(d, me, k))
      .filter(q => q.card
        && (!s || q.card.name.toLowerCase().includes(s))
        && (!pos || String(q.card.pos ?? '').includes(pos))
        && (!fitOnly || q.ask <= q.room || q.ask <= MIN_DP))
      .sort(SORTS[sort]);
  }, [d, me, search, pos, fitOnly, sort]);
  const selected = sel && freeAgentKeys(d).includes(sel) ? sel : null;
  const bids = Object.keys(d.fa?.rivals ?? {}).length;
  const problem = rosterProblem(d, me);
  const lastDay = day >= FA_DAYS;

  // With friends the week is SEALED BIDS (BidPanel), and it turns when every coach is ready.
  const sealed = moves.friends && !pre;
  const confirmWeek = async () => sealed || !(bids && lastDay) || ask({
    title: 'Close free agency?',
    body: 'Every rival offer still standing signs, then the AI teams fill out their rosters from whoever is left.',
    confirmLabel: 'Close it',
  });
  const myBids = moves.bids ?? [];

  return (
    <section className={styles.panel}>
      <div className={dy.panelHead}>
        <h3 className={styles.panelTitle}>{pre ? `Preseason — Year ${d.year}` : `Free agency — week ${day} of ${FA_DAYS}`}</h3>
        <span className={dy.clockActions}>
          {!pre && (
            <PhaseButton
              moves={moves}
              confirm={confirmWeek}
              onDone={() => { setSel(null); moves.nextWeek(); }}
              label={lastDay ? 'Close free agency →' : 'Next week →'}
            />
          )}
          {pre && problem && (
            <button type="button" className={styles.ghost} onClick={moves.fill}>
              Fill to {MIN_ROSTER} with the cheapest
            </button>
          )}
          {/* With friends a coach still short when everyone is ready is filled with the cheapest. */}
          {pre && <PhaseButton moves={moves} disabled={!moves.friends && Boolean(problem)} onDone={moves.startSeason} label={`Start Year ${d.year} →`} />}
        </span>
      </div>
      <p className={dy.intro}>
        {pre
          ? `${d.fa ? 'Free agency has closed; whoever is left signs for less. ' : ''}You need ${MIN_ROSTER}–${MAX_ROSTER} players to start the season.`
          : sealed
            ? `Sealed bids: no coach sees another's. Bid for anyone who fits — up to ten a week — and when every coach is ready the week turns: each free agent takes the best deal by his own lights, a coach's or an AI team's (a Ring Chaser takes less from a contender), and every unsigned player's price drops 10%. ${bids ? `${plural(bids, 'AI offer')} out this week.` : ''}`
            : `The AI teams bid too, and every rival offer still on the table at the end of the week signs. To take a player from them your deal has to beat theirs — as HE sees it, so a Ring Chaser takes less from a contender. Every unsigned player's price drops 10% a week. ${bids ? `${plural(bids, 'rival offer')} out this week.` : ''}`}
      </p>
      {pre && (
        <div className={`${dy.ready} ${problem ? dy.readyBad : ''}`}>
          {problem ? `You have ${problem}.` : `Ready: ${rosterKeys(d, me).length} players, ${payroll(d, me)} DP.`}
        </div>
      )}
      {sealed && (
        <div className={dy.bids}>
          <span className={styles.label}>Your sealed bids · week {day}</span>
          {myBids.length
            ? myBids.map(b => (
              <button key={b.key} type="button" className={dy.bidChip} onClick={() => setSel(b.key)}>
                {cardOf(b.key)?.name ?? b.key} · {b.dp} × {b.years}
              </button>
            ))
            : <span className={styles.muted}>None yet — pick a free agent to bid.</span>}
        </div>
      )}

      <div className={dy.split}>
        <div>
          <div className={dy.filters}>
            <input type="search" placeholder="Search free agents" value={search} onChange={e => setSearch(e.target.value)} />
            <select value={pos} onChange={e => setPos(e.target.value)}>
              <option value="">All positions</option>
              {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={sort} onChange={e => setSort(e.target.value)}>
              <option value="salary">Best first</option>
              <option value="ask">Cheapest first</option>
              <option value="rival">Rival offers first</option>
            </select>
            <label className={dy.toggle}>
              <input type="checkbox" checked={fitOnly} onChange={e => setFitOnly(e.target.checked)} /> Only who fits
            </label>
          </div>
          <div className={dy.list}>
            {market.slice(0, limit).map(q => (
              <MarketRow key={q.key} d={d} cardKey={q.key} on={q.key === selected} onClick={() => setSel(q.key)} showRival={!pre} />
            ))}
            {!market.length && <div className={styles.muted}>Nobody matches.</div>}
            {market.length > limit && (
              <button type="button" className={`${styles.ghost} ${dy.more}`} onClick={() => setLimit(l => l + 60)}>Show more</button>
            )}
          </div>
        </div>
        {selected
          ? sealed
            ? <BidPanel key={`${selected}:${day}:${myBids.find(b => b.key === selected)?.dp ?? ''}`} d={d} cardKey={selected} moves={moves} onClose={() => setSel(null)} />
            : <Negotiator key={`${selected}:${day}`} d={d} cardKey={selected} moves={moves} onClose={() => setSel(null)} />
          : <div className={dy.negoEmpty}>{sealed ? 'Pick a free agent to bid for.' : 'Pick a free agent to talk terms.'}</div>}
      </div>
    </section>
  );
}

// ── The trade desk ──────────────────────────────────────────────────────────

const VERDICT = {
  accept: { text: 'They would do this.', mood: 'mood_close' },
  close: { text: 'Close — they want a little more. Ask what it would take.', mood: 'mood_apart' },
  reject: { text: 'Not interested.', mood: 'mood_insulted' },
};

function TradeSide({ d, title, rows, picks = [], picked, pickedPicks = [], onToggle, onTogglePick, teamId }) {
  return (
    <div>
      <div className={styles.label}>{title}</div>
      <div className={dy.list}>
        {rows.map(k => (
          <button key={k.key} type="button" className={`${dy.row} ${picked.includes(k.key) ? dy.rowOn : ''}`} onClick={() => onToggle(k.key)}>
            <PlayerCell cardKey={k.key} age={ageOf(d, k.key)} />
            <span className={dy.rowAsk}>{k.dp} × {k.years}</span>
            <span className={styles.muted} title="What they value him at">{Math.round(tradeValue(d, k.key, teamId))}</span>
            <span>{picked.includes(k.key) ? '✓' : ''}</span>
          </button>
        ))}
        {picks.map(id => (
          <button key={id} type="button" className={`${dy.row} ${pickedPicks.includes(id) ? dy.rowOn : ''}`} onClick={() => onTogglePick(id)}>
            <span className={dy.player}>
              <span className={dy.playerText}>
                <span className={dy.playerName}>🎟️ {pickLabel(d, id)}</span>
                <span className={dy.playerSub}>draft pick</span>
              </span>
            </span>
            <span />
            <span className={styles.muted} title="What they value it at">{Math.round(pickValue(d, id, teamId))}</span>
            <span>{pickedPicks.includes(id) ? '✓' : ''}</span>
          </button>
        ))}
        {!rows.length && !picks.length && <div className={styles.muted}>Nothing to trade.</div>}
      </div>
    </div>
  );
}

/**
 * Trades with the AI, between seasons. You pick a partner and players on
 * both sides; the verdict is evaluateTrade's, live, and the deal goes through
 * only when they would take it.
 */
export function TradeDesk({ d, moves, defaultOpen = false }) {
  const me = d.humanId;
  // With friends the other coaches are partners too — an offer they answer.
  const partners = d.teams.filter(t => t.id !== me && (moves.friends || !t.human));
  const [open, setOpen] = useState(defaultOpen);
  const [to, setTo] = useState(partners[0]?.id ?? null);
  const [give, setGive] = useState([]);
  const [get, setGet] = useState([]);
  const [givePicks, setGivePicks] = useState([]);
  const [getPicks, setGetPicks] = useState([]);
  const [hint, setHint] = useState(null);
  if (!tradesOpen(d) || !partners.length) return null;
  const myPicks = picksOf(d, me);
  const theirPicks = picksOf(d, to);
  const deal = {
    from: me,
    to,
    give: give.filter(k => d.contracts[k]?.teamId === me),
    get: get.filter(k => d.contracts[k]?.teamId === to),
    givePicks: givePicks.filter(id => myPicks.includes(id)),
    getPicks: getPicks.filter(id => theirPicks.includes(id)),
  };
  const anything = deal.give.length + deal.get.length + deal.givePicks.length + deal.getPicks.length > 0;
  const clear = () => { setGive([]); setGet([]); setGivePicks([]); setGetPicks([]); setHint(null); };
  const ev = evaluateTrade(d, deal);
  const toggle = (list, set) => key => { set(list.includes(key) ? list.filter(k => k !== key) : [...list, key]); setHint(null); };
  const partner = teamOf(d, to);
  const say = ev.verdict === 'illegal' ? { text: ev.problems[0], mood: 'mood_walked' } : VERDICT[ev.verdict];
  // A coach answers for themselves: no AI verdict, only the rules.
  const coach = Boolean(partner?.human);
  return (
    <section className={styles.panel}>
      <div className={dy.panelHead}>
        <h3 className={styles.panelTitle}>Trades</h3>
        <button type="button" className={dy.linkBtn} onClick={() => setOpen(v => !v)}>{open ? 'Close the trade desk' : 'Open the trade desk'}</button>
      </div>
      {d.phase === DPHASE.season && d.season && (
        <p className={dy.intro}>
          Trade deadline: the end of round {tradeDeadlineRound(d.season)} of the regular season — 60% of the way through,
          where the NBA's falls. A team in season keeps {MIN_ROSTER} players.
        </p>
      )}
      {open && (
        <>
          <p className={dy.intro}>
            The AI trades on a front office's logic (after Bill Simmons' Trade Value): a star is worth more than two halves
            of one, years of control are worth paying for, a cheap contract is an asset and an overpaid one a burden, a
            position it is short at is worth more, and a rebuilding team wants picks where a contender wants players.
            Nobody gets better or worse with age — it only matters when a player might retire before his deal is out.
            It wants to win a deal by a little. Contracts move with the players; both rosters stay at {MAX_ROSTER} or fewer
            and neither payroll may grow past the {APRON_DP} apron. Picks in the next two drafts can be traded too.
          </p>
          {moves.friends && (
            <p className={dy.intro}>
              A trade with another coach is an offer they answer; the commissioner can veto it until the next phase.
            </p>
          )}
          <div className={dy.filters}>
            {partners.map(t => (
              <button
                key={t.id} type="button" className={`${dy.yearBtn} ${t.id === to ? dy.yearOn : ''}`}
                onClick={() => { setTo(t.id); setGet([]); setGetPicks([]); setHint(null); }}
              >
                {t.abbr ?? t.name}
              </button>
            ))}
          </div>
          <div className={dy.split}>
            <TradeSide
              d={d} title="You send" rows={contractsOf(d, me)} picks={myPicks} teamId={to}
              picked={deal.give} pickedPicks={deal.givePicks} onToggle={toggle(give, setGive)} onTogglePick={toggle(givePicks, setGivePicks)}
            />
            <TradeSide
              d={d} title={`${partner?.name ?? 'They'} send`} rows={contractsOf(d, to)} picks={theirPicks} teamId={to}
              picked={deal.get} pickedPicks={deal.getPicks} onToggle={toggle(get, setGet)} onTogglePick={toggle(getPicks, setGetPicks)}
            />
          </div>
          {anything && say && (!coach || ev.verdict === 'illegal') && (
            <div className={`${dy.mood} ${dy[say.mood] ?? ''}`}>
              {say.text}
              {ev.verdict !== 'illegal' && <span className={styles.muted}> · they value it {Math.round(ev.valueIn)} in, {Math.round(ev.valueOut)} out</span>}
            </div>
          )}
          {hint && (
            <div className={dy.rival}>
              {hint.key || hint.pick
                ? (
                  <>
                    Add <strong>{hint.key ? cardOf(hint.key)?.name : pickLabel(d, hint.pick)}</strong> and they would take it.{' '}
                    <button
                      type="button" className={dy.linkBtn}
                      onClick={() => { if (hint.key) setGive([...give, hint.key]); else setGivePicks([...givePicks, hint.pick]); setHint(null); }}
                    >
                      Add {hint.key ? 'him' : 'it'}
                    </button>
                  </>
                )
                : 'Nothing of yours on its own gets this done — try another piece.'}
            </div>
          )}
          <div className={dy.negoActions}>
            {coach ? (
              <button
                type="button" className={styles.primary} disabled={!anything || ev.verdict === 'illegal'}
                onClick={async () => { if (await moves.propose(deal)) clear(); }}
              >
                Offer it to {partner.name}
              </button>
            ) : (
              <>
                <button
                  type="button" className={styles.primary} disabled={ev.verdict !== 'accept'}
                  onClick={async () => { if (await moves.trade(deal)) clear(); }}
                >
                  Make the trade
                </button>
                <button
                  type="button" className={styles.ghost}
                  disabled={!(deal.get.length || deal.getPicks.length) || ev.verdict === 'accept' || ev.verdict === 'illegal'}
                  onClick={() => setHint(suggestSweetener(d, deal) ?? { none: true })}
                >
                  What would it take?
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ── The league wire ─────────────────────────────────────────────────────────

export function NewsFeed({ d }) {
  const [all, setAll] = useState(false);
  const news = d.news ?? [];
  if (!news.length) return null;
  return (
    <section className={styles.panel}>
      <div className={dy.panelHead}>
        <h3 className={styles.panelTitle}>League wire</h3>
        {news.length > 8 && <button type="button" className={dy.linkBtn} onClick={() => setAll(v => !v)}>{all ? 'Less' : 'More'}</button>}
      </div>
      <ul className={dy.news}>
        {news.slice(0, all ? news.length : 8).map((n, i) => (
          <li key={`${n.year}-${i}`}><span className={dy.newsYear}>Y{n.year}</span>{n.text}</li>
        ))}
      </ul>
    </section>
  );
}
