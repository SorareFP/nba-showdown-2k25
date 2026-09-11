// THE DYNASTY'S AGES — every NBA card's age "on January 1 of the year the card
// is from" (the user, 2026-09-11), for the aging dynasty (src/game/modes/
// dynasty.js). Basketball-Reference's season age (as of February 1) is the
// source, which is the same day to within a month.
//
//   base cards      the 2025-26 advanced cache, by name; a player who sat
//                   2025-26 out takes his 2024-25 age plus one
//   special cards   their own `age` when the card carries one (most do);
//                   otherwise their season's cache, by bbrefId
//
// Writes card-data/generated/dynasty-ages.json, { cardKey: age }, holding only
// the ages a card does not carry itself. Re-run after the card sets change:
//   node scripts/dynasty/buildAges.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_SETS, BASE_SET, cardKey } from '../../src/game/cardSets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'card-data/generated/dynasty-ages.json');

function cache(season) {
  const f = path.join(ROOT, `card-data/cache/bbref-${season}-advanced-full.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).data ?? [] : [];
}
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, '').replace(/[^a-z]/gi, '').toLowerCase();
function byName(rows) {
  const m = new Map();
  for (const r of rows) if (!m.has(norm(r.name))) m.set(norm(r.name), r);
  return m;
}

const out = {};
const misses = [];

const now = byName(cache(2026));
const before = byName(cache(2025));
for (const c of CARD_SETS[BASE_SET]) {
  const here = now.get(norm(c.name))?.age;
  const prior = before.get(norm(c.name))?.age;
  const age = Number.isFinite(here) ? here : Number.isFinite(prior) ? prior + 1 : null;
  if (Number.isFinite(age)) out[cardKey(c)] = age;
  else misses.push(c.name);
}

const seasons = new Map();
for (const [set, cards] of Object.entries(CARD_SETS)) {
  if (set === BASE_SET || set.startsWith('wnba')) continue;
  for (const c of cards) {
    if (Number.isFinite(c.age)) continue;
    if (!seasons.has(c.season)) seasons.set(c.season, cache(c.season));
    const r = seasons.get(c.season).find(x => x.playerId === c.bbrefId);
    if (Number.isFinite(r?.age)) out[cardKey(c)] = r.age;
    else misses.push(`${c.name} (${set} ${c.season})`);
  }
}

fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
console.log(`dynasty-ages.json: ${Object.keys(out).length} ages; ${misses.length} missing${misses.length ? ` — ${misses.join(', ')}` : ''}`);
