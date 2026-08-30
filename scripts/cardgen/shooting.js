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
// --- WHY A BOOST USES THE SAME SCALE FACTOR ---------------------------------
//
// `boost = shotLine - effective_line` is a distance in LINE UNITS, and the game
// spends it in line units — a +2 lowers the line by 2, which is 10% on a d20. So
// the boost has to be measured on the same compressed scale as the line itself,
// or a +2 stops meaning 10%. Hence one scale factor, derived from the Shot Line,
// applied to both boosts.
//
// The boosts are re-centred on zero rather than on the pool mean of the raw gap.
// That gap has a large systematic offset — everybody finishes better at the rim
// than their overall TS% (mean raw Paint gap about +1.2) and almost everybody
// shoots worse from three (mean raw 3PT gap about -4.5) — and shipping the
// offset would hand every player in the league the same +1 Paint and the same
// -5 from three, which is not a modifier, it is a rule change. Centred, a boost
// says what it is supposed to say: better or worse THAN THE LEAGUE at that spot,
// relative to your own baseline.
//
// --- THE VOLUME GATE --------------------------------------------------------
//
// memory/shooting_attributes_methodology.md: "A player shooting 42-43% on
// relatively low volume might still get 0 — volume gates the modifier." It has
// to. Thirty-one players in the 331-pool attempt under one three per 75
// possessions, and their raw 3P% includes a 0-for-9 (0%), a 1-for-1 (100%) and a
// 2-for-8. Ungated, those produce raw boosts from -16 to +6 — the widest values
// in the set handed to the players with the least evidence behind them.
//
// The gate is empirical-Bayes shrinkage toward the league mean, `fitShrinkage`
// below, and its strength is MEASURED rather than chosen: see that function.

import { meanSd } from './attributes.js';

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

  return {
    mean,
    k,
    trueSd: Math.sqrt(trueVar),
    observedSd: observed.sd,
    qualified: qualified.length,
    apply(pct, n) {
      if (!Number.isFinite(n) || n <= 0) return mean;
      const p = Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 1) : mean;
      return (p * n + mean * k) / (n + k);
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
 * `players` need `{ tsPct, paintPct, threePct, paintAttempts, threeAttempts }`.
 */
export function buildShootingLayer(players, { shotLineTarget, paint = {}, three = {} }) {
  const shrink = {
    paint: fitShrinkage(players.map(p => ({ pct: p.paintPct, n: p.paintAttempts }))),
    three: fitShrinkage(players.map(p => ({ pct: p.threePct, n: p.threeAttempts }))),
  };

  const raw = players.map(p =>
    rawLines({
      tsPct: p.tsPct,
      paintPct: shrink.paint.apply(p.paintPct, p.paintAttempts),
      threePct: shrink.three.apply(p.threePct, p.threeAttempts),
    })
  );
  // The literal rule, ungated and uncompressed — reported so the compression can
  // be judged against what it started from rather than taken on trust.
  const literal = players.map(p =>
    rawLines({ tsPct: p.tsPct, paintPct: p.paintPct, threePct: p.threePct })
  );

  const map = fitLinearMap(raw.map(r => r.exactShotLine), shotLineTarget);
  const poolMean = {
    paintGap: meanSd(raw.map(r => r.exactPaintGap)).mean,
    threeGap: meanSd(raw.map(r => r.exactThreeGap)).mean,
  };
  const shape = (gapMean, bounds) => ({
    scale: map.scale,
    poolMean: gapMean,
    deadband: bounds.deadband ?? 0,
    min: bounds.min ?? -5,
    max: bounds.max ?? 5,
  });
  const paintShape = shape(poolMean.paintGap, paint);
  const threeShape = shape(poolMean.threeGap, three);

  return {
    shrink,
    map,
    poolMean,
    paintShape,
    threeShape,
    players: players.map((p, i) => ({
      raw: raw[i],
      literal: literal[i],
      shotLine: compressShotLine(raw[i].exactShotLine, map),
      paintBoost: compressBoost(raw[i].exactPaintGap, paintShape),
      threePtBoost: compressBoost(raw[i].exactThreeGap, threeShape),
    })),
  };
}
