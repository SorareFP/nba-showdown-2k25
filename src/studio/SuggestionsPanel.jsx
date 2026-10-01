// THE SUGGESTION INBOX, IN THE STUDIO (2026-10-01).
//
// The app's suggestion box (src/game/suggestions.js) writes to a server-only
// collection. This panel is the admin's side of it, on the same sign-in the
// Requests panel uses: it reads the queue, saves it into the local, gitignored
// docs/suggestions/inbox.json every time it loads (that file is how the queue
// reaches Claude), and lets the admin answer a suggestion or trust its sender.
// A trusted player sees the status and the answer on their Home page; everyone
// else only ever saw "Thanks, got it."
import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../firebase/config.js';
import { listSuggestions, answerSuggestion, setSuggestionTrust } from '../firebase/suggestions.js';
import { SUGGESTION_KIND_LABELS, SUGGESTION_STATUS, SUGGESTION_STATUS_LABELS, OUTCOME_MAX } from '../game/suggestions.js';
import { saveSuggestionInbox } from './api.js';
import s from './RequestsPanel.module.css';

const VIEWS = [['open', 'New'], ['all', 'All']];
const when = ms => (ms ? new Date(ms).toLocaleString() : '');

export default function SuggestionsPanel({ onClose, onCount }) {
  const [user, setUser] = useState(auth.currentUser);
  const [view, setView] = useState('open');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(null);
  const [drafts, setDrafts] = useState({});   // id -> { status, outcome }

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const all = await listSuggestions({});
      setRows(all);
      onCount?.(all.filter(r => r.status === SUGGESTION_STATUS.new).length);
      // Every load lands in the local inbox, so the file is never behind the panel.
      const res = await saveSuggestionInbox(all);
      setSaved(`${res.saved} saved to ${res.file} (${res.open} new)`);
    } catch (e) {
      setError(e.message);
    }
  }, [user, onCount]);
  useEffect(() => { load(); }, [load]);

  const draftOf = r => drafts[r.id] ?? { status: r.status === SUGGESTION_STATUS.new ? SUGGESTION_STATUS.seen : r.status, outcome: r.outcome ?? '' };
  const edit = (r, patch) => setDrafts(d => ({ ...d, [r.id]: { ...draftOf(r), ...patch } }));

  const answer = async r => {
    const d = draftOf(r);
    setBusy(`answer:${r.id}`);
    try {
      await answerSuggestion({ id: r.id, status: d.status, outcome: d.outcome });
      setDrafts(({ [r.id]: _gone, ...rest }) => rest);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const trust = async (r, trusted) => {
    setBusy(`trust:${r.uid}`);
    try { await setSuggestionTrust({ uid: r.uid, trusted }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const shown = (rows ?? []).filter(r => view === 'all' || r.status === SUGGESTION_STATUS.new);
  return (
    <div className={s.overlay}>
      <div className={s.box}>
        <header className={s.head}>
          <h2 className={s.title}>Suggestions</h2>
          <div className={s.views}>
            {VIEWS.map(([id, label]) => (
              <button key={id} className={`${s.viewBtn} ${view === id ? s.viewOn : ''}`} onClick={() => setView(id)}>{label}</button>
            ))}
          </div>
          <span className={s.spacer} />
          {user && <span className={s.muted}>{user.email}</span>}
          {user && <button className={s.ghost} onClick={() => signOut(auth)}>Sign out</button>}
          <button className={s.ghost} onClick={onClose}>Close</button>
        </header>

        <p className={s.steps}>
          Opening this panel saves the whole queue to <b>docs/suggestions/inbox.json</b> on this machine, which is
          where Claude reads it. The file is gitignored: it names players. Players see only "Thanks, got it" unless
          you <b>Trust</b> them; a trusted player sees the status and your answer on their Home page.
        </p>
        {saved && <div className={s.note}><span>{saved}</span></div>}

        {!user ? (
          <div className={s.empty}>
            <p>Sign in with the admin Google account to see the suggestions.</p>
            <button className={s.primary} onClick={() => signInWithPopup(auth, googleProvider)}>Sign in with Google</button>
          </div>
        ) : (
          <>
            {error && <div className={s.error}>{error}</div>}
            {rows == null ? (
              <p className={s.muted}>Loading…</p>
            ) : shown.length === 0 ? (
              <p className={s.empty}>{view === 'open' ? 'Nothing new.' : 'No suggestions yet.'}</p>
            ) : (
              <div className={s.scroll}>
                <table className={s.table}>
                  <thead>
                    <tr><th>From</th><th>Suggestion</th><th>Answer</th></tr>
                  </thead>
                  <tbody>
                    {shown.map(r => {
                      const d = draftOf(r);
                      return (
                        <tr key={r.id} data-suggestion={r.id}>
                          <td>
                            <div className={s.name}>{r.name ?? 'A player'}</div>
                            <div className={s.muted}>{r.email}</div>
                            <div className={s.muted}>{when(r.createdAt)}{r.screen ? ` · ${r.screen}` : ''}</div>
                            <button
                              className={s.ghost}
                              disabled={busy === `trust:${r.uid}`}
                              onClick={() => trust(r, !r.trusted)}
                              title={r.trusted ? 'They see what happens to their suggestions. Click to stop.' : 'Let them see what happens to their suggestions.'}
                            >
                              {r.trusted ? '★ Trusted' : 'Trust'}
                            </button>
                          </td>
                          <td>
                            <div className={s.muted}>{SUGGESTION_KIND_LABELS[r.kind] ?? r.kind} · {SUGGESTION_STATUS_LABELS[r.status] ?? r.status}</div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{r.text}</div>
                          </td>
                          <td>
                            <select
                              id={`suggestion-status-${r.id}`}
                              className={s.input}
                              value={d.status}
                              onChange={e => edit(r, { status: e.target.value })}
                              aria-label="Status"
                            >
                              {Object.values(SUGGESTION_STATUS).map(st => <option key={st} value={st}>{SUGGESTION_STATUS_LABELS[st]}</option>)}
                            </select>
                            <textarea
                              id={`suggestion-outcome-${r.id}`}
                              className={s.input}
                              rows={2}
                              maxLength={OUTCOME_MAX}
                              value={d.outcome}
                              onChange={e => edit(r, { outcome: e.target.value })}
                              placeholder={r.trusted ? 'A line they will read' : 'A note (they will not see it unless trusted)'}
                              aria-label="Answer"
                            />
                            <div className={s.btnRow}>
                              <button className={s.primary} disabled={busy === `answer:${r.id}`} onClick={() => answer(r)}>
                                {busy === `answer:${r.id}` ? 'Saving…' : 'Save'}
                              </button>
                            </div>
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
