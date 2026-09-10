// THE REQUEST QUEUE, in the Card Studio. Free Agent requests come in here
// (the user, 2026-09-10: "Card requests come in through the Card Studio")
// and the first answer is the one he asked for: "I'll need a reject button
// for entries I don't want to make or that don't make sense."
//
// Sign-in is the admin's own Google account, through the same Firebase app
// the game uses; the queue and the reject go through admin-only callables
// (functions/index.js checks ADMIN_EMAILS). Build, fulfil and gift come next.
import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../firebase/config.js';
import { listCardRequests, rejectCardRequest } from '../firebase/freeAgents.js';
import { seasonText, QUICK_REJECT_REASONS, REJECT_REASON_MAX, FREE_AGENT_SETS, REQUEST_STATUS } from '../game/freeAgents.js';
import s from './RequestsPanel.module.css';

const VIEWS = [
  [REQUEST_STATUS.requested, 'Waiting'],
  [REQUEST_STATUS.rejected, 'Rejected'],
];

export default function RequestsPanel({ onClose }) {
  const [user, setUser] = useState(auth.currentUser);
  const [status, setStatus] = useState(REQUEST_STATUS.requested);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [rejecting, setRejecting] = useState(null);   // request id with the reason box open
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(null);

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

  const reject = async (id, why) => {
    setBusy(id);
    try {
      await rejectCardRequest({ id, reason: why });
      setRows(list => list.filter(r => r.id !== id));
      setRejecting(null);
      setReason('');
    } catch (e) {
      setError(e?.message ?? 'Could not reject that request');
    } finally {
      setBusy(null);
    }
  };

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

        {!user ? (
          <div className={s.empty}>
            <p>Sign in with the admin Google account to see the queue.</p>
            <button className={s.primary} onClick={() => signInWithPopup(auth, googleProvider)}>Sign in with Google</button>
          </div>
        ) : error ? (
          <div className={s.error}>{error}</div>
        ) : rows == null ? (
          <p className={s.muted}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className={s.empty}>{status === REQUEST_STATUS.requested ? 'Nothing waiting.' : 'Nothing here.'}</p>
        ) : (
          <table className={s.table}>
            <thead>
              <tr><th>Player</th><th>Season</th><th>Team</th><th>Set</th><th>Quote</th><th>Asked by</th><th>When</th><th /></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className={s.name}>{r.name}</td>
                  <td>{seasonText(r)}</td>
                  <td>{r.team}</td>
                  <td>{FREE_AGENT_SETS[r.quote?.set]?.label ?? r.quote?.set}</td>
                  <td>${r.quote?.salary?.toLocaleString()} · {r.quote?.rarity} · 🪙 {r.quote?.price?.toLocaleString()}</td>
                  <td>{r.requester ?? r.uid?.slice(0, 6)}</td>
                  <td className={s.muted}>{r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}</td>
                  <td className={s.actions}>
                    {status === REQUEST_STATUS.rejected ? (
                      <span className={s.muted}>{r.reason}</span>
                    ) : rejecting === r.id ? (
                      <div className={s.rejectBox}>
                        {QUICK_REJECT_REASONS.map(q => (
                          <button key={q} className={s.quick} disabled={busy === r.id} onClick={() => reject(r.id, q)}>{q}</button>
                        ))}
                        <div className={s.customRow}>
                          <input
                            className={s.input}
                            value={reason}
                            maxLength={REJECT_REASON_MAX}
                            onChange={e => setReason(e.target.value)}
                            placeholder="Or say why"
                          />
                          <button className={s.danger} disabled={busy === r.id || !reason.trim()} onClick={() => reject(r.id, reason)}>Reject</button>
                          <button className={s.ghost} onClick={() => { setRejecting(null); setReason(''); }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button className={s.danger} onClick={() => { setRejecting(r.id); setReason(''); }}>Reject</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
