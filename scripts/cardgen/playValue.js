/**
 * What a card is worth in play, and therefore what it costs.
 *
 * REPLACES a least-squares fit on eight card features. That fit reproduced the
 * original 283 cards to r-squared 0.98, and the fidelity was the problem: those
 * salaries were themselves near-linear in Speed+Power, so the model learned a
 * world in which the chart is nearly free. Measured on the 2026-27 set,
 * Speed+Power moved salary across a 1094-point range and chart expected points
 * across 32 — 1.4% of the total swing. Deni Avdija returns 3/1/1 or better on
 * 85% of the die, a property five other cards in 350 have, and those five
 * averaged 1038 salary against his 690.
 *
 * That was survivable while charts were hand-made and looked alike. The
 * generated charts come from real per-game distributions and vary enormously,
 * so a price blind to chart shape misprices in both directions — and the
 * mispricing is exploitable: a drafter that reads charts extracted 223.9
 * pts/team/game under the old prices against a ~197 design target, and 202.6
 * under these.
 *
 * ── THE SCORING ECONOMY HAS THREE CHANNELS ──────────────────────────────────
 *
 * Pricing only the first is the mistake that makes every shooter look
 * replacement-level, and it is the reason the old model's shot-line and
 * 3PT-boost coefficients were not noise:
 *
 *   chart       `scoringRoll` does `score += result.pts` with NO check at all.
 *               Ungated, and the largest channel.
 *   conversion  the chart's REBOUNDS and ASSISTS are currencies. The engine's
 *               SPEND_COSTS say what each buys (5 AST a 3PT or paint check, 5
 *               REB a paint check, since 2026-09-23) — and those ARE gated, by
 *               the shot line less the relevant boost. See `astRate`/`rebRate`.
 *   target      a team spends its POOLED currency on whoever converts best, so
 *               converting well is worth something even to a card that
 *               generates none of the currency itself. Luke Kennard is the case
 *               that proves it.
 *
 * Everything is measured at the roll bonus the engine's own `calcAdv` gives,
 * against a whole field, so Speed+Power enters through what it actually buys
 * rather than as a term of its own. That is what lets this see an interaction
 * the linear model structurally could not: a point of Speed+Power is worth more
 * to a card with a steep chart, because the bonus lands somewhere better.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './cache.js';
import { calcAdv, SPEND_COSTS, STARTERS } from '../../src/game/engine.js';
import { lookupChart } from '../../src/game/cards.js';

/** The engine's own roll clamp. */
export const clampRoll = roll => Math.max(1, Math.min(roll, 99));

export const mean = xs => xs.reduce((s, v) => s + v, 0) / xs.length;
export const sd = xs => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(v => (v - m) ** 2)));
};

/**
 * The finished 2025-26 set's salary distribution, measured not chosen.
 *
 * Play value is expressed on THIS mean and spread rather than used raw, so the
 * 5500 roster cap keeps meaning what it has always meant and only the ORDERING
 * of cards changes. Measured over the 306 cards in src/game/rawCards.js.
 */
export const REFERENCE_SALARY = { mean: 600.7, sd: 295.7 };

/** Expected chart output per scoring roll at one roll bonus, walked exactly. */
export function expectedChartValue(card, bonus, stat = 'pts', faces = 20) {
  let total = 0;
  for (let die = 1; die <= faces; die += 1) {
    total += lookupChart(card, clampRoll(die + bonus))[stat] ?? 0;
  }
  return total / faces;
}

/**
 * P(a shot check clears the line), given the boost that applies to it and the
 * CONTEST against it. Since the engine's matchupContest change, every 3PT and
 * paint check is contested by the shooter's matchup defender's Defensive
 * Bonus — a check priced uncontested no longer matches the game being played.
 */
export function hitProb(card, boostKey, contest = 0) {
  const need = (card.shotLine ?? 20) - (card[boostKey] ?? 0) + contest;
  return Math.max(0, Math.min(1, (21 - Math.max(1, need)) / 20));
}

/** A defender's standing contest, exactly as matchupContest floors it. */
export const contestOf = card => Math.max(0, card.defBoost ?? 0);

/**
 * WHAT ONE ASSIST AND ONE REBOUND ARE WORTH, in points, read off the engine's
 * own prices (2026-09-23).
 *
 * These rates were constants written for the economy of early September: 4
 * AST bought a three, 3 REB a paint check and 2 REB a putback, so a rebound
 * was priced at a whole paint check's chance — p per REB. The putback went,
 * both checks moved to 5, and the rebound paint check opened (REBOUND_RULES),
 * but the constants stayed: the model priced a rebound at about two and a half
 * times what one buys, and ABOVE an assist, while 600 simulated games had an
 * assist worth nearly twice a rebound (0.33 against 0.18 points). Every
 * rebounder was overpriced by it. Now the price is the check a unit buys:
 *
 *   assist   the better of a 3PT check (3 × p3) and a paint check (2 × pp),
 *            each divided by its SPEND_COSTS price
 *   rebound  a paint check (2 × pp) divided by SPEND_COSTS.reboundPaint
 *
 * `p3`/`pp` are the hit chances of whoever spends it (see `convert`).
 */
export const astRate = (p3, pp) => Math.max(
  (3 * p3) / SPEND_COSTS.assistThree,
  (2 * pp) / SPEND_COSTS.assistPaint,
);
export const rebRate = pp => (2 * pp) / SPEND_COSTS.reboundPaint;

/**
 * Play value for every card in `cards`, measured against `field`.
 *
 * `field` is the opposition the value is measured against and defaults to the
 * cards themselves. Passing a COMMON field is what makes two sets comparable:
 * a WNBA card and a Super Season card priced against their own small pools
 * would not be, and they meet across sets at the table.
 */
export function computePlayValue(cards, { field = cards } = {}) {
  const n = cards.length;
  const m = field.length;

  const bonus = Array.from({ length: n }, () => new Int16Array(m));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      bonus[i][j] = cards[i].id === field[j].id ? 0 : calcAdv(cards[i], field[j]).rollBonus;
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
  // Conversions live in a contested world now: measure every hit rate against
  // the field's median standing contest.
  const fieldContest = medianOf(field.map(contestOf));
  const fieldHit3 = medianOf(field.map(c => hitProb(c, 'threePtBoost', fieldContest)));
  const fieldHitPaint = medianOf(field.map(c => hitProb(c, 'paintBoost', fieldContest)));

  // Currency is pooled at TEAM level and spent by whoever converts best. ANY
  // player may take a check now (the user, 2026-09-08: "Players shouldn't need
  // a bonus to be able to spend"), so a card's own generation is valued at its
  // own rate whenever that beats the field's median — otherwise a team-mate at
  // the median spends it. It used to be gated on a POSITIVE boost, the old
  // spend rule, which priced Luke Kennard's 12 Shot Line (45% from three, 40%
  // in the paint, boosts 0 and -1) as a 30% shooter.
  const convert = (card, stat) => {
    const pp = Math.max(hitProb(card, 'paintBoost', fieldContest), fieldHitPaint);
    if (stat === 'ast') {
      const p3 = Math.max(hitProb(card, 'threePtBoost', fieldContest), fieldHit3);
      return astRate(p3, pp);
    }
    return rebRate(pp);
  };

  const chart = new Array(n);
  const conv = new Array(n);
  for (let i = 0; i < n; i += 1) {
    let p = 0;
    let k = 0;
    let seen = 0;
    for (let j = 0; j < m; j += 1) {
      if (cards[i].id === field[j].id) continue;
      const b = bonus[i][j];
      p += evAt(i, b, 'pts');
      k += evAt(i, b, 'ast') * convert(cards[i], 'ast') + evAt(i, b, 'reb') * convert(cards[i], 'reb');
      seen += 1;
    }
    const d = seen || 1;
    chart[i] = p / d;
    conv[i] = k / d;
  }

  // THE TARGET: the team's pooled currency, spent by its best converter. A
  // section's pool is STARTERS rolls' worth; divided by a check's price it is
  // the checks a section buys, and this card's edge over the median converter
  // is what each is worth more in its hands. Rebounds joined the pool when
  // the rebound paint check opened (2026-09-23); with assists at 5 a check,
  // the assist term is exactly what it was.
  const meanAst = mean(cards.map((_, i) => evAt(i, 0, 'ast')));
  const meanReb = mean(cards.map((_, i) => evAt(i, 0, 'reb')));
  const astChecks = (STARTERS * meanAst) / SPEND_COSTS.assistThree;
  const rebChecks = (STARTERS * meanReb) / SPEND_COSTS.reboundPaint;
  const target = cards.map(c => {
    const e3 = hitProb(c, 'threePtBoost', fieldContest) - fieldHit3;
    const ep = hitProb(c, 'paintBoost', fieldContest) - fieldHitPaint;
    return astChecks * Math.max(0, Math.max(e3 * 3, ep * 2)) + rebChecks * Math.max(0, ep * 2);
  });

  // Defence: points denied against a real median defender rather than a
  // synthetic average, so the baseline is something the game can actually field.
  const byDef = field
    .map((c, i) => [c.speed + c.power + (c.defBoost ?? 0), i])
    .sort((a, b) => a[0] - b[0]);
  const medianDef = field[byDef[Math.floor(byDef.length / 2)][1]];

  // A defender's conversion denial: what an attacker's rebounds and assists
  // are worth converted THROUGH this defender's contest. Volumes come off the
  // chart at the attacker's roll bonus against that defender, rates from the
  // attacker's own boosts under the defender's standing contest — so defBoost
  // is finally paid for both of its jobs: shaving advantages AND contesting
  // the checks those currencies buy.
  const convThrough = (attacker, def) => {
    const b = calcAdv(attacker, def).rollBonus;
    const c = contestOf(def);
    const p3 = Math.max(hitProb(attacker, 'threePtBoost', c), fieldHit3);
    const pp = Math.max(hitProb(attacker, 'paintBoost', c), fieldHitPaint);
    return expectedChartValue(attacker, b, 'ast') * astRate(p3, pp)
         + expectedChartValue(attacker, b, 'reb') * rebRate(pp);
  };

  const defence = cards.map(card => {
    let t = 0;
    let seen = 0;
    for (let i = 0; i < m; i += 1) {
      const attacker = field[i];
      if (attacker.id === card.id) continue;
      const base = expectedChartValue(attacker, calcAdv(attacker, medianDef).rollBonus, 'pts');
      t += base - expectedChartValue(attacker, calcAdv(attacker, card).rollBonus, 'pts');
      t += convThrough(attacker, medianDef) - convThrough(attacker, card);
      seen += 1;
    }
    return t / (seen || 1);
  });

  const value = cards.map((_, i) => chart[i] + conv[i] + target[i] + defence[i]);
  return { value, chart, conv, target, defence };
}

/**
 * Price a finished set.
 *
 * A POST-PASS, necessarily: play value is measured against a field, so it does
 * not exist until every card in that field has its attributes. This is the one
 * structural difference from the model it replaces, which priced each card
 * alone at the end of `buildCard`.
 *
 * The `basis` is what the value distribution is standardised against. It
 * defaults to the cards being priced, which is right for the base set; a small
 * set priced on its own basis would stretch sixteen cards across the whole
 * salary range, so special sets pass the base set's values instead.
 */
/**
 * The base set, as the common field every other set is priced against.
 *
 * Cross-set comparability is the whole reason this exists. A sixteen-card WNBA
 * Super Season set priced against ITSELF would stretch sixteen all-time peaks
 * across the entire salary range and call the weakest of them replacement
 * level; priced against the 350-card base set, they land where sixteen
 * all-time peaks belong. Exactly the argument the Speed+Power scale makes for
 * calibrating against the archive rather than the pool being carded.
 */
export const BASE_SET_FILE = path.join(REPO_ROOT, 'card-data', 'generated', 'cards-2026-27.json');

let baseFieldCache = null;
export function loadBaseField() {
  if (baseFieldCache) return baseFieldCache;
  const body = JSON.parse(fs.readFileSync(BASE_SET_FILE, 'utf8'));
  baseFieldCache = Array.isArray(body) ? body : body.cards;
  return baseFieldCache;
}

/**
 * Price a set against the base set, on the base set's own value distribution.
 *
 * The one call every generator except the base set itself should make. Passing
 * the base values as the BASIS is what stops a small set being stretched: the
 * standardisation is against 350 current players, so a sixteen-card set of
 * all-time peaks lands high as a group instead of being spread from floor to
 * ceiling by its own internal spread.
 */
export function priceAgainstBase(cards, { roundSalary, min, max }) {
  const field = loadBaseField();
  const { value: basis } = computePlayValue(field, { field });
  return priceCardsInPlace(cards, { field, basis, roundSalary, min, max });
}

/**
 * Price a set in place against a field, and report what moved.
 *
 * Mutates `cards`, which is deliberate: every caller is about to serialise the
 * same array, and returning a copy invites a caller to write the unpriced one.
 */
export function priceCardsInPlace(cards, opts) {
  const before = cards.map(c => c.salary ?? null);
  const salaries = priceSet(cards, opts);
  cards.forEach((c, i) => {
    c.salary = salaries[i];
  });
  const moved = before.filter((v, i) => v != null && v !== salaries[i]).length;
  return { salaries, moved, priced: cards.length };
}

/**
 * THE BENCH BREAK: how far below strict proportionality the cheap end sits.
 *
 * Matching the reference mean AND spread, which is what this used to do, fixes
 * the LINE's two ends and lets its intercept fall where it may. It fell at -97:
 * every card got ninety-seven dollars off a price proportional to its value,
 * which is five per cent of Victor Wembanyama and three quarters of a floor
 * card. Since only five of a roster's ten play at once, that made the other
 * five nearly free — the five cheapest cards cost $290 together, leaving $5,210
 * of a $5,500 cap for the starting five, and a bench of scraps became the
 * dominant build.
 *
 * Nobody chose -97; it was arithmetic. The user, 2026-09-12, chose this: keep a
 * break for depth, because depth SHOULD be cheap when it plays half the time,
 * but make it a quarter rather than three quarters, "so long as the players are
 * deserving of that salary".
 *
 * WHY A CURVE AND NOT AN INTERCEPT. Subtracting a constant cannot do it: the
 * break it gives is the constant over the price, so it decays like 1/value —
 * 23% for the single cheapest card, 12% for the next, nothing by mid-table —
 * and pushing the constant high enough to lift the TIER drives the bottom into
 * the $10 floor and re-compresses exactly what this exists to undo. A power
 * curve gives the whole cheap end one break and tapers smoothly, with no
 * clamping and no inversions: price stays strictly increasing in value, so no
 * card is priced above or below what it is worth.
 *
 * MEASURED at 1.30, holding the reference mean: the cheapest tenth of the set
 * pays 27% under proportional, the cheapest quarter 21%, and the dearest tenth
 * pays 16% over — the top is what funds the break, which is what holding the
 * mean means. The five cheapest cards go from $290 to $390.
 *
 * IT MOVES THE RARITY BANDS WITH IT, and that is not optional: the bands are
 * fixed dollar thresholds, every one of them above the mean price, so inflating
 * the top promotes cards across them. Left alone this run took legendary from
 * 14 cards to 22. getPlayerRarity's thresholds were re-cut in the same change
 * to hold the populations roughly where they were — see the note there.
 */
export const BENCH_CURVE = 1.30;

export function priceSet(cards, { field, basis, roundSalary, min, max } = {}) {
  const { value } = computePlayValue(cards, { field });
  const b = basis ?? value;
  // The curve is anchored on the BASIS, so a sixteen-card special set is placed
  // on the base set's line rather than stretched across its own spread — the
  // property priceAgainstBase exists to hold.
  const curved = v => Math.sign(v) * Math.abs(v) ** BENCH_CURVE;
  const A = REFERENCE_SALARY.mean / (mean(b.map(curved)) || 1);
  return value.map(v => Math.min(Math.max(roundSalary(A * curved(v)), min), max));
}
