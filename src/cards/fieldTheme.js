// Everything the card paints once its FIELD is the team's primary color.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// The card used to be navy. One navy, hardcoded, for all thirty teams, with
// the team's colors showing up only as accents — which is backwards: the whole
// point of a Bulls card is that it is red. So the field became
// var(--team-primary), and the moment it did, every other color on the card
// stopped being safe to hardcode. White chart text is fine on navy and fine on
// Bulls red; it is not fine on a pale gold someone types into the team editor.
//
// So nothing on the field is a constant any more. Give this module the field
// color and it derives the whole palette off it — ink, panels, hairlines,
// band — by CONTRAST RATIO, not by assuming light-on-dark.
//
// ── THIS IS NOT teams.js's luminance ────────────────────────────────────────
//
// teams.js has a `luminance` of its own, and the two are deliberately
// different measures rather than a duplication to clean up:
//
//   teams.js      weighted sRGB, no gamma. Its 0.38 threshold is CALIBRATED
//                 against that curve (see MIN_ACCENT_LUMINANCE) and picks
//                 which 15 teams fall back to cream. Change the curve and you
//                 change that answer.
//   here          WCAG relative luminance — gamma-expanded — because this
//                 module answers "is this legible", and the only well-founded
//                 answer to that is a WCAG contrast ratio.
//
// ── THE STOCK RANGE ─────────────────────────────────────────────────────────
//
// Measured across all 30 TruColor primaries: every one is dark. The lightest
// is Thunder Blue #0072CE at L=0.165 (4.9:1 against white); five teams are
// #010101 at L=0.0003 (20.9:1). So white ink wins on all thirty today, and the
// dark-ink branch below exists entirely for the team editor — a user is free
// to type #FFC72C into the primary box, and the card must not become white on
// gold when they do.

/** The field a card falls back to when it is handed something that isn't a color. */
export const FIELD_FALLBACK = '#0C1B3A';

/** The light ink. Pure white — the printed set's text color. */
export const INK_LIGHT = '#FFFFFF';

/**
 * How far toward black the dark ink is mixed from the field.
 *
 * A TINT of the field rather than #000000: a Lakers-gold card wants near-black
 * text with a trace of the field in it, the same way the light ink sits on a
 * card that is already team-colored. 0.86 is deep enough that the tint never
 * costs a meaningful amount of contrast.
 */
const DARK_INK_MIX = 0.86;

/**
 * Minimum contrast the accent must reach against the field before it is used
 * for text.
 *
 * The accent's biggest job is the 96px vertical name, and WCAG's large-text
 * floor is 3:1; 3.5 keeps headroom without being so strict that it launders
 * the team's identity out of the card. Against the thirty stock accents this
 * nudges exactly one — Minnesota, whose green reads 2.6:1 on their blue.
 * Cleveland (3.78), Atlanta (3.77) and New York (3.85) all pass untouched,
 * which is the point: those are the pairings the teams actually wear.
 */
export const MIN_ACCENT_CONTRAST = 3.5;

/**
 * Decorative-only floor, for the band's secondary stripe. It is not text, and
 * it is drawn at 0.62 opacity, so it only has to be TELLABLE from the band —
 * 1.5 lets Chicago keep its actual black stripe (1.64:1 on their band) where a
 * text-grade threshold would have laundered it into grey.
 */
export const MIN_DECOR_CONTRAST = 1.5;

/**
 * Luminance bounds outside which a panel step has nowhere to go.
 *
 * Panels step AWAY from the ink, which is what buys contrast rather than
 * spending it — but on a #010101 field there is no "darker", so those flip and
 * step toward the light instead. The reference art does exactly this: its navy
 * field carries a LIGHTER chart panel and a lighter band.
 */
const PANEL_FLOOR = 0.03;
const PANEL_CEIL = 0.85;

/**
 * Darkening steps are multiplied by this; lightening steps are not.
 *
 * Not a fudge — the two directions are not symmetric in contrast terms. A
 * contrast RATIO is (L1+0.05)/(L2+0.05), and that +0.05 dominates at the dark
 * end, so mixing an already-dark field 11% toward black barely separates the
 * panel from it while mixing 11% toward white separates it plainly. Without
 * the boost, Cleveland's wine field and its chart panel measure 1.15:1 —
 * flat. With it, every team lands in the 1.26-1.54 band the lighteners
 * already occupy, so the card has the same amount of layering whichever way
 * its field happens to step.
 */
const DARKEN_BOOST = 1.8;

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** [r, g, b] 0-255 for a #rrggbb string, or null if it isn't one. */
export function parseHex(hex) {
  if (typeof hex !== 'string' || !HEX.test(hex.trim())) return null;
  const n = parseInt(hex.trim().slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** '#RRGGBB' for an [r, g, b] triple, rounded and clamped. */
export function toHex(rgb) {
  return `#${rgb
    .map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

/** `a` blended `t` of the way toward `b`, in sRGB. Invalid input returns `a`. */
export function mix(a, b, t) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const k = Math.max(0, Math.min(1, t));
  return toHex(ca.map((v, i) => v + (cb[i] - v) * k));
}

/** Positive `amount` mixes toward white, negative toward black. */
export function shade(hex, amount) {
  return amount >= 0 ? mix(hex, '#FFFFFF', amount) : mix(hex, '#000000', -amount);
}

/** WCAG relative luminance, 0 (black) to 1 (white). Non-colors read as black. */
export function relativeLuminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors: 1 (identical) to 21 (black/white). */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The legible foreground for a background: white, or a near-black tint of it.
 *
 * Whichever of the two actually measures higher against this background — the
 * one decision that makes the card work on a field the caller chose rather
 * than one this file assumed.
 */
export function pickInk(background) {
  return pickInkFor(background);
}

/**
 * The legible foreground for text that crosses SEVERAL surfaces.
 *
 * Scored on its worst surface, not its average: SPEED/POWER sit across a band
 * that is a gradient, and the chart's cells and its header row are two
 * different fills sharing one text color. Picking against just the first of
 * them is how you get text that reads on the top of a gradient and vanishes at
 * the bottom — on a #F078F0 field that mistake costs 1.6 contrast points.
 *
 * The dark candidate is tinted from the FIRST background, which is the one the
 * caller considers primary.
 */
export function pickInkFor(...backgrounds) {
  const dark = mix(backgrounds[0], '#000000', DARK_INK_MIX);
  const worst = ink => Math.min(...backgrounds.map(bg => contrastRatio(ink, bg)));
  return worst(INK_LIGHT) >= worst(dark) ? INK_LIGHT : dark;
}

/** True when `pickInk` chose the light ink for this background. */
export function inkIsLight(background) {
  return pickInk(background) === INK_LIGHT;
}

/**
 * `color`, nudged toward the ink only as far as it must go to clear `minRatio`
 * against `background`.
 *
 * The nudge preserves hue, which is the whole reason it is a nudge and not a
 * swap: Minnesota's green is still recognisably their green after it lifts
 * enough to read on their blue, where dropping to plain white would have
 * thrown the color away. A color that cannot get there at all becomes the ink.
 */
export function readableOn(color, background, minRatio = MIN_ACCENT_CONTRAST) {
  const ink = pickInk(background);
  if (!parseHex(color)) return ink;
  if (contrastRatio(color, background) >= minRatio) return color;
  for (let step = 1; step < 10; step += 1) {
    const nudged = mix(color, ink, step / 10);
    if (contrastRatio(nudged, background) >= minRatio) return nudged;
  }
  return ink;
}

/** How far a panel must sit from the field before it reads as a layer at all. */
const MIN_PANEL_SEPARATION = 1.15;

/** One panel step in `dir`, at the amount the chart's cells use. */
function panelProbe(field, dir) {
  return shade(field, dir * 0.11 * (dir < 0 ? DARKEN_BOOST : 1));
}

/**
 * The direction panels step in: away from the ink where there is room, toward
 * it where there is not. +1 lightens, -1 darkens.
 *
 * The luminance test settles it for every real field. The separation test
 * behind it is for the corners of the color cube, where luminance alone lies:
 * #00FFFF is dark-ink territory so panels want to lighten, but green and blue
 * are already at 255, so lightening moves the color almost not at all and the
 * chart comes out flat on the field. Measuring the step it would actually take
 * catches that, where reasoning about luminance does not.
 */
function panelDirection(field) {
  const luminance = relativeLuminance(field);
  const dir = inkIsLight(field)
    ? (luminance < PANEL_FLOOR ? 1 : -1)
    : (luminance > PANEL_CEIL ? -1 : 1);
  const here = contrastRatio(panelProbe(field, dir), field);
  if (here >= MIN_PANEL_SEPARATION) return dir;
  return contrastRatio(panelProbe(field, -dir), field) > here ? -dir : dir;
}

/**
 * The card's whole derived palette, from the team's three colors.
 *
 * Every value the stylesheet used to hardcode comes out of here. Returned as
 * plain hex (plus two rgba shadow strings) so CardTemplate can drop them
 * straight onto the card element as custom properties, which keeps the
 * stylesheet declarative and keeps this logic testable without a DOM.
 */
export function deriveFieldTheme(primary, secondary, accent) {
  const field = parseHex(primary) ? primary.trim() : FIELD_FALLBACK;
  const ink = pickInk(field);
  const light = ink === INK_LIGHT;
  const dir = panelDirection(field);
  const step = amount => shade(field, dir * amount * (dir < 0 ? DARKEN_BOOST : 1));

  // Panels, in the order they stack. `panel` is the chart's cells, `panelAlt`
  // its header row, `frame` the card's inner keyline.
  //
  // The amounts hold the REFERENCE ART's relationships, re-based on whatever
  // field the team supplies. Measured off 08_09_LeBron_James.png against its
  // own navy: header 1.06:1, cells 1.18:1, keyline 1.32:1, band 1.50-1.98:1,
  // hairlines 3.90:1. Note how quiet the fills are and how loud the hairlines:
  // on the printed card it is the GRID that draws the table, not the panel. So
  // the panels here are only nudged a little past the art (0.11 / 0.05 rather
  // than its 0.055 / 0.02) to read as layers, and the rule keeps its weight.
  const panel = step(0.11);
  const panelAlt = step(0.05);
  const frame = step(0.13);
  const rule = step(0.42);

  // The well sits behind the photo, so it goes the other way — recessed, not
  // raised, whichever way "raised" happens to be for this field.
  const well = shade(field, dir * -0.45);

  const bandTop = step(0.24);
  const bandBottom = step(0.15);

  // Both of these sit under text that crosses two surfaces — the chart's cells
  // and its header, the band's gradient — so each is scored on its worst one.
  const panelInk = pickInkFor(panel, panelAlt);
  const bandInk = pickInkFor(bandBottom, bandTop);

  return {
    field,
    ink,
    inkDim: mix(ink, field, 0.42),
    inkShadow: light ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.5)',
    panel,
    panelAlt,
    // Computed against the PANELS, not the field. They are nearly always the
    // same ink as the field's; they come apart on a mid-tone field, where the
    // field wants dark ink and a panel stepped away from it wants light.
    // Legible beats uniform.
    panelInk,
    panelInkDim: mix(panelInk, panel, 0.42),
    frame,
    rule,
    well,
    bandTop,
    bandBottom,
    bandInk,
    bandShadow: bandInk === INK_LIGHT ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.5)',
    // The accent's job is text and hairlines ON the field, so it has to clear
    // the field — an accent that happens to equal the primary would otherwise
    // paint the player's name in the field color and erase it.
    accentOnField: readableOn(accent, field, MIN_ACCENT_CONTRAST),
    // ── The band's diagonal stripes ────────────────────────────────────────
    //
    // On the printed card these are the team's own two colors washed over a
    // NEUTRAL navy band — Cleveland's are wine and gold. Now that the band is
    // itself derived from the primary, a primary stripe would be invisible on
    // it, so the first stripe becomes a TONAL step of the field instead, which
    // is what the wine stripe amounted to in the first place. The second stays
    // the secondary, exactly as the art has it.
    //
    // The accent is deliberately not used here. Half the league falls back to
    // cream, and cream at 0.62 opacity across a red band turns a Bulls card's
    // header pink — the tonal stripe keeps the band the team's color.
    stripeTonal: step(0.44),
    stripeSecondary: readableOn(secondary, bandTop, MIN_DECOR_CONTRAST),
  };
}

/**
 * The derived palette as CSS custom properties, ready to spread into a style
 * object. Names match the `var(--…)` calls in CardTemplate.module.css.
 */
export function fieldThemeVars(theme) {
  return {
    '--field': theme.field,
    '--field-ink': theme.ink,
    '--field-ink-dim': theme.inkDim,
    '--field-ink-shadow': theme.inkShadow,
    '--field-panel': theme.panel,
    '--field-panel-alt': theme.panelAlt,
    '--field-panel-ink': theme.panelInk,
    '--field-panel-ink-dim': theme.panelInkDim,
    '--field-frame': theme.frame,
    '--field-rule': theme.rule,
    '--field-well': theme.well,
    '--field-band-top': theme.bandTop,
    '--field-band-bottom': theme.bandBottom,
    '--field-band-ink': theme.bandInk,
    '--field-band-shadow': theme.bandShadow,
    '--accent-on-field': theme.accentOnField,
    '--stripe-tonal': theme.stripeTonal,
    '--stripe-secondary': theme.stripeSecondary,
  };
}
