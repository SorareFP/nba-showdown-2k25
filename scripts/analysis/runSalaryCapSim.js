/**
 * Does the 5500 cap still mean what it means, if salary is play-derived?
 *
 * The price measurement (`runSalaryRefit.js`) says WHAT moves. It cannot say
 * whether the set still drafts, because a salary is only meaningful against a
 * cap: re-pricing 338 of 350 cards changes which ten-card rosters are legal,
 * and a price that is individually fairer but collectively unaffordable is not
 * an improvement.
 *
 * Two things are varied, and they are genuinely different questions:
 *
 *   PRICE    old salaries vs the proposed ones.
 *   DRAFTER  how the picker values a card. The shipped drafter ranks by
 *            `budgetEdges / salary`, and budgetEdges is a Speed+Power matchup
 *            number -- it cannot see a chart. Holding that drafter fixed while
 *            raising Avdija's price makes him LESS attractive, which is the
 *            correct economic response to a card that was underpriced, but it
 *            is not what a player who can read a chart would do. So the same
 *            comparison is run with a drafter that values cards by play value,
 *            and the pair of results is the answer.
 *
 * Prints points per team per game, which the balance work treats as the
 * headline, plus what the cap actually buys.
 */
import { readFileSync } from 'node:fs';
import {
  sampledGameScoring, budgetEdges, countIdentities, rng, expectedChartValue,
  SCORING_ROLLS_PER_GAME,
} from './scaleWidening.js';
import { evaluateMatchup } from './matchupMatrix.js';
import { computePlayValue, proposedSalaries, mean } from './playValue.js';
import { roundSalary, SALARY_MIN, SALARY_MAX } from '../cardgen/attributes.js';

const SET = process.argv[2] ?? 'card-data/generated/cards-2026-27.json';
const cards = JSON.parse(readFileSync(SET, 'utf8')).cards;

const { value } = computePlayValue(cards);
const proposed = proposedSalaries(cards, value, {
  roundSalary,
  min: SALARY_MIN,
  max: SALARY_MAX,
});

const repriced = cards.map((c, i) => ({ ...c, salary: proposed[i] }));

const RUNS = [
  ['old price', cards],
  ['new price', repriced],
];

// ── A chart-aware drafter ──────────────────────────────────────────────────
//
// `draftRoster` ranks by `budgetEdges / salary`, and budgetEdges is a
// Speed+Power matchup number that CANNOT SEE A CHART. That is fine while
// salary is itself mostly Speed+Power, because the two agree. Re-price the set
// on play value and they stop agreeing: chart-heavy cards get expensive while
// their edge stays flat, so the shipped drafter flees to cheap weak-chart
// cards -- and then scoring, which is measured on charts, collapses.
//
// That collapse is a fact about the DRAFTER, not about the price. A player who
// can read a chart would buy the expensive chart. So the same comparison is run
// again with a picker that ranks by play value per salary dollar, which is the
// behaviour a correct price is supposed to produce.
//
// Re-implemented here rather than by reaching into scaleWidening.js, so the
// shipped drafter stays exactly what it is and the substitution is visible.
// Ranking on raw value per dollar DEGENERATES, and the reason is worth stating
// because it nearly produced a wrong answer. Play value never approaches zero
// -- the weakest card in the set still scores something -- so value/salary is
// maximised by whatever is cheapest, and the drafter fields ten near-free cards
// and leaves most of the cap unspent. The shipped drafter escapes this only
// because `budgetEdges` is a NET edge that goes negative for weak cards.
//
// The analogous play quantity is therefore value ABOVE REPLACEMENT, replacement
// being the weakest card the set can field. That restores the property the
// shipped ratio has, without importing its blindness to charts.
function draftBy(set, vals, random, { cap = 5500, rosterSize = 10, taste = 10, exclude } = {}) {
  // Centred on the MEDIAN, not the minimum: `budgetEdges` is a net edge that
  // goes negative for a below-average card, which is precisely what stops the
  // shipped ratio favouring whatever is cheapest. Centring on the minimum
  // leaves every card positive and the degeneracy intact.
  const sorted = vals.slice().sort((a, b) => a - b);
  const replacement = sorted[Math.floor(sorted.length / 2)];
  const ranked = set
    .map((c, i) => ({ card: c, v: (vals[i] - replacement) / Math.max(c.salary ?? 1, 1) }))
    .sort((a, b) => b.v - a.v);
  const cheapest = set.map(c => c.salary ?? 0).sort((a, b) => a - b);
  const taken = new Set(exclude ?? []);
  const picks = [];
  let spent = 0;
  while (picks.length < rosterSize) {
    const reserve = cheapest.slice(0, rosterSize - picks.length - 1).reduce((s, x) => s + x, 0);
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

function scoreWith(set, vals, { samples = 400, seed = 0x5eed } = {}) {
  const random = rng(seed);
  let pts = 0;
  let bonus = 0;
  let n = 0;
  let sampled = 0;
  let sBudget = 0;
  let sSalary = 0;
  let sCount = 0;
  for (let s = 0; s < samples; s += 1) {
    const a = draftBy(set, vals, random);
    const b = draftBy(set, vals, random, { exclude: a.taken });
    if (a.picks.length < 5 || b.picks.length < 5) continue;
    sampled += 1;
    const five = r => r.picks.slice().sort((x, y) => (y.salary ?? 0) - (x.salary ?? 0)).slice(0, 5);
    const fa = five(a);
    const fb = five(b);
    for (const c of [...fa, ...fb]) {
      sBudget += c.speed + c.power;
      sSalary += c.salary ?? 0;
      sCount += 1;
    }
    for (const [off, def] of [[fa, fb], [fb, fa]]) {
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
  return {
    samples: sampled,
    pointsPerGame: (SCORING_ROLLS_PER_GAME * pts) / d,
    meanRollBonus: bonus / d,
    meanStarterBudget: sBudget / (sCount || 1),
    meanStarterSalary: sSalary / (sCount || 1),
  };
}

const f = (x, w, p = 1) => x.toFixed(p).padStart(w);

console.log(`\n${cards.length} cards from ${SET}`);
console.log('cap 5500, ten-card rosters, five starters, 400 sampled matchups per row\n');

console.log('── DRAFTER RANKS BY MATCHUP EDGE / SALARY (the shipped one) ───────────');
console.log(`  ${'price'.padEnd(12)}${'pts/team/gm'.padStart(12)}${'roll bonus'.padStart(12)}${'starter S+P'.padStart(13)}${'starter $'.padStart(11)}${'samples'.padStart(9)}`);
const base = {};
for (const [label, set] of RUNS) {
  const r = sampledGameScoring(set, { samples: 400, seed: 0x5eed });
  base[label] = r;
  console.log(
    `  ${label.padEnd(12)}${f(r.pointsPerGame, 12)}${f(r.meanRollBonus, 12, 2)}` +
      `${f(r.meanStarterBudget, 13, 1)}${f(r.meanStarterSalary, 11, 0)}${String(r.samples).padStart(9)}`
  );
}
const dPts = base['new price'].pointsPerGame - base['old price'].pointsPerGame;
console.log(`\n  scoring change: ${dPts >= 0 ? '+' : ''}${dPts.toFixed(1)} pts/team/game`);

console.log('\n── DRAFTER RANKS BY PLAY VALUE / SALARY (chart-aware) ─────────────────');
console.log(`  ${'price'.padEnd(12)}${'pts/team/gm'.padStart(12)}${'roll bonus'.padStart(12)}${'starter S+P'.padStart(13)}${'starter $'.padStart(11)}${'samples'.padStart(9)}`);
const aware = {};
for (const [label, set] of RUNS) {
  const r = scoreWith(set, value, { samples: 400, seed: 0x5eed });
  aware[label] = r;
  console.log(
    `  ${label.padEnd(12)}${f(r.pointsPerGame, 12)}${f(r.meanRollBonus, 12, 2)}` +
      `${f(r.meanStarterBudget, 13, 1)}${f(r.meanStarterSalary, 11, 0)}${String(r.samples).padStart(9)}`
  );
}
const dAware = aware['new price'].pointsPerGame - aware['old price'].pointsPerGame;
console.log(`\n  scoring change: ${dAware >= 0 ? '+' : ''}${dAware.toFixed(1)} pts/team/game`);

// Affordability: can a full ten-card roster still be assembled?
function fillRate(set) {
  const cheapest = set.map(c => c.salary ?? 0).sort((a, b) => a - b);
  const tenCheapest = cheapest.slice(0, 10).reduce((s, x) => s + x, 0);
  return { tenCheapest, medianSalary: cheapest[Math.floor(cheapest.length / 2)] };
}
console.log('\n── CAN A ROSTER STILL BE FILLED? ──────────────────────────────────────');
for (const [label, set] of RUNS) {
  const a = fillRate(set);
  const over = set.filter(c => (c.salary ?? 0) > 5500 / 5).length;
  console.log(
    `  ${label.padEnd(12)} ten cheapest cost ${String(a.tenCheapest).padStart(5)} of 5500   ` +
      `median card ${String(a.medianSalary).padStart(4)}   cards above a fifth of the cap: ${over}`
  );
}

console.log('\n── WHAT THE CAP BUYS ──────────────────────────────────────────────────');
for (const [label, set] of RUNS) {
  const ids = countIdentities(set);
  const edges = budgetEdges(set);
  const top = set
    .map((c, i) => ({ c, v: edges[i] / Math.max(c.salary ?? 1, 1) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 8)
    .map(x => `${x.c.name.split(' ').slice(-1)[0]} ${x.c.salary}`)
    .join(', ');
  console.log(`  ${label.padEnd(12)} distinct identities ${String(ids).padStart(4)}`);
  console.log(`               best value by the drafter's own metric: ${top}`);
}

console.log('\n── SALARY DISTRIBUTION ────────────────────────────────────────────────');
for (const [label, set] of RUNS) {
  const s = set.map(c => c.salary ?? 0).sort((a, b) => a - b);
  const q = p => s[Math.floor((s.length - 1) * p)];
  console.log(
    `  ${label.padEnd(12)} min ${String(q(0)).padStart(4)}  p25 ${String(q(0.25)).padStart(4)}  ` +
      `median ${String(q(0.5)).padStart(4)}  p75 ${String(q(0.75)).padStart(4)}  max ${String(q(1)).padStart(4)}  ` +
      `mean ${f(mean(s), 6, 0)}   at the floor: ${s.filter(x => x <= SALARY_MIN).length}   at the cap: ${s.filter(x => x >= SALARY_MAX).length}`
  );
}
