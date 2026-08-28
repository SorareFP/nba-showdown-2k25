/**
 * Hard floor only: natural-1 tier is always 0/0/0.
 * The "statistically-driven expansion" (more bands legitimately landing at
 * zero) is achieved upstream by how Task 4's percentile cuts are chosen,
 * not by force here — see design doc section 3.
 */
export function enforceZeroFloor(chart) {
  return chart.map((tier, i) =>
    i === 0 ? { ...tier, pts: 0, reb: 0, ast: 0 } : tier
  );
}
