// Vite dev-server middleware backing the Card Studio's file persistence.
//
// DEV ONLY. Registered with `apply: 'serve'`, so it is never part of a `vite
// build` and cannot reach production. Every write it performs is inside the
// CURRENT set's directory under card-art/ (src/cards/sets.js) — never near
// public/cards/, where the finished set's hand-made art lives.
//
// Why a plugin rather than a companion server: the studio needs to write files
// (photos, crop metadata, team colors). A `configureServer` hook adds routes to
// the dev server that is already running — no second process, no second port,
// no extra dependency, and no path into the shipped app.
//
// MIDDLEWARE ORDER MATTERS: Vite runs plugin `configureServer` hooks BEFORE it
// installs its own internal middlewares, which includes the base-path
// middleware for `base: '/nba-showdown-2k25/'`. That is what lets these routes
// answer on their bare paths (`/__studio/state`, `/card-art/...`) instead of
// having to be prefixed with the base. Do not convert these to post hooks.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import {
  ART_ROOT,
  CURRENT_SET,
  DEFAULT_PHOTO_EXT,
  IMAGE_EXTENSIONS,
  SET_IDS,
  isEditableSet,
  setPaths,
} from '../../src/cards/sets.js';

/** Kept in step with IMAGE_EXTENSIONS in src/cards/sets.js — a test asserts it. */
const ALLOWED_PHOTO_EXT = new Set(IMAGE_EXTENSIONS);

/** The player id a photo filename encodes — the name with its extension removed. */
const playerIdFromFile = file => file.replace(/\.[^.]+$/, '');

/**
 * playerId -> the extension that player's photo is stored under.
 *
 * WHY THE SERVER HAS TO SAY. The listing above has always accepted four
 * extensions and derived the id by throwing the extension away, so a
 * hand-saved `Luka_Doncic.jpeg` counted as a photo — but the browser then
 * asked for `Luka_Doncic.jpg`, because that was hardcoded in the URL builder,
 * and got a 404. The directory is the only place the truth exists and only
 * this process can read it, so it is reported rather than guessed at.
 *
 * COLLISIONS RESOLVE TO THE DEFAULT. Nothing stops both `X.jpg` and `X.png`
 * from existing (save one by hand, then drop one on the studio). Both are one
 * player, the studio can only show one, and the .jpg is the one the studio
 * itself most recently wrote — so it wins, regardless of readdir order. Sorted
 * first so the choice does not depend on the filesystem's listing order
 * either.
 */
export function photoExtMap(files) {
  const map = {};
  for (const file of [...files].sort()) {
    const id = playerIdFromFile(file);
    const ext = extname(file).toLowerCase();
    if (map[id] === DEFAULT_PHOTO_EXT) continue;
    map[id] = ext;
  }
  return map;
}

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  // A JPEG under the name Chrome-on-Windows gives it. Served as one, because
  // that is what it is — there is no such thing as a JFIF decoder.
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.json': 'application/json',
};

/**
 * Every path the studio is allowed to touch, derived from the Vite root.
 *
 * Scoped to ONE set. `art` stays the un-scoped card-art/ root only because it
 * is the traversal boundary for static serving — no route writes there directly.
 */
function studioPaths(root, set = CURRENT_SET) {
  const paths = setPaths(set);
  return {
    set,
    art: resolve(root, ART_ROOT),
    photos: resolve(root, paths.photos),
    crops: resolve(root, paths.crops),
    teams: resolve(root, paths.teamOverrides),
  };
}

/**
 * The set a request is for, from its `?set=` parameter.
 *
 * ALLOW-LISTED AGAINST THE DECLARED SETS, never taken as given, and that is the
 * whole reason this is a function. The set id is interpolated straight into a
 * filesystem path — `card-art/sets/{set}/photos/{id}.jpg` — so an unchecked
 * parameter is a directory traversal with a photo upload attached to it.
 * Matching against SET_IDS means the only reachable directories are the four
 * the tool declares.
 *
 * An absent or unknown set falls back to the set being built, which is what
 * every request looked like before the studio had more than one.
 */
/**
 * The strategy deck is not a card SET (it has no players, no rarity bands, no
 * collection) but it IS a photo scope: the studio's `strats` source composes a
 * face from strats.js and takes its art from card-art/sets/strats/photos/.
 * Until 2026-09-06 that scope was never allow-listed here, so `?set=strats`
 * fell back to the set being built — the studio listed the 2026-27 photos
 * against strategy-card ids (always "no photo yet"), and a photo dropped on a
 * strat row would have been written into the 2026-27 folder.
 */
export const STRATS_SCOPE = 'strats';
export const STUDIO_SCOPES = [...SET_IDS, STRATS_SCOPE];
const scopeIsEditable = id => id === STRATS_SCOPE || isEditableSet(id);

export function requestedSet(url, sets = STUDIO_SCOPES) {
  const asked = new URL(url ?? '/', 'http://studio.local').searchParams.get('set');
  return sets.includes(asked) ? asked : CURRENT_SET;
}

function ensureDirs(paths) {
  for (const dir of [paths.art, paths.photos]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/**
 * Reads a JSON file, falling back rather than throwing.
 *
 * A corrupt crops.json must not take the whole dev server down — the studio
 * still needs to boot so the file can be fixed or re-saved from the UI.
 */
function readJsonFile(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * A playerId is interpolated straight into a filesystem path, so it must not be
 * able to escape the set's photos/ directory. Real ids look like "Nikola_Jokic".
 */
export function isSafePlayerId(id) {
  return typeof id === 'string' && id.length > 0 && /^[A-Za-z0-9_.-]+$/.test(id) && !id.includes('..');
}

/** Wraps a handler so a thrown error becomes a JSON 500, not a dead socket. */
function guard(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  };
}

export function studioServerPlugin() {
  return {
    name: 'card-studio-server',
    apply: 'serve',
    configureServer(server) {
      // One directory tree per set, all created up front. Creating them lazily
      // on first write would work, but the studio reads state before it ever
      // writes, and an absent directory there is indistinguishable from a set
      // with no photos yet — so the reads would be fine and the FIRST DROP
      // would be the thing that had to create a directory, which is the worst
      // moment for it to fail.
      const forSet = Object.fromEntries(
        STUDIO_SCOPES.map(id => [id, studioPaths(server.config.root, id)])
      );
      for (const id of STUDIO_SCOPES) ensureDirs(forSet[id]);
      const pathsFor = req => forSet[requestedSet(req.url)] ?? forSet[CURRENT_SET];
      // The un-scoped card-art/ root, the traversal boundary for static serving.
      const paths = forSet[CURRENT_SET];

      // The app ships under `base: '/nba-showdown-2k25/'`, so Vite only serves
      // studio.html at /nba-showdown-2k25/studio.html and 404s the bare path.
      // Nobody is going to remember that, so redirect the obvious URL.
      server.middlewares.use('/studio.html', (req, res, next) => {
        if (req.originalUrl?.startsWith(server.config.base)) return next();
        res.statusCode = 302;
        res.setHeader('Location', `${server.config.base}studio.html`);
        res.end();
      });

      // GET the studio's whole persisted state in one round trip.
      server.middlewares.use(
        '/__studio/state',
        guard((req, res) => {
          // Per set, from `?set=`. The studio re-reads this whenever the set
          // selector changes, so switching sets swaps the whole photo/crop/
          // team-override world rather than showing one set's work against
          // another's roster.
          const scope = pathsFor(req);
          const photos = existsSync(scope.photos)
            ? readdirSync(scope.photos).filter(f => ALLOWED_PHOTO_EXT.has(extname(f).toLowerCase()))
            : [];
          json(res, 200, {
            set: scope.set,
            photos: photos.map(playerIdFromFile),
            // The extension each of those files is ACTUALLY stored under.
            //
            // Sent alongside `photos` rather than folded into it because the
            // id list is what every "does this player have a photo yet?" check
            // in the studio reads, and changing its shape would touch all of
            // them. This map is additive: ignore it and the studio behaves
            // exactly as before, read it and the photo URL can point at the
            // real file. Only entries that are not the default are worth
            // sending, but sending all of them keeps the consumer trivial.
            photoExt: photoExtMap(photos),
            crops: readJsonFile(scope.crops, {}),
            teamOverrides: readJsonFile(scope.teams, {}),
            // EVERY SCOPE'S PHOTO IDS, not just this one's — what the set bar
            // needs to auto-hide a set that is finished (the user, 2026-09-07).
            // Ids rather than counts, because two SOURCES can share one set's
            // folder and "is this source complete" is an intersection with
            // that source's own player list, not a file count. Fourteen
            // readdirs on localhost for a dev tool is not a cost worth an
            // endpoint of its own.
            allPhotos: Object.fromEntries(
              STUDIO_SCOPES.map(id => {
                const dir = forSet[id]?.photos;
                const files = dir && existsSync(dir)
                  ? readdirSync(dir).filter(f => ALLOWED_PHOTO_EXT.has(extname(f).toLowerCase()))
                  : [];
                return [id, files.map(playerIdFromFile)];
              })
            ),
          });
        })
      );

      // POST raw image bytes for one player. The body is written untouched —
      // crop is metadata (see src/cards/photo.js), so the source file dropped
      // here stays byte-identical forever.
      server.middlewares.use(
        '/__studio/photo',
        guard(async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
          const playerId = new URL(req.url, 'http://studio.local').searchParams.get('playerId');
          if (!isSafePlayerId(playerId)) return json(res, 400, { error: 'invalid playerId' });
          const scope = pathsFor(req);
          // THE LAST LINE OF DEFENCE on the read-only set. The studio already
          // refuses the drag and refuses the upload, but the id spaces of the
          // sets overlap by design — every set derives ids with the same rule —
          // so a request that got here for the finished 2025-26 set would write
          // a photo into a set that is not supposed to change.
          if (!scopeIsEditable(scope.set)) {
            return json(res, 403, { error: `the ${scope.set} set is read-only` });
          }
          const body = await readBody(req);
          if (!body.length) return json(res, 400, { error: 'empty body' });
          writeFileSync(resolve(scope.photos, `${playerId}.jpg`), body);
          json(res, 200, { ok: true, set: scope.set, playerId, bytes: body.length });
        })
      );

      /**
       * `editableOnly` is false for exactly one route, and the asymmetry is the
       * same one the studio UI already draws.
       *
       * Crops are keyed by PLAYER ID, and every set derives ids with the same
       * rule — so a crop saved while the finished set is on screen would land
       * on whichever player of the editable set happens to share that name.
       * That is what the read-only rule is protecting against.
       *
       * Team colours are keyed by FRANCHISE. There are thirty of them, they
       * mean the same thing in every set, and each set keeps its own file, so
       * tuning the Bulls' red while judging the template against the finished
       * cards is both safe and the point of having the finished cards there.
       */
      const writeJsonRoute = (pick, { editableOnly = true } = {}) =>
        guard(async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
          const scope = pathsFor(req);
          if (editableOnly && !scopeIsEditable(scope.set)) {
            return json(res, 403, { error: `the ${scope.set} set is read-only` });
          }
          const raw = (await readBody(req)).toString('utf-8');
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (err) {
            return json(res, 400, { error: `invalid JSON: ${err.message}` });
          }
          writeFileSync(pick(scope), JSON.stringify(parsed, null, 2) + '\n');
          json(res, 200, { ok: true, set: scope.set });
        });

      server.middlewares.use('/__studio/crops', writeJsonRoute(s => s.crops));
      server.middlewares.use(
        '/__studio/teams',
        writeJsonRoute(s => s.teams, { editableOnly: false })
      );

      // Serve card-art/ back to the browser.
      //
      // Vite's own static middleware would do this, but it runs AFTER the base
      // middleware, so it only ever sees `/nba-showdown-2k25/card-art/...`.
      // src/cards/photo.js resolves photos to the bare
      // `/card-art/sets/{set}/photos/{id}.jpg` because that is also the path
      // the production-independent export uses, so serve that path directly
      // here. Mounted on the un-scoped root so every set stays reachable.
      server.middlewares.use(
        `/${ART_ROOT}`,
        guard((req, res, next) => {
          const rel = decodeURIComponent(new URL(req.url, 'http://studio.local').pathname).replace(
            /^\/+/,
            ''
          );
          const file = resolve(paths.art, rel);
          // resolve() collapses any "..", so this containment check is the real
          // traversal guard, not the regex above.
          if (file !== paths.art && !file.startsWith(paths.art + sep)) {
            return json(res, 403, { error: 'outside card-art' });
          }
          if (!existsSync(file) || !statSync(file).isFile()) return next();
          res.setHeader('Content-Type', CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
          // no-store, not no-cache: these files are rewritten in place under an
          // unchanged name, and `no-cache` still permits the browser to serve
          // the bytes it already decoded. The URL's ?v= token (see
          // src/cards/photo.js) is the real fix; this is the belt to its
          // braces, and costs nothing on a dev server.
          res.setHeader('Cache-Control', 'no-store, must-revalidate');
          res.end(readFileSync(file));
        })
      );
    },
  };
}
