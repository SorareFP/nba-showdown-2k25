// The card's field is the team's primary color, which means legibility is no
// longer something the stylesheet can assume — it is computed, and this is
// where that computation is held to account.
//
// The load-bearing tests here are the two SWEEPS. Spot-checking a few teams
// would pass happily while some thirty-first color combination renders a card
// nobody can read; instead every stock team is checked, and then the whole
// color cube on a 15-step lattice, because the team editor lets the user type
// any hex at all into the primary box.
import { describe, it, expect } from 'vitest';
import {
  FIELD_FALLBACK,
  INK_LIGHT,
  MIN_ACCENT_CONTRAST,
  SCRIM_ALPHA,
  parseHex,
  toHex,
  mix,
  shade,
  rgba,
  compositeOver,
  relativeLuminance,
  contrastRatio,
  pickInk,
  pickInkFor,
  inkIsLight,
  readableOn,
  deriveFieldTheme,
  fieldThemeVars,
} from './fieldTheme.js';
import { TEAMS, resolveAccent } from './teams.js';

/** WCAG's floor for normal-size text. Everything the card body prints. */
const AA_BODY = 4.5;

/** Every stock team, as [abbr, field, accent] — what the card actually renders. */
const STOCK = Object.entries(TEAMS).map(([abbr, team]) => [
  abbr,
  team.primary,
  team.secondary,
  resolveAccent(team),
]);

/**
 * The color cube on a 15-step lattice: 1,224 fields, including the saturated
 * corners and the mid-tones where no palette can do especially well.
 */
const CUBE = [];
for (let r = 0; r < 256; r += 15) {
  for (let g = 0; g < 256; g += 15) {
    for (let b = 0; b < 256; b += 15) CUBE.push(toHex([r, g, b]));
  }
}

describe('parseHex / toHex', () => {
  it('round-trips a color', () => {
    expect(parseHex('#BA0C2F')).toEqual([186, 12, 47]);
    expect(toHex([186, 12, 47])).toBe('#BA0C2F');
  });

  it('accepts lowercase and surrounding whitespace', () => {
    expect(parseHex('  #ba0c2f ')).toEqual([186, 12, 47]);
  });

  it('rejects anything that is not a full six-digit hex', () => {
    // Shorthand is normalized upstream by teamTheme.normalizeHex — by the time
    // a color reaches this module it is either #RRGGBB or it is not a color.
    for (const bad of ['#FFF', 'red', '', '#GGGGGG', null, undefined, 0xba0c2f, {}]) {
      expect(parseHex(bad), String(bad)).toBeNull();
    }
  });

  it('clamps and pads on the way out', () => {
    expect(toHex([-20, 3, 300])).toBe('#0003FF');
  });
});

describe('mix / shade', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(mix('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mix('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });

  it('clamps t rather than extrapolating past either end', () => {
    expect(mix('#000000', '#FFFFFF', -3)).toBe('#000000');
    expect(mix('#000000', '#FFFFFF', 9)).toBe('#FFFFFF');
  });

  it('passes the first color through when either side is not a color', () => {
    expect(mix('#BA0C2F', 'nope', 0.5)).toBe('#BA0C2F');
    expect(mix(null, '#FFFFFF', 0.5)).toBeNull();
  });

  it('lightens on a positive amount and darkens on a negative one', () => {
    expect(relativeLuminance(shade('#BA0C2F', 0.3))).toBeGreaterThan(
      relativeLuminance('#BA0C2F')
    );
    expect(relativeLuminance(shade('#BA0C2F', -0.3))).toBeLessThan(
      relativeLuminance('#BA0C2F')
    );
  });
});

describe('rgba / compositeOver', () => {
  it('formats a hex as an rgba string', () => {
    expect(rgba('#BA0C2F', 0.5)).toBe('rgba(186, 12, 47, 0.5)');
  });

  it('reads a non-color as black rather than emitting rgba(NaN)', () => {
    expect(rgba('nonsense', 0.5)).toBe('rgba(0, 0, 0, 0.5)');
  });

  it('composites a translucent fill onto a background', () => {
    expect(compositeOver('rgba(255, 255, 255, 0.5)', '#000000')).toBe('#808080');
    expect(compositeOver('rgba(255, 255, 255, 0)', '#BA0C2F')).toBe('#BA0C2F');
    expect(compositeOver('rgba(255, 255, 255, 1)', '#BA0C2F')).toBe('#FFFFFF');
  });

  it('passes an opaque hex straight through', () => {
    expect(compositeOver('#BA0C2F', '#000000')).toBe('#BA0C2F');
  });

  it('falls back to the background rather than throwing on junk', () => {
    for (const bad of ['rgba(1,2)', 'chartreuse', '', null, undefined, 42]) {
      expect(compositeOver(bad, '#BA0C2F'), String(bad)).toBe('#BA0C2F');
    }
    expect(compositeOver('rgba(0, 0, 0, 0.5)', 'not-a-color')).toBe('not-a-color');
  });
});

describe('relativeLuminance', () => {
  it('pins the ends of the scale', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
  });

  it('is gamma-expanded, not a raw channel average', () => {
    // Mid-grey sits near 0.216, not 0.5 — the whole reason this is a separate
    // measure from teams.js's simpler weighted-sRGB luminance.
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2158, 3);
  });

  it('reports the value the module header cites for the lightest primary', () => {
    expect(relativeLuminance('#0072CE')).toBeCloseTo(0.165, 2); // Thunder Blue
  });

  it('reads a non-color as black rather than throwing', () => {
    expect(relativeLuminance('not-a-color')).toBe(0);
  });
});

describe('contrastRatio', () => {
  it('pins the extremes', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 10);
    expect(contrastRatio('#BA0C2F', '#BA0C2F')).toBeCloseTo(1, 10);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#0C2340', '#FFC72C')).toBeCloseTo(
      contrastRatio('#FFC72C', '#0C2340'),
      10
    );
  });
});

describe('pickInk', () => {
  it('chooses white on every stock primary', () => {
    // All 30 TruColor primaries are dark — the lightest is Thunder Blue at
    // 4.9:1 against white. Pinned so a future color correction that pushes a
    // team light shows up here rather than on the card.
    for (const [abbr, field] of STOCK) {
      expect(pickInk(field), abbr).toBe(INK_LIGHT);
    }
  });

  it('flips to dark ink on a light field', () => {
    // The branch that exists entirely for the team editor: nothing stops the
    // user typing gold into the primary box.
    const ink = pickInk('#FFC72C');
    expect(ink).not.toBe(INK_LIGHT);
    expect(contrastRatio(ink, '#FFC72C')).toBeGreaterThan(AA_BODY);
  });

  it('tints the dark ink from the field instead of using flat black', () => {
    expect(pickInk('#FFC72C')).not.toBe('#000000');
    const [r, , b] = parseHex(pickInk('#FFC72C'));
    expect(r).toBeGreaterThan(b); // still warm, like the field it came from
  });

  it('never picks the worse of its two candidates', () => {
    for (const field of CUBE) {
      const chosen = pickInk(field);
      const other = chosen === INK_LIGHT ? mix(field, '#000000', 0.86) : INK_LIGHT;
      expect(
        contrastRatio(chosen, field) >= contrastRatio(other, field),
        field
      ).toBe(true);
    }
  });

  it('agrees with inkIsLight', () => {
    for (const field of CUBE) {
      expect(inkIsLight(field), field).toBe(pickInk(field) === INK_LIGHT);
    }
  });
});

describe('pickInkFor', () => {
  it('scores an ink on its WORST surface, not its first', () => {
    // A band that runs from near-white to mid-tone: white ink reads on the
    // second surface and disappears on the first, so the dark ink has to win
    // even though it is not the better answer for either one alone.
    const ink = pickInkFor('#F5F5F5', '#9A9A9A');
    expect(Math.min(contrastRatio(ink, '#F5F5F5'), contrastRatio(ink, '#9A9A9A')))
      .toBeGreaterThan(Math.min(
        contrastRatio(INK_LIGHT, '#F5F5F5'),
        contrastRatio(INK_LIGHT, '#9A9A9A')
      ));
  });

  it('matches pickInk when there is only one surface', () => {
    for (const field of CUBE) expect(pickInkFor(field), field).toBe(pickInk(field));
  });
});

describe('readableOn', () => {
  it('leaves a color that already clears the bar completely alone', () => {
    // Cleveland's gold on their wine reads 3.78:1 — the pairing the team
    // actually wears, and it must survive untouched.
    expect(readableOn('#B9975B', '#6F263D')).toBe('#B9975B');
    expect(readableOn('#FFC72C', '#330072')).toBe('#FFC72C'); // Lakers
  });

  it('nudges a color that does not, and keeps its hue', () => {
    // Minnesota: #009A44 on #1D4289 is 2.6:1. It comes back lighter but still
    // unmistakably green — a swap to white would have thrown the color away.
    const lifted = readableOn('#009A44', '#1D4289');
    expect(lifted).not.toBe('#009A44');
    expect(contrastRatio(lifted, '#1D4289')).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    const [r, g, b] = parseHex(lifted);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('falls back to the ink for something that is not a color', () => {
    expect(readableOn(undefined, '#0C2340')).toBe(INK_LIGHT);
    expect(readableOn('teal', '#0C2340')).toBe(INK_LIGHT);
  });

  it('always reaches the threshold, whatever it is handed', () => {
    for (const field of CUBE) {
      for (const color of ['#010101', '#FFFFFF', '#009A44', '#B9975B', field]) {
        expect(
          contrastRatio(readableOn(color, field), field),
          `${color} on ${field}`
        ).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST - 1e-9);
      }
    }
  });
});

describe('deriveFieldTheme', () => {
  it('makes the field the primary color', () => {
    expect(deriveFieldTheme('#BA0C2F', '#010101', '#E6ECF8').field).toBe('#BA0C2F');
  });

  it('falls back to the old navy when the primary is not a color', () => {
    // A card must still render while the hex box holds a half-typed value.
    for (const bad of [undefined, null, '', '#BA0', 'red']) {
      expect(deriveFieldTheme(bad, '#010101', '#E6ECF8').field).toBe(FIELD_FALLBACK);
    }
  });

  it('keeps every stock team legible', () => {
    for (const [abbr, primary, secondary, accent] of STOCK) {
      const t = deriveFieldTheme(primary, secondary, accent);
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

  it('gives every stock team panels that read as layers', () => {
    // The printed reference art separates its chart cells from its field by
    // 1.18:1; below about 1.15 the table stops looking like a panel at all.
    for (const [abbr, primary, secondary, accent] of STOCK) {
      const t = deriveFieldTheme(primary, secondary, accent);
      expect(contrastRatio(t.panel, t.field), `${abbr} panel`).toBeGreaterThan(1.15);
      expect(contrastRatio(t.frame, t.field), `${abbr} keyline`).toBeGreaterThan(1.15);
      expect(contrastRatio(t.bandTop, t.field), `${abbr} band`).toBeGreaterThan(1.3);
      expect(contrastRatio(t.rule, t.panel), `${abbr} chart hairline`).toBeGreaterThan(1.3);
    }
  });

  it('stays legible across the whole color cube', () => {
    // 4.0, not 4.5: a mid-tone background has a hard ceiling — the best any
    // foreground can do against L≈0.179 is about 4.58:1, and a field-tinted
    // dark ink gives up a little of that. Every real team clears 4.5 (above);
    // this is the floor for a color the user invents.
    const CUBE_FLOOR = 4.0;
    for (const field of CUBE) {
      const t = deriveFieldTheme(field, '#FFC72C', '#B9975B');
      expect(contrastRatio(t.ink, t.field), field).toBeGreaterThan(CUBE_FLOOR);
      expect(
        Math.min(contrastRatio(t.panelInk, t.panel), contrastRatio(t.panelInk, t.panelAlt)),
        field
      ).toBeGreaterThan(3.4);
      expect(
        Math.min(contrastRatio(t.bandInk, t.bandTop), contrastRatio(t.bandInk, t.bandBottom)),
        field
      ).toBeGreaterThan(3.4);
      expect(contrastRatio(t.accentOnField, t.field), field)
        .toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST - 1e-9);
    }
  });

  it('never leaves a panel flat on its field, anywhere in the cube', () => {
    // The case luminance alone gets wrong: #00FFFF is light enough to want
    // lightening panels, but green and blue are already at 255 so lightening
    // moves it almost not at all. panelDirection measures the step instead.
    for (const field of CUBE) {
      const t = deriveFieldTheme(field, '#FFC72C', '#B9975B');
      expect(contrastRatio(t.panel, t.field), field).toBeGreaterThan(1.1);
    }
    const cyan = deriveFieldTheme('#00FFFF', '#FFC72C', '#B9975B');
    expect(relativeLuminance(cyan.panel)).toBeLessThan(relativeLuminance(cyan.field));
  });

  it('steps panels LIGHTER on a field with no room to darken', () => {
    // Five teams are #010101. The reference art does the same thing with its
    // navy: chart cells and band are both lighter than the field.
    const t = deriveFieldTheme('#010101', '#FFFFFF', '#E6ECF8');
    expect(relativeLuminance(t.panel)).toBeGreaterThan(relativeLuminance(t.field));
    expect(relativeLuminance(t.bandTop)).toBeGreaterThan(relativeLuminance(t.field));
  });

  it('steps panels DARKER on a field that has room, which buys ink contrast', () => {
    const t = deriveFieldTheme('#BA0C2F', '#010101', '#E6ECF8'); // Bulls
    expect(relativeLuminance(t.panel)).toBeLessThan(relativeLuminance(t.field));
    expect(contrastRatio(t.panelInk, t.panel)).toBeGreaterThan(
      contrastRatio(t.ink, t.field)
    );
  });

  it('recesses the well behind the photo, opposite the panels', () => {
    for (const field of ['#010101', '#BA0C2F', '#0C2340', '#FFC72C']) {
      const t = deriveFieldTheme(field, '#FFC72C', '#B9975B');
      const panelUp = relativeLuminance(t.panel) > relativeLuminance(t.field);
      const wellUp = relativeLuminance(t.well) > relativeLuminance(t.field);
      expect(wellUp, field).toBe(!panelUp);
    }
  });

  it('uses a shadow that suits its ink', () => {
    expect(deriveFieldTheme('#0C2340', '#FFF', '#FFC72C').inkShadow).toContain('0, 0, 0');
    expect(deriveFieldTheme('#FFC72C', '#000000', '#0C2340').inkShadow)
      .toContain('255, 255, 255');
  });

  it('takes the band stripe from the field, not the accent', () => {
    // Cream at 0.62 opacity across a red band turns a Bulls header pink, and
    // half the league's accents are cream. The stripe is tonal instead.
    const t = deriveFieldTheme('#BA0C2F', '#010101', '#E6ECF8');
    expect(t.stripeTonal).not.toBe('#E6ECF8');
    expect(contrastRatio(t.stripeTonal, t.bandTop)).toBeGreaterThan(1.2);
  });

  it('keeps a secondary that is already tellable from the band', () => {
    // Chicago's black stripe reads 1.64:1 on their band and stays black.
    expect(deriveFieldTheme('#BA0C2F', '#010101', '#E6ECF8').stripeSecondary)
      .toBe('#010101');
  });
});

describe('the sidebar scrim', () => {
  // The bar down the right of the card. It is the ONE thing the card paints at
  // less than full opacity, so everything below composites it first: `scrim`
  // is not what the card shows, `compositeOver(scrim, …)` is.

  it('holds the alpha measured off the reference art', () => {
    // Recovered by regressing the pixels inside the bar's left edge against the
    // pixels outside it: median 0.575 on LeBron, 0.562 on Edwards, and 0.564 /
    // 0.563 / 0.574 per channel from the flat patch of top band the bar crosses.
    // A bound rather than an equality — the art is three measurements that
    // disagree in the third decimal, not a constant someone wrote down.
    expect(SCRIM_ALPHA).toBeGreaterThanOrEqual(0.53);
    expect(SCRIM_ALPHA).toBeLessThanOrEqual(0.61);
  });

  it('lands on panelAlt once the browser has composited it, on every stock team', () => {
    // This IS the derivation: the scrim is defined by where it ends up over the
    // field, not by the fill it starts as. Off by at most one count per channel
    // because the fill is rounded to a hex before it is composited and rounded
    // again after — two trips through toHex where panelAlt takes one.
    for (const [abbr, primary, secondary, accent] of STOCK) {
      const t = deriveFieldTheme(primary, secondary, accent);
      const painted = parseHex(compositeOver(t.scrim, t.field));
      const target = parseHex(t.panelAlt);
      for (let i = 0; i < 3; i += 1) {
        expect(Math.abs(painted[i] - target[i]), `${abbr} ${t.field} channel ${i}`)
          .toBeLessThanOrEqual(1);
      }
    }
  });

  it('lands on panelAlt across the whole colour cube too', () => {
    for (const field of CUBE) {
      const t = deriveFieldTheme(field, '#FFC72C', '#B9975B');
      const painted = parseHex(compositeOver(t.scrim, t.field));
      const target = parseHex(t.panelAlt);
      for (let i = 0; i < 3; i += 1) {
        expect(Math.abs(painted[i] - target[i]), `${field} channel ${i}`)
          .toBeLessThanOrEqual(1);
      }
    }
  });

  it('takes its direction from panelDirection, not from a fixed white wash', () => {
    // The whole point of deriving it. A hardcoded rgba(255,255,255,…) reads on
    // a dark card and washes out a light one; this steps the same way the rest
    // of the card's layering does, which on OKC's #0072CE means DARKER and on
    // San Antonio's #010101 — where there is no darker — means lighter.
    const okc = deriveFieldTheme('#0072CE', '#EF3B24', '#E6ECF8');
    expect(relativeLuminance(compositeOver(okc.scrim, okc.field)))
      .toBeLessThan(relativeLuminance(okc.field));

    const spurs = deriveFieldTheme('#010101', '#9EA2A2', '#9EA2A2');
    expect(relativeLuminance(compositeOver(spurs.scrim, spurs.field)))
      .toBeGreaterThan(relativeLuminance(spurs.field));

    // And it never steps the opposite way from the card's other layers — the
    // claim that matters, since the point of deriving it through `step` was to
    // reuse that decision rather than take one of its own. Includes the cases
    // where panelDirection's own separation fallback overrules the luminance
    // test: on #FFC72C both the panels and the scrim come out DARKER, because
    // a gold field has almost nowhere left to lighten.
    for (const field of CUBE) {
      const t = deriveFieldTheme(field, '#FFC72C', '#B9975B');
      const here = relativeLuminance(compositeOver(t.scrim, t.field));
      const there = relativeLuminance(t.panel);
      const base = relativeLuminance(t.field);
      expect(Math.sign(here - base) === Math.sign(there - base) || here === base, field)
        .toBe(true);
    }
  });

  it('is never flat on its own field, anywhere in the cube', () => {
    // 1.05 rather than the panels' 1.15: this is a veil, deliberately the
    // quietest layer on the card, and the floor is what panelAlt itself can
    // manage on the worst field in the cube (#D269B4, 1.061).
    for (const field of CUBE) {
      const t = deriveFieldTheme(field, '#FFC72C', '#B9975B');
      expect(contrastRatio(compositeOver(t.scrim, t.field), t.field), field)
        .toBeGreaterThan(1.05);
    }
  });

  it('lifts the sidebar off the photo, which is what it is for', () => {
    // The sidebar's ink is chosen against the FIELD, and the top of the sidebar
    // is printed over the photo — so the worst case is a photo pixel that is
    // exactly the ink colour: white kit under white text, 1:1, invisible. The
    // scrim cannot know the photo, but it can guarantee how far it drags any
    // pixel toward the card's own tone. Every stock team clears 2.6:1 on that
    // worst case, and the darkest fields clear 4.2:1.
    for (const [abbr, primary, secondary, accent] of STOCK) {
      const t = deriveFieldTheme(primary, secondary, accent);
      const worstPhoto = t.ink; // a photo pixel the ink would vanish into
      expect(contrastRatio(t.ink, compositeOver(t.scrim, worstPhoto)), abbr)
        .toBeGreaterThan(2.6);
    }
  });

  it('reproduces the reference art on the reference art\'s own field', () => {
    // The one place the bar crosses a flat surface in the printed cards: the
    // top band's #5B6A7D grey reads #2F425A inside it. Ours steps off the field
    // where the art's scrim was the field exactly, so it veils very slightly
    // less; 15 counts per channel bounds that difference, and the measured gap
    // is 6 / 8 / 12.
    const art = deriveFieldTheme('#031E44', '#FFFFFF', '#FFC72C');
    const painted = parseHex(compositeOver(art.scrim, '#5B6A7D'));
    const measured = parseHex('#2F425A');
    for (let i = 0; i < 3; i += 1) {
      expect(Math.abs(painted[i] - measured[i]), `channel ${i}`).toBeLessThanOrEqual(15);
    }
  });
});

describe('the accent an override chooses', () => {
  it('survives when it is legible on the field', () => {
    // The studio's accent override is the point of resolveAccent; the field
    // derivation must not quietly overrule a choice that works.
    expect(deriveFieldTheme('#0C2340', '#862633', '#FEC524').accentOnField)
      .toBe('#FEC524'); // Denver's gold
  });

  it('is lifted, not discarded, when it is not', () => {
    const lifted = deriveFieldTheme('#1D4289', '#009A44', '#009A44').accentOnField;
    expect(lifted).not.toBe('#009A44');
    expect(contrastRatio(lifted, '#1D4289')).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
  });

  it('rescues an accent that IS the primary, which would erase the name', () => {
    const t = deriveFieldTheme('#00778B', '#211747', '#00778B');
    expect(contrastRatio(t.accentOnField, t.field))
      .toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
  });
});

describe('fieldThemeVars', () => {
  it('names every value the theme carries', () => {
    const theme = deriveFieldTheme('#BA0C2F', '#010101', '#E6ECF8');
    const vars = fieldThemeVars(theme);
    expect(Object.keys(vars)).toHaveLength(Object.keys(theme).length);
    for (const [name, value] of Object.entries(vars)) {
      expect(name, name).toMatch(/^--[a-z-]+$/);
      expect(value, name).toBeTruthy();
    }
  });
});
