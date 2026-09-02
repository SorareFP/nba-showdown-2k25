// The matchup-matrix explanation of defence$: for each defender, how the field
// of 353 attackers fares against them (the modern Total Advantages/Neutral
// count), and defence$ split into its two jobs — CHART DENIAL (advantage
// shaving via calcAdv, i.e. pure physicality) and CONVERSION DENIAL (the
// defBoost contest on checks). Aggregated by archetype group, this shows
// exactly how the elite-offense override group collects elite-defender money.
import fs from 'node:fs';
import path from 'node:path';
import csvParse from 'node:util';
import { REPO_ROOT } from '../cardgen/cache.js';
import * as PV from '../cardgen/playValue.js';
import { calcAdv } from '../../src/game/engine.js';

const GEN = path.join(REPO_ROOT, 'card-data', 'generated');
const cards = JSON.parse(fs.readFileSync(path.join(GEN, 'cards-2026-27.json'), 'utf8')).cards;

// archetype labels from the prototype CSV
const archRows = fs.readFileSync(path.join(GEN, 'modern-archetypes-v1.csv'), 'utf8').trim().split('\n').slice(1);
const archBy = new Map();
for (const line of archRows) {
  const m = line.match(/^"([^"]+)",[^,]*,"([^"]+)"/);
  if (m) archBy.set(m[1], m[2]);
}

// replicate playValue's defence internals with the two terms separated
const { value } = PV.computePlayValue(cards, { field: cards });
const scale = PV.REFERENCE_SALARY.sd / (PV.sd(value) || 1);
const medianOf = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fieldContest = medianOf(cards.map(PV.contestOf));
const fieldHit3 = medianOf(cards.map(c => PV.hitProb(c, 'threePtBoost', fieldContest)));
const fieldHitPaint = medianOf(cards.map(c => PV.hitProb(c, 'paintBoost', fieldContest)));
const byDef = cards.map((c, i) => [c.speed + c.power + (c.defBoost ?? 0), i]).sort((a, b) => a[0] - b[0]);
const medianDef = cards[byDef[Math.floor(byDef.length / 2)][1]];

const convThrough = (att, def) => {
  const b = calcAdv(att, def).rollBonus;
  const c = PV.contestOf(def);
  const p3 = (att.threePtBoost ?? 0) > 0 ? PV.hitProb(att, 'threePtBoost', c) : fieldHit3;
  const pp = (att.paintBoost ?? 0) > 0 ? PV.hitProb(att, 'paintBoost', c) : fieldHitPaint;
  return PV.expectedChartValue(att, b, 'ast') * (3 / 4) * p3
       + PV.expectedChartValue(att, b, 'reb') * pp;
};

const rows = cards.map(card => {
  let chartDenial = 0, convDenial = 0, stuffed = 0, conceded = 0, seen = 0;
  for (const att of cards) {
    if (att.id === card.id) continue;
    const adv = calcAdv(att, card);
    if (adv.rollBonus <= 0) stuffed += 1;
    conceded += Math.max(0, adv.rollBonus);
    chartDenial += PV.expectedChartValue(att, calcAdv(att, medianDef).rollBonus, 'pts')
                 - PV.expectedChartValue(att, adv.rollBonus, 'pts');
    convDenial += convThrough(att, medianDef) - convThrough(att, card);
    seen += 1;
  }
  return {
    name: card.name, arch: archBy.get(card.name) ?? 'unmatched',
    stuffPct: stuffed / seen, conceded: conceded / seen,
    chartDenial$: (chartDenial / seen) * scale, convDenial$: (convDenial / seen) * scale,
  };
});

const groups = [
  ['Elite defender tier', r => r.arch.startsWith('Elite defender')],
  ['Great defender tier', r => r.arch.startsWith('Great defender')],
  ['Good defender tier', r => r.arch.startsWith('Good defender')],
  ['OVERRIDE: sub-Good D + elite offense', r => r.arch.includes('elite offense')
    && !/^(Elite|Great|Good) defender/.test(r.arch)],
  ['Awful defender tier', r => r.arch.startsWith('Awful defender')],
];

console.log('group                                  stuff%  concededBonus  chartDenial$  convDenial$');
for (const [label, pred] of groups) {
  const g = rows.filter(pred);
  const m = k => g.reduce((s, r) => s + r[k], 0) / g.length;
  console.log(
    label.padEnd(38),
    (m('stuffPct') * 100).toFixed(0).padStart(5) + '%',
    m('conceded').toFixed(2).padStart(12),
    m('chartDenial$').toFixed(0).padStart(12),
    m('convDenial$').toFixed(0).padStart(12),
    ` (n=${g.length})`
  );
}
console.log('\nthe override fourteen, individually:');
for (const r of rows.filter(groups[3][1]).sort((a, b) => b.chartDenial$ - a.chartDenial$)) {
  console.log(' ', r.name.padEnd(24), 'stuffs', (r.stuffPct * 100).toFixed(0) + '% of attackers,',
    'chartDenial$', String(r.chartDenial$.toFixed(0)).padStart(4) + ',',
    'convDenial$', String(r.convDenial$.toFixed(0)).padStart(4));
}
