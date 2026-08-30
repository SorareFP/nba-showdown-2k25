// Folding LAST season into this one, for the players whose this-season sample
// is too short to card.
//
// ── THE PROBLEM, IN ONE PLAYER ──────────────────────────────────────────────
//
// The pool rule is MPG>=12 and G>=40. `card-data/force-include-2026.json`
// suspends the games half of it for nineteen names — eighteen stars whose
// 2025-26 was cut short by injury, plus Ty Jerome, an individual pick. Those
// nineteen are then carded on whatever sample they do have, and for some of them
// that sample is tiny:
//
//     Ty Jerome    15 games   6.17 EPM   ->  Speed+Power 26, 7th HIGHEST IN THE SET
//     Zach Edey    11 games   3.88 EPM   ->  Speed+Power 24
//
// Fifteen good games is not evidence of a 26 budget; it is evidence of fifteen
// good games. The force-include file has said so since it was written, and said
// why nothing was done about it: dunksandthrees' prior seasons are locked behind
// a subscription and Basketball-Reference carries neither EPM nor Estimated
// Wins, so a blend was a cross-source normalisation project rather than a
// pooling job.
//
// THE API KEY REMOVED THAT OBSTACLE. sources/dunksAndThreesApi.js serves 2002
// onward from the same table the current season comes from, so the prior season
// is now the SAME NUMBERS, not a substitute for them, and the blend is exactly
// the pooling job poolSeasons.js already does.
//
// ── SO IT IS THE SAME FOLD, NOT A NEW ONE ───────────────────────────────────
//
// `foldRows` in poolSeasons.js is imported rather than reimplemented, which
// means every per-stat denominator argument made there applies here unchanged:
// EPM/OFF/DEF/USG pool by POSSESSIONS, TS% by TRUE SHOOTING ATTEMPTS, each
// location percentage by ITS OWN attempts, the season totals by addition, EW/GP
// by games played. A straight mean of two rates is the thing being ruled out,
// and it is ruled out for the same reason: it would give Ty Jerome's 15 games
// the same say as his previous 70.
//
// The nesting is worth being explicit about, because there are now two folds:
//
//     2024-25 regular  +  2024-25 playoffs   ->  2024-25, pooled
//     2025-26 regular  +  2025-26 playoffs   ->  2025-26, pooled
//     2025-26 pooled   +  2024-25 pooled     ->  the card's sample
//
// Both levels are volume-weighted, so the whole thing is algebraically one
// pooled sample over all four splits. Doing it in two steps rather than four at
// once costs nothing and keeps each step's provenance readable.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
//
// NO RECENCY WEIGHTING. A 70-game 2024-25 outweighs a 15-game 2025-26 about
// 4.7:1, purely on volume, and nothing here says the older season should count
// for less because it is older. That is a real modelling choice and it is the
// one the user's own rule for the playoffs already implies — "I want those games
// to count as additional data" — so it is applied consistently rather than
// quietly amended. It does mean a player who genuinely improved reads as the
// average of the two versions of himself; see the run report for how far each of
// the nineteen actually moved.
//
// NO AGE CURVE, NO PACE ADJUSTMENT. Same argument as poolSeasons.js makes about
// playoff pace: the effect is a percent or two on a number that is then z-scored
// across the pool and rounded onto a 10-28 integer scale, so it cannot survive
// to the card.
//
// ONLY THE DECLARED LIST IS BLENDED. Every other player in the pool cleared
// G>=40 on his own and keeps his 2025-26 season bit-for-bit. Widening the rule
// to "anyone with a short season" is a separate decision with a separate
// threshold and is not taken here.

import { readCache } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { forceIncludeNames } from './forceInclude.js';
import { foldRows, hasSample, matchKeys, poolActualSeasons, readPooledActual } from './poolSeasons.js';
import {
  SEASON_TYPE_PLAYOFFS,
  SEASON_TYPE_REGULAR,
  seasonEpmCacheKey,
} from './sources/dunksAndThreesApi.js';

/**
 * The season blended IN. 2025 is the 2024-25 season — the one immediately before
 * the set's own, and the one the FINISHED 2025-26 cards were built from.
 */
export const PRIOR_STATS_SEASON = 2025;

/** Names the stat source spells differently from the pool. Mirrors generateCards.js. */
export const STAT_NAME_ALIASES = { 'Ron Holland': 'Ronald Holland II' };

/** Every spelling of a name that might match a stat row. */
const nameKeys = name =>
  [...new Set([normalizeName(STAT_NAME_ALIASES[name] ?? name), normalizeName(name)])];

/**
 * One player's current season with his prior one folded in.
 *
 * `current` supplies the identity — name, team, position, age — because the card
 * says who he is NOW. A player who changed teams between the two seasons wears
 * this season's jersey and carries both seasons' production, which is the right
 * answer and is the reason `foldRows` takes its identity from the first argument.
 *
 * NO PRIOR SAMPLE IS NOT AN ERROR. It returns the current row untouched, marked
 * `blended: false` — a rookie has no prior season and a card built on one season
 * is the correct card for him.
 */
export function blendRow(current, prior, { priorSeason = PRIOR_STATS_SEASON } = {}) {
  if (!current) return null;
  if (!hasSample(prior)) {
    return { ...current, blended: false, priorGames: 0, priorMinutes: 0 };
  }
  return {
    ...foldRows(current, prior),
    // The regular/playoff provenance now covers BOTH seasons, because both
    // sides of this fold are themselves already regular-plus-playoff pooled.
    regularGames: (current.regularGames ?? 0) + (prior.regularGames ?? 0),
    regularMinutes: (current.regularMinutes ?? 0) + (prior.regularMinutes ?? 0),
    playoffGames: (current.playoffGames ?? 0) + (prior.playoffGames ?? 0),
    playoffMinutes: (current.playoffMinutes ?? 0) + (prior.playoffMinutes ?? 0),
    pooled: Boolean(current.pooled || prior.pooled),
    blended: true,
    blendedFrom: priorSeason,
    currentGames: current.games ?? 0,
    currentMinutes: current.minutes ?? 0,
    priorGames: prior.games ?? 0,
    priorMinutes: prior.minutes ?? 0,
  };
}

/**
 * The pool's rows, with the named players' prior seasons folded in.
 *
 * A NAME THAT MATCHES NOTHING IS REPORTED, NOT DROPPED. The force-include file
 * is hand-maintained and a typo in it is otherwise completely silent — the
 * player simply keeps his short sample and nothing anywhere says why. Same rule
 * the pool filter already follows for the same file.
 *
 * Prior rows are matched by dunksandthrees' own player id first and normalized
 * name second (`matchKeys`), which is what makes "Jimmy Butler III" in the API's
 * 2024-25 table and "Jimmy Butler" in the pool the same person.
 */
export function blendPriorSeason(currentRows, priorRows, names, { priorSeason } = {}) {
  const wanted = new Set(names.flatMap(nameKeys));
  if (wanted.size === 0) {
    return { rows: currentRows, blended: [], unmatchedNames: [], missingPrior: [] };
  }

  const priorIndex = new Map();
  for (const row of priorRows ?? []) {
    for (const key of matchKeys(row)) if (!priorIndex.has(key)) priorIndex.set(key, row);
  }

  const matchedNames = new Set();
  const blended = [];
  const missingPrior = [];

  const rows = currentRows.map(current => {
    const keys = nameKeys(current.name ?? '');
    if (!keys.some(k => wanted.has(k))) return current;
    for (const k of keys) if (wanted.has(k)) matchedNames.add(k);

    const prior = matchKeys(current).map(k => priorIndex.get(k)).find(Boolean) ?? null;
    if (!hasSample(prior)) {
      missingPrior.push(current.name);
      return { ...current, blended: false, priorGames: 0, priorMinutes: 0 };
    }
    const row = blendRow(current, prior, { priorSeason });
    blended.push({
      name: current.name,
      before: current,
      prior,
      after: row,
    });
    return row;
  });

  const unmatchedNames = names.filter(n => !nameKeys(n).some(k => matchedNames.has(k)));
  return { rows, blended, unmatchedNames, missingPrior };
}

/**
 * The prior season's pooled rows, straight off the API cache.
 *
 * THROWS RATHER THAN RETURNING NOTHING when the regular-season cache is absent.
 * A silent empty result here is the worst available failure: it is
 * indistinguishable from "none of these players had a prior season", which is
 * exactly the claim the blend exists to disprove, and every one of the nineteen
 * would quietly keep the short-sample card the blend was meant to fix.
 *
 * A MISSING PLAYOFF CACHE IS NOT AN ERROR, for the same reason it is not one in
 * poolSeasons.js: it pools to the regular season alone.
 */
export function readPriorSeason(season = PRIOR_STATS_SEASON) {
  const regular = readCache(seasonEpmCacheKey(season, SEASON_TYPE_REGULAR));
  if (!regular) {
    throw new Error(
      `No cached dunksandthrees API rows for season ${season} ` +
        `(card-data/cache/${seasonEpmCacheKey(season, SEASON_TYPE_REGULAR)}.json). Run ` +
        '`node --env-file=.env.local scripts/cardgen/fetchCalibrationData.js` — it needs the ' +
        'DUNKSANDTHREES_API_KEY, because prior seasons are not public.'
    );
  }
  const playoffs = readCache(seasonEpmCacheKey(season, SEASON_TYPE_PLAYOFFS)) ?? [];
  return poolActualSeasons(regular, playoffs);
}

/**
 * The card set's actual rows: this season pooled, with the declared players'
 * prior season folded in.
 *
 * THE ONE FUNCTION THE GENERATORS CALL. Returns null when the CURRENT season is
 * not cached, which is what the callers already turn into their own "run
 * fetchCalibrationData.js first" error — the blend does not change that
 * contract, it only adds to what happens after it is satisfied.
 */
export function readBlendedActual(
  season,
  { priorSeason = PRIOR_STATS_SEASON, names = forceIncludeNames() } = {}
) {
  const current = readPooledActual(season);
  if (!current) return null;
  if (!names || names.length === 0) {
    return { rows: current, blended: [], unmatchedNames: [], missingPrior: [], priorSeason };
  }
  const prior = readPriorSeason(priorSeason);
  return { ...blendPriorSeason(current, prior, names, { priorSeason }), priorSeason };
}

/** How much prior season the blend actually added. For run reports. */
export function blendSummary(blended) {
  const gained = blended ?? [];
  return {
    players: gained.length,
    priorGames: gained.reduce((a, b) => a + (b.after.priorGames ?? 0), 0),
    currentGames: gained.reduce((a, b) => a + (b.after.currentGames ?? 0), 0),
  };
}

/**
 * One line per blended player, for a run report.
 *
 * Prints the SAMPLE and the EPM on both sides plus the pooled result, because
 * the whole argument for the blend is a sample-size argument and a report that
 * showed only the new number would hide it.
 */
export function reportBlend({ blended, unmatchedNames, missingPrior, priorSeason }, log) {
  if (unmatchedNames?.length) {
    log(
      `  ⚠ force-include names with no ${'current-season'} stat row: ${unmatchedNames.join(', ')}`
    );
  }
  if (missingPrior?.length) {
    log(`  ⚠ no ${priorSeason} row to blend for: ${missingPrior.join(', ')}`);
  }
  const rows = blended ?? [];
  if (rows.length === 0) return;
  const n = (v, w = 6, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-').padStart(w);
  log(
    `  ${priorSeason} blended into ${rows.length} force-included players ` +
      '(volume-weighted, same fold as the playoffs):'
  );
  log('    player                   now      prior       EPM now   prior  pooled     EW/GP');
  for (const r of [...rows].sort((a, b) => a.after.currentGames - b.after.currentGames)) {
    const { before, prior, after } = r;
    log(
      `    ${r.name.padEnd(24)}${String(before.games).padStart(3)}g ${String(
        Math.round(before.minutes)
      ).padStart(4)}m ${String(prior.games).padStart(3)}g ${String(
        Math.round(prior.minutes)
      ).padStart(4)}m ` +
        `${n(before.epm)} ${n(prior.epm)} ${n(after.epm)}   ${n(after.ewinsPerGame, 6, 3)}`
    );
  }
}
