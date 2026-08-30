// The WNBA legends set's PURE half — every decision that can be made without
// touching the disk, so every one of them can be tested.
//
// scripts/cardgen/wnba/generateWnbaLegends.js is the runner: it reads the
// archive, calls this, and writes the roster. The split is the same one
// history.js / generateSpecialSets.js already make on the NBA side.
//
// ── WHAT THIS SET IS, AND WHY IT NEEDED NEW RULES RATHER THAN THE NBA'S ─────
//
// Sixteen retired greats, each on her best individual season, chosen the way
// the NBA Super Season set chooses one: an impact estimate scored against the
// player's OWN season's league. Everything below exists because a rule stated
// in NBA units cannot survive the trip:
//
//   THE SEASON IS NOT 82 GAMES AND NEVER WAS. It was 28 in 1997, 30 through
//   2002, 32, then 34 for a decade, 36, 40, and 44 today. A flat games floor —
//   which is exactly what BEST_SEASON_MIN_GAMES is on the NBA side — would mean
//   something different in every year it was applied to, and at the NBA's 58
//   it would reject every season the league played before 2025 outright. So the
//   floor here is a SHARE of the schedule, and the schedule is MEASURED per
//   season rather than declared (see `scheduleLength`).
//
//   A GAME IS 40 MINUTES, so a minutes floor stated in season minutes carries
//   the schedule length inside it twice over. It is stated as MINUTES PER GAME
//   instead, which is the same question — "was she a real part of this team" —
//   asked in a unit that means the same thing in 1997 and 2024.
//
//   THERE IS NO BPM. The fitted model (wnba/bpmModel.js) supplies one, and
//   because every feature it reads is centred on its own league-season, a
//   fitted BPM is ALREADY league-relative — a 1997 +5 and a 2019 +5 both mean
//   "five points per 100 above the league she played in".
//
// ── AND WHY THE SHOOTING NUMBERS ARE ERA-SHIFTED WHERE THE NBA'S ARE NOT ────
//
// The NBA Super Season set spans 2000-2026 and feeds Basketball-Reference's raw
// percentages straight into the shooting layer. That is defensible over a
// league whose true shooting moved a few points across the span. It is not
// defensible here: this set spans the WNBA's ENTIRE history, and the league's
// shooting moved far more than that. Lisa Leslie's 1997 true shooting of .490
// was well ABOVE her league's; handed to a compression fitted on the 2026 pool
// it would read as a poor shooter, which is not a measurement, it is an
// artefact of comparing 1997 with 2026.
//
// So each percentage is shifted by the difference between its own season's
// minutes-weighted league mean and the reference season's — see `eraShift`.
// ADDITIVE, NOT SCALED, and for the reason bpmModel.js gives for centring
// without z-scoring: dividing by each season's spread would additionally assume
// the league's spread of shooting ability is the same width in 1997 and 2026,
// which is a second and much stronger claim than "the average moved".

import { weightedMean } from './bpmModel.js';
import { isAggregateTeam } from '../sources/wnbaReference.js';

/**
 * How much of a season a player must have PLAYED for it to be her best.
 *
 * 0.70 — the same 70% the NBA rule uses, where it is spelled 58 of 82 games
 * (scripts/cardgen/history.js). Spelled as a share here because there is no
 * single games number that means the same thing across a league whose season
 * ran 28 games in its first year and 44 in its most recent.
 */
export const LEGEND_MIN_GAMES_SHARE = 0.70;

/**
 * Minutes per game a season needs before it counts as one.
 *
 * THE MINUTES FLOOR, RESTATED IN A UNIT THAT TRAVELS. The NBA rule is 1000
 * season minutes, which over 82 games is 12 a night and over the 58 the games
 * floor allows is 17 — so it is really a per-night rule wearing a season's
 * clothes. Twenty minutes is half of a 40-minute game: the point at which a
 * player is unambiguously part of the rotation rather than filling one.
 *
 * It binds on exactly the seasons it should. Elena Delle Donne's 2021 is THREE
 * GAMES; Lauren Jackson's last years are injury fragments. Neither is a season,
 * and neither can be crowned.
 */
export const LEGEND_MIN_MPG = 20;

/**
 * How long that season's schedule was, MEASURED from the league table.
 *
 * DERIVED RATHER THAN DECLARED, and that is a deliberate reversal of what the
 * NBA side does — there a shortened schedule would have to be written down,
 * because the 2019-20 season was suspended and teams played anywhere from 63 to
 * 75 games, so no single number is right. The WNBA has no such season: every
 * team plays the same number of games, so the longest season anyone played IS
 * the schedule, and measuring it cannot go stale the way a table can.
 *
 * THE 99TH PERCENTILE, and both halves of that choice were measured:
 *
 *   NOT THE MAXIMUM, because a player traded between teams at different points
 *   of the schedule plays one more game than the schedule holds. Measured: 2010
 *   has a 35-game row in a 34-game season and 2025 a 45-game row in a 44-game
 *   one, so the max is wrong twice in the archive.
 *
 *   NOT THE 90TH EITHER, which was the first attempt. Ninety percent of a
 *   league's rows are NOT full-season players — the 2026 table has 230 names
 *   for fifteen rosters — so p90 sits below the schedule on the deepest
 *   seasons. p99 lands exactly on it in every completed season in the archive:
 *   28 in 1997, 32 in 2000, 34 through the 2010s, 22 in the 2020 bubble, 36 in
 *   2022, 40 in 2023-24, 44 in 2025.
 *
 * An UNFINISHED season reads as the games played so far, which is the right
 * answer rather than a defect: this number exists to ask "did she play most of
 * what there was to play", and mid-season there is less.
 */
export function scheduleLength(rows) {
  const games = rows.map(r => r.games ?? 0).filter(g => g > 0).sort((a, b) => a - b);
  if (games.length === 0) return null;
  return games[Math.min(games.length - 1, Math.round(0.99 * (games.length - 1)))];
}

/** The games a season needs, given its own schedule. */
export function minGamesFor(schedule, share = LEGEND_MIN_GAMES_SHARE) {
  if (!Number.isFinite(schedule) || schedule <= 0) return 0;
  return Math.ceil(share * schedule);
}

/**
 * A percentage restated in another season's shooting environment.
 *
 * `value - seasonMean + referenceMean`. See the header for why it is a shift
 * and not a stretch. A missing league mean leaves the value alone rather than
 * moving it by a made-up amount.
 */
export function eraShift(value, seasonMean, referenceMean) {
  if (!Number.isFinite(value)) return null;
  if (!Number.isFinite(seasonMean) || !Number.isFinite(referenceMean)) return value;
  return value - seasonMean + referenceMean;
}

/** The percentages that get era-shifted, and the field each is read from. */
export const SHOOTING_FIELDS = ['tsPct', 'fgPct2', 'fgPct3'];

/**
 * One season's minutes-weighted league mean of each shooting percentage.
 *
 * MINUTES-WEIGHTED for the reason centringBasis is: an unweighted mean over a
 * league table is dominated by its ten-minute cups of coffee, whose percentages
 * are noise, and "the league average shot" is the average MINUTE's shot rather
 * than the average name on the roster.
 */
export function shootingBasis(rows) {
  const basis = {};
  for (const field of SHOOTING_FIELDS) basis[field] = weightedMean(rows, r => r[field]);
  return basis;
}

/**
 * How much scoring a league produced per four minutes — the SCORING ENVIRONMENT.
 *
 * Measured straight off the season totals: `4 * league points / league minutes`.
 * No pace in it and no extra page to fetch, and it is the quantity a scoring
 * chart is actually denominated in, which league pace is only a proxy for.
 *
 * WHAT IT IS FOR: the report, and nothing else. The chart on a legend's card is
 * her REAL production per four minutes, unshifted — see buildLegendCard in the
 * runner — so this number is how a reader knows that a 1997 card's smaller
 * chart is partly the league and not entirely the player.
 */
export function scoringEnvironment(rows) {
  let points = 0;
  let minutes = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.ptsTotal) || !Number.isFinite(r.minutes)) continue;
    points += r.ptsTotal;
    minutes += r.minutes;
  }
  return minutes > 0 ? (4 * points) / minutes : null;
}

/**
 * Mean and sd of a season's fitted BPM among its real contributors.
 *
 * The WNBA counterpart of fetchHistory.js's `seasonDistribution`, and it exists
 * for the identical reason: a season is scored against ITS OWN league, so the
 * league's spread has to be measured in that league. The minutes cut is the
 * same idea as the NBA's 500-minute one, restated per game because the seasons
 * are not the same length — see LEGEND_MIN_MPG.
 */
export const DISTRIBUTION_MIN_MPG = 10;

export function fittedDistribution(rated, minMpg = DISTRIBUTION_MIN_MPG) {
  const values = rated
    .filter(r => (r.games ?? 0) > 0 && (r.minutes ?? 0) / r.games >= minMpg)
    .map(r => r.bpmHat)
    .filter(Number.isFinite);
  if (values.length < 2) return { n: values.length, mean: values[0] ?? 0, sd: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return { n: values.length, mean, sd: Math.sqrt(variance) };
}

/** A season's score: its fitted BPM in its own league's standard deviations. */
export function seasonScore(bpmHat, distribution) {
  if (!Number.isFinite(bpmHat) || !distribution || !(distribution.sd > 0)) return 0;
  return (bpmHat - distribution.mean) / distribution.sd;
}

/**
 * The best season of one career, with the NBA rule's TIERED fallback.
 *
 * Same three tiers and the same order — see history.js's `bestSeason`. Games
 * drops first because it is the rule about whether the season happened; the
 * minutes rule is about whether anything can be measured at all, so it is the
 * last thing given up. A career with nothing but fragments still produces a
 * card, and the record says it did.
 */
export function bestLegendSeason(seasons) {
  const scored = [...seasons];
  const enoughMinutes = scored.filter(s => (s.mpg ?? 0) >= LEGEND_MIN_MPG);
  const qualified = enoughMinutes.filter(s => (s.games ?? 0) >= (s.minGames ?? 0));

  const [pool, eligibility] = qualified.length > 0
    ? [qualified, 'both']
    : enoughMinutes.length > 0
      ? [enoughMinutes, 'mpgOnly']
      : [scored, 'none'];

  const best = pool.reduce((a, b) => (b.score > a.score ? b : a), pool[0] ?? null);
  return { scored, best, eligibility };
}

/**
 * The franchise a season's card prints, from the season's split rows.
 *
 * A `TOT` row is not a team. The NBA history path resolves this by taking the
 * split the player logged the most MINUTES for — the right answer for a card
 * that represents a whole season — and that is what happens here too.
 *
 * DELIBERATELY NOT the current WNBA set's rule, which takes the LAST split
 * because a card there prints where a player IS. Every player in this set
 * retired years ago; there is no "is". The season is the whole subject of the
 * card, so the jersey she wore for most of it is the right one.
 */
export function seasonTeam(statRowTeam, splitRows) {
  if (!isAggregateTeam(statRowTeam)) return statRowTeam;
  const biggest = (splitRows ?? [])
    .filter(r => !isAggregateTeam(r.team))
    .reduce((best, r) => (!best || (r.minutes ?? 0) > (best.minutes ?? 0) ? r : best), null);
  return biggest?.team ?? statRowTeam;
}

/**
 * How many rows in a season actually CARRY each model input.
 *
 * The point of the whole audit: Basketball-Reference publishing a COLUMN in
 * 1997 is not the same as that column having values in it, and the model reads
 * a missing feature as "exactly league average" (see `centredFeatures`), which
 * is silent. A season where a third of the league has no USG% would produce
 * numbers that look perfectly reasonable and mean much less than they appear
 * to. This is what says so.
 *
 * Rows with no minutes are excluded before counting: a player who never played
 * has no rates for a reason that is not a data gap.
 */
export function inputCoverage(rows, features, featureOf) {
  const played = rows.filter(r => (r.minutes ?? 0) > 0);
  const missing = {};
  for (const key of features) {
    const absent = played.filter(r => !Number.isFinite(featureOf(r, key))).length;
    if (absent > 0) missing[key] = { absent, of: played.length };
  }
  return { rows: played.length, missing, complete: Object.keys(missing).length === 0 };
}

/**
 * How far outside the NBA training data a season's inputs fall.
 *
 * THE MEASURABLE HALF OF "HOW FAR BACK WOULD YOU TRUST THIS". The untestable
 * half — whether a coefficient fitted on the NBA means the same thing in the
 * 1997 WNBA — has no answer from inside this data and bpmModel.js says so. What
 * CAN be checked is whether the model is being asked to INTERPOLATE or to
 * EXTRAPOLATE: a linear model applied inside the range it was fitted on is
 * doing the job it was validated for, and one applied far outside that range is
 * doing something nobody measured.
 *
 * `envelope` is the NBA fit's centred 1st-99th percentile per feature. The
 * percentile rather than the min/max because a single outlier NBA season would
 * otherwise declare every WNBA value in range.
 *
 * ⚠ THE INDICATOR FEATURES ARE EXCLUDED, and leaving them in was the first
 * version's mistake. `isGuard` and `isCenter` take two values, 0 and 1; centred
 * on a league whose guard SHARE differs from the NBA's by a few points, one of
 * those two values lands outside the NBA's percentile band and the other does
 * not — so the measure reported that half of 1997's guards were an
 * extrapolation, when what it had actually measured is that the 1997 WNBA
 * rostered slightly fewer of them. That is a fact about position labelling, not
 * about the model being asked something it was never fitted for, and mixing it
 * into the headline number inflated 1997 from 12% to 17%.
 */
export const INDICATOR_FEATURES = ['isGuard', 'isCenter'];

export function extrapolation(centred, envelope, features, skip = INDICATOR_FEATURES) {
  const ignored = new Set(skip);
  let outside = 0;
  let total = 0;
  const byFeature = {};
  for (const row of centred) {
    features.forEach((key, i) => {
      const range = envelope[key];
      if (!range || ignored.has(key)) return;
      total += 1;
      const v = row[i];
      if (v < range.lo || v > range.hi) {
        outside += 1;
        byFeature[key] = (byFeature[key] ?? 0) + 1;
      }
    });
  }
  return {
    cells: total,
    outside,
    share: total > 0 ? outside / total : 0,
    byFeature: Object.fromEntries(
      Object.entries(byFeature).sort((a, b) => b[1] - a[1]).slice(0, 6)
    ),
  };
}

/** Percentile bounds of each column of a fitted design matrix. */
export function featureEnvelope(rows, features, { lo = 0.01, hi = 0.99 } = {}) {
  const out = {};
  features.forEach((key, i) => {
    const v = rows.map(r => r[i]).filter(Number.isFinite).sort((a, b) => a - b);
    if (v.length < 2) return;
    const at = p => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
    out[key] = { lo: at(lo), hi: at(hi) };
  });
  return out;
}
