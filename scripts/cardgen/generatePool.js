// Run: node scripts/cardgen/generatePool.js
//
// Builds card-data/generated/player-pool-2026.json — the spine of the whole set.
// Everything downstream (generateTeams, speedPower, generateCards, the studio's
// player list) reads that file, so this is the only place the question "who gets
// a card" is answered.
//
// WHY THIS SCRIPT EXISTS AT ALL. The pool was originally produced by an ad-hoc
// one-off against Basketball-Reference and committed; the code that made it was
// never kept. That was survivable while the answer was a pure function of a
// published table, and stopped being survivable the moment the pool gained a
// CURATED component — the force-include list, which someone will edit again.
// Rebuilding the file now has to be a command, not an archaeology exercise.
//
// It reproduces the previously committed 331 EXACTLY, byte for byte, before the
// force-include list is applied: same rule, same source, same stable sort
// (descending MPG, source-table order preserved within ties). That was verified
// against the committed file, and it is what makes the diff of a re-run readable
// — the only lines that move are the ones that should have.
//
// NETWORK: one request to Basketball-Reference. Deliberately NOT cached through
// cache.js, unlike every other fetch here: this runs when the pool rule or the
// force-include list changes, which is rarely, and a stale cached pool is a much
// worse failure than a slow one — it would quietly card last month's league.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './cache.js';
import { readForceInclude } from './forceInclude.js';
import { readCarryForward, resolveCarryForward } from './carryForward.js';
import { normalizeName } from './resolveTeams.js';
import {
  fetchPerGameStats,
  filterPlayerPool,
  forcedOnly,
  unmatchedForceIncludes,
} from './sources/playerPool.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, 'player-pool-2026.json');

/** The decided rule. See memory/new_season_player_pool.md. */
export const POOL_RULE = { minMpg: 12, minGames: 40 };

/** End-year of the season the pool is drawn from. 2026 = the 2025-26 season. */
export const POOL_SEASON = 2026;

/**
 * Descending MPG, ties left in source-table order.
 *
 * Array.prototype.sort is stable per spec, so this is deterministic — which is
 * the point: the file is committed and re-generated, and an unstable tie-break
 * would churn dozens of lines on every run for no reason.
 */
export const byMinutesDescending = players => [...players].sort((a, b) => b.mpg - a.mpg);

export function buildPool(allPlayers, { rule = POOL_RULE, forceInclude = [] } = {}) {
  const names = forceInclude.map(f => f.name ?? f);
  const opts = { ...rule, forceInclude: names };
  return {
    pool: byMinutesDescending(filterPlayerPool(allPlayers, opts)),
    byRule: filterPlayerPool(allPlayers, { ...rule, forceInclude: [] }).length,
    forced: forcedOnly(allPlayers, opts),
    unmatched: unmatchedForceIncludes(allPlayers, names),
  };
}

export async function main({ log = console.log } = {}) {
  const forceInclude = readForceInclude();
  const all = await fetchPerGameStats(POOL_SEASON);
  const { pool, byRule, forced, unmatched } = buildPool(all, { forceInclude });

  // CARRIED-FORWARD PLAYERS join the pool even though no 2025-26 row exists for
  // them, because the pool is what the studio takes a player's IDENTITY from —
  // a card nobody can find in the studio cannot be given a photo. Their STATS
  // come from their last healthy season instead; generateCards skips them in
  // the normal build for exactly that reason. See carryForward.js.
  const carried = resolveCarryForward(readCarryForward());
  for (const c of carried.resolved) {
    if (pool.some(p => normalizeName(p.name) === normalizeName(c.name))) continue;
    pool.push({
      name: c.name,
      team: c.team,
      pos: c.row.position ?? 'SF',
      games: c.row.games ?? 0,
      mpg: Number((c.row.mpg ?? 0).toFixed(1)),
      carriedFrom: c.season,
    });
  }

  // Two-space indent, matching the file as it was first committed. Not
  // cosmetic: re-indenting rewrites all 2,450 lines, and a diff that touches
  // every line is a diff nobody reads — which is exactly how a wrong player
  // would get through review.
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(pool, null, 2)}\n`);

  const reasons = new Map(forceInclude.map(f => [f.name, f.reason]));
  log(`${pool.length} players -> ${path.relative(REPO_ROOT, OUTPUT_FILE)}`);
  log(
    `  ${all.length} in the league table | ${byRule} pass MPG>=${POOL_RULE.minMpg} & ` +
      `G>=${POOL_RULE.minGames} | ${forced.length} added by the force-include list`
  );
  for (const p of forced) {
    log(
      `    ${p.name.padEnd(24)} ${String(p.games).padStart(2)} G ${String(p.mpg).padStart(4)} MPG  ` +
        `${p.team.padEnd(3)} ${(p.pos ?? '').padEnd(2)}  ${reasons.get(p.name) ?? ''}`
    );
  }

  // A named player who matches no row is the one failure mode this file can have
  // that produces no visible symptom — the pool is simply one player short and
  // nothing says so. Loud, and non-zero exit, for the same reason generateTeams
  // exits non-zero on an unresolved team.
  if (unmatched.length) {
    log('');
    console.error(
      `FAILED: ${unmatched.length} force-include name(s) match no row in the ${POOL_SEASON} ` +
        `per-game table: ${unmatched.join(', ')}. Check the spelling in ` +
        'card-data/force-include-2026.json against Basketball-Reference.'
    );
    process.exitCode = 1;
  }
  return pool;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
