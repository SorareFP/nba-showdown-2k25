// Game logs for the special sets: every card in Super Season, Rookie,
// Summer Standouts and Dissonance names its own bbrefId + season, so the
// fetch list is just the distinct pairs. Cached under the same
// `gamelog-full-{id}-{season}` keys the base-set fetch uses; resumable.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache, writeCache, politeDelay, DEFAULT_REQUEST_SPACING_MS } from './cache.js';
import { fetchGameLogFull } from './sources/basketballReference.js';

const GEN = path.join(REPO_ROOT, 'card-data', 'generated');
const SETS = ['cards-super-season.json', 'cards-rookie.json', 'cards-summer-standouts.json', 'cards-dissonance.json'];

const pairs = new Map(); // "id|season" -> {id, season, names:Set}
for (const f of SETS) {
  const body = JSON.parse(fs.readFileSync(path.join(GEN, f), 'utf8'));
  for (const c of body.cards) {
    if (!c.bbrefId || !c.season) continue;
    const k = `${c.bbrefId}|${c.season}`;
    if (!pairs.has(k)) pairs.set(k, { id: c.bbrefId, season: c.season, names: new Set() });
    pairs.get(k).names.add(c.name);
  }
}
console.log(`distinct (player, season) pairs: ${pairs.size}`);

let fetched = 0;
let cached = 0;
const failed = [];
for (const { id, season, names } of pairs.values()) {
  const key = `gamelog-full-${id}-${season}`;
  if (readCache(key)) { cached += 1; continue; }
  try {
    const log = await fetchGameLogFull(id, season);
    writeCache(key, log);
    fetched += 1;
    if (fetched % 25 === 0) console.log(`...${fetched} fetched (${[...names][0]} ${season})`);
    await politeDelay(DEFAULT_REQUEST_SPACING_MS);
  } catch (e) {
    failed.push(`${[...names][0]} ${season} (${id}): ${e.message}`);
    await politeDelay(DEFAULT_REQUEST_SPACING_MS);
  }
}
fs.writeFileSync(
  path.join(GEN, 'special-gamelogs-index.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), pairs: pairs.size, fetched, cached, failed }, null, 2)
);
console.log(`done: ${fetched} fetched, ${cached} cached, ${failed.length} failed`);
if (failed.length) console.log(failed.slice(0, 10).join('\n'));
