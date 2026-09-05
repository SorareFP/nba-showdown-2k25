// Rasterise the card back to public/card-back.png.
//
//   node scripts/studio/exportCardBack.mjs        # needs the dev server running
//
// ── WHY THIS IS ITS OWN SCRIPT ──────────────────────────────────────────────
//
// export.js walks SETS and screenshots one card per id. The back is not a card
// and belongs to no set, so bending that loop around it would mean a set-shaped
// hole in every list it reads. It shares the machinery that matters — the same
// export page, the same 843x1181 element, the same Playwright screenshot — and
// nothing else.
//
// ── WHY IT OVERWRITES A CHECKED-IN PNG ──────────────────────────────────────
//
// public/card-back.png is served directly by the running game (PackOpening
// renders it four or five times per pack, once for every card in the peek
// stack), so the PNG is the artefact and the component is the source. The old
// one said NBA SHOWDOWN 2K25 — a name the game no longer uses — which is the
// whole reason this exists.
import { chromium } from 'playwright';
import { resolve, basename } from 'node:path';
import { existsSync, copyFileSync } from 'node:fs';

const BASE = process.env.STUDIO_URL ?? 'http://localhost:5173/nba-showdown-2k25';
// Two backs from one page: the NBA ball, and the WNBA's two-tone one. Driven
// off ?league= rather than a second component, so a change to the back's layout
// lands on both or neither.
const BACKS = [
  { league: 'NBA', out: resolve(process.cwd(), 'public', 'card-back.png') },
  { league: 'WNBA', out: resolve(process.cwd(), 'public', 'card-back-wnba.png') },
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 900, height: 1250 },
  // Rasterise at 1x. The element is already 843x1181 print pixels; a device
  // scale factor would double that and the pack screen would be downscaling a
  // 1686px image to 340px for no gain.
  deviceScaleFactor: 1,
});

for (const { league, out } of BACKS) {
  // KEEP THE OLD ONE ONCE. The back is checked in rather than generated at
  // build time, so a bad render would otherwise overwrite the only copy with no
  // way back that does not involve git.
  if (existsSync(out) && !existsSync(`${out}.bak`)) {
    copyFileSync(out, `${out}.bak`);
    console.log(`kept the previous back at ${out}.bak`);
  }

  await page.goto(`${BASE}/studio-export.html?back=1&league=${league}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#export-root[data-export-ready="1"]', { timeout: 15000 });

  const el = await page.$('#export-root > *');
  if (!el) {
    await browser.close();
    throw new Error(`${league} card back did not render`);
  }
  const box = await el.boundingBox();
  await el.screenshot({ path: out });

  const size = `${Math.round(box.width)}x${Math.round(box.height)}`;
  console.log(`wrote public/${basename(out)} at ${size}`);
  if (Math.round(box.width) !== 843 || Math.round(box.height) !== 1181) {
    console.warn('  WARNING: not the 843x1181 print size the card faces use.');
  }
}

await browser.close();
