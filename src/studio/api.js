// The studio's dev-server API surface, in one place.
//
// PATHS ARE BASE-LESS ON PURPOSE. The app ships under
// `base: '/nba-showdown-2k25/'`, and the studio PAGE is served at
// /nba-showdown-2k25/studio.html — but these routes are not. Vite runs plugin
// `configureServer` hooks BEFORE it installs its own middlewares, base-stripping
// included, so scripts/studio/studioServerPlugin.js sits in front of the base
// handling and only ever sees the bare path. Requesting
// `/nba-showdown-2k25/__studio/state` falls straight through to Vite's SPA
// fallback and comes back as HTML, which then fails to parse as JSON — a
// confusing failure, hence this comment. Verified against the running dev
// server, not just reasoned about.
//
// EVERY ROUTE IS SET-SCOPED. There are four sets now and each owns its photos,
// its crops and its team colours under card-art/sets/{id}/, so `?set=` is not
// optional decoration — it is the difference between a photo dropped on a
// Super Season card landing in the Super Season set and landing on top of the
// 2026-27 set's art under the same player's name. The server allow-lists the
// value against the declared sets and falls back to the set being built, which
// is what an un-scoped request used to mean.
const BASE = '/__studio';

/** `?set=…`, or nothing when the caller did not name one. */
const scope = set => (set ? `?set=${encodeURIComponent(set)}` : '');

export const stateUrl = set => `${BASE}/state${scope(set)}`;
export const cropsUrl = set => `${BASE}/crops${scope(set)}`;
export const teamsUrl = set => `${BASE}/teams${scope(set)}`;
export const photoUrl = (playerId, set) =>
  `${BASE}/photo?playerId=${encodeURIComponent(playerId)}` +
  (set ? `&set=${encodeURIComponent(set)}` : '');

/** Extensions the studio server will store (it rejects nothing, but see below). */
const IMAGE_EXT = /\.(jpe?g|jfif|png|webp|gif|avif)$/i;

/**
 * Guards against dropping something that isn't an image.
 *
 * Worth doing on the client because the server does NOT check: it writes any
 * bytes it is given to `{playerId}.jpg`, so a dropped PDF would become a
 * "photo" that renders as a broken image with no explanation.
 *
 * Falls back to the extension when the browser reports no MIME type, which
 * happens for some drag sources.
 */
export function isImageFile(file) {
  if (!file) return false;
  if (file.type) return file.type.startsWith('image/');
  return IMAGE_EXT.test(file.name ?? '');
}

/** Reads one set's whole persisted studio state in one round trip. */
export async function fetchStudioState(set) {
  const res = await fetch(stateUrl(set));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Uploads one photo into one set. The body is the raw file — the server writes
 * it untouched, so the source stays byte-identical and the crop stays metadata.
 */
export async function uploadPhoto(playerId, file, set) {
  const res = await fetch(photoUrl(playerId, set), { method: 'POST', body: file });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

/**
 * Persists a whole JSON map, wholesale — the server replaces the file.
 *
 * Wholesale rather than per-key because that is what makes REMOVAL work.
 * Resetting a team to its official colors means its key is GONE from
 * team-overrides.json, and a merge-on-write endpoint could only ever express
 * that as some sentinel value. Same reason a deleted crop disappears.
 */
async function saveJson(url, value) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Persists one set's whole crops map. */
export const saveCrops = (crops, set) => saveJson(cropsUrl(set), crops);

/** Persists one set's whole team-override map. See teamTheme.js for its shape. */
export const saveTeams = (overrides, set) => saveJson(teamsUrl(set), overrides);
