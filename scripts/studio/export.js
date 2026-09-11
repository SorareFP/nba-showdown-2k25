// Batch PNG export — the last mile from studio to printed cards.
//
//   npm run export:cards                 exports the current base set
//   npm run export:cards -- --set dissonance
//   npm run export:cards -- --all        every generated set
//   npm run export:cards -- --all --prune  and delete cards the set no longer has
//   npm run export:cards -- --all --missing            only faces that do not exist yet
//   npm run export:cards -- --set rookie --only Buddy_Hield,Landry_Shamet
//   npm run export:cards -- --set super-season --measure    boxes only, no PNGs
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
import { spawnSync } from 'node:child_process';
import { hasMigratedOut } from '../../src/game/cardSets.js';
import { mkdirSync, readFileSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  // The two capstone sets (2026-09-06). Their cards are MIGRATED from the
  // special sets, whose exports skip a migrated id, so these are the only
  // place those faces are ever rendered.
  'set-rewards': 'cards-set-rewards.json',
  'wnba-set-rewards': 'cards-wnba-set-rewards.json',
  // Request-only sets: no generated file exists, and cardsFor falls back to
  // the requested cards built into them (cards-free-agents.json).
  throwbacks: 'cards-throwbacks.json',
  'wnba-throwbacks': 'cards-wnba-throwbacks.json',
  // THE STRATEGY DECK IS NOT A GENERATED FILE. Its cards are declared in
  // src/game/strats.js rather than built by a generator, so it names no JSON —
  // `null` marks a set whose list comes from code. It exports like any other
  // set otherwise, through the same StratTemplate the studio composes with.
  strats: null,
};

/** The cards of one set: from its generated file, or from code. */
async function cardsFor(set) {
  if (set === 'strats') return (await import('../../src/game/strats.js')).STRATS;
  // Requested cards (Free Agents) live in their own file and join the set
  // each was built into, here as in the game (src/game/cardSets.js).
  const freeAgentsFile = resolve(process.cwd(), 'card-data', 'generated', 'cards-free-agents.json');
  const joining = existsSync(freeAgentsFile)
    ? (JSON.parse(readFileSync(freeAgentsFile, 'utf8')).cards ?? []).filter(c => c.set === set)
    : [];
  const file = resolve(process.cwd(), 'card-data', 'generated', SET_FILES[set]);
  // A set made ONLY of requests (Throwbacks) has no generated file: its cards
  // are the requests built into it.
  if (!existsSync(file)) return joining.length ? joining : null;
  const cards = [...(JSON.parse(readFileSync(file, 'utf8')).cards ?? []), ...joining];
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
// --measure       measure the face's movable gold surfaces (the rotated name,
//                 the Super Season pill) and write them to face-regions.json
//                 WITHOUT screenshotting — the fast pass. A normal export
//                 measures too, so the file stays in step with the faces.
const measureOnly = args.includes('--measure');
const REGIONS_FILE = resolve(process.cwd(), 'card-data', 'generated', 'face-regions.json');
const regions = existsSync(REGIONS_FILE) ? JSON.parse(readFileSync(REGIONS_FILE, 'utf8')) : { faces: {} };
regions.faces ??= {};
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
    // THE MOVABLE GOLD, measured. The band and the frame sit where the
    // template puts them (src/cards/faceRegions.js); the rotated name and the
    // Super Season pill do not — the pill stacks under whatever marks the
    // sidebar holds — so the app's sheen (HoloSheen.jsx) reads their boxes
    // from here, as fractions of the card. CSS-module classes are hashed, so
    // the match is on the `_name_` core of the class.
    if (set !== 'strats') {
      const measured = await el.evaluate(root => {
        const box = root.getBoundingClientRect();
        const frac = r => [
          Number(((r.left - box.left) / box.width).toFixed(4)), Number(((r.top - box.top) / box.height).toFixed(4)),
          Number((r.width / box.width).toFixed(4)), Number((r.height / box.height).toFixed(4)),
        ];
        const name = [...root.querySelectorAll('[class*="_nameText_"]')][0];
        const pill = [...root.querySelectorAll('[class*="_badge_"]')].find(b => /super season/i.test(b.textContent || ''));
        return { name: name ? frac(name.getBoundingClientRect()) : null, badge: pill ? frac(pill.getBoundingClientRect()) : null };
      });
      regions.faces[`${set}/${card.id}`] = measured;
    }
    if (!measureOnly) await el.screenshot({ path: resolve(out, `${card.id}.png`) });
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
regions.generatedAt = new Date().toISOString();
regions.note = 'Per-face boxes of the rotated name and the Super Season pill, as fractions of the 843x1181 face, measured by scripts/studio/export.js. Read by src/cards/faceRegions.js for the holographic sheen.';
writeFileSync(REGIONS_FILE, `${JSON.stringify(regions, null, 2)}\n`);
console.log(`face-regions.json: ${Object.keys(regions.faces).length} faces measured`);

// THE THUMBS FOLLOW THE FACES. Up-to-date ones are skipped by mtime, so this
// costs seconds after a partial export. Python is what the studio's other
// image steps use (paintPlaceholders.py); a machine without it just skips.
if (!measureOnly) {
  const t = spawnSync('python', [resolve('scripts/studio/thumbs.py')], { stdio: 'inherit' });
  if (t.error || t.status !== 0) console.warn('thumbs: skipped (python scripts/studio/thumbs.py failed to run) — tiles fall back to the full faces');
}
