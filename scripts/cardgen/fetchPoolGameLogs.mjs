// Fetches the LAST-82-WINDOW game logs for every player in the 2026-27 pool:
// the 2025-26 season page (regular + playoffs in one request), plus the
// 2024-25 page for anyone whose 2025-26 games don't reach 82. Every page is
// cached (`gamelog-full-{playerId}-{season}`), so the job is resumable — rerun
// it after any failure and it picks up where it stopped.
//
// Rate courtesy: DEFAULT_REQUEST_SPACING_MS between UNCACHED requests, the
// same spacing every other Basketball-Reference job in this repo uses.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache, writeCache, politeDelay, DEFAULT_REQUEST_SPACING_MS } from './cache.js';
import { fetchSeasonTable, fetchGameLogFull } from './sources/basketballReference.js';

const SEASON = 2026; // 2025-26, the season the 2026-27 set is built on
const PRIOR = 2025;
const WINDOW = 82;

const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[.']/g, '').replace(/\s+(jr|sr|ii|iii|iv)$/i, '').trim();

const cards = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'card-data/generated/cards-2026-27.json'), 'utf8')
).cards;

async function seasonIds(season) {
  const key = `bbref-pergame-ids-${season}`;
  const hit = readCache(key);
  if (hit) return hit;
  const rows = await fetchSeasonTable(season, 'perGame');
  const out = rows.map(r => ({ playerId: r.playerId, name: r.name }));
  writeCache(key, out);
  await politeDelay(DEFAULT_REQUEST_SPACING_MS);
  return out;
}

const ids = new Map();
for (const season of [SEASON, PRIOR]) {
  for (const r of await seasonIds(season)) {
    const k = norm(r.name);
    if (!ids.has(k)) ids.set(k, r.playerId);
  }
}

const index = {};
const missing = [];
let fetched = 0;
let cached = 0;

for (const card of cards) {
  const pid = ids.get(norm(card.name));
  if (!pid) {
    missing.push(card.name);
    continue;
  }
  const seasons = {};
  let games = 0;
  for (const season of [SEASON, PRIOR]) {
    if (season === PRIOR && games >= WINDOW) break;
    const key = `gamelog-full-${pid}-${season}`;
    let log = readCache(key);
    if (!log) {
      try {
        log = await fetchGameLogFull(pid, season);
        writeCache(key, log);
        fetched += 1;
        if (fetched % 25 === 0) console.log(`...${fetched} pages fetched (${card.name})`);
        await politeDelay(DEFAULT_REQUEST_SPACING_MS);
      } catch (e) {
        console.error(`FAIL ${card.name} (${pid}, ${season}): ${e.message}`);
        break;
      }
    } else {
      cached += 1;
    }
    seasons[season] = { reg: log.reg.length, post: log.post.length };
    games += log.reg.length + log.post.length;
  }
  index[card.id] = { name: card.name, playerId: pid, seasons, games };
}

fs.writeFileSync(
  path.join(REPO_ROOT, 'card-data/generated/pool-gamelogs-index.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), window: WINDOW, missing, players: index }, null, 2)
);
const have = Object.values(index);
console.log(`\nindex written: ${have.length} players, ${fetched} fetched now, ${cached} from cache`);
console.log(`unmatched names (${missing.length}): ${missing.join('; ') || 'none'}`);
const short = have.filter(p => p.games < 60);
console.log(`players with <60 games in window: ${short.length}${short.length ? ' — ' + short.slice(0, 8).map(p => `${p.name} (${p.games})`).join(', ') : ''}`);
