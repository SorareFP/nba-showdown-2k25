// Move team logos from where they are SOURCED to where they are SERVED.
//
//   node scripts/studio/installLogos.mjs           # everything not yet installed
//   node scripts/studio/installLogos.mjs UTA96     # named marks only
//   node scripts/studio/installLogos.mjs --force   # redo even if present
//   node scripts/studio/installLogos.mjs PORF --strip   # knock out a flat background
//
// ── THE TWO DIRECTORIES, AND WHY THERE ARE TWO ──────────────────────────────
//
//   card-art/logo-originals/   what was downloaded, in whatever format it came
//   public/logos/              what the app serves, always PNG
//
// The app probes `/logos/{KEY}.png` and falls back to a lettered circle, so a
// mark that only exists as a GIF in the originals directory is, to the running
// game, a mark that does not exist. That is not hypothetical: eight era logos
// arrived as six PNGs and two GIFs and none of them lit up, because the step
// between the two directories was somebody remembering to do it by hand.
//
// ── WHY PLAYWRIGHT CONVERTS THE GIFS ────────────────────────────────────────
//
// There is no `sharp` and no ImageMagick here — and the `convert` on PATH under
// Windows is the filesystem tool, which must never be invoked by accident.
// Playwright is already a dependency for the card export, and a headless
// browser decodes a GIF and re-encodes a PNG perfectly well: load the image at
// its natural size on a transparent page and screenshot the element. Animated
// GIFs give their first frame, which is the right frame for a logo.
//
// ── AND WHY --strip EXISTS ──────────────────────────────────────────────────
//
// `omitBackground` makes the PAGE transparent. It cannot help with a background
// that is baked into the image, which is most GIFs: they carry a flat white
// rectangle rather than an alpha channel. The Portland Fire mark arrived that
// way and landed on the card as a white tile.
//
// Stripping is a FLOOD FILL FROM THE EDGES, not "delete every white pixel".
// The difference matters on exactly the logos worth having: PORTLAND's wordmark
// has white inside the letters, and a blanket white-to-transparent rule would
// hole them out. Only background reachable from the border goes.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from '../cardgen/cache.js';

const SRC = path.join(REPO_ROOT, 'card-art', 'logo-originals');
const OUT = path.join(REPO_ROOT, 'public', 'logos');

/** Formats a browser will decode. Anything else is reported, not guessed at. */
const READABLE = new Set(['.png', '.gif', '.jpg', '.jpeg', '.webp', '.avif']);

/** Every source mark, as `KEY -> absolute path`. Subdirectories are leagues. */
export function sourceMarks(dir = SRC, prefix = '') {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
        Object.assign(out, sourceMarks(full, [prefix, entry.name].filter(Boolean).join('/')));
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!READABLE.has(ext)) continue;
    // FORWARD SLASHES ALWAYS. `path.join` gives backslashes on Windows, and the
    // key is used both as a CLI argument and as the tail of a served URL —
    // neither of which is ever spelled with a backslash.
    const key = [prefix, path.basename(entry.name, path.extname(entry.name))]
      .filter(Boolean)
      .join('/');
    // A PNG beats a GIF of the same mark: it needs no conversion and is what
    // the app wants anyway.
    if (out[key] && ext !== '.png') continue;
    out[key] = full;
  }
  return out;
}

/**
 * Runs IN THE PAGE. Clears background connected to the border and returns a PNG
 * data URL.
 *
 * Four-way flood fill seeded from every edge pixel, matching within `tolerance`
 * of that seed's colour, so a mark on white loses the white around it and keeps
 * the white inside it. Colours are compared per channel rather than by
 * distance: a soft anti-aliased edge shades toward the background on all three
 * at once, and a per-channel bound tracks that more tightly than a radius does.
 */
function stripEdgeBackground({ tolerance }) {
  const img = document.getElementById('m');
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  const W = c.width;
  const H = c.height;
  const at = (x, y) => (y * W + x) * 4;

  const seed = [d[0], d[1], d[2]];
  const near = i =>
    Math.abs(d[i] - seed[0]) <= tolerance &&
    Math.abs(d[i + 1] - seed[1]) <= tolerance &&
    Math.abs(d[i + 2] - seed[2]) <= tolerance;

  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x += 1) { stack.push([x, 0], [x, H - 1]); }
  for (let y = 0; y < H; y += 1) { stack.push([0, y], [W - 1, y]); }

  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const p = y * W + x;
    if (seen[p]) continue;
    const i = at(x, y);
    if (!near(i)) continue;
    seen[p] = 1;
    d[i + 3] = 0;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  g.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
}

export async function main({ log = console.log, only = [], force = false, strip = false } = {}) {
  const marks = sourceMarks();
  const wanted = only.length ? only.filter(k => marks[k] || log(`  ${k}: no source file`)) : Object.keys(marks);

  const todo = wanted.filter(key => {
    const dest = path.join(OUT, `${key}.png`);
    if (force || !fs.existsSync(dest)) return true;
    // Already installed and the source has not moved since.
    return fs.statSync(marks[key]).mtimeMs > fs.statSync(dest).mtimeMs;
  });

  log(`${wanted.length} source mark(s), ${todo.length} to install.`);
  if (todo.length === 0) return { copied: 0, converted: 0 };

  // WITH --strip EVERYTHING GOES THROUGH THE BROWSER, PNGs included. A baked
  // white rectangle is not a GIF problem — four of the eight NBA era logos
  // arrived as PNGs with one — and a straight copy preserves it perfectly.
  const straight = strip ? [] : todo.filter(k => path.extname(marks[k]).toLowerCase() === '.png');
  const convert = strip ? todo : todo.filter(k => path.extname(marks[k]).toLowerCase() !== '.png');

  for (const key of straight) {
    const dest = path.join(OUT, `${key}.png`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(marks[key], dest);
    log(`  copied    ${key}`);
  }

  if (convert.length) {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    for (const key of convert) {
      const dest = path.join(OUT, `${key}.png`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // A DATA URI, NOT A file:// URL. `setContent` gives an about:blank page,
      // which is a different origin from the filesystem and is refused the
      // load — silently, so the image simply never completes and the wait
      // times out. Inlining the bytes sidesteps the origin question entirely.
      const ext = path.extname(marks[key]).toLowerCase().slice(1);
      const mime = ext === 'jpg' ? 'jpeg' : ext;
      const url = `data:image/${mime};base64,${fs.readFileSync(marks[key]).toString('base64')}`;
      // `omitBackground` is what keeps a logo's transparency: without it the
      // page's white paints in behind every mark and they all arrive on a card
      // as white tiles.
      await page.setContent(
        `<body style="margin:0;background:transparent">
           <img id="m" src="${url}" style="display:block">
         </body>`
      );
      await page.waitForFunction(() => {
        const img = document.getElementById('m');
        return img && img.complete && img.naturalWidth > 0;
      }, { timeout: 15000 });
      const el = await page.$('#m');
      const box = await el.boundingBox();
      if (strip) {
        const png = await page.evaluate(stripEdgeBackground, { tolerance: 26 });
        fs.writeFileSync(dest, Buffer.from(png.split(',')[1], 'base64'));
      } else {
        await el.screenshot({ path: dest, omitBackground: true });
      }
      log(`  ${strip ? 'stripped ' : 'converted'} ${key}  ${path.extname(marks[key])} -> png  ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    await browser.close();
  }

  log(`\n${straight.length} copied, ${convert.length} converted.`);
  return { copied: straight.length, converted: convert.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  await main({
    only: args.filter(a => !a.startsWith('--')),
    force: args.includes('--force'),
    strip: args.includes('--strip'),
  });
}
