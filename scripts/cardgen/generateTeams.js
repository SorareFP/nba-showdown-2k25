// Run: node scripts/cardgen/generateTeams.js
//
// Fetches nba.com's active roster and writes every pool player's REAL current
// team to card-data/generated/player-teams-2026.json — the file the studio and
// the batch export read instead of the raw pool, because the raw pool has 45
// players sitting on Basketball-Reference's "2TM"/"3TM" aggregate codes.
//
// Not unit-tested: it is I/O and a network fetch around resolveTeams.js, which
// is. Re-runnable at any time; a mid-season trade just means running it again.
//
// THE ONE NUMBER THAT MATTERS is "multi-team codes after: 0". Anything else
// means a card is going to print with no logo and no colors.
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchRoster } from './sources/nbaRoster.js';
import { resolvePlayerTeams, isMultiTeamCode } from './resolveTeams.js';

const root = new URL('../../', import.meta.url);
const readJson = p => JSON.parse(readFileSync(new URL(p, root), 'utf-8'));

const pool = readJson('card-data/generated/player-pool-2026.json');
// The "_comment" key documents the file for whoever opens it next; it is not a
// player. Dropping it here rather than in resolveTeams keeps the resolver a
// pure function over plain data.
const { _comment, ...manual } = readJson('card-data/manual-teams.json');

const roster = await fetchRoster();
console.log(`nba.com roster: ${roster.length} active players`);

const before = pool.filter(p => isMultiTeamCode(p.team)).length;
const { resolved, unresolved, stats } = resolvePlayerTeams(pool, roster, manual);
const after = resolved.filter(p => isMultiTeamCode(p.team)).length;

console.log(`pool: ${pool.length} | resolved: ${resolved.length} | unresolved: ${unresolved.length}`);
// Per-path, not just a total: a matcher regression that pushed 40 players from
// the roster path onto the pool fallback would leave the total untouched and
// every one of those cards subtly wrong.
console.log('  resolution paths:');
console.log(`    nba.com roster match : ${stats.roster}`);
console.log(`    pool team (fallback) : ${stats.poolFallback}`);
console.log(`    manual override      : ${stats.manual}`);
console.log(`    unresolved           : ${stats.unresolved}`);
console.log(`    ambiguous name keys  : ${stats.ambiguous}`);
console.log(`multi-team codes before: ${before} | after: ${after}`);
if (unresolved.length) {
  console.log('unresolved (need card-data/manual-teams.json entries):', unresolved);
}

writeFileSync(
  new URL('card-data/generated/player-teams-2026.json', root),
  JSON.stringify(resolved, null, 2) + '\n'
);
console.log('wrote card-data/generated/player-teams-2026.json');

// Exit non-zero so a CI run or a shell `&&` chain can't sail past the failure
// this whole script exists to prevent.
if (after > 0) {
  console.error(
    `FAILED: ${after} player(s) still carry a multi-team aggregate code. Those cards cannot be ` +
      'themed. Investigate before using this file.'
  );
  process.exit(1);
}
