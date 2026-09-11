// THE REQUEST QUEUE, in the Card Studio. Free Agent requests come in here
// (the user, 2026-09-10: "Card requests come in through the Card Studio")
// and each one is answered from here:
//
//   Waiting     → Build card (or Reject: "I'll need a reject button for
//                 entries I don't want to make or that don't make sense")
//   Being made  → add its photo, Export face, deploy, then Send invoice or Gift
//   Invoiced    → the requester signs or declines on the site
//
// Sign-in is the admin's own Google account, through the same Firebase app
// the game uses; every change goes through admin-only callables
// (functions/index.js checks ADMIN_EMAILS). Building runs on this dev server
// (scripts/cardgen/buildFreeAgent.mjs, through studioServerPlugin.js).
//
// BUILD RELOADS THIS PAGE. Writing the card file makes Vite reload everything
// that imports the card sets, so the build is recorded on the request first,
// the file is written last, and the panel reopens where it was
// (sessionStorage), with a note saying what was built.
import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../firebase/config.js';
import {
  listCardRequests, rejectCardRequest, markCardRequestBuilt, invoiceCardRequest, giftCardRequest, regiftCardRequest,
} from '../firebase/freeAgents.js';
import { buildFreeAgentCard, commitFreeAgent, freeAgentFaceExists, exportFreeAgentFace } from './api.js';
import {
  seasonText, QUICK_REJECT_REASONS, REJECT_REASON_MAX, FREE_AGENT_SETS, REQUEST_STATUS, isGift, signPriceText,
} from '../game/freeAgents.js';
import s from './RequestsPanel.module.css';

const VIEWS = [
  [REQUEST_STATUS.requested, 'Waiting'],
  [REQUEST_STATUS.built, 'Being made'],
  [REQUEST_STATUS.invoiced, 'Invoiced'],
  [REQUEST_STATUS.signed, 'Signed'],
  [REQUEST_STATUS.gifted, 'Gifted'],
  [REQUEST_STATUS.declined, 'Declined'],
  [REQUEST_STATUS.rejected, 'Rejected'],
];
/** Sets the builder can build into today (scripts/cardgen/buildFreeAgent.mjs). */
const BUILDABLE = new Set([
  'rookie', 'super-season', 'summer-standouts', 'throwbacks',
  'wnba-rookie', 'wnba-super-season', 'wnba-throwbacks',
]);
const VIEW_KEY = 'studio.requests.view';
const NOTE_KEY = 'studio.requests.note';
const coins = n => `🪙 ${Number(n ?? 0).toLocaleString()}`;
const money = n => `$${Number(n ?? 0).toLocaleString()}`;
const cardId = r => String(r.cardKey ?? '').split(':').pop();
const setOf = r => String(r.cardKey ?? '').split(':')[0] || r.quote?.set;
const store = {
  get: k => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
  take: k => { try { const v = sessionStorage.getItem(k); sessionStorage.removeItem(k); return v; } catch { return null; } },
};

export default function RequestsPanel({ onClose }) {
  const [user, setUser] = useState(auth.currentUser);
  const [status, setStatusState] = useState(() => store.get(VIEW_KEY) ?? REQUEST_STATUS.requested);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(() => store.take(NOTE_KEY));
  const [rejecting, setRejecting] = useState(null);   // request id with the reason box open
  const [reason, setReason] = useState('');
  const [confirmGift, setConfirmGift] = useState(null);
  const [confirmRegift, setConfirmRegift] = useState(null);
  const [busy, setBusy] = useState(null);             // `${action}:${id}`
  const [faces, setFaces] = useState({});             // request id -> face exported?

  const setStatus = v => { store.set(VIEW_KEY, v); setStatusState(v); };
  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    setRows(null);
    try {
      setRows(await listCardRequests({ status }));
    } catch (e) {
      setError(e?.message ?? 'Could not load the queue');
      setRows([]);
    }
  }, [user, status]);
  useEffect(() => { load(); }, [load]);

  // Being made: which faces are exported already.
  useEffect(() => {
    if (status !== REQUEST_STATUS.built || !rows?.length) return;
    let live = true;
    Promise.all(rows.map(async r => [r.id, await freeAgentFaceExists(setOf(r), cardId(r)).catch(() => false)]))
      .then(pairs => { if (live) setFaces(Object.fromEntries(pairs)); });
    return () => { live = false; };
  }, [status, rows]);

  const run = async (action, id, fn) => {
    setBusy(`${action}:${id}`);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e?.message ?? `Could not ${action} that request`);
    } finally {
      setBusy(null);
    }
  };
  const drop = id => setRows(list => list.filter(r => r.id !== id));
  const isBusy = (action, id) => busy === `${action}:${id}`;

  const reject = (id, why) => run('reject', id, async () => {
    await rejectCardRequest({ id, reason: why });
    drop(id);
    setRejecting(null);
    setReason('');
  });

  const build = r => run('build', r.id, async () => {
    const out = await buildFreeAgentCard({ id: r.id, bbrefId: r.bbrefId, season: r.season, playoffs: r.playoffs, set: r.quote?.set });
    await markCardRequestBuilt({
      id: r.id, cardKey: out.cardKey,
      built: { salary: out.salary, rarity: out.rarity, price: out.price, set: out.set },
    });
    const label = FREE_AGENT_SETS[out.set]?.label ?? out.set;
    const told = `Built ${out.name}, ${seasonText(r)}: ${money(out.salary)} ${out.rarity}, ${coins(out.price)} ` +
      `(quoted ${coins(r.quote?.price)}). Next: open the ${label} set, give ${out.id} a photo, then Export face.`;
    // The commit reloads this page; the note and the view survive it.
    store.set(NOTE_KEY, told);
    store.set(VIEW_KEY, REQUEST_STATUS.built);
    setNote(told);
    await commitFreeAgent(r.id);
    drop(r.id);
  });

  const exportFace = r => run('export', r.id, async () => {
    await exportFreeAgentFace(setOf(r), cardId(r));
    setFaces(f => ({ ...f, [r.id]: true }));
  });

  const invoice = r => run('invoice', r.id, async () => {
    const out = await invoiceCardRequest({ id: r.id });
    setNote(`Invoice sent: ${r.name} for ${coins(out.invoice?.price)}. It shows on their Free Agents page.`);
    drop(r.id);
  });

  const gift = r => run('gift', r.id, async () => {
    await giftCardRequest({ id: r.id });
    setNote(
      `Gift sent: ${r.name} to ${r.requester ?? 'the requester'}. It waits on their Free Agents page at ` +
      '🎁 0 coins, and signing it gives them one locked copy.'
    );
    setConfirmGift(null);
    drop(r.id);
  });

  // A gift sent before gifts waited to be signed: the copy was minted on the
  // spot. Take it back and re-send it as a gift to sign.
  const regift = r => run('regift', r.id, async () => {
    const out = await regiftCardRequest({ id: r.id });
    setNote(
      `${r.name}: took back ${out.removed} copy from ${r.requester ?? 'the requester'} and re-sent it as a ` +
      '🎁 0-coin gift. It waits on their Free Agents page to be signed.'
    );
    setConfirmRegift(null);
    drop(r.id);
  });

  const billOf = r => r.invoice ?? r.built ?? r.quote;

  return (
    <div className={s.overlay}>
      <div className={s.box}>
        <header className={s.head}>
          <h2 className={s.title}>Card requests</h2>
          <div className={s.views}>
            {VIEWS.map(([id, label]) => (
              <button key={id} className={`${s.viewBtn} ${status === id ? s.viewOn : ''}`} onClick={() => setStatus(id)}>{label}</button>
            ))}
          </div>
          <span className={s.spacer} />
          {user && <span className={s.muted}>{user.email}</span>}
          {user && <button className={s.ghost} onClick={() => signOut(auth)}>Sign out</button>}
          <button className={s.ghost} onClick={onClose}>Close</button>
        </header>

        {note && (
          <div className={s.note}>
            <span>{note}</span>
            <button className={s.ghost} onClick={() => setNote(null)}>OK</button>
          </div>
        )}
        {status === REQUEST_STATUS.built && (
          <p className={s.steps}>
            For each card: give it a photo in its set, <b>Export face</b>, then deploy (functions and Pages). The
            invoice can only go out once the live game has the card, so <b>Send invoice</b> and <b>Gift</b> say
            "Deploy first" until then.
          </p>
        )}

        {!user ? (
          <div className={s.empty}>
            <p>Sign in with the admin Google account to see the queue.</p>
            <button className={s.primary} onClick={() => signInWithPopup(auth, googleProvider)}>Sign in with Google</button>
          </div>
        ) : (
          <>
            {error && <div className={s.error}>{error}</div>}
            {rows == null ? (
              <p className={s.muted}>Loading…</p>
            ) : rows.length === 0 ? (
              <p className={s.empty}>{status === REQUEST_STATUS.requested ? 'Nothing waiting.' : 'Nothing here.'}</p>
            ) : (
              <div className={s.scroll}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Player</th><th>Season</th><th>Team</th><th>Set</th>
                      <th>{status === REQUEST_STATUS.requested ? 'Quote' : 'Card'}</th><th>Asked by</th><th>When</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const bill = billOf(r);
                      const set = setOf(r);
                      return (
                        <tr key={r.id}>
                          <td className={s.name}>
                            {r.name}
                            {r.cardKey && <div className={s.muted}>{r.cardKey}</div>}
                          </td>
                          <td>{seasonText(r)}</td>
                          <td>{r.team}</td>
                          <td>{FREE_AGENT_SETS[set]?.label ?? set}</td>
                          <td>
                            {money(bill?.salary)} · {bill?.rarity} · {r.invoice ? signPriceText(r) : coins(bill?.price)}
                            {r.built && r.quote && r.built.price !== r.quote.price && (
                              <div className={s.muted}>quoted {coins(r.quote.price)}</div>
                            )}
                          </td>
                          <td>{r.requester ?? r.uid?.slice(0, 6)}</td>
                          <td className={s.muted}>{r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}</td>
                          <td className={s.actions}>
                            {status === REQUEST_STATUS.rejected ? (
                              <span className={s.muted}>{r.reason}</span>
                            ) : rejecting === r.id ? (
                              <div className={s.rejectBox}>
                                {QUICK_REJECT_REASONS.map(q => (
                                  <button key={q} className={s.quick} disabled={isBusy('reject', r.id)} onClick={() => reject(r.id, q)}>{q}</button>
                                ))}
                                <div className={s.customRow}>
                                  <input
                                    className={s.input}
                                    value={reason}
                                    maxLength={REJECT_REASON_MAX}
                                    onChange={e => setReason(e.target.value)}
                                    placeholder="Or say why"
                                  />
                                  <button className={s.danger} disabled={isBusy('reject', r.id) || !reason.trim()} onClick={() => reject(r.id, reason)}>Reject</button>
                                  <button className={s.ghost} onClick={() => { setRejecting(null); setReason(''); }}>Cancel</button>
                                </div>
                              </div>
                            ) : status === REQUEST_STATUS.requested ? (
                              <div className={s.btnRow}>
                                <button
                                  className={s.primary}
                                  disabled={Boolean(busy) || !BUILDABLE.has(r.quote?.set)}
                                  title={BUILDABLE.has(r.quote?.set) ? undefined : 'This set is not built from the Studio'}
                                  onClick={() => build(r)}
                                >
                                  {isBusy('build', r.id) ? 'Building…' : 'Build card'}
                                </button>
                                <button className={s.danger} onClick={() => { setRejecting(r.id); setReason(''); }}>Reject</button>
                              </div>
                            ) : status === REQUEST_STATUS.built ? (
                              <div className={s.btnRow}>
                                <span className={faces[r.id] ? s.ok : s.muted}>{faces[r.id] ? 'Face ✓' : 'No face yet'}</span>
                                <button className={s.ghost} disabled={Boolean(busy)} onClick={() => exportFace(r)}>
                                  {isBusy('export', r.id) ? 'Exporting…' : faces[r.id] ? 'Re-export face' : 'Export face'}
                                </button>
                                <button className={s.primary} disabled={Boolean(busy)} onClick={() => invoice(r)}>
                                  {isBusy('invoice', r.id) ? 'Sending…' : 'Send invoice'}
                                </button>
                                {confirmGift === r.id ? (
                                  <>
                                    <button className={s.primary} disabled={Boolean(busy)} onClick={() => gift(r)}>
                                      {isBusy('gift', r.id) ? 'Gifting…' : 'Yes, gift it'}
                                    </button>
                                    <button className={s.ghost} onClick={() => setConfirmGift(null)}>Cancel</button>
                                  </>
                                ) : (
                                  <button className={s.ghost} disabled={Boolean(busy)} onClick={() => setConfirmGift(r.id)}>Gift</button>
                                )}
                                <button className={s.ghost} disabled={Boolean(busy)} onClick={() => build(r)} title="Build it again from the latest data">
                                  {isBusy('build', r.id) ? 'Building…' : 'Rebuild'}
                                </button>
                                <button className={s.danger} onClick={() => { setRejecting(r.id); setReason(''); }}>Reject</button>
                              </div>
                            ) : status === REQUEST_STATUS.invoiced ? (
                              confirmGift === r.id ? (
                                <div className={s.btnRow}>
                                  <button className={s.primary} disabled={Boolean(busy)} onClick={() => gift(r)}>
                                    {isBusy('gift', r.id) ? 'Gifting…' : 'Yes, gift it'}
                                  </button>
                                  <button className={s.ghost} onClick={() => setConfirmGift(null)}>Cancel</button>
                                </div>
                              ) : (
                                <div className={s.btnRow}>
                                  <span className={s.muted}>{isGift(r) ? '🎁 Gift, waiting on them to sign' : 'Waiting on them to sign'}</span>
                                  {!isGift(r) && <button className={s.ghost} onClick={() => setConfirmGift(r.id)}>Gift instead</button>}
                                </div>
                              )
                            ) : status === REQUEST_STATUS.gifted && !r.signedAt ? (
                              confirmRegift === r.id ? (
                                <div className={s.btnRow}>
                                  <span className={s.muted}>Takes their copy back and re-sends it as a 🎁 gift to sign.</span>
                                  <button className={s.primary} disabled={Boolean(busy)} onClick={() => regift(r)}>
                                    {isBusy('regift', r.id) ? 'Re-sending…' : 'Yes, re-send'}
                                  </button>
                                  <button className={s.ghost} onClick={() => setConfirmRegift(null)}>Cancel</button>
                                </div>
                              ) : (
                                <div className={s.btnRow}>
                                  <span className={s.muted}>Gifted before gifts waited to be signed</span>
                                  <button className={s.ghost} disabled={Boolean(busy)} onClick={() => setConfirmRegift(r.id)}>Re-send as gift</button>
                                </div>
                              )
                            ) : (
                              <span className={s.muted}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
