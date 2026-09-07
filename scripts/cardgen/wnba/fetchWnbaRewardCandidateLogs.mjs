// Game logs for the WNBA reward SHORTLIST, so those cards can be built.
//
//   node scripts/cardgen/wnba/wnbaRewardCandidates.js          # rank first
//   node scripts/cardgen/wnba/fetchWnbaRewardCandidateLogs.mjs
//
// Twelve of the fifteen WNBA franchises are getting a reward card. Five can be
// filled by MOVING a card out of WNBA Super Season or WNBA Rookie, the way the
// NBA rewards were. The other seven have nothing in those sets that lands in
// their earned band, so their cards have to be BUILT — and a WNBA card is built
// from a real game log, of which only the 216 pairs behind the current sets are
// cached.
//
// The shortlist is the top of each franchise's BPM ranking. Wide enough that
// the band can be hit after pricing, narrow enough to be one polite pass.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache, writeCache, politeDelay, DEFAULT_REQUEST_SPACING_MS } from '../cache.js';
import { fetchWnbaGameLogFull } from '../sources/basketballReference.js';

const CANDIDATES = path.join(REPO_ROOT, 'card-data', 'generated', 'wnba-reward-candidates.json');
const PER_FRANCHISE = 25;

if (!fs.existsSync(CANDIDATES)) {
  console.error('No candidate file. Run: node scripts/cardgen/wnba/wnbaRewardCandidates.js');
  process.exit(1);
}
const { byFranchise } = JSON.parse(fs.readFileSync(CANDIDATES, 'utf8'));

// Named franchises only, when any are given. Five of the twelve can be filled
// by MOVING a card out of WNBA Super Season or WNBA Rookie and need no logs at
// all, so fetching all fifteen is most of an hour spent on cards that will
// never be built.
const only = new Set(process.argv.slice(2).filter(a => !a.startsWith('-')));
const pairs = new Map();
for (const [franchise, rows] of Object.entries(byFranchise)) {
  if (only.size && !only.has(franchise)) continue;
  for (const r of rows.slice(0, PER_FRANCHISE)) {
    if (!r.playerId) continue;
    pairs.set(`${r.playerId}|${r.season}`, r);
  }
}
console.log(`shortlist: ${pairs.size} (player, season) pairs, max ${PER_FRANCHISE} per franchise`);

let fetched = 0;
let cached = 0;
const failed = [];
for (const r of pairs.values()) {
  const key = `gamelog-wnba-${r.playerId}-${r.season}`;
  if (readCache(key)) { cached += 1; continue; }
  try {
    writeCache(key, await fetchWnbaGameLogFull(r.playerId, r.season));
    fetched += 1;
    if (fetched % 25 === 0) console.log(`...${fetched} fetched (${r.name} ${r.season})`);
    await politeDelay(DEFAULT_REQUEST_SPACING_MS);
  } catch (e) {
    failed.push(`${r.name} ${r.season} (${r.playerId}): ${e.message}`);
    await politeDelay(DEFAULT_REQUEST_SPACING_MS);
  }
}
fs.writeFileSync(
  path.join(REPO_ROOT, 'card-data', 'generated', 'wnba-reward-candidate-logs.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), pairs: pairs.size, fetched, cached, failed }, null, 2)}\n`
);
console.log(`done: ${fetched} fetched, ${cached} cached, ${failed.length} failed`);
if (failed.length) console.log('  ' + failed.slice(0, 15).join('\n  '));
