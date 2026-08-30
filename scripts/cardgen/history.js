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
  ARCHIVED_METRICS,
  isAggregateTeam,
} from './fetchHistory.js';

/**
 * z, against a season's OWN distribution.
 *
 * PER SEASON, not against the whole archive pooled, and that is a decision
 * rather than a detail. Pace, three-point rate and scoring level all moved a
 * long way across the seasons in range, and the archived metrics move with them
 * — VORP scales with how many possessions a season contains, and BPM's spread
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
 * ── THE BEST-SEASON SCORE, AND WHY WIN SHARES IS NOT IN IT ──────────────────
 *
 * The rule used to be the mean of four per-season z-scores — VORP, WS, WS/48,
 * BPM. WIN SHARES AND WS/48 ARE GONE, at the user's instruction, and the reason
 * is a property of the statistic rather than a preference:
 *
 *     Win Shares ALLOCATES TEAM WINS to the players who produced them. Its
 *     denominator is what the team actually won, so a very good player on a
 *     64-loss team is systematically docked for the company he kept, and a
 *     rotation player on a 60-win team is systematically flattered. In a set
 *     whose entire question is "how good was this player, that year", that is
 *     not noise — it is a bias with a known direction.
 *
 * BPM has no such term. It is a per-100-possession plus/minus estimated from a
 * player's own box score, and it is ADJUSTED for the quality of his teammates
 * and opponents rather than being credited out of a team's win total. That
 * adjustment is not the same thing as team-independence, and this file is
 * careful not to claim it is: BPM's regression includes a team-performance term,
 * so a player's BPM still carries some of his team with it. What it does not do
 * is divide up a win column.
 *
 * ── THE RULE IS BPM + VORP, AND VORP IS BUYING DURABILITY ───────────────────
 *
 * The old four split evenly between RATE (BPM, WS/48) and VOLUME (VORP, WS).
 * BPM alone is pure rate, and for a while that is what the rule was, which meant
 * DURABILITY COUNTED FOR NOTHING in the choice: a 1,000-minute season at +6.0
 * outranked a 2,800-minute season at +5.8, even though almost anyone asked which
 * was the better year would say the second.
 *
 * VORP is BPM converted to a volume figure — BPM above replacement, multiplied
 * through by the share of team minutes played — so adding it puts playing time
 * back into the comparison. BE PRECISE ABOUT WHAT THAT DOES AND DOES NOT BUY.
 * VORP INHERITS BPM'S TEAM ADJUSTMENT RATHER THAN REMOVING IT; it is BPM with a
 * minutes weighting on top, so whatever team influence BPM carries, VORP carries
 * too, and multiplied by availability. The case for it is durability, not
 * team-independence: a season that was a whole season should be able to outrank
 * a hot two months, and VORP is the term that says so. That is the user's own
 * call, made 2026-08-30 with this caveat stated.
 *
 * BEST_SEASON_MIN_GAMES DOES THE SAME JOB FROM THE OTHER SIDE, and the two are
 * complementary rather than redundant. The games floor is a hard gate — a season
 * under 58 games cannot be chosen at all while any qualifying season exists —
 * and VORP is a continuous preference that keeps working ABOVE the floor, where
 * a 58-game year would otherwise still outscore an 80-game one on rate alone.
 * With only the floor active, 19 of the 350 careers still had a best season that
 * VORP disagreed with, every one of them a shorter year beating a longer one.
 *
 * generateSpecialSets prints both metric sets side by side on every run, so the
 * size of the difference stays visible without editing anything at all.
 */
export const BEST_SEASON_METRIC_SETS = {
  bpmOnly: { bpm: 1 },
  bpmVorp: { bpm: 1, vorp: 1 },
};

/** THE ACTIVE RULE. One line to change; the report compares it against the rest. */
export const BEST_SEASON_WEIGHTS = BEST_SEASON_METRIC_SETS.bpmVorp;

/**
 * A season's score under one declared metric set, plus the z of every archived
 * metric.
 *
 * The z-scores cover ARCHIVED_METRICS — all four, including the two the rule no
 * longer uses — because they are what the report needs to say "WS would have
 * chosen 2019 here". Only the metrics named in `weights` reach `score`.
 */
export function seasonScore(season, distribution, weights = BEST_SEASON_WEIGHTS) {
  const z = {};
  for (const metric of ARCHIVED_METRICS) {
    z[metric] = zAgainstSeason(season[metric], distribution?.metrics?.[metric]);
  }
  let sum = 0;
  let total = 0;
  for (const [metric, w] of Object.entries(weights)) {
    if (!(w > 0)) continue;
    z[metric] ??= zAgainstSeason(season[metric], distribution?.metrics?.[metric]);
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
 * BPM is a rate, and a rate over 300 minutes is mostly noise — every player has
 * one fluke month somewhere in his career and without a floor the set fills up
 * with them. 1000 minutes is roughly a season of 15 minutes a night, which is
 * the point at which a rate stops being an accident.
 *
 * THIS FLOOR BRIEFLY CARRIED MORE WEIGHT THAN IT DOES NOW. While the rule was
 * BPM alone, nothing but this floor penalised a thin season, and
 * BEST_SEASON_MIN_GAMES below was added to cover that. VORP is back in the rule
 * as of 2026-08-30, so a short season is once again marked down continuously as
 * well as gated — but neither floor is redundant, because a floor and a
 * preference do different work. The two floors also ask DIFFERENT questions and
 * neither implies the other: a thousand minutes is thirty games for a starter
 * and eighty for a deep reserve, so minutes alone cannot say whether a season
 * happened and games alone cannot say whether a rate is measurable.
 */
export const BEST_SEASON_MIN_MINUTES = 1000;

/**
 * GAMES a season needs before it is allowed to be someone's BEST.
 *
 * ── WHY MINUTES WERE NOT ENOUGH ─────────────────────────────────────────────
 *
 * The minutes floor asks "did he play enough basketball to measure a rate", and
 * a thousand minutes answers it. It does NOT ask "was this a season", and those
 * are different questions the moment a star is involved: a 33-minutes-a-night
 * player clears a thousand minutes in THIRTY GAMES. So the floor let through
 * exactly the cases the user objected to —
 *
 *     Joel Embiid          2023-24   39 games   1309 minutes   BPM 11.6
 *     Karl-Anthony Towns   2019-20   35 games   1187 minutes   BPM  7.8
 *
 * — both of which are genuinely those players' best RATE seasons, and neither
 * of which anyone would name as the season that defines the player. Minutes
 * cannot separate them from a real year, because by minutes they are not
 * remarkable. Games can, and that is the whole argument for a second floor
 * rather than a higher first one: RAISING the minutes floor would throw out
 * low-usage rotation players who did play the whole season, which is the wrong
 * players entirely.
 *
 * ── WHY 58 ──────────────────────────────────────────────────────────────────
 *
 * 58 is 70% of an 82-game season — "he was there for most of it", the same
 * sentence the minutes floor says about playing time, in the unit that actually
 * carries it. Measured over the pool's careers (350 players, 1642 seasons that
 * clear the minutes floor), against 50 and 65 as the alternatives:
 *
 *     cutoff   picks moved   cards under 58g   cards   median games
 *     none               0                41     201             68
 *     G>=50             13                32     201             68
 *     G>=58             40                17     209             70
 *     G>=65             73                18     210             72
 *
 * and every one of the 40 moves at 58 goes to a LONGER season — median +18
 * games and +411 minutes, none shorter. That is the whole point: this floor can
 * only ever replace a short season with a longer one, never the reverse.
 *
 * 50 was measured and rejected as too weak: it catches Embiid and Towns and
 * leaves thirty-two other cards under 58 games.
 *
 * ── AND WHY NOT 65, WHICH IS THE INTERESTING ONE ────────────────────────────
 *
 * Because it stops removing implausible seasons and starts removing REAL ones,
 * and it does it to the best players in the set. A 65-game floor is above what
 * a full season even WAS in three of the seasons in range — the 2011-12 lockout
 * (66 games), 2019-20 (suspended; teams played 63-75) and 2020-21 (72) — so it
 * reads a COVID season's near-complete year as a partial one:
 *
 *     Giannis Antetokounmpo  2019-20  63 of 73   BPM 11.5  ->  2021-22  BPM 11.2
 *     Zion Williamson        2020-21  61 of 72   BPM  5.8  ->  2023-24  BPM  3.8
 *     Ja Morant              2021-22  57 of 82   BPM  6.1  ->  2019-20  BPM  0.3
 *     Victor Wembanyama      2025-26  64 of 82   BPM 10.7  ->  2023-24  BPM  5.2
 *
 * Wembanyama's is the sharpest: at 65 his current season stops being his best,
 * so he LOSES the Super Season badge off his base card and gains a worse card
 * in the set. Trading a +10.7 season for a +5.2 one to buy seven games is the
 * opposite of the error this floor exists to fix.
 *
 * A share-of-schedule rule — `games >= 70% of what the league actually played
 * that year` — was built and measured as the principled alternative. It
 * disagrees with a flat 58 about FIVE of 350 players, all of them between -2.6
 * and +2.3 BPM, and it costs a hand-maintained table of schedule lengths whose
 * 2019-20 entry cannot be right for everyone (teams played 63 to 75 games). Not
 * worth it. The flat number already clears every shortened-season peak in the
 * pool — Giannis 63, Bam Adebayo 64, Zion 61, Jrue Holiday 59, Zach LaVine 58 —
 * because 58 is BELOW those seasons rather than above them.
 *
 * The one case a flat number is knowingly wrong about is the 66-game 2011-12
 * lockout, where 58 games is 88% of the schedule. Nobody in the current pool
 * has a 2012 best season, so it costs nothing today; it is recorded here rather
 * than solved, because solving it is the schedule table above.
 *
 * ── EVERY NUMBER ABOVE WAS MEASURED UNDER BPM-ONLY ──────────────────────────
 *
 * The tables and the four 65-game examples all date from when BEST_SEASON_WEIGHTS
 * was `bpmOnly`; the rule is now `bpmVorp`. The 58 itself is unaffected — it is a
 * gate applied before any scoring happens, so it moves the same seasons in or out
 * of contention whichever metric set ranks them — but two of the examples above
 * now read differently, and it is worth knowing which:
 *
 *   - GIANNIS IS ALREADY ON 2021-22. VORP prefers his 67-game 2021-22 (7.4) to
 *     his 63-game 2019-20 (6.6) on its own, so the thing a 65-game floor would
 *     have forced, the rule now chooses. The paragraph stands as the argument
 *     against 65; it is simply no longer the example that demonstrates it.
 *   - WEMBANYAMA IS UNCHANGED and is still the sharpest case: his 2025-26 wins
 *     under both metric sets, and a 65-game floor would still cost him the badge.
 *
 * Nothing was re-measured, because nothing here depends on the measurement: the
 * decision this comment defends is the CUTOFF, and it is metric-set-independent.
 */
export const BEST_SEASON_MIN_GAMES = 58;

/**
 * The player's best season, and every season scored.
 *
 * ── THE TWO FLOORS ARE TIERED, NOT ANDed ────────────────────────────────────
 *
 * A career of injuries, or a player whose only real year is the current one,
 * must still produce a card — producing a provisional card beats producing a
 * hole. So eligibility falls back a step at a time and the record says how far
 * it fell:
 *
 *   both          a season clears BOTH floors. The normal case: 310 of 350.
 *   minutesOnly   nothing clears the games floor, so THAT floor is dropped and
 *                 the minutes floor still stands. 12 players — every one of
 *                 them young, and every one of them with a 1000-minute season
 *                 that is simply not 58 games long yet.
 *   none          nothing clears either. Both are dropped. 28 players, exactly
 *                 the same 28 the minutes floor alone was already falling back
 *                 for, so the games floor costs nobody a card.
 *
 * DROPPING THE GAMES FLOOR FIRST IS THE POINT OF THE ORDER. Collapsing the two
 * into one `minutes >= 1000 && games >= 58` filter with a single fallback would
 * hand a player with a 57-game, 1473-minute season the same treatment as a
 * player with an 11-minute career — his fallback pool would reopen to include
 * every three-game flier he has ever had, and the shrink in
 * generateSpecialSets.js is the only thing that would stop one being chosen.
 * Falling back one floor at a time never widens the pool further than it has
 * to.
 */
export function bestSeason(seasons, distributions, weights = BEST_SEASON_WEIGHTS) {
  const scored = seasons.map(s => ({ ...s, ...seasonScore(s, distributions?.[s.season], weights) }));
  const longEnough = scored.filter(s => (s.minutes ?? 0) >= BEST_SEASON_MIN_MINUTES);
  const qualified = longEnough.filter(s => (s.games ?? 0) >= BEST_SEASON_MIN_GAMES);

  const [pool, eligibility] = qualified.length > 0
    ? [qualified, 'both']
    : longEnough.length > 0
      ? [longEnough, 'minutesOnly']
      : [scored, 'none'];

  const best = pool.reduce((a, b) => (b.score > a.score ? b : a), pool[0] ?? null);
  return {
    scored,
    best,
    eligibility,
    /** Nothing cleared the games floor; it was dropped and minutes still held. */
    usedGamesFallback: eligibility === 'minutesOnly',
    /** Nothing cleared either floor. The name predates the games floor. */
    usedFallbackFloor: eligibility === 'none' && scored.length > 0,
  };
}

/**
 * Which season each ARCHIVED metric would have chosen ON ITS OWN.
 *
 * Still computed over all four, including the two the rule dropped. That is the
 * point: `ws` and `ws48` in this record are the evidence for what removing Win
 * Shares actually did, and a season only WS liked is exactly the season the
 * team-quality bias was propping up.
 */
export function perMetricBest(scored, metrics = ARCHIVED_METRICS) {
  const out = {};
  for (const metric of metrics) {
    const best = scored.reduce(
      (a, b) => (a === null || (b.z?.[metric] ?? -Infinity) > (a.z?.[metric] ?? -Infinity) ? b : a),
      null
    );
    out[metric] = best?.season ?? null;
  }
  return out;
}

/** True when the metrics do not all point at the same season. */
export function metricsDisagree(perMetric) {
  return new Set(Object.values(perMetric)).size > 1;
}

/**
 * One career's best season under EVERY declared metric set, side by side.
 *
 * The whole reason the metric set is a parameter. `bestSeasonByMetricSet` is
 * what lets the run report answer "and what would BPM+VORP have picked?"
 * without anyone editing a weight and regenerating to find out. Scoring a
 * career twice is a few dozen arithmetic operations, so it is done on every run
 * rather than behind a flag nobody remembers to pass.
 */
export function bestSeasonByMetricSet(seasons, distributions, sets = BEST_SEASON_METRIC_SETS) {
  const out = {};
  for (const [name, weights] of Object.entries(sets)) {
    out[name] = bestSeason(seasons, distributions, weights);
  }
  return out;
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
