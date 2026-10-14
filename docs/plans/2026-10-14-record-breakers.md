# Record Breakers Implementation Plan — part 1: the face and the set

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `record-breakers` card set — platinum frame, RECORD BREAKERS pill, a lit LED plaque carrying the record — with its first card (LeBron James 2022-23) visible in the Card Studio, then the full roster, packs and a coins-only goal.

**Architecture:** The look is a set treatment (`platinum`, treatments.js) plus a badge (badges.js) plus one new CardTemplate piece (the plaque, drawn from `card.record`). The set is a curated list (`card-data/record-breakers.json`) built by its own generator through the Free Agents builder, registered like Dissonance. Feats (earning a card by play) are PART 2, a separate plan written after the thresholds are measured.

**Tech Stack:** React (Vite), CSS modules, Node ESM generators, Vitest (`npx vitest run`, renderToStaticMarkup, no DOM env), Python only for image checks.

**Spec:** `docs/plans/2026-10-14-record-breakers-design.md`

## Global Constraints

- Set id `record-breakers`; name "Record Breakers"; pill text `RECORD\nBREAKERS` (the user's words, two lines — the 127px pill fits ~11 characters a line).
- Plaque rim engraving: `RECORD BREAKER`. Plaque fields: `record.number` (string, e.g. `"38,388"`), `record.label` (string, e.g. `"ALL-TIME PTS"`).
- Every card keeps its team field; the treatment adds a platinum frame (metal sweep, wider than the 7px keyline) and nothing else to the field. No foil sheen.
- Card ids in the set always carry the season: `LeBron_James_2023`.
- No reward card. The goal pays coins only (COINS_ONLY_GOALS).
- Feat cards (`earn` other than `"pack"`) are never dealt by any pack.
- The repo is PUBLIC: no player-of-the-game names or emails in code or commits beyond the existing "Ryan, through the suggestion box" convention.
- Commit with explicit `git add <paths>`, push `origin feature/bench-curve`; end messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never commit `card-data/generated/cards-live.json`, `live-status.json`, `super-season-missing-logs.txt`, `*-DESKTOP-VFORBTS*`, or the orphan faces.
- Do not edit app-imported files while an export runs.

## Review Focus

1. A Super Season card that also carries a record (Curry 2015-16) — its gold foil and SUPER SEASON pill must still render, with the plaque on top; the plaque must not shift the sidebar.
2. A card with `record` but no photo — the plaque draws on the NO PHOTO well, readable.
3. A long record label ("ALL-TIME TRIPLE-DOUBLES", 23 characters) — must fit the plate without overflow (font steps down).
4. A Record Breakers card with no photo — dormant: in no pack, not required by the goal.
5. A pack opened many times never contains a feat card; the four pack cards can appear.

---

### Task 1: The platinum treatment

**Files:**
- Modify: `src/cards/treatments.js` (constants near GOLD ~line 62; new `platinumLook` before `TREATMENTS`; `TREATMENTS`; `treatmentVars`)
- Modify: `src/cards/CardTemplate.module.css` (`.treatmentFrame`, ~line 150)
- Test: `src/cards/treatments.test.js`

**Interfaces:**
- Produces: treatment id `'platinum'`; exports `PLATINUM`, `PLATINUM_HI`, `PLATINUM_LO`; `treatment.frameWidth` (number, px) and the CSS var `--treatment-frame-width` (always emitted when a treatment is present; `7px` unless the treatment says otherwise).

- [ ] **Step 1: Write the failing test** — append to `src/cards/treatments.test.js`:

```js
describe('the platinum treatment (Record Breakers, 2026-10-14)', () => {
  const theme = deriveFieldTheme(TEAMS.LAL.primary, TEAMS.LAL.secondary);
  const t = applyTreatment(theme, 'platinum');

  it('keeps the team field and adds a metal frame, wider than the keyline', () => {
    expect(t.field).toBe(theme.field);
    expect(t.treatment.id).toBe('platinum');
    expect(t.treatment.sheen).toBeNull();
    expect(t.treatment.frameImage).toMatch(/linear-gradient/);
    expect(t.treatment.frameWidth).toBeGreaterThan(7);
  });

  it('emits the frame width as a property, and 7px for every other treatment', () => {
    expect(treatmentVars(t)['--treatment-frame-width']).toBe(`${t.treatment.frameWidth}px`);
    expect(treatmentVars(applyTreatment(theme, 'gold-foil'))['--treatment-frame-width']).toBe('7px');
    expect(treatmentVars(theme)).toEqual({});
  });
});
```

(`deriveFieldTheme`, `TEAMS`, `applyTreatment`, `treatmentVars` are already imported at the top of the file; add any that are not.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/cards/treatments.test.js -t platinum`
Expected: FAIL — `t.treatment` is undefined (unknown treatment returns the theme unchanged).

- [ ] **Step 3: Implement**

In `src/cards/treatments.js`, beside the other metal constants:

```js
// PLATINUM — the Record Breakers frame (2026-10-14, the user chose the "Lit
// plaque" mockup: a platinum frame and pills, the record on a lit plate).
export const PLATINUM = '#D9DCE1';
export const PLATINUM_HI = '#F7F8FA';
export const PLATINUM_LO = '#8C939C';
```

Before `export const TREATMENTS`:

```js
/**
 * PLATINUM — Record Breakers. The team's field, band and chart untouched, like
 * the trims; what marks the set is a platinum frame, a metal sweep twice the
 * keyline's width, and the platinum pill (badges.js). The record itself is the
 * lit plaque on the photo (CardTemplate), which any card with a record wears.
 */
function platinumLook(theme) {
  return {
    ...theme,
    frame: readableOn(PLATINUM, theme.field, MIN_DECOR_CONTRAST),
    treatment: {
      id: 'platinum',
      fieldStops: [theme.field],
      bandStops: [theme.bandTop, theme.bandBottom],
      sheen: null,
      band: null,
      frameImage: foilSweep('135deg', PLATINUM, PLATINUM_HI, PLATINUM_LO),
      frameWidth: 14,
      bandEdge: readableOn(PLATINUM, theme.field, MIN_DECOR_CONTRAST),
      source: PLATINUM,
      sourceLow: PLATINUM_LO,
    },
  };
}
```

Register it: add `platinum: platinumLook,` to `TREATMENTS`. In `treatmentVars`, add one line to the returned object:

```js
    '--treatment-frame-width': `${t.frameWidth ?? 7}px`,
```

In `src/cards/CardTemplate.module.css`, `.treatmentFrame`: change `border: 7px solid transparent;` to

```css
  border: var(--treatment-frame-width, 7px) solid transparent;
```

- [ ] **Step 4: Run the treatment and template tests**

Run: `npx vitest run src/cards/treatments.test.js src/cards/CardTemplate.test.js`
Expected: PASS. The `describe.each(TREATMENT_IDS)` sweep now covers `platinum` on every team; if a sweep assertion fails, fix the colour choice (e.g. `readableOn` floors), not the sweep.

- [ ] **Step 5: Commit**

```bash
git add src/cards/treatments.js src/cards/treatments.test.js src/cards/CardTemplate.module.css
git commit -m "feat(cards): a platinum treatment for Record Breakers"
```

---

### Task 2: The RECORD BREAKERS pill

**Files:**
- Modify: `src/cards/badges.js` (new id near `LIVE_BADGE` ~line 124; new entry at the end of `BADGES`)
- Modify: `src/cards/CardTemplate.module.css` (`.badge`, ~line 732)
- Test: `src/cards/CardTemplate.test.js` (~line 1608, the width budget) and `src/cards/treatments.test.js` (~line 457)

**Interfaces:**
- Produces: `RECORD_BREAKERS_BADGE = 'record-breakers'`; label `'RECORD\nBREAKERS'`.

- [ ] **Step 1: Write the failing test** — in `src/cards/CardTemplate.test.js`, in the width-budget test, replace the measuring loop with one that measures each LINE, and assert the new label is offered:

```js
    expect(labels).toContain('RECORD\nBREAKERS');
    for (const label of labels) {
      // A two-line pill (RECORD / BREAKERS) is measured by its longest line.
      const longest = Math.max(...label.split('\n').map(line => line.length));
      const width = longest * (0.7 * size + tracking);
      expect(width, `${label} at ${size}px`).toBeLessThanOrEqual(inner);
    }
```

And add, near the other badge render tests:

```js
  it('prints RECORD BREAKERS on two lines, platinum', () => {
    const html = render({ card: { name: 'LeBron James', team: 'LAL', season: 2023, seasonLabel: '2022-23' }, set: 'record-breakers' });
    expect(html).toContain('RECORD\nBREAKERS');
  });
```

(This render passes once Task 4 registers the set; until then assert on `getBadge(RECORD_BREAKERS_BADGE)` instead — `expect(badgeLabel(getBadge(RECORD_BREAKERS_BADGE))).toBe('RECORD\nBREAKERS')` — and move the render assertion into Task 4's test step.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/cards/CardTemplate.test.js -t "width budget|RECORD"`
Expected: FAIL — the label is not offered.

- [ ] **Step 3: Implement** — in `src/cards/badges.js`:

```js
/** Record Breakers (2026-10-14): a season a record was set. */
export const RECORD_BREAKERS_BADGE = 'record-breakers';
```

At the end of `BADGES`:

```js
  {
    // The RECORD BREAKERS pill — the user's words, on two lines because the
    // 127px pill holds about eleven characters. The second pill (after LIVE)
    // that IS its set's colour: platinum, as the frame is.
    id: RECORD_BREAKERS_BADGE,
    text: 'RECORD\nBREAKERS',
    fill: theme => readableOn(PLATINUM, theme.field, MIN_ACCENT_CONTRAST),
  },
```

Import `PLATINUM` from `./treatments.js` alongside `GOLD, BLUE`. In `.badge` (CardTemplate.module.css) change `white-space: nowrap;` to `white-space: pre;` (identical for one-line labels; keeps the line break).

- [ ] **Step 4: Run the card tests**

Run: `npx vitest run src/cards`
Expected: PASS (the badge contrast sweep in treatments.test.js covers the new fill).

- [ ] **Step 5: Commit**

```bash
git add src/cards/badges.js src/cards/CardTemplate.module.css src/cards/CardTemplate.test.js src/cards/treatments.test.js
git commit -m "feat(cards): the RECORD BREAKERS pill, on two lines"
```

---

### Task 3: The lit plaque

**Files:**
- Modify: `src/cards/CardTemplate.jsx` (new `RecordPlaque` near `TeamLogo` ~line 865; rendered inside `.photoOuter` after `.photoWindow` ~line 527)
- Modify: `src/cards/CardTemplate.module.css` (new `.plaque*` block after `.photoPlaceholder`)
- Test: `src/cards/CardTemplate.test.js`

**Interfaces:**
- Consumes: `card.record = { number: string, label: string }` (optional).
- Produces: markup `<div data-record-plaque>` containing the number, the label and `RECORD BREAKER`; nothing when `card.record` is absent.

- [ ] **Step 1: Write the failing tests**

```js
describe('the lit plaque (Record Breakers, 2026-10-14)', () => {
  const card = { name: 'LeBron James', team: 'LAL', season: 2023, seasonLabel: '2022-23', record: { number: '38,388', label: 'ALL-TIME PTS' } };

  it('prints the number, the record and the engraving on any card with a record', () => {
    const html = render({ card });
    expect(html).toContain('data-record-plaque');
    expect(html).toContain('38,388');
    expect(html).toContain('ALL-TIME PTS');
    expect(html).toContain('RECORD BREAKER');
  });

  it('prints nothing on a card without one', () => {
    expect(render({ card: { ...card, record: undefined } })).not.toContain('data-record-plaque');
  });

  it('draws on a card with no photo too', () => {
    expect(render({ card, photoUrl: null })).toContain('data-record-plaque');
  });

  it('steps the label down when it is long', () => {
    const long = render({ card: { ...card, record: { number: '182', label: 'ALL-TIME TRIPLE-DOUBLES' } } });
    expect(long).toMatch(/data-record-label[^>]*font-size:\s*(1[0-9]|2[0-1])px/);
  });

  it('sits inside the photo, left of its cut corner', () => {
    const plaque = cssBlock('.plaque');
    expect(pxIn(plaque, 'left') + pxIn(plaque, 'width')).toBeLessThanOrEqual(456);
  });
});
```

(`cssBlock` and `pxIn` already exist in this test file; they read CardTemplate.module.css.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/cards/CardTemplate.test.js -t plaque`
Expected: FAIL — no `data-record-plaque`, no `.plaque` rule.

- [ ] **Step 3: Implement** — in `CardTemplate.jsx`, near `TeamLogo`:

```jsx
/**
 * THE LIT PLAQUE (2026-10-14, the user's pick of four mockups, "Lit plaque"):
 * a platinum-rimmed LED panel on the photo's lower edge, the record's number in
 * amber digits and its name beneath, RECORD BREAKER engraved on the rim. Any
 * card with `record` wears it — a Record Breakers card, and a Super Season whose
 * season set the record. Inside .photoOuter so it moves with the photo frame,
 * and left of the window's cut corner (x 456 in the window's coordinates).
 */
function RecordPlaque({ record }) {
  if (!record?.number) return null;
  const label = record.label ?? '';
  // 26px holds "ALL-TIME PTS"; a longer name steps down to fit the 380px plate.
  const labelSize = label.length > 16 ? Math.max(16, Math.floor(26 * 16 / label.length)) : 26;
  return (
    <div className={styles.plaque} data-record-plaque="">
      <div className={styles.plaqueRim}>RECORD BREAKER</div>
      <div className={styles.plaquePanel}>
        <div className={styles.plaqueNumber}>{record.number}</div>
        {label && <div className={styles.plaqueLabel} data-record-label="" style={{ fontSize: `${labelSize}px` }}>{label}</div>}
      </div>
    </div>
  );
}
```

Render it inside `.photoOuter`, after the closing `</div>` of `.photoWindow`:

```jsx
        <RecordPlaque record={card.record} />
```

In `CardTemplate.module.css`, after `.photoPlaceholder`:

```css
/* ── The lit plaque (Record Breakers, 2026-10-14) ────────────────────────────
 * In .photoOuter's coordinates: the photo's bottom edge is y=785 and its cut
 * corner starts at x=456, so a 380px plate from x=30 clears both. Tuned by eye
 * in the Studio against LeBron's 2022-23 face; the numbers are the spec. */
.plaque {
  position: absolute;
  left: 30px;
  bottom: 20px;
  width: 380px;
  padding: 0 8px 8px;
  border-radius: 8px;
  background: linear-gradient(135deg, #8C939C 0%, #F7F8FA 45%, #D9DCE1 70%, #8C939C 100%);
  text-align: center;
}
.plaqueRim {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 4px;
  line-height: 22px;
  color: #3A3F46;
}
.plaquePanel {
  padding: 10px 12px 12px;
  border-radius: 4px;
  background-color: #0B0B0C;
  /* The LED's dot grid, static so the export screenshots it as drawn. */
  background-image: radial-gradient(rgba(255, 138, 31, 0.14) 1px, transparent 1.4px);
  background-size: 5px 5px;
}
.plaqueNumber {
  font-size: 64px;
  font-weight: 700;
  letter-spacing: 6px;
  line-height: 1;
  color: #FF8A1F;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 10px rgba(255, 138, 31, 0.55);
}
.plaqueLabel {
  margin-top: 6px;
  font-weight: 700;
  letter-spacing: 3px;
  line-height: 1;
  color: #FFB866;
  white-space: nowrap;
}
```

- [ ] **Step 4: Run the card tests**

Run: `npx vitest run src/cards`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cards/CardTemplate.jsx src/cards/CardTemplate.module.css src/cards/CardTemplate.test.js
git commit -m "feat(cards): the lit plaque that carries a record"
```

---

### Task 4: The set, with LeBron in it — the Studio checkpoint

**Files:**
- Create: `card-data/record-breakers.json`
- Create: `scripts/cardgen/generateRecordBreakers.js`, `scripts/cardgen/generateRecordBreakers.test.js`
- Create (generated): `card-data/generated/cards-record-breakers.json`, `card-data/generated/card-records.json`
- Modify: `src/cards/sets.js` (constant + `SETS` row after Dissonance ~line 316)
- Modify: `src/game/cardSets.js` (import + `CARD_SETS` entry after `dissonance` ~line 92)
- Modify: `src/studio/players.js` (glob ~line 343, a `RECORD_BREAKERS_FILE`, a `SOURCES` entry after Dissonance ~line 610, the `record` join in `specialSource`)
- Modify: `scripts/studio/export.js` (`SET_FILES` ~line 61)
- Modify: `scripts/studio/dormantThrowbacks.mjs` (`THROWBACK_FILES`)
- Modify: `card-data/curated-cards-2026.json` (LeBron's row leaves), `card-data/manual-awards.json` (REC leaves), `src/cards/awards.js` (REC row leaves; keep the `manual` reader), `src/cards/awards.test.js`, `scripts/cardgen/generateAwards.test.js`
- Move: `card-art/sets/throwbacks/photos/LeBron_James_2023.jpg` → `card-art/sets/record-breakers/photos/`; its crop key from `card-art/sets/throwbacks/crops.json` → `card-art/sets/record-breakers/crops.json`

**Interfaces:**
- Consumes: Tasks 1-3 (`platinum`, `RECORD_BREAKERS_BADGE`, `card.record`).
- Produces: `RECORD_BREAKERS_SET = 'record-breakers'` (sets.js); rows `{ bbrefId, name, season, record: { number, label }, earn, why, check?, verifiedBy? }` or plaque-only `{ card: 'set:id', record }`; `card-records.json` = `{ generatedAt, records: { 'set:id': { number, label } } }`; `isFeatCard(card)` exported from `src/game/recordBreakers.js` = `card?.set === 'record-breakers' && !!card.earn && card.earn !== 'pack'`.

- [ ] **Step 1: Write the failing generator test** — `scripts/cardgen/generateRecordBreakers.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { recordCard, checkRecord, recordsIndex, SET_ID } from './generateRecordBreakers.js';

describe('the Record Breakers generator', () => {
  const built = { id: 'LeBron_James_2023', name: 'LeBron James', set: 'throwbacks', season: 2023, requested: true, requestId: null, builtAt: 'x', salary: 1970 };
  const row = { bbrefId: 'jamesle01', name: 'LeBron James', season: 2023, record: { number: '38,388', label: 'ALL-TIME PTS' }, earn: 'career-points', why: 'w' };

  it('relabels a built Throwback into the set, season in the id, request fields gone', () => {
    const card = recordCard(built, row);
    expect(card).toMatchObject({ id: 'LeBron_James_2023', set: SET_ID, record: row.record, earn: 'career-points', why: 'w' });
    for (const f of ['requested', 'requestId', 'builtAt']) expect(card).not.toHaveProperty(f);
  });

  it('refuses a season record the numbers do not support', () => {
    const log = { reg: [{ ast: 600 }, { ast: 564 }] };
    expect(() => checkRecord({ ...row, check: { source: 'log', stat: 'ast', total: 1164 } }, { log })).not.toThrow();
    expect(() => checkRecord({ ...row, check: { source: 'log', stat: 'ast', total: 1165 } }, { log })).toThrow(/1,?165/);
    const perPoss = { ftPct: 0.981 };
    expect(() => checkRecord({ ...row, check: { source: 'perPoss', field: 'ftPct', value: 0.981 } }, { perPoss })).not.toThrow();
    expect(() => checkRecord({ ...row, check: { source: 'perPoss', field: 'ftPct', value: 0.99 } }, { perPoss })).toThrow();
  });

  it('indexes every plaque by set and id, the plaque-only rows included', () => {
    const idx = recordsIndex([recordCard(built, row)], [{ card: 'super-season:Stephen_Curry', record: { number: '402', label: '3PM' } }]);
    expect(idx).toEqual({
      'record-breakers:LeBron_James_2023': { number: '38,388', label: 'ALL-TIME PTS' },
      'super-season:Stephen_Curry': { number: '402', label: '3PM' },
    });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run scripts/cardgen/generateRecordBreakers.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the data file and the generator**

`card-data/record-breakers.json` (LeBron first; the roster arrives in Task 5):

```json
{
  "_comment": "RECORD BREAKERS (2026-10-14, docs/plans/2026-10-14-record-breakers-design.md). One row per record. A season row builds a card in the record-breakers set (scripts/cardgen/generateRecordBreakers.js) from its real game log; a row naming `card` puts the plaque on a card that already exists. `record` is what the lit plaque prints. `earn` is \"pack\" or a feat id (feats are part 2). `check` makes the builder verify the number from the cache ({source:'log',stat,total} or {source:'perPoss',field,value}); a record the cache cannot see names its source in `verifiedBy`.",
  "rows": [
    {
      "bbrefId": "jamesle01", "name": "LeBron James", "season": 2023,
      "record": { "number": "38,388", "label": "ALL-TIME PTS" },
      "earn": "career-points",
      "verifiedBy": "passed Kareem Abdul-Jabbar's 38,387 on 2023-02-07",
      "why": "Ryan, through the suggestion box (2026-10-11): \"Maybe a dissonance card for breaking lebrons all time scoring record.\" The user (2026-10-14) made it the first card of its own set, Record Breakers."
    }
  ]
}
```

`scripts/cardgen/generateRecordBreakers.js`:

```js
// RECORD BREAKERS — the set's cards, from card-data/record-breakers.json.
//
//   node scripts/cardgen/generateRecordBreakers.js
//
// Each season row is built through the Free Agents builder as a Throwback
// (write:false: never a request, and record-breakers is not a set a request
// can build into), then relabelled into this set with its season in the id.
// Writes cards-record-breakers.json and card-records.json (every plaque, by
// set and id, the plaque-only rows on existing cards included). Runs after
// generateCuratedCards.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, readCache } from './cache.js';
import { buildFreeAgent } from './buildFreeAgent.mjs';
import { playerIdFromName } from '../../src/studio/players.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const SET_ID = 'record-breakers';
export const ROWS_FILE = path.join(REPO_ROOT, 'card-data', 'record-breakers.json');
export const OUTPUT_FILE = path.join(GEN_DIR, 'cards-record-breakers.json');
export const RECORDS_FILE = path.join(GEN_DIR, 'card-records.json');
const REQUEST_ONLY_FIELDS = ['requested', 'requestId', 'builtAt'];

export function readRows(file = ROWS_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).rows ?? [];
}

/** A built Throwback as this set's card. */
export function recordCard(built, row) {
  const out = { ...built };
  for (const f of REQUEST_ONLY_FIELDS) delete out[f];
  return {
    ...out,
    id: `${playerIdFromName(row.name)}_${row.season}`,
    set: SET_ID,
    record: row.record,
    earn: row.earn,
    why: row.why,
  };
}

/** Throws when a row's `check` disagrees with the cached numbers. */
export function checkRecord(row, { log = null, perPoss = null } = {}) {
  const c = row.check;
  if (!c) return;
  if (c.source === 'log') {
    const total = (log?.reg ?? []).reduce((n, g) => n + (Number(g[c.stat]) || 0), 0);
    if (total !== c.total) throw new Error(`${row.name} ${row.season}: the log has ${total.toLocaleString('en-US')} ${c.stat}, the row says ${c.total.toLocaleString('en-US')}`);
  } else if (c.source === 'perPoss') {
    const v = perPoss?.[c.field];
    if (v == null || Math.abs(v - c.value) > 0.0005) throw new Error(`${row.name} ${row.season}: ${c.field} is ${v}, the row says ${c.value}`);
  } else {
    throw new Error(`${row.name} ${row.season}: unknown check source ${c.source}`);
  }
}

/** `{ 'set:id': record }` for every plaque. */
export function recordsIndex(cards, plaqueRows) {
  const out = {};
  for (const c of cards) out[`${c.set}:${c.id}`] = c.record;
  for (const r of plaqueRows) out[r.card] = r.record;
  return out;
}

const tryCache = key => { try { return readCache(key); } catch { return null; } };
const perPossRow = (bbrefId, season) => {
  const t = tryCache(`bbref-${season}-perPoss-full`);
  const rows = Array.isArray(t) ? t : t?.rows ?? t?.data ?? [];
  return rows.filter(r => r.playerId === bbrefId).sort((a, b) => (b.games ?? 0) - (a.games ?? 0))[0] ?? null;
};

export async function main({ log = console.log } = {}) {
  const rows = readRows();
  const cards = [];
  for (const row of rows.filter(r => !r.card)) {
    const built = await buildFreeAgent({ bbrefId: row.bbrefId, season: Number(row.season), playoffs: false, set: 'throwbacks', write: false });
    const gameLog = tryCache(`gamelog-full-${row.bbrefId}-${row.season}`);
    checkRecord(row, { log: gameLog?.data ?? gameLog, perPoss: perPossRow(row.bbrefId, row.season) });
    cards.push(recordCard(built.card, row));
    log(`  ${row.name} ${row.season}: ${SET_ID}:${cards.at(-1).id} $${built.salary} ${built.rarity} · ${row.record.number} ${row.record.label}`);
  }
  cards.sort((a, b) => b.salary - a.salary || a.id.localeCompare(b.id));
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify({
    set: SET_ID, generatedAt,
    note: 'RECORD BREAKERS — generator-owned (scripts/cardgen/generateRecordBreakers.js from card-data/record-breakers.json).',
    cards,
  }, null, 1)}\n`);
  fs.writeFileSync(RECORDS_FILE, `${JSON.stringify({ generatedAt, records: recordsIndex(cards, rows.filter(r => r.card)) }, null, 1)}\n`);
  log(`Record Breakers: ${cards.length} card(s), ${rows.filter(r => r.card).length} plaque(s) on existing cards.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
```

(If `playerIdFromName` cannot be imported in Node from `src/studio/players.js` because of `import.meta.glob`, import it from where `buildFreeAgent.mjs` imports it — check that file's imports and use the same module.)

Create `src/game/recordBreakers.js`:

```js
/** A Record Breakers card earned by a feat, never dealt by a pack (docs/plans/2026-10-14-record-breakers-design.md). */
export const isFeatCard = card => card?.set === 'record-breakers' && !!card.earn && card.earn !== 'pack';
```

- [ ] **Step 4: Register the set** —
  - `src/cards/sets.js`: `export const RECORD_BREAKERS_SET = 'record-breakers';` near `DISSONANCE_SET`, import `RECORD_BREAKERS_BADGE`, and after the Dissonance row:

```js
  {
    // RECORD BREAKERS (2026-10-14): a season a record was set, carded. The
    // platinum frame and pill are the set; the record rides on the lit plaque.
    id: RECORD_BREAKERS_SET,
    name: 'Record Breakers',
    statsSeason: 'the record season',
    kind: 'special',
    editable: true,
    hidesEmptyRows: true,
    showsSeason: true,
    badge: RECORD_BREAKERS_BADGE,
    treatment: 'platinum',
  },
```

  - `src/game/cardSets.js`: `import recordBreakers from '../../card-data/generated/cards-record-breakers.json' with { type: 'json' };` and `['record-breakers', recordBreakers],` after `['dissonance', dissonance],`.
  - `src/studio/players.js`: add `record-breakers` to the glob's brace list; `export const RECORD_BREAKERS_FILE = loadSpecialSet(RECORD_BREAKERS_SET);`; a `SOURCES` entry after Dissonance, copying the Dissonance entry's shape with `sub: 'records, carded'` and `hint: 'A season a record was set. Built by scripts/cardgen/generateRecordBreakers.js from card-data/record-breakers.json.'`; in `specialSource`'s card map add `record: recordFor(id, card.id) ?? card.record,` where `recordFor` reads `card-data/generated/card-records.json` through `import.meta.glob(..., { eager: true })` exactly as `awardsFor` reads card-awards.json.
  - `scripts/studio/export.js` `SET_FILES`: `'record-breakers': 'cards-record-breakers.json',`.
  - `scripts/studio/dormantThrowbacks.mjs`: add `'cards-record-breakers.json'` to `THROWBACK_FILES` (a photo-less Record Breakers card sits out like a photo-less Throwback).

- [ ] **Step 5: Move LeBron** —
  - Delete LeBron's 2023 row from `card-data/curated-cards-2026.json`; run `node scripts/cardgen/generateCuratedCards.js` (the throwbacks file loses `LeBron_James_2023`; revert `cards-wnba-throwbacks.json` if only `generatedAt` changed).
  - `mkdir -p card-art/sets/record-breakers/photos` and `git mv` is not possible (photos are gitignored) — move the file on disk: `mv card-art/sets/throwbacks/photos/LeBron_James_2023.jpg card-art/sets/record-breakers/photos/`; move the `LeBron_James_2023` key from `card-art/sets/throwbacks/crops.json` into a new `card-art/sets/record-breakers/crops.json` (`{ "LeBron_James_2023": { ...same values } }`).
  - REC leaves: remove the REC row from `AWARDS` in `src/cards/awards.js` (keep `manual` support and its comment, noting REC was retired for the plaque); empty `card-data/manual-awards.json` to its `_comment` alone; update the REC expectations in `src/cards/awards.test.js` (back to MVP first, the `manual` test now asserts no row is manual) and `scripts/cardgen/generateAwards.test.js` (use a test-only file with a declared manual code, or assert that a REC entry now throws "not a manual mark"); run `node scripts/cardgen/generateAwards.js`.
  - Run `node scripts/cardgen/generateRecordBreakers.js` and `node scripts/studio/dormantThrowbacks.mjs`.

- [ ] **Step 6: Add the set-level render test** (moved here from Task 2) and run everything

```js
  it('renders a Record Breakers card: platinum, the two-line pill, the plaque', () => {
    const html = render({ card: { name: 'LeBron James', team: 'LAL', season: 2023, seasonLabel: '2022-23', record: { number: '38,388', label: 'ALL-TIME PTS' } }, set: 'record-breakers' });
    expect(html).toContain('RECORD\nBREAKERS');
    expect(html).toContain('--treatment-frame-width:14px');
    expect(html).toContain('38,388');
  });
```

Run: `npx vitest run`
Expected: all PASS. Known test pins to update if they fail: set counts in `src/cards/sets.test.js`, the studio's source list in `src/studio/players.test.js`, `SET_FILES` coverage in export tests.

- [ ] **Step 7: The Studio checkpoint** — start the Studio (`preview_start` name `studio`), open `studio.html`, pick Record Breakers, open LeBron James. Screenshot it, export his face (`npm run export:cards -- --set record-breakers --only LeBron_James_2023`), and show the user both. Tune `.plaque` position/size and the platinum values by eye with the user; commit the tuned values. STOP here for the user's verdict on the look before Task 5.

- [ ] **Step 8: Commit**

```bash
git add card-data/record-breakers.json card-data/generated/cards-record-breakers.json card-data/generated/card-records.json card-data/generated/cards-throwbacks.json card-data/generated/dormant-throwbacks.json card-data/generated/card-awards.json card-data/curated-cards-2026.json card-data/manual-awards.json card-art/sets/record-breakers/crops.json card-art/sets/throwbacks/crops.json scripts/cardgen/generateRecordBreakers.js scripts/cardgen/generateRecordBreakers.test.js src/game/recordBreakers.js src/cards/sets.js src/game/cardSets.js src/studio/players.js scripts/studio/export.js scripts/studio/dormantThrowbacks.mjs src/cards/awards.js src/cards/awards.test.js scripts/cardgen/generateAwards.test.js src/cards/CardTemplate.test.js public/cards/record-breakers/LeBron_James_2023.png public/cards/thumbs/record-breakers/LeBron_James_2023.webp
git commit -m "feat(cards): the Record Breakers set, LeBron James 2022-23 its first card"
```

---

### Task 5: The roster

**Files:**
- Modify: `card-data/record-breakers.json` (11 more rows + 3 plaque-only rows)
- Regenerated: `cards-record-breakers.json`, `card-records.json`, `dormant-throwbacks.json`; cache files for any fetched game log

**Interfaces:**
- Consumes: Task 4's generator and row shape.
- Produces: the 12-card set and three plaques on Super Seasons.

- [ ] **Step 1: Add the rows** — append to `rows` (earn ids are part 2's names; pack cards say `"pack"`):

```json
    { "bbrefId": "allenra02", "name": "Ray Allen", "season": 2011, "record": { "number": "2,561", "label": "ALL-TIME 3PM" }, "earn": "career-threes-1", "verifiedBy": "passed Reggie Miller's 2,560 on 2011-02-10", "why": "The all-time three-point lead." },
    { "bbrefId": "curryst01", "name": "Stephen Curry", "season": 2022, "record": { "number": "2,974", "label": "ALL-TIME 3PM" }, "earn": "career-threes-2", "verifiedBy": "passed Ray Allen's 2,973 on 2021-12-14", "why": "The all-time three-point lead, from Ray Allen." },
    { "bbrefId": "westbru01", "name": "Russell Westbrook", "season": 2021, "record": { "number": "182", "label": "ALL-TIME TRIPLE-DOUBLES" }, "earn": "career-triple-doubles", "verifiedBy": "182nd on 2021-05-10, passing Oscar Robertson's 181", "why": "The career triple-double record." },
    { "bbrefId": "malonka01", "name": "Karl Malone", "season": 2001, "record": { "number": "8,532", "label": "ALL-TIME FTM" }, "earn": "career-free-throws", "verifiedBy": "passed Moses Malone's 8,531 on 2001-03-24", "why": "The career free-throws-made record." },
    { "bbrefId": "stockjo01", "name": "John Stockton", "season": 1991, "record": { "number": "1,164", "label": "AST" }, "earn": "season-assists", "check": { "source": "log", "stat": "ast", "total": 1164 }, "why": "The single-season assists record." },
    { "bbrefId": "caldejo01", "name": "José Calderón", "season": 2009, "record": { "number": "98.1%", "label": "FT" }, "earn": "season-ft-pct", "check": { "source": "perPoss", "field": "ftPct", "value": 0.981 }, "why": "The single-season free-throw percentage record." },
    { "bbrefId": "korveky01", "name": "Kyle Korver", "season": 2010, "record": { "number": "53.6%", "label": "3PT" }, "earn": "season-3pt-pct", "check": { "source": "perPoss", "field": "fgPct3", "value": 0.536 }, "why": "The single-season three-point percentage record." },
    { "bbrefId": "stockjo01", "name": "John Stockton", "season": 1996, "record": { "number": "2,311", "label": "ALL-TIME STL" }, "earn": "pack", "verifiedBy": "passed Maurice Cheeks' 2,310 on 1996-02-20", "why": "The career steals record." },
    { "bbrefId": "olajuha01", "name": "Hakeem Olajuwon", "season": 1996, "record": { "number": "3,190", "label": "ALL-TIME BLK" }, "earn": "pack", "verifiedBy": "CONFIRM before committing: Basketball-Reference season totals put the crossing of Kareem's 3,189 in 1995-96", "why": "The career blocks record." },
    { "bbrefId": "eatonma01", "name": "Mark Eaton", "season": 1985, "record": { "number": "456", "label": "BLK" }, "earn": "pack", "verifiedBy": "Basketball-Reference single-season blocks leaders", "why": "The single-season blocks record." },
    { "bbrefId": "roberal01", "name": "Alvin Robertson", "season": 1986, "record": { "number": "301", "label": "STL" }, "earn": "pack", "verifiedBy": "Basketball-Reference single-season steals leaders", "why": "The single-season steals record." },
    { "card": "super-season:Stephen_Curry", "record": { "number": "402", "label": "3PM" } },
    { "card": "super-season:Russell_Westbrook", "record": { "number": "42", "label": "TRIPLE-DOUBLES" } },
    { "card": "super-season:John_Stockton", "record": { "number": "9,922", "label": "ALL-TIME AST" } }
```

Before running: look up each bbrefId in the cached season tables (`card-data/cache/bbref-<season>-advanced-full.json`, `playerId`) — the ids above are Basketball-Reference's usual pattern and MUST be confirmed; correct any that miss. Confirm Hakeem's crossing season from Basketball-Reference (career blocks through 1994-95 below 3,189, through 1995-96 above) and replace that `verifiedBy` text with the finding. Check each plaque-only `card` key exists (`getCardByKey`).

- [ ] **Step 2: Build** — `node scripts/cardgen/generateRecordBreakers.js` (fetches any uncached game log politely; a `check` mismatch throws — fix the row, never the check). Then `node scripts/studio/dormantThrowbacks.mjs`.

- [ ] **Step 3: Test** — add to `generateRecordBreakers.test.js`:

```js
import fs from 'node:fs';
import { getCardByKey } from '../../src/game/cardSets.js';

describe('the committed Record Breakers', () => {
  const file = JSON.parse(fs.readFileSync(new URL('../../card-data/generated/cards-record-breakers.json', import.meta.url), 'utf8'));
  const records = JSON.parse(fs.readFileSync(new URL('../../card-data/generated/card-records.json', import.meta.url), 'utf8')).records;

  it('holds the twelve, every one with a plaque and a season in its id', () => {
    expect(file.cards).toHaveLength(12);
    for (const c of file.cards) {
      expect(c.id).toMatch(/_\d{4}$/);
      expect(c.record?.number).toBeTruthy();
      expect(records[`record-breakers:${c.id}`]).toEqual(c.record);
    }
  });

  it('puts the plaque on the three existing record seasons', () => {
    for (const key of ['super-season:Stephen_Curry', 'super-season:Russell_Westbrook', 'super-season:John_Stockton']) {
      expect(records[key]).toBeTruthy();
      expect(getCardByKey(key)).toBeTruthy();
    }
  });

  it('deals four by packs and earns eight by feats', () => {
    expect(file.cards.filter(c => c.earn === 'pack')).toHaveLength(4);
    expect(file.cards.filter(c => c.earn !== 'pack')).toHaveLength(8);
  });
});
```

Run: `npx vitest run scripts/cardgen/generateRecordBreakers.test.js src/studio`
Expected: PASS.

- [ ] **Step 4: Photos** — every new card without a photo is dormant; set `photoWanted` on them: in `recordCard` add `photoWanted: true` (the Photo Hunt then lists them via PHOTO_WANTED_KEYS — extend `GENERATED_THROWBACKS` in `src/game/cardSets.js` to include the record-breakers cards so their dormant/wanted keys resolve, and add `'record-breakers'` to `photoHunt.mjs`'s SECTIONS). Regenerate the hunt page and republish it to https://claude.ai/code/artifact/31c9da16-a594-4333-b92c-dbe525d14414 (read it first). Export the faces that have photos.

- [ ] **Step 5: Commit**

```bash
git add card-data/record-breakers.json card-data/generated/cards-record-breakers.json card-data/generated/card-records.json card-data/generated/dormant-throwbacks.json scripts/cardgen/generateRecordBreakers.js scripts/cardgen/generateRecordBreakers.test.js src/game/cardSets.js scripts/studio/photoHunt.mjs
git add card-data/cache/
git commit -m "cards: the Record Breakers roster, twelve cards and three plaques"
```

---

### Task 6: Packs and the coins-only goal

**Files:**
- Modify: `src/game/packEngine.js` (`SPECIAL_SETS_IN_PACKS` ~line 357; `poolFor` ~line 569)
- Modify: `src/game/collections.js` (`SPECIAL_SETS` ~line 112; `COINS_ONLY_GOALS` ~line 233; `goalCards`)
- Test: `src/game/recordBreakers.test.js`

**Interfaces:**
- Consumes: `isFeatCard` (Task 4), the roster (Task 5).
- Produces: goal id `set-record-breakers`.

- [ ] **Step 1: Write the failing tests** — `src/game/recordBreakers.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { CARD_SETS, cardKey } from './cardSets.js';
import { isFeatCard } from './recordBreakers.js';
import { PACK_TYPES, poolFor, generatePack } from './packEngine.js';
import { GOALS, COINS_ONLY_GOALS } from './collections.js';

const set = CARD_SETS['record-breakers'] ?? [];
const featKeys = new Set(set.filter(isFeatCard).map(cardKey));

describe('Record Breakers in packs and collections', () => {
  it('never puts a feat card in any pack pool', () => {
    for (const [key, def] of Object.entries(PACK_TYPES)) {
      expect(poolFor(def).filter(isFeatCard).map(c => c.name), key).toEqual([]);
    }
  });

  it('can deal the pack cards', () => {
    const pool = poolFor(PACK_TYPES.booster ?? PACK_TYPES.nba_booster);
    expect(pool.some(c => c.set === 'record-breakers' && c.earn === 'pack')).toBe(true);
  });

  it('never deals a feat card in many boosters', () => {
    for (let i = 0; i < 300; i += 1) {
      const pack = generatePack('booster');
      expect(pack.filter(c => featKeys.has(c.id))).toEqual([]);
    }
  });

  it('has a coins-only goal asking for every card in the set', () => {
    const goal = GOALS.find(g => g.id === 'set-record-breakers');
    expect(goal).toBeTruthy();
    expect(goal.requires).toEqual(set.map(cardKey).sort());
    expect(COINS_ONLY_GOALS.has('set-record-breakers')).toBe(true);
  });
});
```

(Check `PACK_TYPES` for the key of the both-leagues booster that mixes specials — `mixesSpecials: true` — and use it in both booster tests.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/game/recordBreakers.test.js`
Expected: FAIL — no pack card in the pool, no goal.

- [ ] **Step 3: Implement** —
  - `SPECIAL_SETS_IN_PACKS`: add `'record-breakers'` after `'dissonance'`.
  - `poolFor`: `return dealablePool(def).filter(c => !isUnsignedCard(c) && !isFeatCard(c));` and import `isFeatCard` from `./recordBreakers.js`; extend the comment above it with one line: feat cards are earned, never dealt.
  - `collections.js` `SPECIAL_SETS`: add `{ id: 'record-breakers', label: 'Record Breakers', league: 'NBA' },` after Dissonance; `COINS_ONLY_GOALS`: add `'set-record-breakers'` with a comment quoting the user: "Does not need to have a reward card."

- [ ] **Step 4: Run the game tests**

Run: `npx vitest run src/game`
Expected: PASS. If a collections test pins the special-set list or the goal count, update it to include Record Breakers.

- [ ] **Step 5: Commit**

```bash
git add src/game/packEngine.js src/game/collections.js src/game/recordBreakers.test.js
git commit -m "feat(packs): Record Breakers' pack cards in boosters, a coins-only goal"
```

---

### Task 7: News, rules, memory

**Files:**
- Modify: `src/game/home.js` (NEWS), `src/components/HowToPlay.jsx` / `src/components/Rulebook.jsx` (the special-sets lines; find with `grep -n "Dissonance" src/components/HowToPlay.jsx src/components/Rulebook.jsx`)
- Memory: `memory/record_breakers.md` + `MEMORY.md` line

- [ ] **Step 1:** Add a NEWS item (id `record-breakers`, today's date, `to: 'goals'`, cta `Collections`): the set, its platinum look and plaque, the four pack cards, that eight are earned by feats "coming soon" (part 2), and the coins-only goal.
- [ ] **Step 2:** Add one Record Breakers line beside Dissonance in How to Play and the Rulebook.
- [ ] **Step 3:** Run `npx vitest run`; expected all PASS.
- [ ] **Step 4:** Commit `src/game/home.js` and the two components; push.
- [ ] **Step 5:** Write the memory file (the set, the files, the generator's place in the pipeline after generateCuratedCards, the plaque join, isFeatCard, part 2 pending) and its index line.

---

## Part 2 (separate plan, after measurement)

Feats: lifetime tracker `ftm` and `td`; the measurement (simulated games → accumulation rates → thresholds sized to the effort of a collection of similar value); the user approves the numbers; the server grant in `claimGameReward` and at season end; the client chips. Written once the measurement exists, so its steps carry real numbers.
