// What is one Shot Line step worth, in the salary model's own terms?
//
//   node scripts/analysis/shotLineValue.mjs [set.json] [sample=90]
//
// The user's hunch (2026-09-05): "super low shot lines might be a meta —
// may be worth weighting those more heavily for salary." This is the MODEL
// half of the answer. ONE CARD AT A TIME, against an unchanged field, a card
// gets a Shot Line one step lower (or Speed +1, or 3PT Boost +1, for scale),
// the set is re-valued through computePlayValue, and the change is mapped to
// dollars the way runSalaryRefit.js maps value to salary (mean + z * sd).
// Perturbing every card at once would be wrong twice over: Speed is relative
// (every matchup difference would cancel to exactly $0), and the model's
// field medians would move with the field. The SIM half is
// `runStratAudit.js --full --shift-a=-1` against `--shift-a=0`: the same
// drafts, Team A's lines one step lower, the swing in win rate and margin.
import { readFileSync } from 'node:fs';
import { computePlayValue } from './playValue.js';

const SET = process.argv[2] ?? 'card-data/generated/cards-2026-27.json';
const SAMPLE = Number(process.argv[3] ?? 90);
const cards = JSON.parse(readFileSync(SET, 'utf8')).cards.filter(c => Array.isArray(c.chart) && c.chart.length);

const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))) || 1; };

const base = computePlayValue(cards).value;
const sV = sd(base);
const salaries = cards.map(c => c.salary ?? 0);
const mS = mean(salaries), sS = sd(salaries);
const dollars = dv => (dv / sV) * sS;

// A stratified sample: every Shot Line represented in proportion, seeded.
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const byLine = new Map();
cards.forEach((c, i) => { const k = c.shotLine ?? 18; byLine.set(k, [...(byLine.get(k) ?? []), i]); });
const sample = [];
for (const [, idxs] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
  const take = Math.max(1, Math.round((idxs.length / cards.length) * SAMPLE));
  const pool = idxs.slice();
  for (let k = 0; k < take && pool.length; k += 1) sample.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
}

function deltaFor(i, mutate) {
  const alt = cards.map((c, j) => (j === i ? mutate({ ...c }) : c));
  const v = computePlayValue(alt).value;
  return dollars(v[i] - base[i]);
}

const rows = sample.map(i => ({
  i,
  line: cards[i].shotLine ?? 18,
  salary: cards[i].salary ?? 0,
  shot: deltaFor(i, c => { c.shotLine = Math.max(12, (c.shotLine ?? 18) - 1); return c; }),
  speed: deltaFor(i, c => { c.speed = (c.speed ?? 0) + 1; return c; }),
  three: deltaFor(i, c => { c.threePtBoost = (c.threePtBoost ?? 0) + 1; return c; }),
}));

console.log(`${cards.length} cards, ${rows.length} sampled one at a time; salary mean $${mS.toFixed(0)} sd $${sS.toFixed(0)}; value sd ${sV.toFixed(3)} pts/roll`);
console.log('\nWorth of ONE STEP for one card, in salary dollars (model):');
console.log(`  Shot Line one lower   mean $${mean(rows.map(r => r.shot)).toFixed(0)}`);
console.log(`  Speed +1              mean $${mean(rows.map(r => r.speed)).toFixed(0)}`);
console.log(`  3PT Boost +1          mean $${mean(rows.map(r => r.three)).toFixed(0)}`);
console.log('\nShot Line step by current line (a 12 cannot go lower):');
for (const k of [...new Set(rows.map(r => r.line))].sort((a, b) => a - b)) {
  const g = rows.filter(r => r.line === k);
  console.log(`  line ${String(k).padStart(2)}  n ${String(g.length).padStart(2)}  avg salary $${mean(g.map(r => r.salary)).toFixed(0).padStart(4)}  one step lower = +$${mean(g.map(r => r.shot)).toFixed(0).padStart(3)}   (Speed +1 = +$${mean(g.map(r => r.speed)).toFixed(0)}, 3PT +1 = +$${mean(g.map(r => r.three)).toFixed(0)})`);
}
