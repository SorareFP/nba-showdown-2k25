// Copy the game into functions/shared/ so the server runs the SAME rules the
// browser does.
//
// Run automatically by the `predeploy` hook in firebase.json; safe to run by
// hand while developing.
//
// ── WHY A COPY AND NOT AN IMPORT ────────────────────────────────────────────
//
// Firebase uploads the `functions` directory and nothing above it, so
// `import '../src/game/packEngine.js'` resolves locally, passes every test, and
// then throws MODULE_NOT_FOUND in production. A symlink does not survive the
// upload either. The options are a bundler or a copy, and a copy is the one
// that leaves the deployed source readable.
//
// ── THE THING THIS MUST NOT BECOME ──────────────────────────────────────────
//
// A second copy of the pack engine that drifts. src/ is the source; shared/ is
// build output and is gitignored. If the two ever disagree the server is right
// and the client is cosmetic — but they should never disagree, which is why
// this runs on every deploy rather than when somebody remembers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'shared');

/**
 * What the server needs, and nothing else.
 *
 * Deliberately NOT the whole of src/: a Cloud Function that imports a React
 * component fails to cold-start, and the failure reads as a deploy problem
 * rather than as an import problem. Everything listed here is plain data or
 * plain logic — see the DOM check in the test.
 */
const COPY = [
  'src/game/packEngine.js',
  'src/game/cardSets.js',
  'src/game/cards.js',
  'src/game/strats.js',
  'src/game/rarity.js',
  'src/game/collections.js',
  'src/game/collectionDifficulty.js',
  'src/game/coinRewards.js',
  'src/game/modes/prizes.js',
  'src/cards/teams.js',
  'src/cards/sets.js',
  'src/cards/playerId.js',
];

/** The generated card data those modules import. */
const DATA_DIR = 'card-data/generated';

function copyFile(rel) {
  const from = path.join(ROOT, rel);
  const to = path.join(OUT, rel);
  if (!fs.existsSync(from)) throw new Error(`prepare: missing ${rel}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

fs.rmSync(OUT, { recursive: true, force: true });

let n = 0;
for (const rel of COPY) {
  copyFile(rel);
  n += 1;
}

// Only the card JSON the modules actually import — every `cards-*.json` plus
// the pool files they read. Copying the whole directory would drag the caches
// and audits along and roughly triple the upload.
const dataDir = path.join(ROOT, DATA_DIR);
let data = 0;
for (const file of fs.readdirSync(dataDir)) {
  if (!/^cards-.*\.json$/.test(file) && !/^(wnba-)?(player-)?pool.*\.json$/.test(file)) continue;
  copyFile(path.join(DATA_DIR, file));
  data += 1;
}

// A marker so a stale shared/ is obvious in a deploy log rather than silent.
fs.writeFileSync(
  path.join(OUT, 'BUILT.json'),
  `${JSON.stringify({ builtAt: new Date().toISOString(), modules: n, data }, null, 1)}\n`
);

console.log(`prepare: copied ${n} module(s) and ${data} data file(s) into functions/shared/`);
