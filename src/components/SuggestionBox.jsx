// THE SUGGESTION BOX (2026-10-01): a short form on Home. Signed-in players
// only; everyone gets a "thanks, got it" — what became of a suggestion is
// shown to trusted players alone (HomeTab's "Your suggestions").
// src/game/suggestions.js has the rule and the limits.
import { useEffect, useRef, useState } from 'react';
import { useDialogs } from '../ui/dialogs.jsx';
import { submitSuggestion } from '../firebase/suggestions.js';
import { SUGGESTION_KINDS, SUGGESTION_KIND_LABELS, SUGGESTION_MAX, checkSuggestion } from '../game/suggestions.js';
import s from './SuggestionBox.module.css';

export default function SuggestionBox({ screen = 'home', onClose, onSent }) {
  const { toast } = useDialogs();
  const [kind, setKind] = useState('idea');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const area = useRef(null);

  useEffect(() => { area.current?.focus(); }, []);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const send = async e => {
    e.preventDefault();
    const checked = checkSuggestion({ kind, text });
    if (!checked.ok) { setError(checked.msg); return; }
    setBusy(true);
    setError(null);
    try {
      await submitSuggestion({ kind: checked.kind, text: checked.text, screen });
      toast('Thanks, got it.', { tone: 'success' });
      onSent?.();
      onClose();
    } catch (err) {
      setError(err?.message ?? 'That did not send. Try again.');
      setBusy(false);
    }
  };

  const left = SUGGESTION_MAX - text.trim().length;
  return (
    <div className={s.backdrop} onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className={s.box} role="dialog" aria-modal="true" aria-labelledby="suggest-title" onSubmit={send}>
        <h2 id="suggest-title" className={s.title}>Suggest something</h2>
        <p className={s.body}>A bug, an idea, a card you want. It goes straight to the people making the game.</p>
        <div className={s.kinds} role="radiogroup" aria-label="What it is about">
          {SUGGESTION_KINDS.map(k => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={`${s.kind} ${kind === k ? s.kindOn : ''}`}
              onClick={() => setKind(k)}
            >
              {SUGGESTION_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <textarea
          id="suggestion-text"
          ref={area}
          className={s.text}
          rows={6}
          value={text}
          onChange={e => { setText(e.target.value); setError(null); }}
          placeholder="What happened, or what would you like?"
          aria-label="Your suggestion"
        />
        <div className={s.meta}>
          {error ? <span className={s.error} role="alert">{error}</span> : <span />}
          <span className={left < 0 ? s.error : s.count}>{left}</span>
        </div>
        <div className={s.foot}>
          <button type="button" className={s.cancel} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={s.send} disabled={busy || !text.trim() || left < 0}>{busy ? 'Sending…' : 'Send'}</button>
        </div>
      </form>
    </div>
  );
}
