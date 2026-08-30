// Folding the playoffs into the season, as additional games.
//
// The user's rule, verbatim: "I want it folded into the full-season stats ...
// not just something like (regular season numbers + playoff numbers)/2 but
// closer to just being truly folded into the totals. I want those games to
// count as additional data, not two separate sets."
//
// A straight mean of two rates is the thing being ruled out, and it is ruled out
// for a good reason: it would give a 22-game playoff run the same say as a
// 70-game regular season. What "additional data" means arithmetically is
// VOLUME-WEIGHTED POOLING — reconstruct what the combined sample would have
// produced:
//
//     pooled = (rs_rate * rs_volume + po_rate * po_volume) / (rs_volume + po_volume)
//
// which is exactly the rate you would compute if you had never split the season
// in two. The whole substance of this file is picking the right `volume` for
// each stat, because they are not the same stat and they do not share one.
//
// --- THE DENOMINATOR, PER STAT ----------------------------------------------
//
// EPM / OFF / DEF / USG are PER-100-POSSESSION rates, so they pool by
// POSSESSIONS. dunksandthrees' actual page reports neither possessions nor
// pace, so possessions are reconstructed the way shooting.js already does it —
// minutes at a single league pace, `possessionsFromMinutes`. Note what that
// means here: the pace constant appears in the numerator and the denominator of
// every weighted average below and CANCELS EXACTLY, so these are minutes-
// weighted in effect, and no choice of league pace can change a pooled value.
// (Playoff pace really does run a percent or two slower than the regular
// season's. Modelling that would move a weight by that same percent, on a number
// that is then z-scored across the pool and rounded onto a 10-28 integer scale.
// It cannot survive to the card, so it is not modelled.)
//
// SHOOTING PERCENTAGES pool by ATTEMPTS, and by the RELEVANT attempts — a rim
// FG% knows nothing about three-point volume. TS% is the one that is easy to get
// wrong: it is defined as PTS / (2 * (FGA + 0.44 * FTA)), so its denominator is
// TRUE SHOOTING ATTEMPTS, not field goals and not games. Weight it by TSA and
// the pooled figure is algebraically identical to recomputing TS% from combined
// points and combined attempts.
//
// Attempt counts are not reported either — the page gives attempt RATES per 75
// possessions — so they come back the same way, `attemptsFromPer75`. Same
// cancellation: an attempt-weighted average is unaffected by the pace constant.
//
// EW is a season TOTAL, so it is SUMMED, and so are games, minutes and starts.
// EW-per-game then falls out of the pooled totals, which is identical to
// weighting the two per-game rates by games played.
//
// THE BOX-SCORE RATE PERCENTAGES (orb/drb/ast/tov/stl/blk) are the one group
// without an exactly right denominator available: their true denominators are
// team and opponent opportunity counts the page does not carry. They pool by
// possessions, which is the closest proxy, and this is flagged rather than
// hidden. Nothing in the card set currently reads them — the scoring chart takes
// its rebounds and assists from the PREDICTED per-100 page, not this one — so
// the approximation costs nothing today.
//
// --- WHAT THIS DELIBERATELY DOES NOT DO -------------------------------------
//
// No strength-of-opposition adjustment. Playoff basketball is played against
// better teams, so a pooled shooting percentage slightly understates a deep-run
// player's true level against average opposition. EPM is opponent-adjusted at
// source and so is largely immune; the raw percentages are not. The user asked
// for the games to count as additional data, and that is what straight
// volume-weighting gives, so an adjustment would be answering a different
// question. See the run report for how large the effect actually looks.
//
// --- THE SHRINKAGE INTERACTION, WHICH IS THE POINT --------------------------
//
// shooting.js gates a boost by empirical-Bayes shrinkage weighted on attempt
// volume, and a deep playoff run is genuinely more evidence, so shrinkage
// SHOULD ease for those players. It does, and it does so without shooting.js
// knowing this file exists, because the pooled row carries pooled MINUTES
// alongside the possession-weighted attempt RATE. generateCards.js then calls
// `attemptsFromPer75(pooledRate, pooledMinutes)`, and that product is exactly
// `rs_attempts + po_attempts`:
//
//     pooled_rate * (poss_rs + poss_po) / 75
//       = (rate_rs * poss_rs + rate_po * poss_po) / 75
//       = attempts_rs + attempts_po
//
// So the attempts are pooled BEFORE the shrinkage sees them, which is the
// ordering that makes the easing real rather than cosmetic.

import { readCache } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { possessionsFromMinutes, attemptsFromPer75 } from './shooting.js';
import { SEASON_TYPE_PLAYOFFS } from './sources/dunksAndThrees.js';

/** Free-throw weight inside a true-shooting attempt. The standard 0.44. */
export const FT_TRIP_FACTOR = 0.44;

/**
 * Every volume one row can contribute, in real counts rather than rates.
 *
 * `possessions` and the attempt counts are both reconstructions (see the header)
 * and both are only ever used as WEIGHTS, where their shared constant cancels.
 * The one place an absolute count escapes is the pooled attempt total the
 * shrinkage reads, and that is the same reconstruction shooting.js was already
 * doing on the regular season alone.
 */
export function volumes(row) {
  const minutes = Number.isFinite(row?.minutes) && row.minutes > 0 ? row.minutes : 0;
  const possessions = possessionsFromMinutes(minutes);
  const att = per75 => attemptsFromPer75(per75, minutes);
  const fga = att(row?.fgaPer75);
  const fta = att(row?.ftaPer75);
  const fga3 = att(row?.fga3Per75);
  return {
    games: Number.isFinite(row?.games) && row.games > 0 ? row.games : 0,
    minutes,
    possessions,
    fga,
    fta,
    fga3,
    // 2P attempts by definition, not by adding rim and mid: those two are a
    // shot-location split that need not sum to every two-pointer taken.
    fga2: Math.max(fga - fga3, 0),
    fgaRim: att(row?.fgaRimPer75),
    fgaMid: att(row?.fgaMidPer75),
    // TS% = PTS / (2 * (FGA + 0.44 * FTA)). This is that denominator.
    tsa: fga + FT_TRIP_FACTOR * fta,
  };
}

/**
 * Which volume each rate pools on. The substance of the whole exercise.
 *
 * Read as "this stat is a per-X rate, so X is what makes one sample bigger than
 * another". A stat missing from this map is not a rate and is handled explicitly
 * below — summed, or carried across as identity.
 */
export const RATE_DENOMINATORS = {
  // Per-100-possession impact.
  epm: 'possessions',
  epmOff: 'possessions',
  epmDef: 'possessions',
  usage: 'possessions',
  // Shooting, each on the attempts that actually went into it.
  tsPct: 'tsa',
  efg: 'fga',
  fgPctRim: 'fgaRim',
  fgPctMid: 'fgaMid',
  fgPct2: 'fga2',
  fgPct3: 'fga3',
  ftPct: 'fta',
  // Attempt rates are themselves per-possession, so they pool per possession —
  // which is what makes pooled rate x pooled minutes come back to pooled
  // attempts exactly. See the header.
  fgaRimPer75: 'possessions',
  fgaMidPer75: 'possessions',
  fga3Per75: 'possessions',
  ftaPer75: 'possessions',
  fgaPer75: 'possessions',
  // Box-score rate percentages. Possessions is a PROXY here, not the true
  // denominator — see the header. Nothing on a card reads these yet.
  orbPct: 'possessions',
  drbPct: 'possessions',
  astPct: 'possessions',
  tovPct: 'possessions',
  stlPct: 'possessions',
  blkPct: 'possessions',
};

/**
 * Season totals, which pool by addition rather than by weighting.
 *
 * `ewins` is the sum of the splits that REPORTED one, so where the source
 * withheld a playoff EW it stays the regular-season total. That makes
 * `ewins / games` an understatement for those players, which is precisely why
 * `ewinsPerGame` below is derived from the two per-game rates instead of from
 * this sum. Nothing else reads the raw total.
 */
export const SUMMED_FIELDS = ['games', 'minutes', 'starts', 'ewins'];

/** Fields that describe the player rather than the sample. Taken from one side. */
export const IDENTITY_FIELDS = ['name', 'personId', 'team', 'position', 'age'];

/**
 * One volume-weighted mean over any number of `{ value, weight }` parts.
 *
 * A part with no usable value is DROPPED rather than treated as a zero: a center
 * who attempted no threes in the playoffs has no playoff 3P% to fold in, and
 * folding in a zero would invent a 0-for-however-many he never took. A part with
 * no weight is dropped for the same reason from the other direction.
 */
export function poolWeighted(parts) {
  const usable = (parts ?? []).filter(
    p => p && Number.isFinite(p.value) && Number.isFinite(p.weight) && p.weight > 0
  );
  if (usable.length === 0) return null;
  const total = usable.reduce((a, p) => a + p.weight, 0);
  if (!(total > 0)) return null;
  return usable.reduce((a, p) => a + p.value * p.weight, 0) / total;
}

/** Adds only the numbers that are there, and returns null if none of them were. */
export function poolSum(values) {
  const usable = (values ?? []).filter(Number.isFinite);
  if (usable.length === 0) return null;
  return usable.reduce((a, v) => a + v, 0);
}

/** A playoff row that carries no games or no minutes is no additional data. */
export const hasSample = row =>
  !!row && ((row.games ?? 0) > 0 || (row.minutes ?? 0) > 0);

/**
 * TWO SAMPLES OF THE SAME PLAYER, FOLDED. The arithmetic, with no opinion about
 * what the two samples ARE.
 *
 * Pulled out of `poolActualRow` because the regular season and the playoffs are
 * not the only two things this fold is right for. scripts/cardgen/
 * priorSeasonBlend.js folds a player's PREVIOUS SEASON into his current one for
 * the injury-shortened names on the force-include list, and it is the identical
 * question — "what would the combined sample have produced" — asked of a
 * different pair. Writing that fold a second time would be writing
 * RATE_DENOMINATORS a second time, and the two copies would drift.
 *
 * `a` supplies the identity fields, so the caller decides which side the name,
 * team and age come from. For the playoff fold that is the regular season; for
 * the prior-season blend it is the CURRENT season, because a card should say
 * which team he plays for now.
 *
 * PROVENANCE IS THE CALLER'S JOB. What comes back is the pooled sample and
 * nothing else — each caller knows what its two sides mean and labels them
 * accordingly.
 */
export function foldRows(a, b) {
  const vA = volumes(a);
  const vB = volumes(b);

  const pooled = {};
  for (const [field, weightKey] of Object.entries(RATE_DENOMINATORS)) {
    pooled[field] = poolWeighted([
      { value: a[field], weight: vA[weightKey] },
      { value: b[field], weight: vB[weightKey] },
    ]);
  }
  for (const field of SUMMED_FIELDS) {
    pooled[field] = poolSum([a[field], b[field]]);
  }

  const games = pooled.games ?? 0;
  const minutes = pooled.minutes ?? 0;

  return {
    ...Object.fromEntries(IDENTITY_FIELDS.map(f => [f, a[f]])),
    ...pooled,
    mpg: games > 0 ? minutes / games : null,
    // EW/GP is already per-game, so it pools WEIGHTED BY GAMES PLAYED. When both
    // sides report EW that is arithmetically the same as pooled EW over pooled
    // games — but it is NOT written that way, and the difference is not academic.
    //
    // dunksandthrees withholds EPM and EW below fifty minutes, and 74 of the 254
    // playoff rows fall under that line while still carrying real games. Dividing
    // an EW total that covers only one side by BOTH sides' games would credit
    // zero expected wins to games the source declined to rate, quietly marking a
    // player down for having reached the postseason. Weighting the two per-game
    // RATES drops the unrated side instead, which is the honest reading of "no
    // data" and leaves such a player's EW/GP exactly where it was.
    ewinsPerGame: poolWeighted([
      { value: a.ewinsPerGame, weight: vA.games },
      { value: b.ewinsPerGame, weight: vB.games },
    ]),
  };
}

/**
 * One player's regular season and playoffs, folded into a single row.
 *
 * Shape in, same shape out — `toActualSeasonRate`'s — plus provenance fields, so
 * every consumer keeps working without knowing pooling happened.
 *
 * THE NO-PLAYOFF CASE IS A SPREAD, not a re-derivation: a player whose team
 * missed the playoffs comes back with his regular-season numbers bit-for-bit
 * identical, because there is nothing to fold in. That is not missing data, it
 * is a complete season.
 */
export function poolActualRow(regular, playoffs) {
  if (!hasSample(playoffs)) {
    if (!regular) return null;
    return {
      ...regular,
      regularGames: regular.games ?? 0,
      regularMinutes: regular.minutes ?? 0,
      playoffGames: 0,
      playoffMinutes: 0,
      pooled: false,
    };
  }
  if (!regular) {
    return {
      ...playoffs,
      regularGames: 0,
      regularMinutes: 0,
      playoffGames: playoffs.games ?? 0,
      playoffMinutes: playoffs.minutes ?? 0,
      pooled: false,
    };
  }

  return {
    ...foldRows(regular, playoffs),
    regularGames: regular.games ?? 0,
    regularMinutes: regular.minutes ?? 0,
    playoffGames: playoffs.games ?? 0,
    playoffMinutes: playoffs.minutes ?? 0,
    pooled: true,
  };
}

/** Keys a row for matching: the stable numeric id first, the name as fallback. */
export const matchKeys = row =>
  [row?.personId != null ? `id:${row.personId}` : null, row?.name ? `name:${normalizeName(row.name)}` : null]
    .filter(Boolean);

/**
 * Every player's two splits, folded.
 *
 * Matched on `player_id` first and normalized name second. dunksandthrees serves
 * one row per player per season type — a mid-season trade is already aggregated
 * on their side — so this is a clean 1:1 join rather than a dedup.
 *
 * A playoff row with no regular-season partner is kept rather than dropped. It
 * should not happen and does not today, but silently discarding a player is a
 * worse failure than carrying a short sample.
 */
export function poolActualSeasons(regular = [], playoffs = []) {
  const index = new Map();
  for (const row of playoffs) {
    for (const key of matchKeys(row)) if (!index.has(key)) index.set(key, row);
  }

  const claimed = new Set();
  const out = [];
  for (const rs of regular) {
    const po = matchKeys(rs).map(k => index.get(k)).find(Boolean) ?? null;
    if (po) claimed.add(po);
    out.push(poolActualRow(rs, po));
  }
  for (const po of playoffs) {
    if (!claimed.has(po)) out.push(poolActualRow(null, po));
  }
  return out.filter(Boolean);
}

/**
 * The pooled ACTUAL rows for a season, straight off the two cached splits.
 *
 * The caches stay faithful to what each page served; the fold is a pure
 * derivation done on read, so it is re-run (and re-testable) every time rather
 * than frozen into a third cache file that could drift from its two parents.
 *
 * Returns null when the regular season is not cached, which is what the callers
 * already turn into their own "run fetchCalibrationData.js first" error. A
 * MISSING PLAYOFF CACHE IS NOT AN ERROR: it pools to the regular season alone,
 * which is the correct answer before a postseason has been played.
 */
export function readPooledActual(season) {
  const regular = readCache(`dunksandthrees-actual-${season}`);
  if (!regular) return null;
  const playoffs = readCache(`dunksandthrees-actual-${season}-st${SEASON_TYPE_PLAYOFFS}`) ?? [];
  return poolActualSeasons(regular, playoffs);
}

/** How much postseason a set of pooled rows actually gained. For run reports. */
export function poolingSummary(rows) {
  const withPlayoffs = (rows ?? []).filter(r => (r?.playoffGames ?? 0) > 0);
  const games = withPlayoffs.map(r => r.playoffGames).sort((a, b) => a - b);
  return {
    players: rows?.length ?? 0,
    gained: withPlayoffs.length,
    playoffGames: poolSum(games) ?? 0,
    maxPlayoffGames: games.length ? games[games.length - 1] : 0,
    medianPlayoffGames: games.length ? games[Math.floor(games.length / 2)] : 0,
  };
}
