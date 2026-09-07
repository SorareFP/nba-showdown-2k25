// Does every SUPER SEASON badge sit on a season that really was the best one?
//
//   node scripts/cardgen/auditSuperSeasonBadges.js
//   node scripts/cardgen/auditSuperSeasonBadges.js --all   # list every card checked
//
// ── WHY THIS NEEDS CHECKING AT ALL ──────────────────────────────────────────
//
// The badge used to be safe by construction: only the Super Season SET could
// print it, and that set IS "each player's best season". Three things have since
// broken the guarantee's single source.
//
//   1. BASE CARDS carry it when a player's best season is the current one, out
//      of card-badges.json rather than out of the set.
//   2. SUMMER STANDOUTS carries a `superSeasons` block that DISPLACES a Super
//      Season pick — same claim, different set.
//   3. TEAM REWARDS is mostly cards MOVED out of those sets, and three built
//      from scratch whose badges are decided by a separate code path.
//
// Four routes to one claim, and the claim is falsifiable. The user's rule:
// "make sure anything with a Super Season badge was that player's best season.
// We can still use non-best seasons, but just lose the badge."
//
// ── HOW A CAREER IS ASSEMBLED ───────────────────────────────────────────────
//
// `bbref-history` covers the current pool and nobody else, so a retired player
// is rebuilt from the cached per-season tables. Those start at 1985 (plus 1976
// and 1977), which is complete for everyone these sets card except a handful of
// pre-1985 careers — reported as UNVERIFIABLE rather than passed or failed,
// because a best-season claim over a career you cannot see is neither.
//
// ── AND THE DISTRIBUTIONS HAVE TO REACH JUST AS FAR ─────────────────────────
//
// A season is scored against ITS OWN league's spread, and `bbref-history` only
// carries distributions for 2000-2026 — the pool's own range. Handing
// `bestSeason` a career that starts in 1985 with nothing to score the 1980s
// against gives every early season a z of zero, so the comparison silently
// becomes "whichever season came first among the ties". That first version of
// this audit reported Michael Jordan's best season as 2002, on the Wizards,
// which is how the bug announced itself. The missing years are rebuilt here
// from the same cached tables using fetchHistory's own `seasonDistribution`,
// so the yardstick is the one the real pipeline uses rather than a second one.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from './cache.js';
import { bestSeason } from './history.js';
import { seasonDistribution } from './fetchHistory.js';
import { CARD_SETS } from '../../src/game/cardSets.js';
import { setBadge } from '../../src/cards/sets.js';
import { SUPER_SEASON_BADGE } from '../../src/cards/badges.js';

/** Cached season tables, oldest first. */
function cachedSeasons() {
  const dir = path.join(REPO_ROOT, 'card-data', 'cache');
  return fs
    .readdirSync(dir)
    .map(f => /^bbref-(\d{4})-advanced-full\.json$/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
}

const SEASONS = cachedSeasons();
const tableCache = new Map();

function seasonRows(season) {
  if (!tableCache.has(season)) {
    let rows = [];
    try {
      const c = readCache(`bbref-${season}-advanced-full`);
      rows = Array.isArray(c) ? c : c?.rows ?? c?.data ?? [];
    } catch { rows = []; }
    tableCache.set(season, rows);
  }
  return tableCache.get(season);
}

/** One row per season for a player id, from the tables. */
export function careerFromTables(playerId) {
  const out = [];
  for (const season of SEASONS) {
    const rows = seasonRows(season).filter(r => r.playerId === playerId);
    if (rows.length === 0) continue;
    out.push({ ...(rows.find(r => /TM$/.test(r.team ?? '')) ?? rows[0]), season });
  }
  return out;
}

export function audit({ log = console.log, showAll = false } = {}) {
  const history = readCache('bbref-history');
  const distributions = { ...(history?.seasons ?? {}) };
  let built = 0;
  for (const season of SEASONS) {
    if (distributions[season]) continue;
    const rows = seasonRows(season);
    if (rows.length === 0) continue;
    distributions[season] = seasonDistribution(rows);
    built += 1;
  }
  log(`Distributions: ${Object.keys(history?.seasons ?? {}).length} cached, ${built} rebuilt from the season tables.`);
  const archive = history?.rows ?? history?.data?.rows ?? [];
  const byId = new Map();
  for (const row of archive) {
    if (!byId.has(row.playerId)) byId.set(row.playerId, []);
    byId.get(row.playerId).push(row);
  }

  const claims = [];
  for (const [setId, cards] of Object.entries(CARD_SETS)) {
    const declared = setBadge(setId);
    for (const card of cards) {
      const carried = Array.isArray(card.badges) ? card.badges : [];
      // The claim is made either by the SET or by the CARD. `tierBadge` maps it
      // down to BEST SEASON under $900, but that is the same claim in a plainer
      // word — both are "this was his best" and both are checked.
      if (declared !== SUPER_SEASON_BADGE && !carried.includes(SUPER_SEASON_BADGE)) continue;
      // A CARD THAT HAS ALREADY DROPPED THE CLAIM IS NOT CLAIMING ANYTHING.
      // `notBestSeason` is what CardTemplate reads to suppress its set's badge,
      // so a flagged card prints no Super Season pill and there is nothing here
      // to verify. Without this the audit re-reports its own fix forever, and
      // `--fix` would never converge.
      if (card.notBestSeason) continue;
      if (!Number.isFinite(card.season)) continue;
      claims.push({ set: setId, card });
    }
  }

  const wrong = [];
  const unverifiable = [];
  let ok = 0;
  for (const { set, card } of claims) {
    const id = card.bbrefId ?? card.playerId;
    if (!id) { unverifiable.push({ set, card, why: 'card names no bbrefId' }); continue; }
    const career = byId.get(id)?.length ? byId.get(id) : careerFromTables(id);
    if (career.length === 0) { unverifiable.push({ set, card, why: 'no career rows' }); continue; }
    const first = career[0];
    if (first.season <= SEASONS[0] && (first.age ?? 0) > 23) {
      unverifiable.push({ set, card, why: `career opens at age ${first.age} in ${first.season}` });
      continue;
    }
    const { best } = bestSeason(career, distributions);
    if (best?.season === card.season) {
      ok += 1;
      if (showAll) log(`  ok   ${set.padEnd(18)} ${card.name} ${card.seasonLabel ?? card.season}`);
    } else {
      wrong.push({ set, card, best: best?.season ?? null });
    }
  }

  log(`\n${claims.length} cards claim SUPER SEASON.`);
  log(`  ${ok} verified as that player's best season`);
  log(`  ${unverifiable.length} unverifiable (career predates the cached tables)`);
  log(`  ${wrong.length} WRONG`);
  if (wrong.length) {
    log('\nThese carry the badge on a season that is not the best one:');
    for (const w of wrong) {
      log(`  ${w.set.padEnd(18)} ${w.card.name} ${w.card.seasonLabel ?? w.card.season} — best is ${w.best}`);
    }
  }
  if (unverifiable.length && showAll) {
    log('\nUnverifiable:');
    for (const u of unverifiable) log(`  ${u.set.padEnd(18)} ${u.card.name} — ${u.why}`);
  }
  return { claims: claims.length, ok, wrong, unverifiable };
}

/**
 * Drop the badge from the cards that do not deserve it.
 *
 * THE CARD STAYS. It is a real season, priced honestly, and somebody's card —
 * the only thing wrong is the claim printed on it. The user's rule exactly: "we
 * can still use non-best seasons, but just lose the badge."
 *
 * ── TWO DIFFERENT FIXES, BECAUSE THERE ARE TWO WAYS TO CARRY A BADGE ────────
 *
 * A Super Season card gets its pill from its SET, which declares one for every
 * card in it — so the card needs a way to decline, and that is `notBestSeason`,
 * read by CardTemplate. A migrated reward card is different: it left Super
 * Season and brought the badge with it in `card.badges`, where the set has no
 * say. There the fix is to remove the entry. Setting only the flag would leave
 * John Stockton still printing SUPER SEASON, and setting only the array would
 * leave every genuine Super Season card untouched.
 *
 * ── WHY THIS WRITES TO THE GENERATED FILE ──────────────────────────────────
 *
 * The generator is not wrong: it picked the best season it could SEE, and the
 * seasons it could not see are exactly the ones that came out wrong — careers
 * that start before the cached tables do. Re-running a generator clears the
 * flag, which is correct. The audit is the authority and belongs in the run
 * after any rebuild.
 */
function stamp(wrong, { log = console.log } = {}) {
  if (wrong.length === 0) {
    log('\nNothing to fix.');
    return 0;
  }
  const bySet = {};
  for (const w of wrong) (bySet[w.set] ??= new Set()).add(w.card.id);

  let total = 0;
  for (const [set, ids] of Object.entries(bySet)) {
    const file = path.join(REPO_ROOT, 'card-data', 'generated', `cards-${set}.json`);
    if (!fs.existsSync(file)) {
      log(`  ${set}: ${path.basename(file)} missing — skipped`);
      continue;
    }
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    let n = 0;
    for (const card of body.cards ?? []) {
      if (!ids.has(card.id)) continue;
      card.notBestSeason = true;
      if (Array.isArray(card.badges) && card.badges.includes(SUPER_SEASON_BADGE)) {
        card.badges = card.badges.filter(b => b !== SUPER_SEASON_BADGE);
      }
      n += 1;
    }
    fs.writeFileSync(file, `${JSON.stringify(body, null, 1)}\n`);
    log(`  ${set}: dropped the badge from ${n} card(s)`);
    total += n;
  }
  log('\nThose cards keep their stats, their salary and their set — only the claim is gone.');
  return total;
}

export { stamp };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fix = process.argv.includes('--fix');
  const { wrong } = audit({ showAll: process.argv.includes('--all') });
  if (fix) {
    stamp(wrong);
  } else if (wrong.length) {
    console.log('\nRun with --fix to drop the badge from these cards (the cards stay).');
    process.exitCode = 1;
  }
}
