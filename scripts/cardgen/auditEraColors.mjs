// What colours an era mark ACTUALLY contains, next to the colours its row claims.
//
//   node scripts/cardgen/auditEraColors.mjs           # every NBA era row
//   node scripts/cardgen/auditEraColors.mjs MIN97 GSW98
//
// ── WHY ─────────────────────────────────────────────────────────────────────
//
// Every era row carries `unverifiedColors: true`, which is honest and does
// nothing. The rows were filled in from memory of what a franchise wore, and
// the file sitting right next to each one is a better witness than memory:
// MIN97 declared today's navy and today's lime while its own mark is 26% slate
// blue, 21% silver and 21% forest green — the Timberwolves' real 1996-2008
// palette. A card built from that row printed a uniform its own logo contradicts.
//
// ── WHY THIS REPORTS AND DOES NOT FIX ───────────────────────────────────────
//
// Because the mark is not the whole uniform. Plenty of logos are monochrome —
// Houston's era R is entirely red, Orlando's 1989 mark entirely blue — so the
// second declared colour has nothing to match against and its "distance" is
// noise. A big number here means LOOK, not WRONG. The judgement stays human;
// this just stops it being made from memory.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './cache.js';
import { HISTORICAL_TEAMS } from '../../src/cards/teams.js';

const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const dist = (a, b) => {
  const [x, y, z] = hex2rgb(a);
  const [p, q, r] = hex2rgb(b);
  return Math.round(Math.hypot(x - p, y - q, z - r));
};

/** Colours covering at least this share of the mark's opaque, non-paper pixels. */
const MIN_SHARE = 0.03;

/** How far off before the row is worth a look. */
const LOOK_AT = 60;

async function palette(page, file) {
  const b64 = fs.readFileSync(file).toString('base64');
  return page.evaluate(async src => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const bucket = new Map();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      const [r, gg, bb] = [d[i], d[i + 1], d[i + 2]];
      const mx = Math.max(r, gg, bb);
      const mn = Math.min(r, gg, bb);
      // Near-white is paper and near-black is outline; neither is a team colour.
      if (mx > 235 && mn > 235) continue;
      if (mx < 28) continue;
      const k = `${r >> 3}|${gg >> 3}|${bb >> 3}`;
      const e = bucket.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n += 1; e.r += r; e.g += gg; e.b += bb;
      bucket.set(k, e);
    }
    const total = [...bucket.values()].reduce((s, e) => s + e.n, 0) || 1;
    return [...bucket.values()]
      .filter(e => e.n / total >= 0.03)
      .sort((a, b) => b.n - a.n)
      .slice(0, 5)
      .map(e => ({
        hex: '#' + [e.r / e.n, e.g / e.n, e.b / e.n]
          .map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase(),
        pct: Number(((e.n / total) * 100).toFixed(1)),
      }));
  }, `data:image/png;base64,${b64}`);
}

export async function main({ log = console.log, keys = null } = {}) {
  // Rows that BORROW a live mark are skipped: their art is a different era by
  // construction, so comparing it to the row's colours proves nothing.
  const rows = Object.entries(HISTORICAL_TEAMS)
    .filter(([key, t]) => t.logo && !t.logoEra && (!keys || keys.includes(key)));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const report = [];
  try {
    for (const [key, t] of rows) {
      const file = path.join(REPO_ROOT, 'public', t.logo);
      if (!fs.existsSync(file)) { report.push({ key, error: `no file at ${t.logo}` }); continue; }
      const pal = await palette(page, file);
      if (pal.length === 0) { report.push({ key, error: 'no dominant colour' }); continue; }
      const near = h => pal.reduce((a, b) => (dist(h, b.hex) < dist(h, a.hex) ? b : a));
      const np = near(t.primary);
      const ns = near(t.secondary);
      report.push({
        key, era: t.era,
        primary: t.primary, nearestPrimary: np.hex, dPrimary: dist(t.primary, np.hex),
        secondary: t.secondary, nearestSecondary: ns.hex, dSecondary: dist(t.secondary, ns.hex),
        palette: pal,
        monochrome: pal.length === 1,
      });
    }
  } finally {
    await browser.close();
  }

  const flagged = report.filter(r => !r.error && (r.dPrimary > LOOK_AT || r.dSecondary > LOOK_AT));
  log(`${report.length} era rows sampled; ${flagged.length} worth a look (>${LOOK_AT} away).\n`);
  log('KEY     ERA          DECLARED             NEAREST IN ART        dP   dS   ART PALETTE');
  for (const r of report) {
    if (r.error) { log(`${r.key.padEnd(7)} ${r.error}`); continue; }
    const flag = r.dPrimary > LOOK_AT || r.dSecondary > LOOK_AT ? ' <--' : '';
    log(
      `${r.key.padEnd(7)} ${String(r.era ?? '').padEnd(12)} ` +
        `${(r.primary + '/' + r.secondary).padEnd(20)} ` +
        `${(r.nearestPrimary + '/' + r.nearestSecondary).padEnd(20)} ` +
        `${String(r.dPrimary).padStart(4)} ${String(r.dSecondary).padStart(4)}  ` +
        `${r.palette.map(p => `${p.hex} ${p.pct}%`).join('  ')}${flag}`
    );
  }
  log(
    '\nA large distance on a MONOCHROME mark is expected, not a defect: the second\n' +
      'colour simply is not in the logo. Read the palette, not the number.'
  );

  fs.writeFileSync(
    path.join(REPO_ROOT, 'card-data', 'generated', 'era-color-audit.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 1)}\n`
  );
  return report;
}

const keys = process.argv.slice(2).filter(a => !a.startsWith('-'));
await main({ keys: keys.length ? keys : null });
