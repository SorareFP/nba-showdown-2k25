/**
 * What a card is worth in play, in points per scoring roll.
 *
 * Extracted so the price measurement and the cap simulation compute it exactly
 * the same way — two answers derived from two copies of this arithmetic would
 * not be comparable, and the whole question is a comparison.
 *
 * THE SCORING ECONOMY HAS THREE CHANNELS, and pricing only the first is the
 * mistake that makes every shooter look replacement-level:
 *
 *   chart       `scoringRoll` does `score += result.pts` with no check at all.
 *               Ungated, and the largest channel.
 *   conversion  the chart's REBOUNDS and ASSISTS are currencies. 4 AST buys a
 *               3PT check, 3 REB a paint check, 2 REB a putback — and those
 *               ARE gated, by the shot line less the relevant boost.
 *   target      a team spends its POOLED currency on whoever converts best, so
 *               a card that converts well is worth something even when it
 *               generates none of the currency itself.
 *
 * Everything is measured at the roll bonus the engine's own matchup rule
 * gives, against the whole field, so Speed+Power enters through what it
 * actually buys rather than as a term of its own. That is what lets the result
 * see an interaction the linear salary model structurally cannot: a point of
 * Speed+Power is worth more to a card with a steep chart, because the bonus
 * lands somewhere better.
 */
import { evaluateMatchup } from './matchupMatrix.js';
import { expectedChartValue } from './scaleWidening.js';

export const mean = xs => xs.reduce((s, v) => s + v, 0) / xs.length;
export const sd = xs => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(v => (v - m) ** 2)));
};

/** P(a shot check clears the line), given the boost that applies to it. */
export function hitProb(card, boostKey) {
  const need = (card.shotLine ?? 20) - (card[boostKey] ?? 0);
  return Math.max(0, Math.min(1, (21 - Math.max(1, need)) / 20));
}

export function computePlayValue(cards) {
  const n = cards.length;

  const bonus = Array.from({ length: n }, () => new Int16Array(n));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i !== j) bonus[i][j] = evaluateMatchup(cards[i], cards[j]).rollBonus;
    }
  }

  const cache = new Map();
  const evAt = (idx, b, stat) => {
    const key = `${idx}|${b}|${stat}`;
    let v = cache.get(key);
    if (v === undefined) {
      v = expectedChartValue(cards[idx], b, stat);
      cache.set(key, v);
    }
    return v;
  };

  const medianOf = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const fieldHit3 = medianOf(cards.map(c => hitProb(c, 'threePtBoost')));
  const fieldHitPaint = medianOf(cards.map(c => hitProb(c, 'paintBoost')));

  const convert = (card, stat) => {
    if (stat === 'ast') {
      const p = (card.threePtBoost ?? 0) > 0 ? hitProb(card, 'threePtBoost') : fieldHit3;
      return (3 / 4) * p;
    }
    const p = (card.paintBoost ?? 0) > 0 ? hitProb(card, 'paintBoost') : fieldHitPaint;
    return p;
  };

  const chart = new Array(n);
  const conv = new Array(n);
  for (let i = 0; i < n; i += 1) {
    let p = 0;
    let k = 0;
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      const b = bonus[i][j];
      p += evAt(i, b, 'pts');
      k += evAt(i, b, 'ast') * convert(cards[i], 'ast') + evAt(i, b, 'reb') * convert(cards[i], 'reb');
    }
    chart[i] = p / (n - 1);
    conv[i] = k / (n - 1);
  }

  const meanAst = mean(cards.map((_, i) => evAt(i, 0, 'ast')));
  const target = cards.map(c => {
    const e3 = ((c.threePtBoost ?? 0) > 0 ? hitProb(c, 'threePtBoost') : 0) - fieldHit3;
    const ep = ((c.paintBoost ?? 0) > 0 ? hitProb(c, 'paintBoost') : 0) - fieldHitPaint;
    return meanAst * Math.max(0, Math.max(e3 * 3, ep * 2));
  });

  // Defence: points denied against a real median defender rather than a
  // synthetic average, so the baseline is something the game can actually field.
  const byDef = cards
    .map((c, i) => [c.speed + c.power + (c.defBoost ?? 0), i])
    .sort((a, b) => a[0] - b[0]);
  const medianDef = byDef[Math.floor(byDef.length / 2)][1];

  const defence = new Array(n);
  for (let j = 0; j < n; j += 1) {
    let t = 0;
    for (let i = 0; i < n; i += 1) {
      if (i !== j) t += evAt(i, bonus[i][medianDef], 'pts') - evAt(i, bonus[i][j], 'pts');
    }
    defence[j] = t / (n - 1);
  }

  const value = cards.map((_, i) => chart[i] + conv[i] + target[i] + defence[i]);
  return { value, chart, conv, target, defence, medianDef };
}

/**
 * The play value re-expressed on the CURRENT salary mean and spread.
 *
 * Deliberately not a raw price: matching the existing distribution keeps the
 * 5500 roster cap meaning what it means today, so a comparison isolates the
 * change in ORDERING rather than confounding it with a change in scale.
 */
export function proposedSalaries(cards, value, { roundSalary, min, max }) {
  const cur = cards.map(c => c.salary ?? 0);
  const mV = mean(value);
  const sV = sd(value);
  const mS = mean(cur);
  const sS = sd(cur);
  return value.map(v => Math.min(Math.max(roundSalary(mS + ((v - mV) / sV) * sS), min), max));
}
