/**
 * The technical best season for players the history archive does not cover.
 *
 * WHY IT DOES NOT COVER THEM: `fetchHistory.js` computes its per-season
 * distributions over the whole league but keeps ROWS only for the 350 players
 * who get a base card. Every retiree in the playoff-standouts list -- Ginóbili,
 * Billups, Ben Wallace, Horry -- is therefore absent, and so is anyone who
 * played no games in the current season.
 *
 * WHY THIS EXISTS RATHER THAN A HAND-ROLLED SCORE. A first pass reimplemented
 * the rule in a scratch script and agreed with the shipped Super Season picks
 * on only 189 of 210. Six of the misses were the current-season exclusion it
 * did not replicate; the other fifteen were TRADED PLAYERS -- DeRozan,
 * Schröder, Capela, Hartenstein -- because the raw tables hold an aggregate row
 * AND one row per team, and a naive name match lets the splits compete with the
 * aggregate as if they were separate seasons. `careerSeasons` already knows
 * that, so the real function is used here and the near-miss is not repeated.
 *
 * The distributions come from the committed archive, which measured them over
 * every qualified row in each season rather than over the pool, so they are
 * already the right basis for a player who was never in the pool.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache } from './cache.js';
import { careerSeasons, bestSeason, BEST_SEASON_WEIGHTS } from './history.js';
import { normalizeName } from './resolveTeams.js';

export const HISTORY_CACHE = 'bbref-history';

/**
 * Every advanced row in the cached full-league tables, indexed BY PLAYER ID and
 * grouped under the normalised name.
 *
 * NAME ALONE IS NOT A KEY, and the failure is a father and a son. `normalizeName`
 * strips generational suffixes, so "Gary Payton II" and "Gary Payton" both
 * normalise to `garypayton`, as do "Tim Hardaway Jr." and his father. Keying on
 * the name silently merged two careers and handed the son his father's best
 * season -- 2000 for a player who debuted in 2017. Basketball-Reference gives
 * them distinct ids (`paytoga02` against `paytoga01`) and the cached rows carry
 * them, so the id is what groups a career and the name is only a lookup into a
 * list of candidates.
 */
export function loadLeagueRows({ first = 2000, last = 2026 } = {}) {
  const byName = new Map();
  for (let season = first; season <= last; season += 1) {
    let cached;
    try {
      cached = readCache(`bbref-${season}-advanced-full`);
    } catch {
      continue;
    }
    const rows = Array.isArray(cached) ? cached : cached?.rows ?? cached?.data ?? [];
    for (const row of rows) {
      if (!row?.name) continue;
      const key = normalizeName(row.name);
      if (!byName.has(key)) byName.set(key, new Map());
      const careers = byName.get(key);
      const id = row.playerId ?? key;
      if (!careers.has(id)) careers.set(id, []);
      careers.get(id).push({ ...row, season: row.season ?? season });
    }
  }
  return byName;
}

/**
 * Pick the career a name refers to.
 *
 * `bbrefId` settles it outright when the caller has one. Otherwise the
 * REFERENCE SEASON does: a name shared by two players is a father and a son,
 * and their careers do not overlap, so the one whose seasons contain the season
 * being asked about is the right one. With neither, the longest career wins,
 * which is the safer default for a name that turns out to be unique anyway.
 */
export function pickCareer(careers, { bbrefId = null, referenceSeason = null } = {}) {
  if (!careers || careers.size === 0) return null;
  if (bbrefId && careers.has(bbrefId)) return careers.get(bbrefId);
  const all = [...careers.values()];
  if (all.length === 1) return all[0];
  if (referenceSeason != null) {
    const covering = all.filter(rows =>
      rows.some(r => r.season === referenceSeason)
    );
    if (covering.length === 1) return covering[0];
    const near = all.filter(rows => {
      const lo = Math.min(...rows.map(r => r.season));
      const hi = Math.max(...rows.map(r => r.season));
      return referenceSeason >= lo && referenceSeason <= hi;
    });
    if (near.length === 1) return near[0];
  }
  return all.reduce((a, b) => (b.length > a.length ? b : a), all[0]);
}

/**
 * One player's best season under the SHIPPED rule.
 *
 * `excludeSeason` carries the Super Season set's own exclusion: a player whose
 * best season is the most recent one gets no card, because his base card
 * already represents it.
 */
export function standoutBestSeason(rows, distributions, { excludeSeason = null } = {}) {
  const seasons = careerSeasons(rows).filter(s => s.season !== excludeSeason);
  if (seasons.length === 0) return null;
  const result = bestSeason(seasons, distributions, BEST_SEASON_WEIGHTS);
  if (!result.best) return null;
  return {
    season: result.best.season,
    team: result.best.team,
    bpm: result.best.bpm,
    vorp: result.best.vorp,
    score: result.best.score,
    eligibility: result.eligibility,
    usedGamesFallback: result.usedGamesFallback,
    usedFallbackFloor: result.usedFallbackFloor,
  };
}

/** Best seasons for a list of names, using the committed archive's basis. */
export function bestSeasonsFor(entries, { excludeSeason = 2026 } = {}) {
  const archive = readCache(HISTORY_CACHE);
  const distributions = archive?.data?.seasons ?? archive?.seasons ?? {};
  const league = loadLeagueRows();
  const out = new Map();
  const missing = [];
  for (const entry of entries) {
    // Accepts a bare name or `{ name, bbrefId, referenceSeason }` — the extra
    // two are what disambiguate a father from a son.
    const { name, bbrefId = null, referenceSeason = null } =
      typeof entry === 'string' ? { name: entry } : entry;
    const careers = league.get(normalizeName(name));
    const rows = pickCareer(careers, { bbrefId, referenceSeason });
    if (!rows || rows.length === 0) {
      missing.push(name);
      continue;
    }
    const best = standoutBestSeason(rows, distributions, { excludeSeason });
    if (best) out.set(name, { name, bbrefId: rows[0]?.playerId ?? null, ...best });
    else missing.push(name);
  }
  return { best: out, missing, distributions };
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(new URL(import.meta.url).pathname.slice(1))) {
  const namesFile = process.argv[2];
  if (!namesFile) {
    console.error('usage: node scripts/cardgen/standoutSuperSeasons.js <names.json>');
    process.exit(1);
  }
  const names = JSON.parse(fs.readFileSync(namesFile, 'utf8'));
  const { best, missing } = bestSeasonsFor(names);
  const rows = [...best.values()].sort((a, b) => b.score - a.score);
  console.log(`\n${rows.length} best seasons computed through the shipped rule` +
    (missing.length ? `, ${missing.length} with no rows: ${missing.join(', ')}` : ''));
  console.log(`\n  ${'season'.padEnd(8)}${'player'.padEnd(24)}${'tm'.padEnd(5)}${'BPM'.padStart(6)}${'VORP'.padStart(7)}${'z'.padStart(7)}  eligibility`);
  for (const r of rows) {
    console.log(`  ${String(r.season).padEnd(8)}${r.name.padEnd(24)}${String(r.team).padEnd(5)}` +
      `${String(r.bpm).padStart(6)}${String(r.vorp).padStart(7)}${r.score.toFixed(2).padStart(7)}  ${r.eligibility}`);
  }
  fs.writeFileSync(
    path.join(REPO_ROOT, 'card-data', 'generated', 'standout-super-seasons.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), rule: 'bpmVorp', cards: rows }, null, 1)}\n`
  );
}
