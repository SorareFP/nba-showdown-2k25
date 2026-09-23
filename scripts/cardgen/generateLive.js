// THE LIVE SERIES — card-data/generated/cards-live.json.
//
//   node scripts/cardgen/generateLive.js                # mirror the base set (today)
//   node scripts/cardgen/generateLive.js --mode season  # the season's numbers (not wired yet)
//
// The user (2026-09-23): "the 26-27 base cards with an electric blue trim like
// the green of the rookie cards, and what these are going to do is contain a
// live export using the expected EPM page of dunks and threes … Those will
// need a job to run each day that reallocates stats and re-exports the faces."
//
// ── TWO MODES ────────────────────────────────────────────────────────────────
//
// MIRROR (now, before the season): every 2026-27 base card again, the same
// id and the same numbers, in the `live` set with the LIVE pill. That is what
// registers the set, exports its faces and lets the pack and collection
// wiring be built and tested before there is anything live to show.
//
// SEASON (the nightly job, .github/workflows/live-series.yml): the same
// cards re-allocated from the season as it happens — Speed, Power and Def
// Boost from dunksandthrees' current-season EPM (sources/dunksAndThrees.js
// reads /epm, the stabilised "expected" table, and /epm/actual), the shot
// lines and the roll charts from the last-82 window as this season's game
// logs replace last season's (realGames.js). The user chose "everything,
// daily". That path is NOT wired yet: generateCards.js reads the whole
// card-data/cache (325 MB, gitignored) and a fixed CURRENT_STATS_SEASON, and
// a runner has neither. The plan — a compact committed basis of each pool
// player's windowed game rows, plus a season-parameterised generate — is in
// docs/plans/2026-09-23-live-series-design.md. Until then `--mode season`
// refuses, loudly, so the nightly job cannot silently ship a mirror as live.
//
// Every card carries `live: { mode, asOf, source }` so a face, a tile or a
// test can tell what it is looking at, and live-status.json says the same
// for the whole set.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './cache.js';
import { CURRENT_SET, LIVE_SET } from '../../src/cards/sets.js';
import { LIVE_BADGE } from '../../src/cards/badges.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const BASE_FILE = path.join(GEN_DIR, `cards-${CURRENT_SET}.json`);
export const OUTPUT_FILE = path.join(GEN_DIR, `cards-${LIVE_SET}.json`);
export const STATUS_FILE = path.join(GEN_DIR, 'live-status.json');
export const MODES = ['mirror', 'season'];

/** One base card as its live twin: the same numbers, the set and the pill changed, a stamp saying so. */
export function liveCard(card, { mode, asOf, source }) {
  const badges = [...new Set([...(card.badges ?? []), LIVE_BADGE])];
  return { ...card, set: LIVE_SET, badges, live: { mode, asOf, source } };
}

export function main({ mode = 'mirror', asOf = new Date().toISOString(), log = console.log } = {}) {
  if (!MODES.includes(mode)) throw new Error(`generateLive: no such mode ${mode} (${MODES.join(', ')})`);
  if (mode === 'season') {
    throw new Error(
      'generateLive: the season mode is not wired yet — see docs/plans/2026-09-23-live-series-design.md. ' +
      'Run without --mode to mirror the base set.'
    );
  }
  const base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));
  const source = `cards-${CURRENT_SET}.json`;
  const cards = base.cards.map(c => liveCard(c, { mode, asOf, source }));
  const body = {
    set: LIVE_SET,
    generatedAt: asOf,
    live: { mode, asOf, source },
    note:
      'THE LIVE SERIES (scripts/cardgen/generateLive.js): the 2026-27 base cards as the season moves them. ' +
      `Mode "${mode}"${mode === 'mirror' ? ' — a mirror of the base set until the season starts' : ''}. ` +
      'Faces: node scripts/studio/export.js --set live; photos are the base set\'s (setPaths).',
    cards,
  };
  fs.mkdirSync(GEN_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(body, null, 1)}\n`);
  fs.writeFileSync(STATUS_FILE, `${JSON.stringify({ set: LIVE_SET, mode, asOf, source, cards: cards.length }, null, 1)}\n`);
  log(`Live Series: ${cards.length} cards, mode ${mode}, as of ${asOf}.\n  ${OUTPUT_FILE}`);
  return body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--mode');
  main({ mode: i >= 0 ? argv[i + 1] : 'mirror' });
}
