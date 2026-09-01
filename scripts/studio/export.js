// Batch PNG export — the last mile from studio to printed cards.
//
//   npm run export:cards                 exports the current base set
//   npm run export:cards -- --set dissonance
//   npm run export:cards -- --all        every generated set
//
// The dev server must be running (npm run dev): the export drives a headless
// browser through studio-export.html, which renders the SAME CardTemplate the
// studio previews — set prop, badges, awards, crops, team overrides and all —
// so what exports is what was curated. See src/studio/ExportFrame.jsx.
//
// ── WRITE TARGET ────────────────────────────────────────────────────────────
//
// public/cards/{set}/ — SET-SCOPED, never public/cards/players/. That flat
// directory holds the ~300 finished, hand-made 2025-26 cards the running game
// serves; they are not regenerable, and this export derives ids by the same
// rule that named them. The set id always lands in the path below, so a run
// cannot reach them.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The app serves under Vite's base path — the same '/nba-showdown-2k25/' the
// deployed site uses — so the export page lives there too.
const BASE = process.env.STUDIO_URL ?? 'http://localhost:5173/nba-showdown-2k25';
// The template's own print dimensions — the screenshot clips the element, so
// these only bound the viewport.
const VIEWPORT = { width: 900, height: 1250 };

const SET_FILES = {
  '2026-27': 'cards-2026-27.json',
  'super-season': 'cards-super-season.json',
  rookie: 'cards-rookie.json',
  'summer-standouts': 'cards-summer-standouts.json',
  dissonance: 'cards-dissonance.json',
  wnba: 'cards-wnba.json',
  'wnba-rookie': 'cards-wnba-rookie.json',
  'wnba-super-season': 'cards-wnba-super-season.json',
};

const args = process.argv.slice(2);
const all = args.includes('--all');
const setArg = args.includes('--set') ? args[args.indexOf('--set') + 1] : null;
const sets = all ? Object.keys(SET_FILES) : [setArg ?? '2026-27'];

for (const set of sets) {
  if (!SET_FILES[set]) {
    throw new Error(`export: unknown set ${JSON.stringify(set)} — one of ${Object.keys(SET_FILES).join(', ')}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });

for (const set of sets) {
  const file = resolve(process.cwd(), 'card-data', 'generated', SET_FILES[set]);
  if (!existsSync(file)) {
    console.warn(`SKIP set ${set}: ${SET_FILES[set]} not generated`);
    continue;
  }
  const cards = JSON.parse(readFileSync(file, 'utf8')).cards ?? [];
  const out = resolve(process.cwd(), 'public', 'cards', set);
  mkdirSync(out, { recursive: true });

  let done = 0;
  for (const card of cards) {
    const url = `${BASE}/studio-export.html?set=${encodeURIComponent(set)}&id=${encodeURIComponent(card.id)}`;
    await page.goto(url, { waitUntil: 'networkidle' });

    const error = await page.$('#export-error');
    if (error) {
      console.warn(`SKIP ${set}/${card.id}: ${await error.textContent()}`);
      continue;
    }
    // Ready = the photo painted (or the card has none). A hard timeout keeps
    // one broken image from hanging the whole run.
    try {
      await page.waitForSelector('#export-root[data-export-ready="1"]', { timeout: 15000 });
    } catch {
      console.warn(`SKIP ${set}/${card.id}: never became ready`);
      continue;
    }
    const el = await page.$('#export-root > *');
    if (!el) {
      console.warn(`SKIP ${set}/${card.id}: card element did not render`);
      continue;
    }
    await el.screenshot({ path: resolve(out, `${card.id}.png`) });
    done += 1;
    if (done % 25 === 0) console.log(`  ${set}: ${done}/${cards.length}…`);
  }
  console.log(`${set}: exported ${done}/${cards.length} to public/cards/${set}/`);
}

await browser.close();
