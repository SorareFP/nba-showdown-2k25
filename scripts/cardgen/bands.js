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

// Widened the LOWER three cuts (2026-09-03) to add zeros where players' own
// games say zeros belong. The old [0.10, 0.33, 0.50, 0.66, 0.90] left team
// scoring at ~128/game across common defensive buckets; the new
// [0.05, 0.20, 0.40, 0.66, 0.90] brought it to ~122, with 24.6% of d20 faces
// paying NOTHING — the empty-possession rate the user signed off on.
//
// Minutes-weighting the percentiles then shaved another ~8%, landing ~112.
// Narrowing the cuts to [0.08, 0.25, 0.45, 0.68, 0.91] recovered ~118 but cost
// the zero band, dropping empty possessions to 16.7% — trading away the exact
// thing the widening existed to buy. So the cuts stay wide and scoring sits
// at ~112, which is where the real league actually scores (about 113 a team
// in 2024-25). p66 and p90 are near-untouched, so a boom scorer's ceiling row
// still sits where his own data earns it.
const CUTS = [0.05, 0.20, 0.40, 0.66, 0.90];
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
// Kept for reference and for callers that round a single value; the BAND
// values themselves now round together via evRoundValues below (approved
// 2026-09-03 — the Dyson Daniels fix).
function toCardValue(raw) {
  return Math.round(roundDown(raw, 1));
}

/**
 * EV-PRESERVING band rounding — the Dyson Daniels fix. Rounding each band
 * value independently at ×4 granularity flattened role players into identical
 * 1p1r1a rows: a 3:1.3:1 wing and a true stat-stuffer printed the same line,
 * and production RATIOS (design pillar 3, player identity) vanished below
 * ~1.4 per four minutes. Instead the five values round TOGETHER: each may
 * take its floor or ceiling, the combination stays monotone, and the winner
 * is the one whose slot-weighted EV over the 25 chart slots lands closest to
 * the raw EV — which naturally concentrates a wing's assists in his top
 * tiers instead of smearing equal 1s (or 0s) across the chart. Ties break
 * toward the smallest total per-band deviation, so the chart never drifts
 * from the raw shape further than EV requires.
 */
/**
 * THE EXPECTED-VALUE CORRIDOR, in chart slots, for a conditional rounding.
 * Five conditional averages sit close together (Nash's assists per band run
 * 1.49 down to 1.27), so rounding each to its nearest integer sends the whole
 * stat one way and its expected value walks off (all 1s for a 1.37 average).
 * Roundings that drift further than this are ranked behind every rounding
 * that does not; inside the corridor the ordinary rule decides.
 */
const EV_SLOT_TOLERANCE = 2.5;

/** The games' worth of the player's own overall rate a band's average is shrunk toward (conditionalStatValues). */
const CONDITIONAL_PRIOR_GAMES = 8;

/**
 * Every rounding the rules allow, best first — `evRoundValues` takes the
 * first. A caller that has to satisfy something the per-stat search cannot see
 * (reconcileConditional: no row may be worth less than the row below it, which
 * reads rebounds, assists AND points together) walks down this list instead.
 */
function evRoundCandidates(raws, slots, opts = {}) {
  const out = [];
  evRoundWalk(raws, slots, opts, c => out.push(c));
  return out.sort((a, b) => a.outside - b.outside || a.dev - b.dev || a.err - b.err);
}

function evRoundValues(raws, slots, opts = {}) {
  let best = null;
  evRoundWalk(raws, slots, opts, c => {
    if (!best || c.outside < best.outside
      || (c.outside === best.outside && (c.dev < best.dev - 1e-12 || (c.dev - best.dev <= 1e-12 && c.err < best.err)))) best = c;
  });
  // The constraint can in principle exclude every candidate (a raw ladder
  // that already jumps by more than its own gaps allow). Falling back to
  // per-band nearest rounding keeps a chart printable rather than throwing.
  return best?.values ?? raws.map(v => Math.round(roundDown(v, 1)));
}

function evRoundWalk(raws, slots, { monotone = true, maxTurns = Infinity, evTolerance = Infinity } = {}, emit) {
  const total = slots.reduce((a, b) => a + b, 0);
  const rawEv = raws.reduce((s, v, i) => s + v * slots[i], 0) / total;
  const options = raws.map(v => {
    const f = Math.max(0, Math.floor(v));
    return f === v ? [f] : [f, f + 1];
  });
  // VARIANCE IS EARNED, NOT GRANTED. Rounding can inflate the distance
  // between two neighbouring bands by at most 1 — the lower value rounds
  // down while the upper rounds up — so any printed jump wider than the
  // player's OWN raw gap plus one is an artefact of the search, not a fact
  // about him. Without this the EV objective bought wild shapes for a
  // rounding hair: Jarrett Allen's smooth 0.98/1.62/2.09/2.46/3.66 ladder
  // printed 1,1,3,3,3 (EV error 0.015) instead of 1,2,2,2,4 (0.065), and 72
  // of 354 cards carried a >=2 jump inside their scoring rows. A genuine
  // boom-or-bust scorer, whose raw gap at the ceiling IS large, still keeps
  // his cliff — which is the point.
  // `monotone: false` (conditionalStatValues): the ladder may fall as well as
  // rise, and the earned-variance ceiling then bounds the jump either way.
  const maxJump = raws.map((v, i) => (i === 0 ? Infinity : Math.max(1, Math.floor(Math.abs(v - raws[i - 1]) + 1))));
  const walk = (i, acc, evAcc, devAcc, lastDir, turns) => {
    if (i === raws.length) {
      // Per-band deviation is PRIMARY, EV drift is the tiebreak. The old
      // ordering flattened Tomlin's [0, 1.12, 1.40, 1.88, 2.998] into
      // [0, 2, 2, 2, 2] because EV [1.76] beat [0, 1, 1, 2, 3] EV [1.60] by
      // 0.016 — the anti-identity outcome. Ranked by per-band deviation
      // instead, [0, 1, 1, 2, 3] wins 3.20 vs 15.75, which is what the
      // smell test wants: the ladder his raw values actually describe.
      //
      // THE CORRIDOR (conditionalStatValues, `evTolerance`): a rounding that
      // drifts from the raw expected value by more than the tolerance ranks
      // behind every one that does not — and inside the corridor the same
      // deviation rule decides, so a passer whose assists live on his quiet
      // nights still prints them there rather than an EV-perfect flat line.
      // Tried and dropped on the way: expected value FIRST (rounds a
      // quiet-nights passer to 1-1-1-1-1, the anti-identity outcome again)
      // and a smoothness tiebreak (prefers flat, and the set lost distinct
      // rows). The zigzag is handled below as a constraint instead.
      const err = Math.abs(evAcc / total - rawEv);
      const outside = err * total > evTolerance ? 1 : 0;
      emit({ err, dev: devAcc, outside, values: [...acc] });
      return;
    }
    for (const v of options[i]) {
      let dir = lastDir;
      let t = turns;
      if (acc.length) {
        const prev = acc[acc.length - 1];
        if (monotone && v < prev) continue;          // monotone
        if (Math.abs(v - prev) > maxJump[i]) continue; // earned-variance ceiling
        // `maxTurns`: how often the ladder may change direction (flat steps
        // do not count). One is a rise, a fall, or a single hump — all of
        // which real profiles have; 1-0-1-0 is what half a rebound a band
        // rounds into, and it is noise, so a conditional rounding allows one.
        const step = Math.sign(v - prev);
        if (step && lastDir && step !== lastDir) t += 1;
        if (t > maxTurns) continue;
        if (step) dir = step;
      }
      acc.push(v);
      walk(i + 1, acc, evAcc + v * slots[i], devAcc + Math.abs(v - raws[i]) * slots[i], dir, t);
      acc.pop();
    }
  };
  walk(0, [], 0, 0, 0, 0);
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


/**
 * A MINUTES-WEIGHTED percentile.
 *
 * The normalization above divides by minutes TWICE, so a short appearance is
 * enormously amplified: Paul Reed's best 2025-26 "game" is 4 points in 7
 * minutes, which normalizes to 10.8 per four minutes — higher than any single
 * night Nikola Jokic had. Read as an unweighted percentile that put Reed's p90
 * at 5.91 against Jokic's 4.68 and priced a 14.6-mpg reserve at $1,360.
 *
 * Weighting each game by the minutes behind it says the obvious thing: a
 * seven-minute sample is weaker evidence than a thirty-six-minute one. It is
 * surgical — Reed's p90 falls 5.91 -> 4.08 while Allen (3.66 -> 3.63), Jokic
 * (4.68 -> 4.52) and Curry (5.03 -> 4.99) barely move, because a starter's
 * games are all of similar length and the weights come out flat.
 *
 * Interpolates between the two straddling values the way PERCENTILE.EXC does,
 * so the result stays continuous rather than snapping to observed values.
 */
export function weightedPercentile(values, weights, p) {
  const pairs = values
    .map((v, i) => ({ v, w: weights[i] }))
    .filter(x => Number.isFinite(x.v) && Number.isFinite(x.w) && x.w > 0)
    .sort((a, b) => a.v - b.v);
  if (pairs.length === 0) return 0;
  if (pairs.length === 1) return pairs[0].v;
  const total = pairs.reduce((s, x) => s + x.w, 0);
  // Cumulative weight at the CENTRE of each item's band, which is what makes
  // this reduce to the ordinary definition when every weight is equal.
  let acc = 0;
  const pts = pairs.map(x => {
    const centre = acc + x.w / 2;
    acc += x.w;
    return { v: x.v, q: centre / total };
  });
  if (p <= pts[0].q) return pts[0].v;
  if (p >= pts[pts.length - 1].q) return pts[pts.length - 1].v;
  for (let i = 1; i < pts.length; i += 1) {
    if (p <= pts[i].q) {
      const span = pts[i].q - pts[i - 1].q;
      const t = span > 0 ? (p - pts[i - 1].q) / span : 0;
      return pts[i - 1].v + t * (pts[i].v - pts[i - 1].v);
    }
  }
  return pts[pts.length - 1].v;
}

export function computeStatBands(games, statKey) {
  const normalized = games.map(g => normalize(g[statKey], minutesToDecimal(g.minutes)));
  // Weighted by the minutes behind each game — see weightedPercentile. This
  // also removes PERCENTILE.EXC's small-n domain problem (it is undefined for
  // p <= 1/(n+1)), which the 0.05 cut had run into for WNBA rookies with
  // seventeen-game windows.
  const minutes = games.map(g => minutesToDecimal(g.minutes));
  const thresholds = CUTS.map(p => weightedPercentile(normalized, minutes, p));

  const counts = thresholds.map((t, i) => {
    if (i === 0) return normalized.filter(v => v <= t).length;
    return normalized.filter(v => v > thresholds[i - 1] && v <= t).length;
  });
  const slots = allocateSlots(counts);
  // Values are chosen AFTER the slots so the rounding can weight each band
  // by the chart width it will actually occupy — see evRoundValues.
  const values = evRoundValues(thresholds.map(t => t * 4), slots);

  let start = 1;
  const bands = values.map((value, i) => {
    const width = slots[i];
    // `threshold` is the cut the band was made from, kept so a game can be
    // placed in a band again later (conditionalStatValues).
    const band = { lo: start, hi: start + width - 1, value, slots: width, threshold: thresholds[i] };
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
 * WHAT HE DID ALONGSIDE THOSE POINTS (the user, 2026-09-29).
 *
 * Every chart's rebounds and assists rose with its points, on all 1,296 cards,
 * because each stat was cut into its own ascending ladder and the ladders were
 * read at the same rung. Steve Nash's 2009-10 log says otherwise: his points
 * and assists are uncorrelated (-0.05), his lowest-scoring fifth of games
 * carried 10.5 assists and his highest 9.7 — and the card printed 0/0/1 on
 * the quiet nights and 2/1/2 on the big ones. The user: "I don't love that
 * high-end stats produce so in-tandem ... rooted in how we made these charts
 * ... realism tweaks while retaining the current mechanics."
 *
 * So the POINTS ladder stays the spine, exactly as cut, placed and gated. This
 * gives each of its bands the minutes-weighted average of the stat over the
 * games that LANDED in that band — what actually happened alongside those
 * points — on the same per-minute-times-four scale the thresholds use, and
 * rounds the five together (evRoundValues) without the monotone constraint:
 * a passer's assists may fall as his points rise, because they did — inside
 * an expected-value corridor, and with at most one change of direction, so
 * the ladder is a rise, a fall or a hump and never rounding noise. The
 * average rather than a percentile also brings the top row's boards and
 * assists down to what a big scoring night really carried.
 *
 * `ptsBands` are computeStatBands' points bands (their `threshold` places a
 * game; their `slots` weight the rounding), before or after placement — both
 * survive the copies. `games` are the joint rows the points were cut from.
 * Returns one `{ value, raw, games }` per band, or null when no row carries
 * both stats (an all-synthetic card), so the caller can fall back to the
 * per-stat ladders.
 */
export function conditionalStatValues(games, ptsBands, statKey) {
  const cond = conditionalStatRaws(games, ptsBands, statKey);
  if (!cond) return null;
  const values = evRoundValues(cond.raws, ptsBands.map(b => b.slots ?? 1), CONDITIONAL_ROUNDING);
  return cond.raws.map((raw, i) => ({ value: values[i], raw, games: cond.games[i] }));
}

/** The rules a conditional rounding runs under — see conditionalStatValues. */
export const CONDITIONAL_ROUNDING = { monotone: false, maxTurns: 1, evTolerance: EV_SLOT_TOLERANCE };

/** Every rounding of one stat's conditional averages the rules allow, best first (evRoundCandidates). */
export function conditionalRoundings(raws, slots) {
  return evRoundCandidates(raws, slots, CONDITIONAL_ROUNDING);
}

/**
 * The averaging half of conditionalStatValues, unrounded: `{ raws, games }`
 * per points band, or null. reconcileConditional rounds rebounds and assists
 * TOGETHER from these, because the rule that decides between roundings (no row
 * worth less than the row below it) reads both stats and the points at once.
 */
export function conditionalStatRaws(games, ptsBands, statKey) {
  const n = ptsBands?.length ?? 0;
  if (!n || ptsBands.some(b => !Number.isFinite(b.threshold))) return null;
  const sum = new Array(n).fill(0);
  const weight = new Array(n).fill(0);
  const count = new Array(n).fill(0);
  for (const g of games ?? []) {
    if (!Number.isFinite(g?.pts) || !Number.isFinite(g?.[statKey]) || g.minutes == null) continue;
    const minutes = minutesToDecimal(g.minutes);
    if (!(minutes > 0)) continue;
    const p = normalize(g.pts, minutes);
    let i = ptsBands.findIndex(b => p <= b.threshold);
    if (i < 0) i = n - 1;
    sum[i] += normalize(g[statKey], minutes) * minutes;
    weight[i] += minutes;
    count[i] += 1;
  }
  if (!count.some(c => c > 0)) return null;
  // THE BOTTOM BAND IS THREE OR FOUR NIGHTS. The cuts put 5% of a player's
  // games in his lowest band and 15% in the next, and an average over four
  // games is noise — Jokic's rebounds read 2, 1, 1, 2 down the card because
  // his four worst scoring nights happened to be big board nights. So each
  // band's average is shrunk toward the player's OWN overall rate by how few
  // games it holds: a band of four games keeps a third of its own reading, a
  // band of twenty most of it, and the shape that survives is the one his
  // season actually repeats.
  const overall = weight.reduce((a, b) => a + b, 0) > 0
    ? sum.reduce((a, b) => a + b, 0) / weight.reduce((a, b) => a + b, 0)
    : 0;
  const shrunk = i => {
    const own = sum[i] / weight[i];
    return (count[i] * own + CONDITIONAL_PRIOR_GAMES * overall) / (count[i] + CONDITIONAL_PRIOR_GAMES);
  };
  const raws = sum.map((s, i) => {
    if (weight[i] > 0) return shrunk(i) * 4;
    // A band no game landed in (a cut can sit between two observed values):
    // the nearest band that has games speaks for it.
    for (let d = 1; d < n; d += 1) {
      if (i - d >= 0 && weight[i - d] > 0) return shrunk(i - d) * 4;
      if (i + d < n && weight[i + d] > 0) return shrunk(i + d) * 4;
    }
    return 0;
  });
  return { raws, games: count };
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

/**
 * USAGE GATES THE UPPER TIERS. The founding per-36 normalization stays true to
 * efficiency -- a 14-minute player who produces at an elite per-minute rate
 * keeps that rate on his card. But a chart tier is an ACCESS question, not an
 * efficiency question: reaching the 3-2-1-and-up rows every other roll implies
 * having the ball, and a 15%-usage screener did not have it. The original
 * hand-built game bucketed everyone by USG% to distribute how easy the scoring
 * marks were to reach; this is that rule, rebuilt. Deliberately NOT a function
 * of minutes or games -- muting a player for playing less was considered and
 * rejected, because it punishes efficiency instead of ball-dominance.
 *
 * Buckets sit against the pool's own usage distribution (median ~19%, p25 ~15%,
 * floor ~9%). Usage above the norm shifts nothing: a star's access is already
 * priced by the effective-roll placement, and letting high usage ACCELERATE
 * access would refight the ceiling suppression from the other side.
 *
 * Accepts either convention -- dunksandthrees hands a fraction (0.202) and
 * Basketball-Reference a percent (20.2) -- so every generator can pass its row straight in.
 */
export function usageAccessShift(usage) {
  if (usage == null || !(usage > 0)) return 0;
  const u = usage > 1 ? usage / 100 : usage;
  if (u >= 0.19) return 0;
  if (u >= 0.16) return 1;
  if (u >= 0.13) return 2;
  if (u >= 0.10) return 3;
  return 4;
}

/**
 * Push the upper band boundaries out by `shift` rolls, ramped exactly like the
 * CDF blend: the bottom boundary does not move (scoring still starts where it
 * always did -- the floor is efficiency, which usage does not gate), and the
 * top boundary takes the full shift. Composes with either layout, which is why
 * it is a separate pass instead of an option on the placers.
 *
 * ONE KNOWN CONSEQUENCE, on purpose until it proves wrong: the PTS bands are
 * the chart's spine, so delaying a low-usage player's upper tiers also delays
 * the REB/AST that ride on them. A 10%-usage rebound specialist gets his
 * biggest board rows pushed out even though boards need no usage.
 */
export function delayUpperBands(bands, shift, { maxRoll = 60 } = {}) {
  if (!shift || bands.length < 2) return bands;
  const n = bands.length;
  const out = bands.map(b => ({ ...b }));
  let prevHi = 0;
  for (let i = 0; i < n - 1; i += 1) {
    const w = n === 2 ? 1 : i / (n - 2);
    let hi = out[i].hi + Math.round(w * shift);
    if (hi <= prevHi) hi = prevHi + 1;
    const roomForRest = maxRoll - (n - 1 - i);
    if (hi > roomForRest) hi = roomForRest;
    out[i].lo = prevHi + 1;
    out[i].hi = hi;
    prevHi = hi;
  }
  out[n - 1].lo = prevHi + 1;
  out[n - 1].hi = Math.max(out[n - 1].hi, prevHi + 1);
  return out;
}

/**
 * MORE ZEROES FOR THE UNTRUSTED. The fringe-prior shrink keeps a tiny
 * sample's RATES honest, but it converges on the fringe average — which
 * RAISED Danny Green's 115-minute rookie card, and the user's correction
 * stands: uncertainty is supposed to hurt. "He needs more zeroes somehow."
 *
 * So it gets them literally: a low-trust card's blank range grows, delaying
 * where scoring starts on the die by up to MAX_FLOOR_DELAY rolls at zero
 * trust. The mirror image of delayUpperBands — that one pushes the big marks
 * away from low-usage players, this one pushes ANY production away from
 * low-evidence seasons. A full-trust card is untouched.
 */
export const MAX_FLOOR_DELAY = 6;

export function delayFloor(bands, trust, { maxDelay = MAX_FLOOR_DELAY, maxRoll = 60 } = {}) {
  const extra = Math.round(Math.max(0, 1 - Math.max(0, Math.min(trust, 1))) * maxDelay);
  if (!extra || bands.length < 2) return bands;
  const out = bands.map(b => ({ ...b }));
  // The first band is the blank region: its hi moves up, and every later
  // boundary is pushed just enough to stay one roll wide.
  let prevHi = Math.min(out[0].hi + extra, maxRoll - (out.length - 1));
  out[0].hi = prevHi;
  for (let i = 1; i < out.length; i += 1) {
    out[i].lo = prevHi + 1;
    const roomForRest = maxRoll - (out.length - 1 - i);
    out[i].hi = i === out.length - 1
      ? Math.max(out[i].hi, out[i].lo)
      : Math.min(Math.max(out[i].hi, out[i].lo), roomForRest);
    prevHi = out[i].hi;
  }
  return out;
}
