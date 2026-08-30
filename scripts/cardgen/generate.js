// Orchestrator: ties Tasks 2-7 together into rawCards.js-compatible output.
//
// Pipeline: fetch game log -> computeStatBands per stat (Task 4) ->
// reconcileBands onto one shared roll-range table -> shapeChart (the two-tier
// floor from Task 5, then the identical-tier merge) -> applyOverrides (Task 6)
// -> toRawCardFormat.

import { computeStatBands } from './bands.js';
import { enforceZeroTiers } from './zeroFloor.js';
import { applyOverrides } from './overrides.js';
import * as basketballReference from './sources/basketballReference.js';

/** Two tiers are the same OUTCOME when all three printed numbers match. */
const sameOutcome = (a, b) => a.pts === b.pts && a.reb === b.reb && a.ast === b.ast;

/**
 * Collapses adjacent tiers that print the same PTS/REB/AST into one wider tier.
 *
 * WHY THE BAND COUNT VARIES AT ALL. The percentile cuts produce a fixed number
 * of bands for every player, but magnitudes are rounded to integers, so two
 * neighbouring buckets routinely land on the same three numbers — a card that
 * says "10-13: 3,1,1" and "14-20: 3,1,1" has spent two of its five rows saying
 * one thing. Merging them buys the row back and makes band count a real design
 * dimension again: rigid five-row uniformity is not something the statistics
 * asked for, it is something the generator imposed.
 *
 * NOT A RECONSTRUCTION OF THE ORIGINAL RULE. The finished 2025-26 set was
 * checked for this and it does NOT hold there: 30 of the 283 non-legend cards
 * carry adjacent tiers with identical outcomes and were left unmerged (21 of
 * them on five-band cards, which a merging pipeline could not have produced).
 * So the real 4- and 3-band cards came from somewhere else, and this is a
 * design choice going forward rather than a recovered one.
 *
 * `fixedTiers` leading tiers are held out of the merge. The blank natural-1
 * tier is passed as one: it is structural, it is not printed, and letting it
 * absorb a no-scoring tier that happens to also read 0/0/0 would delete the
 * second tier the whole two-tier floor exists to create.
 */
export function mergeIdenticalTiers(chart, { fixedTiers = 0 } = {}) {
  if (!Array.isArray(chart)) return chart;
  const merged = [];
  for (const tier of chart.slice(fixedTiers)) {
    const prev = merged[merged.length - 1];
    if (prev && sameOutcome(prev, tier)) prev.hi = tier.hi;
    else merged.push({ ...tier });
  }
  return [...chart.slice(0, fixedTiers), ...merged];
}

/**
 * The chart a card prints: statistical bands, then the two-tier floor, then the
 * merge — in that order, and the order is load-bearing.
 *
 * The floor runs BEFORE the merge because it changes outcomes (it zeroes the
 * points on the tier that starts at roll 2), and a merge that ran first would
 * miss the duplicates the floor itself creates. The blank tier is held out of
 * the merge; see mergeIdenticalTiers.
 */
export function shapeChart(chart) {
  return mergeIdenticalTiers(enforceZeroTiers(chart), { fixedTiers: 1 });
}

/**
 * Uses the PTS bands' roll ranges as the shared spine; REB/AST contribute
 * only their values per range (looked up by tier index, not by re-deriving
 * independent boundaries for REB/AST). This is a simplification versus each
 * stat having independently-sized bands (which is how the original chart
 * was apparently built) — see Task 8 plan notes. If REB or AST has fewer
 * tiers than PTS, the last REB/AST value is carried forward for any extra
 * PTS tiers.
 */
export function reconcileBands({ pts, reb, ast }) {
  return pts.map((tier, i) => ({
    lo: tier.lo,
    hi: tier.hi,
    pts: tier.value,
    reb: reb[i]?.value ?? reb[reb.length - 1].value,
    ast: ast[i]?.value ?? ast[ast.length - 1].value,
  }));
}

export function toRawCardFormat(chart) {
  return chart.map((t, i) =>
    i === chart.length - 1 ? [t.lo, 99, t.pts, t.reb, t.ast] : [t.lo, t.hi, t.pts, t.reb, t.ast]
  );
}

export async function generatePlayerChart(playerId, season, overridesMap = {}) {
  const games = await basketballReference.fetchGameLog(playerId, season);
  const pts = computeStatBands(games, 'pts');
  const reb = computeStatBands(games, 'reb');
  const ast = computeStatBands(games, 'ast');
  const chart = shapeChart(reconcileBands({ pts, reb, ast }));
  const withOverrides = applyOverrides({ [playerId]: { chart } }, overridesMap);
  return toRawCardFormat(withOverrides[playerId].chart);
}
