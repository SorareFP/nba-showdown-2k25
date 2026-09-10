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
import { RARITY_CONFIG } from '../game/rarity.js';
import { getCardByKey } from '../game/cardSets.js';
import {
  prepareSearch, searchQuotes, seasonText, quoteKey, searchHitsNeverCard, AUTO_REJECT_MESSAGE,
  OPEN_REQUEST_LIMIT, REQUEST_STATUS, OPEN_STATUSES, coverageText,
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

export default function FreeAgentsPanel({ uid, onChanged = () => {}, loadIndex = () => import('../../card-data/generated/quote-index.json') }) {
  const { toast, ask } = useDialogs();
  const lightbox = useLightbox();
  const [index, setIndex] = useState(null);
  const [text, setText] = useState('');
  const [mine, setMine] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let live = true;
    loadIndex()
      .then(m => { if (live) setIndex(prepareSearch((m.default ?? m).rows)); })
      .catch(() => { if (live) setIndex([]); });
    return () => { live = false; };
  }, [loadIndex]);

  const refreshMine = useCallback(async () => {
    try { setMine(await myCardRequests(uid)); } catch { setMine([]); }
  }, [uid]);
  useEffect(() => { refreshMine(); }, [refreshMine]);

  const results = useMemo(() => (index ? searchQuotes(index, text) : []), [index, text]);
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
      toast(`Signed ${r.name}. The card is in your collection.`);
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
          placeholder="Search a player: Michael Jordan, Dennis Rodman, Steve Nash…"
          aria-label="Search a player"
        />
        {index == null ? (
          <Skeleton rows={3} height={44} label="Loading the archive" />
        ) : never ? (
          <div className={s.never}>{AUTO_REJECT_MESSAGE}</div>
        ) : text.trim().length < 3 ? (
          <p className={s.muted}>Type at least three letters.</p>
        ) : results.length === 0 ? (
          <p className={s.muted}>Nobody by that name in the archive, or every one of their seasons already has a card.</p>
        ) : (
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
                        <span className={s.salary}>${q.salary.toLocaleString()}</span>
                        <span className={s.rarity} style={{ color: rc?.color, background: rc?.bg }}>{rc?.label ?? q.rarity}</span>
                        <span className={s.price}>{coins(q.price)}</span>
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
                  <span className={`${s.status} ${s[r.status] ?? ''}`}>{STATUS_TEXT[r.status] ?? r.status}</span>
                  {bill && (
                    <span className={s.muted}>
                      ${bill.salary?.toLocaleString()} · {RARITY_CONFIG[bill.rarity]?.label ?? bill.rarity} · {coins(bill.price)}
                      {r.invoice ? '' : ' (estimate)'}
                    </span>
                  )}
                  {r.status === REQUEST_STATUS.rejected && r.reason && <span className={s.reason}>{r.reason}</span>}
                  {HAS_CARD.includes(r.status) && (
                    <div className={s.reqActions}>
                      <button className={s.ghostBtn} onClick={() => see(r)}>See card</button>
                      {r.status === REQUEST_STATUS.invoiced && (
                        <>
                          <button className={s.askBtn} disabled={busy === r.id} onClick={() => sign(r)}>
                            {busy === r.id ? 'Signing…' : `Sign for ${coins(r.invoice?.price)}`}
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
