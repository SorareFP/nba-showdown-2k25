// THE SAVED DUNKSANDTHREES TABLE (2026-11-12).
//
//   npm run live:dt                    # the newest __data*.json in Downloads
//   npm run live:dt -- <file>          # that file
//   npm run live:dt -- --dry           # read and report, push nothing
//   node scripts/cardgen/dtTable.js open --out <file>   # the nightly job
//
// dunksandthrees served the Live Series its EXPECTED page (each player's
// predicted EPM, rates and shooting) to a script until 2026-11-04. From 11-05
// their site refused every scripted read (a 403 to GitHub's runner and to the
// user's machine alike) while the page still opens in a browser. The user
// wants their numbers, so a person fetches them: open DT_DATA_LINK in a
// browser, save it (Ctrl+S), and run `npm run live:dt`.
//
// The script reads the saved page (the same __data.json the job used to
// download; parseEpmPayload), keeps the fields a card reads (toSeasonRate), and
// pushes them to the live-dt branch for the nightly job
// (.github/workflows/live-series.yml), which opens them before generateLive.js.
//
// ENCRYPTED, because the repo is public: their whole table in it would hand
// anyone the data their block keeps from scripts. AES-256-GCM over the gzipped
// JSON, the key LIVE_DT_KEY in .env.local and in the repository's Actions
// secrets. The first run makes the key and writes it to .env.local; it is
// never printed. The job opens the table into the runner's temp folder, not
// card-data/cache, so the stat cache (actions/cache) never carries it either.
//
// The branch is ONE commit, rebuilt and force-pushed each time, like
// live-photos (scripts/live/pushLivePhotos.mjs): only the newest table matters.
// Built with git plumbing, so the working tree, the index and the current
// branch are never touched. A night with no new save reads the last one.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseEpmPayload, toSeasonRate } from './sources/dunksAndThrees.js';
import { REPO_ROOT } from './cache.js';

export const DT_DATA_LINK = 'https://dunksandthrees.com/epm/__data.json?x-sveltekit-invalidated=001';
export const DT_BRANCH = 'live-dt';
export const DT_BLOB = 'expected.bin';
export const DT_KEY_NAME = 'LIVE_DT_KEY';
/** The opened table on this machine, for a local generateLive run (card-data/cache is gitignored). */
export const localTableFile = season => path.join(REPO_ROOT, 'card-data', 'cache', `dunksandthrees-saved-${season}.json`);

const MAGIC = Buffer.from('DT1\n');
const ENTITIES = { '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#39;': "'", '&#x27;': "'" };

/**
 * The table in a saved page: { season, asOf, rows }. A browser saves the raw
 * JSON, but a JSON viewer may wrap it in a page (<pre>…</pre>, entities), so
 * the outermost braces are tried next. Anything else (their 403 page, the
 * wrong page) says what to save instead.
 */
export function parseSavedPage(text) {
  const raw = String(text ?? '').replace(/^﻿/, '');
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    const a = raw.indexOf('{');
    const b = raw.lastIndexOf('}');
    try {
      body = JSON.parse(raw.slice(a, b + 1).replace(/&(quot|amp|lt|gt|#39|#x27);/g, m => ENTITIES[m]));
    } catch {
      throw new Error(`That file is not dunksandthrees' data page. Open ${DT_DATA_LINK} in a browser and save it again.`);
    }
  }
  let page;
  try {
    page = parseEpmPayload(body);
  } catch (e) {
    throw new Error(`That file is not dunksandthrees' expected page (${e.message}). Open ${DT_DATA_LINK} and save it again.`);
  }
  return { season: page.season, asOf: page.asOf, rows: page.rows.map(toSeasonRate) };
}

function keyBytes(key) {
  const b = Buffer.from(String(key ?? '').trim(), 'base64');
  if (b.length !== 32) throw new Error(`${DT_KEY_NAME} is missing or not a 32-byte base64 key.`);
  return b;
}

export const newKey = () => crypto.randomBytes(32).toString('base64');

/** The table, gzipped and encrypted: MAGIC, iv (12), tag (16), ciphertext. */
export function seal(table, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyBytes(key), iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(JSON.stringify(table))), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function unseal(buf, key) {
  if (!Buffer.isBuffer(buf) || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error(`${DT_BLOB} is not a sealed dunksandthrees table.`);
  }
  const at = MAGIC.length;
  const d = crypto.createDecipheriv('aes-256-gcm', keyBytes(key), buf.subarray(at, at + 12));
  d.setAuthTag(buf.subarray(at + 12, at + 28));
  let plain;
  try {
    plain = Buffer.concat([d.update(buf.subarray(at + 28)), d.final()]);
  } catch {
    throw new Error(`${DT_BLOB} does not open with this ${DT_KEY_NAME}: the secret and .env.local must hold the same key.`);
  }
  return JSON.parse(zlib.gunzipSync(plain).toString('utf8'));
}

/** The newest __data*.json (a second save is "__data (1).json") in a folder, or null. */
export function newestSaved(dir = path.join(os.homedir(), 'Downloads')) {
  if (!fs.existsSync(dir)) return null;
  const found = fs.readdirSync(dir)
    .filter(f => /^__data.*\.json$/i.test(f))
    .map(f => ({ file: path.join(dir, f), at: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  return found[0]?.file ?? null;
}

/** The key from the environment, or a new one written to the env file (never printed). */
export function ensureKey(envFile = path.join(REPO_ROOT, '.env.local'), env = process.env) {
  if (env[DT_KEY_NAME]) return { key: env[DT_KEY_NAME], created: false };
  const key = newKey();
  const had = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  fs.writeFileSync(envFile, `${had}${had && !had.endsWith('\n') ? '\n' : ''}${DT_KEY_NAME}=${key}\n`);
  return { key, created: true };
}

const git = (args, opts = {}) => execFileSync('git', args, { cwd: REPO_ROOT, maxBuffer: 1 << 26, ...opts });

/** One commit holding the sealed table, force-pushed to the branch. */
export function pushSealed(buf, message) {
  const tmp = path.join(os.tmpdir(), `live-dt-${process.pid}.bin`);
  fs.writeFileSync(tmp, buf);
  try {
    const blob = git(['hash-object', '-w', tmp], { encoding: 'utf8' }).trim();
    const tree = git(['mktree'], { input: `100644 blob ${blob}\t${DT_BLOB}\n`, encoding: 'utf8' }).trim();
    const commit = git(['commit-tree', tree, '-m', message], { encoding: 'utf8' }).trim();
    git(['push', '--force', 'origin', `${commit}:refs/heads/${DT_BRANCH}`], { stdio: ['ignore', 'pipe', 'inherit'] });
    return commit;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** The nightly job's side: the branch's table, opened. */
export function openFromBranch(key) {
  git(['fetch', '--depth', '1', 'origin', DT_BRANCH], { stdio: ['ignore', 'pipe', 'inherit'] });
  return unseal(git(['show', `FETCH_HEAD:${DT_BLOB}`]), key);
}

/** Whole days between the table's date and now. */
export const daysOld = (asOf, now = new Date()) => Math.floor((now.getTime() - new Date(`${String(asOf).slice(0, 10)}T00:00:00Z`).getTime()) / 86_400_000);

async function save(argv) {
  const { LIVE_SEASON } = await import('./generateLive.js');
  const file = argv.find(a => !a.startsWith('--')) ?? newestSaved();
  if (!file) throw new Error(`No saved page in Downloads. Open ${DT_DATA_LINK} in a browser, press Ctrl+S, then run this again.`);
  const table = parseSavedPage(fs.readFileSync(file, 'utf8'));
  if (table.season !== LIVE_SEASON) {
    throw new Error(`That page is dunksandthrees' ${table.season} table; the Live Series is ${LIVE_SEASON}. Save the page again once they show ${LIVE_SEASON}.`);
  }
  console.log(`${path.basename(file)}: dunksandthrees ${table.season}, as of ${table.asOf}, ${table.rows.length} players.`);
  const old = daysOld(table.asOf);
  if (old > 1) console.log(`  That table is ${old} days old: they may not have updated yet, or this is an old save.`);
  const saved = { ...table, savedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(localTableFile(table.season)), { recursive: true });
  fs.writeFileSync(localTableFile(table.season), `${JSON.stringify(saved)}\n`);
  if (argv.includes('--dry')) return;
  const { key, created } = ensureKey();
  const sealed = seal(saved, key);
  unseal(sealed, key);
  const commit = pushSealed(sealed, `dunksandthrees ${table.season} expected table as of ${table.asOf} (${table.rows.length} players)`);
  console.log(`Pushed to the ${DT_BRANCH} branch (${commit.slice(0, 8)}). The next nightly run reads it.`);
  if (created) {
    console.log(
      `\nFIRST RUN: a new key, ${DT_KEY_NAME}, was added to .env.local. The nightly job needs the same key:\n` +
        `  1. Open .env.local and copy the text after ${DT_KEY_NAME}=\n` +
        '  2. On GitHub: the repo, Settings, Secrets and variables, Actions, New repository secret\n' +
        `  3. Name it ${DT_KEY_NAME}, paste the value, Add secret.`
    );
  }
}

function open(argv) {
  const i = argv.indexOf('--out');
  const out = i >= 0 ? argv[i + 1] : null;
  if (!out) throw new Error('open: --out <file> is required.');
  if (!process.env[DT_KEY_NAME]) throw new Error(`No ${DT_KEY_NAME}: add it to the repository's Actions secrets (see npm run live:dt).`);
  const table = openFromBranch(process.env[DT_KEY_NAME]);
  fs.writeFileSync(out, `${JSON.stringify(table)}\n`);
  console.log(`dunksandthrees ${table.season} table as of ${table.asOf} (saved ${table.savedAt}): ${table.rows.length} players, ${daysOld(table.asOf)} days old.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  const run = cmd === 'open' ? open : save;
  Promise.resolve().then(() => run(cmd === 'save' || cmd === 'open' ? rest : process.argv.slice(2))).catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}
