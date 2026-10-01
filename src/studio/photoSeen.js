// "WHOSE PHOTO DID I JUST ADD?" (2026-09-30).
//
// The user: "With the photo hunt now existing in the card studio, it's easy to
// lose track of whose photo I just recently added -- Can you make there be an
// alert if I haven't opened a player since their photo was added?" The hunt is
// where most photos arrive now, and a row LEAVES the hunt the moment its photo
// lands — so the card that needs cropping next is exactly the one no list
// shows any more.
//
// A photo is UNSEEN when its file is newer than the last time its card was on
// screen in the studio. The file's time comes from the server (allPhotoTimes,
// studioServerPlugin.js photoTimes), so a photo copied into the folder by hand
// counts the same as one dropped in the studio. When a card was last on screen
// lives here, in this browser: it is how one person works through the tool,
// the same kind of thing prefs.js keeps, and every access is guarded the same
// way — storage that cannot be read is a first visit, never an error.
//
// THE FIRST RUN LOOKS BACK TWO DAYS instead of flagging every photo on disk.
// Nothing recorded when a card was opened before this existed, and the photos
// worth a nudge are the recent ones.

export const SEEN_KEY = 'studio.photoSeen';
export const FIRST_RUN_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

/** One card's key: the set and the id, because ids repeat across sets by design. */
export const seenKey = (set, id) => `${set}:${id}`;

function resolveStore(store) {
  if (store !== undefined) return store;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** A fresh record: nothing opened yet, photos older than the look-back already seen. */
export const freshSeen = (now = Date.now()) => ({ since: now - FIRST_RUN_LOOKBACK_MS, at: {} });

/**
 * The stored record `{ since, at: { 'set:id': ms } }`, or a fresh one when it
 * is absent, unreadable or malformed. `since` is the line below which every
 * photo counts as seen; `at` is when each card was last on screen.
 */
export function readSeen(now = Date.now(), store) {
  const s = resolveStore(store);
  if (!s) return freshSeen(now);
  try {
    const parsed = JSON.parse(s.getItem(SEEN_KEY) ?? 'null');
    if (!parsed || !Number.isFinite(parsed.since) || typeof parsed.at !== 'object' || parsed.at === null) {
      return freshSeen(now);
    }
    const at = {};
    for (const [k, v] of Object.entries(parsed.at)) if (Number.isFinite(v)) at[k] = v;
    return { since: parsed.since, at };
  } catch {
    return freshSeen(now);
  }
}

/** Writes the record; returns whether it landed (a full or blocked store does not throw). */
export function writeSeen(record, store) {
  const s = resolveStore(store);
  if (!s) return false;
  try {
    s.setItem(SEEN_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** The record with one card marked on screen at `ms`. Never moves a time backwards. */
export function markSeen(record, set, id, ms = Date.now()) {
  const key = seenKey(set, id);
  if ((record.at[key] ?? 0) >= ms) return record;
  return { ...record, at: { ...record.at, [key]: ms } };
}

/** The record with every listed card marked on screen at `ms` — "mark all seen". */
export function markAllSeen(record, unseen, ms = Date.now()) {
  return unseen.reduce((r, u) => markSeen(r, u.set, u.id, ms), record);
}

/**
 * Every photo added since its card was last on screen, newest first.
 *
 * Walks the SOURCES the way the Photo Hunt does — primary, editable, each card
 * once per set — so every entry names a source the studio can open it in.
 * Placeholder art is skipped: the hunt still owes those cards a photo, and a
 * repainted doodle is nothing to go and look at.
 */
export function unseenPhotos({ allPhotoTimes = {}, allPlaceholders = {}, record, sources }) {
  const out = [];
  const listed = new Set();
  for (const src of Object.values(sources)) {
    if (src.secondary || src.editable === false || !src.players?.length) continue;
    const times = allPhotoTimes[src.set] ?? {};
    const placeholders = new Set(allPlaceholders[src.set] ?? []);
    for (const p of src.players) {
      const key = seenKey(src.set, p.id);
      const addedAt = times[p.id];
      if (listed.has(key) || !Number.isFinite(addedAt) || placeholders.has(p.id)) continue;
      if (addedAt <= Math.max(record.since ?? 0, record.at[key] ?? 0)) continue;
      listed.add(key);
      out.push({
        key,
        set: src.set,
        sourceKey: src.key,
        sourceLabel: String(src.label ?? src.key).replace(/ · .*$/, ''),
        id: p.id,
        name: p.name,
        addedAt,
      });
    }
  }
  return out.sort((a, b) => b.addedAt - a.addedAt || a.name.localeCompare(b.name));
}

/**
 * PHOTOS FLAGGED FOR A REPLACEMENT (2026-10-01).
 *
 * The user, after an audit found 66 of the 2026-27 set's photos in a former
 * team's jersey: "Can you throw the blue bar on all of these? The one that
 * indicates it needs checked." A flag is a line in the set's photo folder
 * (`_flags.json`: id -> { at, note }, read by the studio server) and it is a
 * to-do, not a notice: OPENING THE CARD DOES NOT CLEAR IT. A photo newer than
 * the flag does — the replacement landed — and from then on the card is an
 * ordinary "added, not opened yet" entry. A flag on a photo worth keeping is
 * dismissed by hand (the hunt's "keep this photo").
 *
 * Alphabetical, because this list is worked through, not reacted to.
 */
export function flaggedPhotos({ allPhotoFlags = {}, allPhotoTimes = {}, sources }) {
  const out = [];
  const listed = new Set();
  for (const src of Object.values(sources)) {
    if (src.secondary || src.editable === false || !src.players?.length) continue;
    const flags = allPhotoFlags[src.set] ?? {};
    const times = allPhotoTimes[src.set] ?? {};
    for (const p of src.players) {
      const flag = flags[p.id];
      const key = seenKey(src.set, p.id);
      if (!flag || !Number.isFinite(flag.at) || listed.has(key)) continue;
      if (Number.isFinite(times[p.id]) && times[p.id] > flag.at) continue;
      listed.add(key);
      out.push({
        key,
        set: src.set,
        sourceKey: src.key,
        sourceLabel: String(src.label ?? src.key).replace(/ · .*$/, ''),
        id: p.id,
        name: p.name,
        note: typeof flag.note === 'string' ? flag.note : '',
        flaggedAt: flag.at,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
