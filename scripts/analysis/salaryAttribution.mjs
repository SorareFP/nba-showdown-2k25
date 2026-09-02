// Per-card salary attribution: how much of each base-set salary comes from
// each play-value channel. value = chart + conv + target + defence, and salary
// is the standardized value — so each channel's deviation from the field mean,
// scaled by the same standardization, is its salary contribution. The four
// contributions sum to (salary − reference mean) before rounding/clamping.
// Writes salary-attribution.csv next to the set and prints the extremes.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cardgen/cache.js';
import * as PV from '../cardgen/playValue.js';

const SET = path.join(REPO_ROOT, 'card-data', 'generated', 'cards-2026-27.json');
const cards = JSON.parse(fs.readFileSync(SET, 'utf8')).cards;

const { value, chart, conv, target, defence } = PV.computePlayValue(cards, { field: cards });
const mV = PV.mean(value);
const sV = PV.sd(value) || 1;
const scale = PV.REFERENCE_SALARY.sd / sV;
const ch = { chart, conv, target, defence };
const chMean = Object.fromEntries(Object.entries(ch).map(([k, xs]) => [k, PV.mean(xs)]));

const rows = cards.map((c, i) => ({
  name: c.name,
  team: c.team,
  salary: c.salary,
  defBoost: c.defBoost ?? 0,
  chart$: (chart[i] - chMean.chart) * scale,
  conv$: (conv[i] - chMean.conv) * scale,
  target$: (target[i] - chMean.target) * scale,
  defence$: (defence[i] - chMean.defence) * scale,
}));

const csv = ['name,team,salary,defBoost,chart$,conv$,target$,defence$']
  .concat(rows.map(r =>
    `"${r.name}",${r.team},${r.salary},${r.defBoost},${r.chart$.toFixed(0)},${r.conv$.toFixed(0)},${r.target$.toFixed(0)},${r.defence$.toFixed(0)}`))
  .join('\n');
const out = path.join(REPO_ROOT, 'card-data', 'generated', 'salary-attribution.csv');
fs.writeFileSync(out, csv + '\n');
console.log(`wrote ${out} (${rows.length} rows)`);
console.log(`channel $ are deviations from the field mean; they sum to salary − ${PV.REFERENCE_SALARY.mean} (pre-rounding)\n`);

const show = (title, xs) => {
  console.log(title);
  for (const r of xs) {
    console.log(`  ${r.name.padEnd(24)} $${String(r.salary).padStart(4)}  chart ${String(r.chart$.toFixed(0)).padStart(5)}  conv ${String(r.conv$.toFixed(0)).padStart(5)}  target ${String(r.target$.toFixed(0)).padStart(4)}  defence ${String(r.defence$.toFixed(0)).padStart(5)}`);
  }
};
const by = k => [...rows].sort((a, b) => b[k] - a[k]);
show('top 5 by salary:', by('salary').slice(0, 5));
show('\nmost chart-driven:', by('chart$').slice(0, 3));
show('\nmost conversion-driven:', by('conv$').slice(0, 3));
show('\nmost defence-driven:', by('defence$').slice(0, 3));
show('\nmost defence-negative:', by('defence$').slice(-3).reverse());
