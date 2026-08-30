// Careers, out of a flat list of player-seasons.
//
// Everything here is pure and testable; scripts/cardgen/generateSpecialSets.js
// is the runner that reads the cache, calls this, and writes the two rosters.
//
// ── PLAYERS ARE JOINED BY BASKETBALL-REFERENCE ID, NEVER BY NAME ────────────
//
// This is the single most important rule in the file. Six names in the current
// pool alone belong to two different players in the archive:
//
//     garypayton     paytoga01 / paytoga02      Gary Payton  / Gary Payton II
//     jarenjackson   jacksja01 / jacksja02      Jaren Jackson / Jaren Jackson Jr.
//     timhardaway    hardati01 / hardati02      Tim Hardaway / Tim Hardaway Jr.
//     jabarismith    smithja01 / smithja05      Jabari Smith / Jabari Smith Jr.
//     garytrent      trentga01 / trentga02      Gary Trent   / Gary Trent Jr.
//     brandonwilliams willibr01 / willibr03
//
// The pipeline's usual `normalizeName` deliberately strips "Jr."/"II"/"III"
// suffixes — which is right everywhere else and catastrophic here, because it
// makes a father and his son the same person. Matching by name would have
// handed Jaren Jackson Jr. his father's 1999-2000 Spurs season as his career
// best, and nothing downstream would have looked wrong. So a pool player's id
// is resolved ONCE, from his row in the most recent season (where he certainly
// appears, since the pool is built from it), and every career question after
// that is asked of that id.
//
// ── A SEASON IS AN AGGREGATE ROW PLUS A TEAM FROM THE SPLITS ────────────────
//
// A player traded mid-season has, in Basketball-Reference's tables, one "2TM"
// row covering the whole season plus one row per team. The aggregate is the
// stat line the card should print; the splits are the only record of which
// jersey to put on it. See seasonFromRows.

import {
  BEST_SEASON_METRICS,
  isAggregateTeam,
} from './fetchHistory.js';

/**
 * z, against a season's OWN distribution.
 *
 * PER SEASON, not against the whole archive pooled, and that is a decision
 * rather than a detail. Pace, three-point rate and scoring level all moved a
 * long way across the seasons in range, and the four metrics move with them —
 * WS/48 is defined against a league average of .100 in every era, but VORP and
 * WS both scale with how many possessions a season contains, and BPM's spread
 * is not constant either. Scoring a season against its contemporaries is what
 * "best season" means to anyone who watched them, and it is the only version of
 * the question that does not quietly reward whoever played in the highest-pace
 * years.
 */
export function zAgainstSeason(value, stats) {
  if (!Number.isFinite(value) || !stats || !(stats.sd > 0)) return 0;
  return (value - stats.mean) / stats.sd;
}

/**
 * ── THE BEST-SEASON SCORE ───────────────────────────────────────────────────
 *
 * The user named four metrics — VORP, WS, WS/48, BPM — and left how to combine
 * them open, because they disagree: WS and VORP reward VOLUME (a great season
 * played 82 times beats the same season played 55), WS/48 and BPM reward RATE
 * (they do not care how long it lasted). Pick either family alone and the set
 * comes out lopsided in an obvious way: rate-only crowns injury-shortened
 * half-seasons, volume-only crowns whoever was healthiest.
 *
 * THE DEFAULT TAKEN HERE: the mean of the four per-season z-scores, equally
 * weighted. That is exactly a 50/50 split between the rate family and the
 * volume family, because the families happen to be the same size — average
 * within each family first and you get the identical number. So it is
 * defensible on the reading that actually matters ("half of a great season is
 * how good it was, half is how much of it there was") rather than only on the
 * reading that it is the simplest thing to do.
 *
 * IT IS ONE LINE TO CHANGE. `weights` is a parameter, the per-metric z-scores
 * are kept on every record this module emits, and generateSpecialSets prints
 * the players the four metrics disagree about on every run — so the consequence
 * of a different weighting is visible before anyone commits to it.
 */
export const EQUAL_WEIGHTS = Object.fromEntries(BEST_SEASON_METRICS.map(m => [m, 1]));

export function seasonScore(season, distribution, weights = EQUAL_WEIGHTS) {
  const z = {};
  let sum = 0;
  let total = 0;
  for (const metric of BEST_SEASON_METRICS) {
    z[metric] = zAgainstSeason(season[metric], distribution?.metrics?.[metric]);
    const w = weights[metric] ?? 0;
    sum += w * z[metric];
    total += w;
  }
  return { score: total > 0 ? sum / total : 0, z };
}

/**
 * The one row per season a card is built from, plus the team to print on it.
 *
 * `rows` is every row the archive holds for ONE player in ONE season. Three
 * shapes arrive here and all three are normal:
 *
 *   one row              he played for one team. Trivially both the stat line
 *                        and the team.
 *   aggregate + splits   traded. The aggregate is the season; the team is the
 *                        split he played the most MINUTES for, not the most
 *                        games — a player can appear in more games after a
 *                        deadline trade while having spent the season
 *                        elsewhere.
 *   splits only          the archive is missing the aggregate. Falls back to
 *                        the biggest split rather than dropping the season, and
 *                        marks it, because half a season's counting stats
 *                        (VORP, WS) would score far too low if it were silently
 *                        treated as the whole thing.
 */
export function seasonFromRows(rows) {
  const splits = rows.filter(r => !isAggregateTeam(r.team));
  const aggregate = rows.find(r => isAggregateTeam(r.team)) ?? null;
  const biggestSplit = splits.reduce(
    (best, r) => (!best || (r.minutes ?? 0) > (best.minutes ?? 0) ? r : best),
    null
  );
  const line = aggregate ?? biggestSplit ?? rows[0] ?? null;
  if (!line) return null;
  return {
    ...line,
    // The jersey. A split always wins over "2TM", which is not a team.
    team: biggestSplit?.team ?? line.team,
    teams: splits.map(s => s.team),
    traded: splits.length > 1,
    partialSeason: !aggregate && splits.length > 1,
  };
}

/** Every season one player has, keyed by season and already collapsed. */
export function careerSeasons(rows) {
  const bySeason = new Map();
  for (const row of rows) {
    if (!bySeason.has(row.season)) bySeason.set(row.season, []);
    bySeason.get(row.season).push(row);
  }
  return [...bySeason.entries()]
    .map(([season, group]) => ({ season, ...seasonFromRows(group) }))
    .filter(Boolean)
    .sort((a, b) => a.season - b.season);
}

/**
 * Minutes a season needs before it is allowed to be someone's BEST.
 *
 * WS/48 and BPM are rates, and a rate over 300 minutes is mostly noise — every
 * player has one fluke month somewhere in his career and without a floor the
 * set fills up with them. 1000 minutes is roughly a season of 15 minutes a
 * night, which is the point at which a rate stops being an accident.
 */
export const BEST_SEASON_MIN_MINUTES = 1000;

/**
 * The player's best season, and every season scored.
 *
 * If NO season clears the minutes floor — a career of injuries, or a player
 * whose only real year is the current one — the floor is dropped rather than
 * the player: he simply gets his largest season. Producing a provisional card
 * beats producing a hole, and the record says which happened.
 */
export function bestSeason(seasons, distributions, weights = EQUAL_WEIGHTS) {
  const scored = seasons.map(s => ({ ...s, ...seasonScore(s, distributions?.[s.season], weights) }));
  const eligible = scored.filter(s => (s.minutes ?? 0) >= BEST_SEASON_MIN_MINUTES);
  const pool = eligible.length > 0 ? eligible : scored;
  const best = pool.reduce((a, b) => (b.score > a.score ? b : a), pool[0] ?? null);
  return { scored, best, usedFallbackFloor: eligible.length === 0 && scored.length > 0 };
}

/**
 * Which season each metric would have chosen ON ITS OWN.
 *
 * Printed on every run so the combining rule above stays a visible decision.
 * The interesting cases are the players where these four seasons are not all
 * the same one — see generateSpecialSets's report.
 */
export function perMetricBest(scored) {
  const out = {};
  for (const metric of BEST_SEASON_METRICS) {
    const best = scored.reduce(
      (a, b) => (a === null || (b.z?.[metric] ?? -Infinity) > (a.z?.[metric] ?? -Infinity) ? b : a),
      null
    );
    out[metric] = best?.season ?? null;
  }
  return out;
}

/** True when the four metrics do not all point at the same season. */
export function metricsDisagree(perMetric) {
  return new Set(Object.values(perMetric)).size > 1;
}

/**
 * The season a player debuted in, as far as this archive can see.
 *
 * `beyondRange` is the honest caveat: if his earliest row is the first season
 * fetched, the archive cannot tell "debuted that year" from "debuted before we
 * started looking". For the current pool nobody is in that position — the
 * longest tenure is LeBron James, whose 2003-04 rookie season sits four years
 * inside the range — but a legends extension would be, so the flag is carried
 * rather than assumed away.
 */
export function rookieSeason(seasons, firstFetchedSeason) {
  const first = seasons[0] ?? null;
  if (!first) return null;
  return { ...first, beyondRange: first.season <= firstFetchedSeason };
}
