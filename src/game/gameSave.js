// THE GAME IN PROGRESS, SAVED TWICE — the pure half.
//
// localStorage is the fast path and the signed-out path: every change lands
// there synchronously and a reload restores it (PlayTab). Firestore is the
// ROAMING copy — signed in, the same save goes to users/{uid}/games/current,
// debounced, so a game started on a phone can be resumed on a desktop. The
// user, 2026-09-07: "I started my season game on my phone and then moved to my
// desktop and cannot resume that game."
//
// This file has no Firebase in it on purpose: everything that decides WHAT to
// save and WHICH copy wins is here, testable in node; the two Firestore calls
// live in src/firebase/games.js.
//
// ── ONE GAME PER ACCOUNT ─────────────────────────────────────────────────────
//
// The document id is fixed and the newest save wins. `at` is stamped once per
// change and shared by both copies, so equal stamps are the same snapshot and
// a larger stamp is a later one, whichever device wrote it. A stale copy on
// another device is overwritten the next time that device saves a change —
// that is what "one game" means, and it is why the resume prompt exists: the
// device with the older copy asks before it takes the newer one.
//
// ── WHAT FIRESTORE REFUSES ───────────────────────────────────────────────────
//
// `undefined` anywhere, and an array directly inside an array. A JSON round
// trip strips the first. The engine produces no nested arrays (probed on a
// simulated full game, 2026-09-07), and forFirestore checks anyway rather than
// trusting that forever. A document is capped at 1 MB; a finished game is
// well under, so the log is trimmed only if a save somehow grows past the
// guard, and a save that is still too big after that stays local-only.

export const LOCAL_KEY = 'showdown.game';
export const REMOTE_MAX_BYTES = 900_000;
export const REMOTE_LOG_KEEP = 300;
/** How long a burst of changes is coalesced before one Firestore write. */
export const REMOTE_DEBOUNCE_MS = 1500;

/** A save: `{ game, preset, at }`, or null for "nothing in progress". */
export function makeSave(game, preset) {
  if (!game) return null;
  return { game, preset: preset ?? null, at: Date.now() };
}

// ── The local copy ───────────────────────────────────────────────────────────

export function readLocalGame() {
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && parsed.game ? parsed : null;
  } catch {
    return null;
  }
}

/** Null clears. Storage can be absent or refuse; a game that cannot be saved is still a game. */
export function writeLocalGame(save) {
  try {
    if (!save) globalThis.localStorage?.removeItem(LOCAL_KEY);
    else globalThis.localStorage?.setItem(LOCAL_KEY, JSON.stringify(save));
  } catch {
    /* unsaved, still playable */
  }
}

// ── Shaping a save for Firestore ─────────────────────────────────────────────

/** Path of the first array-inside-an-array, or null. */
export function nestedArrayPath(value, path = '$') {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (Array.isArray(value[i])) return `${path}[${i}]`;
      const hit = nestedArrayPath(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const hit = nestedArrayPath(v, `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * The document to write, or null if it cannot be written. Strips `undefined`
 * (JSON), refuses nested arrays loudly (a thrown Error is a bug to fix, not a
 * save to skip), and trims the log when the save is over the size guard.
 */
export function forFirestore(save) {
  if (!save?.game) return null;
  const copy = JSON.parse(JSON.stringify(save));
  const nested = nestedArrayPath(copy);
  if (nested) throw new Error(`gameSave: Firestore refuses an array inside an array, at ${nested}`);
  if (JSON.stringify(copy).length > REMOTE_MAX_BYTES && Array.isArray(copy.game.log)) {
    copy.game.log = copy.game.log.slice(-REMOTE_LOG_KEEP);
    copy.logTrimmed = true;
  }
  return JSON.stringify(copy).length > REMOTE_MAX_BYTES ? null : copy;
}

// ── Which copy wins ──────────────────────────────────────────────────────────

/**
 * 'remote' when the other device's copy is strictly newer, 'local' when this
 * device's copy is current (or the two are the same snapshot), 'none' when
 * there is nothing anywhere.
 */
export function newerSave(local, remote) {
  const l = local?.game ? local.at || 0 : null;
  const r = remote?.game ? remote.at || 0 : null;
  if (l == null && r == null) return 'none';
  if (r == null) return 'local';
  if (l == null) return 'remote';
  return r > l ? 'remote' : 'local';
}

/** Is `save` the game for this season fixture? */
export function saveIsFixture(save, preset) {
  return Boolean(save?.game && preset?.key && save.preset?.key === preset.key);
}

// ── Words for the prompt ─────────────────────────────────────────────────────

export function describeSave(save, now = Date.now()) {
  if (!save?.game) return '';
  const g = save.game;
  const what = save.preset?.label ? save.preset.label : `${g.teamA?.name ?? 'Team A'} vs ${g.teamB?.name ?? 'Team B'}`;
  const where = g.done ? 'final' : `Q${g.quarter ?? '?'} · section ${g.section ?? '?'}`;
  const score = `${g.teamA?.score ?? 0}–${g.teamB?.score ?? 0}`;
  const mins = Math.max(0, Math.round((now - (save.at || now)) / 60000));
  const when = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
  return `${what} — ${where}, ${score}, saved ${when}.`;
}

// ── The debounced writer ─────────────────────────────────────────────────────

/**
 * Coalesces a burst of changes into one write. `push(save)` schedules; a
 * `push(null)` schedules a clear; `flush()` writes whatever is pending right
 * now (pagehide, tab hidden); `dispose()` drops the timer and pending work.
 * The I/O is injected so this is testable with fake timers and no network.
 */
export function createRemoteSaver({ save, clear, delay = REMOTE_DEBOUNCE_MS, onError = () => {} }) {
  let pending = undefined;   // undefined = nothing queued; null = clear queued
  let timer = null;
  let lastSentAt = null;

  const send = async () => {
    if (pending === undefined) return;
    const job = pending;
    pending = undefined;
    timer = null;
    try {
      if (job === null) await clear();
      else if (job.at !== lastSentAt) { await save(job); lastSentAt = job.at; }
    } catch (e) {
      onError(e);
    }
  };

  return {
    push(saveOrNull) {
      pending = saveOrNull;
      if (timer) clearTimeout(timer);
      timer = setTimeout(send, delay);
    },
    flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      return send();
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = undefined;
    },
  };
}
