// The original archetype system, reborn on modern data: defensive tiers from
// epmDef (the Combined D analog), offense qualifiers from epmOff (the Combined
// diff analog). Tier SHARES mirror the recovered 344-player original
// (Elite ~6%, Great ~6%, Good ~12%, Awful ~3%...), so the cutoffs adapt to the
// pool's distribution instead of transplanting cross-scale constants.
// PROTOTYPE — assigns labels only; no card is touched.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cardgen/cache.js';
import { readCache } from '../cardgen/cache.js';

const cards = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'card-data/generated/cards-2026-27.json'), 'utf8')).cards;
const epmRows = readCache('dunksandthrees-api-season-epm-2026-st2');
const rows = Array.isArray(epmRows) ? epmRows : epmRows?.data ?? [];
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const epmBy = new Map(rows.map(r => [norm(r.name), r]));

const joined = cards.map(c => {
  const e = epmBy.get(norm(c.name));
  return e && e.epmDef != null ? {
    name: c.name, team: c.team, speed: c.speed, power: c.power, defBoost: c.defBoost ?? 0,
    salary: c.salary, epmOff: e.epmOff, epmDef: e.epmDef, mpg: e.mpg, games: e.games,
  } : null;
}).filter(Boolean);

// Defensive tiers by pool percentile, shares mirroring the original's 344.
const byDef = [...joined].sort((a, b) => b.epmDef - a.epmDef);
const n = byDef.length;
const share = { elite: 0.058, great: 0.061, good: 0.122, avg: 0.55, slneg: 0.067, bad: 0.075 };
const cut = k => byDef[Math.min(n - 1, Math.floor(n * k))].epmDef;
let acc = 0;
const cuts = {};
for (const [k, s] of Object.entries(share)) { acc += s; cuts[k] = cut(acc); }

function defTier(d) {
  if (d >= cuts.elite) return 'Elite defender';
  if (d >= cuts.great) return 'Great defender';
  if (d >= cuts.good) return 'Good defender';
  if (d >= cuts.avg) return 'Average defender';
  if (d >= cuts.slneg) return 'Slightly negative defender';
  if (d >= cuts.bad) return 'Bad defender';
  return 'Awful defender';
}

// Offense qualifiers — epmOff thresholds by pool percentile: elite = top 5%,
// very good = top 15%, above average = top 35% of offensive impact.
const byOff = [...joined].sort((a, b) => b.epmOff - a.epmOff);
const offElite = byOff[Math.floor(n * 0.05)].epmOff;
const offVG = byOff[Math.floor(n * 0.15)].epmOff;
const offAA = byOff[Math.floor(n * 0.35)].epmOff;

function label(p) {
  const t = defTier(p.epmDef);
  const positive = ['Elite defender', 'Great defender', 'Good defender'].includes(t);
  if (positive) {
    // A two-way monster earns the note, like the original's Jokic/SGA rows.
    if (p.epmOff >= offElite) return `${t}, elite offense`;
    return t;
  }
  if (p.epmOff >= offElite) return `${t}, elite offense`;
  if (p.epmOff >= offVG) return `${t}, very good offense`;
  if (p.epmOff >= offAA) return `${t}, above average offense`;
  return t;
}

for (const p of joined) p.archetype = label(p);

console.log('cutoffs: epmDef', Object.entries(cuts).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' '),
  '| epmOff elite/vg/aa =', offElite.toFixed(2), offVG.toFixed(2), offAA.toFixed(2));
const counts = new Map();
for (const p of joined) counts.set(p.archetype, (counts.get(p.archetype) || 0) + 1);
console.log('\ntier counts:');
for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(' ', String(v).padStart(3), k);

const order = ['Elite defender', 'Great defender', 'Good defender', 'Average defender',
  'Slightly negative defender', 'Bad defender', 'Awful defender'];
const csv = ['name,team,archetype,epmOff,epmDef,mpg,games,speed,power,defBoost,salary'];
for (const base of order) {
  const grp = joined.filter(p => p.archetype.startsWith(base)).sort((a, b) => b.epmDef - a.epmDef);
  for (const p of grp) {
    csv.push(`"${p.name}",${p.team},"${p.archetype}",${p.epmOff.toFixed(2)},${p.epmDef.toFixed(2)},${p.mpg.toFixed(1)},${p.games},${p.speed},${p.power},${p.defBoost},${p.salary}`);
  }
}
let out;
for (let v = 1; v < 10; v += 1) {
  out = path.join(REPO_ROOT, 'card-data', 'generated', `modern-archetypes-v${v}.csv`);
  try { fs.writeFileSync(out, csv.join('\n') + '\n'); break; }
  catch (e) { if (e.code !== 'EBUSY') throw e; out = null; }
}
console.log('\nwrote', out, `(${joined.length} players; ${cards.length - joined.length} unmatched to EPM)`);

// The eyeball samples.
for (const base of order) {
  const grp = joined.filter(p => p.archetype.startsWith(base)).sort((a, b) => b.epmDef - a.epmDef);
  console.log(`\n${base} (${grp.length}):`);
  console.log('  ' + grp.slice(0, 8).map(p => p.name + (p.archetype.includes(',') ? '*' : '')).join(', ') + (grp.length > 8 ? ', …' : ''));
}
