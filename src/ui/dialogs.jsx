// TOASTS AND ASKS — the app's own dialogs, replacing 22 alert()s and 13
// confirm()s.
//
// ── WHY THIS IS WORTH A FILE ────────────────────────────────────────────────
//
// `alert()` and `confirm()` are not just ugly. They BLOCK THE TAB: no timer
// runs, no render happens, the AI opponent's turn does not tick while one is
// open. Nine of them lived in CourtBoard, so "No opponent yet to roll is
// beating his defender by +4" — a note, not a decision — stopped the game dead
// in a grey Chrome box with the site's name on it, mid-possession.
//
// ── TWO THINGS, DELIBERATELY DIFFERENT SHAPES ───────────────────────────────
//
//   toast(text)   something HAPPENED and you might want to know. Never blocks,
//                 never needs an answer, goes away on its own
//   ask(config)   a QUESTION whose answer changes what happens next. Returns a
//                 promise, so a caller reads `if (!await ask(...)) return;` the
//                 same way it read `if (!confirm(...)) return;`
//
// Most of the old alert()s were the first kind wearing the second kind's
// clothes, which is the actual bug: a message with an OK button is a message,
// and it should not have needed a click.
//
// ── notify(), FOR CODE THAT CANNOT HOLD A HOOK ──────────────────────────────
//
// PlayTab's four alerts are inside a REDUCER, which cannot call hooks and is
// not allowed to have side effects at all. `notify` is a module-level sink the
// provider subscribes to, so the reducer can report a rejected card play
// without reaching for React. That also makes the StrictMode double-invoke
// harmless — see the collapse rule in `push`.
import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import styles from './dialogs.module.css';

const DialogContext = createContext(null);

/** Subscribers to `notify` — normally exactly one, the provider. */
const sinks = new Set();

/**
 * Report something from outside React. A no-op when no provider is mounted,
 * which is the case in every unit test and is correct: a test asserting on
 * game logic should not need a DOM to run.
 */
export function notify(text, opts = {}) {
  for (const sink of sinks) sink(text, opts);
}

/** How long a toast stays up. An error earns longer because it is a surprise. */
const LIFETIME = { info: 4000, success: 4000, error: 6500 };
/**
 * Two identical messages inside this window are ONE event, not two.
 *
 * React's StrictMode runs every reducer twice in development, so a rejected
 * card play fires `notify` twice with the same text; a player mashing a
 * disallowed card does the same thing for real. Collapsing silently — no "×2"
 * badge — is right for both: the second one carries no information.
 */
const COLLAPSE_MS = 2000;

let nextId = 1;

export function DialogProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [asking, setAsking] = useState(null);
  // The pending ask's resolver, off to one side: putting a function in state
  // means React calls it, treating it as a lazy initializer.
  const resolveRef = useRef(null);

  const toast = useCallback((text, opts = {}) => {
    const body = String(text ?? '').trim();
    if (!body) return;
    const tone = opts.tone ?? 'info';
    const now = Date.now();
    setToasts(list => {
      const twin = list.find(t => t.text === body && now - t.at < COLLAPSE_MS);
      if (twin) return list.map(t => (t === twin ? { ...t, at: now } : t));
      return [...list, { id: nextId++, text: body, tone, at: now }];
    });
  }, []);

  const dismiss = useCallback(id => setToasts(list => list.filter(t => t.id !== id)), []);

  // The bridge for non-React callers.
  useEffect(() => {
    sinks.add(toast);
    return () => sinks.delete(toast);
  }, [toast]);

  /**
   * Ask a question. Takes a string for the simple case, or a config:
   *   { title, body, lines, warn, confirmLabel, cancelLabel, tone }
   * `tone: 'danger'` paints the confirm button red — deletes, forfeits, resets.
   */
  const ask = useCallback(config => {
    const cfg = typeof config === 'string' ? { title: config } : (config ?? {});
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setAsking(cfg);
    });
  }, []);

  /**
   * Ask for a line of text — the one prompt() left in a live path, naming a
   * team on save. Resolves to the trimmed string, or null if declined, so a
   * caller reads the same way the old `const name = prompt(...)` did.
   */
  const askText = useCallback(config => {
    const cfg = typeof config === 'string' ? { title: config } : (config ?? {});
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setAsking({ ...cfg, text: true });
    });
  }, []);

  const answer = useCallback(value => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setAsking(null);
    resolve?.(value);
  }, []);

  // A question is modal, so the keyboard belongs to it: Escape declines and
  // Enter accepts, which is what every native confirm() this replaces did.
  useEffect(() => {
    if (!asking) return undefined;
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); answer(asking.text ? null : false); }
      // A text ask submits through its own form, so Enter is left to the input.
      if (e.key === 'Enter' && !asking.text) { e.preventDefault(); answer(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [asking, answer]);

  const value = { toast, ask, askText };

  return (
    <DialogContext.Provider value={value}>
      {children}
      <div className={styles.toastHost} role="status" aria-live="polite">
        {toasts.map(t => <Toast key={t.id} toast={t} onDone={() => dismiss(t.id)} />)}
      </div>
      {asking && <AskSheet config={asking} onAnswer={answer} />}
    </DialogContext.Provider>
  );
}

/** `{ toast, ask, askText }`. Outside a provider these are no-ops, not a crash. */
export function useDialogs() {
  return useContext(DialogContext) ?? FALLBACK;
}
const FALLBACK = { toast: () => {}, ask: async () => false, askText: async () => null };

function Toast({ toast, onDone }) {
  // Keyed on `at` so a collapsed repeat restarts the clock rather than letting
  // the original one expire underneath it.
  useEffect(() => {
    const timer = setTimeout(onDone, LIFETIME[toast.tone] ?? LIFETIME.info);
    return () => clearTimeout(timer);
  }, [toast.at, toast.tone, onDone]);

  return (
    <button
      type="button"
      className={`${styles.toast} ${styles[toast.tone] ?? ''}`}
      onClick={onDone}
      title="Dismiss"
    >
      {toast.text}
    </button>
  );
}

function AskSheet({ config, onAnswer }) {
  const {
    title, body, lines, warn, text, placeholder, initial = '', maxLength = 60,
    confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone,
  } = config;
  const confirmRef = useRef(null);
  const inputRef = useRef(null);
  const [draft, setDraft] = useState(initial);
  // The text field wants the caret; a plain question wants the button, so
  // Enter lands on the answer rather than on nothing.
  useEffect(() => {
    if (text) inputRef.current?.select();
    else confirmRef.current?.focus();
  }, [text]);

  const decline = () => onAnswer(text ? null : false);
  const submit = e => {
    e?.preventDefault?.();
    if (!text) return onAnswer(true);
    const value = draft.trim();
    return onAnswer(value || null);
  };

  return (
    <div className={styles.askBackdrop} onClick={decline}>
      <div
        className={styles.askBox}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
      >
        <h2 className={styles.askTitle}>{title}</h2>
        {body && <p className={styles.askBody}>{body}</p>}
        {text && (
          <form onSubmit={submit}>
            <input
              ref={inputRef}
              className={styles.askInput}
              value={draft}
              placeholder={placeholder}
              maxLength={maxLength}
              onChange={e => setDraft(e.target.value)}
            />
          </form>
        )}
        {/* A review list — the Switch Everything assignments, five lines of
            "who guards whom", which used to be \n-joined into a confirm(). */}
        {lines?.length > 0 && (
          <ul className={styles.askLines}>
            {lines.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        )}
        {warn && <div className={styles.askWarn}>{warn}</div>}
        <div className={styles.askFoot}>
          <button type="button" className={styles.askCancel} onClick={decline}>
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`${styles.askConfirm} ${tone === 'danger' ? styles.askDanger : ''}`}
            disabled={text && !draft.trim()}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
