// WHAT WOULD THESE CARDS COST TODAY? Prices the named cards from any
// generated set against the base field under the current playValue model,
// without writing anything, beside the salary each file carries.
//
//   node scripts/analysis/priceNow.mjs "Maya Moore" ["Another Name" ...]
//
// Written 2026-09-23 for the user's Maya Moore report: the free-agent 2016
// card carried a higher salary than her Super Season (2014) card.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cardgen/cache.js';
import * as PV from '../cardgen/playValue.js';
import * as A from '../cardgen/attributes.js';

const names = process.argv.slice(2);
if (!names.length) { console.error('name at least one player'); process.exit(1); }
const GEN = path.join(REPO_ROOT, 'card-data', 'generated');
const found = [];
for (const f of fs.readdirSync(GEN).filter(f => f.startsWith('cards-') && f.endsWith('.json'))) {
  let body;
  try { body = JSON.parse(fs.readFileSync(path.join(GEN, f), 'utf8')); } catch { continue; }
  const cards = Array.isArray(body) ? body : body.cards;
  if (!Array.isArray(cards)) continue;
  for (const c of cards) if (names.some(n => c.name === n)) found.push({ file: f, card: c });
}
const copies = found.map(x => structuredClone(x.card));
PV.priceAgainstBase(copies, { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX });
const field = PV.loadBaseField ? PV.loadBaseField() : null;
const values = field ? PV.computePlayValue(copies, { field }).value : null;
found.forEach((x, i) => {
  const c = x.card;
  console.log(
    `${x.file.padEnd(32)} ${c.name} ${c.season ?? ''} ${c.team ?? ''}`.padEnd(70) +
    ` file $${c.salary}  today $${copies[i].salary}` +
    (values ? `  value ${Number(values[i]).toFixed(2)}` : '') +
    `  S${c.speed}/P${c.power} line ${c.shotLine} 3PT ${c.threePtBoost} paint ${c.paintBoost} def ${c.defBoost}`,
  );
});
