// FREE AGENTS: ask for any player's season (docs/plans/2026-09-10-free-agents-design.md).
//
// The quote comes from the precomputed index, loaded only when this panel
// opens. It shows what the user said it should: "return only a salary,
// rarity and an invoice cost". The request itself is priced again on the
// server; this panel only asks.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDialogs } from '../ui/dialogs.jsx';
import { RARITY_CONFIG } from '../game/rarity.js';
import {
  prepareSearch, searchQuotes, seasonText, quoteKey, searchHitsNeverCard, AUTO_REJECT_MESSAGE,
  OPEN_REQUEST_LIMIT, REQUEST_STATUS, coverageText,
} from '../game/freeAgents.js';
import { requestCard, myCardRequests } from '../firebase/freeAgents.js';
import Skeleton from '../ui/Skeleton.jsx';
import s from './FreeAgentsPanel.module.css';

const STATUS_TEXT = {
  [REQUEST_STATUS.requested]: 'Waiting',
  [REQUEST_STATUS.rejected]: 'Rejected',
  [REQUEST_STATUS.invoiced]: 'Ready to sign',
  [REQUEST_STATUS.signed]: 'Signed',
  [REQUEST_STATUS.gifted]: 'Gifted',
};
const coins = n => `🪙 ${Number(n ?? 0).toLocaleString()}`;

export default function FreeAgentsPanel({ uid, loadIndex = () => import('../../card-data/generated/quote-index.json') }) {
  const { toast } = useDialogs();
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
  const waiting = (mine ?? []).filter(r => r.status === REQUEST_STATUS.requested);
  const asked = new Set(waiting.map(r => quoteKey(r.bbrefId, r.season, r.playoffs)));
  const full = waiting.length >= OPEN_REQUEST_LIMIT;

  const ask = async q => {
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
                          onClick={() => ask(q)}
                          title={full && !already ? `You have ${OPEN_REQUEST_LIMIT} requests waiting` : undefined}
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
          <span className={s.muted}>{waiting.length}/{OPEN_REQUEST_LIMIT} waiting</span>
        </div>
        {mine == null ? (
          <Skeleton rows={2} height={40} label="Loading your requests" />
        ) : mine.length === 0 ? (
          <p className={s.muted}>Nothing asked for yet.</p>
        ) : (
          <ul className={s.requests}>
            {mine.map(r => (
              <li key={r.id} className={s.request}>
                <span className={s.reqName}>{r.name}, {seasonText(r)}</span>
                <span className={`${s.status} ${s[r.status] ?? ''}`}>{STATUS_TEXT[r.status] ?? r.status}</span>
                {r.quote && <span className={s.muted}>${r.quote.salary?.toLocaleString()} · {RARITY_CONFIG[r.quote.rarity]?.label ?? r.quote.rarity} · {coins(r.quote.price)}</span>}
                {r.status === REQUEST_STATUS.rejected && r.reason && <span className={s.reason}>{r.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
