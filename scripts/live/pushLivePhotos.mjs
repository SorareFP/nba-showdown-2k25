// THE LIVE SERIES' PHOTOS FOR THE NIGHTLY JOB.
//
//   npm run live:photos            # push the base set's photos to the live-photos branch
//   npm run live:photos -- --dry   # count what would go, push nothing
//
// The Live faces borrow the base set's photos (src/cards/sets.js setPaths), and
// card-art/sets/*/photos is gitignored, so the Actions checkout of the nightly
// job (.github/workflows/live-series.yml) had none and would have exported
// every Live face without a photo. The user (2026-10-20) chose to publish the
// photos to their own branch, which the job unpacks before it exports, and to
// keep them current: run this whenever a base-set photo changes (the Studio's
// uploads, the Photo Hunt).
//
// The branch is ONE commit, rebuilt and force-pushed each time: only today's
// photos matter to the job, and a history of every photo would grow the repo
// with each replacement. Built with git plumbing on a private index, so the
// working tree, the real index and the current branch are never touched.
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PHOTOS = join(ROOT, 'card-art', 'sets', '2026-27', 'photos');
const BRANCH = 'live-photos';
const dry = process.argv.includes('--dry');

// Every format the Studio stores (src/studio/api.js IMAGE_EXT): a photo the
// filter skips is a Live face with no photo.
const files = readdirSync(PHOTOS, { withFileTypes: true })
  .filter(f => f.isFile() && !f.name.startsWith('_') && /\.(jpe?g|jfif|png|webp|gif|avif)$/i.test(f.name))
  .map(f => f.name)
  .sort();
if (!files.length) throw new Error(`No photos in ${PHOTOS}`);
console.log(`${files.length} photos in card-art/sets/2026-27/photos`);
if (dry) process.exit(0);

const index = join(tmpdir(), `live-photos-index-${process.pid}`);
const env = { ...process.env, GIT_INDEX_FILE: index };
const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', env, maxBuffer: 1 << 26, ...opts }).trim();
try {
  // A batch at a time: Windows caps a command line near 32k characters.
  for (let i = 0; i < files.length; i += 200) {
    git(['--work-tree', PHOTOS, 'add', '--force', '--', ...files.slice(i, i + 200)], { cwd: PHOTOS });
  }
  const tree = git(['write-tree']);
  const commit = git(['commit-tree', tree, '-m', `The base set's photos for the Live Series job (${files.length}), ${new Date().toISOString().slice(0, 10)}`]);
  git(['push', '--force', 'origin', `${commit}:refs/heads/${BRANCH}`], { stdio: ['ignore', 'pipe', 'inherit'] });
  console.log(`Pushed ${files.length} photos to ${BRANCH} (${commit.slice(0, 8)}).`);
} finally {
  rmSync(index, { force: true });
}
