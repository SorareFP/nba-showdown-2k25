// Knock the flat background out of a logo or trophy image, without eating the
// subject.
//
//   node scripts/studio/stripBackground.mjs <in> <out> [--tol 40] [--bg r,g,b] [--thin 0.12] [--no-trim]
//   node scripts/studio/stripBackground.mjs public/awards/DPOY.jpg public/awards/DPOY.png
//
// ── WHY THIS EXISTS, AND WHAT THE OBVIOUS METHOD GETS WRONG ─────────────────
//
// The obvious strip is a COLOUR KEY: make every pixel within some tolerance of
// the background colour transparent. It is one line and it is wrong, because a
// trophy is shiny. The Defensive Player of the Year mark is chrome with white
// specular highlights, and a white key removes those highlights along with the
// background — so the trophy comes back with holes punched through it. That is
// exactly what had happened to four of the nine award marks:
//
//     DPOY  15.4% of the subject missing      MIP   10.7%
//     6MOY   6.0%                             ROY    4.3%
//
// What this does instead is a FLOOD FILL FROM THE BORDER. A pixel is background
// only if it matches the background colour AND is reachable from the edge of
// the image without crossing the subject. A highlight enclosed by chrome is
// unreachable, so it survives; the sky behind the trophy is reachable, so it
// goes. The distinction is connectivity, not colour, and connectivity is the
// thing the colour key throws away.
//
// TWO SMALLER DECISIONS, both to keep the result from looking cut out:
//
//   FEATHER   The fill's frontier is aliased — a hard 1px boundary that reads
//             as a sticker. Pixels adjacent to removed ones get partial alpha
//             in proportion to how close they were to the key, which restores
//             the soft edge the original had against its background.
//
//   TRIM      The source usually has slack around the subject. Cropping to the
//             opaque bounding box means CardTemplate's `object-fit: contain`
//             fits the MARK to the slot rather than fitting the mark's padding,
//             so every trophy ends up optically the same size. --no-trim opts
//             out for a mark whose framing is deliberate.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const VALUED = new Set(['--tol', '--bg', '--thin']);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.has(args[i - 1])));
const [input, output] = positional;
const tol = Number(flag('--tol', 40));
const trim = !args.includes('--no-trim');
// --bg OVERRIDES the sampled background. Needed when the border is not the
// thing being removed: the Tempo mark sits on a bordeaux plate inside a thin
// near-black outline, so sampling the border keys on the outline and strips a
// 1px frame instead of the plate.
const bgArg = flag('--bg', null);
// --thin is how far below the subject's own top edge, as a share of the frame,
// a MARGINAL column may start before it reads as shadow rather than subject.
// 1 keeps the plain bounding box; 0.5 is loose enough that a low-hanging part
// of a mark still counts, and tight enough to catch a floor reflection.
const thin = Number(flag('--thin', 0.5));

if (!input || !output) {
  console.error('usage: stripBackground.mjs <in> <out> [--tol 40] [--no-trim]');
  process.exit(1);
}
if (!fs.existsSync(input)) {
  console.error(`stripBackground: no such file ${input}`);
  process.exit(1);
}

const ext = path.extname(input).toLowerCase();
const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
  : ext === '.webp' ? 'image/webp'
  : ext === '.gif' ? 'image/gif'
  : 'image/png';

const browser = await chromium.launch();
const page = await browser.newPage();
const src = `data:${mime};base64,${fs.readFileSync(input).toString('base64')}`;

const result = await page.evaluate(async ({ src, tol, trim, bgArg, thin }) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, W, H);
  const d = image.data;

  // The background colour is whatever the border is MOSTLY made of — more
  // robust than sampling one corner, which a watermark or a rounded plate can
  // easily make unrepresentative.
  const tally = new Map();
  const push = i => {
    if (d[i * 4 + 3] < 32) return;
    const k = `${d[i * 4] >> 3},${d[i * 4 + 1] >> 3},${d[i * 4 + 2] >> 3}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  };
  for (let x = 0; x < W; x++) { push(x); push(x + (H - 1) * W); }
  for (let y = 0; y < H; y++) { push(y * W); push(W - 1 + y * W); }
  let bg = [255, 255, 255];
  let bestN = 0;
  const forced = bgArg ? bgArg.split(',').map(Number) : null;
  for (const [k, n] of tally) {
    if (n > bestN) { bestN = n; bg = k.split(',').map(v => Number(v) * 8 + 4); }
  }

  if (forced) bg = forced;
  const dist = i => Math.hypot(d[i * 4] - bg[0], d[i * 4 + 1] - bg[1], d[i * 4 + 2] - bg[2]);

  // Flood fill from the border across pixels within tolerance of the background.
  const removed = new Uint8Array(W * H);
  const stack = [];
  const seed = i => { if (!removed[i] && dist(i) <= tol) { removed[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { seed(x); seed(x + (H - 1) * W); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(W - 1 + y * W); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % W, y = (i / W) | 0;
    if (x > 0) seed(i - 1);
    if (x < W - 1) seed(i + 1);
    if (y > 0) seed(i - W);
    if (y < H - 1) seed(i + W);
  }

  // Feather: a kept pixel touching a removed one gets partial alpha, scaled by
  // how far it sits from the key colour across the tolerance band.
  const alpha = new Uint8Array(W * H).fill(255);
  for (let i = 0; i < W * H; i++) if (removed[i]) alpha[i] = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (removed[i]) continue;
      const touches =
        (x > 0 && removed[i - 1]) || (x < W - 1 && removed[i + 1]) ||
        (y > 0 && removed[i - W]) || (y < H - 1 && removed[i + W]);
      if (!touches) continue;
      const t = Math.min(1, dist(i) / Math.max(tol, 1));
      alpha[i] = Math.round(255 * t);
    }
  }
  for (let i = 0; i < W * H; i++) d[i * 4 + 3] = Math.min(d[i * 4 + 3], alpha[i]);
  ctx.putImageData(image, 0, 0);

  let box = { x: 0, y: 0, w: W, h: H };
  if (trim) {
    const colH = new Int32Array(W), rowW = new Int32Array(H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] < 8) continue;
        colH[x] += 1; rowW[y] += 1;
      }
    }
    // THE SHADOW PROBLEM. These are product shots, so the trophy stands on its
    // own reflection — and the reflection survives the strip legitimately,
    // because it is darker than the backdrop and CONNECTED to the trophy's base
    // (one component spans the full frame, so no component filter can separate
    // them). Trimming to the opaque bounding box therefore boxes the trophy
    // AND its shadow, and `object-fit: contain` then shrinks the trophy to fit
    // a box half of which is smear.
    //
    // What separates them is not colour, connectivity, or even height. HEIGHT
    // WAS TRIED FIRST and it fails on this very trophy: the crown flares wider
    // than the stem, so the outermost real columns are SHORT ones, and a rule
    // that drops short margins shears the flare off. (It did, visibly, at 0.30.)
    //
    // The reliable difference is WHERE a column's ink sits. Every column of the
    // trophy reaches up into the body; the reflection exists only along the
    // bottom. So a marginal column is shadow when its TOPMOST opaque pixel
    // starts more than `thin` of the frame below where the subject itself
    // starts — a flare column begins at the crown and stays, a smear column
    // begins near the floor and goes.
    //
    // Edges are walked inward and stop at the first column that qualifies, so
    // this can only ever crop MARGINS: an interior column is never dropped, and
    // a mark with no shadow keeps its own bounding box untouched.
    const colTop = new Int32Array(W).fill(H);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (d[(y * W + x) * 4 + 3] >= 8) { colTop[x] = y; break; }
      }
    }
    let subjectTop = H;
    for (let x = 0; x < W; x++) if (colH[x] > 0 && colTop[x] < subjectTop) subjectTop = colTop[x];
    const okCol = x => colH[x] > 0 && colTop[x] <= subjectTop + thin * H;
    let x0 = 0, x1 = W - 1;
    while (x0 <= x1 && !okCol(x0)) x0 += 1;
    while (x1 >= x0 && !okCol(x1)) x1 -= 1;
    // Rows are a plain bounding box over the columns that survived, so cropping
    // the smear horizontally also drops the rows it alone occupied.
    let y0 = H, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = x0; x <= x1; x++) {
        if (d[(y * W + x) * 4 + 3] < 8) continue;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        break;
      }
    }
    if (x1 >= x0 && y1 >= y0) box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  const out = document.createElement('canvas');
  out.width = box.w; out.height = box.h;
  out.getContext('2d').drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);

  // Report enclosed holes so a bad strip is visible in the run, not later on a
  // card: transparency the border fill never reached is damage to the subject.
  const od = out.getContext('2d').getImageData(0, 0, box.w, box.h).data;
  const N = box.w * box.h;
  const OUT = new Uint8Array(N);
  const st = [];
  for (let x = 0; x < box.w; x++) { st.push(x, x + (box.h - 1) * box.w); }
  for (let y = 0; y < box.h; y++) { st.push(y * box.w, box.w - 1 + y * box.w); }
  while (st.length) {
    const i = st.pop();
    if (OUT[i] || od[i * 4 + 3] >= 32) continue;
    OUT[i] = 1;
    const x = i % box.w, y = (i / box.w) | 0;
    if (x > 0) st.push(i - 1);
    if (x < box.w - 1) st.push(i + 1);
    if (y > 0) st.push(i - box.w);
    if (y < box.h - 1) st.push(i + box.w);
  }
  let opaque = 0, holes = 0;
  for (let i = 0; i < N; i++) {
    if (od[i * 4 + 3] >= 32) opaque++;
    else if (!OUT[i]) holes++;
  }
  return {
    dataUrl: out.toDataURL('image/png'),
    bg, W, H, out: { w: box.w, h: box.h },
    holePct: opaque + holes ? (100 * holes / (opaque + holes)) : 0,
  };
}, { src, tol, trim, bgArg, thin });

await browser.close();
fs.writeFileSync(output, Buffer.from(result.dataUrl.split(',')[1], 'base64'));
console.log(
  `${path.basename(input)} -> ${path.basename(output)}  ` +
  `bg rgb(${result.bg.join(',')}) tol ${tol}  ` +
  `${result.W}x${result.H} -> ${result.out.w}x${result.out.h}  ` +
  `enclosed holes ${result.holePct.toFixed(1)}%`
);
