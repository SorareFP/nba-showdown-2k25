# Scoring Chart Matrix Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build and validate a reusable, formula-driven pipeline that turns real per-game player box scores into a D20 scoring chart in the exact shape `rawCards.js` already consumes, with a guaranteed zero-score floor and a sparse manual-override mechanism — ready to run once the new season's player pool and data source (dunksandthrees.com API) are available.

**Architecture:** A set of small pure functions (Excel-equivalent math, band computation, zero-floor enforcement, override merging) under `scripts/cardgen/`, each independently unit-tested, composed by one orchestrator script. The two open formula questions from the recovered "Chart playground" sheet (single- vs. double-division minutes normalization; the exact integer-rounding rule for the final card values, since the recovered formulas produce 1-decimal values but published cards show clean integers) are resolved empirically in Task 3 by reproducing a real, already-published player (Nikola Jokic) from his actual 2023-24 game log and comparing against his real row in `card-data/source-recovered/Final Cards.csv`.

**Tech Stack:** Node.js (ESM), Vitest for unit tests (not currently in this repo — added in Task 1). No new runtime dependencies needed for HTML parsing (hand-rolled table extraction is enough for Basketball-Reference's simple game-log table).

---

## Before you start

Read these first — they carry context this plan assumes:
- `docs/plans/2026-08-28-scoring-chart-matrix-redesign-design.md` — the approved design.
- `card-data/source-recovered/Final Cards.csv` — real published output for 306 players, including Nikola Jokic's row (used as ground truth in Task 3).
- `card-data/source-recovered/Corrected_Speed_and_Power_Attributes.xlsx`, sheet "Chart playground" — the live formulas this plan implements.

All source recovered files are gitignored (`card-data/source-recovered`) — the repo is public. Don't remove that gitignore entry.

## Task 1: Project setup — Vitest + cardgen scaffold

**Files:**
- Modify: `package.json`
- Create: `scripts/cardgen/.gitkeep` (placeholder, removed once real files land in Task 2)

**Step 1: Add Vitest and mark the project ESM**

Edit `package.json`:
- Add `"type": "module"` at the top level (all existing `src/game/*.js` files already use `import`/`export`; this just makes Node stop guessing).
- Add to `"scripts"`: `"test": "vitest run"`, `"test:watch": "vitest"`.
- Add to `"devDependencies"`: `"vitest": "^2.1.9"`.

**Step 2: Install**

Run: `npm install`
Expected: `vitest` added to `node_modules`, `package-lock.json` updated, no errors.

**Step 3: Verify Vitest runs with zero tests**

Run: `npm test`
Expected: Vitest starts, reports "No test files found" (or similar) — exit code may be non-zero since there are no tests yet, that's fine, we're just confirming the runner launches.

**Step 4: Create the cardgen directory**

Run: `mkdir -p scripts/cardgen/sources` then create an empty `scripts/cardgen/.gitkeep`.

**Step 5: Commit**

```bash
git add package.json package-lock.json scripts/cardgen/.gitkeep
git commit -m "chore: add vitest and scaffold scripts/cardgen"
```

---

## Task 2: Excel-equivalent math primitives

**Files:**
- Create: `scripts/cardgen/excelMath.js`
- Test: `scripts/cardgen/excelMath.test.js`

These reproduce the two Excel functions the recovered formulas depend on: `PERCENTILE.EXC` and `ROUNDDOWN`. Both must match Excel's exact semantics since Task 3 validates against Excel-computed reference values.

**Step 1: Write the failing tests**

```js
// scripts/cardgen/excelMath.test.js
import { describe, it, expect } from 'vitest';
import { percentileExc, roundDown } from './excelMath.js';

describe('percentileExc', () => {
  it('matches Excel PERCENTILE.EXC for a simple sorted array', () => {
    // Excel: =PERCENTILE.EXC({1,2,3,4,5,6,7,8,9,10}, 0.1) = 1.1
    expect(percentileExc([1,2,3,4,5,6,7,8,9,10], 0.1)).toBeCloseTo(1.1, 10);
    // =PERCENTILE.EXC({1,2,3,4,5,6,7,8,9,10}, 0.9) = 9.9
    expect(percentileExc([1,2,3,4,5,6,7,8,9,10], 0.9)).toBeCloseTo(9.9, 10);
    // =PERCENTILE.EXC({1,2,3,4,5,6,7,8,9,10}, 0.5) = 5.5
    expect(percentileExc([1,2,3,4,5,6,7,8,9,10], 0.5)).toBeCloseTo(5.5, 10);
  });

  it('sorts input before computing (order-independent)', () => {
    expect(percentileExc([10,3,7,1,5,2,9,4,8,6], 0.33)).toBeCloseTo(
      percentileExc([1,2,3,4,5,6,7,8,9,10], 0.33), 10
    );
  });

  it('throws for p out of Excel-valid range given array length (Excel #NUM! case)', () => {
    // rank = p*(n+1) must land within [1, n]
    expect(() => percentileExc([1,2,3], 0.9)).toThrow();
  });
});

describe('roundDown', () => {
  it('rounds toward zero to the given decimal digits', () => {
    expect(roundDown(2.789, 1)).toBe(2.7);
    expect(roundDown(2.789, 0)).toBe(2);
    expect(roundDown(-2.789, 1)).toBe(-2.7);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm test -- excelMath`
Expected: FAIL — `Cannot find module './excelMath.js'` (file doesn't exist yet).

**Step 3: Implement**

```js
// scripts/cardgen/excelMath.js

/** Excel PERCENTILE.EXC: exclusive percentile, linear interpolation, 1-indexed rank. */
export function percentileExc(values, p) {
  if (p <= 0 || p >= 1) throw new RangeError('p must be strictly between 0 and 1');
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const rank = p * (n + 1);
  if (rank < 1 || rank > n) {
    throw new RangeError(`PERCENTILE.EXC out of range: rank ${rank} for n=${n} (Excel #NUM!)`);
  }
  const k = Math.floor(rank);
  const frac = rank - k;
  const lower = sorted[k - 1];
  if (frac === 0) return lower;
  const upper = sorted[k];
  return lower + frac * (upper - lower);
}

/** Excel ROUNDDOWN: truncate toward zero at the given number of decimal digits. */
export function roundDown(value, digits) {
  const factor = 10 ** digits;
  const scaled = value * factor;
  // value * factor can land just under the true value due to binary floating-point
  // representation (e.g. 19.99 * 100 === 1998.9999999999998), which would make
  // Math.trunc silently drop a whole unit. Nudge toward the sign of value by a tiny
  // epsilon (scaled to magnitude) before truncating so representation error can't
  // erase a full unit.
  const nudged = scaled + Math.sign(scaled) * 1e-9 * Math.max(1, Math.abs(scaled));
  return Math.trunc(nudged) / factor;
}
```

**Step 4: Run to verify it passes**

Run: `npm test -- excelMath`
Expected: PASS, 4 tests.

**Step 5: Commit**

```bash
git add scripts/cardgen/excelMath.js scripts/cardgen/excelMath.test.js
git commit -m "feat(cardgen): add Excel-equivalent PERCENTILE.EXC and ROUNDDOWN"
```

---

## Task 3: Calibrate against a real, known player (resolves the two open formula questions)

**Files:**
- Create: `card-data/fixtures/jokic-2023-24-gamelog.json`
- Create: `scripts/cardgen/calibrate.js`

This is investigative, not TDD — there's no pre-known pass/fail, the point is to determine which formula variant reproduces reality. Nikola Jokic is chosen because his real row is in `Final Cards.csv` (`1-3:"2,1,1"`, `4-11:"3,1,1"`, `12-15:"3,1,1"`, `16-20:"4,2,1"`, `21+:"4,2,2"`) and the "Chart playground" sample game dates (Nov 2023 - Mar 2024) fall in his 2023-24 season.

**Step 1: Fetch Jokic's real 2023-24 game log**

Run:
```bash
curl -s -A "Mozilla/5.0" "https://www.basketball-reference.com/players/j/jokicni01/gamelog/2024" -o /tmp/jokic-2024-gamelog.html
```
Expected: an HTML file saved, a few hundred KB.

Then extract the `#pgl_basic` table's rows into `card-data/fixtures/jokic-2023-24-gamelog.json` as an array of `{ minutes: "34:12", pts: 25, reb: 11, ast: 9 }` objects (one per game actually played — skip rows where he didn't play, e.g. "Inactive"/"Did Not Play"/"Not With Team"). Do this extraction by hand or with a throwaway script; the fixture is what matters, not how it was produced (no need to keep a general-purpose Basketball-Reference parser yet — that's Task 6).

**Step 2: Write the calibration script**

```js
// scripts/cardgen/calibrate.js
import { readFileSync } from 'node:fs';
import { percentileExc, roundDown } from './excelMath.js';

const games = JSON.parse(readFileSync(new URL('../../card-data/fixtures/jokic-2023-24-gamelog.json', import.meta.url)));

function minutesToDecimal(mp) {
  const [m, s] = mp.split(':').map(Number);
  return m + s / 60;
}

function normalize(stat, minutes, variant) {
  const perMinScaled = stat * (36 / minutes);
  return variant === 'double' ? perMinScaled / minutes : perMinScaled;
}

const CUTS = [0.1, 0.33, 0.5, 0.66, 0.9];

function runVariant(variant) {
  for (const stat of ['pts', 'reb', 'ast']) {
    const normalized = games.map(g => normalize(g[stat], minutesToDecimal(g.minutes), variant));
    const values = CUTS.map(p => roundDown(percentileExc(normalized, p) * 4, 1));
    console.log(`[${variant}] ${stat}:`, values);
  }
}

console.log('Real Jokic chart (Final Cards.csv): 1-3:"2,1,1" 4-11:"3,1,1" 12-15:"3,1,1" 16-20:"4,2,1" 21+:"4,2,2"');
runVariant('single');
runVariant('double');
```

**Step 3: Run it and compare**

Run: `node scripts/cardgen/calibrate.js`

Compare each variant's 5 raw decimal values per stat against the real published integers (2,3,3,4,4 for PTS; 1,1,1,2,2 for REB; 1,1,1,1,2 for AST). Determine:
1. Which division variant (single or double) lands closer to the real values.
2. What rounding rule turns the winning variant's raw decimals into the published integers — try nearest-integer, ceiling, and floor against all 15 values (5 bands x 3 stats) and see which one matches most/all of them exactly. It's fine (expected, even) if it's not a perfect match for every single value — the original process included a manual "make it playable" cleanup pass per `memory/card_design_philosophy.md` point 7, so this is about finding the rule that gets you *close enough to start from*, not pixel-perfect.

**Step 4: Record the finding**

Add a `## Calibration finding` section at the bottom of `docs/plans/2026-08-28-scoring-chart-matrix-redesign-design.md` stating which variant and rounding rule were selected and why (cite the actual numbers). This is the input Task 4 implements.

**Step 5: Commit**

```bash
git add card-data/fixtures/jokic-2023-24-gamelog.json scripts/cardgen/calibrate.js docs/plans/2026-08-28-scoring-chart-matrix-redesign-design.md
git commit -m "feat(cardgen): calibrate normalization formula against real Jokic data"
```

---

## Task 4: Band computation (frequency + magnitude, per stat)

**Files:**
- Create: `scripts/cardgen/bands.js`
- Test: `scripts/cardgen/bands.test.js`

Implements the winning variant from Task 3. Produces, per stat, 5 bands each with a roll-range width (from proportional 25-slot allocation) and a magnitude value.

**Step 1: Write the failing test**

```js
// scripts/cardgen/bands.test.js
import { describe, it, expect } from 'vitest';
import { computeStatBands } from './bands.js';

describe('computeStatBands', () => {
  it('produces 5 bands whose slot widths sum to 25', () => {
    // 40 synthetic games, points ranging 0-30, enough spread for all 5 percentile cuts to resolve
    const games = Array.from({ length: 40 }, (_, i) => ({ minutes: 30, pts: i % 31 }));
    const bands = computeStatBands(games, 'pts');
    expect(bands).toHaveLength(5);
    const totalSlots = bands.reduce((sum, b) => sum + b.slots, 0);
    expect(totalSlots).toBe(25);
  });

  it('produces non-decreasing magnitude values across bands', () => {
    const games = Array.from({ length: 40 }, (_, i) => ({ minutes: 30, pts: i % 31 }));
    const bands = computeStatBands(games, 'pts');
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].value).toBeGreaterThanOrEqual(bands[i - 1].value);
    }
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm test -- bands`
Expected: FAIL — module not found.

**Step 3: Implement**

Use the variant/rounding rule Task 3 determined — the code below assumes `single`-division and nearest-integer rounding as placeholders; **replace both with Task 3's actual finding before considering this task done**.

```js
// scripts/cardgen/bands.js
import { percentileExc, roundDown } from './excelMath.js';

const CUTS = [0.1, 0.33, 0.5, 0.66, 0.9];
const TOTAL_SLOTS = 25;

function minutesToDecimal(mp) {
  const [m, s] = mp.split(':').map(Number);
  return m + s / 60;
}

// TODO(Task 3 finding): confirm 'single' vs 'double' division.
function normalize(stat, minutes) {
  return stat * (36 / minutes);
}

// TODO(Task 3 finding): confirm rounding rule (nearest shown here as a placeholder).
function toCardValue(raw) {
  return Math.round(roundDown(raw, 1));
}

/** Largest-remainder rounding so per-band slot counts sum exactly to TOTAL_SLOTS. */
function allocateSlots(weights) {
  const floors = weights.map(Math.floor);
  let remaining = TOTAL_SLOTS - floors.reduce((a, b) => a + b, 0);
  const remainders = weights.map((w, i) => ({ i, frac: w - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  const slots = [...floors];
  for (let k = 0; k < remaining; k++) slots[remainders[k].i] += 1;
  return slots;
}

export function computeStatBands(games, statKey) {
  const normalized = games.map(g => normalize(g[statKey], minutesToDecimal(g.minutes)));
  const thresholds = CUTS.map(p => percentileExc(normalized, p));
  const values = thresholds.map(t => toCardValue(t * 4));

  const counts = thresholds.map((t, i) => {
    if (i === 0) return normalized.filter(v => v <= t).length;
    return normalized.filter(v => v > thresholds[i - 1] && v <= t).length;
  });
  const totalCount = counts.reduce((a, b) => a + b, 0) || 1;
  const weights = counts.map(c => (c / totalCount) * TOTAL_SLOTS);
  const slots = allocateSlots(weights);

  let start = 1;
  return values.map((value, i) => {
    const width = slots[i] || 1;
    const band = { lo: start, hi: start + width - 1, value, slots: width };
    start += width;
    return band;
  });
}
```

**Step 4: Run to verify it passes**

Run: `npm test -- bands`
Expected: PASS, 2 tests.

**Step 5: Cross-check against Jokic**

Run `computeStatBands` on the Task 3 fixture for `pts`/`reb`/`ast` and compare band boundaries/values against the real `Final Cards.csv` Jokic row (adjusting the 1-25 slot scale down to the 1-20 die display, same as the existing `21+`/`22+` pattern). Note any remaining gap in a comment at the top of `bands.js` — exact reproduction isn't required (see Task 3 Step 3), but it should be close.

**Step 6: Commit**

```bash
git add scripts/cardgen/bands.js scripts/cardgen/bands.test.js
git commit -m "feat(cardgen): compute frequency+magnitude bands per stat"
```

---

## Task 5: Zero-floor enforcement

**Files:**
- Create: `scripts/cardgen/zeroFloor.js`
- Test: `scripts/cardgen/zeroFloor.test.js`

Implements the design's zero-floor rule: natural 1 is unconditionally forced to 0/0/0, and the lower percentile cut points get recalibrated so more bands legitimately land at zero above that floor. Operates on the reconciled per-player chart (all three stats combined onto one roll-range table), not per-stat bands — reconciliation itself happens in Task 7's orchestrator.

**Step 1: Write the failing test**

```js
// scripts/cardgen/zeroFloor.test.js
import { describe, it, expect } from 'vitest';
import { enforceZeroFloor } from './zeroFloor.js';

describe('enforceZeroFloor', () => {
  it('forces the first tier to 0/0/0 regardless of input', () => {
    const chart = [
      { lo: 1, hi: 3, pts: 2, reb: 1, ast: 0 },
      { lo: 4, hi: 11, pts: 3, reb: 1, ast: 1 },
    ];
    const result = enforceZeroFloor(chart);
    expect(result[0]).toMatchObject({ pts: 0, reb: 0, ast: 0 });
  });

  it('leaves roll ranges (lo/hi) untouched', () => {
    const chart = [
      { lo: 1, hi: 3, pts: 2, reb: 1, ast: 0 },
      { lo: 4, hi: 11, pts: 3, reb: 1, ast: 1 },
    ];
    const result = enforceZeroFloor(chart);
    expect(result[0]).toMatchObject({ lo: 1, hi: 3 });
    expect(result[1]).toMatchObject({ lo: 4, hi: 11 });
  });

  it('does not touch tiers beyond the first', () => {
    const chart = [
      { lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 },
      { lo: 4, hi: 11, pts: 3, reb: 1, ast: 1 },
    ];
    const result = enforceZeroFloor(chart);
    expect(result[1]).toMatchObject({ pts: 3, reb: 1, ast: 1 });
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm test -- zeroFloor`
Expected: FAIL — module not found.

**Step 3: Implement**

```js
// scripts/cardgen/zeroFloor.js

/**
 * Hard floor only: natural-1 tier is always 0/0/0.
 * The "statistically-driven expansion" (more bands legitimately landing at
 * zero) is achieved upstream by how Task 4's percentile cuts are chosen,
 * not by force here — see design doc section 3.
 */
export function enforceZeroFloor(chart) {
  return chart.map((tier, i) =>
    i === 0 ? { ...tier, pts: 0, reb: 0, ast: 0 } : tier
  );
}
```

**Step 4: Run to verify it passes**

Run: `npm test -- zeroFloor`
Expected: PASS, 3 tests.

**Step 5: Commit**

```bash
git add scripts/cardgen/zeroFloor.js scripts/cardgen/zeroFloor.test.js
git commit -m "feat(cardgen): enforce hard zero-score floor on natural 1"
```

---

## Task 6: Sparse per-player overrides

**Files:**
- Create: `scripts/cardgen/overrides.js`
- Create: `scripts/cardgen/overrides.json` (starts empty)
- Test: `scripts/cardgen/overrides.test.js`

**Step 1: Write the failing test**

```js
// scripts/cardgen/overrides.test.js
import { describe, it, expect } from 'vitest';
import { applyOverrides } from './overrides.js';

describe('applyOverrides', () => {
  it('deep-merges a tier override onto the generated chart for that player only', () => {
    const players = {
      jokic: { chart: [{ lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 }, { lo: 4, hi: 11, pts: 3, reb: 1, ast: 1 }] },
      lebron: { chart: [{ lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 }] },
    };
    const overrides = { jokic: { chart: { 1: { pts: 4 } } } };
    const result = applyOverrides(players, overrides);
    expect(result.jokic.chart[1]).toMatchObject({ pts: 4, reb: 1, ast: 1 });
    expect(result.lebron).toEqual(players.lebron);
  });

  it('is a no-op for players with no override entry', () => {
    const players = { jokic: { chart: [{ lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 }] } };
    expect(applyOverrides(players, {})).toEqual(players);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm test -- overrides`
Expected: FAIL — module not found.

**Step 3: Implement**

```js
// scripts/cardgen/overrides.js

/**
 * overrides shape: { [playerId]: { chart: { [tierIndex]: { pts?, reb?, ast? } } } }
 * Sparse by design — only players actually tweaked appear here, and only the
 * fields being changed need to be present per tier.
 */
export function applyOverrides(players, overrides) {
  const result = { ...players };
  for (const [playerId, override] of Object.entries(overrides)) {
    if (!result[playerId]) continue;
    const chart = result[playerId].chart.map((tier, i) => {
      const tierOverride = override.chart?.[i];
      return tierOverride ? { ...tier, ...tierOverride } : tier;
    });
    result[playerId] = { ...result[playerId], chart };
  }
  return result;
}
```

```json
// scripts/cardgen/overrides.json
{}
```

**Step 4: Run to verify it passes**

Run: `npm test -- overrides`
Expected: PASS, 2 tests.

**Step 5: Commit**

```bash
git add scripts/cardgen/overrides.js scripts/cardgen/overrides.json scripts/cardgen/overrides.test.js
git commit -m "feat(cardgen): add sparse per-player chart overrides"
```

---

## Task 7: Basketball-Reference game-log source adapter

**Files:**
- Create: `scripts/cardgen/sources/basketballReference.js`
- Create: `scripts/cardgen/sources/dunksAndThrees.js`
- Test: `scripts/cardgen/sources/basketballReference.test.js`
- Create fixture: `scripts/cardgen/sources/__fixtures__/sample-gamelog.html` (a small trimmed excerpt of the real Jokic page saved in Task 3, just the `<table id="pgl_basic">` and a handful of `<tr>` rows — not the full page)

Defines the pluggable source interface both adapters implement: `async function fetchGameLog(playerId, season) -> Array<{ minutes, pts, reb, ast }>`.

**Step 1: Write the failing test**

```js
// scripts/cardgen/sources/basketballReference.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGameLogHtml } from './basketballReference.js';

describe('parseGameLogHtml', () => {
  it('extracts minutes/pts/reb/ast rows, skipping games not played', () => {
    const html = readFileSync(new URL('./__fixtures__/sample-gamelog.html', import.meta.url), 'utf-8');
    const games = parseGameLogHtml(html);
    expect(games.length).toBeGreaterThan(0);
    for (const g of games) {
      expect(g).toHaveProperty('minutes');
      expect(g).toHaveProperty('pts');
      expect(g).toHaveProperty('reb');
      expect(g).toHaveProperty('ast');
    }
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm test -- basketballReference`
Expected: FAIL — module not found.

**Step 3: Implement**

```js
// scripts/cardgen/sources/basketballReference.js

/** Parses Basketball-Reference's #pgl_basic game-log table HTML into normalized rows. */
export function parseGameLogHtml(html) {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  const games = [];
  for (const row of rows) {
    const cell = (stat) => {
      const m = row.match(new RegExp(`data-stat="${stat}"[^>]*>([^<]*)<`));
      return m ? m[1].trim() : '';
    };
    const mp = cell('mp');
    if (!mp || !mp.includes(':')) continue; // skip DNP/inactive rows
    games.push({
      minutes: mp,
      pts: Number(cell('pts')),
      reb: Number(cell('trb')),
      ast: Number(cell('ast')),
    });
  }
  return games;
}

/** Fetches and parses a player's game log for a given end-year season (e.g. 2024 = 2023-24). */
export async function fetchGameLog(playerId, season) {
  const res = await fetch(`https://www.basketball-reference.com/players/${playerId[0]}/${playerId}/gamelog/${season}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Basketball-Reference fetch failed: ${res.status}`);
  return parseGameLogHtml(await res.text());
}
```

```js
// scripts/cardgen/sources/dunksAndThrees.js

/**
 * Stub — dunksandthrees.com's game-log API isn't available yet (pending access,
 * see memory/dunks_and_threes_stats_source.md). Same interface as
 * basketballReference.js's fetchGameLog so the orchestrator can swap sources
 * without other code changes once this is real.
 */
export async function fetchGameLog(/* playerId, season */) {
  throw new Error('dunksandthrees.com game-log source not yet available — use sources/basketballReference.js');
}
```

**Step 4: Build the fixture**

Take the real HTML downloaded in Task 3 (`/tmp/jokic-2024-gamelog.html`), extract just the `<table id="pgl_basic">...</table>` element plus its 5-10 leading `<tr>` rows (enough to exercise the parser, not the whole season), and save as `scripts/cardgen/sources/__fixtures__/sample-gamelog.html`.

**Step 5: Run to verify it passes**

Run: `npm test -- basketballReference`
Expected: PASS.

**Step 6: Commit**

```bash
git add scripts/cardgen/sources/
git commit -m "feat(cardgen): add pluggable game-log source adapters"
```

---

## Task 8: Orchestrator + output matching rawCards.js shape

**Files:**
- Create: `scripts/cardgen/generate.js`
- Test: `scripts/cardgen/generate.test.js`

Ties Tasks 2-7 together: fetch a game log per stat category, run `computeStatBands` for PTS/REB/AST, reconcile onto one shared roll-range table, apply `enforceZeroFloor`, apply `applyOverrides`, emit in the exact `rawCards.js` tuple shape (`c: [[lo, hi, pts, reb, ast], ...]`).

**Step 1: Write the failing test (reconciliation + output shape, using precomputed bands so the source adapters aren't involved)**

```js
// scripts/cardgen/generate.test.js
import { describe, it, expect } from 'vitest';
import { reconcileBands, toRawCardFormat } from './generate.js';

describe('reconcileBands', () => {
  it('combines independently-computed PTS/REB/AST bands onto one roll-range table using the PTS ranges as the shared spine', () => {
    const pts = [{ lo: 1, hi: 3, value: 0 }, { lo: 4, hi: 25, value: 3 }];
    const reb = [{ lo: 1, hi: 5, value: 0 }, { lo: 6, hi: 25, value: 1 }];
    const ast = [{ lo: 1, hi: 2, value: 0 }, { lo: 3, hi: 25, value: 1 }];
    const chart = reconcileBands({ pts, reb, ast });
    expect(chart).toHaveLength(2);
    expect(chart[0]).toMatchObject({ lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 });
    expect(chart[1]).toMatchObject({ lo: 4, hi: 25, pts: 3, reb: 1, ast: 1 });
  });
});

describe('toRawCardFormat', () => {
  it('matches the [lo, hi, pts, reb, ast] tuple shape rawCards.js uses, capping the last tier at 99', () => {
    const chart = [{ lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 }, { lo: 4, hi: 25, pts: 3, reb: 1, ast: 1 }];
    expect(toRawCardFormat(chart)).toEqual([[1, 3, 0, 0, 0], [4, 99, 3, 1, 1]]);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm test -- generate`
Expected: FAIL — module not found.

**Step 3: Implement**

```js
// scripts/cardgen/generate.js
import { computeStatBands } from './bands.js';
import { enforceZeroFloor } from './zeroFloor.js';
import { applyOverrides } from './overrides.js';
import * as basketballReference from './sources/basketballReference.js';

/** Uses the PTS bands' roll ranges as the shared spine; REB/AST contribute only their values per range. */
export function reconcileBands({ pts, reb, ast }) {
  return pts.map((tier, i) => ({
    lo: tier.lo,
    hi: tier.hi,
    pts: tier.value,
    reb: reb[i]?.value ?? reb[reb.length - 1].value,
    ast: ast[i]?.value ?? ast[ast.length - 1].value,
  }));
}

export function toRawCardFormat(chart) {
  return chart.map((t, i) =>
    i === chart.length - 1 ? [t.lo, 99, t.pts, t.reb, t.ast] : [t.lo, t.hi, t.pts, t.reb, t.ast]
  );
}

export async function generatePlayerChart(playerId, season, overridesMap = {}) {
  const games = await basketballReference.fetchGameLog(playerId, season);
  const pts = computeStatBands(games, 'pts');
  const reb = computeStatBands(games, 'reb');
  const ast = computeStatBands(games, 'ast');
  let chart = reconcileBands({ pts, reb, ast });
  chart = enforceZeroFloor(chart);
  const withOverrides = applyOverrides({ [playerId]: { chart } }, overridesMap);
  return toRawCardFormat(withOverrides[playerId].chart);
}
```

**Step 4: Run to verify it passes**

Run: `npm test -- generate`
Expected: PASS, 2 tests.

**Step 5: Full test suite sanity check**

Run: `npm test`
Expected: all tests across every `scripts/cardgen/**/*.test.js` file pass.

**Step 6: Commit**

```bash
git add scripts/cardgen/generate.js scripts/cardgen/generate.test.js
git commit -m "feat(cardgen): orchestrate band generation into rawCards.js-compatible output"
```

---

## Out of scope (per design doc — do not build in this plan)

- Generating the actual new-season 306+ card set — the new player pool isn't decided yet (separate, Speed/Power-adjacent work).
- Speed/Power/defBoost generation, including the EPM/DEF-EPM ideas in `memory/speed_power_methodology.md`.
- Wiring generated output into the live app (`rawCards.js` replacement) — that's a separate integration decision once a real pool exists, with knock-on effects on salary balance, saved teams, etc.
- Swapping in the real dunksandthrees.com API — `sources/dunksAndThrees.js` stays a stub until that access exists.

## Rollback plan

Each task is one commit. To undo a task: `git revert <sha>`. Tasks are additive (new files only, one `package.json` edit in Task 1) so reverting in reverse order is safe.
