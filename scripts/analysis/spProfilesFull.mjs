// The WHOLE base set's physical profiles in one reviewable list — the
// companion to shaped-profiles-review.csv, which showed only the override
// players. Reads archetype-assignments.json, the record the generator wrote
// at build time, so the list shows the assignment the cards were ACTUALLY
// built with — an earlier draft recomputed it from a parallel EPM lookup and
// drifted by three borderline players (and invented ten "(no EPM)" rows out
// of suffix names like Jimmy Butler III). Sorted by Speed+Power total
// descending. NOTHING is written to card data.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cardgen/cache.js';
import { normalizeName } from '../cardgen/resolveTeams.js';

const GEN = path.join(REPO_ROOT, 'card-data', 'generated');
const cards = JSON.parse(fs.readFileSync(path.join(GEN, 'cards-2026-27.json'), 'utf8')).cards;
const { assignments } = JSON.parse(fs.readFileSync(path.join(GEN, 'archetype-assignments.json'), 'utf8'));
const archBy = new Map(assignments.map(a => [normalizeName(a.name), a]));

const rows = cards.map(c => {
  const a = archBy.get(normalizeName(c.name));
  return {
    name: c.name,
    team: c.team,
    pos: c.pos,
    defTier: a?.tier ?? '(no EPM)',
    offense: a?.offense ?? '',
    shaped: a?.override ? 'YES' : '',
    speed: c.speed,
    power: c.power,
    total: c.speed + c.power,
    defBoost: c.defBoost,
    salary: c.salary,
    epmOff: a?.epmOff?.toFixed(2) ?? '',
    epmDef: a?.epmDef?.toFixed(2) ?? '',
    epmBasis: a?.basis ?? '',
  };
});
rows.sort((a, b) => b.total - a.total || b.salary - a.salary);

const header = 'name,team,pos,defTier,offense,shaped,speed,power,total,defBoost,salary,epmOff,epmDef,epmBasis';
const csv = [header, ...rows.map(r =>
  [`"${r.name}"`, r.team, r.pos, `"${r.defTier}"`, `"${r.offense}"`, r.shaped,
    r.speed, r.power, r.total, r.defBoost, r.salary, r.epmOff, r.epmDef, `"${r.epmBasis}"`].join(',')
)].join('\n');

// Excel holds an exclusive lock on an open CSV (EBUSY) — fall back to a
// numbered name rather than dying, same pattern as salaryAttribution.
let out = path.join(GEN, 'sp-profiles-full.csv');
for (let v = 2; ; v += 1) {
  try {
    fs.writeFileSync(out, `${csv}\n`);
    break;
  } catch (e) {
    if (e.code !== 'EBUSY' || v > 9) throw e;
    out = path.join(GEN, `sp-profiles-full-v${v}.csv`);
  }
}
console.log(`${rows.length} cards -> ${path.relative(REPO_ROOT, out)}`);
console.log('shaped:', rows.filter(r => r.shaped).length, '| no assignment:', rows.filter(r => r.defTier === '(no EPM)').length);
