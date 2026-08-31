// What widening the Speed+Power scale would COST, in points.
//
// The matchup matrix (scripts/analysis/matchupMatrix.js) established that only
// 124 distinct mechanical identities cover 350 cards, and that the fix for that
// is a wider printed Speed+Power range. The user approved widening with one
// condition — "we have to be very careful because that adds boosts and thus more
// scoring" — and this module is the instrument that answers it.
//
// It measures FOUR things per candidate scale, and each one is a different
// question:
//
//   1. mean roll bonus per matchup   — the direct proxy for added scoring
//   2. distinct mechanical identities — what widening is meant to buy
//   3. points per team per game       — the proxy converted into the units the
//                                       scoring-balance work is stated in
//   4. the axis mix                   — whether the widening changes HOW cards
//                                       win, not just by how much
//
// ── THE RESULT THAT REFRAMES THE WHOLE QUESTION ─────────────────────────────
//
// With every Def Boost at zero, the mean roll bonus over the ordered matrix does
// not depend on the Speed+Power totals AT ALL. It depends only on the spread of
// each card's SPLIT.
//
// Proof, and it is the mirror image of the Net Edge identity in matchupMatrix.js.
// For cards X and Y put a = Sx - Sy and b = Px - Py. Then
//     adv(X,Y) + adv(Y,X) = max(a,b) + max(-a,-b) = max(a,b) - min(a,b) = |a - b|
// and a - b = (Sx - Px) - (Sy - Py). Writing d = speed - power for each card,
// the two directions of a pair sum to |d_X - d_Y|. Summing over every unordered
// pair and dividing by the N(N-1) ordered matchups gives
//     mean roll bonus = mean over unordered pairs of |d_X - d_Y| / (N - 1) ...
// or equivalently, exactly the pair-mean of |d_X - d_Y| halved. Either way the
// BUDGET has cancelled: only d survives.
//
// The consequence for the user's question is the whole point. Where Net Edge is
// a function of the budget and blind to the split, mean roll bonus — the thing
// that drives scoring — is a function of the SPLIT and blind to the budget.
// They are exactly complementary. So:
//
//   - Raising or lowering the whole scale is free. The engine reads only
//     `off.speed - def.speed`, so a uniform shift cancels in play.
//   - Widening costs scoring only through the split, because the split is a
//     FRACTION of the total: at a fixed positional share, d is proportional to
//     the budget, so stretching budgets stretches d with them. That term is
//     second-order — the position share alone already puts most of the spread
//     into d — which is why the measured cost comes out small.
//   - And it means the size-aware split (attributes.js) is the change that moves
//     this number, even though the matrix proved the split cannot move Net Edge.
//
// ── WHY THE POINTS ESTIMATE WALKS THE CHART ─────────────────────────────────
//
// A roll bonus does not pay linearly. `lookupChart` returns a band, so a +1
// bonus is worth nothing at all unless it carries the roll across a boundary,
// and a large bonus is worth nothing once it has cleared the top band — every
// chart's last tier runs to 99. The same saturation exists at the bottom: the
// engine clamps the final roll at 1, and the bottom band is usually 0 points.
//
// So `expectedChartValue` walks all twenty faces of the die through the engine's
// own `lookupChart` at the candidate bonus, rather than assuming points move
// with bonus. That saturation is why the measured cost of widening is far
// smaller than the change in mean roll bonus suggests.

import { evaluateMatchup, ADVANTAGE, DISADVANTAGE } from './matchupMatrix.js';
import { lookupChart } from '../../src/game/cards.js';
import { applyModel, salaryFeatures, roundSalary } from '../cardgen/attributes.js';

/**
 * Chart scoring rolls per team per game.
 *
 * READ OFF THE ENGINE, not assumed. `endSection` in src/game/engine.js advances
 * `section` 1..3 and then `quarter` 1..4, so a game is 12 sections; and
 * `rollResults[teamKey][idx]` is indexed by STARTER, with ScoringPhase's
 * auto-roll looping `for (let i = 0; i < 5; i++)` per team. Five starters roll
 * once each per section.
 *
 * This counts CHART rolls only. Shot checks bought with assists and rebounds add
 * more points on top and are not modelled here — they take no roll bonus (see
 * `shotCheck`, which reads only the player's own boosts), so widening the scale
 * cannot change them. Excluding them makes the estimate a clean measure of the
 * thing that actually varies.
 */
export const SECTIONS_PER_GAME = 12;
export const STARTERS = 5;
export const SCORING_ROLLS_PER_GAME = SECTIONS_PER_GAME * STARTERS;

/** The engine's own roll clamp, from `doRoll`. */
export const clampRoll = roll => Math.max(1, Math.min(roll, 99));

/**
 * Expected chart value per scoring roll, for one card at one roll bonus.
 *
 * The whole d20 walked through the engine's `lookupChart`, so band boundaries
 * and both saturation ends are respected exactly rather than approximated.
 */
export function expectedChartValue(card, bonus, stat = 'pts', faces = 20) {
  let total = 0;
  for (let die = 1; die <= faces; die += 1) {
    total += lookupChart(card, clampRoll(die + bonus))[stat] ?? 0;
  }
  return total / faces;
}

/**
 * The pool-mean expected points per scoring roll, as a function of roll bonus.
 *
 * This is the curve the whole points estimate rests on, and printing it is the
 * point: it is NOT a straight line and it is NOT simply concave. It is an S.
 *
 *   - Below about +1 it is slightly CONVEX. A card already losing its matchup is
 *     rolling into the bottom of its chart, where the bands are 0 and the engine
 *     clamps the roll at 1, so making the penalty worse costs less and less.
 *   - Above about +2 it is CONCAVE. 318 of the 350 charts open their last tier
 *     at roll 20, so once a bonus clears that, more of it buys nothing at all.
 *   - Through the middle — which is where the field actually sits — it is very
 *     nearly straight.
 *
 * The consequence is the one that answers the user's question. Widening changes
 * the SPREAD of roll bonuses far more than it changes their mean, and spreading
 * a distribution across a curve that is convex on one side and concave on the
 * other is close to a wash. It is only mildly negative for a star-heavy field,
 * which already sits in the saturating half.
 */
export function bonusPointsCurve(cards, { from = -14, to = 14 } = {}) {
  const curve = [];
  for (let bonus = from; bonus <= to; bonus += 1) {
    const mean =
      cards.reduce((s, c) => s + expectedChartValue(c, bonus, 'pts'), 0) / (cards.length || 1);
    curve.push({ bonus, ptsPerRoll: mean, pointsPerGame: mean * SCORING_ROLLS_PER_GAME });
  }
  return curve;
}

/**
 * Points per team per game bought by one extra point of mean roll bonus.
 *
 * The exchange rate the whole report should be read against: it converts the
 * "mean roll bonus" column, which is abstract, into the units the scoring
 * balance work is stated in.
 *
 * A LEAST-SQUARES SLOPE OVER A WINDOW, not a one-step difference. The curve is
 * built from integer chart bands, so adjacent steps are jagged — the step from
 * bonus 1 to 3 happens to straddle a boundary most charts share and reads nearly
 * twice the true local slope. Fitting across the window the field actually
 * occupies averages that alignment noise out.
 */
export function bonusExchangeRate(cards, { at = 2, halfWidth = 4 } = {}) {
  const curve = bonusPointsCurve(cards, { from: at - halfWidth, to: at + halfWidth });
  const mx = curve.reduce((s, p) => s + p.bonus, 0) / curve.length;
  const my = curve.reduce((s, p) => s + p.pointsPerGame, 0) / curve.length;
  let num = 0;
  let den = 0;
  for (const p of curve) {
    num += (p.bonus - mx) * (p.pointsPerGame - my);
    den += (p.bonus - mx) ** 2;
  }
  return den > 0 ? num / den : 0;
}

/**
 * Every distinct card AT THE TABLE.
 *
 * Two cards with the same Speed, Power and EFFECTIVE Def Boost play identically
 * whatever else is printed on them; negative boosts clamp to zero in
 * `calcAdv`, so they collapse together too. Same definition runMatchupMatrix.js
 * reports, kept here so a candidate scale can be scored without running the
 * full matrix.
 */
export const mechanicalIdentity = c => `${c.speed}|${c.power}|${Math.max(0, c.defBoost || 0)}`;

export function countIdentities(cards) {
  return new Set(cards.map(mechanicalIdentity)).size;
}

/**
 * Run the ordered matrix over `cards` and return the scoring-relevant summary.
 *
 * The population is the argument: pass the whole set to describe the printed
 * scale, or a drafted field to describe a game. Both are reported, because they
 * answer different questions — see `capFeasibleField`.
 */
export function scoringProfile(cards) {
  let matchups = 0;
  let bonusSum = 0;
  let pts = 0;
  let reb = 0;
  let ast = 0;
  let advantages = 0;
  let neutral = 0;
  let disadvantages = 0;
  let bySpeed = 0;
  let byPower = 0;
  let byBoth = 0;
  // One card's expected value at one bonus is the same every time it recurs,
  // and across 122,150 matchups it recurs constantly.
  const cache = new Map();

  for (let a = 0; a < cards.length; a += 1) {
    for (let d = 0; d < cards.length; d += 1) {
      if (a === d) continue;
      const m = evaluateMatchup(cards[a], cards[d]);
      matchups += 1;
      bonusSum += m.rollBonus;

      const key = `${a}|${m.rollBonus}`;
      let ev = cache.get(key);
      if (ev === undefined) {
        ev = {
          pts: expectedChartValue(cards[a], m.rollBonus, 'pts'),
          reb: expectedChartValue(cards[a], m.rollBonus, 'reb'),
          ast: expectedChartValue(cards[a], m.rollBonus, 'ast'),
        };
        cache.set(key, ev);
      }
      pts += ev.pts;
      reb += ev.reb;
      ast += ev.ast;

      if (m.outcome === ADVANTAGE) {
        advantages += 1;
        if (m.axis === 'speed') bySpeed += 1;
        else if (m.axis === 'power') byPower += 1;
        else byBoth += 1;
      } else if (m.outcome === DISADVANTAGE) disadvantages += 1;
      else neutral += 1;
    }
  }

  const n = matchups || 1;
  const a = advantages || 1;
  return {
    cards: cards.length,
    matchups,
    meanRollBonus: bonusSum / n,
    ptsPerRoll: pts / n,
    rebPerRoll: reb / n,
    astPerRoll: ast / n,
    pointsPerGame: (SCORING_ROLLS_PER_GAME * pts) / n,
    identities: countIdentities(cards),
    advantageRate: advantages / n,
    neutralRate: neutral / n,
    disadvantageRate: disadvantages / n,
    axisSpeed: bySpeed / a,
    axisPower: byPower / a,
    axisBoth: byBoth / a,
  };
}

/**
 * A widened target distribution for `mapToReferenceScale`.
 *
 * The reference is what the map aims at, so a widening IS a different reference
 * — no new mapping code is needed, and every property speedPower.js documents
 * about the map (the untouched bulk, the tapered tail, the earned ceiling) still
 * holds for the widened one.
 *
 * `sdScale` is the dial that actually buys resolution. `min`/`max` alone only
 * release the cards the clamp was flattening, which is about sixteen of 350;
 * the compression that matters is in the BULK (46 cards share S+P 16), and only
 * a larger spread separates those. The knee moves with the spread so the taper
 * keeps describing the same part of the shape.
 *
 * `meanShift` is included for completeness and is very nearly a no-op at the
 * table: `calcAdv` reads only differences, so moving the whole set up or down
 * cancels. It is not free OUTSIDE the set — the other four sets and the shipped
 * 306 cards are priced against this level — which is why it defaults to zero.
 */
export function widenReference(reference, { min, max, sdScale = 1, meanShift = 0 } = {}) {
  const mean = reference.mean + meanShift;
  return {
    mean,
    sd: reference.sd * sdScale,
    min: min ?? reference.min,
    max: max ?? reference.max,
    p90: mean + (reference.p90 - reference.mean) * sdScale,
    ceilingShare: reference.ceilingShare,
  };
}

/**
 * Re-print a finished card at a new Speed+Power budget.
 *
 * ONLY THREE FIELDS CAN MOVE, and that is a property of buildCard rather than a
 * simplification here: `speedPowerTotal` enters the card exclusively through
 * `splitSpeedPower`, and the only other consumer of the result is
 * `salaryFeatures`, whose first feature is `speed + power`. The chart, shot
 * line, boosts and Def Boost are all functions of the player's statistics and
 * are untouched by the scale. So swapping the split and re-pricing reproduces
 * exactly what the generator would produce, without re-synthesising 350 charts.
 *
 * Re-pricing is not optional. Salary is the mechanism that makes widening
 * partly self-correcting: a bigger budget costs more, so a widened star is
 * harder to fit under the 5500 cap. Leaving salary alone would overstate the
 * scoring cost by pretending the widened field is as affordable as today's.
 */
export function respec(card, { speed, power }, { salaryModel, chartEv }) {
  const next = { ...card, speed, power };
  next.salary = roundSalary(applyModel(salaryModel, salaryFeatures(next, chartEv)));
  return next;
}

/** Each card's chart expected value per d20 face — the salary model's inputs. */
export function chartExpectedValues(card) {
  return {
    pts: expectedChartValue(card, 0, 'pts'),
    reb: expectedChartValue(card, 0, 'reb'),
    ast: expectedChartValue(card, 0, 'ast'),
  };
}

/**
 * A tiny deterministic PRNG (mulberry32), so the sampled draft is reproducible.
 *
 * A balance number nobody can reproduce is not a balance number. Seeding here
 * rather than reaching for Math.random means re-running the report on an
 * unchanged set prints the same figures to the last decimal.
 */
export function rng(seed = 0x5eed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each card's Net Edge from its budget alone — the exact identity, no matrix. */
export function budgetEdges(cards) {
  const n = cards.length - 1;
  const sum = cards.reduce((s, c) => s + c.speed + c.power, 0);
  return cards.map(c => {
    const sp = c.speed + c.power;
    return n > 0 ? sp - (sum - sp) / n : 0;
  });
}

/**
 * One cap-legal ten-card roster, drafted by a competent-but-varying picker.
 *
 * WHY NOT PURE GREEDY. The first version of this took the best value at every
 * step, and the resulting figure swung twelve points between adjacent candidates
 * — because a ten-point salary change flips one pick, which cascades. That is
 * draft noise being read as a scale effect. A single greedy roster is not a
 * measurement.
 *
 * WHY NOT PURELY RANDOM EITHER. A uniformly random cap-legal team is mostly
 * cheap cards, which is not what anyone plays, and it would understate the
 * scoring the real game produces.
 *
 * So: uniform among the `taste` best affordable cards remaining. Averaged over
 * enough samples that is a stable estimate of "a sensible team", and it varies
 * the way real drafts vary. Affordability reserves the cheapest remaining
 * salaries for the unfilled slots, so a roster can always be completed.
 */
export function draftRoster(cards, random, { cap = 5500, rosterSize = 10, taste = 10, exclude } = {}) {
  const edges = budgetEdges(cards);
  const ranked = cards
    .map((c, i) => ({ card: c, value: edges[i] / Math.max(c.salary ?? 1, 1) }))
    .sort((a, b) => b.value - a.value);
  const cheapest = cards.map(c => c.salary ?? 0).sort((a, b) => a - b);
  const taken = new Set(exclude ?? []);

  const picks = [];
  let spent = 0;
  while (picks.length < rosterSize) {
    const reserve = cheapest
      .slice(0, rosterSize - picks.length - 1)
      .reduce((s, x) => s + x, 0);
    const affordable = [];
    for (const r of ranked) {
      if (taken.has(r.card.id)) continue;
      if (spent + (r.card.salary ?? 0) + reserve > cap) continue;
      affordable.push(r);
      if (affordable.length >= taste) break;
    }
    if (affordable.length === 0) break;
    const choice = affordable[Math.floor(random() * affordable.length)];
    taken.add(choice.card.id);
    picks.push(choice.card);
    spent += choice.card.salary ?? 0;
  }
  return { picks, spent, taken };
}

/**
 * Points per team per game, averaged over many sampled cap-legal matchups.
 *
 * The full 350-card matrix describes the PRINTED scale; it does not describe a
 * game. A game is ten cards a side under a 5500 cap, five of them starting, and
 * nobody drafts the replacement-level end of the set — so the full-field number
 * understates real scoring badly (about 133 against the ~200 the balance design
 * doc reports from play). Widening also moves the two populations differently:
 * it makes the top of the set stronger AND more expensive at the same time, and
 * only a cap-constrained field shows the second half of that.
 *
 * Starters are the five highest-salary cards on the roster — the salary model is
 * a direct function of what a card can do, so its own ranking is the best
 * available stand-in for who a player would start.
 */
export function sampledGameScoring(cards, { samples = 200, seed = 0x5eed, starters = STARTERS, ...draftOpts } = {}) {
  const random = rng(seed);
  const byId = new Map(cards.map(c => [c.id, c]));
  let pts = 0;
  let bonus = 0;
  let n = 0;
  let sampled = 0;
  let starterBudget = 0;
  let starterSalary = 0;
  let starterCount = 0;

  for (let s = 0; s < samples; s += 1) {
    const a = draftRoster(cards, random, draftOpts);
    const b = draftRoster(cards, random, { ...draftOpts, exclude: a.taken });
    if (a.picks.length < starters || b.picks.length < starters) continue;
    sampled += 1;
    const five = r =>
      r.picks
        .slice()
        .sort((x, y) => (y.salary ?? 0) - (x.salary ?? 0))
        .slice(0, starters)
        .map(c => byId.get(c.id) ?? c);
    const fa = five(a);
    const fb = five(b);
    for (const c of [...fa, ...fb]) {
      starterBudget += c.speed + c.power;
      starterSalary += c.salary ?? 0;
      starterCount += 1;
    }
    for (const [off, def] of [
      [fa, fb],
      [fb, fa],
    ]) {
      for (const o of off) {
        for (const d of def) {
          const m = evaluateMatchup(o, d);
          pts += expectedChartValue(o, m.rollBonus, 'pts');
          bonus += m.rollBonus;
          n += 1;
        }
      }
    }
  }

  const d = n || 1;
  const k = starterCount || 1;
  return {
    samples: sampled,
    pointsPerGame: (SCORING_ROLLS_PER_GAME * pts) / d,
    meanRollBonus: bonus / d,
    // The diagnostic that explains the headline. If widening raised scoring,
    // these would rise with it; when they FALL, the salary model has priced the
    // extra budget and the cap is buying fewer stars than it used to.
    meanStarterBudget: starterBudget / k,
    meanStarterSalary: starterSalary / k,
  };
}
