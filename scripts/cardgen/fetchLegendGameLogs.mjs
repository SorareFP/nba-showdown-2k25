// Game logs for the force-included legends (card-data/legends-2026.json).
//
// Same shape as fetchSpecialGameLogs: one polite request per (player, season),
// cached under `gamelog-full-{id}-{season}` exactly like every other historical
// card's log, so realGames.loadSeasonRealGames finds them with no special case.
//
// Player ids are resolved from the season's own cached advanced table rather
// than guessed from the name — bbref ids carry a disambiguating suffix
// (johnsma02 is Magic, johnsma01 is someone else entirely) and a wrong id
// silently fetches a different player's career.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache, writeCache, politeDelay, DEFAULT_REQUEST_SPACING_MS } from './cache.js';
import { fetchGameLogFull } from './sources/basketballReference.js';
import { readLegends } from './legends.js';

const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function resolveId(name, season) {
  const adv = readCache(`bbref-${season}-advanced-full`);
  const rows = Array.isArray(adv) ? adv : adv?.rows ?? [];
  const hit = rows.find(r => norm(r.name || '') === norm(name));
  return hit?.playerId ?? null;
}

const legends = readLegends();
console.log(`legends to fetch: ${legends.length}`);

let fetched = 0;
let cached = 0;
const failed = [];
for (const { name, season } of legends) {
  const id = resolveId(name, season);
  if (!id) {
    failed.push(`${name} ${season}: no player id in bbref-${season}-advanced-full`);
    continue;
  }
  const key = `gamelog-full-${id}-${season}`;
  if (readCache(key)) { cached += 1; continue; }
  try {
    writeCache(key, await fetchGameLogFull(id, season));
    fetched += 1;
    console.log(`  ${name} ${season} (${id})`);
    await politeDelay(DEFAULT_REQUEST_SPACING_MS);
  } catch (e) {
    failed.push(`${name} ${season} (${id}): ${e.message}`);
    await politeDelay(DEFAULT_REQUEST_SPACING_MS);
  }
}
console.log(`done: ${fetched} fetched, ${cached} cached, ${failed.length} failed`);
if (failed.length) console.log(failed.join('\n'));
