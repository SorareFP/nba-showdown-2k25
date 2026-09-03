// Shot Line, Paint Boost and 3PT Boost, from real shooting percentages.
//
// THE RULE, in the user's words: a player's Shot Line is the roll at which he
// misses at his real TS% miss rate. Everything in this file is that sentence
// made arithmetic, plus the two things it needs to survive contact with real
// data — a league-relative compression, and a volume gate.
//
// WHY THIS REPLACED A REGRESSION. The previous version fitted Shot Line and both
// boosts against the 283 finished cards by least squares. That was the honest
// move while the rule was unknown; it is the wrong move now that a rule exists.
// A regression can only ever reproduce the old set's own quirks, and it cannot
// say what a player DID — it says what a card of his sort tended to look like.
//
// --- THE D20 ARITHMETIC, AND THE ONE PLACE IT IS EASY TO GET WRONG ----------
//
// src/game/engine.js resolves a shot check as `total >= player.shotLine`.
// GREATER-OR-EQUAL. So a Shot Line of 15 hits on 15..20 — eleven faces miss, six
// hit:
//
//     miss_rate    = (line - 1) / 20
//     success_rate = (21 - line) / 20
//     line         = round(miss_rate * 20) + 1
//
// The RULEBOOK (src/components/RulebookTab.jsx) says a player must "beat" his
// Shot Line, which is strictly-greater and would make every line one roll
// harder — a flat 5 percentage points off every shot check in the game. The code
// is what actually runs, so the code wins here. Two consequences worth knowing:
//
//   - attributes.js's older `successProbability` / `impliedLine` pair encodes the
//     rulebook's convention, not the engine's, and so sits one line away from
//     these. They are kept only for the salary feature vector.
//   - memory/shooting_attributes_methodology.md's verified anchor table (Curry
//     45% from three -> effective line 11) was read under the rulebook
//     convention. Under the engine's, 45% is an effective 12. The table's real
//     finding — that a boost is sized to hit a target percentage rather than
//     assigned by rank — is unaffected, and that finding is what this file
//     implements.
//
// --- WHY THE RAW LINES CANNOT SHIP AS THEY ARE ------------------------------
//
// Real TS% runs 45-78%, so raw Shot Lines come out between 5 and 12: a median
// player would convert 60% of his shot checks, against 30% on the finished
// cards. That roughly doubles league scoring and undoes the whole balance pass
// in docs/plans/2026-03-31-scoring-balance-design.md. TS% is therefore used as
// the ORDERING signal and the finished set supplies the SCALE — the same
// magnitude-preserving affine map the Speed/Power budget already uses:
//
//     compressed = target.mean + (raw - pool.mean) * (target.sd / pool.sd)
//
// Affine, so relative spacing survives exactly: if one player's raw line is
// twice as far above the pool mean as another's, it still is afterwards.
//
// --- THE PAINT BOOST USES THE SAME SCALE FACTOR -----------------------------
//
// `paintBoost = shotLine - rim_line` is a distance in LINE UNITS, and the game
// spends it in line units — a +2 lowers the line by 2, which is 10% on a d20. So
// that boost has to be measured on the same compressed scale as the line itself,
// or a +2 stops meaning 10%. Hence one scale factor, derived from the Shot Line.
//
// The boosts are re-centred on zero rather than on the pool mean of the raw
// signal. The Paint gap has a large systematic offset — everybody finishes
// better at the rim than at their overall TS% (mean raw gap about +1.2) — and
// shipping it would hand every player in the league the same +1, which is not a
// modifier, it is a rule change. Centred, a boost says what it is supposed to
// say: better or worse THAN THE LEAGUE at that spot.
//
// --- THE 3PT BOOST IS NOT A DISTANCE FROM THE SHOT LINE ---------------------
//
// It used to be — `threeGap = shotLine - three_line`, the mirror of Paint — and
// that was WRONG, for a reason that is easy to miss: TS% ALREADY CONTAINS THE
// THREES. A specialist's own three-point shooting inflates the TS% his Shot Line
// is built from, which raises the bar his three-point line is then measured
// against, and the boost cancels itself. It came out inverted on real data:
//
//     Herbert Jones   30.9% from three   +2
//     Klay Thompson   38.3%              +1
//     Duncan Robinson 41.0%               0
//     Stephen Curry   39.3%              -1
//
// Against the finished 283-card set that rule correlates with the real 3PT
// Boosts at only r = 0.23. Two replacements were measured on the same cards:
//
//     baseline = the player's own 2P line   r = 0.42
//     baseline = the LEAGUE's three line    r = 0.43
//
// 2P% is the obvious candidate and it does fix the self-cancelling, but it swaps
// one confound for another: it rewards being BAD AT TWOS. On the 2025-26 pool it
// puts Herbert Jones (30.9% from three, 47.0% on twos) at +1 and Stephen Curry
// (39.3% from three, 58.4% on twos) at 0, because Curry is also an excellent
// two-point scorer and Jones is not. Stripping the rim out as well was the other
// idea, and the user ruled it out for the right reason: what is left is
// mid-range plus free throws, and the game has no mid-range check.
//
// So the baseline is the LEAGUE, and the 3PT Boost measures ABSOLUTE
// three-point ability: how many rolls better than a league-average shooter this
// player is, applied on top of whatever Shot Line he earned. That is also what
// memory/shooting_attributes_methodology.md says the finished set was doing —
// "the boost is sized to hit a target probability, not assigned by rank" — and
// a target probability is an absolute claim about the player, not a claim
// relative to the rest of his own game.
//
// It follows that the 3PT Boost is no longer a distance in Shot Line units, so
// the argument for sharing the Shot Line's scale factor no longer applies to it.
// It carries its own, fitted the same way the Shot Line's is: the finished set
// supplies the SPREAD (the standard deviation of its own 3PT Boosts, 1.51) and
// the pool's spread of three-point ability supplies the ORDERING. That is also
// what fixes the tail — under the old rule the +3/+4/+5 band held about 1% of
// the pool against 11% of the finished set.
//
// The Paint Boost has the same defect in principle (rim shots are inside TS%
// too) and measurably: it correlates with the finished set's real Paint Boosts
// at r = 0.13 against r = 0.31 for an absolute 2P baseline. It is left alone
// here because it was not in scope, because it is much less broken in practice
// (90% of real Paint Boosts are 0 and the produced histogram already matches to
// a distance of 0.08), and because changing both at once would have made
// neither change measurable. It is a real follow-up, not an oversight.
//
// --- THE VOLUME GATE --------------------------------------------------------
//
// memory/shooting_attributes_methodology.md: "A player shooting 42-43% on
// relatively low volume might still get 0 — volume gates the modifier." It has
// to. Thirty-one players in the 350-pool attempt under one three per 75
// possessions, and their raw 3P% includes a 0-for-9 (0%), a 1-for-1 (100%) and a
// 2-for-8. Ungated, those produce raw boosts from -16 to +6 — the widest values
// in the set handed to the players with the least evidence behind them.
//
// The gate is empirical-Bayes shrinkage toward the league mean, `fitShrinkage`
// below, and its strength is MEASURED rather than chosen: see that function.

import { meanSd } from './attributes.js';

// ── THE SHOT LINE'S BASIS, AND WHY IT IS NOT TS% ───────────────────────────
//
// TS% measures SHOT SELECTION, not shooting skill, and for a big man those are
// opposite things: a rim-runner posts elite efficiency precisely by never
// attempting a hard shot. Built on TS%, the Shot Line rewarded him for the
// shots he declined to take. The 2026-27 set made the failure unarguable —
// Jarrett Allen printed a .671 TS%, higher than Jokić (.648) and Curry (.622),
// on a .690 free-throw percentage and a .206 three; Jericho Sims printed Shot
// Line 12 with a 3PT Boost of -8 while Stephen Curry printed 14; and bigs
// averaged 14.76 against guards' 15.64, a full point of advantage handed to
// the players who cannot shoot.
//
// SHOT LINE now reads only the shots that require shooting — midrange, threes,
// free throws — and rim attempts are excluded entirely. Raw make rates are NOT
// comparable across those types (a .394 three is elite, a .690 free throw is
// poor), so each is z-scored against the pool's own distribution for that shot
// type FIRST, then volume-weighted by the player's attempts in each. Skipping
// the per-type normalisation leaves Allen ahead of Curry on a plain weighted
// average, because free throws are made far more often than field goals and he
// takes a great many of them.
//
// PAINT BOOST takes what Shot Line gave up. It was rim FG% alone, whose league
// spread is narrow enough that the compression flattened 295 of 354 cards to
// exactly 0 — the attribute did no work. It is now rim POINTS ADDED, volume
// times efficiency over the league rate, so a high-volume elite finisher
// separates from a center who dunks four times a game.
//
// Both are re-expressed on the pool's own TS% location and scale before they
// leave here, so every downstream stage — the linear map, the compression, the
// calibration targets — keeps working against numbers in the range it expects.
// The ORDERING changes; the arithmetic around it does not.

// Attempt volumes reach this module BOTH ways: dunksandthrees' actual season
// page reports per 75 possessions, its EPM archive per 100. Only relative
// weight matters here, so either is read as-is rather than converted — but
// both names must be tried, because reading one when the caller supplies the
// other yields null for every row and the whole basis silently falls back to
// TS%, which is exactly the no-op this comment exists to prevent recurring.
const attOf = (per75, per100) => r => {
  const a = r?.[per75];
  if (Number.isFinite(a)) return a;
  const b = r?.[per100];
  return Number.isFinite(b) ? b : null;
};
const midAttDirect = attOf('fgaMidPer75', 'fgaMidPer100');
const threeAtt = attOf('fga3Per75', 'fga3Per100');
const ftAtt = attOf('ftaPer75', 'ftaPer100');
const rimAttDirect = attOf('fgaRimPer75', 'fgaRimPer100');

// The historical sets carry Basketball-Reference's shape instead — total
// two-point attempts, the SHARE of them at the rim, and the two percentages —
// so rim and midrange are derived rather than read. Same quantities, so the
// basis is identical across sets; without this the special sets would keep
// TS%-derived Shot Lines and become the place to farm an unearned line on a
// centre who cannot shoot.
const rimAtt = r => {
  const direct = rimAttDirect(r);
  if (Number.isFinite(direct)) return direct;
  const two = r?.fg2a100;
  const share = r?.rimShare;
  return Number.isFinite(two) && Number.isFinite(share) ? two * share : null;
};
const midAtt = r => {
  const direct = midAttDirect(r);
  if (Number.isFinite(direct)) return direct;
  const two = r?.fg2a100;
  const share = r?.rimShare;
  return Number.isFinite(two) && Number.isFinite(share) ? two * (1 - share) : null;
};
/** Midrange FG%, backed out of overall 2P% once the rim is removed. */
const midPct = r => {
  if (Number.isFinite(r?.fgPctMid)) return r.fgPctMid;
  const two = r?.fg2a100;
  const share = r?.rimShare;
  const rimP = r?.rimPct;
  const twoP = r?.fgPct2;
  if (![two, share, rimP, twoP].every(Number.isFinite)) return null;
  const midA = two * (1 - share);
  if (midA <= 0.01) return null;
  const made = twoP * two - rimP * (two * share);
  const pct = made / midA;
  return pct >= 0 && pct <= 1 ? pct : null;
};
/** Rim FG% under either shape. */
const rimPctOf = r =>
  Number.isFinite(r?.fgPctRim) ? r.fgPctRim : Number.isFinite(r?.rimPct) ? r.rimPct : null;

/** Volume-weighted mean of `pick` over rows that have it, weighted by `wt`. */
function weightedMean(rows, pick, wt) {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const v = pick(r);
    const w = wt(r);
    if (!Number.isFinite(v) || !Number.isFinite(w) || w <= 0) continue;
    num += v * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

/**
 * The per-shot-type league distributions this pool implies. Each percentage is
 * weighted by that type's attempts, so a center's nine-attempt three-point
 * season cannot drag the three-point mean around.
 */
function shotTypeNorms(rows) {
  const types = [
    ['mid', midPct, midAtt],
    ['three', r => r.fgPct3, threeAtt],
    ['ft', r => r.ftPct, ftAtt],
  ];
  const out = {};
  for (const [key, pct, att] of types) {
    const mean = weightedMean(rows, pct, att);
    const vals = rows.map(pct).filter(Number.isFinite);
    const { sd } = meanSd(vals);
    out[key] = { mean: mean ?? 0, sd: sd > 1e-6 ? sd : 1 };
  }
  const rimVals = rows.map(rimPctOf).filter(Number.isFinite);
  out.rim = {
    mean: weightedMean(rows, rimPctOf, rimAtt) ?? 0,
    sd: meanSd(rimVals).sd || 1,
  };
  return out;
}

/**
 * Re-express `values` on the location and scale of `anchor`, so a new basis
 * can be swapped in under machinery calibrated against the old one.
 */
function onScaleOf(values, anchor) {
  const v = meanSd(values.filter(Number.isFinite));
  const a = meanSd(anchor.filter(Number.isFinite));
  const sd = v.sd > 1e-6 ? v.sd : 1;
  return values.map(x =>
    Number.isFinite(x) ? a.mean + ((x - v.mean) / sd) * (a.sd || 0.03) : null
  );
}

/**
 * Shot Line and Paint Boost bases for a pool, from full shot-location rows.
 *
 * `rows` need `{ tsPct, fgPctMid, fgaMidPer100, fgPct3, fga3Per100, ftPct,
 * ftaPer100, fgPctRim, fgaRimPer100 }`. Returns `{ shootingPct, rimPct }`
 * arrays aligned to `rows` — drop-in replacements for `tsPct` and `paintPct`.
 * A row missing the location splits (a historical season, a WNBA page) yields
 * null and the caller falls back to its own TS%.
 */
export function deriveShootingBasis(rows) {
  const norms = shotTypeNorms(rows);
  const z = (v, n) => (Number.isFinite(v) ? (v - n.mean) / n.sd : null);

  const rawShooting = rows.map(r => {
    const parts = [
      [z(midPct(r), norms.mid), midAtt(r)],
      [z(r.fgPct3, norms.three), threeAtt(r)],
      [z(r.ftPct, norms.ft), ftAtt(r)],
    ].filter(([s, w]) => Number.isFinite(s) && Number.isFinite(w) && w > 0);
    if (!parts.length) return null;
    const den = parts.reduce((s, [, w]) => s + w, 0);
    return parts.reduce((s, [zz, w]) => s + zz * w, 0) / den;
  });

  // Points added at the rim per 100 possessions, against the league rate.
  const rawRim = rows.map(r => {
    const att = rimAtt(r);
    const pct = rimPctOf(r);
    return Number.isFinite(pct) && Number.isFinite(att)
      ? att * (pct - norms.rim.mean) * 2
      : null;
  });

  const anchor = rows.map(r => r.tsPct).filter(Number.isFinite);
  return {
    shootingPct: onScaleOf(rawShooting, anchor),
    rimPct: onScaleOf(rawRim, anchor),
  };
}

/** A line is a d20 face, so 1 always hits and 21 never does. */
export const LINE_FLOOR = 1;
export const LINE_CEIL = 21;

/** Share of the twenty faces that miss / hit, under the engine's `total >= line`. */
export const missRateForLine = line => (line - 1) / 20;
export const successRateForLine = line => (21 - line) / 20;

/**
 * The line a conversion rate implies, BEFORE it is rounded onto a die face.
 *
 * `21 - 20 * pct`, which is `(1 - pct) * 20 + 1` rearranged. Everything internal
 * works in this continuous form and rounds ONCE, at the end. Rounding earlier is
 * what a first pass did, and it cost most of the resolution the rule has: both
 * lines land on integers, so their difference lands on integers too, and a
 * boost derived from that difference could only take four or five distinct
 * values across the whole league — the compression then had nothing to spread.
 */
export const continuousLine = pct =>
  Number.isFinite(pct) ? 21 - 20 * Math.min(Math.max(pct, 0), 1) : null;

/** The roll at which a player converting `pct` of the time starts hitting. */
export function lineForSuccessRate(pct) {
  const line = continuousLine(pct);
  if (line == null) return null;
  return Math.min(Math.max(Math.round(line), LINE_FLOOR), LINE_CEIL);
}

/**
 * Attempts behind a possession-normalized rate.
 *
 * Neither source reports raw attempt counts — dunksandthrees' actual page gives
 * shot volume per 75 possessions, Basketball-Reference's per-100 table per 100 —
 * and neither reports possessions, so possessions are reconstructed from total
 * minutes at a league pace. Only the SHRINKAGE WEIGHT reads this, and that
 * weight moves by under a percent for any plausible pace, so a single league
 * constant is enough: a per-player pace would be false precision on a number
 * used only to decide how much to trust a percentage.
 */
export const LEAGUE_PACE_PER_48 = 99;

export function possessionsFromMinutes(minutes, pace = LEAGUE_PACE_PER_48) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return (minutes / 48) * pace;
}

export function attemptsFromRate(rate, per, minutes, pace = LEAGUE_PACE_PER_48) {
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return (rate * possessionsFromMinutes(minutes, pace)) / per;
}

export const attemptsFromPer75 = (per75, minutes, pace) => attemptsFromRate(per75, 75, minutes, pace);
export const attemptsFromPer100 = (per100, minutes, pace) =>
  attemptsFromRate(per100, 100, minutes, pace);

/** How many attempts a percentage needs before it is trusted at all, at minimum. */
export const SHRINKAGE_QUALIFYING_ATTEMPTS = 50;

/**
 * The hardest three-point line a card can print, and how much wider the
 * three-point spread is than the Shot Line's.
 *
 * 20 means a natural 20, which is what a player who cannot shoot should need.
 * The Shot Line stops at 18 because it gates every shot; a three is one shot
 * type and the league is far more unequal at it.
 */
export const THREE_LINE_MAX = 20;
export const THREE_LINE_SPREAD = 1.9;

/** What a Shot Line of 12 against a three line of 20 implies, and its mirror. */
export const THREE_BOOST_MIN = -8;
export const THREE_BOOST_MAX = 5;

/**
 * Empirical-Bayes shrinkage of a shooting percentage toward the league mean.
 *
 *     adjusted = (made + mean * k) / (attempts + k)
 *
 * `k` is the number of imaginary league-average attempts every player is
 * credited with, and it is DERIVED, not chosen. A player's observed percentage
 * varies around his true one with binomial variance p(1-p)/n, so across the
 * league
 *
 *     var(observed) = var(true) + mean( p(1-p)/n )
 *
 * Solve that for var(true) using only players with enough attempts to measure
 * it, and the shrinkage weight that minimises squared error is n / (n + k) with
 * k = p(1-p) / var(true). Everything on the right is read off the pool, so the
 * gate re-derives itself for each stat and each season: 3P% comes out around
 * k = 250 attempts (a noisy skill, shrunk hard), rim FG% around k = 70 (a
 * stabler one, shrunk lightly), which is the correct ordering and nobody chose
 * it.
 */
export function fitShrinkage(samples) {
  const usable = samples.filter(s => Number.isFinite(s.pct) && Number.isFinite(s.n) && s.n > 0);
  const totalN = usable.reduce((a, s) => a + s.n, 0);
  const mean = totalN > 0 ? usable.reduce((a, s) => a + s.pct * s.n, 0) / totalN : 0;

  const qualified = usable.filter(s => s.n >= SHRINKAGE_QUALIFYING_ATTEMPTS);
  const observed = meanSd(qualified.map(s => s.pct));
  const sampling =
    qualified.length > 0
      ? qualified.reduce((a, s) => a + (s.pct * (1 - s.pct)) / s.n, 0) / qualified.length
      : 0;
  // A floor rather than a bare subtraction: if sampling noise explains the whole
  // observed spread there is no measurable true spread, and k must go to
  // infinity (shrink everybody to the mean) instead of negative (blow up).
  const trueVar = Math.max(observed.sd ** 2 - sampling, 1e-6);
  const k = (mean * (1 - mean)) / trueVar;

  // THE PRIOR IS A FUNCTION OF VOLUME, NOT A FLAT LEAGUE MEAN, and on three-point
  // shooting that is not a refinement — a flat mean is provably wrong. Measured
  // on the 2025-26 pool:
  //
  //     3PA per 100    n    mean 3P%
  //     0-1           47      .247
  //     1-3           43      .305
  //     3-6          127      .330
  //     6-10         271      .346
  //     10-15        107      .361
  //
  // against a league mean of .335. A player who takes under one three per
  // hundred possessions shoots .247, nine points below the mean he was being
  // shrunk toward. LOW VOLUME IS EVIDENCE, not an absence of it: coaches do not
  // let bad shooters shoot, so shooting rarely is itself a strong signal.
  //
  // The visible damage was Jakob Poeltl. His TS% is .644 -- the best of any name
  // in this comment, because he only takes dunks -- so he earned a Shot Line of
  // 12, and his 3P% of .329 on 0.4 attempts per 100 shrank to the league mean
  // and earned a 3PT Boost of 0. Effective three-point line 12, exactly Stephen
  // Curry's, while Donovan Mitchell sat at 15 and converted 15 points less
  // often.
  //
  // Fitted rather than assumed: a volume-weighted least squares of the rate on
  // log(1 + attempts), which is the shape the table above has.
  //
  // CONDITIONED ON THE RATE, NOT THE ATTEMPT COUNT. Those are different
  // questions and only one of them is about the player. A man who takes 0.3
  // threes per 100 across a full season and one who takes 9 per 100 in a
  // handful of games can arrive with the same ~10 attempts, and only the first
  // is a non-shooter. Fitting on the count treated Daniel Gafford -- .106 on
  // 0.3 per 100 -- as a .29 shooter and left him converting threes as often as
  // Donovan Mitchell.
  const priorFit = (() => {
    const pts = usable
      .filter(s => Number.isFinite(s.rate))
      .map(s => ({ x: Math.log1p(s.rate), y: s.pct, w: Math.min(s.n, 200) }));
    const sw = pts.reduce((a, q) => a + q.w, 0);
    if (!(sw > 0)) return null;
    const mx = pts.reduce((a, q) => a + q.w * q.x, 0) / sw;
    const my = pts.reduce((a, q) => a + q.w * q.y, 0) / sw;
    const vx = pts.reduce((a, q) => a + q.w * (q.x - mx) ** 2, 0) / sw;
    if (!(vx > 1e-9)) return null;
    const cov = pts.reduce((a, q) => a + q.w * (q.x - mx) * (q.y - my), 0) / sw;
    return { slope: cov / vx, intercept: my - (cov / vx) * mx };
  })();

  /** The rate a player of this VOLUME is expected to shoot, before his own data. */
  const priorAt = rate => {
    if (!priorFit || !Number.isFinite(rate) || rate < 0) return mean;
    const raw = priorFit.intercept + priorFit.slope * Math.log1p(rate);
    // Never outside what the league actually produces.
    return Math.min(Math.max(raw, 0.01), 0.99);
  };

  return {
    mean,
    k,
    trueSd: Math.sqrt(trueVar),
    observedSd: observed.sd,
    qualified: qualified.length,
    priorFit,
    priorAt,
    apply(pct, n, rate) {
      const prior = priorAt(rate);
      if (!Number.isFinite(n) || n <= 0) return prior;
      const p = Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 1) : mean;
      return (p * n + prior * k) / (n + k);
    },
  };
}

/**
 * The affine map from a pool's raw values onto a target distribution.
 *
 * `scale` is the only thing a boost needs; `apply` is what the Shot Line needs.
 * A degenerate pool (every player identical) maps to the target mean rather than
 * dividing by zero.
 */
export function fitLinearMap(rawValues, target) {
  const pool = meanSd(rawValues);
  const scale = pool.sd > 1e-9 ? target.sd / pool.sd : 0;
  return {
    poolMean: pool.mean,
    poolSd: pool.sd,
    scale,
    target,
    apply: raw =>
      Number.isFinite(raw) ? target.mean + (raw - pool.mean) * scale : target.mean,
  };
}

/** Compressed Shot Line: the affine map, rounded, held inside the real set's range. */
export function compressShotLine(raw, map) {
  const v = Math.round(map.apply(raw));
  return Math.min(Math.max(v, map.target.min), map.target.max);
}


/**
 * The 3PT Boost that puts a card's effective three-point line where its 3P%
 * says it belongs.
 *
 * `shotLine` is already compressed; `threeLine` is raw, so it goes through the
 * same affine map before the two can be subtracted. Clamped to the range the
 * finished set actually prints.
 */
export function threePtBoostFor(shotLine, threeLine, shape) {
  if (!Number.isFinite(shotLine) || !Number.isFinite(threeLine)) return 0;
  const target = compressShotLine(threeLine, shape.lineMap ?? shape);
  const boost = shotLine - target;
  if (!Number.isFinite(boost)) return 0;
  // Clamped to what the two line ranges can actually produce, not to the
  // finished set's old +/-5: a 12 Shot Line against a 20 three line is -8.
  return Math.min(Math.max(Math.round(boost), THREE_BOOST_MIN), THREE_BOOST_MAX);
}

/**
 * A boost, from a raw line gap: same scale as the Shot Line, re-centred on zero.
 *
 * `deadband` is how close to zero the compressed gap has to be before the card
 * carries no modifier at all. It is a DESIGN rule, not a statistical one — the
 * finished set leaves 90% of Paint Boosts and 64% of 3PT Boosts at exactly zero
 * because a modifier is meant to mark a player out, and rounding a continuous
 * prediction would hand nearly everybody a +/-1 and erase that. It is fitted
 * against those real zero shares in calibrateAttributes.js.
 */
export function compressBoost(rawGap, { scale, poolMean, deadband = 0, min = -5, max = 5 }) {
  if (!Number.isFinite(rawGap)) return 0;
  const centred = (rawGap - poolMean) * scale;
  if (Math.abs(centred) < deadband) return 0;
  return Math.min(Math.max(Math.round(centred), min), max);
}

/**
 * Every raw line for one player, before any compression.
 *
 * Returned as a group because they are only meaningful together: a boost is the
 * distance from the Shot Line to a location line, so reporting one without the
 * others invites reading a location line as if it were a Shot Line.
 *
 * The `shotLine` / `paintLine` / `threeLine` / `paintGap` / `threeGap` fields
 * are the ROUNDED, printable form — the arithmetic as a person would do it on
 * paper, and what the raw-versus-compressed comparison reports. The `exact`
 * fields alongside them are the same quantities unrounded, and those are what
 * the compression consumes.
 */
export function rawLines({ tsPct, paintPct, threePct }) {
  const shotLine = lineForSuccessRate(tsPct);
  const paintLine = lineForSuccessRate(paintPct);
  const threeLine = lineForSuccessRate(threePct);
  const ts = continuousLine(tsPct);
  const paint = continuousLine(paintPct);
  const three = continuousLine(threePct);
  return {
    shotLine,
    paintLine,
    threeLine,
    paintGap: shotLine != null && paintLine != null ? shotLine - paintLine : null,
    threeGap: shotLine != null && threeLine != null ? shotLine - threeLine : null,
    exactShotLine: ts,
    exactPaintGap: ts != null && paint != null ? ts - paint : null,
    exactThreeGap: ts != null && three != null ? ts - three : null,
    // What the 3PT Boost is actually built from: the player's OWN three-point
    // line, negated so a better shooter scores higher, and compared against the
    // pool rather than against his own Shot Line. See the header — comparing it
    // to a TS%-derived line lets his threes cancel their own boost.
    exactThreeStrength: three == null ? null : -three,
  };
}

/**
 * The whole shooting layer for one pool, in one pass.
 *
 * Shared by calibration and generation so the two cannot drift — the rule is
 * defined once and each caller supplies its own pool. Everything pool-relative
 * (the shrinkage strength, the compression scale, the centre of each boost) is
 * measured from THIS pool, which is what lets a fit against 2024-25
 * Basketball-Reference numbers be applied to 2025-26 dunksandthrees ones: a
 * provider's or a season's systematic offset cancels on both sides.
 *
 * TS% is deliberately NOT shrunk. Every player in a carded pool takes hundreds
 * of shots, so the shrinkage would move a Shot Line by a hundredth of a roll,
 * and the rule the user stated is about a player's real TS%. The location
 * percentages are a different matter: a center can finish a season with nine
 * three-point attempts, and that is the case the gate exists for.
 *
 * `players` need `{ tsPct, paintPct, threePct, paintAttempts, threeAttempts, threeRate }`.
 * `threeRate` is attempts per 100 possessions — the thing that says whether a
 * player is a shooter at all, which the attempt COUNT does not.
 */
export function buildShootingLayer(players, { shotLineTarget, paint = {}, three = {} }) {
  const shrink = {
    paint: fitShrinkage(players.map(p => ({ pct: p.paintPct, n: p.paintAttempts }))),
    three: fitShrinkage(
      players.map(p => ({ pct: p.threePct, n: p.threeAttempts, rate: p.threeRate }))
    ),
  };

  const raw = players.map(p =>
    rawLines({
      tsPct: p.tsPct,
      paintPct: shrink.paint.apply(p.paintPct, p.paintAttempts),
      threePct: shrink.three.apply(p.threePct, p.threeAttempts, p.threeRate),
    })
  );
  // The literal rule, ungated and uncompressed — reported so the compression can
  // be judged against what it started from rather than taken on trust.
  const literal = players.map(p =>
    rawLines({ tsPct: p.tsPct, paintPct: p.paintPct, threePct: p.threePct })
  );

  const map = fitLinearMap(raw.map(r => r.exactShotLine), shotLineTarget);
  // The three line gets its OWN map onto the SAME printed range. Its raw scale
  // is not the Shot Line's -- raw shot lines run about 5-12 off TS% and raw
  // three lines about 13-15 off 3P%, because 3P% is a much lower percentage --
  // so putting a three line through the Shot Line's map penalises the entire
  // league by five rolls. Same target, own spread: a three is made as hard as a
  // shot, and the ORDERING is three-point ability.
  // A WIDER RANGE THAN THE SHOT LINE, deliberately. Three-point ability varies
  // far more than overall shooting does -- the pool runs from Daniel Gafford at
  // .106 to Luke Kennard at .440 -- and squeezing that into the Shot Line's
  // 12-18 makes the worst shooter in the league only six rolls worse than the
  // best. Extending the top to 20 lets a non-shooter need a natural 20, which
  // is what he should need, at the cost of a boost that prints as -8 on his
  // card. The BOTTOM is unchanged: nobody makes a three more easily than the
  // best shot in the game.
  const threeLineTarget = {
    ...shotLineTarget,
    max: THREE_LINE_MAX,
    sd: shotLineTarget.sd * THREE_LINE_SPREAD,
  };
  const threeLineMap = fitLinearMap(
    raw.map(r => r.threeLine).filter(Number.isFinite),
    threeLineTarget
  );
  const threeStrength = meanSd(raw.map(r => r.exactThreeStrength));
  const poolMean = {
    paintGap: meanSd(raw.map(r => r.exactPaintGap)).mean,
    threeStrength: threeStrength.mean,
  };
  const paintShape = {
    scale: map.scale,
    poolMean: poolMean.paintGap,
    deadband: paint.deadband ?? 0,
    min: paint.min ?? -5,
    max: paint.max ?? 5,
  };
  const threeShape = {
    // NOT the Shot Line's scale: see the header. The 3PT Boost is no longer a
    // distance measured in Shot Line units, so it carries its own, fitted so the
    // pool's spread of three-point ability lands on the finished set's own
    // spread of 3PT Boosts. Falling back to the Shot Line's scale keeps an
    // uncalibrated caller working rather than dividing by an absent target.
    scale:
      Number.isFinite(three.targetSd) && threeStrength.sd > 1e-9
        ? three.targetSd / threeStrength.sd
        : map.scale,
    poolMean: poolMean.threeStrength,
    deadband: three.deadband ?? 0,
    min: three.min ?? -5,
    max: three.max ?? 5,
    // The three line's own map onto the printed range, so the two lines are
    // comparable before they are subtracted.
    lineMap: threeLineMap,
  };

  return {
    shrink,
    map,
    poolMean,
    threeStrengthSd: threeStrength.sd,
    paintShape,
    threeShape,
    players: players.map((p, i) => {
      const shotLine = compressShotLine(raw[i].exactShotLine, map);
      return {
        raw: raw[i],
        literal: literal[i],
        shotLine,
        paintBoost: compressBoost(raw[i].exactPaintGap, paintShape),
        // THE BOOST IS AN OFFSET TO AN ABSOLUTE LINE, not a skill score.
        //
        // It was `compressBoost(exactThreeStrength)` -- three-point ability
        // measured against the league and applied on top of whatever Shot Line
        // the player earned. The flaw is in that last clause. A Shot Line comes
        // from TS%, and TS% CONTAINS DUNKS: Jakob Poeltl shoots .644 because he
        // only takes shots at the rim, so he EARNED a Shot Line of 12 and, with
        // his 0.4 threes per 100 shrinking to a neutral boost, converted threes
        // exactly as often as Stephen Curry while Donovan Mitchell sat 15 points
        // worse.
        //
        // So the boost is now sized to land the EFFECTIVE line where the
        // player's three-point shooting says it belongs: `shotLine - boost`
        // equals the line his 3P% earns on its own. That is what
        // memory/shooting_attributes_methodology.md records the finished set as
        // doing -- "the boost is sized to hit a target probability".
        //
        // This is NOT the `threeGap` rule the header rejected. That one fed the
        // gap into compressBoost as a raw SIGNAL, which re-centred and rescaled
        // it and let a specialist's own threes inside TS% cancel his boost. Here
        // the gap is an OFFSET between two lines that are each already absolute.
        threePtBoost: threePtBoostFor(shotLine, raw[i].threeLine, threeShape),
      };
    }),
  };
}
