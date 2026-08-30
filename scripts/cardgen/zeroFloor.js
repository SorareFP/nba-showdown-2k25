// The bottom of every chart: two tiers that are not statistics, but design.
//
// THE FOUNDING REQUIREMENT, in the user's own words: "I think every card should
// have at least a natural 1 result in 0pts, 0reb, 0ast, and then we can have a
// second tier where they don't score." Two DIFFERENT tiers, and the difference
// between them is the whole point:
//
//   TIER 1  BLANK.       Rolls 1-2. 0/0/0. Nothing happens.
//   TIER 2  NO SCORING.  pts forced to 0, but REB and AST are whatever the
//                        statistics produced. "They don't score" — not
//                        "nothing happens". A big man who grabs a board on a
//                        possession he never shot on is the case this exists
//                        for, and zeroing his rebound would erase it.
//
// ── WHY THE BLANK TIER IS TWO ROLLS WIDE, NOT ONE ──────────────────────────
//
// Asked for directly: "I'm okay with expanding everyone's blank range to 1-2,
// or even 1-3 if that is what gives them a cold marker (I forget)." It does,
// and it is 1-2: src/game/engine.js scores every shot check with
// `if (r.die <= 2) ps.cold = (ps.cold || 0) + 1`, so a natural 1 OR 2 already
// marks a player cold. Making those same two rolls the blank tier is what puts
// the card and the engine into agreement about which rolls are the bad ones —
// before this, roll 2 was a cold marker on a roll the chart still paid out on.
//
// THE ROLLS ARE CARVED OUT OF THE BOTTOM BAND, NOT ADDED UNDER IT, and that
// choice is measured rather than aesthetic. The alternative — re-apportioning
// all five percentile bands across rolls 3..25 — reads more natural but shifts
// every boundary up by about two, which pushes the top band's floor from roll
// 20 to roll 21, out of a d20's reach. Measured across the 350-card pool that
// costs 13-14% of every chart's expected value per roll (PTS EV/per-4-min falls
// from 1.00 to 0.86). Carving instead leaves bands 1-4 exactly where the
// calibrated percentile cuts put them and holds the pool median at 1.00 PTS /
// 1.14 REB / 0.90 AST against per-4-minute rates — the finished 2025-26 set's
// own 1.00 / 1.16 / 0.88. The user's requirement that "a player's standard
// per-4 minute numbers ... occur naturally based on the remaining rolls above
// 1 or 2" is the constraint that decides this, and only the carve meets it.
//
// The cost lands where it should: the bottom decile, whose points are forced to
// zero anyway, shrinks from about three rolls to about one.

/** The rolls the blank tier covers: a natural 1 or 2, and nothing else. */
export const BLANK_TIER_LO = 1;
export const BLANK_TIER_HI = 2;

/**
 * The hard floor alone: tier 0 becomes 0/0/0, nothing else is touched.
 *
 * Kept as its own function, and still exported, because it is the narrower
 * statement — "the bottom tier never produces anything" — and it is the rule
 * the charts already in card-data/generated/ were built under.
 * `enforceZeroTiers` is the structure the set is built under NOW; this is what
 * it replaced, and it stays here so the older rule can still be read and tested
 * on its own.
 */
export function enforceZeroFloor(chart) {
  return chart.map((tier, i) =>
    i === 0 ? { ...tier, pts: 0, reb: 0, ast: 0 } : tier
  );
}

/**
 * True for the structural blank tier this module prepends.
 *
 * Shape, not position: `lo === 1 && hi === 2` and all three values zero. Note
 * that 66 cards of the finished 2025-26 set print exactly that row for real —
 * it is not a hidden tier and must never be treated as one. See visibleTiers in
 * src/cards/CardTemplate.jsx, which hides only the one-roll blank tier this
 * module used to emit.
 */
export function isBlankTier(tier) {
  return (
    !!tier &&
    tier.lo === BLANK_TIER_LO &&
    tier.hi === BLANK_TIER_HI &&
    tier.pts === 0 &&
    tier.reb === 0 &&
    tier.ast === 0
  );
}

/**
 * The full two-tier floor: a blank 1-2 tier, then a no-scoring tier.
 *
 * Takes the reconciled statistical chart (contiguous, starting at roll 1) and
 * returns it with rolls 1-2 carved off into their own blank tier and the band
 * that now starts at roll 3 stripped of its points.
 *
 * The bottom statistical band is normally 3-4 rolls wide, so it survives the
 * carve with rolls 3..n intact. If it were only one or two rolls wide, rolls
 * 1-2 were ALL of it — it is dropped entirely and the band above becomes the
 * no-scoring tier, rather than being given a roll range it does not own or
 * colliding with its neighbour.
 */
export function enforceZeroTiers(chart) {
  if (!Array.isArray(chart) || chart.length === 0) return chart;

  const blank = { lo: BLANK_TIER_LO, hi: BLANK_TIER_HI, pts: 0, reb: 0, ast: 0 };
  const rest = chart
    .map((tier, i) => (i === 0 ? { ...tier, lo: Math.max(tier.lo, BLANK_TIER_HI + 1) } : { ...tier }))
    .filter(tier => tier.hi >= tier.lo);

  if (rest.length === 0) return [blank];
  rest[0] = { ...rest[0], pts: 0 };
  return [blank, ...rest];
}
