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

/**
 * A save: `{ game, preset, id, at }`, or null for "nothing in progress".
 * `id` names a non-fixture game (see gameIdentity); it is left off when absent.
 */
export function makeSave(game, preset, id = null) {
  if (!game) return null;
  return { game, preset: preset ?? null, ...(id ? { id } : {}), at: Date.now() };
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

/**
 * The same fixture preset? By KEY: the one App hands over when a fixture is
 * opened from the season screen is a fresh object, and the one restored from
 * the save is another. Compared by identity, opening the fixture looked like a
 * change, re-stamped this device's stale copy as the newest, and so beat the
 * other device's real progress (found 2026-09-10, the desktop-to-phone report).
 */
export function samePreset(a, b) {
  if (a === b) return true;
  return Boolean(a?.key && a.key === b?.key);
}

/** Is `save` the game for this season fixture? */
export function saveIsFixture(save, preset) {
  return Boolean(save?.game && preset?.key && save.preset?.key === preset.key);
}

// ── Which game, and which copy (2026-09-10) ──────────────────────────────────
//
// The user: "It does not look like the game state shifts elegantly from
// desktop to mobile. Not in season games at least." Three holes: a stale local
// copy of a fixture beat the account's newer one; a different game here hid
// the fixture's copy on the account; and a desktop tab left open overwrote the
// phone's progress with its next move. The rule now: the NEWEST COPY OF THE
// SAME GAME WINS, without a question. Only taking a DIFFERENT game over one in
// progress here is asked about.
//
// A season fixture is named by its preset key. Any other game is named by the
// id stamped on its save when it was dealt. A save from before ids existed has
// no name and counts as a different game. Stamps are each device's own clock;
// the switches this serves are minutes apart, not milliseconds.

/** A fresh id for a newly dealt game. */
export function newGameId(rng = Math.random) {
  return `${Date.now().toString(36)}-${Math.floor(rng() * 36 ** 6).toString(36)}`;
}

/** What game a save is: 'fixture:<key>', 'game:<id>', or null when it cannot say. */
export function gameIdentity(save) {
  if (!save?.game) return null;
  if (save.preset?.key) return `fixture:${save.preset.key}`;
  return save.id ? `game:${save.id}` : null;
}

export function sameGame(a, b) {
  const x = gameIdentity(a);
  return Boolean(x && x === gameIdentity(b));
}

const inProgress = s => Boolean(s?.game && !s.game.done);

/**
 * THE ACCOUNT'S COPY, MET ON THIS DEVICE: on opening Play, on coming back to
 * the tab, or when a write was refused. `held` is this device's game as a
 * save; `baseAt` is the stamp of the last copy the account had from, or gave
 * to, this device.
 *
 *   'none'   nothing on the account is newer than what this device knows
 *   'adopt'  a newer copy of THIS game, or a game while nothing is going here:
 *            take it without asking
 *   'drop'   this game was FINISHED on the other device: let go of the stale
 *            copy here. It is not taken — a finished game is reported and paid
 *            on the device that played it
 *   'ask'    a newer DIFFERENT game while one is going here: taking it would
 *            discard this one, so the player decides
 */
export function remoteDecision({ held = null, remote = null, baseAt = 0 } = {}) {
  if (!remote?.game) return 'none';
  if ((remote.at || 0) <= Math.max(baseAt || 0, held?.game ? held.at || 0 : 0)) return 'none';
  if (sameGame(held, remote)) {
    if (!remote.game.done) return 'adopt';
    return inProgress(held) ? 'drop' : 'none';
  }
  if (!inProgress(remote)) return 'none';
  return inProgress(held) ? 'ask' : 'adopt';
}

/**
 * A SEASON FIXTURE ARRIVING from the season screen: which copy to play. The
 * newest copy of this fixture wins, here or on the account, with no question:
 * the player pressed Resume on it.
 *
 *   { use: 'local' }            keep the copy here (it may be a finished game
 *                               waiting to be reported — the results screen
 *                               shows and "Back to the season" records it)
 *   { use: 'remote', save }     take the account's copy
 *   { use: 'finished' }         played out on the other device and not yet
 *                               reported: record it there, do not replay it
 *   { use: 'deal' }             no copy anywhere: deal it fresh
 *
 * `discards` is true when this device has a DIFFERENT game going that playing
 * the fixture would replace; the caller asks before doing so.
 */
export function fixtureDecision({ held = null, remote = null, preset } = {}) {
  const discards = inProgress(held) && !saveIsFixture(held, preset);
  const copies = [['local', held], ['remote', remote]]
    .filter(([, s]) => s?.game && saveIsFixture(s, preset))
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0));   // stable: a tie stays local
  if (!copies.length) return { use: 'deal', discards };
  const [where, save] = copies[0];
  if (where === 'remote' && save.game.done) return { use: 'finished', discards: false };
  return where === 'local' ? { use: 'local', discards: false } : { use: 'remote', save, discards };
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
 *
 * A `save` that resolves `{ ok: false, newer }` was REFUSED: the account moved
 * on under this device. The account's copy goes to `onConflict`, and nothing
 * is marked sent, so the next change here is tried again once the caller has
 * decided. A refused clear is simply dropped — abandoning a game here must not
 * pull the other device's newer one onto this screen.
 */
export function createRemoteSaver({ save, clear, delay = REMOTE_DEBOUNCE_MS, onError = () => {}, onConflict = () => {} }) {
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
      else if (job.at !== lastSentAt) {
        const r = await save(job);
        if (r && r.ok === false) { if (r.newer) onConflict(r.newer); }
        else lastSentAt = job.at;
      }
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
