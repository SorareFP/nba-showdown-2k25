/**
 * The 23 legend cards, rebuilt on the section chart model.
 *
 * Their charts are the last hand-made ones in the project. Every other set now
 * comes from the four-minute event model, and the difference is not small: a
 * legend's top tier averages 4.0 points and peaks at 6, where the top 23 base
 * cards average 7.7. That gap is why `runLegendReprice.js` could not be trusted
 * on its FALLERS -- LeBron -380, Robinson -380, Bird -360 are all high
 * Speed+Power cards whose OLD chart cannot pay off, and some of that is the
 * chart being old rather than the card being overpriced.
 *
 * So this rebuilds them the way every other card is built, through the shipped
 * `buildSet`, and reprices on the same basis. Nine of the twenty-three predate
 * the cached tables and their seasons were fetched for this (1976, 1977, 1985,
 * 1988, 1990, 1993, 1994, 1997).
 *
 * A LEGEND IS ONLY REBUILT WHERE THERE IS DATA TO REBUILD IT FROM. EPM begins
 * in 2002 and the Speed+Power composite runs on it, so a 1988 season has no
 * budget to spend and the generator prices it at replacement -- Michael Jordan
 * came out at Speed+Power 14. Rather than print that, the nine pre-2002 cards
 * are PORTED: their hand-made attributes and chart carry over untouched.
 *
 * They are still REPRICED, and that is not a contradiction. Play value reads
 * the finished card -- its Speed+Power, its chart, its boosts -- and never
 * touches EPM, which is only needed to GENERATE a budget. So a ported card
 * lands on the same salary scale as everything else.
 *
 * NOT WRITTEN TO A SET FILE. The 25-26 cards are printed and physical; this
 * reports what they WOULD be so the comparison can be judged before anything
 * is committed to.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache } from '../cardgen/cache.js';
import { buildSet, resolvePlayerIds } from '../cardgen/generateSpecialSets.js';
import { CALIBRATION_FILE } from '../cardgen/calibrateAttributes.js';
import { indexBiometrics, loadBiometrics } from '../cardgen/biometrics.js';
import { indexPositionShares, loadPositionShares } from '../cardgen/positionShares.js';
import { computePlayValue, priceSet } from '../cardgen/playValue.js';
import { roundSalary, SALARY_MIN, SALARY_MAX } from '../cardgen/attributes.js';
import { normalizeName } from '../cardgen/resolveTeams.js';

const LAST_SEASON = 2026;
const calibration = JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'));
const archiveRows = readCache('bbref-history')?.data?.rows ?? [];
const pool = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'card-data', 'generated', 'player-pool-2026.json'), 'utf8')
);

/** The 23 legends, read off the finished set: team RTR, season in the name. */
const raw = JSON.parse(
  `[${/\[(.*)\]/s.exec(fs.readFileSync(path.join(REPO_ROOT, 'src', 'game', 'rawCards.js'), 'utf8'))[1]}]`
);
const legends = raw
  .filter(r => r.t === 'RTR')
  .map(r => {
    const m = /^(\d{2})-(\d{2})\s+(.*)$/.exec(r.n);
    const yy = Number(m[2]);
    return {
      label: r.n,
      name: m[3],
      season: yy < 50 ? 2000 + yy : 1900 + yy,
      old: { salary: r.$, speed: r.s, power: r.p, chart: r.c },
    };
  });

// Season rows, from the cached full-league tables.
const perPoss = new Map();
const advanced = new Map();
for (const season of [...new Set(legends.map(l => l.season))]) {
  for (const [kind, target] of [['perPoss', perPoss], ['advanced', advanced]]) {
    let cached;
    try { cached = readCache(`bbref-${season}-${kind}-full`); } catch { continue; }
    const rows = Array.isArray(cached) ? cached : cached?.rows ?? cached?.data ?? [];
    for (const r of rows) target.set(`${normalizeName(r.name)}|${season}`, { ...r, season });
  }
}

// EPM, from the API caches — the history archive covers only the 350 pool.
const epm = new Map();
for (let season = 2002; season <= LAST_SEASON; season += 1) {
  let cached;
  try { cached = readCache(`dunksandthrees-api-season-epm-${season}-st2`); } catch { continue; }
  // readCache already unwraps `.data` — it hands back the array. Reading
  // `cached.data` built an EMPTY index and sent every legend to replacement
  // level, printing Speed+Power 14 for Curry's 2016.
  for (const r of (Array.isArray(cached) ? cached : cached?.data ?? [])) {
    epm.set(`${normalizeName(r.name)}|${season}`, { epm: r.epm, ewinsPerGame: r.ewinsPerGame });
  }
}

const currentByName = new Map();
for (const row of archiveRows) {
  if (row.season !== LAST_SEASON) continue;
  const prev = currentByName.get(row.playerId);
  if (!prev || (row.games ?? 0) > (prev.games ?? 0)) currentByName.set(row.playerId, row);
}
const poolIds = new Set(resolvePlayerIds(pool, archiveRows).ids.values());
const currentRows = [...currentByName.values()].filter(r => poolIds.has(r.playerId));

/** rawCards.js's short keys, widened to the shape every other tool reads. */
function widen(r, label) {
  return {
    id: r.id, name: label, team: r.t,
    speed: r.s, power: r.p, shotLine: r.l,
    paintBoost: r.pb, threePtBoost: r.tb, defBoost: r.db,
    chart: r.c.map(([lo, hi, pts, reb, ast]) => ({ lo, hi, pts, reb, ast })),
  };
}

const selections = [];
const meta = [];
const ported = [];
for (const L of legends) {
  const key = `${normalizeName(L.name)}|${L.season}`;
  const adv = advanced.get(key);
  const pp = perPoss.get(key);
  const e = epm.get(key);
  // No EPM means no Speed+Power budget, and no season row means no chart. Both
  // are the same answer: keep the card that exists.
  if (!adv || !pp || !Number.isFinite(e?.epm)) {
    ported.push(L);
    continue;
  }
  selections.push({
    player: { name: L.name, pos: adv.pos },
    season: { ...adv, ...pp, season: L.season, playerId: adv.playerId, ...e },
  });
  meta.push(L);
}

const rebuilt = buildSet({ selections, currentRows, calibration, biometrics: indexBiometrics(loadBiometrics()), positionShares: indexPositionShares(loadPositionShares()) });
const portedCards = ported.map(L => widen(raw.find(r => r.n === L.label), L.label));
const cards = [...rebuilt, ...portedCards];
const all = [...meta.map(m => ({ ...m, rebuilt: true })), ...ported.map(m => ({ ...m, rebuilt: false }))];

const field = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'card-data', 'generated', 'cards-2026-27.json'), 'utf8')
).cards;
const basis = computePlayValue(field, { field }).value;
const salaries = priceSet(cards, { field, basis, roundSalary, min: SALARY_MIN, max: SALARY_MAX });

const ev = chart => {
  let t = 0;
  for (let r = 1; r <= 20; r += 1) {
    for (const b of chart) if (b.lo <= r && r <= b.hi) { t += b.pts; break; }
  }
  return t / 20;
};
const evOld = c => {
  let t = 0;
  for (let r = 1; r <= 20; r += 1) {
    const b = c.find(x => x[0] <= r && r <= x[1]) ?? c[c.length - 1];
    t += b[2];
  }
  return t / 20;
};

const rows = cards.map((c, i) => ({
  label: all[i].label,
  rebuilt: all[i].rebuilt,
  oldSP: all[i].old.speed + all[i].old.power,
  newSP: c.speed + c.power,
  oldSal: all[i].old.salary,
  newSal: salaries[i],
  oldEV: evOld(all[i].old.chart),
  newEV: ev(c.chart),
  oldTop: Math.max(...all[i].old.chart.map(t => t[2])),
  newTop: c.chart[c.chart.length - 1].pts,
  opens: c.chart[c.chart.length - 1].lo,

}));
rows.sort((a, b) => b.newSal - a.newSal);

const pad = (s, w) => String(s).padEnd(w);
const num = (s, w) => String(s).padStart(w);
console.log(`
${rows.length} legend cards: ${rebuilt.length} rebuilt on the section model, ${portedCards.length} ported unchanged (no EPM before 2002)`);
console.log(`\n  ${pad('card', 26)}${num('S+P', 9)}${num('chart EV', 13)}${num('top tier', 12)}${num('salary', 14)}`);
console.log(`  ${pad('', 26)}${num('old  new', 9)}${num('old   new', 13)}${num('old  new', 12)}${num('old   new', 14)}`);
for (const r of rows) {
  console.log(
    `  ${pad(r.label, 26)}${num(`${r.oldSP}`, 4)}${num(`${r.newSP}`, 5)}` +
    `${num(r.oldEV.toFixed(2), 7)}${num(r.newEV.toFixed(2), 6)}` +
    `${num(r.oldTop, 6)}${num(`${r.newTop}@${r.opens}`, 6)}` +
    `${num(r.oldSal, 8)}${num(r.newSal, 6)}${r.rebuilt ? '' : '   PORTED'}`
  );
}
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
console.log(`\n  chart EV   old ${mean(rows.map(r => r.oldEV)).toFixed(2)} -> new ${mean(rows.map(r => r.newEV)).toFixed(2)}`);
console.log(`  top tier   old ${mean(rows.map(r => r.oldTop)).toFixed(1)} -> new ${mean(rows.map(r => r.newTop)).toFixed(1)}`);
console.log(`  salary     old ${mean(rows.map(r => r.oldSal)).toFixed(0)} -> new ${mean(rows.map(r => r.newSal)).toFixed(0)}`);

fs.writeFileSync(
  path.join(REPO_ROOT, 'card-data', 'generated', 'legend-charts-rebuilt.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), note: 'PROPOSED, not shipped — the 25-26 legend cards are printed.', cards: cards.map((c, i) => ({ ...c, label: all[i].label, rebuilt: all[i].rebuilt, salary: salaries[i] })) }, null, 1)}\n`
);
