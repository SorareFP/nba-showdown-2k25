// Band computation: produces, per stat, 5 bands each with a roll-range width
// (from proportional 25-slot allocation) and a magnitude value.
//
// The normalization and rounding rules here are the Task 3 calibration
// finding (see scripts/cardgen/calibrate.js and "## Calibration finding" in
// docs/plans/2026-08-28-scoring-chart-matrix-redesign-design.md), verified
// against Nikola Jokic's real published 2023-24 scoring chart with 15/15
// exact value matches:
//
//   normalize(stat, minutes) = (stat * (36 / minutes)) / minutes   ("double" division)
//   toCardValue(raw)         = Math.round(roundDown(raw, 1))       (ROUNDDOWN to 1 decimal, then round to nearest)
//
// Cross-check (Task 4, Step 5): running computeStatBands on the Jokic fixture
// for pts/reb/ast reproduces the exact same 15 values Task 3's calibrate.js
// found for the "double + nearest" combination:
//   pts: [2, 3, 3, 4, 4]  reb: [1, 1, 1, 2, 2]  ast: [1, 1, 1, 1, 2]
// which match the real Final Cards.csv Jokic row exactly (band boundaries
// are a separate, independent computation — see note below). No remaining
// gap was found in the *value* computation.
//
// Note on band boundaries (roll ranges): Final Cards.csv encodes boundaries
// on a 1-20 die scale (e.g. "1-3", "4-11", "12-15", "16-20", "21+"), whereas
// this implementation allocates 25 slots (1-25) using largest-remainder
// rounding over the observed per-band game counts. The two scales aren't
// directly comparable slot-for-slot without knowing the original weighting
// method, so exact boundary reproduction was not attempted here — only the
// magnitude values were cross-checked, per the task's guidance that exact
// boundary reproduction isn't required.

import { percentileExc, roundDown } from './excelMath.js';

const CUTS = [0.1, 0.33, 0.5, 0.66, 0.9];
const TOTAL_SLOTS = 25;

function minutesToDecimal(mp) {
  if (typeof mp === 'number') return mp;
  const [m, s] = mp.split(':').map(Number);
  return m + s / 60;
}

// Task 3 finding: "double" division — divides by minutes twice, not once.
function normalize(stat, minutes) {
  return (stat * (36 / minutes)) / minutes;
}

// Task 3 finding: Excel ROUNDDOWN to 1 decimal, then round to nearest integer.
function toCardValue(raw) {
  return Math.round(roundDown(raw, 1));
}

/** Largest-remainder rounding so per-band slot counts sum exactly to TOTAL_SLOTS. */
function allocateSlots(weights) {
  const floors = weights.map(Math.floor);
  let remaining = TOTAL_SLOTS - floors.reduce((a, b) => a + b, 0);
  const remainders = weights.map((w, i) => ({ i, frac: w - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  const slots = [...floors];
  for (let k = 0; k < remaining; k++) slots[remainders[k].i] += 1;
  return slots;
}

export function computeStatBands(games, statKey) {
  const normalized = games.map(g => normalize(g[statKey], minutesToDecimal(g.minutes)));
  const thresholds = CUTS.map(p => percentileExc(normalized, p));
  const values = thresholds.map(t => toCardValue(t * 4));

  const counts = thresholds.map((t, i) => {
    if (i === 0) return normalized.filter(v => v <= t).length;
    return normalized.filter(v => v > thresholds[i - 1] && v <= t).length;
  });
  const totalCount = counts.reduce((a, b) => a + b, 0) || 1;
  const weights = counts.map(c => (c / totalCount) * TOTAL_SLOTS);
  const slots = allocateSlots(weights);

  let start = 1;
  return values.map((value, i) => {
    const width = slots[i] || 1;
    const band = { lo: start, hi: start + width - 1, value, slots: width };
    start += width;
    return band;
  });
}
