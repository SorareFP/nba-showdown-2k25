// A disk cache for everything the generators fetch.
//
// WHY IT EXISTS: Basketball-Reference throttles aggressively (a burst of
// game-log requests earns a 429 and a cooling-off period), and dunksandthrees
// is a small site being scraped by courtesy rather than by contract. Every
// network read in scripts/cardgen/ goes through here so that re-running a
// generator — which happens constantly while calibrating — costs nothing and
// asks nothing of either site.
//
// The cache holds NORMALIZED JSON, not raw HTML. Two reasons: the raw pages are
// megabytes each and would swamp the repo, and a cached parse is only useful if
// the parser that produced it is the one still in use. When a parser changes,
// delete the affected cache file — that is the intended invalidation, and it is
// why every entry records the URL and the fetch date it came from.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root — scripts/cardgen/ is two levels down. */
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const CACHE_DIR = path.join(REPO_ROOT, 'card-data', 'cache');

export function cachePath(key) {
  if (!/^[A-Za-z0-9._-]+$/.test(key)) {
    throw new Error(`cache key must be a bare filename-safe token, got ${JSON.stringify(key)}`);
  }
  return path.join(CACHE_DIR, `${key}.json`);
}

export function readCache(key) {
  const file = cachePath(key);
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return parsed.data;
}

export function writeCache(key, data, meta = {}) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const body = { fetchedAt: new Date().toISOString(), ...meta, data };
  fs.writeFileSync(cachePath(key), `${JSON.stringify(body, null, 1)}\n`);
  return data;
}

/**
 * Cache-through: returns the cached value if present, otherwise calls `produce`
 * and stores what it returns.
 *
 * `force` re-fetches even on a hit, for the one case that matters — a parser
 * change, where the cached value is stale in a way the key cannot express.
 */
export async function cached(key, produce, { force = false, meta = {} } = {}) {
  if (!force) {
    const hit = readCache(key);
    if (hit !== null && hit !== undefined) return hit;
  }
  const value = await produce();
  return writeCache(key, value, meta);
}

/**
 * Sleeps between requests. Basketball-Reference's published guidance is at most
 * twenty requests a minute; this is deliberately slower than that, because the
 * only cost of being slow here is a one-off calibration run that nothing waits
 * on, and the cost of being fast is a temporary IP block.
 */
export const politeDelay = ms => new Promise(resolve => setTimeout(resolve, ms));
export const DEFAULT_REQUEST_SPACING_MS = 5500;
