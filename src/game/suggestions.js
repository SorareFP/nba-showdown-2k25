// THE SUGGESTION BOX (2026-10-01).
//
// The user: "can we add an in-app suggestion box that is wired to come straight
// back to you at some point?" Signed-in players only; everyone gets a "thanks,
// got it"; and a few TRUSTED players see what became of theirs — "I trust my
// brother ... to send me stuff. When more people start playing, less so them."
//
// The route back to Claude: the Card Studio's Suggestions panel (signed in as
// an admin) reads the queue through a callable and saves it into the repo at
// docs/suggestions/inbox.json, which Claude reads at the start of a session.
// Nothing leaves Firebase for any other service.
//
// Shared by the app and the server (functions/prepare.mjs copies it), so the
// limits a player is told and the ones the server enforces are one table.

export const SUGGESTION_KINDS = ['bug', 'idea', 'card', 'other'];
export const SUGGESTION_KIND_LABELS = {
  bug: 'Something broke',
  idea: 'An idea',
  card: 'A card',
  other: 'Something else',
};
export const SUGGESTION_MAX = 1500;
/** Per player, per rolling day: plenty for a real player, a wall for a script. */
export const SUGGESTIONS_PER_DAY = 10;

/** Where a suggestion stands. Only a trusted player is ever shown this. */
export const SUGGESTION_STATUS = { new: 'new', seen: 'seen', planned: 'planned', done: 'done', declined: 'declined' };
export const SUGGESTION_STATUS_LABELS = {
  new: 'Sent',
  seen: 'Read',
  planned: 'On the list',
  done: 'Done',
  declined: 'Not this time',
};
export const OUTCOME_MAX = 500;

/** `{ ok, kind, text }`, or `{ ok: false, msg }` saying what to fix. */
export function checkSuggestion({ kind, text } = {}) {
  const k = SUGGESTION_KINDS.includes(kind) ? kind : null;
  if (!k) return { ok: false, msg: 'Pick what it is about.' };
  const t = String(text ?? '').trim();
  if (!t) return { ok: false, msg: 'Write the suggestion first.' };
  if (t.length > SUGGESTION_MAX) return { ok: false, msg: `Keep it under ${SUGGESTION_MAX} characters (this is ${t.length}).` };
  return { ok: true, kind: k, text: t };
}

/** How many of these timestamps (ms) fall inside the last day before `now`. */
export function sentToday(times, now = Date.now()) {
  return (times ?? []).filter(t => Number.isFinite(t) && now - t < 24 * 60 * 60 * 1000).length;
}
