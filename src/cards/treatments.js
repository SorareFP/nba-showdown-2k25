// SET-LEVEL VISUAL TREATMENTS — the layer that makes a Super Season card look
// like gold foil and a Rookie card read green, without either one becoming a
// second card template.
//
// ── WHY THIS COMPOSES WITH fieldTheme RATHER THAN REPLACING IT ──────────────
//
// CardTemplate is the single source of truth for both the studio preview and
// the batch PNG export, and fieldTheme.js is the single source of truth for
// what colour anything on it is. Forking either for a special set would give
// the export two renderers to keep in step and the palette two places to derive
// contrast — the exact drift the one-template rule exists to prevent.
//
// So a treatment is a FUNCTION ON A DERIVED THEME. `deriveFieldTheme` runs
// first, unchanged, and produces the team's whole palette; `applyTreatment`
// then returns a NEW theme with the same keys plus a `treatment` block of
// extras. Every consumer — `fieldThemeVars`, the stylesheet, the contrast
// sweeps — goes on working on the result because it is the same shape.
//
// ── THE CONTRAST RULE, WHICH IS THE WHOLE DESIGN ────────────────────────────
//
// A treatment MAY NOT make the card less legible than the untreated card is.
// Not "must clear 4.5:1" — that would be unachievable on a field like OKC's
// #0072CE, which only reaches 4.88:1 with white ink before anything is done to
// it, and would push every treatment into being invisible. The rule is
// RELATIVE:
//
//     target = min(AA_BODY, contrast the untreated card already achieves)
//
// and every surface the treatment introduces has to clear that target with the
// ink the treated card actually uses. So on a near-black Spurs field the foil
// gets its full amplitude (there are 20 contrast points to spend); on OKC's
// blue it is quietly turned down until it fits. NOTHING IS EXEMPTED and nothing
// is hand-tuned per team — the amplitude is SEARCHED, per field, against the
// measurement. src/cards/treatments.test.js runs the fieldTheme sweep's own
// assertions over all thirty teams for every treatment.
//
// ── AND IT HAS TO SURVIVE A SCREENSHOT ─────────────────────────────────────
//
// The export is a static PNG. So "foil" here is a fixed multi-stop GRADIENT —
// a metal sweep baked into the band, the frame and a diagonal sheen across the
// field. No animation, no transitions, no viewer-dependent effects, nothing
// that needs a second frame to look right. What the studio shows is exactly
// what the screenshot gets.
import {
  INK_LIGHT,
  MIN_ACCENT_CONTRAST,
  MIN_DECOR_CONTRAST,
  contrastRatio,
  mix,
  pickInkFor,
  readableOn,
  shade,
} from './fieldTheme.js';

/** WCAG's floor for normal-size text — the ceiling of what a treatment aims at. */
export const AA_BODY = 4.5;

/**
 * The foil palette. Three tones because a single gold reads as paint, not
 * metal: foil is a highlight, a body and a shadow swept across one surface.
 */
export const GOLD = '#D4AF37';
export const GOLD_HI = '#F6E7A8';
export const GOLD_LO = '#7A5C16';

/** The rookie green. One tone — "plain and simple", in the user's words. */
export const GREEN = '#00A94F';
export const GREEN_LO = '#03502A';

/**
 * How far the FIELD's sheen is allowed to travel toward the highlight.
 *
 * Deliberately small. The field is the team's colour and the point of the card
 * — a Bulls Super Season card is still a red card — so the sheen is a shimmer
 * over it, not a repaint of it. The band and the frame carry the gold.
 */
const FIELD_SHEEN_MAX = 0.17;

/**
 * How far the BAND may travel. Large, because this is where the foil lives:
 * at the top of the range the header goes properly metallic and its ink flips
 * to near-black, which is what a gold foil panel actually looks like.
 */
const BAND_FOIL_MAX = 0.86;

/**
 * How far the foil's highlight and shadow sit either side of the band's tone.
 *
 * Asymmetric, and brighter than it is dark, because that is what light on metal
 * does — and because the shadow is the stop that binds: it is the darkest
 * background the band's ink has to read on, so every point spent there comes
 * straight off the amplitude the fit can afford.
 */
const BAND_HIGHLIGHT = 0.26;
const BAND_SHADOW = 0.16;

/** How far the band must sit from the field before it reads as a band at all. */
const MIN_BAND_SEPARATION = 1.3;

/** Amplitudes are searched on this lattice, coarsest useful step first. */
const SEARCH_STEP = 0.02;

/**
 * The largest amplitude in [0, max] at which every surface `stopsFor` produces
 * still clears `target` with the ink that surface set would actually use.
 *
 * SEARCHED, NOT SOLVED, because the ink is chosen from the surfaces and the
 * surfaces depend on the amplitude — the relationship is not monotonic through
 * the ink flip, so a closed form would have to assume which ink wins. Stepping
 * down from the maximum finds the boldest amplitude that works and lets the
 * flip happen where it helps (a gold band with dark text) instead of ruling it
 * out.
 *
 * Returns 0 when nothing fits, which means "this treatment shows no sheen on
 * this field" — a card that keeps the team's plain surfaces is a far better
 * failure than one that cannot be read.
 */
export function fitAmplitude(stopsFor, target, max, accept = () => true) {
  for (let t = max; t > 0; t -= SEARCH_STEP) {
    const stops = stopsFor(t);
    const ink = pickInkFor(...stops);
    if (Math.min(...stops.map(s => contrastRatio(ink, s))) >= target && accept(stops)) {
      return Number(t.toFixed(4));
    }
  }
  return 0;
}

/**
 * The contrast a treated surface has to reach: WCAG's body floor, or whatever
 * the untreated surface already managed if that was less. See the header.
 */
export function treatmentTarget(...backgrounds) {
  const ink = pickInkFor(...backgrounds);
  const worst = Math.min(...backgrounds.map(b => contrastRatio(ink, b)));
  return Math.min(AA_BODY, worst);
}

/** A CSS `linear-gradient` from an angle and [colour, position%] pairs. */
function gradient(angle, stops) {
  return `linear-gradient(${angle}, ${stops.map(([c, p]) => `${c} ${p}%`).join(', ')})`;
}

/**
 * The diagonal sheen laid over the field.
 *
 * A repeating gradient at a shallow angle, so it reads as light travelling
 * across metal rather than as a stripe pattern. Transparent everywhere except
 * the highlight passes: painting the field's own colour back over itself would
 * be a no-op that still cost a compositing layer.
 */
function sheenImage(hi, lo) {
  return (
    `repeating-linear-gradient(107deg, ` +
    `transparent 0 46px, ${lo} 46px 92px, transparent 92px 150px, ` +
    `${hi} 150px 176px, transparent 176px 268px)`
  );
}

/**
 * The gold foil sweep, for the band and the frame.
 *
 * Five stops, asymmetric on purpose: real foil has one bright pass off-centre,
 * not a symmetric bell. The same stop list serves the band (as a background)
 * and the frame (as a border-image), so the two cannot fall out of step.
 */
function foilSweep(angle, base, hi, lo) {
  return gradient(angle, [
    [lo, 0],
    [base, 14],
    [hi, 34],
    [base, 52],
    [lo, 70],
    [hi, 88],
    [lo, 100],
  ]);
}

/**
 * GOLD FOIL — the Super Season set.
 *
 * Four surfaces carry it, in descending order of how loud they are:
 *
 *   the band     goes metallic. This is the set's signature: at full amplitude
 *                the SPEED/POWER header is gold with near-black type on it.
 *   the frame    a gold sweep in the 7px keyline, drawn as a border-image over
 *                the existing frame so the untreated rule is untouched.
 *   the name     the 96px vertical name takes the gold as its accent, nudged by
 *                readableOn until it clears the field.
 *   the field    a low-amplitude diagonal sheen, budgeted against the ink.
 */
function goldFoil(theme) {
  const fieldTarget = treatmentTarget(theme.field);
  const fieldAmount = fitAmplitude(
    t => [theme.field, mix(theme.field, GOLD_HI, t), mix(theme.field, GOLD_LO, t * 0.8)],
    fieldTarget,
    FIELD_SHEEN_MAX
  );
  const sheenHi = mix(theme.field, GOLD_HI, fieldAmount);
  const sheenLo = mix(theme.field, GOLD_LO, fieldAmount * 0.8);
  const fieldStops = [theme.field, sheenHi, sheenLo];
  const ink = pickInkFor(...fieldStops);

  // The stop ORDER matches `stopsFor` below, deliberately: at amplitude 0 the
  // two have to be the same list, or the "a treatment never reads worse than
  // the untreated card" guarantee has a rounding-sized hole in it (pickInkFor
  // tints its dark candidate from the FIRST background it is given).
  // THE SWEEP IS SHADES OF ONE TONE, not a blend between three separate ones,
  // and that is a correction rather than a preference. Mixing the band toward
  // GOLD_HI and GOLD_LO independently spread the gradient across a luminance
  // range no single ink could cover — on Atlanta the stops ran from L 0.11 to
  // L 0.68 and the fit had to give almost all of the foil back to keep
  // SPEED/POWER readable. Deriving the highlight and the shadow FROM the
  // fitted base keeps the sweep narrow enough for one ink at any amplitude,
  // which is also what real foil looks like: one metal catching light, not
  // three metals.
  const bandStopsAt = t => {
    const base = mix(theme.bandTop, GOLD, t);
    return [base, shade(base, BAND_HIGHLIGHT), shade(base, -BAND_SHADOW)];
  };
  const bandTarget = treatmentTarget(theme.bandTop, theme.bandTop, theme.bandBottom);
  const bandAmount = fitAmplitude(
    bandStopsAt,
    bandTarget,
    BAND_FOIL_MAX,
    // The band still has to be a BAND. Left to contrast alone the fit will
    // happily park a gold band at the exact luminance of a red or orange field,
    // where it stops reading as a separate surface at all — which is the same
    // 1.3 separation deriveFieldTheme's own band is held to.
    stops => contrastRatio(stops[0], theme.field) >= MIN_BAND_SEPARATION
  );
  const [bandBase, bandHi, bandLo] =
    bandAmount > 0 ? bandStopsAt(bandAmount) : [theme.bandTop, theme.bandTop, theme.bandBottom];
  const bandStops = [bandBase, bandHi, bandLo];
  const bandInk = pickInkFor(...bandStops);

  return {
    ...theme,
    ink,
    inkDim: mix(ink, theme.field, 0.42),
    inkShadow: ink === INK_LIGHT ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.5)',
    // The keyline colour under the gradient: what the frame falls back to if a
    // renderer ever drops border-image, and what the layer test measures.
    frame: readableOn(GOLD, theme.field, MIN_DECOR_CONTRAST),
    // Hairlines are decorative, so they take the looser floor — but they still
    // have to be TELLABLE from the panel they draw the table on.
    rule: readableOn(GOLD, theme.panel, MIN_DECOR_CONTRAST + 0.3),
    bandTop: bandBase,
    bandBottom: bandLo,
    bandInk,
    bandShadow: bandInk === INK_LIGHT ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.5)',
    // Both band stripes go metallic, or the team's own stripe would cut across
    // the foil as a flat band of colour.
    stripeTonal: readableOn(GOLD_HI, bandBase, MIN_DECOR_CONTRAST),
    stripeSecondary: readableOn(GOLD_LO, bandBase, MIN_DECOR_CONTRAST),
    accentOnField: readableOn(GOLD, theme.field, MIN_ACCENT_CONTRAST),
    treatment: {
      id: 'gold-foil',
      fieldStops,
      bandStops,
      fieldAmount,
      bandAmount,
      sheen: fieldAmount > 0 ? sheenImage(sheenHi, sheenLo) : null,
      // Null when the fit found no room for foil at all: the band then keeps
      // the team's own gradient, which the stylesheet paints underneath.
      band: bandAmount > 0 ? foilSweep('163deg', bandBase, bandHi, bandLo) : null,
      frameImage: foilSweep('135deg', GOLD, GOLD_HI, GOLD_LO),
      bandEdge: readableOn(GOLD, theme.field, MIN_DECOR_CONTRAST),
    },
  };
}

/**
 * GREEN ACCENT — the Rookie set. Deliberately quiet.
 *
 * The brief for these is "plain and simple", so nothing here changes a surface;
 * it only re-colours the three lines that were already accents — the vertical
 * name, the keyline, and one of the band's two stripes — and adds the bar under
 * the band that both treatments share. The field, the band and the chart are
 * the team's, untouched, which is why this treatment cannot move contrast at
 * all: `ink`, `panelInk` and `bandInk` are the values deriveFieldTheme chose.
 */
function greenAccent(theme) {
  return {
    ...theme,
    frame: readableOn(GREEN, theme.field, MIN_DECOR_CONTRAST),
    accentOnField: readableOn(GREEN, theme.field, MIN_ACCENT_CONTRAST),
    stripeSecondary: readableOn(GREEN, theme.bandTop, MIN_DECOR_CONTRAST),
    treatment: {
      id: 'green-accent',
      fieldStops: [theme.field],
      bandStops: [theme.bandTop, theme.bandBottom],
      sheen: null,
      band: null,
      // A flat green keyline, not a gradient: this set is not metal.
      frameImage: null,
      bandEdge: readableOn(GREEN, theme.field, MIN_DECOR_CONTRAST),
      // Kept for the sweep, which asserts the accent is recognisably green
      // rather than laundered into the ink on every field.
      source: GREEN,
      sourceLow: GREEN_LO,
    },
  };
}

/** Every treatment, by the id a set declares in src/cards/sets.js. */
export const TREATMENTS = {
  'gold-foil': goldFoil,
  'green-accent': greenAccent,
};

/** The ids a set is allowed to declare. */
export const TREATMENT_IDS = Object.keys(TREATMENTS);

/**
 * The theme a card actually renders with.
 *
 * An unknown or absent treatment returns the theme UNCHANGED — not a copy, not
 * a copy with `treatment: null` bolted on. That identity is what guarantees the
 * two season sets render exactly as they did before this file existed, and
 * treatments.test.js asserts it rather than trusting it.
 */
export function applyTreatment(theme, treatmentId) {
  const fn = TREATMENTS[treatmentId];
  return fn ? fn(theme) : theme;
}

/**
 * The treatment's extras as CSS custom properties.
 *
 * EVERY PROPERTY IS ALWAYS EMITTED once a treatment is present, with an
 * explicitly INERT value where that treatment does not use it — `none` for an
 * image, `transparent` for a fill. That matters because the stylesheet layers
 * these ON TOP of the untreated values (`background-image: var(--treatment-band,
 * none), <the normal gradient>`), so an inert value subtracts nothing, while a
 * missing property would let a treated card inherit whatever the last one set.
 *
 * An untreated theme returns NOTHING, so its card carries no treatment
 * properties at all and every `var(--treatment-…, none)` in the stylesheet
 * resolves to its own inert default. That is what keeps the two season sets
 * pixel-identical to how they rendered before treatments existed.
 */
export function treatmentVars(theme) {
  const t = theme?.treatment;
  if (!t) return {};
  return {
    '--treatment-sheen': t.sheen ?? 'none',
    '--treatment-band': t.band ?? 'none',
    '--treatment-frame': t.frameImage ?? 'none',
    '--treatment-band-edge': t.bandEdge ?? 'transparent',
  };
}
