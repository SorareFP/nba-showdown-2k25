// Batch PNG export — the last mile from studio to printed cards.
//
//   npm run export:cards                 exports the current base set
//   npm run export:cards -- --set dissonance
//   npm run export:cards -- --all        every generated set
//   npm run export:cards -- --all --prune  and delete cards the set no longer has
//   npm run export:cards -- --all --missing            only faces that do not exist yet
//   npm run export:cards -- --set rookie --only Buddy_Hield,Landry_Shamet
//
// The dev server must be running (npm run dev): the export drives a headless
// browser through studio-export.html, which renders the SAME CardTemplate the
// studio previews — set prop, badges, awards, crops, team overrides and all —
// so what exports is what was curated. See src/studio/ExportFrame.jsx.
//
// ── --prune, AND WHY IT IS NOT THE DEFAULT ──────────────────────────────────
//
// The export writes one PNG per card and never deletes, so a directory
// accumulates every card any past version of a set ever had. After a season of
// re-picks that is 222 files and 32 MB — 6% of everything `dist/` ships is
// cards the game no longer has.
//
// It is opt-in because deleting is the one thing here that cannot be undone by
// running it again, and because a mismatch is sometimes the SET being wrong
// rather than the file being stale: a half-finished generator run leaves a set
// short, and pruning against it would throw away good cards that a re-run would
// have matched. Look at the list it prints before trusting it.
//
// ── WRITE TARGET ────────────────────────────────────────────────────────────
//
// public/cards/{set}/ — SET-SCOPED, never public/cards/players/. That flat
// directory holds the ~300 finished, hand-made 2025-26 cards the running game
// serves; they are not regenerable, and this export derives ids by the same
// rule that named them. The set id always lands in the path below, so a run
// cannot reach them.
import { chromium } from 'playwright';
import { hasMigratedOut } from '../../src/game/cardSets.js';
import { mkdirSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
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
  // Registered when the team-completion set shipped. A set missing from this
  // map is not an error until someone names it — `--all` simply skips it — so
  // a new set has to be added here as well as to its generator.
  'team-rewards': 'cards-team-rewards.json',
  wnba: 'cards-wnba.json',
  'wnba-rookie': 'cards-wnba-rookie.json',
  'wnba-super-season': 'cards-wnba-super-season.json',
  'wnba-team-rewards': 'cards-wnba-team-rewards.json',
  // THE STRATEGY DECK IS NOT A GENERATED FILE. Its cards are declared in
  // src/game/strats.js rather than built by a generator, so it names no JSON —
  // `null` marks a set whose list comes from code. It exports like any other
  // set otherwise, through the same StratTemplate the studio composes with.
  strats: null,
};

/** The cards of one set: from its generated file, or from code. */
async function cardsFor(set) {
  if (set === 'strats') return (await import('../../src/game/strats.js')).STRATS;
  const file = resolve(process.cwd(), 'card-data', 'generated', SET_FILES[set]);
  if (!existsSync(file)) return null;
  const cards = JSON.parse(readFileSync(file, 'utf8')).cards ?? [];
  // MIGRATED CARDS ARE NOT IN THIS SET ANY MORE. The generated file still holds
  // them — the reward generator copies rather than deletes, so the origin file
  // stays a complete record — but the game and the studio both filter on
  // `migratedFrom`, and the studio is what renders here.
  //
  // Iterating the unfiltered list did not export anything wrong: ExportFrame
  // looked each id up in the STUDIO's list, missed the twenty migrated ones and
  // skipped them. What it did was print twenty lines reading "SKIP
  // super-season/Paul_George: no card Paul_George in set super-season", which
  // is correct behaviour described as a failure, and a count of 215/225 that
  // invited somebody to go looking for ten missing cards.
  return cards.filter(card => !hasMigratedOut(set, card.id));
}

const args = process.argv.slice(2);
const all = args.includes('--all');
const prune = args.includes('--prune');
const setArg = args.includes('--set') ? args[args.indexOf('--set') + 1] : null;
// --only a,b,c   export just these card ids (in the set named, or every set with --all)
// --missing      export only cards that have no face yet
// Either one turns --prune off: a partial run must never decide what is stale.
const only = args.includes('--only')
  ? new Set(String(args[args.indexOf('--only') + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean))
  : null;
const missingOnly = args.includes('--missing');
const sets = all ? Object.keys(SET_FILES) : [setArg ?? '2026-27'];

for (const set of sets) {
  // `in`, not truthiness: `strats` maps to null on purpose and is still a set.
  if (!(set in SET_FILES)) {
    throw new Error(`export: unknown set ${JSON.stringify(set)} — one of ${Object.keys(SET_FILES).join(', ')}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });

for (const set of sets) {
  const cards = await cardsFor(set);
  if (!cards) {
    console.warn(`SKIP set ${set}: ${SET_FILES[set]} not generated`);
    continue;
  }
  const out = resolve(process.cwd(), 'public', 'cards', set);
  mkdirSync(out, { recursive: true });
  const wanted = cards.filter(card =>
    (!only || only.has(card.id)) && (!missingOnly || !existsSync(resolve(out, `${card.id}.png`)))
  );
  if ((only || missingOnly) && wanted.length === 0) { console.log(`${set}: nothing to export`); continue; }

  let done = 0;
  for (const card of wanted) {
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
    if (done % 25 === 0) console.log(`  ${set}: ${done}/${wanted.length}…`);
  }
  console.log(`${set}: exported ${done}/${wanted.length} to public/cards/${set}/`);

  if (prune && !only && !missingOnly) {
    const ids = new Set(cards.map(c => c.id));
    const stale = readdirSync(out).filter(f => f.endsWith('.png') && !ids.has(f.slice(0, -4)));
    for (const f of stale) rmSync(resolve(out, f));
    if (stale.length) {
      console.log(`  pruned ${stale.length}: ${stale.map(f => f.slice(0, -4)).join(', ')}`);
    }
  }
}

await browser.close();
