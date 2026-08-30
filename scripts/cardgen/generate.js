// Orchestrator: ties Tasks 2-7 together into rawCards.js-compatible output.
//
// Pipeline: fetch game log -> computeStatBands per stat (Task 4) ->
// reconcileBands onto one shared roll-range table -> shapeChart (the two-tier
// floor, the forced shot-line break, then the identical-tier merge) ->
// applyOverrides (Task 6) -> toRawCardFormat.

import { computeStatBands } from './bands.js';
import { enforceZeroTiers, foldNoScoringTier } from './zeroFloor.js';
import { applyOverrides } from './overrides.js';
import * as basketballReference from './sources/basketballReference.js';

/**
 * Rows the card's table can print.
 *
 * Not a style choice: the chart is bottom-anchored and grows UPWARD into the
 * photo frame above it. src/cards/CardTemplate.test.js re-derives this number
 * from the stylesheet's own geometry (41px rows, 21px bottom offset, the photo
 * clip's lowest vertex) and fails if a sixth row would ever be asked for. Every
 * tier is printed, so this caps the tier count outright.
 */
export const MAX_CHART_TIERS = 5;

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
 * checked for this and it does NOT hold there: 33 of its 306 cards carry
 * adjacent tiers with identical outcomes and were left unmerged (23 of them on
 * five-band cards, which a merging pipeline could not have produced), and
 * LeBron 08-09 prints "10-13: 3,1,1" and "14-20: 3,1,1" as separate rows. So
 * the real 4- and 3-band cards came from somewhere else, and this is a design
 * choice going forward rather than a recovered one.
 *
 * `keepBoundaryAt` is a roll a merge may never cross — the shot line, which the
 * chart has to break at so the arrow lands on a real dividing line (see
 * forceBandBoundary and findShotLineBoundary in CardTemplate). It is the
 * "unless needed for a shot chart" half of the user's instruction, and without
 * it the merge would happily undo the break the previous step just forced.
 *
 * `fixedTiers` leading tiers are held out of the merge entirely. Nothing passes
 * it today: the blank tier is PRINTED now, so letting it absorb a no-scoring
 * tier that also reads 0/0/0 is exactly right — it turns two identical printed
 * rows ("1-2: 0,0,0" and "3: 0,0,0") into the one row that says the same thing.
 */
export function mergeIdenticalTiers(chart, { fixedTiers = 0, keepBoundaryAt = null } = {}) {
  if (!Array.isArray(chart)) return chart;
  const merged = [];
  for (const tier of chart.slice(fixedTiers)) {
    const prev = merged[merged.length - 1];
    if (prev && sameOutcome(prev, tier) && tier.lo !== keepBoundaryAt) prev.hi = tier.hi;
    else merged.push({ ...tier });
  }
  return [...chart.slice(0, fixedTiers), ...merged];
}

/**
 * Moves the nearest band boundary onto `roll`, so the chart breaks exactly
 * there.
 *
 * WHY. Shot Line is communicated by one arrow and nothing else, and the arrow
 * sits ON the rule between the last roll that misses and the first that makes
 * (measured across all 300 printed cards; see findShotLineBoundary). That rule
 * only exists if a band starts at the shot line. Only 74 of 331 charts happened
 * to break there on their own, so for the rest the break has to be made.
 *
 * MOVES A BOUNDARY RATHER THAN INSERTING A BAND. Inserting would cost a row out
 * of a five-row table and would have to invent a magnitude for it; moving the
 * nearest boundary keeps every magnitude the percentile cuts produced and only
 * changes how many rolls two neighbouring bands cover. Across the pool the
 * nearest boundary is a median of one roll away.
 *
 * `firstMovable` protects the boundaries below it. The blank tier's own start
 * (roll 1) and the roll the statistics resume at are structure, not statistics.
 *
 * Returns `{ chart, moved, from }`: `moved` is the signed distance the boundary
 * travelled, 0 when the chart already broke there, and null when no boundary
 * could reach the roll without collapsing a band to nothing (in which case the
 * chart comes back untouched — a chart with a wrong band is worse than one
 * whose arrow has to be dropped).
 */
export function forceBandBoundary(chart, roll, { firstMovable = 1 } = {}) {
  if (!Array.isArray(chart) || !Number.isFinite(roll)) return { chart, moved: 0, from: null };
  const next = chart.map(t => ({ ...t }));
  for (let i = firstMovable; i < next.length; i += 1) {
    if (next[i].lo === roll) return { chart: next, moved: 0, from: roll };
  }
  // A boundary can move to `roll` only if it leaves both neighbours at least one
  // roll wide: strictly above the band below's start, at or below its own end.
  const reachable = [];
  for (let i = firstMovable; i < next.length; i += 1) {
    if (roll > next[i - 1].lo && roll <= next[i].hi) reachable.push(i);
  }
  if (reachable.length === 0) return { chart, moved: null, from: null };

  reachable.sort((a, b) => Math.abs(next[a].lo - roll) - Math.abs(next[b].lo - roll));
  const i = reachable[0];
  const from = next[i].lo;
  next[i].lo = roll;
  next[i - 1].hi = roll - 1;
  return { chart: next, moved: roll - from, from };
}

/**
 * The chart a card prints: statistical bands, the two-tier floor, the forced
 * shot-line break, then the merge — in that order, and the order is
 * load-bearing.
 *
 * THE FLOOR RUNS FIRST because it changes outcomes (it zeroes the points on the
 * tier that starts at roll 3), and a merge that ran before it would miss the
 * duplicates the floor itself creates.
 *
 * THE BREAK RUNS BEFORE THE MERGE, not after. Forcing first means the merge
 * sees the final boundaries and can collapse across the ones that survived;
 * forcing afterwards would be moving boundaries in a chart that had already
 * been shortened, so each move would distort a wider band. The merge is told to
 * leave the shot line alone, so it cannot undo the break.
 *
 * FINALLY THE ROW CAP. Every tier is printed and the table holds five rows, so
 * a chart where nothing merged has one tier too many; foldNoScoringTier gives
 * that row back. The merge runs again afterwards because folding can create a
 * fresh pair of identical neighbours.
 */
export function shapeChart(chart, { shotLine = null } = {}) {
  const floored = enforceZeroTiers(chart);
  // firstMovable = 2: tier 0 is the blank tier and tier 1 is where the
  // statistics resume, so the lowest boundary a shot line may move is tier 2's.
  const { chart: broken } = forceBandBoundary(floored, shotLine, { firstMovable: 2 });
  const merged = mergeIdenticalTiers(broken, { keepBoundaryAt: shotLine });
  if (merged.length <= MAX_CHART_TIERS) return merged;
  const folded = foldNoScoringTier(merged, { keepBoundaryAt: shotLine });
  return mergeIdenticalTiers(folded, { keepBoundaryAt: shotLine });
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

export async function generatePlayerChart(playerId, season, overridesMap = {}, shotLine = null) {
  const games = await basketballReference.fetchGameLog(playerId, season);
  const pts = computeStatBands(games, 'pts');
  const reb = computeStatBands(games, 'reb');
  const ast = computeStatBands(games, 'ast');
  const chart = shapeChart(reconcileBands({ pts, reb, ast }), { shotLine });
  const withOverrides = applyOverrides({ [playerId]: { chart } }, overridesMap);
  return toRawCardFormat(withOverrides[playerId].chart);
}
