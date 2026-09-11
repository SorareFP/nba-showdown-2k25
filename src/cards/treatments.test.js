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
  compositeOver,
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
import {
  BADGES,
  BADGE_IDS,
  BEST_SEASON_BADGE,
  ROOKIE_BADGE,
  SUPER_SEASON_BADGE,
  SUPER_SEASON_MIN_SALARY,
  badgeColors,
  badgeLabel,
  badgeLabels,
  badgeVars,
  getBadge,
  pickBadge,
  tierBadge,
} from './badges.js';
import { awardColors } from './awards.js';
import {
  TEAMS,
  HISTORICAL_TEAMS,
  WNBA_TEAMS,
  WNBA_HISTORICAL_TEAMS,
  resolveAccent,
} from './teams.js';
import {
  SETS,
  SUPER_SEASON_SET,
  WNBA_SUPER_SEASON_SET,
  cardTreatment,
  setBadge,
  setTreatment,
  showsSeason,
} from './sets.js';

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

/**
 * AND THE WNBA, BOTH TABLES, which this sweep did not used to reach.
 *
 * It had no reason to: the WNBA set declares `treatment: null`, so no WNBA
 * field ever met the gold foil. The WNBA SUPER SEASON set changed that — it is
 * gold foil on WNBA franchises, live and historical — and a treatment whose
 * whole design is "may not make the card less legible than it already is"
 * cannot be trusted on fields it was never measured against.
 *
 * The historical WNBA rows are the sharper half. Several are colours nothing
 * else in this repo contains: the Tulsa Shock's #FFB81C is a YELLOW field, far
 * lighter than the Bobcats' orange and the lightest ground the foil has ever
 * been asked to sit on, and the Utah Starzz's #006271 and the Storm's #00573F
 * are dark saturated greens the NBA table has no equivalent of.
 */
const WNBA_STOCK = Object.entries(WNBA_TEAMS).map(([abbr, team]) => [
  `W:${abbr}`,
  team.primary,
  team.secondary,
  resolveAccent(team),
]);

const WNBA_HISTORIC = Object.entries(WNBA_HISTORICAL_TEAMS).map(([abbr, team]) => [
  `W:${abbr}`,
  team.primary,
  team.secondary,
  resolveAccent(team),
]);

const ALL_TEAMS = [...STOCK, ...HISTORIC, ...WNBA_STOCK, ...WNBA_HISTORIC];

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

  it('no longer emits the badge at all — that is a CARD property now', () => {
    // It used to emit `--treatment-badge`/`--treatment-badge-ink`, because at
    // the time only a treated set could show a badge. A 2026-27 card whose best
    // season is the one it is built from now shows one on an UNTREATED field,
    // so the badge moved to badges.js and this layer stopped owning it. Pinned
    // as an absence so the two cannot quietly both start emitting one.
    for (const id of TREATMENT_IDS) {
      const vars = treatmentVars(themeFor(STOCK[0], id));
      for (const key of Object.keys(vars)) {
        expect(key, `${id} still emits ${key}`).not.toMatch(/badge/);
      }
    }
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

  it('keeps the season line reading wherever the sidebar puts it', () => {
    // The season is the sidebar's own ink — it inherits, exactly as POS, the
    // boosts and the salary do — so what has to hold is that the treatment did
    // not spend that ink's contrast. Two surfaces, because the sidebar column
    // is the only place on the card where a translucent fill is involved: the
    // bare field, and the field once the bar has been composited over it.
    for (const team of ALL_TEAMS) {
      const [abbr, primary, secondary, accent] = team;
      const base = deriveFieldTheme(primary, secondary, accent);
      const t = applyTreatment(base, treatment);
      for (const [where, surface] of [
        ['field', s => s.field],
        ['bar', s => compositeOver(s.scrim, s.field)],
      ]) {
        expect(contrastRatio(t.ink, surface(t)), `${abbr} season over the ${where}`)
          .toBeGreaterThanOrEqual(
            Math.min(AA_BODY, contrastRatio(base.ink, surface(base))) - 1e-9
          );
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

// ── THE CARD-TYPE BADGE, ON EVERY FIELD IT CAN NOW LAND ON ──────────────────
//
// This sweep used to sit inside the per-treatment block above, because a badge
// could only appear on a treated card: the two special sets declared one and
// nothing else could. That stopped being true. A 2026-27 card whose best season
// is the one that set is built from carries the SUPER SEASON badge on an
// UNTREATED field — a combination that had never been measured, and the one the
// change most obviously could have got wrong, since gold is a mid-tone and the
// untreated fields are the team's raw primaries.
//
// So the sweep is the CROSS PRODUCT: every badge × every treatment INCLUDING no
// treatment at all × all thirty-seven live and defunct franchises. 222 pairings,
// no exemptions.
//
// ROOKIE-ON-UNTREATED IS NOW A SHIPPING COMBINATION, not a hypothetical, and
// that is why the sweep was written this way before it was one. When the pill
// was added, three of the four badge/treatment pairs shipped (gold on foil,
// rookie on green, gold on a bare field) and the fourth — the team accent on
// an untreated field — was reachable only by someone temporarily flipping the
// priority in badges.js to see what would happen. Then the priority flipped for
// real: 33 base cards print the ROOKIE pill on their raw team primary, across
// whatever franchises those 33 rookies happen to play for. Nothing had to be
// added here, because the sweep never asked which pairs were live. That is the
// argument for sweeping the cross product rather than the shipping set — the
// combination that becomes reachable is exactly the one nobody thought to add.
//
// The 33 are also not a general sample: they are one draft class, so they cover
// maybe twenty franchises. All thirty-seven are swept anyway, live and defunct,
// because a trade or a defunct-team rookie card is a data change and not a code
// change, and this test must not have to be revisited when the roster moves.
const FIELD_STATES = [['untreated', null], ...TREATMENT_IDS.map(id => [id, id])];

describe.each(BADGES.map(b => [b.id, b]))('the %s badge', (badgeId, badge) => {
  it.each(FIELD_STATES)('reads on every field, %s', (_label, treatment) => {
    // THE BADGE IS A SURFACE THE CARD INVENTS. Everything a treatment touches
    // already existed and is held to "no worse than the untreated card"; a
    // filled pill that was not there before has no untreated counterpart, so it
    // is held to the flat WCAG body floor instead — which it can be, because
    // both of its colours are chosen rather than inherited.
    //
    // NOT EXEMPTED ANYWHERE, and the Rookie badge is why that matters: it takes
    // the TEAM's accent, which on half the league is the cream fallback
    // (#E6ECF8, a near-white pill with near-black type) and on Phoenix is a
    // mid-tone orange — the two ends of the range a single ink has to cover.
    for (const team of ALL_TEAMS) {
      const [abbr, primary, secondary, accent] = team;
      // The UNTREATED theme, always — that is what CardTemplate hands the
      // badge, and it is what keeps the ROOKIE pill the team's accent instead
      // of the green treatment's green. `treatment` here decides which FIELD
      // the pill is judged against, which is the thing that actually varies.
      const base = deriveFieldTheme(primary, secondary, accent);
      const rendered = applyTreatment(base, treatment);
      const { fill, ink } = badgeColors(base, badge);

      expect(fill, `${abbr} badge fill`).toMatch(/^#[0-9A-F]{6}$/i);
      expect(contrastRatio(ink, fill), `${abbr} ${badgeId} label`)
        .toBeGreaterThanOrEqual(AA_BODY);
      // And the pill has to be tellable from the card it sits on, at the same
      // floor the accent already clears — it is a filled shape ON the field.
      // `rendered.field` rather than `base.field` so a treatment that ever
      // starts repainting the field cannot slip past this.
      expect(contrastRatio(fill, rendered.field), `${abbr} ${badgeId} on field`)
        .toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST - 1e-9);
    }
  });
});

// ── AND THE AWARD CHIP IS SWEPT BESIDE THEM, NOT EXEMPTED ──────────────────
//
// The lettered chip an award falls back to (public/awards/ is empty, so today
// that is every mark on every card) is a FILLED SHAPE the card invents, exactly
// like a badge pill, so it is held to exactly what a badge pill is held to:
// its type reads on it at the WCAG body floor, and it reads on the field it
// sits on at MIN_ACCENT_CONTRAST, on all thirty-seven franchises and in every
// field state.
//
// It happens to be cheap to satisfy, and that is the design rather than luck:
// `awardColors` returns the BEST SEASON pill's own pair, so this sweep is
// asserting that no new colour was introduced as much as it is asserting the
// contrast. Which is why it is here rather than skipped as redundant — the day
// somebody gives the chip a colour of its own, this is what notices.
describe.each(FIELD_STATES)('the award chip, %s', (_label, treatment) => {
  it('reads on every field, and never on a colour of its own', () => {
    for (const team of ALL_TEAMS) {
      const [abbr, primary, secondary, accent] = team;
      // The UNTREATED theme, for badges.js's reason: an award is a fact about a
      // player's season, so the foil must not gild the chip and the green must
      // not repaint it. CardTemplate passes `base` here exactly as it does to
      // badgeVars.
      const base = deriveFieldTheme(primary, secondary, accent);
      const rendered = applyTreatment(base, treatment);
      const { fill, ink } = awardColors(base);

      expect(fill, `${abbr} award fill`).toMatch(/^#[0-9A-F]{6}$/i);
      // NOT A NEW COLOUR. The whole contrast argument for this chip is that it
      // borrows one that was already cleared.
      expect(fill, `${abbr} award fill is the accent`).toBe(base.accentOnField);
      expect(ink, `${abbr} award ink`).toBe(pickInkFor(fill));
      expect(contrastRatio(ink, fill), `${abbr} award code`).toBeGreaterThanOrEqual(AA_BODY);
      expect(contrastRatio(fill, rendered.field), `${abbr} award chip on field`)
        .toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST - 1e-9);
    }
  });

  it('is the BEST SEASON pill exactly, so the two can never drift apart', () => {
    // Stated as an identity rather than as two numbers that happen to match: if
    // one of them is ever re-derived, this fails instead of the pair silently
    // becoming two slightly different accents in one sidebar.
    const bestSeason = getBadge(BEST_SEASON_BADGE);
    for (const team of ALL_TEAMS) {
      const [abbr, primary, secondary, accent] = team;
      const base = deriveFieldTheme(primary, secondary, accent);
      expect(awardColors(base), abbr).toEqual(badgeColors(base, bestSeason));
    }
  });
});

describe('the badge model', () => {
  it('prints ONE badge, the highest-priority one that applies', () => {
    // ROOKIE BEATS SUPER SEASON, and the 33 players who are BOTH are the only
    // ones this resolution ever runs on. Their rookie season is the current
    // one, so their best season is too — it is their only one — which makes
    // "his best season" a superlative over a set of one and "his rookie season"
    // the fact worth the pill. See the argument in badges.js.
    expect(pickBadge([SUPER_SEASON_BADGE, ROOKIE_BADGE]).id).toBe(ROOKIE_BADGE);
    expect(pickBadge([ROOKIE_BADGE, SUPER_SEASON_BADGE]).id).toBe(ROOKIE_BADGE);
    // The order of the ARGUMENT must not matter; the order of BADGES must.
    expect(BADGE_IDS.indexOf(ROOKIE_BADGE)).toBeLessThan(BADGE_IDS.indexOf(SUPER_SEASON_BADGE));
  });

  it('dates the ROOKIE pill only when the card prints no season of its own', () => {
    // The other half of the change. A base-set card has no season row, so the
    // year goes in the pill or nowhere; a Rookie-set card dates itself one line
    // below the pill, so the pill must NOT say it twice.
    const rookie = getBadge(ROOKIE_BADGE);
    expect(badgeLabel(rookie, '2025-26')).toBe('25-26 ROOKIE');
    expect(badgeLabel(rookie, null)).toBe('ROOKIE');
    // Every season the tree can actually hand it, shortened the same way.
    expect(badgeLabel(rookie, '2024-25')).toBe('24-25 ROOKIE');
    // SUPER SEASON has no dated form: 18 characters in a 12-character pill.
    expect(badgeLabel(getBadge(SUPER_SEASON_BADGE), '2025-26')).toBe('SUPER SEASON');
    // Anything that is not a season LABEL leaves the pill undated rather than
    // being interpolated into it — the two special sets' `statsSeason` rows are
    // prose, and the WNBA's is a single year.
    for (const s of ['career-best season', 'rookie season', '2026', '', null, undefined, 2026]) {
      expect(badgeLabel(rookie, s), String(s)).toBe('ROOKIE');
    }
    expect(badgeLabel(null, '2025-26')).toBeNull();
  });

  it('offers the width budget every label a badge can print', () => {
    // badgeLabels is what CardTemplate.test.js measures against the 127px pill.
    // It has to include the DATED forms, or the longest string on the card stops
    // being measured the moment a badge learns to date itself.
    const labels = badgeLabels(SETS.map(s => s.statsSeason));
    expect(labels).toContain('ROOKIE');
    expect(labels).toContain('SUPER SEASON');
    expect(labels).toContain('25-26 ROOKIE');
    expect(labels).toContain('24-25 ROOKIE');
    // Deduplicated: the undated labels are produced once per season tried.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('resolves one badge on its own, and nothing from nothing', () => {
    expect(pickBadge([ROOKIE_BADGE]).id).toBe(ROOKIE_BADGE);
    expect(pickBadge([])).toBeNull();
    expect(pickBadge([null, undefined])).toBeNull();
    expect(pickBadge(null)).toBeNull();
  });

  it('ignores an id it does not know rather than throwing', () => {
    // A data file naming a badge this build does not declare should cost that
    // card its pill, not the whole studio.
    expect(pickBadge(['championship-standout'])).toBeNull();
    expect(pickBadge(['constructor'])).toBeNull();
    expect(pickBadge(['toString', ROOKIE_BADGE]).id).toBe(ROOKIE_BADGE);
    expect(getBadge('nope')).toBeNull();
  });

  it('emits no CSS properties for a card with no badge', () => {
    // Same rule as an untreated theme: no badge means no properties at all, so
    // `.badge`'s var fallbacks stay unreached and nothing can inherit a pill.
    const base = deriveFieldTheme('#0C2340', '#B9975B', '#B9975B');
    expect(badgeVars(base, null)).toEqual({});
    expect(badgeVars(null, getBadge(SUPER_SEASON_BADGE))).toEqual({});
    expect(badgeColors(base, null)).toBeNull();
  });

  it('emits both colours as plain hex when there is one', () => {
    const base = deriveFieldTheme('#0C2340', '#B9975B', '#B9975B');
    const vars = badgeVars(base, getBadge(SUPER_SEASON_BADGE));
    expect(vars['--badge-fill']).toMatch(/^#[0-9A-F]{6}$/i);
    expect(vars['--badge-ink']).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('takes the SUPER SEASON pill from the foil gold, on treated and bare fields alike', () => {
    // ONE gold. The pill on an untreated 2026-27 card and the pill on a foil
    // Super Season card are derived in two different places now, so what stops
    // them drifting is that both are `readableOn(GOLD, field)` — asserted here
    // against the foil treatment's own accent, which is the same call.
    for (const team of ALL_TEAMS) {
      const [abbr, primary, secondary, accent] = team;
      const base = deriveFieldTheme(primary, secondary, accent);
      const foil = applyTreatment(base, 'gold-foil');
      const { fill } = badgeColors(base, getBadge(SUPER_SEASON_BADGE));
      expect(fill, `${abbr} pill matches the foil name`).toBe(foil.accentOnField);
      const [r, g, b] = parseHex(fill);
      expect(r, `${abbr} badge is warm`).toBeGreaterThan(b);
      expect(g, `${abbr} badge is gold, not red`).toBeGreaterThan(b);
    }
    // And on the fields dark enough to carry it, it is the gold EXACTLY.
    const kept = ALL_TEAMS.filter(([, p, s, a]) =>
      badgeColors(deriveFieldTheme(p, s, a), getBadge(SUPER_SEASON_BADGE)).fill === GOLD
    );
    expect(kept.length).toBeGreaterThanOrEqual(20);
  });

  it('takes the BEST SEASON pill from the team accent too, and never from the gold', () => {
    // THE UNGILDED TIER'S WHOLE VISUAL ARGUMENT, on all thirty-seven fields.
    // "not make the tab gold" settles what it is not; this settles what it is.
    // The team's accent is the pill the ROOKIE badge already takes, so the pair
    // reads deliberately: a gold pill means a gold card, a team-coloured pill
    // means a card with the team's own palette on it.
    for (const team of ALL_TEAMS) {
      const [abbr, primary, secondary, accent] = team;
      const base = deriveFieldTheme(primary, secondary, accent);
      const best = badgeColors(base, getBadge(BEST_SEASON_BADGE));
      const superSeason = badgeColors(base, getBadge(SUPER_SEASON_BADGE));
      expect(best.fill, `${abbr} is the team accent`).toBe(base.accentOnField);
      expect(best.fill, `${abbr} is the ROOKIE pill's colour`)
        .toBe(badgeColors(base, getBadge(ROOKIE_BADGE)).fill);
      // And it is NOT the gilded tier's, which is the thing a reader has to be
      // able to tell at a glance. Held on every field including the ones where
      // readableOn has lifted the gold — the two must not converge there.
      expect(best.fill, `${abbr} is not the foil gold`).not.toBe(superSeason.fill);
      expect(best.fill, `${abbr} is not raw GOLD either`).not.toBe(GOLD);
    }
  });

  it("takes the ROOKIE pill from the TEAM's accent, never the set green", () => {
    // "Rookie can just be secondary/accent team color". This is the one place
    // on a rookie card where the team's own colour survives the treatment, and
    // it is why badges.js is handed the UNTREATED theme: the green treatment
    // overwrites `accentOnField`, and a pill read off the treated theme would
    // come out green on all thirty-seven fields.
    for (const team of ALL_TEAMS) {
      const [abbr, primary, secondary, accent] = team;
      const base = deriveFieldTheme(primary, secondary, accent);
      const green = applyTreatment(base, 'green-accent');
      const { fill } = badgeColors(base, getBadge(ROOKIE_BADGE));
      expect(fill, `${abbr} badge is the team accent`).toBe(base.accentOnField);
      // Unless the TEAM's own colour resolves to the same hex — the 1989-96
      // Timberwolves' green does. A green pill is fine when it is the team's
      // green; the assertion only forbids the SET green sneaking in where the
      // team's accent is something else.
      if (base.accentOnField !== green) {
        expect(fill, `${abbr} badge is not the set green`).not.toBe(green);
      }
    }
  });
});

// ── THE SALARY TIER ─────────────────────────────────────────────────────────
//
// "re: Super Season, I think we can just put 'Best Season' and not make the tab
// gold for anyone under 700 salary." The line has since moved to 900 — see
// SUPER_SEASON_MIN_SALARY for why — and nothing below changed with it except
// the one assertion that names the number. One decision with two consequences — the
// pill's label and colour, and the gold foil — and the reason they are tested
// together here is that they are computed from ONE comparison. `tierBadge` is
// asked by `pickBadge` for the badge and by `cardTreatment` for the treatment,
// so the failure mode this guards against is not a wrong threshold (that is one
// constant) but the two answers drifting: a gold band under a team-coloured
// pill, or a BEST SEASON pill on a foil card.
describe('the Super Season salary tier', () => {
  it('demotes the badge below the line and gilds at it', () => {
    const at = SUPER_SEASON_MIN_SALARY;
    expect(pickBadge([SUPER_SEASON_BADGE], at).id).toBe(SUPER_SEASON_BADGE);
    expect(pickBadge([SUPER_SEASON_BADGE], at - 1).id).toBe(BEST_SEASON_BADGE);
    expect(pickBadge([SUPER_SEASON_BADGE], 10).id).toBe(BEST_SEASON_BADGE);
    expect(pickBadge([SUPER_SEASON_BADGE], 1500).id).toBe(SUPER_SEASON_BADGE);
    // "under [the line]" — so the line itself is gold. A real card sits exactly
    // there: Jonas Valančiūnas' 2020-21 at $900.
    expect(tierBadge(SUPER_SEASON_BADGE, at)).toBe(SUPER_SEASON_BADGE);
    expect(tierBadge(SUPER_SEASON_BADGE, at - 0.01)).toBe(BEST_SEASON_BADGE);
  });

  it('is a DECLARED number, not a quantile of whatever the pool is today', () => {
    // Pinning it to a quantile would move the boundary every time the rosters
    // were regenerated — a player could lose his gold because somebody else got
    // a raise. Salary is printed on the face of the card; the line is drawn on
    // that value and stays where it is put.
    //
    // THAT THE NUMBER MOVED IS NOT AN ARGUMENT AGAINST THIS. It was 700, which
    // landed within one card of the Super Season set's median (104 of 210 below,
    // 106 at or above) and so made the gold a coin flip; the user moved it to
    // 900 on being shown that, which gilds 55 of the 210. A declared value that
    // a person changes deliberately is exactly what this is; a derived one would
    // have changed itself, unannounced, on the next regeneration.
    expect(SUPER_SEASON_MIN_SALARY).toBe(900);
    expect(Number.isInteger(SUPER_SEASON_MIN_SALARY)).toBe(true);
  });

  it('demotes NOTHING else, at any price', () => {
    // Only the badge that makes a CLAIM can overstate one. "This was his rookie
    // season" is a fact about a career and is exactly as true at $10.
    for (const salary of [0, 10, 699, 700, 899, 900, 1500, null, undefined, NaN]) {
      expect(tierBadge(ROOKIE_BADGE, salary), String(salary)).toBe(ROOKIE_BADGE);
      expect(tierBadge(BEST_SEASON_BADGE, salary), String(salary)).toBe(BEST_SEASON_BADGE);
      expect(tierBadge('championship-standout', salary), String(salary))
        .toBe('championship-standout');
    }
  });

  it('keeps the gold when the salary is unknown, never the other way round', () => {
    // Demotion requires EVIDENCE. The opposite default would strip the foil off
    // a whole set on a checkout where the salary generator had not been run,
    // and that would read as the feature having broken rather than as data
    // being absent. Every caller that predates the tier omits the argument, so
    // this is also what freezes their behaviour.
    for (const salary of [undefined, null, NaN, Infinity, '10', {}, []]) {
      expect(tierBadge(SUPER_SEASON_BADGE, salary), String(salary)).toBe(SUPER_SEASON_BADGE);
      expect(pickBadge([SUPER_SEASON_BADGE], salary).id, String(salary))
        .toBe(SUPER_SEASON_BADGE);
    }
    expect(pickBadge([SUPER_SEASON_BADGE]).id).toBe(SUPER_SEASON_BADGE);
  });

  it('is applied BEFORE the priority, so ROOKIE still wins on the 33', () => {
    // A rookie card is cheap and its Super Season badge demotes — and it must
    // still lose to ROOKIE, exactly as the gilded form does. The two rules
    // compose; neither is a special case of the other.
    expect(pickBadge([ROOKIE_BADGE, SUPER_SEASON_BADGE], 10).id).toBe(ROOKIE_BADGE);
    expect(pickBadge([SUPER_SEASON_BADGE, ROOKIE_BADGE], 10).id).toBe(ROOKIE_BADGE);
    expect(BADGE_IDS.indexOf(ROOKIE_BADGE))
      .toBeLessThan(BADGE_IDS.indexOf(BEST_SEASON_BADGE));
  });

  it('withholds the SET treatment by the same comparison that demotes the pill', () => {
    // THE ONE THING THAT MUST NOT DRIFT. Both super-season sets, both sides of
    // the line, and the treatment answer has to agree with the badge answer on
    // every one of them — a gold band under a BEST SEASON pill is the bug this
    // exists to make impossible.
    for (const set of [SUPER_SEASON_SET, WNBA_SUPER_SEASON_SET]) {
      for (const salary of [10, 690, 699, 700, 860, 899, 900, 1500, undefined]) {
        const gilded = pickBadge([setBadge(set)], salary).id === SUPER_SEASON_BADGE;
        expect(cardTreatment(set, salary), `${set} $${salary}`)
          .toBe(gilded ? setTreatment(set) : null);
      }
    }
  });

  it('leaves every other set exactly as it was, at every price', () => {
    // The Rookie set's green does not tier (its badge does not), and the two
    // season sets have no treatment to withhold. Identity with `setTreatment`,
    // so a card in them cannot be given a treatment it did not have either.
    for (const set of SETS.map(s => s.id)) {
      if (set === SUPER_SEASON_SET || set === WNBA_SUPER_SEASON_SET) continue;
      for (const salary of [10, 699, 700, 899, 900, 1500, undefined]) {
        expect(cardTreatment(set, salary), `${set} $${salary}`).toBe(setTreatment(set));
      }
    }
    expect(cardTreatment('no-such-set', 10)).toBeNull();
  });

  it('gives the ungilded tier the untouched team theme — not a quieter foil', () => {
    // WHAT AN UNGILDED CARD LOOKS LIKE, asserted as an identity rather than
    // described. `applyTreatment(base, null)` returns the object it was given,
    // so a BEST SEASON card renders on precisely the palette deriveFieldTheme
    // produced: no second metal invented for the cheap tier, no half-strength
    // gold, nothing. What still separates it from a base card is the SEASON
    // LINE (showsSeason is a set property and does not tier) and the pill.
    for (const team of ALL_TEAMS) {
      const [abbr, primary, secondary, accent] = team;
      const base = deriveFieldTheme(primary, secondary, accent);
      expect(applyTreatment(base, cardTreatment(SUPER_SEASON_SET, 10)), abbr).toBe(base);
      expect(base.treatment, abbr).toBeUndefined();
    }
    expect(showsSeason(SUPER_SEASON_SET)).toBe(true);
  });

  it('prints a label that fits the pill it is not gold in', () => {
    // 11 characters against SUPER SEASON's 12, and no dated form — every set
    // that can print it prints a season line one row below. The 127px budget
    // itself is measured in CardTemplate.test.js over `badgeLabels`, which
    // picks this up from BADGES without being told.
    expect(badgeLabel(getBadge(BEST_SEASON_BADGE))).toBe('BEST SEASON');
    expect(badgeLabel(getBadge(BEST_SEASON_BADGE), '2025-26')).toBe('BEST SEASON');
    expect(badgeLabels(SETS.map(s => s.statsSeason))).toContain('BEST SEASON');
    expect('BEST SEASON'.length).toBeLessThan('SUPER SEASON'.length);
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

  it('hands out no badge of its own — see "the badge model" above', () => {
    // The pill it used to fill is now derived in badges.js from the untreated
    // theme, and asserted there to land on this treatment's own gold.
    for (const [abbr, t] of themes) {
      expect(t.treatment.badgeFill, abbr).toBeUndefined();
      expect(t.treatment.badgeInk, abbr).toBeUndefined();
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

  it('hands out no badge of its own either', () => {
    // The ROOKIE pill is derived in badges.js from the UNTREATED theme, which
    // is what keeps it the team's accent rather than this treatment's green —
    // asserted in "the badge model" above, across all thirty-seven fields.
    for (const [abbr, t] of themes) {
      expect(t.treatment.badgeFill, abbr).toBeUndefined();
      expect(t.treatment.badgeInk, abbr).toBeUndefined();
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

  it('falls the badge back to the derived accent, never to nothing', () => {
    // The badge's two properties are the only ones whose inert value would be
    // INVISIBLE rather than merely absent — a transparent pill with no ink is a
    // missing badge, and the card that asked for one would look broken instead
    // of unbadged. So they fall back through the palette every card has.
    //
    // They are `--badge-*`, not `--treatment-badge-*`: the pill is a CARD
    // property now and appears on untreated fields, where no treatment property
    // is emitted at all and a `--treatment-` name would have resolved to its
    // fallback on every one of the 149 badged base cards.
    expect(CARD_CSS).toContain('var(--badge-fill, var(--accent-on-field))');
    expect(CARD_CSS).toContain('var(--badge-ink, var(--field-ink))');
    expect(CARD_CSS).not.toContain('--treatment-badge');
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

// ── THE THROWBACK TREATMENT (docs/plans/2026-09-10-throwbacks-design.md) ─────
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
