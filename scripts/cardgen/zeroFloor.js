// The bottom of every chart: two tiers that are not statistics, but design.
//
// THE FOUNDING REQUIREMENT, in the user's own words: "I think every card should
// have at least a natural 1 result in 0pts, 0reb, 0ast, and then we can have a
// second tier where they don't score." Two DIFFERENT tiers, and the difference
// between them is the whole point:
//
//   TIER 1  BLANK.       Roll 1, and only roll 1. 0/0/0. Nothing happens.
//   TIER 2  NO SCORING.  pts forced to 0, but REB and AST are whatever the
//                        statistics produced. "They don't score" — not
//                        "nothing happens". A big man who grabs a board on a
//                        possession he never shot on is the case this exists
//                        for, and zeroing his rebound would erase it.
//
// Tier 1 is exactly one roll wide because that is what "a natural 1" means, and
// because the card does not print it (see CardTemplate: a tier that is always
// blank costs a row of a five-row table to say nothing). Carving it out of the
// bottom statistical band rather than shifting every boundary up by one keeps
// every OTHER band exactly where the calibrated percentile cuts put it — the
// roll that moves was already floored to 0/0/0 before this file was extended,
// so the PTS expected value per roll is unchanged by the carve. What does move
// is REB/AST: rolls that used to pay nothing now pay the bottom decile's
// rebound and assist, which is the design change being asked for.

/**
 * The hard floor alone: tier 0 becomes 0/0/0, nothing else is touched.
 *
 * Kept as its own function, and still exported, because it is the narrower
 * statement — "a natural 1 never produces anything" — and it is the rule the
 * charts already in card-data/generated/ were built under. `enforceZeroTiers`
 * is the structure the set is built under NOW; this is what it replaced, and
 * it stays here so the older rule can still be read and tested on its own.
 */
export function enforceZeroFloor(chart) {
  return chart.map((tier, i) =>
    i === 0 ? { ...tier, pts: 0, reb: 0, ast: 0 } : tier
  );
}

/** The one roll the blank tier covers. A natural 1, and nothing else. */
export const BLANK_TIER_ROLL = 1;

/** True for the structural blank tier this module prepends — see CardTemplate. */
export function isBlankTier(tier) {
  return (
    !!tier &&
    tier.lo === BLANK_TIER_ROLL &&
    tier.hi === BLANK_TIER_ROLL &&
    tier.pts === 0 &&
    tier.reb === 0 &&
    tier.ast === 0
  );
}

/**
 * The full two-tier floor: a blank natural-1 tier, then a no-scoring tier.
 *
 * Takes the reconciled statistical chart (contiguous, starting at roll 1) and
 * returns it with roll 1 carved off into its own blank tier and the band that
 * now starts at roll 2 stripped of its points.
 *
 * The bottom statistical band is normally 3-4 rolls wide, so it survives the
 * carve with rolls 2..n intact. If it were only one roll wide, roll 1 was ALL
 * of it — it is dropped entirely and the band above becomes the no-scoring
 * tier, rather than being given a roll range it does not own or colliding with
 * its neighbour.
 */
export function enforceZeroTiers(chart) {
  if (!Array.isArray(chart) || chart.length === 0) return chart;

  const blank = { lo: BLANK_TIER_ROLL, hi: BLANK_TIER_ROLL, pts: 0, reb: 0, ast: 0 };
  const rest = chart
    .map((tier, i) => (i === 0 ? { ...tier, lo: Math.max(tier.lo, BLANK_TIER_ROLL + 1) } : { ...tier }))
    .filter(tier => tier.hi >= tier.lo);

  if (rest.length === 0) return [blank];
  rest[0] = { ...rest[0], pts: 0 };
  return [blank, ...rest];
}
