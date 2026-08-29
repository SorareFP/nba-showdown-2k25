// Vite dev-server middleware backing the Card Studio's file persistence.
//
// DEV ONLY. Registered with `apply: 'serve'`, so it is never part of a `vite
// build` and cannot reach production. Every write it performs is inside
// card-art/.
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

const ALLOWED_PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

/** Every path the studio is allowed to touch, derived from the Vite root. */
function studioPaths(root) {
  const art = resolve(root, 'card-art');
  return {
    art,
    photos: resolve(art, 'photos'),
    crops: resolve(art, 'crops.json'),
    teams: resolve(art, 'team-overrides.json'),
  };
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
 * able to escape card-art/photos/. Real card ids look like "Nikola_Jokic".
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
      const paths = studioPaths(server.config.root);
      ensureDirs(paths);

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
          const photos = existsSync(paths.photos)
            ? readdirSync(paths.photos).filter(f => ALLOWED_PHOTO_EXT.has(extname(f).toLowerCase()))
            : [];
          json(res, 200, {
            photos: photos.map(f => f.replace(/\.[^.]+$/, '')),
            crops: readJsonFile(paths.crops, {}),
            teamOverrides: readJsonFile(paths.teams, {}),
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
          const body = await readBody(req);
          if (!body.length) return json(res, 400, { error: 'empty body' });
          writeFileSync(resolve(paths.photos, `${playerId}.jpg`), body);
          json(res, 200, { ok: true, playerId, bytes: body.length });
        })
      );

      const writeJsonRoute = file =>
        guard(async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
          const raw = (await readBody(req)).toString('utf-8');
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (err) {
            return json(res, 400, { error: `invalid JSON: ${err.message}` });
          }
          writeFileSync(file, JSON.stringify(parsed, null, 2) + '\n');
          json(res, 200, { ok: true });
        });

      server.middlewares.use('/__studio/crops', writeJsonRoute(paths.crops));
      server.middlewares.use('/__studio/teams', writeJsonRoute(paths.teams));

      // Serve card-art/ back to the browser.
      //
      // Vite's own static middleware would do this, but it runs AFTER the base
      // middleware, so it only ever sees `/nba-showdown-2k25/card-art/...`.
      // src/cards/photo.js resolves photos to the bare `/card-art/photos/{id}.jpg`
      // because that is also the path the production-independent export uses,
      // so serve that path directly here.
      server.middlewares.use(
        '/card-art',
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
          res.setHeader('Cache-Control', 'no-cache');
          res.end(readFileSync(file));
        })
      );
    },
  };
}
