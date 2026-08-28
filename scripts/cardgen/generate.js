// Orchestrator: ties Tasks 2-7 together into rawCards.js-compatible output.
//
// Pipeline: fetch game log -> computeStatBands per stat (Task 4) ->
// reconcileBands onto one shared roll-range table -> enforceZeroFloor
// (Task 5) -> applyOverrides (Task 6) -> toRawCardFormat.

import { computeStatBands } from './bands.js';
import { enforceZeroFloor } from './zeroFloor.js';
import { applyOverrides } from './overrides.js';
import * as basketballReference from './sources/basketballReference.js';

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
  let chart = reconcileBands({ pts, reb, ast });
  chart = enforceZeroFloor(chart);
  const withOverrides = applyOverrides({ [playerId]: { chart } }, overridesMap);
  return toRawCardFormat(withOverrides[playerId].chart);
}
