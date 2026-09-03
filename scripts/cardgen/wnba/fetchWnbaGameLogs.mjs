// Game logs for the WNBA sets: every card names its bbrefId + season, so the
// fetch list is the distinct pairs across all three files. Cached under
// `gamelog-wnba-{id}-{season}`; resumable, politeDelay spacing.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache, writeCache, politeDelay, DEFAULT_REQUEST_SPACING_MS } from '../cache.js';
import { fetchWnbaGameLogFull } from '../sources/basketballReference.js';

const GEN = path.join(REPO_ROOT, 'card-data', 'generated');
const SETS = ['cards-wnba.json', 'cards-wnba-super-season.json', 'cards-wnba-rookie.json'];

const pairs = new Map();
for (const f of SETS) {
  const body = JSON.parse(fs.readFileSync(path.join(GEN, f), 'utf8'));
  for (const c of body.cards) {
    if (!c.bbrefId || !c.season) continue;
    const k = `${c.bbrefId}|${c.season}`;
    if (!pairs.has(k)) pairs.set(k, { id: c.bbrefId, season: c.season, name: c.name });
  }
}
console.log(`distinct WNBA (player, season) pairs: ${pairs.size}`);

let fetched = 0;
let cached = 0;
const failed = [];
for (const { id, season, name } of pairs.values()) {
  const key = `gamelog-wnba-${id}-${season}`;
  if (readCache(key)) { cached += 1; continue; }
  try {
    const log = await fetchWnbaGameLogFull(id, season);
    writeCache(key, log);
    fetched += 1;
    if (fetched % 25 === 0) console.log(`...${fetched} fetched (${name} ${season})`);
    await politeDelay(DEFAULT_REQUEST_SPACING_MS);
  } catch (e) {
    failed.push(`${name} ${season} (${id}): ${e.message}`);
    await politeDelay(DEFAULT_REQUEST_SPACING_MS);
  }
}
fs.writeFileSync(
  path.join(GEN, 'wnba-gamelogs-index.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), pairs: pairs.size, fetched, cached, failed }, null, 2)
);
console.log(`done: ${fetched} fetched, ${cached} cached, ${failed.length} failed`);
if (failed.length) console.log(failed.slice(0, 10).join('\n'));
