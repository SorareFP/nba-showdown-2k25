/**
 * MEASUREMENT ONLY — what a play-derived salary would do to the set.
 *
 * The shipped salary model is a least-squares fit on eight card features, and
 * it reproduces the ORIGINAL 283 cards to r-squared 0.98. That fidelity is the
 * problem: those salaries were themselves close to linear in Speed+Power, so
 * the model learned a world in which the chart is nearly free. Measured on the
 * 2026-27 set, Speed+Power moves salary across a 1094-point range and chart
 * expected points across 32.
 *
 * That was survivable while charts were hand-made and looked alike. The
 * generated charts come from real per-game distributions and vary enormously,
 * so a price that cannot see chart shape now misprices badly in both
 * directions. Deni Avdija returns 3/1/1 or better on 85% of the die -- a
 * property only five other cards in 350 have, and the other five average 1038
 * salary against his 690.
 *
 * This script does NOT change anything. It prints what a play-derived price
 * would say, so the size of the correction can be judged before it is adopted.
 *
 * The alternative price is the card's expected output in ACTUAL PLAY:
 *
 *   offence  mean over every opponent of the card's expected points per
 *            scoring roll, taken at the roll bonus the engine's own matchup
 *            rule gives it against that opponent
 *   defence  the points the card DENIES, as the mean over every attacker of
 *            what that attacker scores against a median defender minus what
 *            it scores against this card
 *
 * Both are in points per scoring roll, so they add. This prices the floor, the
 * ceiling, the shot line and both boosts without naming any of them, because
 * all of them show up in what the card actually produces. It also captures the
 * interaction the linear model structurally cannot: Speed+Power is worth more
 * to a card with a steep chart, because the bonus lands somewhere better.
 *
 * The result is mapped onto the CURRENT salary mean and spread rather than
 * used raw, so the 5500 roster cap keeps its meaning and only the ORDERING
 * changes.
 */
import { readFileSync } from 'node:fs';
import { evaluateMatchup } from './matchupMatrix.js';
import { expectedChartValue } from './scaleWidening.js';
import { roundSalary, SALARY_MIN, SALARY_MAX } from '../cardgen/attributes.js';

const SET = process.argv[2] ?? 'card-data/generated/cards-2026-27.json';
const cards = JSON.parse(readFileSync(SET, 'utf8')).cards;

const mean = xs => xs.reduce((s, v) => s + v, 0) / xs.length;
const sd = xs => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(v => (v - m) ** 2)));
};

// Roll bonus for every ordered pair, once.
const n = cards.length;
const bonus = Array.from({ length: n }, () => new Int16Array(n));
for (let i = 0; i < n; i += 1) {
  for (let j = 0; j < n; j += 1) {
    if (i === j) continue;
    bonus[i][j] = evaluateMatchup(cards[i], cards[j]).rollBonus;
  }
}

// Points a card scores at a given bonus, memoised per (card, bonus).
const evCache = new Map();
const ptsAt = (idx, b) => {
  const key = idx * 128 + (b + 40);
  let v = evCache.get(key);
  if (v === undefined) {
    v = expectedChartValue(cards[idx], b, 'pts');
    evCache.set(key, v);
  }
  return v;
};

// ── The conversion channels ────────────────────────────────────────────────
//
// Chart points reach the score ungated -- `scoringRoll` does `score +=
// result.pts` with no check. The chart's REBOUNDS and ASSISTS are currencies
// instead, and they buy shot checks that ARE gated, by the shot line less the
// relevant boost:
//
//   4 AST -> a 3PT check   (3 points, needs a 3PT boost)
//   3 REB -> a paint check (2 points, needs a paint boost)
//   2 REB -> a putback     (2 points, a paint check)
//
// Pricing only the chart channel is what made the first pass crater every
// shooter: Luke Kennard's value is almost entirely conversion, and a model
// blind to conversion reads him as a replacement-level card. This is also the
// honest reason the shipped model pays +70.76 for shot line and +41.06 for a
// 3PT boost -- those features are real, they just act here rather than on the
// chart.
const hitProb = (card, boostKey) => {
  const need = (card.shotLine ?? 20) - (card[boostKey] ?? 0);
  return Math.max(0, Math.min(1, (21 - Math.max(1, need)) / 20));
};
const medianOf = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fieldHit3 = medianOf(cards.map(c => hitProb(c, 'threePtBoost')));
const fieldHitPaint = medianOf(cards.map(c => hitProb(c, 'paintBoost')));

// Assists and rebounds pool at TEAM level and are spent on whoever converts
// best, so a card's own generation is valued at its own rate when it holds the
// boost that unlocks the spend, and at the field's median rate otherwise --
// the currency still gets spent, just by a team-mate.
const convert = (card, stat) => {
  if (stat === 'ast') {
    const p = (card.threePtBoost ?? 0) > 0 ? hitProb(card, 'threePtBoost') : fieldHit3;
    return (3 / 4) * p; // 3 points per 4 assists, at the hit rate
  }
  const p = (card.paintBoost ?? 0) > 0 ? hitProb(card, 'paintBoost') : fieldHitPaint;
  return (2 / 2) * p; // 2 points per 2 rebounds (the putback, the cheaper spend)
};

const otherAt = (idx, b, stat) => expectedChartValue(cards[idx], b, stat);

// Offence: expected points per scoring roll across the whole field, counting
// all three channels at the roll bonus the matchup rule actually gives.
const chartPts = [];
const convPts = [];
const offence = cards.map((c, i) => {
  let p = 0;
  let k = 0;
  for (let j = 0; j < n; j += 1) {
    if (i === j) continue;
    const b = bonus[i][j];
    p += ptsAt(i, b);
    k += otherAt(i, b, 'ast') * convert(c, 'ast') + otherAt(i, b, 'reb') * convert(c, 'reb');
  }
  chartPts[i] = p / (n - 1);
  convPts[i] = k / (n - 1);
  return chartPts[i] + convPts[i];
});

// Being a good SPEND TARGET is worth something on its own, and it is the one
// thing a per-card metric most easily misses. Luke Kennard generates almost no
// assists, so his own conversion barely registers -- but a team spends ITS
// pooled assists on whoever converts best, and a low shot line with a 3PT
// boost is what makes that pool worth more. The credit is the card's edge over
// the field's median converter, applied to roughly one player's share of the
// team's assist flow. Only one player can really be the designated shooter, so
// crediting every card in full would double-count; one share is the
// conservative reading.
const meanAstPerRoll = mean(cards.map((c, i) => otherAt(i, 0, 'ast')));
const target = cards.map(c => {
  const edge3 = ((c.threePtBoost ?? 0) > 0 ? hitProb(c, 'threePtBoost') : 0) - fieldHit3;
  const edgeP = ((c.paintBoost ?? 0) > 0 ? hitProb(c, 'paintBoost') : 0) - fieldHitPaint;
  return meanAstPerRoll * Math.max(0, Math.max(edge3 * 3, edgeP * 2));
});

// Defence: points denied relative to the median defender. The median is a real
// card rather than a synthetic average, so the comparison is against something
// the game can actually field.
const byDef = cards
  .map((c, i) => [c.speed + c.power + (c.defBoost ?? 0), i])
  .sort((a, b) => a[0] - b[0]);
const medianDef = byDef[Math.floor(byDef.length / 2)][1];

const defence = cards.map((_, j) => {
  let t = 0;
  for (let i = 0; i < n; i += 1) {
    if (i === j) continue;
    t += ptsAt(i, bonus[i][medianDef]) - ptsAt(i, bonus[i][j]);
  }
  return t / (n - 1);
});

const value = cards.map((_, i) => offence[i] + target[i] + defence[i]);

// Map onto the current salary mean and spread: re-rank without re-scaling.
const cur = cards.map(c => c.salary ?? 0);
const mV = mean(value);
const sV = sd(value);
const mS = mean(cur);
const sS = sd(cur);
const proposed = value.map(v =>
  Math.min(Math.max(roundSalary(mS + ((v - mV) / sV) * sS), SALARY_MIN), SALARY_MAX)
);

const rows = cards
  .map((c, i) => ({
    name: c.name,
    sp: c.speed + c.power,
    old: cur[i],
    neu: proposed[i],
    d: proposed[i] - cur[i],
    chart: chartPts[i],
    conv: convPts[i],
    tgt: target[i],
    off: offence[i],
    def: defence[i],
    val: value[i],
  }))
  .sort((a, b) => b.d - a.d);

const f = (x, w, p = 2) => x.toFixed(p).padStart(w);
const pad = (s, w) => String(s).padEnd(w);

console.log(`\n${cards.length} cards from ${SET}`);
console.log(
  `value: offence ${f(mean(offence), 6)} +/- ${f(sd(offence), 5)}   ` +
    `defence ${f(mean(defence), 6)} +/- ${f(sd(defence), 5)}   ` +
    `median defender = ${cards[medianDef].name}`
);
console.log(`salary: current mean ${f(mS, 7, 0)} sd ${f(sS, 6, 0)} -> proposed matched by construction\n`);

const moved = rows.filter(r => Math.abs(r.d) >= 10);
console.log(`cards moving at all: ${moved.length} of ${rows.length}`);
console.log(`  mean absolute move ${f(mean(rows.map(r => Math.abs(r.d))), 6, 0)}`);
console.log(`  moving 200+:        ${rows.filter(r => Math.abs(r.d) >= 200).length}`);
console.log(`  moving 400+:        ${rows.filter(r => Math.abs(r.d) >= 400).length}`);

const head = `\n  ${pad('player', 24)}${'S+P'.padStart(4)}${'old'.padStart(6)}${'new'.padStart(6)}${'delta'.padStart(7)}${'chart'.padStart(7)}${'conv'.padStart(7)}${'tgt'.padStart(7)}${'def'.padStart(7)}`;
console.log('\n── BIGGEST RAISES ─────────────────────────────────────────────────────');
console.log(head);
for (const r of rows.slice(0, 18))
  console.log(`  ${pad(r.name, 24)}${String(r.sp).padStart(4)}${String(r.old).padStart(6)}${String(r.neu).padStart(6)}${String(r.d > 0 ? `+${r.d}` : r.d).padStart(7)}${f(r.chart, 7)}${f(r.conv, 7)}${f(r.tgt, 7)}${f(r.def, 7)}`);

console.log('\n── BIGGEST CUTS ───────────────────────────────────────────────────────');
console.log(head);
for (const r of rows.slice(-18).reverse())
  console.log(`  ${pad(r.name, 24)}${String(r.sp).padStart(4)}${String(r.old).padStart(6)}${String(r.neu).padStart(6)}${String(r.d > 0 ? `+${r.d}` : r.d).padStart(7)}${f(r.chart, 7)}${f(r.conv, 7)}${f(r.tgt, 7)}${f(r.def, 7)}`);

const named = ['Deni Avdija', "De'Aaron Fox", 'Nikola Jokić', 'Luka Dončić', 'Tre Mann', 'Luka Garza', 'Dejounte Murray', 'Jimmy Butler'];
console.log('\n── THE CARDS THAT STARTED THIS ────────────────────────────────────────');
console.log(head);
for (const nm of named) {
  const r = rows.find(x => x.name === nm);
  if (r) console.log(`  ${pad(r.name, 24)}${String(r.sp).padStart(4)}${String(r.old).padStart(6)}${String(r.neu).padStart(6)}${String(r.d > 0 ? `+${r.d}` : r.d).padStart(7)}${f(r.chart, 7)}${f(r.conv, 7)}${f(r.tgt, 7)}${f(r.def, 7)}`);
}

const corr = (x, y) => {
  const mx = mean(x);
  const my = mean(y);
  const num = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0);
  const den = Math.sqrt(x.reduce((s, v) => s + (v - mx) ** 2, 0) * y.reduce((s, v) => s + (v - my) ** 2, 0));
  return den ? num / den : 0;
};
console.log('\n── HOW THE TWO PRICES RELATE ──────────────────────────────────────────');
console.log(`  corr(current salary, play value) = ${corr(cur, value).toFixed(3)}`);
console.log(`  corr(S+P, current salary)        = ${corr(cards.map(c => c.speed + c.power), cur).toFixed(3)}`);
console.log(`  corr(S+P, play value)            = ${corr(cards.map(c => c.speed + c.power), value).toFixed(3)}`);
