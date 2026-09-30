// CUT THE RARITY-SHIFT TABLE: which card keys changed rarity between the cards
// as they last shipped (a git ref) and the cards as they are now, and what a
// copy of each is owed. src/game/rarityShift.js explains the payout rule; this
// only writes card-data/generated/rarity-shift.json.
//
//   node scripts/cardgen/rarityShift.mjs [--from <ref>] [--id <receipt id>] [--cutoff <ISO time>] [--out <file>]
//
//   --from     the shipped cards. Default: the tag cut before the 2026-09-29
//              chart rebuild, cards-before-conditional-rows.
//   --id       the receipt id every account claims under. Default
//              rarity-shift:<today>. A table that has been DEPLOYED keeps its
//              id forever; the next change cuts a new table with a new id.
//   --cutoff   copies acquired at or after this time are not owed anything.
//              Default: now. Run this just before the deploy, after the last
//              card change, so the cutoff sits as close to it as possible — a
//              copy bought between the cut and the deploy was bought at the
//              OLD price and goes unpaid, which errs the safe way.
//
// OLD KEYS RESOLVE THE OLD WAY. A copy carries the key it was minted under, and
// some of those are aliases (a reward that changed id, a Super Season retired
// to a Throwback). So the ref's own cardSets.js is extracted with the data it
// imports and asked, key by key, what card the key named then; the current
// module answers what it names now. Every key either version resolves is
// asked, aliases included.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getPlayerRarity, BURN_VALUES, RARITY_ORDER } from '../../src/game/rarity.js';
import * as now from '../../src/game/cardSets.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
// `--out rarity-shift-2.json`: a deployed table is never rewritten; the next
// change is cut into the next file (src/game/rarityShift.js imports each).
const OUT = path.join(ROOT, 'card-data', 'generated', process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'rarity-shift.json');

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const REF = arg('from') ?? 'cards-before-conditional-rows';
const TODAY = new Date().toISOString().slice(0, 10);
const ID = arg('id') ?? `rarity-shift:${TODAY}`;
const CUTOFF = new Date(arg('cutoff') ?? Date.now()).toISOString();

const git = (...args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 1 << 30 });

/** The ref's cardSets.js and the JSON it imports, in a scratch directory. */
function extractOld(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rarity-shift-'));
  const put = rel => {
    const to = path.join(dir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, git('show', `${ref}:${rel}`));
  };
  put('src/game/cardSets.js');
  const src = fs.readFileSync(path.join(dir, 'src/game/cardSets.js'), 'utf8');
  const imports = [...src.matchAll(/from\s+'(\.\.\/\.\.\/card-data\/generated\/[^']+\.json)'/g)].map(m => m[1].replace(/^\.\.\/\.\.\//, ''));
  const other = [...src.matchAll(/from\s+'(\.[^']+)'/g)].map(m => m[1]).filter(p => !p.endsWith('.json'));
  if (other.length) throw new Error(`${ref}'s cardSets.js imports modules this script does not extract: ${other.join(', ')}`);
  for (const rel of imports) put(rel);
  return dir;
}

/** Every key a module can resolve: its cards, its dormant cards and its aliases. */
function keysOf(mod, dormantKeys) {
  return [
    ...mod.ALL_CARDS.map(c => mod.cardKey(c)),
    ...(dormantKeys ?? []),
    ...Object.keys(mod.KEY_ALIASES ?? {}),
    ...[...(mod.DERIVED_ALIASES?.keys?.() ?? [])],
  ];
}

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

const oldDir = extractOld(REF);
const old = await import(pathToFileURL(path.join(oldDir, 'src/game/cardSets.js')).href);
const oldDormant = fs.existsSync(path.join(oldDir, 'card-data/generated/dormant-throwbacks.json'))
  ? readJson(path.join(oldDir, 'card-data/generated/dormant-throwbacks.json')).keys : [];
const nowDormant = readJson(path.join(ROOT, 'card-data/generated/dormant-throwbacks.json')).keys;

const keys = [...new Set([...keysOf(old, oldDormant), ...keysOf(now, nowDormant)])].sort();

const shifts = {};
const lost = [];
const moves = {};
let up = 0;
let down = 0;
for (const key of keys) {
  // The Live Series is off until the NBA season (liveSeries.js): no pack deals
  // it and no account holds it, and its file changes every night.
  if (key.startsWith('live:')) continue;
  const was = old.getCardByKey(key);
  const is = now.getCardByKey(key);
  if (!was) continue;
  if (!is) { lost.push(key); continue; }
  const from = getPlayerRarity(was);
  const to = getPlayerRarity(is);
  if (from === to) continue;
  const coins = BURN_VALUES[from] - BURN_VALUES[to];
  shifts[key] = { from, to, coins, name: is.name, season: is.seasonLabel ?? is.season ?? null, salary: [was.salary ?? 0, is.salary ?? 0] };
  if (coins > 0) down += 1; else up += 1;
  const m = `${from} -> ${to}`;
  moves[m] = (moves[m] ?? 0) + 1;
}

const table = {
  note: 'RARITY SHIFT — card keys whose rarity moved between the cards as shipped (`from`) and now; each copy held before `cutoff` is owed `coins` (negative for a card that moved up), the total floored at zero, once per account under claims/<id>. Written by scripts/cardgen/rarityShift.mjs; read by src/game/rarityShift.js.',
  id: ID,
  from: REF,
  fromCommit: git('rev-parse', REF).toString().trim(),
  cutoff: CUTOFF,
  rates: Object.fromEntries(RARITY_ORDER.map(r => [r, BURN_VALUES[r]])),
  summary: { keys: Object.keys(shifts).length, down, up, moves },
  shifts,
};
fs.writeFileSync(OUT, `${JSON.stringify(table, null, 1)}\n`);
fs.rmSync(oldDir, { recursive: true, force: true });

console.log(`rarity-shift: ${Object.keys(shifts).length} key(s) moved (${down} down, ${up} up) from ${REF}; id ${ID}; cutoff ${CUTOFF}`);
for (const [m, n] of Object.entries(moves).sort((a, b) => b[1] - a[1])) console.log(`  ${m}: ${n}`);
if (lost.length) {
  console.log(`  WARNING: ${lost.length} key(s) resolved at ${REF} and resolve to nothing now — a holder loses the card:`);
  for (const k of lost) console.log(`    ${k}`);
}
