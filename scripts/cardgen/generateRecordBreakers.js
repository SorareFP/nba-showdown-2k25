// RECORD BREAKERS — the set's cards, from card-data/record-breakers.json.
//
//   node scripts/cardgen/generateRecordBreakers.js
//
// Each season row is built through the Free Agents builder as a Throwback
// (write:false: never a request, and record-breakers is not a set a request
// can build into), then relabelled into this set with its season in the id.
// Writes cards-record-breakers.json and card-records.json (every plaque, by
// set and id, the plaque-only rows on existing cards included). Runs after
// generateCuratedCards. See docs/plans/2026-10-14-record-breakers-design.md.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, readCache } from './cache.js';
import { buildFreeAgent } from './buildFreeAgent.mjs';
import { playerIdFromName } from '../../src/cards/playerId.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const SET_ID = 'record-breakers';
export const ROWS_FILE = path.join(REPO_ROOT, 'card-data', 'record-breakers.json');
export const OUTPUT_FILE = path.join(GEN_DIR, 'cards-record-breakers.json');
export const RECORDS_FILE = path.join(GEN_DIR, 'card-records.json');
const REQUEST_ONLY_FIELDS = ['requested', 'requestId', 'builtAt'];

export function readRows(file = ROWS_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).rows ?? [];
}

/** A built Throwback as this set's card. */
export function recordCard(built, row) {
  const out = { ...built };
  for (const f of REQUEST_ONLY_FIELDS) delete out[f];
  return {
    ...out,
    id: `${playerIdFromName(row.name)}_${row.season}`,
    set: SET_ID,
    record: row.record,
    earn: row.earn,
    why: row.why,
  };
}

/** Throws when a row's `check` disagrees with the cached numbers. */
export function checkRecord(row, { log = null, perPoss = null } = {}) {
  const c = row.check;
  if (!c) return;
  if (c.source === 'log') {
    const total = (log?.reg ?? []).reduce((n, g) => n + (Number(g[c.stat]) || 0), 0);
    if (total !== c.total) {
      throw new Error(`${row.name} ${row.season}: the log has ${total.toLocaleString('en-US')} ${c.stat}, the row says ${c.total.toLocaleString('en-US')}`);
    }
  } else if (c.source === 'perPoss') {
    const v = perPoss?.[c.field];
    if (v == null || Math.abs(v - c.value) > 0.0005) {
      throw new Error(`${row.name} ${row.season}: ${c.field} is ${v}, the row says ${c.value}`);
    }
  } else {
    throw new Error(`${row.name} ${row.season}: unknown check source ${c.source}`);
  }
}

/** `{ 'set:id': record }` for every plaque. */
export function recordsIndex(cards, plaqueRows) {
  const out = {};
  for (const c of cards) out[`${c.set}:${c.id}`] = c.record;
  for (const r of plaqueRows) out[r.card] = r.record;
  return out;
}

const tryCache = key => { try { return readCache(key); } catch { return null; } };
const perPossRow = (bbrefId, season) => {
  const t = tryCache(`bbref-${season}-perPoss-full`);
  const rows = Array.isArray(t) ? t : t?.rows ?? t?.data ?? [];
  return rows.filter(r => r.playerId === bbrefId).sort((a, b) => (b.games ?? 0) - (a.games ?? 0))[0] ?? null;
};

export async function main({ log = console.log } = {}) {
  const rows = readRows();
  const cards = [];
  for (const row of rows.filter(r => !r.card)) {
    const built = await buildFreeAgent({ bbrefId: row.bbrefId, season: Number(row.season), playoffs: false, set: 'throwbacks', write: false });
    checkRecord(row, { log: tryCache(`gamelog-full-${row.bbrefId}-${row.season}`), perPoss: perPossRow(row.bbrefId, row.season) });
    cards.push(recordCard(built.card, row));
    log(`  ${row.name} ${row.season}: ${SET_ID}:${cards.at(-1).id} $${built.salary} ${built.rarity} · ${row.record.number} ${row.record.label}`);
  }
  cards.sort((a, b) => b.salary - a.salary || a.id.localeCompare(b.id));
  const generatedAt = new Date().toISOString();
  fs.mkdirSync(GEN_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify({
    set: SET_ID,
    generatedAt,
    note: 'RECORD BREAKERS — generator-owned (scripts/cardgen/generateRecordBreakers.js from card-data/record-breakers.json).',
    cards,
  }, null, 1)}\n`);
  const plaques = rows.filter(r => r.card);
  fs.writeFileSync(RECORDS_FILE, `${JSON.stringify({ generatedAt, records: recordsIndex(cards, plaques) }, null, 1)}\n`);
  log(`Record Breakers: ${cards.length} card(s), ${plaques.length} plaque(s) on existing cards.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
