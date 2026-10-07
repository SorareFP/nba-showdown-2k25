// REBUILD EVERY FREE AGENTS CARD ON TODAY'S RULES.
//
//   node scripts/cardgen/rebuildFreeAgents.mjs          # report only
//   node scripts/cardgen/rebuildFreeAgents.mjs --write  # rebuild the file
//
// A requested card is built once, when it is signed, so a later change to the
// card rules (the uncapped minutes damp, the continuous three line and the
// per-band REB/AST rows, all 2026-09-30) never reaches it: the shipped sets
// were rebuilt and these were not. This runs each card's own request back
// through buildFreeAgent — same player, season, playoff run and set — and
// prints what moved: salary, rarity, Speed/Power, the lines.
//
// The file keeps its order, each card keeps its id and its builtAt (the day
// it was signed), and gains a `rebuiltAt`. A card whose rarity changes is a
// rarity shift like any other: cut a new settlement table after writing
// (rarityShift.mjs --out rarity-shift-N.json --from <the commit before>).
import fs from 'node:fs';
import { REPO_ROOT } from './cache.js';
import { buildFreeAgent } from './buildFreeAgent.mjs';
import { readFreeAgents, freeAgentsPath } from './freeAgentFile.js';
import { invoiceFor } from '../../src/game/freeAgents.js';

const write = process.argv.includes('--write');
const file = readFreeAgents(REPO_ROOT);
const out = [];
const rows = [];

for (const old of file.cards ?? []) {
  const res = await buildFreeAgent({
    bbrefId: old.bbrefId,
    season: old.season,
    playoffs: Boolean(old.playoffRun),
    set: old.set,
    requestId: old.requestId,
    write: false,
  });
  const card = { ...res.card, builtAt: old.builtAt, rebuiltAt: new Date().toISOString() };
  if (card.id !== old.id) throw new Error(`${old.set}:${old.id} would come back as ${card.id}`);
  out.push(card);
  const was = invoiceFor(old), now = invoiceFor(card);
  rows.push({
    key: `${old.set}:${old.id}`,
    salary: [old.salary, card.salary],
    rarity: [was.rarity, now.rarity],
    sp: [`${old.speed}/${old.power}`, `${card.speed}/${card.power}`],
    lines: [`${old.shotLine}/${old.threePtBoost}/${old.paintBoost}`, `${card.shotLine}/${card.threePtBoost}/${card.paintBoost}`],
    chartSame: JSON.stringify(old.chart) === JSON.stringify(card.chart),
  });
}

for (const r of rows) {
  const d = r.salary[1] - r.salary[0];
  const flag = r.rarity[0] !== r.rarity[1] ? `  RARITY ${r.rarity[0]} -> ${r.rarity[1]}` : '';
  console.log(`${r.key.padEnd(40)} $${r.salary[0]} -> $${r.salary[1]} (${d >= 0 ? '+' : ''}${d})  S/P ${r.sp[0]} -> ${r.sp[1]}  shot/3/paint ${r.lines[0]} -> ${r.lines[1]}${r.chartSame ? '' : '  chart moved'}${flag}`);
}

if (write) {
  fs.writeFileSync(freeAgentsPath(REPO_ROOT), `${JSON.stringify({ ...file, cards: out }, null, 1)}\n`);
  console.log(`\nWrote ${out.length} cards.`);
} else {
  console.log('\nReport only; --write rebuilds the file.');
}
