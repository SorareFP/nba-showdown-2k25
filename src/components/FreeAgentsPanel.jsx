// FREE AGENTS: ask for any player's season (docs/plans/2026-09-10-free-agents-design.md).
//
// The quote comes from the precomputed index, loaded only when this panel
// opens. It shows what the user said it should: "return only a salary,
// rarity and an invoice cost". The request itself is priced again on the
// server; this panel only asks.
//
// When the card is made the request becomes an invoice at the finished card's
// price: See card (the full face, art and chart), Sign, or Decline (the user,
// 2026-09-10: "make sure I can reject the invoice when the card is made. When
// it is ready, it should say 'see card' on the site").
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDialogs } from '../ui/dialogs.jsx';
import { useLightbox } from './CardLightbox.jsx';
import { RARITY_CONFIG, RARITY_SALARY } from '../game/rarity.js';
import { getCardByKey } from '../game/cardSets.js';
import { TEAMS, HISTORICAL_TEAMS, WNBA_TEAMS, WNBA_HISTORICAL_TEAMS, canonicalTeam } from '../cards/teams.js';
import {
  prepareSearch, searchQuotes, seasonText, quoteKey, searchHitsNeverCard, AUTO_REJECT_MESSAGE,
  OPEN_REQUEST_LIMIT, REQUEST_STATUS, OPEN_STATUSES, coverageText, isGift, signPriceText,
  quoteFilterOptions, countQuotes, canBrowse,
} from '../game/freeAgents.js';
import { requestCard, myCardRequests, signFreeAgent, declineCardRequest } from '../firebase/freeAgents.js';
import Skeleton from '../ui/Skeleton.jsx';
import s from './FreeAgentsPanel.module.css';

const STATUS_TEXT = {
  [REQUEST_STATUS.requested]: 'Waiting',
  [REQUEST_STATUS.built]: 'Being made',
  [REQUEST_STATUS.invoiced]: 'Ready to sign',
  [REQUEST_STATUS.signed]: 'Signed',
  [REQUEST_STATUS.gifted]: 'Gifted',
  [REQUEST_STATUS.rejected]: 'Rejected',
  [REQUEST_STATUS.declined]: 'Declined',
};
/** Once one of these, the card exists and can be looked at. */
const HAS_CARD = [REQUEST_STATUS.invoiced, REQUEST_STATUS.signed, REQUEST_STATUS.gifted];
const coins = n => `🪙 ${Number(n ?? 0).toLocaleString()}`;

// THE LOADER LIVES OUT HERE, ONE FUNCTION FOR EVERY RENDER. As a default
// parameter it was a new function each render, and the effect that loads the
// index depends on it: load → setIndex → render → new loader → load again,
// forever, rebuilding 22,000 search entries and redrawing every result row
// each time. A desktop shrugged it off; a phone ran out of room and reloaded
// the tab as soon as a name was typed (the user, 2026-09-10).
const loadQuoteIndex = () => import('../../card-data/generated/quote-index.json');

// ── THE FILTERS (2026-09-16) ─────────────────────────────────────────────────
const NO_FILTERS = { season: null, team: null, salaryMin: null, salaryMax: null };
// Salary and rarity are one scale (rarity.js), so the salary steps are the
// rarity floors, said both ways: "$420 and up" is "Uncommon and up".
const bandLabel = r => RARITY_CONFIG[r]?.label ?? r;
const SALARY_FROM = [
  { v: RARITY_SALARY.uncommon, label: `$${RARITY_SALARY.uncommon} and up · ${bandLabel('uncommon')} and up` },
  { v: RARITY_SALARY.rare, label: `$${RARITY_SALARY.rare} and up · ${bandLabel('rare')} and up` },
  { v: RARITY_SALARY['super-rare'], label: `$${RARITY_SALARY['super-rare']} and up · ${bandLabel('super-rare')} and up` },
  { v: RARITY_SALARY.legendary, label: `$${RARITY_SALARY.legendary.toLocaleString()} and up · ${bandLabel('legendary')}` },
];
const SALARY_TO = [
  { v: RARITY_SALARY.uncommon - 1, label: `under $${RARITY_SALARY.uncommon} · ${bandLabel('common')} only` },
  { v: RARITY_SALARY.rare - 1, label: `under $${RARITY_SALARY.rare} · up to ${bandLabel('uncommon')}` },
  { v: RARITY_SALARY['super-rare'] - 1, label: `under $${RARITY_SALARY['super-rare']} · up to ${bandLabel('rare')}` },
  { v: RARITY_SALARY.legendary - 1, label: `under $${RARITY_SALARY.legendary.toLocaleString()} · up to ${bandLabel('super-rare')}` },
];
/** A team's name beside its letters when we know it; the two leagues share letters, so the league picks the map. */
function teamLabel(league, abbr) {
  const t = league === 'wnba'
    ? (WNBA_TEAMS[abbr] ?? WNBA_HISTORICAL_TEAMS[abbr])
    : (TEAMS[canonicalTeam(abbr)] ?? HISTORICAL_TEAMS[abbr]);
  return t ? `${abbr} · ${t.city} ${t.name}` : abbr;
}

export default function FreeAgentsPanel({ uid, onChanged = () => {}, loadIndex = loadQuoteIndex }) {
  const { toast, ask } = useDialogs();
  const lightbox = useLightbox();
  const [index, setIndex] = useState(null);
  const [options, setOptions] = useState(null);       // the seasons and teams the index holds
  const [filters, setFilters] = useState(NO_FILTERS);
  const [text, setText] = useState('');
  const [mine, setMine] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let live = true;
    loadIndex()
      .then(m => {
        if (!live) return;
        const rows = (m.default ?? m).rows;
        // The calibration's spread rides with each row: the quote says how sure it is.
        setIndex(prepareSearch(rows, (m.default ?? m).calibration ?? null));
        setOptions(quoteFilterOptions(rows));
      })
      .catch(() => { if (live) setIndex([]); });
    return () => { live = false; };
  }, [loadIndex]);

  const refreshMine = useCallback(async () => {
    try { setMine(await myCardRequests(uid)); } catch { setMine([]); }
  }, [uid]);
  useEffect(() => { refreshMine(); }, [refreshMine]);

  const results = useMemo(() => (index ? searchQuotes(index, text, { filters }) : []), [index, text, filters]);
  const total = useMemo(() => (index && results.length ? countQuotes(index, text, filters) : 0), [index, text, filters, results.length]);
  const setFilter = (key, value) => setFilters(f => ({ ...f, [key]: value }));
  const filtering = canBrowse(filters) || filters.salaryMin != null || filters.salaryMax != null;
  const never = searchHitsNeverCard(text);
  const open = (mine ?? []).filter(r => OPEN_STATUSES.includes(r.status));
  const asked = new Set(open.map(r => quoteKey(r.bbrefId, r.season, r.playoffs)));
  const full = open.length >= OPEN_REQUEST_LIMIT;

  const askFor = async q => {
    const key = quoteKey(q.bbrefId, q.season, q.playoffs);
    setBusy(key);
    try {
      await requestCard({ bbrefId: q.bbrefId, season: q.season, playoffs: q.playoffs });
      toast(`Requested: ${q.name}, ${seasonText(q)}.`);
      await refreshMine();
    } catch (e) {
      toast(e?.message ?? 'That request did not go through.', { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const see = r => {
    const card = getCardByKey(r.cardKey);
    if (!card) { toast('That card is on its way. Reload the page to pick up the latest cards.', { tone: 'error' }); return; }
    lightbox?.open('player', card);
  };

  const sign = async r => {
    setBusy(r.id);
    try {
      await signFreeAgent({ id: r.id });
      toast(isGift(r)
        ? `Signed ${r.name}, a gift. The card is in your collection, locked to it.`
        : `Signed ${r.name}. The card is in your collection.`);
      await refreshMine();
      onChanged();
    } catch (e) {
      toast(e?.message ?? 'That signing did not go through.', { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const decline = async r => {
    const yes = await ask({
      title: `Decline ${r.name}?`,
      body: 'The card stays in packs for everyone. Declining frees one of your request places.',
      confirmLabel: 'Decline',
      cancelLabel: 'Keep it',
    });
    if (!yes) return;
    setBusy(r.id);
    try {
      await declineCardRequest({ id: r.id });
      await refreshMine();
    } catch (e) {
      toast(e?.message ?? 'That did not go through.', { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={s.wrap}>
      <header className={s.head}>
        <h2 className={s.title}>Free Agents</h2>
        <p className={s.sub}>
          Ask for any player's season: {coverageText()}. Older seasons aren't in our stats archive yet.
          We build the card, and when it is ready you can sign it for its price. Up to {OPEN_REQUEST_LIMIT} requests
          can wait at once.
        </p>
      </header>

      <section className={s.panel}>
        <input
          className={s.search}
          type="search"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Search a player: Michael Jordan, Lisa Leslie, Steve Nash…"
          aria-label="Search a player"
        />
        {/* THE FILTERS: a season or a team opens the list without a name. */}
        <div className={s.filters}>
          <select className={s.select} aria-label="Season" value={filters.season ?? ''} onChange={e => setFilter('season', e.target.value ? Number(e.target.value) : null)}>
            <option value="">Any season</option>
            {(options?.seasons ?? []).map(y => <option key={y} value={y}>{seasonText({ season: y })}</option>)}
          </select>
          <select className={s.select} aria-label="Team" value={filters.team ?? ''} onChange={e => setFilter('team', e.target.value || null)}>
            <option value="">Any team</option>
            {options?.teams.nba.length > 0 && (
              <optgroup label="NBA">
                {options.teams.nba.map(t => <option key={`nba:${t}`} value={`nba:${t}`}>{teamLabel('nba', t)}</option>)}
              </optgroup>
            )}
            {options?.teams.wnba.length > 0 && (
              <optgroup label="WNBA">
                {options.teams.wnba.map(t => <option key={`wnba:${t}`} value={`wnba:${t}`}>{teamLabel('wnba', t)}</option>)}
              </optgroup>
            )}
          </select>
          <select className={s.select} aria-label="Salary at least" value={filters.salaryMin ?? ''} onChange={e => setFilter('salaryMin', e.target.value ? Number(e.target.value) : null)}>
            <option value="">Any salary</option>
            {SALARY_FROM.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <select className={s.select} aria-label="Salary at most" value={filters.salaryMax ?? ''} onChange={e => setFilter('salaryMax', e.target.value ? Number(e.target.value) : null)}>
            <option value="">No ceiling</option>
            {SALARY_TO.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          {filtering && <button type="button" className={s.ghostBtn} onClick={() => setFilters(NO_FILTERS)}>Clear</button>}
        </div>
        {index == null ? (
          <Skeleton rows={3} height={44} label="Loading the archive" />
        ) : never ? (
          <div className={s.never}>{AUTO_REJECT_MESSAGE}</div>
        ) : text.trim().length < 3 && !canBrowse(filters) ? (
          <p className={s.muted}>Type at least three letters, or pick a season or a team.</p>
        ) : results.length === 0 ? (
          <p className={s.muted}>
            {text.trim().length >= 3
              ? 'Nobody by that name in the archive with those filters, or every one of their seasons already has a card.'
              : 'Nobody in the archive matches those filters.'}
          </p>
        ) : (
          <>
          {total > results.length && (
            <p className={s.muted}>Showing {results.length} of {total} players, best-paid first — add a name or a salary to narrow it.</p>
          )}
          <p className={s.muted}>
            Salaries and prices are estimates from the season's tables; the card is built from its real game log, and most finish within about
            ${results[0]?.seasons?.[0]?.spread ?? 120} of the quote — sometimes a band up or down. You are billed at the finished card's price.
          </p>
          <ul className={s.players}>
            {results.map(p => (
              <li key={p.bbrefId} className={s.player}>
                <div className={s.playerName}>{p.name}</div>
                <ul className={s.seasons}>
                  {p.seasons.map(q => {
                    const key = quoteKey(q.bbrefId, q.season, q.playoffs);
                    const rc = RARITY_CONFIG[q.rarity];
                    const already = asked.has(key);
                    return (
                      <li key={key} className={s.season}>
                        <span className={s.when}>{seasonText(q)}</span>
                        <span className={s.muted}>{q.team}</span>
                        <span className={s.salary} title={q.spread ? `An estimate: most cards finish within about $${q.spread} of it` : undefined}>≈ ${q.salary.toLocaleString()}</span>
                        <span className={s.rarity} style={{ color: rc?.color, background: rc?.bg }}>{rc?.label ?? q.rarity}</span>
                        {q.uncertain && (
                          <span className={s.muted} title="The bands one spread either side of the estimate">
                            or {RARITY_CONFIG[q.rarityLow]?.label ?? q.rarityLow}–{RARITY_CONFIG[q.rarityHigh]?.label ?? q.rarityHigh}
                          </span>
                        )}
                        <span className={s.price} title="You pay the finished card's price, not the estimate">≈ {coins(q.price)}</span>
                        <button
                          className={s.askBtn}
                          disabled={busy === key || already || (full && !already)}
                          onClick={() => askFor(q)}
                          title={full && !already ? `You have ${OPEN_REQUEST_LIMIT} requests open` : undefined}
                        >
                          {already ? 'Requested' : busy === key ? 'Asking…' : 'Request'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          </>
        )}
      </section>

      <section className={s.panel}>
        <div className={s.panelHead}>
          <h3 className={s.panelTitle}>Your requests</h3>
          <span className={s.muted}>{open.length}/{OPEN_REQUEST_LIMIT} open</span>
        </div>
        {mine == null ? (
          <Skeleton rows={2} height={40} label="Loading your requests" />
        ) : mine.length === 0 ? (
          <p className={s.muted}>Nothing asked for yet.</p>
        ) : (
          <ul className={s.requests}>
            {mine.map(r => {
              const bill = r.invoice ?? r.quote;
              return (
                <li key={r.id} className={s.request}>
                  <span className={s.reqName}>{r.name}, {seasonText(r)}</span>
                  <span className={`${s.status} ${s[r.status] ?? ''}`}>
                    {isGift(r) && r.status === REQUEST_STATUS.invoiced ? '🎁 Gift — ready to sign' : STATUS_TEXT[r.status] ?? r.status}
                  </span>
                  {bill && (
                    <span className={s.muted}>
                      ${bill.salary?.toLocaleString()} · {RARITY_CONFIG[bill.rarity]?.label ?? bill.rarity} ·{' '}
                      {r.invoice ? signPriceText(r) : `${coins(bill.price)} (estimate)`}
                    </span>
                  )}
                  {r.status === REQUEST_STATUS.rejected && r.reason && <span className={s.reason}>{r.reason}</span>}
                  {HAS_CARD.includes(r.status) && (
                    <div className={s.reqActions}>
                      <button className={s.ghostBtn} onClick={() => see(r)}>See card</button>
                      {r.status === REQUEST_STATUS.invoiced && (
                        <>
                          <button className={s.askBtn} disabled={busy === r.id} onClick={() => sign(r)}>
                            {busy === r.id ? 'Signing…' : `Sign for ${signPriceText(r)}`}
                          </button>
                          <button className={s.ghostBtn} disabled={busy === r.id} onClick={() => decline(r)}>Decline</button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
