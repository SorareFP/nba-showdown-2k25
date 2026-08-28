// scripts/cardgen/overrides.js

/**
 * overrides shape: { [playerId]: { chart: { [tierIndex]: { pts?, reb?, ast? } } } }
 * Sparse by design — only players actually tweaked appear here, and only the
 * fields being changed need to be present per tier.
 */
export function applyOverrides(players, overrides = {}) {
  const result = { ...players };
  for (const [playerId, override] of Object.entries(overrides)) {
    if (!result[playerId]) continue;
    const chart = result[playerId].chart.map((tier, i) => {
      const tierOverride = override.chart?.[i];
      return tierOverride ? { ...tier, ...tierOverride } : tier;
    });
    result[playerId] = { ...result[playerId], chart };
  }
  return result;
}
