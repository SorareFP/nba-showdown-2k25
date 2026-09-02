// Dry-run: what the defBoost contest rework does to base-set salaries.
// Reads cards-2026-27.json, re-prices with the contested playValue model,
// prints the delta distribution and the biggest movers. WRITES NOTHING.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cardgen/cache.js';
import * as PV from '../cardgen/playValue.js';
import * as A from '../cardgen/attributes.js';

const body = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'card-data/generated/cards-2026-27.json'), 'utf8'));
const cards = Array.isArray(body) ? body : body.cards;

const salaries = PV.priceSet(cards, {
  roundSalary: A.roundSalary,
  min: A.SALARY_MIN,
  max: A.SALARY_MAX,
});

const rows = cards.map((c, i) => ({
  name: c.name, def: c.defBoost ?? 0, old: c.salary, neu: salaries[i], d: salaries[i] - c.salary,
}));

const moved = rows.filter(r => r.d !== 0);
const up = moved.filter(r => r.d > 0).length;
const down = moved.filter(r => r.d < 0).length;
const meanAbs = moved.reduce((s, r) => s + Math.abs(r.d), 0) / (moved.length || 1);
console.log(`${cards.length} cards | moved: ${moved.length} (${up} up, ${down} down) | mean |move|: ${meanAbs.toFixed(0)}`);

const byDef = new Map();
for (const r of rows) {
  const k = r.def;
  if (!byDef.has(k)) byDef.set(k, []);
  byDef.get(k).push(r.d);
}
console.log('\nmean salary move by defBoost:');
for (const k of [...byDef.keys()].sort((a, b) => a - b)) {
  const ds = byDef.get(k);
  console.log(`  Def ${k >= 0 ? '+' : ''}${k}: ${(ds.reduce((s, v) => s + v, 0) / ds.length).toFixed(0)}  (n=${ds.length})`);
}

rows.sort((a, b) => b.d - a.d);
console.log('\nbiggest gains:');
rows.slice(0, 10).forEach(r => console.log(`  ${r.name} (Def+${r.def}): ${r.old} -> ${r.neu}  (+${r.d})`));
console.log('\nbiggest cuts:');
rows.slice(-10).reverse().forEach(r => console.log(`  ${r.name} (Def+${r.def}): ${r.old} -> ${r.neu}  (${r.d})`));
