// Everything on a card that is NOT the scoring chart and NOT the shooting
// layer: the Speed/Power split, Def Boost, Salary, and the small shared numeric
// helpers the rest of scripts/cardgen/ builds on.
//
// The shooting layer — Shot Line, Paint Boost, 3PT Boost — moved to
// scripts/cardgen/shooting.js when it stopped being a regression against the
// finished cards and became a stated rule applied to real shooting percentages.
// That file carries its own provenance, including why its d20 arithmetic reads
// `total >= line` rather than the rulebook's "beat".
//
// PROVENANCE OF WHAT IS LEFT.
//
// memory/speed_power_methodology.md preserved its derivation, so the Speed/Power
// split below FOLLOWS it: a combined budget (produced by
// scripts/cardgen/speedPower.js) divided by positional tendency. The position
// ratios are not invented — they are measured off the 283 finished cards, joined
// to those players' real primary positions.
//
// Salary is a refit against those same finished cards, and says so.

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
 * point of total, i.e. under a tenth of a Speed point across the whole printed
 * 6-30 range. A pure positional average is what the methodology describes and the
 * data gives no reason to add a term.
 */
export const POSITION_SPEED_SHARE = {
  PG: 0.6269,
  SG: 0.594,
  SF: 0.4921,
  PF: 0.4398,
  C: 0.3701,
};

/** The five, in order, so a blend and a share vector can agree on what index 0 is. */
export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

/** Neither guard nor big — used only when a position is missing or unrecognised. */
export const DEFAULT_SPEED_SHARE = 0.5;

/**
 * The average SIZE of each position in the finished set, in inches and pounds.
 *
 * Measured on the same join POSITION_SPEED_SHARE is measured on — the 283
 * non-legend cards against Basketball-Reference's 2024-25 per-game positions —
 * with height and weight from card-data/generated/player-biometrics.json (281
 * of 283 matched; Dennis Schroeder and Ron Holland are absent from the API's
 * name spellings). Re-derive with `node scripts/cardgen/calibrateAttributes.js`.
 *
 * These are CENTRES, not inputs: the size term below is a deviation from them,
 * so a player of exactly his position's average build gets exactly his
 * position's average share and the set-level distribution is untouched. That
 * matters because the shipped 306-card set, the four other sets and the
 * REFERENCE_TOTALS scale are all priced against the current level.
 */
export const POSITION_SIZE = {
  PG: { inches: 75.15, weight: 195.7 },
  SG: { inches: 76.69, weight: 202.6 },
  SF: { inches: 78.76, weight: 215.5 },
  PF: { inches: 80.36, weight: 227.9 },
  C: { inches: 82.91, weight: 250.2 },
};

/**
 * How far a player's SIZE bends his Speed share away from his position's.
 *
 * memory/speed_power_methodology.md states the split rule as "guards skew
 * Speed, bigger players skew Power" — a claim about size, for which the position
 * label was only ever a proxy. This is the term that reads the size directly.
 *
 * MEASURED, like everything else here: ordinary least squares of each finished
 * card's speed share against height and weight, both taken as deviations from
 * that card's POSITION average, so the fit describes only what size says BEYOND
 * the label. Both coefficients come out negative — taller is more Power, heavier
 * is more Power — which is the direction the methodology asserts.
 *
 * ── WHAT THIS IS AND IS NOT JUSTIFIED BY ────────────────────────────────────
 *
 * It is NOT justified by reproducing the finished cards better. It does not.
 * Across the whole finished set the size term is a wash (RMSE against the
 * printed Speed value 0.977 -> 0.967 points), and on a held-out half of the set
 * it is WORSE than position alone (1.028 -> 1.035). The person who made those
 * cards split by position, and asking size to predict his choices is asking it
 * to predict something it did not drive. That is stated plainly rather than
 * buried, because the rest of this file's constants ARE refits and this one is
 * not.
 *
 * What it IS justified by is resolution — design philosophy point 3, player
 * identity. The matchup matrix found 124 distinct mechanical identities across
 * 350 cards, with fourteen cards sharing a single one; the split is the only
 * lever that separates same-budget players, and position gives just five values
 * to separate them with. Size gives a continuum, and it is a REAL physical fact
 * about the player rather than an invented tiebreak. On the 2026-27 pool it
 * takes the set from 124 identities to 142 and moves 84 of the 350 splits, at a
 * measured cost of about a fifth of a point per team per game.
 *
 * The magnitude is the fitted one and is not amplified. At this strength Luka
 * Dončić — a 6'8", 230lb point guard — goes from 18/10 to 16/12, Rudy Gobert
 * from 8/13 to 7/14, and a guard of average build does not move at all.
 */
export const SIZE_SPEED_SHARE = { inches: -0.004393, weight: -0.000754 };

/**
 * The share is kept well inside 0 and 1 so no card can be all of one thing.
 *
 * Slack rather than a working limit: the widest share the finished set ever
 * printed is 0.727 and the size term's full range on the 2026-27 pool is 0.31 to
 * 0.66, so nothing reaches these. They exist so that a future set with an
 * outlier build — or a corrupt biometric row — degrades to a lopsided card
 * instead of a card with 0 Power.
 */
export const SPEED_SHARE_BOUNDS = { min: 0.15, max: 0.85 };

/**
 * How much of each position a player actually is, as five weights summing to 1.
 *
 * `positionShares` is Basketball-Reference's own measurement — the share of his
 * minutes he spent at each spot, off the play-by-play page, via
 * scripts/cardgen/positionShares.js. When it is present the player IS that
 * blend. When it is missing he is one-hot on his label, which is exactly the
 * rule this file has always applied, so a source without shares (the WNBA, a
 * player the table does not carry) is unchanged rather than dropped.
 *
 * Re-normalized here even though positionShares.js normalizes on the way in:
 * this is the function every split runs through, and a caller passing raw
 * percentages — or a vector that has drifted — should get a correct blend
 * rather than a silently scaled one.
 */
export function positionWeights(pos, positionShares = null) {
  if (positionShares) {
    const raw = POSITIONS.map(p => {
      const v = positionShares[p];
      return Number.isFinite(v) && v > 0 ? v : 0;
    });
    const total = raw.reduce((a, b) => a + b, 0);
    if (total > 0) return Object.fromEntries(POSITIONS.map((p, i) => [p, raw[i] / total]));
  }
  const base = basePosition(pos);
  if (!base) return null;
  return Object.fromEntries(POSITIONS.map(p => [p, p === base ? 1 : 0]));
}

/**
 * The share of a budget that goes to Speed, from positional MIX and size.
 *
 * `size` is `{ inches, weight }` or null; `options.positionShares` is the five
 * weights or null. With neither, this is exactly the rule the file shipped
 * with — the positional average of the single label — which is what lets the
 * WNBA set, where neither biometrics nor position estimates exist, keep running
 * unchanged.
 *
 * ── WHY THE SIZE BASELINE IS BLENDED TOO, AND WHY THAT IS THE POINT ─────────
 *
 * The size term is a deviation from `POSITION_SIZE` — the average BUILD of a
 * position — because a player of average build for his position should land
 * exactly on his position's average share and leave the set-level distribution
 * where the finished cards put it. Stating that baseline used to require
 * committing to one position, which is a fudge for everyone who is two of them:
 * Draymond Green measured against a power forward's 80" and 228lb is a
 * different player from Draymond Green measured against a centre's 83" and
 * 250lb, and the label picked one arbitrarily.
 *
 * With shares, BOTH the centre and the baseline are the same weighted blend, so
 * the deviation is taken against the build of his own positional mix. That
 * removes an arbitrary choice rather than adding a parameter — there is no new
 * coefficient here, only a better-posed origin for the two that already exist.
 */
export function speedShare(
  pos,
  size = null,
  {
    shares = POSITION_SPEED_SHARE,
    positionSize = POSITION_SIZE,
    sizeModel = SIZE_SPEED_SHARE,
    positionShares = null,
  } = {}
) {
  const weights = positionWeights(pos, positionShares);
  if (!weights) return DEFAULT_SPEED_SHARE;
  const centre = POSITIONS.reduce(
    (sum, p) => sum + weights[p] * (shares[p] ?? DEFAULT_SPEED_SHARE),
    0
  );
  const clamp = v => Math.min(Math.max(v, SPEED_SHARE_BOUNDS.min), SPEED_SHARE_BOUNDS.max);
  if (!positionSize || !sizeModel) return clamp(centre);
  if (!Number.isFinite(size?.inches) || !Number.isFinite(size?.weight)) return clamp(centre);
  let baseInches = 0;
  let baseWeight = 0;
  for (const p of POSITIONS) {
    if (weights[p] <= 0) continue;
    // A position carrying weight but no measured build makes the baseline a
    // partial sum, which would read as an enormous deviation. Falling back to
    // the un-sized centre is the only honest answer.
    if (!positionSize[p]) return clamp(centre);
    baseInches += weights[p] * positionSize[p].inches;
    baseWeight += weights[p] * positionSize[p].weight;
  }
  return clamp(
    centre +
      (sizeModel.inches ?? 0) * (size.inches - baseInches) +
      (sizeModel.weight ?? 0) * (size.weight - baseWeight)
  );
}

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
 * exactly the budget — the conservation rule in step 4 of the methodology, and
 * the reason the size term below cannot change a card's matchup STANDING. The
 * matchup matrix proved that a card's two-way Net Edge equals its Speed+Power
 * total minus the field mean exactly, so redistributing between the two changes
 * WHO a card beats and never how much it wins overall.
 *
 * Both sides are kept at 1 or above: a 0 on a card reads as missing data.
 *
 * `options.size` is `{ inches, weight }` and `options.positionShares` is the
 * five positional weights; omitting both gives the position-label-only split
 * this function has always produced.
 */
export function splitSpeedPower(total, pos, shares = POSITION_SPEED_SHARE, options = {}) {
  const t = Math.max(Math.round(total ?? 0), 2);
  const share = speedShare(pos, options.size ?? null, { shares, ...options });
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
 * NaN here becomes a blank stat on every card in the set, which is exactly the failure this
 * whole file exists to end.
 *
 * `intercept: false` drops the constant column, and the returned `coef` is then
 * the predictors alone. It exists for ONE fit: the positional centres against
 * five shares that sum to 1. Those five columns already span the constant, so an
 * intercept makes the design exactly singular and the fit would return null —
 * and the coefficients without it are the thing wanted anyway, each one the
 * Speed share of a player who was 100% that position. `applyModel` reads the
 * same flag, so a model and its application cannot disagree.
 */
export function fitLeastSquares(rows, yOf, xOf, { intercept = true } = {}) {
  const X = rows.map(r => (intercept ? [1, ...xOf.map(f => f(r))] : xOf.map(f => f(r))));
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
  const model = { coef, intercept, n: rows.length };
  const meanY = Y.reduce((a, c) => a + c, 0) / Y.length;
  let ssRes = 0;
  let ssTot = 0;
  rows.forEach((r, i) => {
    ssRes += (Y[i] - applyModel(model, xOf.map(f => f(r)))) ** 2;
    ssTot += (Y[i] - meanY) ** 2;
  });
  return { ...model, r2: ssTot > 1e-12 ? 1 - ssRes / ssTot : 0 };
}

/**
 * Applies a fitted model to a raw predictor vector.
 *
 * `model.intercept === false` means coef[0] is a real predictor rather than a
 * constant. Defaulting the missing flag to TRUE is what keeps every model
 * fitted before the flag existed — including the salary model already stored in
 * card-data/generated/card-calibration.json — reading exactly as it did.
 */
export const applyModel = (model, xs) => {
  const withIntercept = model.intercept !== false;
  return model.coef.reduce(
    (s, c, i) => s + c * (withIntercept ? (i === 0 ? 1 : (xs[i - 1] ?? 0)) : (xs[i] ?? 0)),
    0
  );
};

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
 * The worst Shot Line the finished set ever printed.
 *
 * Kept only as the reference point salaryFeatures prices a line against —
 * `SHOT_LINE_MAX - shotLine` is "how much easier than the worst card in the set"
 * — so a better line always raises the salary. The range the generator actually
 * clamps to is measured off the finished cards at calibration time and lives in
 * card-data/generated/card-calibration.json.
 */
export const SHOT_LINE_MAX = 18;

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
