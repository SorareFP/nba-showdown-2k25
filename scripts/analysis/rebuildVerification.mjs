// The rebuild's measurement battery — run after regenerating cards-2026-27:
//   1. chart calibration vs the 223 published-overlap players (bias + MPG slope)
//   2. the compression quartile table (should flatten vs the synthetic charts)
//   3. spot checks on the season's suspects
//   4. archetype fidelity: stuff% by group and defence$ vs DEF EPM correlation
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache } from '../cardgen/cache.js';
import * as PV from '../cardgen/playValue.js';
import { calcAdv } from '../../src/game/engine.js';
import { CARDS as REF } from '../../src/game/cards.js';

const GEN = path.join(REPO_ROOT, 'card-data', 'generated');
const cards = JSON.parse(fs.readFileSync(path.join(GEN, 'cards-2026-27.json'), 'utf8')).cards;
const idx = JSON.parse(fs.readFileSync(path.join(GEN, 'pool-gamelogs-index.json'), 'utf8'));
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const epmRows = readCache('dunksandthrees-api-season-epm-2026-st2');
const eRows = Array.isArray(epmRows) ? epmRows : epmRows?.data ?? [];
const epmBy = new Map(eRows.map(r => [norm(r.name), r]));
const refBy = new Map(REF.map(c => [norm(c.name), c]));
const mpgBy = new Map(eRows.map(r => [norm(r.name), r.mpg]));

const ev = (c, s) => PV.expectedChartValue(c, 0, s);
const evTot = c => ev(c, 'pts') + ev(c, 'reb') + ev(c, 'ast');

// 1+2: overlap calibration
const overlap = [];
for (const c of cards) {
  const r = refBy.get(norm(c.name));
  if (r?.chart && c.chart) overlap.push({ name: c.name, neu: evTot(c), pub: evTot(r), mpg: mpgBy.get(norm(c.name)) ?? 24, provisional: c.provisional });
}
const real = overlap.filter(o => !o.provisional);
const d = real.map(o => o.neu - o.pub);
const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
console.log(`overlap with published: ${overlap.length} (${real.length} on real logs)`);
console.log(`mean bias (real-log cards, EV/roll pts+reb+ast): ${mean(d).toFixed(2)}`);
// MPG slope of the delta
const xs = real.map(o => Math.log(36 / Math.max(8, o.mpg)));
const mx = mean(xs), md = mean(d);
const slope = real.length > 2
  ? real.reduce((s, o, i) => s + (xs[i] - mx) * (d[i] - md), 0) / real.reduce((s, _, i) => s + (xs[i] - mx) ** 2, 0)
  : 0;
console.log(`delta-vs-log(36/MPG) slope: ${slope.toFixed(2)} (0 = published minutes treatment reproduced)`);

real.sort((a, b) => a.pub - b.pub);
const q = k => real.slice(Math.floor(real.length * k / 4), Math.floor(real.length * (k + 1) / 4));
console.log('\ncompression check (new − published EV/roll by published quartile):');
for (let k = 0; k < 4; k += 1) {
  const s = q(k);
  console.log(`  quartile ${k + 1}: ${mean(s.map(o => o.neu - o.pub)).toFixed(2)}`);
}

// 3: spot checks
console.log('\nspot checks:');
for (const n of ['Nikola Joki', 'Giannis', 'Shai', 'Paul Reed', 'Jonas Valan', 'Luka', 'Kawhi', 'Jamal Murray', 'Trae Young', 'Zach Edey', 'Rudy Gobert']) {
  const c = cards.find(x => norm(x.name).startsWith(norm(n)));
  if (!c) continue;
  console.log(`  ${c.name.padEnd(24)} S${String(c.speed).padStart(2)}/P${String(c.power).padStart(2)} db${String(c.defBoost ?? 0).padStart(2)} $${String(c.salary).padStart(4)}  EVpts ${ev(c, 'pts').toFixed(2)}  ${c.provisional ? 'PROVISIONAL' : 'real-log'}`);
}

// 4: archetype fidelity
const { value, defence } = PV.computePlayValue(cards, { field: cards });
const scale = PV.REFERENCE_SALARY.sd / (PV.sd(value) || 1);
const mDef = mean(defence);
const joined = [];
cards.forEach((c, i) => {
  const e = epmBy.get(norm(c.name));
  if (e) joined.push({ c, def$: (defence[i] - mDef) * scale, epmDef: e.epmDef, epmOff: e.epmOff });
});
const pearson = (a, b) => {
  const ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i += 1) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db);
};
console.log(`\ndefence$ vs DEF EPM r = ${pearson(joined.map(j => j.def$), joined.map(j => j.epmDef)).toFixed(3)} (was 0.623 pre-shaping)`);

const stuffOf = card => {
  let stuffed = 0, seen = 0;
  for (const att of cards) {
    if (att.id === card.id) continue;
    if (calcAdv(att, card).rollBonus <= 0) stuffed += 1;
    seen += 1;
  }
  return stuffed / seen;
};
const over = joined.filter(j => j.epmDef < 0.7 && j.epmOff >= 1.8);
console.log(`override-ish group (epmDef<0.7, epmOff>=1.8): n=${over.length}, avg defence$ ${mean(over.map(j => j.def$)).toFixed(0)}, avg stuff% ${(mean(over.map(j => stuffOf(j.c))) * 100).toFixed(0)}%`);
