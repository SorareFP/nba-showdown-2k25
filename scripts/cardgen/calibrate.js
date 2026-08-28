// Calibration script — determines empirically which minutes-normalization
// variant (single vs. double division) and which final-integer rounding rule
// the original card-design spreadsheet used, by reproducing Nikola Jokic's
// real, already-published 2023-24 scoring chart from `Final Cards.csv`.
//
// See "## Calibration finding" in
// docs/plans/2026-08-28-scoring-chart-matrix-redesign-design.md for the
// determined answer and the reasoning. Short version for Task 4:
//
//   Use the `double` variant (stat * 36/minutes / minutes) with `nearest`
//   rounding of the raw ROUNDDOWN(percentile*4, 1) decimal to the nearest
//   integer.

import { readFileSync } from 'node:fs';
import { percentileExc, roundDown } from './excelMath.js';

const games = JSON.parse(
  readFileSync(new URL('../../card-data/fixtures/jokic-2023-24-gamelog.json', import.meta.url))
);

function minutesToDecimal(mp) {
  const [m, s] = mp.split(':').map(Number);
  return m + s / 60;
}

function normalize(stat, minutes, variant) {
  const perMinScaled = stat * (36 / minutes);
  return variant === 'double' ? perMinScaled / minutes : perMinScaled;
}

const CUTS = [0.1, 0.33, 0.5, 0.66, 0.9];

// Real published Jokic chart, from card-data/source-recovered/Final Cards.csv:
//   1-3:"2,1,1"  4-11:"3,1,1"  12-15:"3,1,1"  16-20:"4,2,1"  21+:"4,2,2"
// Magnitude columns read low-band-to-high-band as [pts, reb, ast] per band;
// transposed per-stat below (5 bands each, in cut order 0.1/0.33/0.5/0.66/0.9):
const REAL = {
  pts: [2, 3, 3, 4, 4],
  reb: [1, 1, 1, 2, 2],
  ast: [1, 1, 1, 1, 2],
};

function round(value, rule) {
  switch (rule) {
    case 'nearest':
      return Math.round(value);
    case 'ceiling':
      return Math.ceil(value);
    case 'floor':
      return Math.floor(value);
    default:
      throw new Error(`unknown rounding rule: ${rule}`);
  }
}

const results = {}; // variant -> stat -> raw decimal values

function runVariant(variant) {
  results[variant] = {};
  for (const stat of ['pts', 'reb', 'ast']) {
    const normalized = games.map((g) => normalize(g[stat], minutesToDecimal(g.minutes), variant));
    const values = CUTS.map((p) => roundDown(percentileExc(normalized, p) * 4, 1));
    results[variant][stat] = values;
    console.log(`[${variant}] ${stat}:`, values);
  }
}

console.log('Real Jokic chart (Final Cards.csv): 1-3:"2,1,1" 4-11:"3,1,1" 12-15:"3,1,1" 16-20:"4,2,1" 21+:"4,2,2"');
console.log('Real per-stat integers -> pts:', REAL.pts, ' reb:', REAL.reb, ' ast:', REAL.ast);
console.log();

runVariant('single');
runVariant('double');

console.log();
console.log('=== Scoring each variant (raw decimal vs real integer, |diff|) ===');
for (const variant of ['single', 'double']) {
  let totalAbsDiff = 0;
  for (const stat of ['pts', 'reb', 'ast']) {
    const raw = results[variant][stat];
    const diffs = raw.map((v, i) => v - REAL[stat][i]);
    const absDiffs = diffs.map(Math.abs);
    totalAbsDiff += absDiffs.reduce((a, b) => a + b, 0);
    console.log(`[${variant}] ${stat} raw:`, raw, ' real:', REAL[stat], ' diff:', diffs.map((d) => d.toFixed(2)));
  }
  console.log(`[${variant}] total |raw - real| across all 15 values:`, totalAbsDiff.toFixed(3));
  console.log();
}

console.log('=== Rounding rule sweep (per variant, count of exact integer matches out of 15) ===');
for (const variant of ['single', 'double']) {
  for (const rule of ['nearest', 'ceiling', 'floor']) {
    let matches = 0;
    const rounded = {};
    for (const stat of ['pts', 'reb', 'ast']) {
      rounded[stat] = results[variant][stat].map((v) => round(v, rule));
      matches += rounded[stat].filter((v, i) => v === REAL[stat][i]).length;
    }
    console.log(`[${variant} + ${rule}] matches: ${matches}/15`, rounded);
  }
}
