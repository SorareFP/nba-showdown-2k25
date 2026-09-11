# Throwbacks Look Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the approved Throwbacks look (`docs/plans/2026-09-10-throwbacks-design.md`). Every Throwbacks card, NBA and WNBA, gets the 1990s teal-brush and purple-zigzag look, and Throwbacks requests can be built.

**Architecture:**
- The look is a regular set treatment, `throwback`, in `src/cards/treatments.js`. It supplies the keyline, the frame sweep and the band edge, and steps the band's diagonal stripes aside. It marks itself with `motif: 'throwback'`.
- `CardTemplate` renders `ThrowbackMotif` (static SVG) when the treatment carries that motif: over the band's two open patches, and in place of the two dotted chevrons.
- The two sets are declared in `sets.js` with that treatment and the THROWBACK badge.
- Throwbacks has no generated card file, so the Studio's set loader and the face exporter learn to hold a set made only of requested cards.

**Tech Stack:** React 18, Vite 5, Vitest 2 (node env; component tests use `renderToStaticMarkup`), Playwright for export.

**Already in the working tree, uncommitted, from the mockup round:**
- `sets.js`: `THROWBACKS_SET`, `WNBA_THROWBACKS_SET` and their two rows, each `treatment: null`.
- `badges.js`: `THROWBACK_BADGE` and its pill.
- `src/cards/eras.js`, `src/cards/EraMotif.jsx` and `EraMotif.module.css`: the six-decade version.
- `CardTemplate.jsx`: wired to `throwbackEra` and `EraMotif`.
- The mockup page `__mock__/` and photo copies under `card-art/sets/{throwbacks,wnba-throwbacks}/photos/`. The photos are gitignored.

Seven pinned tests fail until Task 3. Run the tests from the worktree: `npx vitest run <paths>`.

---

### Task 1: The `throwback` treatment

**Files:**
- Modify: `src/cards/treatments.js`. Add the colours, `throwbackLook` and the `TREATMENTS` entry.
- Test: `src/cards/treatments.test.js`. The `describe.each(TREATMENT_IDS)` sweep covers the new id automatically. Add a short block.

**Step 1: Write the failing test.** Append to `treatments.test.js`:

```js
describe('the throwback treatment', () => {
  it('sweeps the keyline teal to purple and lays a band edge, all static gradients', () => {
    const t = themeFor(STOCK[0], 'throwback');
    expect(t.treatment.id).toBe('throwback');
    expect(t.treatment.motif).toBe('throwback');
    expect(t.treatment.frameImage).toMatch(/^linear-gradient\(135deg, #1FB5B5/);
    expect(t.treatment.bandEdge).toMatch(/^linear-gradient\(90deg/);
  });

  it('steps the band stripes aside and leaves every inked surface as the team had it', () => {
    for (const team of STOCK) {
      const [, primary, secondary, accent] = team;
      const base = deriveFieldTheme(primary, secondary, accent);
      const t = applyTreatment(base, 'throwback');
      expect(t.stripeTonal).toBe('transparent');
      expect(t.stripeSecondary).toBe('transparent');
      for (const k of ['field', 'ink', 'panel', 'panelInk', 'bandTop', 'bandBottom', 'bandInk', 'accentOnField']) {
        expect(t[k], k).toBe(base[k]);
      }
    }
  });
});
```

**Step 2:** `npx vitest run src/cards/treatments.test.js`. It is expected to FAIL, because `'throwback'` is not a treatment.

**Step 3:** Implement in `treatments.js`, above `TREATMENTS`:

```js
// THROWBACK — the Free Agents catch-all set (docs/plans/2026-09-10-throwbacks-design.md).
// One look for every Throwbacks card, any decade: the 1990s cup's teal brush
// stroke and purple scribble, loud on purpose ("keep the loud colors, it's
// fine"). The drawing is ThrowbackMotif.jsx's; this is the palette around it.
// Nothing inked moves, so the sweep's contrast contract holds by construction.
export const THROWBACK_TEAL = '#1FB5B5';
export const THROWBACK_PURPLE = '#6A2C91';

function throwbackLook(theme) {
  return {
    ...theme,
    frame: readableOn(THROWBACK_TEAL, theme.field, MIN_DECOR_CONTRAST),
    // The band's diagonal stripes step aside: the brush patches are its pattern.
    stripeTonal: 'transparent',
    stripeSecondary: 'transparent',
    treatment: {
      id: 'throwback',
      motif: 'throwback',
      fieldStops: [theme.field],
      bandStops: [theme.bandTop, theme.bandBottom],
      sheen: null,
      band: null,
      frameImage: `linear-gradient(135deg, ${THROWBACK_TEAL} 0%, #2BC9C9 45%, ${THROWBACK_PURPLE} 100%)`,
      bandEdge: `linear-gradient(90deg, ${THROWBACK_TEAL} 0%, #2BC9C9 50%, ${THROWBACK_PURPLE} 100%)`,
    },
  };
}
```

and add `throwback: throwbackLook,` to `TREATMENTS`.

**Step 4:** `npx vitest run src/cards/treatments.test.js`. It is expected to PASS, including every sweep test for `throwback`.

**Step 5:** `git add src/cards/treatments.js src/cards/treatments.test.js`, then `git commit -m "feat(cards): the throwback treatment"`.

### Task 2: The motif, and the hook in CardTemplate

**Files:**
- Create: `src/cards/ThrowbackMotif.jsx`. It is the 1990s half of `EraMotif.jsx`: `brushDefs`, `swath`, `scribble`, `zigzag`, `clipTo`, `SIZE`, `LEFT`, `GAP` and the `NINETIES` band/top/bottom. Drop the other decades, `rng`, `confetti`, `squiggle`, `shadowed`, `longShadow`, `orb` and `sparkle`. The exported component is `ThrowbackMotif({ slot })`.
- Create: `src/cards/ThrowbackMotif.module.css`. It is the same three slot boxes as `EraMotif.module.css`.
- Delete: `src/cards/eras.js`, `src/cards/EraMotif.jsx`, `src/cards/EraMotif.module.css`.
- Modify: `src/cards/CardTemplate.jsx`:
  - drop the `eras.js` and `EraMotif` imports;
  - import `ThrowbackMotif`;
  - put the field line back to `const field = applyTreatment(base, cardTreatment(set, card.salary, card.badges ?? []));`;
  - add `const motif = treatment?.motif ?? null;` after `treatment`;
  - replace the `era &&` and `era ?` renders with `motif &&` / `motif ?`, using `<ThrowbackMotif slot="…" />`.
- Modify: `src/cards/sets.js`. Set `treatment: 'throwback'` on both Throwbacks rows, and change their comments to "one look for every Throwbacks card".
- Test: `src/cards/CardTemplate.test.js`.

**Step 1: Write the failing test.** Append:

```js
describe('the Throwbacks look', () => {
  const card = { id: 'X', name: 'Test Player', team: 'CLE', season: 1996, seasonLabel: '1995-96', salary: 500,
    speed: 10, power: 7, shotLine: 16, paintBoost: 0, threePtBoost: 1, defBoost: 1, pos: 'SG',
    chart: [{ lo: 1, hi: 10, pts: 1, reb: 0, ast: 0 }, { lo: 11, hi: 99, pts: 2, reb: 1, ast: 1 }] };

  it('draws the brush in the band and both corners, instead of the chevrons', () => {
    for (const set of ['throwbacks', 'wnba-throwbacks']) {
      const html = renderToStaticMarkup(<CardTemplate card={{ ...card, team: set.startsWith('wnba') ? 'SEA' : 'CLE' }} set={set} />);
      for (const slot of ['band', 'top', 'bottom']) expect(html, `${set} ${slot}`).toContain(`data-slot="${slot}"`);
      expect(html).toContain('THROWBACK');
      expect(html).toContain('data-treatment="throwback"');
    }
  });

  it('leaves every other set on its chevrons, with no motif', () => {
    const html = renderToStaticMarkup(<CardTemplate card={card} set="rookie" />);
    expect(html).not.toContain('data-slot=');
  });
});
```

Check the file's imports first (`renderToStaticMarkup` and React may already be imported). Match its existing render helper if it has one.

**Step 2:** `npx vitest run src/cards/CardTemplate.test.js -t "Throwbacks look"`. It is expected to FAIL, since the sets still declare `null` and `ThrowbackMotif` does not exist.

**Step 3:** Make the file changes listed above.

**Step 4:** `npx vitest run src/cards/CardTemplate.test.js src/cards/treatments.test.js`. The new block should PASS. The "league mark" test still fails; that is Task 3.

**Step 5:** Commit the new, deleted and modified files by explicit path.

### Task 3: The pinned lists and the badge file

**Files:**
- `src/cards/sets.test.js:42-46`: append `'throwbacks', 'wnba-throwbacks'` to the `SET_IDS` list, and rename the test to "holds the fifteen sets".
- `src/cards/CardTemplate.test.js:750-752`: append `WNBA_THROWBACKS_SET` to `wnbaSets` (import it from `./sets.js`).
- `src/studio/players.test.js:638-645`: add `THROWBACKS_SET, WNBA_THROWBACKS_SET` after `WNBA_SET_REWARDS_SET` (import from `../cards/sets.js`). The title "thirteen" becomes "fifteen".
- `card-data/generated/card-badges.json`: set `priority` to `BADGE_IDS` and add `"throwback": 0` to `counts.applies` and `counts.printed`. That is what `generateSpecialSets` would write, because no base card carries the pill:

```bash
node --input-type=module -e "import fs from 'node:fs'; import { BADGE_IDS } from './src/cards/badges.js'; const f='card-data/generated/card-badges.json'; const b=JSON.parse(fs.readFileSync(f,'utf8')); b.priority=BADGE_IDS; for (const k of ['applies','printed']) b.counts[k].throwback ??= 0; fs.writeFileSync(f, JSON.stringify(b,null,1)+'\n');"
```

**Step 1:** Make the edits.

**Step 2:** `npx vitest run src/cards src/studio scripts/cardgen/generateSpecialSets.test.js`. `players.test` still fails on SOURCES; that is Task 4.

**Step 3:** Commit the test files and `card-badges.json`.

### Task 4: Studio sources and the exporter for a request-only set

**Files:**
- `src/studio/players.js`:
  - `loadSpecialSet(id)`: when no generated file declares `id`, return `{ set: id, cards: FREE_AGENT_CARDS.filter(c => c.set === id), requestedOnly: true }` for the two Throwbacks ids, otherwise `null`;
  - add two `SOURCES` entries after `WNBA_SET_REWARDS_SET` through `specialSource(...)`, with `sub: 'requested cards (Free Agents)'` and a hint saying the cards arrive from the Studio's Requests → Build card;
  - `specialSource`'s `'not generated yet'` branch keys off `file`, so `requestedOnly` files count as present.
- `scripts/studio/export.js`:
  - add `throwbacks: 'cards-throwbacks.json'` and `'wnba-throwbacks': 'cards-wnba-throwbacks.json'` to `SET_FILES`;
  - in `cardsFor`, when the set's own file is missing, return just the free-agent cards joining it, rather than `null`.
- Test: `src/studio/players.test.js`. Add a test that `SOURCES['throwbacks'].players` equals the free-agent cards whose `set` is `'throwbacks'`. It is empty today, so assert on the filter, not a literal.

**Steps:** write the test, run it (FAIL), implement, run `npx vitest run src/studio` (PASS), then commit.

### Task 5: Packs

**Files:**
- `src/game/packEngine.js:138-141`: add `'throwbacks', 'wnba-throwbacks'` to `SPECIAL_SETS_IN_PACKS`. They share the specials' band cap, so the odds do not move.
- Leave `src/game/collections.js` `SPECIAL_SETS` alone: no Throwbacks goal (decided).
- Tests:
  - Grep for any test that pins `SPECIAL_SETS_IN_PACKS` and update it.
  - Add to `src/game/freeAgents.accept.test.js`: `expect(SPECIAL_SETS_IN_PACKS).toEqual(expect.arrayContaining(['throwbacks', 'wnba-throwbacks']))` and `expect(SPECIAL_SETS.map(s => s.id)).not.toContain('throwbacks')`.

**Steps:** test, then FAIL, then implement, then PASS (`npx vitest run src/game`), then commit.

### Task 6: Build Throwbacks requests

**Files:**
- `scripts/cardgen/buildFreeAgent.mjs`: `BUILDABLE_SETS` gains `'throwbacks', 'wnba-throwbacks'`, and the Throwbacks refusal goes. `buildFreeAgent` routes `wnba-*` to `wnbaCard`, and `wnba-throwbacks` already matches. Update the file header.
- `scripts/cardgen/buildFreeAgent.mjs` `freeAgentCardId`: **a Throwbacks id always carries the season**, `${playerId}_${season}`. One player can have many Throwbacks seasons, and the user's art is already named that way (`card-art/sets/throwbacks/photos/Jawad_Williams_2011.jpg`, `card-art/sets/wnba-throwbacks/photos/Marissa_Coleman_2010.jpg`). Other sets keep the season-only-on-collision rule.
- `scripts/cardgen/buildFreeAgent.test.js`:
  - expect all seven sets;
  - `freeAgentCardId('Marissa Coleman', 2010, 'wnba-throwbacks', new Set())` is `'Marissa_Coleman_2010'`;
  - `freeAgentCardId('Jawad Williams', 2011, 'throwbacks', new Set())` is `'Jawad_Williams_2011'`.
- `src/studio/RequestsPanel.jsx`: `BUILDABLE` gains both, and the Throwbacks `title` goes.

**Steps:**
1. Update the test (FAIL), implement, and run `npx vitest run scripts/cardgen/buildFreeAgent.test.js` (PASS).
2. Dry-run Marissa Coleman's request: `node scripts/cardgen/buildFreeAgent.mjs '{"bbrefId":"colemma01w","season":2010,"playoffs":false,"set":"wnba-throwbacks","requestId":"dry","write":false}'`. It should print a salary and rarity, and `team` should be an era code. Check her id against the quote index first.
3. Commit.

### Task 7: Verify, clean up, record

1. Delete `__mock__/`. The mockup photo copies were already removed by name on 2026-09-10. Those folders now hold the user's real art only, so leave them alone.
2. Run `npx vitest run` for the full suite. It is expected to be all green.
3. Run `npx vite build --outDir <scratchpad>/dist-check`. It is expected to build.
4. Render one Throwbacks card through the real export page, `studio-export.html?set=throwbacks&id=…`, once a Throwbacks request is built. Until then, render with a card whose `set` is overridden via a throwaway page, and screenshot it for the record.
5. Memory: update `card_request_generator_idea.md` (Throwbacks look shipped; one 90s look) and add a line to `card_design_steers` if useful.
6. Commit. Give the user the deploy steps: functions (the pack list is shared), then Pages.
