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
//
// Fixed post-Task-4 (code review): allocateSlots previously computed weights
// already pre-scaled to a 25-slot budget, and computeStatBands patched a
// zero-weight band up to width 1 via `slots[i] || 1` *without* deducting that
// slot from anywhere else — so total width could exceed TOTAL_SLOTS (seen:
// 29 instead of 25 for a mostly-zero-value stat, e.g. blocks/steals for a
// non-specialist). allocateSlots now reserves 1 slot per band out of the
// TOTAL_SLOTS budget itself before apportioning the rest, so the sum is
// always exactly TOTAL_SLOTS by construction; computeStatBands also asserts
// this invariant and throws loudly if it's ever violated.

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

/**
 * Apportion `totalSlots` slots across `weights.length` bands via largest-remainder
 * rounding, guaranteeing every band gets at least `minPerBand` slot(s) AND the
 * returned slot counts always sum to exactly `totalSlots`.
 *
 * The minimum is reserved out of the budget up front (not added on top of it):
 * `minPerBand` per band is set aside first, then the *remaining* budget
 * (`totalSlots - weights.length * minPerBand`) is apportioned proportionally to
 * `weights` by largest remainder. This is what makes the invariant hold even
 * when a band's raw weight is 0 (e.g. a stat value that never occurs in a
 * percentile bucket) — previously, a bare `slots[i] || 1` fallback promoted a
 * zero-weight band to width 1 *without* removing a slot from anywhere else,
 * so the total could exceed totalSlots (observed: 29 instead of 25 for a
 * mostly-zero-value stat). Reserving the minimum inside the budget instead of
 * bolting it on afterward means the invariant is structural, not incidental.
 */
function allocateSlots(weights, totalSlots = TOTAL_SLOTS, minPerBand = 1) {
  const n = weights.length;
  const reserved = n * minPerBand;
  if (reserved > totalSlots) {
    throw new Error(
      `allocateSlots: cannot reserve ${minPerBand} slot(s) for each of ${n} bands within a budget of ${totalSlots} slots`
    );
  }
  const budget = totalSlots - reserved;
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const shares = totalWeight > 0
    ? weights.map(w => (w / totalWeight) * budget)
    : weights.map(() => budget / n);

  const floors = shares.map(Math.floor);
  const remaining = budget - floors.reduce((a, b) => a + b, 0);
  const remainders = shares.map((s, i) => ({ i, frac: s - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  const slots = floors.map(f => f + minPerBand);
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
  const slots = allocateSlots(counts);

  let start = 1;
  const bands = values.map((value, i) => {
    const width = slots[i];
    const band = { lo: start, hi: start + width - 1, value, slots: width };
    start += width;
    return band;
  });

  const totalWidth = bands.reduce((sum, b) => sum + b.slots, 0);
  if (totalWidth !== TOTAL_SLOTS) {
    throw new Error(
      `computeStatBands: band slot widths summed to ${totalWidth}, expected ${TOTAL_SLOTS} (stat=${statKey})`
    );
  }

  return bands;
}

/**
 * The distribution of rolls a card ACTUALLY experiences, as a CDF.
 *
 * `field` is every card it can face, each needing only `{ speed, power,
 * defBoost }` — the roll bonus is a function of those three and nothing else,
 * which is what makes this computable BEFORE the chart exists. That ordering is
 * the whole reason this approach is possible: Speed+Power is settled first, so
 * a card's matchup profile is known while its bands are still being cut.
 *
 * Returns `roll -> P(effective roll <= roll)`, with the engine's own clamp
 * applied so a huge penalty piles onto 1 exactly as it does in play.
 */
export function effectiveRollCdf(card, field, calcAdv, { faces = 20, maxRoll = 60 } = {}) {
  const counts = new Map();
  let n = 0;
  for (const opp of field) {
    if (opp === card) continue;
    const bonus = calcAdv(card, opp).rollBonus;
    for (let die = 1; die <= faces; die += 1) {
      const roll = Math.max(1, Math.min(die + bonus, maxRoll));
      counts.set(roll, (counts.get(roll) ?? 0) + 1);
      n += 1;
    }
  }
  const cdf = new Map();
  let cum = 0;
  for (let r = 1; r <= maxRoll; r += 1) {
    cum += (counts.get(r) ?? 0) / (n || 1);
    cdf.set(r, cum);
  }
  return cdf;
}

/**
 * Anchor the floor, ramp the ceiling: place band boundaries on this card's OWN
 * roll distribution, but only as far up the chart as the boundary sits.
 *
 * THE BUG THE CDF HALF FIXES. The linear layout above apportions slots by real
 * frequency and then walks them out from roll 1, which is only correct if every
 * roll is equally likely. It is not: the chart is read at `die + rollBonus`,
 * and that bonus has mean +1.92 across the field and +10.89 for Nikola Jokic.
 * So a top tier cut as a 5% event is reached 5% of the time by the median card
 * and 45% of the time by Giannis Antetokounmpo.
 *
 * THE BUG A PURE CDF PLACEMENT CREATES, and why the blend exists. Placing EVERY
 * boundary at the CDF made Giannis blank on any roll under 14 -- statistically
 * true across the whole field, but in the one matchup where his bonus is small
 * he would brick more than half his rolls, which no one would read as the best
 * card in the set. The floor is a per-matchup experience; the ceiling is a
 * per-season frequency. So each boundary moves toward its CDF position by a
 * weight that ramps 0 -> 1 from the first boundary to the last: the bottom
 * stays exactly linear (scoring still starts where it always did), the TOP
 * boundary lands exactly where this card's own distribution says its earned
 * frequency lives, and the stretch lands in the middle bands -- which is where
 * the extra width was wanted anyway.
 *
 * Symmetric on purpose: a penalty card's ceiling slides DOWN below the linear
 * position, because a card that mostly rolls 1-16 has also earned the right to
 * reach its (small) top tier as often as it did in real life.
 *
 * The magnitudes do not move -- those are the player's own production and stay
 * exactly where the percentile cuts put them. Only the boundaries move.
 */
export function placeBandsOnCdf(bands, cdf, { maxRoll = 60 } = {}) {
  const n = bands.length;
  if (n < 2) return bands.map(b => ({ ...b }));
  const total = bands.reduce((s, b) => s + b.slots, 0) || TOTAL_SLOTS;
  const out = bands.map(b => ({ ...b }));
  let cum = 0;
  let prevHi = 0;
  for (let i = 0; i < n - 1; i += 1) {
    cum += bands[i].slots / total;
    // The lowest roll at which this card has already seen `cum` of its rolls.
    let cdfHi = maxRoll;
    for (let r = 1; r <= maxRoll; r += 1) {
      if ((cdf.get(r) ?? 1) >= cum) { cdfHi = r; break; }
    }
    const w = n === 2 ? 1 : i / (n - 2);
    let hi = Math.round(bands[i].hi + w * (cdfHi - bands[i].hi));
    if (hi <= prevHi) hi = prevHi + 1;                     // every band keeps a roll
    const roomForRest = maxRoll - (n - 1 - i);
    if (hi > roomForRest) hi = roomForRest;                // and so does every band above
    out[i].lo = prevHi + 1;
    out[i].hi = hi;
    prevHi = hi;
  }
  out[n - 1].lo = prevHi + 1;
  out[n - 1].hi = Math.max(bands[n - 1].hi, prevHi + 1);
  return out;
}
