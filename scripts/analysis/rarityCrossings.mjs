// Which cards changed RARITY between two copies of the generated sets.
//
//   node scripts/analysis/rarityCrossings.mjs <folder holding the old cards-*.json>
//
// Rarity is read off salary (src/game/rarity.js getPlayerRarity), so a reprice
// moves cards across its lines — which changes pack odds, burn values and
// collection goals. Written for the 2026-09-23 currency-rate reprice.
import fs from 'node:fs';
import path from 'node:path';
import { getPlayerRarity, RARITY_ORDER } from '../../src/game/rarity.js';

const oldDir = process.argv[2];
if (!oldDir) { console.error('usage: rarityCrossings.mjs <old folder>'); process.exit(1); }
const GEN = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'card-data', 'generated');
const cardsOf = file => {
  try {
    const b = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(b) ? b : (b.cards ?? []);
  } catch { return []; }
};
let up = 0; let down = 0;
const lines = [];
for (const f of fs.readdirSync(GEN).filter(f => /^cards-.*\.json$/.test(f))) {
  const was = new Map(cardsOf(path.join(oldDir, f)).map(c => [c.id, c]));
  for (const c of cardsOf(path.join(GEN, f))) {
    const o = was.get(c.id);
    if (!o || o.salary == null || c.salary == null) continue;
    const a = getPlayerRarity(o); const b = getPlayerRarity(c);
    if (a === b) continue;
    const dir = RARITY_ORDER.indexOf(b) > RARITY_ORDER.indexOf(a) ? 'up' : 'down';
    if (dir === 'up') up += 1; else down += 1;
    lines.push(`  ${f.replace(/^cards-|\.json$/g, '').padEnd(20)} ${c.name} ${c.season ?? ''}: ${a} -> ${b} ($${o.salary} -> $${c.salary})`);
  }
}
console.log(`${up + down} cards changed rarity (${up} up, ${down} down)`);
console.log(lines.sort().join('\n'));
