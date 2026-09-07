// WNBA legends the card sets do not have — the candidates for "a few great
// seasons from defunct franchises, and some Hall of Famers without cards"
// (the user, 2026-09-06). Read-only report.
//
//   node scripts/analysis/wnbaUncardedLegends.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_SETS } from '../../src/game/cardSets.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const carded = new Set(
  Object.entries(CARD_SETS).filter(([k]) => k.startsWith('wnba')).flatMap(([, cs]) => cs.map(c => norm(c.name)))
);
// Franchises that no longer exist (bbref codes): Comets, Monarchs, Sting,
// Rockers, Sol, Starzz/Silver Stars, Miracle, Shock (Detroit and Tulsa), the
// original Fire.
const DEFUNCT = new Set(['HOU', 'SAC', 'CHA', 'CLE', 'MIA', 'UTA', 'SAS', 'ORL', 'DET', 'TUL', 'POR']);
// Naismith Hall of Famers who played in the WNBA (as I know the list; verify
// any name before it becomes a card).
const HOF = ['Cynthia Cooper', 'Sheryl Swoopes', 'Lisa Leslie', 'Tina Thompson', 'Katie Smith', 'Dawn Staley',
  'Teresa Weatherspoon', 'Ticha Penicheiro', 'Yolanda Griffith', 'Becky Hammon', 'Sue Bird', 'Diana Taurasi',
  'Tamika Catchings', 'Lauren Jackson', 'Lindsay Whalen', 'Swin Cash', 'Sylvia Fowles', 'Maya Moore',
  'Rebecca Lobo', 'Seimone Augustus', 'Nancy Lieberman', 'Candace Parker'];

const dir = path.join(ROOT, 'card-data', 'cache');
const seasons = fs.readdirSync(dir).filter(f => /^wnba-\d{4}-advanced\.json$/.test(f)).map(f => +f.slice(5, 9)).sort();
const best = new Map();
const career = new Map();
for (const y of seasons) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, `wnba-${y}-advanced.json`), 'utf8'));
  for (const r of raw.data ?? raw) {
    if (!r.playerId || !r.team || r.team === 'TOT') continue;
    career.set(r.playerId, (career.get(r.playerId) ?? 0) + (r.ws ?? 0));
    if ((r.minutes || 0) < 600) continue;
    const cur = best.get(r.playerId);
    if (!cur || (r.ws ?? 0) > (cur.ws ?? 0)) best.set(r.playerId, { ...r, season: y });
  }
}
const uncarded = [...best.values()].filter(r => !carded.has(norm(r.name)));
const line = r => `   ${String(r.name).padEnd(24)} ${r.season}  ${String(r.team).padEnd(4)} WS ${String(r.ws).padStart(4)}  PER ${String(r.per).padStart(5)}  min ${r.minutes}  career WS ${career.get(r.playerId)?.toFixed(1)}`;

console.log('DEFUNCT-FRANCHISE best seasons, uncarded, by WS:');
uncarded.filter(r => DEFUNCT.has(r.team)).sort((a, b) => (b.ws ?? 0) - (a.ws ?? 0)).slice(0, 18).forEach(r => console.log(line(r)));

console.log('\nHALL OF FAMERS with no WNBA card:');
for (const name of HOF) {
  if (carded.has(norm(name))) continue;
  const r = [...best.values()].find(x => norm(x.name) === norm(name));
  console.log(r ? line(r) : `   ${name.padEnd(24)} (no season of 600+ minutes in the archive)`);
}

console.log('\nBEST UNCARDED OVERALL by career WS (any franchise):');
uncarded.sort((a, b) => (career.get(b.playerId) ?? 0) - (career.get(a.playerId) ?? 0)).slice(0, 12).forEach(r => console.log(line(r)));
console.log(`\narchive ${seasons[0]}-${seasons.at(-1)}; carded WNBA names ${carded.size}`);
