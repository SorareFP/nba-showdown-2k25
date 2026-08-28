/** Excel PERCENTILE.EXC: exclusive percentile, linear interpolation, 1-indexed rank. */
export function percentileExc(values, p) {
  if (p <= 0 || p >= 1) throw new RangeError('p must be strictly between 0 and 1');
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const rank = p * (n + 1);
  if (rank < 1 || rank > n) {
    throw new RangeError(`PERCENTILE.EXC out of range: rank ${rank} for n=${n} (Excel #NUM!)`);
  }
  const k = Math.floor(rank);
  const frac = rank - k;
  const lower = sorted[k - 1];
  if (frac === 0) return lower;
  const upper = sorted[k];
  return lower + frac * (upper - lower);
}

/** Excel ROUNDDOWN: truncate toward zero at the given number of decimal digits. */
export function roundDown(value, digits) {
  const factor = 10 ** digits;
  return Math.trunc(value * factor) / factor;
}
