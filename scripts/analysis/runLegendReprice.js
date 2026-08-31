/**
 * The 23 legend cards, repriced by what they do in play.
 *
 * They were priced by the linear model, and that model had two coefficients
 * that are simply backwards for a dominant interior scorer:
 *
 *   (18 - shotLine)  +70.76   so a shot line WORSE than the set's worst scores
 *                             negative and subtracts salary
 *   paintBoost       -14.60   so the boost that makes a big man's paint
 *                             attempts land makes his card CHEAPER
 *
 * Shaquille O'Neal's 1999-2000 card is 9 speed / 20 power with a Paint boost of
 * +8 and a shot line of 19, and those two terms dock him about 188 between
 * them. He prints 710 with the third-largest Speed+Power in the group. Tim
 * Duncan (720 at 27) and Charles Barkley (570 at 26) are the same shape.
 *
 * Play value has no opinion about a paint boost as such. It prices what the
 * card produces, and a paint boost produces points through the rebound and
 * assist spends -- so a card that converts is worth more, never less.
 *
 * Priced against the BASE SET on the base set's own value distribution, which
 * is what every other set uses, so these land on one scale with everything
 * else rather than on a scale of their own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cardgen/cache.js';
import { computePlayValue, priceSet } from '../cardgen/playValue.js';
import { roundSalary, SALARY_MIN, SALARY_MAX } from '../cardgen/attributes.js';

const RAW = path.join(REPO_ROOT, 'src', 'game', 'rawCards.js');
const src = fs.readFileSync(RAW, 'utf8');
const rows = JSON.parse(`[${/\[(.*)\]/s.exec(src)[1]}]`);

/** rawCards.js's short keys, widened to the shape every other tool reads. */
export function widen(r) {
  return {
    id: r.id,
    name: r.n,
    team: r.t,
    speed: r.s,
    power: r.p,
    shotLine: r.l,
    paintBoost: r.pb,
    threePtBoost: r.tb,
    defBoost: r.db,
    salary: r.$,
    chart: r.c.map(([lo, hi, pts, reb, ast]) => ({ lo, hi, pts, reb, ast })),
  };
}

const legends = rows.filter(r => r.t === 'RTR').map(widen);

const field = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'card-data', 'generated', 'cards-2026-27.json'), 'utf8')
).cards;
const basis = computePlayValue(field, { field }).value;
const salaries = priceSet(legends, {
  field, basis, roundSalary, min: SALARY_MIN, max: SALARY_MAX,
});
const parts = computePlayValue(legends, { field });

const out = legends.map((c, i) => ({
  name: c.name,
  sp: c.speed + c.power,
  speed: c.speed,
  power: c.power,
  shotLine: c.shotLine,
  paintBoost: c.paintBoost,
  old: c.salary,
  neu: salaries[i],
  delta: salaries[i] - c.salary,
  chart: parts.chart[i],
  conv: parts.conv[i],
  def: parts.defence[i],
}));
out.sort((a, b) => b.delta - a.delta);

const pad = (s, w) => String(s).padEnd(w);
const num = (s, w) => String(s).padStart(w);
console.log(`\n${out.length} legend cards, repriced against the base set\n`);
console.log(`  ${pad('card', 26)}${num('S+P', 4)}${num('line', 5)}${num('pnt', 4)}${num('old', 6)}${num('new', 6)}${num('delta', 7)}${num('chart', 7)}${num('conv', 6)}${num('def', 6)}`);
for (const r of out) {
  console.log(
    `  ${pad(r.name, 26)}${num(r.sp, 4)}${num(r.shotLine, 5)}${num(r.paintBoost, 4)}` +
    `${num(r.old, 6)}${num(r.neu, 6)}${num((r.delta > 0 ? '+' : '') + r.delta, 7)}` +
    `${num(r.chart.toFixed(2), 7)}${num(r.conv.toFixed(2), 6)}${num(r.def.toFixed(2), 6)}`
  );
}
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
console.log(`\n  mean absolute move ${mean(out.map(r => Math.abs(r.delta))).toFixed(0)}`);
console.log(`  biggest riser ${out[0].name} ${out[0].delta > 0 ? '+' : ''}${out[0].delta}`);
console.log(`  biggest faller ${out[out.length - 1].name} ${out[out.length - 1].delta}`);

fs.writeFileSync(
  path.join(REPO_ROOT, 'card-data', 'generated', 'legend-reprice.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), pricedAgainst: 'cards-2026-27', cards: out }, null, 1)}\n`
);
