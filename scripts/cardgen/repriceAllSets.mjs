// Reprice every generated set's salaries in place under the current playValue
// model (defBoost contest edition). Charts, photos, badges, everything else in
// the set files is untouched; the 2025-26 reference set is never repriced.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './cache.js';
import * as PV from './playValue.js';
import * as A from './attributes.js';

const GEN = path.join(REPO_ROOT, 'card-data', 'generated');
const OPTS = { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX };

const load = f => {
  const body = JSON.parse(fs.readFileSync(path.join(GEN, f), 'utf8'));
  return { body, cards: Array.isArray(body) ? body : body.cards };
};
// INDENT 1, matching every set generator. This used to write indent 2, which
// meant a set file's whole 20-30k lines changed depending on whether a
// generator or a reprice touched it last — a formatting churn that buried real
// edits, because four cards moving looked exactly like nothing moving.
const save = (f, body) => fs.writeFileSync(path.join(GEN, f), JSON.stringify(body, null, 1) + '\n');
const stats = (name, before, cards) => {
  const ds = cards.map((c, i) => c.salary - before[i]);
  const moved = ds.filter(d => d !== 0);
  const up = moved.filter(d => d > 0).length;
  const mean = moved.length ? moved.reduce((s, d) => s + Math.abs(d), 0) / moved.length : 0;
  console.log(`${name}: ${cards.length} cards, ${moved.length} moved (${up} up, ${moved.length - up} down), mean |move| ${mean.toFixed(0)}`);
};

// Base set first — it is the field and basis everything else is priced against.
{
  const { body, cards } = load('cards-2026-27.json');
  const before = cards.map(c => c.salary);
  const salaries = PV.priceSet(cards, OPTS);
  cards.forEach((c, i) => { c.salary = salaries[i]; });
  save('cards-2026-27.json', body);
  stats('2026-27 base', before, cards);
}

const SPECIALS = [
  'cards-super-season.json',
  'cards-rookie.json',
  'cards-summer-standouts.json',
  'cards-dissonance.json',
  // Added when the team-completion set shipped. Leaving it out did not fail
  // loudly — the loop simply priced seven sets and reported seven — which is
  // exactly why a new set must be added HERE and not only to its generator.
  'cards-team-rewards.json',
  'cards-wnba.json',
  'cards-wnba-rookie.json',
  'cards-wnba-super-season.json',
];
for (const f of SPECIALS) {
  if (!fs.existsSync(path.join(GEN, f))) { console.log(`${f}: missing, skipped`); continue; }
  const { body, cards } = load(f);
  const before = cards.map(c => c.salary);
  PV.priceAgainstBase(cards, OPTS);
  save(f, body);
  stats(f.replace('cards-', '').replace('.json', ''), before, cards);
}
