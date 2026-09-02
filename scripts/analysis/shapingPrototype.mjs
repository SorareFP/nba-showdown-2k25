// Prototype of the archetype shaping levers, measured — NO card files touched.
//
// Lever A (RESPLIT): offense-override players keep their S+P total but the
// split pushes to their natural physical axis (~72/28), opening the other
// lane — the Kyrie S18/P9 move.
// Lever B (BUDGET): their total also shrinks, from a def-led blend
// (epmDef + 0.35*epmOff) quantile-mapped onto the pool's existing S+P
// distribution — "shit S+P", offense lives in the chart.
// defBoost stays = rounded DEF EPM in both (the equalizer, neutralize-only).
//
// Measured per scenario: the override group's stuff% (share of attackers
// with no advantage), defence$ vs DEF EPM correlation, and named before/after.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache } from '../cardgen/cache.js';
import * as PV from '../cardgen/playValue.js';
import { calcAdv } from '../../src/game/engine.js';

const GEN = path.join(REPO_ROOT, 'card-data', 'generated');
const base = JSON.parse(fs.readFileSync(path.join(GEN, 'cards-2026-27.json'), 'utf8')).cards;
const epmRows = readCache('dunksandthrees-api-season-epm-2026-st2');
const eRows = Array.isArray(epmRows) ? epmRows : epmRows?.data ?? [];
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const epmBy = new Map(eRows.map(r => [norm(r.name), r]));

const archLines = fs.readFileSync(path.join(GEN, 'modern-archetypes-v1.csv'), 'utf8').trim().split('\n').slice(1);
const archBy = new Map();
for (const line of archLines) {
  const m = line.match(/^"([^"]+)",[^,]*,"([^"]+)"/);
  if (m) archBy.set(m[1], m[2]);
}
const isOverride = a => a && /offense/.test(a) && !/^(Elite|Great|Good) defender/.test(a);

// quantile map: value in dist1 -> same-rank value in dist2
const totals = base.map(c => c.speed + c.power).sort((a, b) => a - b);
const q = p => totals[Math.min(totals.length - 1, Math.floor(p * totals.length))];

function scenario(kind) {
  return base.map(c => {
    const a = archBy.get(c.name);
    const e = epmBy.get(norm(c.name));
    if (!isOverride(a) || !e) return { ...c };
    let total = c.speed + c.power;
    if (kind === 'B') {
      const blend = x => x.epmDef + 0.35 * x.epmOff;
      const mine = blend(e);
      const all = eRows.filter(r => r.minutes > 400).map(blend).sort((x, y) => x - y);
      const rank = all.findIndex(v => v >= mine) / all.length;
      total = q(rank);
    }
    // natural axis from the current split; push to 72/28 of the (possibly new) total
    const speedNatural = c.speed >= c.power;
    let s = Math.round(total * (speedNatural ? 0.72 : 0.28));
    let p = total - s;
    return { ...c, speed: s, power: p };
  });
}

function measure(cards, label) {
  const byName = new Map(cards.map(c => [c.name, c]));
  const { value, defence } = PV.computePlayValue(cards, { field: cards });
  const scale = PV.REFERENCE_SALARY.sd / (PV.sd(value) || 1);
  const mDef = PV.mean(defence);

  const joined = [];
  cards.forEach((c, i) => {
    const e = epmBy.get(norm(c.name));
    if (e) joined.push({ name: c.name, def$: (defence[i] - mDef) * scale, epmDef: e.epmDef, arch: archBy.get(c.name) });
  });
  const pearson = (xs, ys) => {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
    return num / Math.sqrt(dx * dy);
  };
  const corr = pearson(joined.map(j => j.def$), joined.map(j => j.epmDef));

  const ov = joined.filter(j => isOverride(j.arch));
  const stuffOf = name => {
    const card = byName.get(name);
    let stuffed = 0, seen = 0;
    for (const att of cards) {
      if (att.id === card.id) continue;
      if (calcAdv(att, card).rollBonus <= 0) stuffed += 1;
      seen += 1;
    }
    return stuffed / seen;
  };
  const elite = joined.filter(j => j.arch?.startsWith('Elite defender'));
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`\n[${label}] defence$ vs DEF EPM r = ${corr.toFixed(3)}`);
  console.log(`  override group avg defence$ ${mean(ov.map(j => j.def$)).toFixed(0)} | elite tier avg ${mean(elite.map(j => j.def$)).toFixed(0)}`);
  const names = ['Luka Dončić', 'Kawhi Leonard', 'Nikola Jokić', 'Stephen Curry', 'Jamal Murray', 'Trae Young'];
  for (const n of names) {
    const c = byName.get(n);
    const j = joined.find(x => x.name === n);
    if (c && j) console.log(`  ${n.padEnd(18)} S${c.speed}/P${c.power}  stuff ${(stuffOf(n) * 100).toFixed(0)}%  defence$ ${j.def$.toFixed(0)}`);
  }
}

measure(base, 'BASELINE');
measure(scenario('A'), 'A: resplit only (total kept)');
measure(scenario('B'), 'B: resplit + def-led budget');
