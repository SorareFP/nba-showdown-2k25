/**
 * What roll a card actually experiences, as opposed to what the die shows.
 *
 * THE PREMISE THE CHART IS BUILT ON IS WRONG, and this is the measurement that
 * says so. `computeStatBands` cuts its bands at percentiles of a bare d20 --
 * roll 1 is the 5th percentile, roll 10 the 50th, roll 20 the 100th -- and the
 * chart is then read at `die + rollBonus`. Those are different distributions.
 * The bands describe one and the game plays the other, so a card's realised
 * output is systematically higher than the per-four-minute rate the bands were
 * cut to reproduce.
 *
 * So: measure the bonus a card actually receives across the whole field, con-
 * volve it with the die, and report where the chart's boundaries fall on the
 * EFFECTIVE roll. That is the distribution the bands should have been cut on,
 * and the gap between the two is the size of the correction.
 *
 * Reports per player as well as in aggregate, because the bonus is not the same
 * for everyone -- a 30 Speed+Power card lives in a different distribution from
 * a 6, which is the whole point of the matchup system and the reason a single
 * league-wide correction would be wrong.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cardgen/cache.js';
import { calcAdv } from '../../src/game/engine.js';

const SET = process.argv[2] ?? path.join(REPO_ROOT, 'card-data', 'generated', 'cards-2026-27.json');
const cards = JSON.parse(fs.readFileSync(SET, 'utf8')).cards;

const mean = xs => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];

// Every ordered matchup's roll bonus, and each attacker's own distribution.
const perPlayer = cards.map(() => []);
const all = [];
for (let i = 0; i < cards.length; i += 1) {
  for (let j = 0; j < cards.length; j += 1) {
    if (i === j) continue;
    const b = calcAdv(cards[i], cards[j]).rollBonus;
    perPlayer[i].push(b);
    all.push(b);
  }
}
all.sort((a, b) => a - b);

const hist = new Map();
for (const b of all) hist.set(b, (hist.get(b) ?? 0) + 1);

console.log(`\n${cards.length} cards, ${all.length.toLocaleString()} ordered matchups\n`);
console.log('── THE ROLL BONUS, ACROSS THE WHOLE FIELD ─────────────────────────────');
console.log(`  mean ${mean(all).toFixed(2)}   median ${quantile(all, 0.5)}   ` +
  `p25 ${quantile(all, 0.25)}   p75 ${quantile(all, 0.75)}   p90 ${quantile(all, 0.9)}   max ${all[all.length - 1]}`);
console.log(`  advantage ${(100 * all.filter(b => b > 0).length / all.length).toFixed(1)}%   ` +
  `neutral ${(100 * all.filter(b => b === 0).length / all.length).toFixed(1)}%   ` +
  `penalty ${(100 * all.filter(b => b < 0).length / all.length).toFixed(1)}%`);

console.log('\n── EFFECTIVE ROLL: what the chart is actually read at ─────────────────');
// P(effective roll = r), die uniform on 1..20, bonus from the measured field,
// clamped the way the engine clamps it.
const eff = new Map();
for (const [b, n] of hist) {
  for (let die = 1; die <= 20; die += 1) {
    const r = Math.max(1, Math.min(die + b, 99));
    eff.set(r, (eff.get(r) ?? 0) + n);
  }
}
const total = [...eff.values()].reduce((s, v) => s + v, 0);
const rolls = [...eff.keys()].sort((a, b) => a - b);
let cum = 0;
const cumAt = new Map();
for (const r of rolls) {
  cum += eff.get(r) / total;
  cumAt.set(r, cum);
}
console.log(`  ${'roll'.padStart(5)}${'share'.padStart(9)}${'cumulative'.padStart(12)}   ${'bare d20 cumulative'.padStart(20)}`);
for (const r of rolls) {
  const share = eff.get(r) / total;
  if (share < 0.004) continue;
  const bare = r >= 1 && r <= 20 ? r / 20 : r > 20 ? 1 : 0;
  console.log(`  ${String(r).padStart(5)}${(100 * share).toFixed(1).padStart(8)}%` +
    `${(100 * cumAt.get(r)).toFixed(1).padStart(11)}%${(100 * bare).toFixed(1).padStart(20)}%`);
}

console.log('\n── WHERE THE CHART CUTS, AND WHERE IT LANDS ───────────────────────────');
console.log('  A band cut at the Nth percentile of a BARE d20 is read at a very');
console.log('  different percentile of the effective roll. That gap is the error.\n');
console.log(`  ${'chart boundary'.padStart(16)}${'bare d20 %ile'.padStart(15)}${'effective %ile'.padStart(16)}${'drift'.padStart(9)}`);
for (const lo of [3, 5, 11, 14, 18, 21, 24]) {
  const bare = 100 * ((lo - 1) / 20);
  const e = 100 * (cumAt.get(lo - 1) ?? (lo > 20 ? 1 : 0));
  console.log(`  ${`opens at ${lo}`.padStart(16)}${bare.toFixed(1).padStart(14)}%${e.toFixed(1).padStart(15)}%${(e - bare).toFixed(1).padStart(9)}`);
}

console.log('\n── AND IT IS NOT THE SAME FOR EVERYONE ────────────────────────────────');
const rows = cards.map((c, i) => {
  const s = perPlayer[i].slice().sort((a, b) => a - b);
  return { name: c.name, sp: c.speed + c.power, mean: mean(s), med: quantile(s, 0.5), p90: quantile(s, 0.9) };
});
rows.sort((a, b) => b.mean - a.mean);
console.log(`  ${'player'.padEnd(24)}${'S+P'.padStart(5)}${'mean'.padStart(7)}${'median'.padStart(8)}${'p90'.padStart(6)}`);
for (const r of [...rows.slice(0, 5), null, ...rows.slice(Math.floor(rows.length / 2) - 1, Math.floor(rows.length / 2) + 2), null, ...rows.slice(-4)]) {
  if (!r) { console.log(`  ${'…'.padEnd(24)}`); continue; }
  console.log(`  ${r.name.padEnd(24)}${String(r.sp).padStart(5)}${r.mean.toFixed(2).padStart(7)}${String(r.med).padStart(8)}${String(r.p90).padStart(6)}`);
}
console.log(`\n  a ceiling card sits ${(rows[0].mean - rows[rows.length - 1].mean).toFixed(2)} rolls above a floor card, every roll of the game.`);
