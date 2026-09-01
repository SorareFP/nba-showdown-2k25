// Orchestrator: ties Tasks 2-7 together into rawCards.js-compatible output.
//
// Pipeline: fetch game log -> computeStatBands per stat (Task 4) ->
// reconcileBands onto one shared roll-range table -> shapeChart (the two-tier
// floor, the forced shot-line break, then the identical-tier merge) ->
// applyOverrides (Task 6) -> toRawCardFormat.

import { computeStatBands } from './bands.js';
import { enforceZeroTiers } from './zeroFloor.js';
import { applyOverrides } from './overrides.js';
import * as basketballReference from './sources/basketballReference.js';

/**
 * Rows the card's table can print.
 *
 * Not a style choice: the chart is bottom-anchored and grows UPWARD into the
 * photo frame above it. src/cards/CardTemplate.test.js re-derives this number
 * from the stylesheet's own geometry (41px rows, 21px bottom offset, the photo
 * clip's lowest vertex) and fails if a sixth row would ever be asked for.
 */
export const MAX_PRINTED_ROWS = 5;

/**
 * Tiers a chart may hold — one more than it prints, because the blank tier is
 * structure the 2026-27 card does not draw (see visibleTiers in CardTemplate).
 *
 * The budget works out exactly: computeStatBands always returns five percentile
 * bands, enforceZeroTiers adds the blank one, and nothing downstream adds a
 * tier — the merge and the forced shot-line break can only ever remove or move
 * boundaries. So six is the ceiling by construction rather than by clamping,
 * and a chart that exceeded it would mean a new percentile cut had been added
 * upstream. generateCards' run report names any card that does, and the test
 * over the committed set fails, rather than a row being quietly folded away.
 */
export const MAX_CHART_TIERS = MAX_PRINTED_ROWS + 1;

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
 * `fixedTiers` leading tiers are held out of the merge entirely, and shapeChart
 * passes 1 for the blank tier. It is not printed (see visibleTiers), so letting
 * it swallow a no-scoring tier that also reads 0/0/0 would not save a row — it
 * would delete the second tier the whole two-tier floor exists to create, and
 * start the printed chart at roll 4 or 5 on the 292 cards whose bottom decile
 * rounds to nothing. Holding it out is what makes "a second tier where they
 * don't score" true on every card rather than on a sixth of them.
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

  // Moving tier i's lo UP to the roll hands every row between the old lo and
  // the roll to the tier below -- and when that tier is a blank, the card's
  // scoring floor is hollowed out. Jakob Poeltl found the seam: shot line 12
  // deep inside a wide flat tier, two boundaries equidistant at 7, and the
  // stable sort picked the one that turned rolls 5-11 into blanks. A move that
  // grows a zero tier loses to ANY other candidate, distance second.
  const extendsBlank = i =>
    next[i].lo < roll &&
    next[i - 1].pts === 0 && next[i - 1].reb === 0 && next[i - 1].ast === 0;
  reachable.sort((a, b) =>
    (extendsBlank(a) - extendsBlank(b)) ||
    (Math.abs(next[a].lo - roll) - Math.abs(next[b].lo - roll)));
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
 * NOTHING TRIMS THE RESULT, because nothing has to: five percentile bands plus
 * the blank tier is MAX_CHART_TIERS exactly, and the blank tier is not printed.
 * There was a fold here that gave a row back when every tier was printed and
 * six of them would not fit; the row it took was the no-scoring tier's, on the
 * cards that could least afford to lose it. Hiding the blank tier instead is
 * the user's call and frees the same row without spending anything.
 */
/**
 * How far the ceiling is pulled in.
 *
 * A DELIBERATE DEPARTURE FROM FIDELITY, and the only one in the pipeline. Every
 * other layer is calibrated to reproduce what a player actually did; this one
 * knowingly prints less than he did, at the top of the chart only, because the
 * game scores too much.
 *
 * The measurement that motivates it: at the observed +1.89 mean roll bonus the
 * TOP TIER ALONE is 23.8% of every chart point scored, and simulated games run
 * about 181 points per team against the ~96-152 a real NBA team scores and the
 * 150-170 the balance design targets. The chart channel is 93% of scoring, so
 * nothing in the assist or rebound economy can reach it -- doubling every spend
 * cost moves the total by 8 points.
 *
 * TWO DIALS, and they do different things:
 *
 *   TOP_TIER_DELAY  pushes the top tier's opening roll up, so reaching it needs
 *                   a bigger matchup advantage. Preserves the above-20 ceiling
 *                   as something a Speed/Power edge BUYS, which is the part of
 *                   the design worth keeping. Saturates: past about +4 the tier
 *                   is already out of reach and further delay buys little.
 *   TOP_TIER_SHAVE  lowers what the top tier pays. Keeps saturating because it
 *                   does not depend on reachability, but flattens the ceiling.
 *
 * Held at +2 / -1: 181 -> ~165 per team, inside the target band, with the top
 * tier still opening at 23 on average so the above-20 mechanic keeps its point.
 * The scoring removed here is meant to come back through strategy cards and
 * shot checks, which are a choice a player makes rather than a number the chart
 * hands out.
 */
export const TOP_TIER_DELAY = 2;
export const TOP_TIER_SHAVE = 1;

/**
 * Above this, the shave grows. The tail compresses; the body does not.
 *
 * A FLAT shave treats a 4-point ceiling and an 8-point one as the same problem,
 * and they are not. The top tier is thin at the top -- 187 of 354 cards cap at
 * 4 or less, 18 reach 7 and 4 reach 8 -- and it is only that last handful that
 * produces a scoreline nobody should see. Giannis Antetokounmpo prints 8 points
 * with 4 rebounds and 2 assists at roll 21, so eight sections at his ceiling is
 * 64 points, 32 rebounds and 16 assists from the chart ALONE, off a 36-game
 * season.
 *
 * So the shave grows by one for every two points above the cap, which leaves
 * everything at 5 or under exactly where it was and pulls the four extreme
 * cards in without flattening them into the pack. The upside they lose is meant
 * to come back through paint checks and assist spends -- a thing a player
 * chooses and pays for, rather than a number the chart hands out.
 */
export const TOP_TIER_SOFT_CAP = 5;

/** How much the top tier loses, given what it pays. */
export function topTierShave(topPts, { shave = TOP_TIER_SHAVE, softCap = TOP_TIER_SOFT_CAP } = {}) {
  if (!Number.isFinite(topPts)) return shave;
  return shave + Math.floor(Math.max(0, topPts - softCap) / 2);
}

/**
 * Pull in the top tier. Never below the tier beneath it -- a ceiling that sinks
 * under its own floor is not a suppressed chart, it is a broken one.
 */
export function suppressCeiling(chart, { delay = TOP_TIER_DELAY, shave = TOP_TIER_SHAVE } = {}) {
  if (chart.length < 2 || (!delay && !shave)) return chart;
  const out = chart.map(t => ({ ...t }));
  const k = out.length - 1;
  if (delay) {
    out[k].lo += delay;
    out[k - 1].hi = out[k].lo - 1;
  }
  const cut = shave ? topTierShave(out[k].pts, { shave }) : 0;
  if (cut) out[k].pts = Math.max(out[k].pts - cut, out[k - 1].pts);
  return out;
}

export function shapeChart(chart, { shotLine = null, ceilingDelay = TOP_TIER_DELAY } = {}) {
  const floored = enforceZeroTiers(chart);
  // firstMovable = 2: tier 0 is the blank tier and tier 1 is where the
  // statistics resume, so the lowest boundary a shot line may move is tier 2's.
  const { chart: broken } = forceBandBoundary(floored, shotLine, { firstMovable: 2 });
  // BEFORE the merge, not after. Shaving the top tier can make it identical to
  // the tier beneath it, and only mergeIdenticalTiers collapses that -- running
  // suppression last printed Toumani Camara with two identical bottom-of-chart
  // rows. The merge protects the shot-line boundary, so the break survives.
  // `ceilingDelay: 0` when bands were placed on the card's own roll CDF -- the
  // placement already prices the ceiling at its earned frequency, and a fixed
  // +2 on top of that would punish it twice. The magnitude shave still runs.
  const suppressed = suppressCeiling(broken, { delay: ceilingDelay });
  return mergeIdenticalTiers(suppressed, { fixedTiers: 1, keepBoundaryAt: shotLine });
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
