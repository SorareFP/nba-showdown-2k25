// Dry-run: what pricing rebounds and assists at the engine's own spend costs
// does to every set's salaries (2026-09-23). WRITES NOTHING.
//
//   node scripts/analysis/currencyRepriceDryRun.mjs
//
// Prices the base set on its own basis and every other set against the base
// field, exactly as repriceAllSets.mjs does, and reports the moves per set,
// the move by rebounds per roll (the channel that changed most), and the
// biggest movers.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cardgen/cache.js';
import * as PV from '../cardgen/playValue.js';
import * as A from '../cardgen/attributes.js';

const GEN = path.join(REPO_ROOT, 'card-data', 'generated');
const OPTS = { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX };
const load = f => {
  const body = JSON.parse(fs.readFileSync(path.join(GEN, f), 'utf8'));
  return Array.isArray(body) ? body : body.cards;
};
const FILES = [
  'cards-super-season.json', 'cards-rookie.json', 'cards-summer-standouts.json', 'cards-dissonance.json',
  'cards-team-rewards.json', 'cards-wnba.json', 'cards-wnba-rookie.json', 'cards-wnba-super-season.json',
  'cards-set-rewards.json', 'cards-wnba-team-rewards.json', 'cards-wnba-set-rewards.json', 'cards-throwbacks.json',
  'cards-free-agents.json',
];

const rows = [];
{
  const cards = load('cards-2026-27.json');
  const s = PV.priceSet(cards, OPTS);
  cards.forEach((c, i) => rows.push({ set: 'base', c, old: c.salary, neu: s[i] }));
}
for (const f of FILES) {
  if (!fs.existsSync(path.join(GEN, f))) continue;
  const cards = load(f).map(c => structuredClone(c));
  const before = cards.map(c => c.salary);
  PV.priceAgainstBase(cards, OPTS);
  cards.forEach((c, i) => rows.push({ set: f.replace(/^cards-|\.json$/g, ''), c, old: before[i], neu: c.salary }));
}

const rebPerRoll = c => PV.expectedChartValue(c, 0, 'reb');
console.log('set                       cards  moved  up  down  mean|move|');
for (const set of [...new Set(rows.map(r => r.set))]) {
  const rs = rows.filter(r => r.set === set);
  const moved = rs.filter(r => r.neu !== r.old);
  const up = moved.filter(r => r.neu > r.old).length;
  const mean = moved.length ? moved.reduce((s, r) => s + Math.abs(r.neu - r.old), 0) / moved.length : 0;
  console.log(`${set.padEnd(24)} ${String(rs.length).padStart(6)} ${String(moved.length).padStart(6)} ${String(up).padStart(4)} ${String(moved.length - up).padStart(5)} ${mean.toFixed(0).padStart(10)}`);
}

const base = rows.filter(r => r.set === 'base');
const bands = [[0, 0.5], [0.5, 1], [1, 1.5], [1.5, 2], [2, 99]];
console.log('\nbase set: mean move by rebounds per roll (at no bonus)');
for (const [lo, hi] of bands) {
  const rs = base.filter(r => rebPerRoll(r.c) >= lo && rebPerRoll(r.c) < hi);
  if (!rs.length) continue;
  const m = rs.reduce((s, r) => s + (r.neu - r.old), 0) / rs.length;
  console.log(`  ${lo}-${hi === 99 ? '+' : hi} REB: ${m >= 0 ? '+' : ''}${m.toFixed(0)}  (n=${rs.length})`);
}
const all = rows.slice().sort((a, b) => (b.neu - b.old) - (a.neu - a.old));
const line = r => `  ${r.c.name} ${r.c.season ?? ''} [${r.set}]: ${r.old} -> ${r.neu} (${r.neu - r.old >= 0 ? '+' : ''}${r.neu - r.old})  reb/roll ${rebPerRoll(r.c).toFixed(2)}`;
console.log('\nbiggest gains:'); all.slice(0, 10).forEach(r => console.log(line(r)));
console.log('\nbiggest cuts:'); all.slice(-10).reverse().forEach(r => console.log(line(r)));
