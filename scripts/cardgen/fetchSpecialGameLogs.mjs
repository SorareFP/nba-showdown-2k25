// Game logs for the special sets: every card in Super Season, Rookie,
// Summer Standouts, Dissonance and Team Rewards names its own bbrefId +
// season, so the fetch list is just the distinct pairs. Cached under the same
// `gamelog-full-{id}-{season}` keys the base-set fetch uses; resumable.
//
// TEAM REWARDS WERE ADDED LATE and the omission had a price. Without a log the
// generator falls back to per-100 season rates, which smooth a chart toward the
// mean instead of cutting it from real games — and assists are a CURRENCY in
// the pricing model, so the smoothing showed up as money. The reward set's
// median assist row sat at 0.75 against 0.00-0.25 everywhere else, and
// DeMarcus Cousins priced above Wembanyama on the strength of it.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache, writeCache, politeDelay, DEFAULT_REQUEST_SPACING_MS } from './cache.js';
import { fetchGameLogFull } from './sources/basketballReference.js';

const GEN = path.join(REPO_ROOT, 'card-data', 'generated');
const SETS = [
  'cards-super-season.json', 'cards-rookie.json', 'cards-summer-standouts.json',
  'cards-dissonance.json', 'cards-team-rewards.json',
  // The curated throwbacks (2026-09-22): generator-owned, cut from real games too.
  'cards-throwbacks.json',
];

// `--only walljo01:2011,brandel01:2000` fetches EXACTLY those pairs and no
// others (2026-09-22): a season the sets are ABOUT to card has no card yet to
// be read off the files above, and the reward batch needed three rookie logs
// cached BEFORE generateSpecialSets ran, so none shipped provisional. The
// index file is left alone in this mode — it describes a full sweep.
const onlyArg = process.argv.find(a => a.startsWith('--only='))?.slice('--only='.length)
  ?? (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null);
const only = onlyArg
  ? onlyArg.split(',').map(p => { const [id, season] = p.split(':'); return { id, season: Number(season) }; })
  : null;

const pairs = new Map(); // "id|season" -> {id, season, names:Set}
if (only) {
  for (const { id, season } of only) {
    if (!id || !Number.isFinite(season)) throw new Error(`--only wants id:season pairs, got "${onlyArg}"`);
    pairs.set(`${id}|${season}`, { id, season, names: new Set([id]) });
  }
} else {
  for (const f of SETS) {
    if (!fs.existsSync(path.join(GEN, f))) continue;
    const body = JSON.parse(fs.readFileSync(path.join(GEN, f), 'utf8'));
    for (const c of body.cards) {
      if (!c.bbrefId || !c.season) continue;
      const k = `${c.bbrefId}|${c.season}`;
      if (!pairs.has(k)) pairs.set(k, { id: c.bbrefId, season: c.season, names: new Set() });
      pairs.get(k).names.add(c.name);
    }
  }
}
console.log(`distinct (player, season) pairs: ${pairs.size}${only ? ' (--only)' : ''}`);

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
if (!only) {
  fs.writeFileSync(
    path.join(GEN, 'special-gamelogs-index.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), pairs: pairs.size, fetched, cached, failed }, null, 2)
  );
}
console.log(`done: ${fetched} fetched, ${cached} cached, ${failed.length} failed`);
if (failed.length) console.log(failed.slice(0, 10).join('\n'));
