// Everything on a card that is NOT the scoring chart: the Speed/Power split,
// Shot Line, the three boosts, and Salary.
//
// PROVENANCE, AND WHAT IS AND IS NOT CLAIMED HERE.
//
// memory/speed_power_methodology.md preserved its derivation, so the Speed/Power
// split below FOLLOWS it: a combined budget (already produced, in
// card-data/generated/speed-power-totals-2026.json) divided by positional
// tendency. The position ratios are not invented — they are measured off the 283
// finished cards, joined to those players' real primary positions.
//
// memory/shooting_attributes_methodology.md says the opposite about the shooting
// layer: "The exact conversion rules from raw stats to boost values are NOT
// preserved... Do not invent a formula and present it as recovered." Nothing
// here is presented as recovered. What is done instead is a REFIT: a candidate
// rule is proposed from the ONE thing that IS verified — the D20 probability
// calibration — and then its coefficients are fitted against the 283 finished
// cards and its error reported. A refit with a published error rate is a
// different claim from a recovered formula, and the difference is kept visible
// in the output (every record is marked provisional, and the calibration file
// carries the fit quality).
//
// THE VERIFIED ANCHOR, which everything in the shooting layer hangs off:
//
//     effective_line = shot_line - boost
//     success_probability = (20 - effective_line) / 20
//
// Confirmed against real cards — Curry's Shot Line 13 with 3PT +2 gives an
// effective 11, and 11 is what ~45% from three is worth on a D20. So a boost is
// SIZED TO HIT A TARGET PERCENTAGE, not assigned by rank, and the same boost
// value means different things on two different cards. That is why the 3PT
// predictor below is `shotLine - impliedLine(3P%)` — a distance in line units —
// rather than a ranking of 3P%.

/** The D20 conversion, both directions. `line` is what a roll must beat. */
export const successProbability = line => (20 - line) / 20;
export const impliedLine = probability => 20 - 20 * probability;

/**
 * Share of a player's Speed+Power budget that goes to SPEED, by position.
 *
 * MEASURED, not chosen: every non-legend card in `Final Cards.csv` was joined to
 * its player's primary position in Basketball-Reference's 2024-25 per-game table
 * (282 of 283 matched) and the mean of `speed / (speed + power)` taken per
 * position. The gradient is exactly the one memory/speed_power_methodology.md
 * describes — guards skew Speed, bigs skew Power — and it is steep: a point
 * guard gets nearly two thirds of his budget as Speed, a center barely a third.
 *
 * Re-derive with `node scripts/cardgen/calibrateAttributes.js`, which prints
 * these and writes them into the calibration file. They are duplicated here as
 * the fallback for a checkout that has neither the calibration file nor the
 * gitignored CSV.
 *
 * Checked and deliberately NOT modelled: whether the share drifts with the size
 * of the budget. The per-position slopes come out between -0.003 and +0.006 per
 * point of total, i.e. under a tenth of a Speed point across the whole 10-28
 * range. A pure positional average is what the methodology describes and the
 * data gives no reason to add a term.
 */
export const POSITION_SPEED_SHARE = {
  PG: 0.6269,
  SG: 0.594,
  SF: 0.4921,
  PF: 0.4398,
  C: 0.3701,
};

/** Neither guard nor big — used only when a position is missing or unrecognised. */
export const DEFAULT_SPEED_SHARE = 0.5;

/**
 * Reduces whatever a source calls a position to one of the five.
 *
 * Sources disagree: Basketball-Reference writes "PF" or "SF-PF", dunksandthrees
 * writes "F-C" or "G". The first token wins, and the one-letter forms map to the
 * middle of their group rather than to a guess at a specific slot.
 */
export function basePosition(pos) {
  const first = String(pos ?? '').trim().split(/[-/,]/)[0].trim().toUpperCase();
  if (POSITION_SPEED_SHARE[first] !== undefined) return first;
  if (first === 'G') return 'SG';
  if (first === 'F') return 'SF';
  return null;
}

/**
 * Divides a combined budget into Speed and Power.
 *
 * Power is the REMAINDER, never independently rounded, so the two always sum to
 * exactly the budget — the conservation rule in step 4 of the methodology. Both
 * sides are kept at 1 or above: a 0 on a card reads as missing data.
 */
export function splitSpeedPower(total, pos, shares = POSITION_SPEED_SHARE) {
  const t = Math.max(Math.round(total ?? 0), 2);
  const share = shares[basePosition(pos)] ?? DEFAULT_SPEED_SHARE;
  const speed = Math.min(Math.max(Math.round(t * share), 1), t - 1);
  return { speed, power: t - speed };
}

/** Mean and (population) standard deviation, ignoring non-finite values. */
export function meanSd(values) {
  const v = values.filter(Number.isFinite);
  if (v.length === 0) return { mean: 0, sd: 0, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { mean, sd, n: v.length };
}

/** z-scorer over a pool. A zero spread yields 0 rather than a division by zero. */
export function zScorer(values) {
  const { mean, sd } = meanSd(values);
  return x => (Number.isFinite(x) && sd > 0 ? (x - mean) / sd : 0);
}

/**
 * Ordinary least squares with an intercept, by Gauss-Jordan on the normal
 * equations.
 *
 * Returns `null` when the system is singular (a constant or duplicated
 * predictor) rather than propagating NaN coefficients into a card — a silent
 * NaN here becomes a blank stat on 331 cards, which is exactly the failure this
 * whole file exists to end.
 */
export function fitLeastSquares(rows, yOf, xOf) {
  const X = rows.map(r => [1, ...xOf.map(f => f(r))]);
  const Y = rows.map(yOf);
  if (X.length === 0) return null;
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let i = 0; i < X.length; i += 1) {
    if (!Number.isFinite(Y[i]) || X[i].some(v => !Number.isFinite(v))) return null;
    for (let a = 0; a < k; a += 1) {
      b[a] += X[i][a] * Y[i];
      for (let c = 0; c < k; c += 1) A[a][c] += X[i][a] * X[i][c];
    }
  }
  for (let i = 0; i < k; i += 1) {
    let pivot = i;
    for (let r = i + 1; r < k; r += 1) if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r;
    if (Math.abs(A[pivot][i]) < 1e-10) return null;
    [A[i], A[pivot]] = [A[pivot], A[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    for (let r = 0; r < k; r += 1) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c < k; c += 1) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const coef = b.map((v, i) => v / A[i][i]);
  const predictWith = xs => coef.reduce((s, c, i) => s + c * (i === 0 ? 1 : xs[i - 1]), 0);
  const meanY = Y.reduce((a, c) => a + c, 0) / Y.length;
  let ssRes = 0;
  let ssTot = 0;
  rows.forEach((r, i) => {
    ssRes += (Y[i] - predictWith(xOf.map(f => f(r)))) ** 2;
    ssTot += (Y[i] - meanY) ** 2;
  });
  return { coef, r2: ssTot > 1e-12 ? 1 - ssRes / ssTot : 0, n: rows.length };
}

/** Applies a fitted model to a raw predictor vector. */
export const applyModel = (model, xs) =>
  model.coef.reduce((s, c, i) => s + c * (i === 0 ? 1 : (xs[i - 1] ?? 0)), 0);

/**
 * Rounds a boost prediction, with a DEADBAND around zero.
 *
 * The deadband is what makes the output look like the real set instead of like a
 * regression. On the 283 finished cards, 64% of 3PT Boosts and 90% of Paint
 * Boosts are exactly 0 — the modifier is the exception, reserved for a genuine
 * relative strength or weakness, and plain rounding of a continuous prediction
 * would hand nearly everybody a +1 and destroy that. The width is calibrated
 * against those real zero shares, not picked.
 */
export function roundBoost(value, deadband, { min = -5, max = 5 } = {}) {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) < deadband) return 0;
  return Math.min(Math.max(Math.round(value), min), max);
}

/**
 * Turns a least-squares prediction into a boost, restoring its SPREAD first.
 *
 * A least-squares fit is deliberately under-dispersed: it minimises squared
 * error, which for a noisy target means predicting closer to the mean than the
 * truth ever is. Left alone that produced a set whose 3PT Boosts ran -1 to +2
 * where the real set runs -5 to +5, and 84% zeros where the real set has 64% —
 * every specialist quietly sanded down into an average shooter, which is
 * precisely the "player identity" the design philosophy exists to protect.
 *
 * So the prediction is rescaled about the target's mean by `spread`, the ratio
 * of the real standard deviation to the fitted one, before the deadband and the
 * rounding. This deliberately trades a little accuracy for a distribution that
 * looks like the real set's — the right trade here, because a boost's job is to
 * mark a player out from the field, and a metric that rewards predicting the
 * mean cannot see that.
 */
export function shapeBoost(value, { spread = 1, mean = 0, deadband = 1, min = -5, max = 5 }) {
  if (!Number.isFinite(value)) return 0;
  // The deadband is applied to the RAW prediction, the spread only to what
  // survives it. Applying them the other way round couples two things that need
  // to be tuned separately, and does so destructively: a deadband of 1.5 on an
  // already-widened value cannot produce a +1 at all — nothing lands between the
  // band edge and 1.5 — so the whole "+1, a legitimate high-level threat" tier
  // silently disappeared from a set that should have had about thirty of them.
  if (Math.abs(value) < deadband) return 0;
  const widened = mean + (value - mean) * spread;
  return Math.min(Math.max(Math.round(widened), min), max);
}

/**
 * Def Boost from dunksandthrees' DEF EPM, rounded.
 *
 * This is the user's own recorded proposal (memory/speed_power_methodology.md,
 * "defBoost idea") and it is followed literally rather than refitted, unlike the
 * shooting layer. Rounding is half-AWAY-from-zero so the rule is symmetric: the
 * note asks for -0.5 to become -1, and JavaScript's Math.round(-0.5) is -0,
 * which would quietly make every borderline defender a neutral one.
 */
export function defBoostFromEpm(defEpm) {
  if (!Number.isFinite(defEpm)) return 0;
  // `|| 0` collapses negative zero, which Math.sign(-0.2) * 0 produces. It
  // serialises to JSON as 0 and so would survive a round trip unnoticed, but any
  // formatter reaching for `value < 0` to decide a sign gets the wrong answer
  // from it — a card reading "+0" for a defender the model actually rated at
  // nothing is a small wrong that is very hard to see.
  return Math.sign(defEpm) * Math.round(Math.abs(defEpm)) || 0;
}

/**
 * Shot Line: the baseline chance of converting, before location modifiers.
 *
 * Fitted, not asserted. memory/shooting_attributes_methodology.md is explicit
 * that Shot Line is deliberately NOT TS% or FG% — those are descriptive, this is
 * a game dial tuned to produce the right amount of scoring once modifiers and
 * matchups apply — and that it is compressed into a narrow playable band. So the
 * model regresses the real 283 Shot Lines on shooting efficiency and scoring
 * volume, and the output is clamped back into the band the real set occupies.
 *
 * Lower is easier. The clamp bounds are the real set's own min and max.
 */
export const SHOT_LINE_MIN = 12;
export const SHOT_LINE_MAX = 18;

export function shotLineFromScore(score) {
  return Math.min(Math.max(Math.round(score), SHOT_LINE_MIN), SHOT_LINE_MAX);
}

/**
 * The salary model.
 *
 * Deliberately a function of the CARD, not of the player's stats: salary exists
 * to price what the card can do at the table (design philosophy point 8 — salary
 * is what turns the statistical model into roster construction), and the card is
 * the complete statement of that. Fitting it against the 283 finished cards'
 * own attributes reproduces them to an r-squared of about 0.98, which says the
 * original salaries were themselves close to a linear function of the card.
 *
 * Rounded to a round ten, matching the real set, where every salary is a
 * multiple of ten.
 */
export const SALARY_STEP = 10;
export const SALARY_MIN = 10;
export const SALARY_MAX = 1500;

export function roundSalary(value) {
  if (!Number.isFinite(value)) return SALARY_MIN;
  const stepped = Math.round(value / SALARY_STEP) * SALARY_STEP;
  return Math.min(Math.max(stepped, SALARY_MIN), SALARY_MAX);
}

/** The predictor vector the salary model is fitted and applied on. */
export function salaryFeatures(card, chartEv) {
  return [
    (card.speed ?? 0) + (card.power ?? 0),
    chartEv.pts ?? 0,
    chartEv.reb ?? 0,
    chartEv.ast ?? 0,
    card.defBoost ?? 0,
    card.threePtBoost ?? 0,
    card.paintBoost ?? 0,
    SHOT_LINE_MAX - (card.shotLine ?? SHOT_LINE_MAX),
  ];
}
