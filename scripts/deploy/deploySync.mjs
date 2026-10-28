// A DEPLOY THAT KEEPS MAIN IN STEP (2026-10-28).
//
//   node scripts/deploy/deploySync.mjs before   # predeploy
//   node scripts/deploy/deploySync.mjs strip    # between the build and gh-pages
//   node scripts/deploy/deploySync.mjs after    # postdeploy
//
// The user: "is there an easier way to update them daily where I don't have
// to tell you to?" Two things publish the site. The user's `npm run deploy`
// builds this checkout; the Live Series' nightly job (live-series.yml) builds
// MAIN with the day's numbers and publishes that. So main has to be what was
// last deployed, or the morning's publish rolls the site back to older code —
// and main used to be moved by hand, after a deploy was confirmed, which was
// missed three times in October (the stale Live faces of 10-23 and 10-25, and
// a publish fix that sat on the branch while the job failed every night).
//
// Now the deploy does it:
//   before  stops on uncommitted changes to what the build reads (main cannot
//           be moved to match them), then merges main's new commits in —
//           they may only be the bot's day's numbers — so this build carries
//           the freshest Live data.
//   strip   drops the Live faces from this build: the nightly job exports and
//           publishes them, and gh-pages keeps every file a deploy does not
//           bring (only assets/** is cleared), so a deploy never puts an older
//           face over the bot's.
//   after   pushes this branch and moves main to the commit just deployed.
// In the nightly job itself (CI) all three step aside: there it is main that
// builds, and its faces are the fresh ones.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The files the Live Series bot commits to main, and the only ones it may. */
export const LIVE_BOT_FILES = ['card-data/generated/cards-live.json', 'card-data/generated/live-status.json'];

/** The Live faces and thumbs a build copies from public/, which the bot owns on the site. */
export const LIVE_FACE_DIRS = ['cards/live', 'cards/thumbs/live'];

const BUILD_ROOTS = ['src/', 'public/', 'card-data/'];
const BUILD_FILES = ['index.html', 'vite.config.js', 'package.json', 'package-lock.json'];

/** Is this repo path something `vite build` reads (the Live faces aside: the bot publishes those)? */
export function isBuildInput(file) {
  const f = String(file).replace(/\\/g, '/');
  if (LIVE_FACE_DIRS.some(d => f.startsWith(`public/${d}/`))) return false;
  return BUILD_ROOTS.some(r => f.startsWith(r)) || BUILD_FILES.includes(f);
}

/** The tracked files `git status --porcelain` shows changed that the build reads. Untracked files are left alone. */
export function changedBuildInputs(porcelain) {
  return String(porcelain ?? '').split('\n')
    .filter(l => l.trim() && !l.startsWith('??'))
    .map(l => l.slice(3).split(' -> ').pop().replace(/^"|"$/g, ''))
    .filter(isBuildInput);
}

/** Did main's new commits touch only the bot's files? */
export const botOnly = files => files.filter(Boolean).every(f => LIVE_BOT_FILES.includes(f));

const inCI = env => env.CI === 'true' || env.GITHUB_ACTIONS === 'true';

function gitOf(cwd) {
  return (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** predeploy: refuse what main cannot match, then take main's new Live data in. 0 to go on, 1 to stop. */
export function before({ git, log = console.log, env = process.env }) {
  if (inCI(env)) { log('deploy: the nightly job builds main itself; nothing to sync.'); return 0; }
  // The bot's files are its own: a local copy of them is a dry run's leftovers.
  const dirty = changedBuildInputs(git('status', '--porcelain'));
  for (const f of dirty.filter(x => LIVE_BOT_FILES.includes(x))) {
    git('checkout', '--', f);
    log(`deploy: put back ${f} (the Live bot's file; the build takes main's).`);
  }
  const left = dirty.filter(x => !LIVE_BOT_FILES.includes(x));
  if (left.length) {
    log('deploy: STOPPED. These changes are not committed, so main cannot be moved to match what you would deploy,');
    log('and the Live Series\' morning publish would roll them back:');
    for (const f of left) log(`  ${f}`);
    log('Commit them first (ask Claude), or put back export leftovers with: git checkout -- <file>');
    return 1;
  }
  git('fetch', '--quiet', 'origin', 'main');
  const ahead = git('rev-list', 'HEAD..origin/main');
  if (ahead) {
    const files = git('diff', '--name-only', 'HEAD...origin/main').split('\n');
    if (!botOnly(files)) {
      log('deploy: STOPPED. main has commits that are not the Live bot\'s numbers:');
      for (const f of files.filter(x => x && !LIVE_BOT_FILES.includes(x))) log(`  ${f}`);
      log('Ask Claude to bring them in before deploying.');
      return 1;
    }
    try {
      git('merge', '--no-edit', 'origin/main');
    } catch (e) {
      try { git('merge', '--abort'); } catch { /* nothing to abort */ }
      log(`deploy: STOPPED. Merging main's Live numbers failed: ${e.stderr || e.message}`);
      return 1;
    }
    log(`deploy: merged main's Live numbers (${ahead.split('\n').length} commit(s)).`);
  }
  log(`deploy: building ${git('rev-parse', '--short', 'HEAD')}.`);
  return 0;
}

/** Between the build and gh-pages: take the Live faces out of a local build. */
export function strip({ dist, log = console.log, env = process.env }) {
  if (inCI(env)) return 0;
  for (const d of LIVE_FACE_DIRS) {
    const dir = path.join(dist, d);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      log(`deploy: left ${d} to the nightly job.`);
    }
  }
  return 0;
}

/** postdeploy: push the branch and move main to the commit just deployed. */
export function after({ git, log = console.log, env = process.env }) {
  if (inCI(env)) return 0;
  const sha = git('rev-parse', '--short', 'HEAD');
  try {
    git('push', '--quiet', 'origin', 'HEAD');
    git('push', '--quiet', 'origin', 'HEAD:refs/heads/main');
  } catch (e) {
    log(`deploy: the site is up, but main could not be moved to ${sha}: ${e.stderr || e.message}`);
    log('Ask Claude to move main before the next morning\'s Live Series run.');
    return 1;
  }
  log(`deploy: main is now ${sha}, the commit just deployed; the Live Series publishes from it each morning.`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const git = gitOf(root);
  const step = process.argv[2];
  const code = step === 'before' ? before({ git })
    : step === 'strip' ? strip({ dist: path.join(root, 'dist') })
      : step === 'after' ? after({ git })
        : (console.error('usage: deploySync.mjs before|strip|after'), 2);
  process.exit(code);
}
