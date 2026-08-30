// A treatment is allowed to change how a card LOOKS. It is not allowed to
// change whether the card can be read.
//
// So this file is deliberately the fieldTheme sweep again, run through every
// treatment. The same assertions, the same thirty teams, plus the seven defunct
// franchises the historical sets put on cards — because the whole point of the
// treatment layer is that it composes with the derived palette rather than
// replacing it, and the way to hold that claim to account is to demand the same
// guarantees of the result.
//
// The teams are NOT exempted one by one. If a treatment cannot fit on a field,
// fitAmplitude turns it down until it does, and on a field with nothing to
// spare it turns it off entirely — which is why this can be a sweep with no
// special cases in it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  INK_LIGHT,
  MIN_ACCENT_CONTRAST,
  contrastRatio,
  deriveFieldTheme,
  parseHex,
  pickInkFor,
  relativeLuminance,
} from './fieldTheme.js';
import {
  AA_BODY,
  GOLD,
  GREEN,
  TREATMENT_IDS,
  applyTreatment,
  fitAmplitude,
  treatmentTarget,
  treatmentVars,
} from './treatments.js';
import { TEAMS, HISTORICAL_TEAMS, resolveAccent } from './teams.js';
import { SETS, setTreatment } from './sets.js';

const CARD_CSS = readFileSync(new URL('./CardTemplate.module.css', import.meta.url), 'utf8');

/** The thirty live franchises, as the card renders them. */
const STOCK = Object.entries(TEAMS).map(([abbr, team]) => [
  abbr,
  team.primary,
  team.secondary,
  resolveAccent(team),
]);

/**
 * The defunct franchises too — Seattle, New Jersey, the Bobcats and the rest.
 *
 * They belong in this sweep and not merely in fieldTheme's because they are
 * ONLY ever reached through a treated set: nothing in the base sets can produce
 * a SEA card. The Bobcats' orange is the one genuinely light field in the whole
 * table, so it is also the only row here that exercises the dark-ink branch.
 */
const HISTORIC = Object.entries(HISTORICAL_TEAMS).map(([abbr, team]) => [
  abbr,
  team.primary,
  team.secondary,
  resolveAccent(team),
]);

const ALL_TEAMS = [...STOCK, ...HISTORIC];

const themeFor = ([, primary, secondary, accent], treatment) =>
  applyTreatment(deriveFieldTheme(primary, secondary, accent), treatment);

describe('the treatment layer composes rather than replaces', () => {
  it('returns the theme UNTOUCHED when the set declares no treatment', () => {
    // Identity, not an equal copy. This is what freezes the two season sets:
    // if the object coming out is the object going in, nothing about how they
    // render can have changed.
    for (const [, primary, secondary, accent] of ALL_TEAMS) {
      const base = deriveFieldTheme(primary, secondary, accent);
      expect(applyTreatment(base, null)).toBe(base);
      expect(applyTreatment(base, undefined)).toBe(base);
      expect(applyTreatment(base, 'no-such-treatment')).toBe(base);
    }
  });

  it('emits no CSS custom properties for an untreated theme', () => {
    const base = deriveFieldTheme('#0C2340', '#B9975B', '#B9975B');
    expect(treatmentVars(base)).toEqual({});
  });

  it('emits an inert value for every property a treatment does not use', () => {
    // The stylesheet LAYERS these over the untreated values, so an inert value
    // subtracts nothing — but a MISSING one would let a treated card inherit
    // whatever the last card set. Rookie declares no sheen and no foil band,
    // and both still have to be present and inert.
    const rookie = themeFor(STOCK[0], 'green-accent');
    const vars = treatmentVars(rookie);
    expect(vars['--treatment-sheen']).toBe('none');
    expect(vars['--treatment-band']).toBe('none');
    expect(vars['--treatment-frame']).toBe('none');
    expect(vars['--treatment-band-edge']).toBeTruthy();
  });

  it('keeps every key the field theme produced', () => {
    const base = deriveFieldTheme('#BA0C2F', '#010101', '#E6ECF8');
    for (const id of TREATMENT_IDS) {
      const treated = applyTreatment(base, id);
      for (const key of Object.keys(base)) {
        expect(treated[key], `${id} lost ${key}`).toBeDefined();
      }
    }
  });
});

describe.each(TREATMENT_IDS)('the %s treatment', treatment => {
  it('keeps every stock team legible — the fieldTheme sweep, treated', () => {
    for (const team of STOCK) {
      const [abbr] = team;
      const t = themeFor(team, treatment);
      expect(contrastRatio(t.ink, t.field), `${abbr} name/sidebar ink`)
        .toBeGreaterThanOrEqual(AA_BODY);
      expect(contrastRatio(t.panelInk, t.panel), `${abbr} chart cells`)
        .toBeGreaterThanOrEqual(AA_BODY);
      expect(contrastRatio(t.panelInk, t.panelAlt), `${abbr} chart header`)
        .toBeGreaterThanOrEqual(AA_BODY);
      expect(contrastRatio(t.bandInk, t.bandTop), `${abbr} SPEED/POWER, band top`)
        .toBeGreaterThanOrEqual(AA_BODY);
      expect(contrastRatio(t.bandInk, t.bandBottom), `${abbr} SPEED/POWER, band bottom`)
        .toBeGreaterThanOrEqual(AA_BODY);
      expect(contrastRatio(t.accentOnField, t.field), `${abbr} player name`)
        .toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    }
  });

  it('keeps the card layered — panels, keyline, band and hairlines', () => {
    for (const team of ALL_TEAMS) {
      const [abbr] = team;
      const t = themeFor(team, treatment);
      expect(contrastRatio(t.panel, t.field), `${abbr} panel`).toBeGreaterThan(1.15);
      expect(contrastRatio(t.frame, t.field), `${abbr} keyline`).toBeGreaterThan(1.15);
      expect(contrastRatio(t.bandTop, t.field), `${abbr} band`).toBeGreaterThan(1.3);
      expect(contrastRatio(t.rule, t.panel), `${abbr} chart hairline`).toBeGreaterThan(1.3);
    }
  });

  it('never reads worse than the untreated card, on any field', () => {
    // THE CONTRACT, stated exactly. A treatment may not be held to a flat 4.5:1
    // — OKC's #0072CE only reaches 4.88 with nothing done to it, and the
    // Bobcats' orange is a light field where the ink flips — so what it is held
    // to is: no surface it introduces reads worse than the surface it replaced,
    // up to the WCAG body floor. Below that floor it must simply not make
    // things worse.
    for (const team of ALL_TEAMS) {
      const [abbr, primary, secondary, accent] = team;
      const base = deriveFieldTheme(primary, secondary, accent);
      const t = applyTreatment(base, treatment);

      const baseField = contrastRatio(base.ink, base.field);
      const treatedField = Math.min(
        ...(t.treatment.fieldStops ?? [t.field]).map(s => contrastRatio(t.ink, s))
      );
      expect(treatedField, `${abbr} field ink`)
        .toBeGreaterThanOrEqual(Math.min(AA_BODY, baseField) - 1e-9);

      const baseBand = Math.min(
        contrastRatio(base.bandInk, base.bandTop),
        contrastRatio(base.bandInk, base.bandBottom)
      );
      const treatedBand = Math.min(
        ...(t.treatment.bandStops ?? [t.bandTop, t.bandBottom]).map(s =>
          contrastRatio(t.bandInk, s)
        )
      );
      expect(treatedBand, `${abbr} band ink`)
        .toBeGreaterThanOrEqual(Math.min(AA_BODY, baseBand) - 1e-9);
    }
  });

  it('reads on every stop of the gradients it paints, not just the ends', () => {
    // A gradient is a continuum of backgrounds under one text colour. Scoring
    // it on its endpoints is how you get SPEED/POWER that reads at the top of a
    // sweep and disappears in the middle of it, so every stop the treatment
    // declares is checked against the ink that will actually be printed on it.
    for (const team of ALL_TEAMS) {
      const [abbr] = team;
      const t = themeFor(team, treatment);
      for (const stop of t.treatment.bandStops) {
        expect(contrastRatio(t.bandInk, stop), `${abbr} band stop ${stop}`)
          .toBeGreaterThan(3.0);
      }
      for (const stop of t.treatment.fieldStops) {
        expect(contrastRatio(t.ink, stop), `${abbr} field stop ${stop}`)
          .toBeGreaterThan(3.0);
      }
    }
  });

  it('is a static gradient — nothing that needs a second frame', () => {
    // The batch export screenshots the card. Anything animated would come out
    // as one arbitrary moment of itself.
    for (const team of ALL_TEAMS) {
      const t = themeFor(team, treatment);
      const css = Object.values(treatmentVars(t)).join(' ');
      expect(css).not.toMatch(/animation|@keyframes|transition|var\(--time|calc\(.*s\)/i);
      expect(css).not.toMatch(/url\(/i); // no external asset to fail to load
    }
  });
});

describe('gold foil', () => {
  const themes = ALL_TEAMS.map(team => [team[0], themeFor(team, 'gold-foil')]);

  it('puts real gold on the band of every LIVE team', () => {
    // The set's signature. "Bold" is not testable, but "the band moved most of
    // the way toward gold, and did it on all thirty fields the set actually
    // uses" is.
    for (const [abbr, t] of themes.filter(([abbr]) => abbr in TEAMS)) {
      expect(t.treatment.bandAmount, `${abbr} band foil amount`).toBeGreaterThan(0.3);
      const [r, , b] = parseHex(t.bandTop);
      expect(r, `${abbr} band is warm`).toBeGreaterThan(b);
    }
  });

  it('falls back to the team\'s own band rather than a bad one', () => {
    // Vancouver's turquoise is the case: bright enough that no gold band both
    // reads and stays 1.3:1 clear of the field. The fit returns 0 and the band
    // stays exactly what deriveFieldTheme made it — not a compromise gold, and
    // not a band that has vanished into the field.
    for (const team of ALL_TEAMS) {
      const [abbr, primary, secondary, accent] = team;
      const base = deriveFieldTheme(primary, secondary, accent);
      const t = applyTreatment(base, 'gold-foil');
      if (t.treatment.bandAmount > 0) continue;
      expect(t.bandTop, `${abbr}`).toBe(base.bandTop);
      expect(t.bandBottom, `${abbr}`).toBe(base.bandBottom);
      expect(t.treatment.band, `${abbr}`).toBeNull();
    }
  });

  it('flips the band ink to dark where the band went bright, and only there', () => {
    for (const [abbr, t] of themes) {
      const bright = relativeLuminance(t.bandTop) > 0.3;
      if (bright) expect(t.bandInk, `${abbr}`).not.toBe(INK_LIGHT);
    }
  });

  it('gives the player name a gold accent, not the team\'s own', () => {
    // Two claims, and the second is the one that matters. readableOn only lifts
    // a colour as far as it must to clear the field, so on the dark fields the
    // accent stays the gold EXACTLY; on the brighter ones (Atlanta's red, the
    // Bobcats' orange, Vancouver's turquoise) it is lifted toward the ink — and
    // it has to stay recognisably gold through that, which is the whole reason
    // readableOn nudges rather than swapping to a neutral.
    const unchanged = themes.filter(([, t]) => t.accentOnField === GOLD);
    expect(unchanged.length).toBeGreaterThanOrEqual(20);
    for (const [abbr, t] of themes) {
      const [r, g, b] = parseHex(t.accentOnField);
      expect(r, `${abbr} accent is warm`).toBeGreaterThan(b);
      expect(g, `${abbr} accent is gold, not red`).toBeGreaterThan(b);
    }
  });

  it('carries a frame gradient and a band sweep, both multi-stop', () => {
    for (const [abbr, t] of themes) {
      // The frame is ALWAYS the metal — it carries no text, so nothing can
      // make it unaffordable.
      expect(t.treatment.frameImage, abbr).toMatch(/^linear-gradient\(/);
      if (t.treatment.bandAmount === 0) continue;
      expect(t.treatment.band, abbr).toMatch(/^linear-gradient\(/);
      // Five or more stops: two would be a wash, not a metal.
      expect(t.treatment.band.split(',').length, `${abbr} band stops`).toBeGreaterThan(4);
    }
  });

  it('turns the field sheen down rather than off on the fields that can afford it', () => {
    // The five near-black primaries have twenty contrast points to spend and
    // should get the full amplitude; OKC's blue has almost none and should get
    // very little. Both are the same rule.
    const spurs = themes.find(([abbr]) => abbr === 'SAS')[1];
    const okc = themes.find(([abbr]) => abbr === 'OKC')[1];
    expect(spurs.treatment.fieldAmount).toBeGreaterThan(okc.treatment.fieldAmount);
    expect(spurs.treatment.sheen).toMatch(/repeating-linear-gradient/);
  });
});

describe('green accent', () => {
  const themes = ALL_TEAMS.map(team => [team[0], themeFor(team, 'green-accent')]);

  it('leaves every surface exactly as the field theme derived it', () => {
    // "Plain and simple": this treatment re-colours lines, it does not repaint
    // anything. So it cannot move contrast at all, and that is asserted rather
    // than described.
    for (const team of ALL_TEAMS) {
      const [abbr, primary, secondary, accent] = team;
      const base = deriveFieldTheme(primary, secondary, accent);
      const t = applyTreatment(base, 'green-accent');
      for (const key of ['field', 'ink', 'panel', 'panelAlt', 'panelInk', 'bandTop', 'bandBottom', 'bandInk', 'rule', 'well', 'scrim']) {
        expect(t[key], `${abbr} ${key}`).toBe(base[key]);
      }
    }
  });

  it('turns the name and the keyline green', () => {
    for (const [abbr, t] of themes) {
      const [r, g, b] = parseHex(t.accentOnField);
      expect(g, `${abbr} accent is green-dominant`).toBeGreaterThan(r);
      expect(g, `${abbr} accent is green-dominant`).toBeGreaterThan(b);
      expect(contrastRatio(t.frame, t.field), `${abbr} keyline reads`).toBeGreaterThan(1.15);
    }
  });

  it('keeps the green itself on the fields dark enough to carry it', () => {
    // GREEN is a mid-tone, so it only clears 3.5:1 unaided on a genuinely dark
    // field — which is most of the league, since 23 of the 30 primaries sit
    // below L 0.09. The rest are lifted, and the assertion above is what holds
    // them to still being green.
    const unchanged = themes.filter(([, t]) => t.accentOnField === GREEN);
    expect(unchanged.length).toBeGreaterThanOrEqual(12);
  });
});

describe('fitAmplitude', () => {
  it('returns 0 when nothing fits, rather than the smallest bad answer', () => {
    // A card with no sheen is correct. A card with an unreadable one is not.
    // White AND black in one gradient is the case no single ink can cover:
    // white text vanishes on the white stop, near-black on the black one.
    expect(fitAmplitude(() => ['#FFFFFF', '#000000'], 4.5, 0.2)).toBe(0);
  });

  it('returns 0 when the accept predicate refuses everything', () => {
    expect(fitAmplitude(() => ['#000000'], 4.5, 0.2, () => false)).toBe(0);
  });

  it('returns the maximum when the whole range fits', () => {
    expect(fitAmplitude(() => ['#000000'], 4.5, 0.2)).toBeCloseTo(0.2, 6);
  });

  it('is monotonic in the target it is asked for', () => {
    const stops = t => ['#0C2340', `#${Math.round(0x22 + t * 200).toString(16).padStart(2, '0')}5566`];
    const loose = fitAmplitude(stops, 3, 0.9);
    const strict = fitAmplitude(stops, 7, 0.9);
    expect(loose).toBeGreaterThanOrEqual(strict);
  });
});

describe('treatmentTarget', () => {
  it('never asks for more than WCAG body contrast', () => {
    expect(treatmentTarget('#010101')).toBe(AA_BODY);
  });

  it('asks only for what the untreated surfaces already managed', () => {
    // A surface set no ink can cover well must not make the treatment
    // impossible — it must make the treatment SMALL. So the target drops to
    // whatever the untreated pairing really achieved.
    const target = treatmentTarget('#FFFFFF', '#000000');
    expect(target).toBeLessThan(AA_BODY);
    expect(target).toBeCloseTo(
      Math.min(
        contrastRatio(pickInkFor('#FFFFFF', '#000000'), '#FFFFFF'),
        contrastRatio(pickInkFor('#FFFFFF', '#000000'), '#000000')
      ),
      10
    );
  });
});

describe('the sets and their treatments agree', () => {
  it('declares only treatments that exist', () => {
    for (const set of SETS) {
      if (set.treatment === null) continue;
      expect(TREATMENT_IDS, `${set.id}`).toContain(set.treatment);
    }
  });

  it('leaves both season sets untreated', () => {
    expect(setTreatment('2026-27')).toBeNull();
    expect(setTreatment('2025-26')).toBeNull();
  });

  it('treats both special sets', () => {
    expect(setTreatment('super-season')).toBe('gold-foil');
    expect(setTreatment('rookie')).toBe('green-accent');
  });
});

describe('the stylesheet the treatments paint through', () => {
  it('layers the foil band OVER the team gradient rather than instead of it', () => {
    // `background-image: var(--treatment-band, none), <the team gradient>`. An
    // untreated card resolves the first layer to `none`, paints nothing, and
    // renders exactly as it did before treatments existed.
    expect(CARD_CSS).toMatch(/background-image:\s*\n?\s*var\(--treatment-band, none\),/);
  });

  it('defaults every treatment property to something inert', () => {
    for (const prop of ['--treatment-sheen', '--treatment-frame']) {
      expect(CARD_CSS, prop).toContain(`var(${prop}, none)`);
    }
    expect(CARD_CSS).toContain('var(--treatment-band-edge, transparent)');
  });

  it('animates nothing', () => {
    // The export is a screenshot. Checked over the whole stylesheet, not just
    // the treatment rules, because a transition added anywhere on the card
    // would be captured mid-flight.
    expect(CARD_CSS).not.toMatch(/@keyframes|animation:|transition:/);
  });

  it('gives the treatment boxes no z-index, so tree order keeps deciding', () => {
    // The sheen is the first child and the frame is the last, and that IS their
    // ordering. A stacking context on either would reorder the shot-line arrow
    // and the chevrons against .card::after — the exact bug the z-index
    // comments in CardTemplate.test.js exist about.
    for (const selector of ['.treatmentSheen', '.treatmentFrame']) {
      const block = CARD_CSS.slice(CARD_CSS.indexOf(selector));
      expect(block.slice(0, block.indexOf('}')), selector).not.toMatch(/z-index/);
    }
  });
});
