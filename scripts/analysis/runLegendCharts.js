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

const selections = [];
const meta = [];
const missing = [];
for (const L of legends) {
  const key = `${normalizeName(L.name)}|${L.season}`;
  const adv = advanced.get(key);
  const pp = perPoss.get(key);
  if (!adv || !pp) { missing.push(`${L.label} (${!adv ? 'no advanced' : 'no perPoss'})`); continue; }
  const e = epm.get(key) ?? { epm: null, ewinsPerGame: null };
  selections.push({
    player: { name: L.name, pos: adv.pos },
    season: { ...adv, ...pp, season: L.season, playerId: adv.playerId, ...e },
  });
  meta.push(L);
}

const cards = buildSet({ selections, currentRows, calibration, biometrics: indexBiometrics(loadBiometrics()), positionShares: indexPositionShares(loadPositionShares()) });

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
  label: meta[i].label,
  oldSP: meta[i].old.speed + meta[i].old.power,
  newSP: c.speed + c.power,
  oldSal: meta[i].old.salary,
  newSal: salaries[i],
  oldEV: evOld(meta[i].old.chart),
  newEV: ev(c.chart),
  oldTop: Math.max(...meta[i].old.chart.map(t => t[2])),
  newTop: c.chart[c.chart.length - 1].pts,
  opens: c.chart[c.chart.length - 1].lo,
  hadEpm: Number.isFinite(selections[i].season.epm),
}));
rows.sort((a, b) => b.newSal - a.newSal);

const pad = (s, w) => String(s).padEnd(w);
const num = (s, w) => String(s).padStart(w);
console.log(`\n${rows.length} legend cards rebuilt on the section model` + (missing.length ? `, ${missing.length} skipped` : ''));
if (missing.length) console.log(`  skipped: ${missing.join(', ')}`);
console.log(`\n  ${pad('card', 26)}${num('S+P', 9)}${num('chart EV', 13)}${num('top tier', 12)}${num('salary', 14)}`);
console.log(`  ${pad('', 26)}${num('old  new', 9)}${num('old   new', 13)}${num('old  new', 12)}${num('old   new', 14)}`);
for (const r of rows) {
  console.log(
    `  ${pad(r.label, 26)}${num(`${r.oldSP}`, 4)}${num(`${r.newSP}`, 5)}` +
    `${num(r.oldEV.toFixed(2), 7)}${num(r.newEV.toFixed(2), 6)}` +
    `${num(r.oldTop, 6)}${num(`${r.newTop}@${r.opens}`, 6)}` +
    `${num(r.oldSal, 8)}${num(r.newSal, 6)}${r.hadEpm ? '' : '   no EPM'}`
  );
}
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
console.log(`\n  chart EV   old ${mean(rows.map(r => r.oldEV)).toFixed(2)} -> new ${mean(rows.map(r => r.newEV)).toFixed(2)}`);
console.log(`  top tier   old ${mean(rows.map(r => r.oldTop)).toFixed(1)} -> new ${mean(rows.map(r => r.newTop)).toFixed(1)}`);
console.log(`  salary     old ${mean(rows.map(r => r.oldSal)).toFixed(0)} -> new ${mean(rows.map(r => r.newSal)).toFixed(0)}`);

fs.writeFileSync(
  path.join(REPO_ROOT, 'card-data', 'generated', 'legend-charts-rebuilt.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), note: 'PROPOSED, not shipped — the 25-26 legend cards are printed.', cards: cards.map((c, i) => ({ ...c, label: meta[i].label, salary: salaries[i] })) }, null, 1)}\n`
);
