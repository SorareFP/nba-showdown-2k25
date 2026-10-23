// THE LIVE FACES MATCH THE LIVE NUMBERS, OR THE DEPLOY STOPS (2026-10-23).
//
//   node scripts/studio/checkLiveFaces.mjs        # run by `npm run deploy` (predeploy)
//
// The Live Series' faces are not committed (.gitignore: public/cards/live):
// the nightly job exports them and publishes. A deploy from a machine ships
// whatever Live faces that machine has — and on 2026-10-23 that was the
// September mirror, so Kawhi Leonard's face still printed $1,990 and 14/15
// over a card the game read as $1,690 and 13/9 (the user: "his face hasn't
// changed"). A face older than the Live data it should print is refused here,
// with the command that fixes it. SKIP_LIVE_FACE_CHECK=1 lets a deploy through
// on purpose.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from '../cardgen/cache.js';

export const LIVE_DATA = path.join(REPO_ROOT, 'card-data', 'generated', 'cards-live.json');
export const LIVE_FACES = path.join(REPO_ROOT, 'public', 'cards', 'live');

/**
 * The Live cards whose face is missing or older than the data. `mtimeOf(id)`
 * is the face's modified time in ms, or null when there is none.
 */
export function staleLiveFaces({ cards, dataAt, mtimeOf }) {
  return (cards ?? []).filter(c => {
    const at = mtimeOf(c.id);
    return at == null || at < dataAt;
  }).map(c => c.id);
}

export function main({ log = console.log, env = process.env } = {}) {
  if (env.SKIP_LIVE_FACE_CHECK === '1') { log('Live faces: check skipped (SKIP_LIVE_FACE_CHECK=1).'); return 0; }
  if (!fs.existsSync(LIVE_DATA)) return 0;
  const data = JSON.parse(fs.readFileSync(LIVE_DATA, 'utf8'));
  // When the numbers were made: the run's own stamp, else the file's time.
  const stamp = Date.parse(data.live?.asOf ?? data.generatedAt ?? '');
  const dataAt = Number.isFinite(stamp) ? stamp : fs.statSync(LIVE_DATA).mtimeMs;
  const stale = staleLiveFaces({
    cards: data.cards,
    dataAt,
    mtimeOf: id => {
      const f = path.join(LIVE_FACES, `${id}.png`);
      return fs.existsSync(f) ? fs.statSync(f).mtimeMs : null;
    },
  });
  if (!stale.length) { log(`Live faces: all ${data.cards?.length ?? 0} match the numbers of ${new Date(dataAt).toISOString()}.`); return 0; }
  log(`Live faces: ${stale.length} of ${data.cards.length} are older than the Live numbers (${new Date(dataAt).toISOString()}), e.g. ${stale.slice(0, 3).join(', ')}.`);
  // The nightly job exports every face just before it publishes: a face that
  // would not render there is one card behind, not a reason to hold back the
  // night's numbers for all of them.
  if (env.CI === 'true') { log('(the nightly job publishes anyway)'); return 0; }
  log('Deploying now would print last numbers on this season\'s cards. Re-export them first (the Studio dev server running):');
  log('  npm run export:cards -- --set live --jobs 6');
  log('or deploy anyway with SKIP_LIVE_FACE_CHECK=1.');
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main());
