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

// Chart split: the chart channel is EV(pts per roll) averaged over every
// matchup's roll bonus. Its two real parts are the chart ITSELF (EV at
// bonus 0 — what the card produces on neutral footing) and the MATCHUP LIFT
// (what Speed/Power bonuses add on top, averaged over the field). They sum
// to the chart channel exactly.
const neutral = cards.map(c => PV.expectedChartValue(c, 0, 'pts'));
const lift = chart.map((v, i) => v - neutral[i]);

const ch = { chart, neutral, lift, conv, target, defence };
const chMean = Object.fromEntries(Object.entries(ch).map(([k, xs]) => [k, PV.mean(xs)]));

const rows = cards.map((c, i) => ({
  name: c.name,
  team: c.team,
  salary: c.salary,
  defBoost: c.defBoost ?? 0,
  chart$: (chart[i] - chMean.chart) * scale,
  chartNeutral$: (neutral[i] - chMean.neutral) * scale,
  chartLift$: (lift[i] - chMean.lift) * scale,
  conv$: (conv[i] - chMean.conv) * scale,
  target$: (target[i] - chMean.target) * scale,
  targetRaw: target[i],
  defence$: (defence[i] - chMean.defence) * scale,
}));

const csv = ['name,team,salary,defBoost,chart$,chartNeutral$,chartLift$,conv$,target$,defence$']
  .concat(rows.map(r =>
    `"${r.name}",${r.team},${r.salary},${r.defBoost},${r.chart$.toFixed(0)},${r.chartNeutral$.toFixed(0)},${r.chartLift$.toFixed(0)},${r.conv$.toFixed(0)},${r.target$.toFixed(0)},${r.defence$.toFixed(0)}`))
  .join('\n');
const out = path.join(REPO_ROOT, 'card-data', 'generated', 'salary-attribution-v2.csv');
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

// The target channel is quantized: hitProb moves in 1/20 steps, so the edge
// over the field median comes in nickels. Show the whole distribution.
const targetDist = new Map();
for (const r of rows) {
  const k = r.target$.toFixed(0);
  targetDist.set(k, (targetDist.get(k) || 0) + 1);
}
console.log('\ntarget$ distribution (value: count):');
console.log('  ' + [...targetDist.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, n]) => `${k}: ${n}`).join('   '));
const targeted = rows.filter(r => r.targetRaw > 0).sort((a, b) => b.target$ - a.target$);
console.log(`\ncards with a real targeting edge (${targeted.length}):`);
for (const r of targeted.slice(0, 12)) console.log(`  ${r.name.padEnd(24)} target$ ${r.target$.toFixed(0)}`);

console.log('\nchart split for the earlier suspects (neutral = chart at bonus 0, lift = Speed/Power matchup bonuses):');
for (const name of ['Paul Reed', 'Jonas Valan', 'Nikola Joki', 'Giannis', 'Shai', 'Luka']) {
  const r = rows.find(x => x.name.startsWith(name));
  if (r) console.log(`  ${r.name.padEnd(24)} chart$ ${String(r.chart$.toFixed(0)).padStart(5)} = neutral ${String(r.chartNeutral$.toFixed(0)).padStart(5)} + lift ${String(r.chartLift$.toFixed(0)).padStart(5)}`);
}
