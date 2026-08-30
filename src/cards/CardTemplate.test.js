// Tests render the component with react-dom/server rather than
// @testing-library/react. Rationale: everything asserted here — that a card
// renders at all, that missing fields degrade to placeholders, and WHICH chart
// row carries the shot-line arrow — is structural and fully visible in static
// markup. Going the testing-library route would mean adding two devDeps and
// switching the suite (or this file) to a jsdom environment to buy assertions
// we don't need. react-dom is already a production dependency here.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import CardTemplate, {
  CARD_WIDTH,
  CARD_HEIGHT,
  formatRollRange,
  findShotLineBoundary,
  nameFontSize,
  logoSrc,
  LEAGUE_LOGO,
  visibleTiers,
} from './CardTemplate.jsx';
import { CARDS } from '../game/cards.js';
import { TEAMS } from './teams.js';
import { POOL_PLAYERS } from '../studio/players.js';

const render = props => renderToStaticMarkup(React.createElement(CardTemplate, props));

/** The <tr> blocks of the rendered chart table, in document order. */
const rows = html => html.match(/<tr>.*?<\/tr>/gs) ?? [];

/**
 * The card's layout is absolutely positioned against a fixed 843x1181 field, so
 * the geometry that has to hold BETWEEN two elements — an edge that meets
 * another edge — lives in the stylesheet and nowhere else. These two read it.
 */
const CARD_CSS = readFileSync(new URL('./CardTemplate.module.css', import.meta.url), 'utf8');

/** One rule block of that stylesheet, by selector (string) or selector list. */
const cssBlock = selector => {
  const head =
    typeof selector === 'string'
      ? selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      : selector.source;
  const block = CARD_CSS.match(new RegExp(`${head}\\s*\\{[^}]*\\}`, 's'));
  if (!block) throw new Error(`no rule for ${selector} in CardTemplate.module.css`);
  return block[0];
};

/** The px value of one declaration in a rule block, or undefined if unset. */
const pxIn = (block, prop) => {
  const found = block.match(new RegExp(`(?:^|[;{\\s])${prop}:\\s*(-?[\\d.]+)px`));
  return found ? Number(found[1]) : undefined;
};

/**
 * LeBron's 2008-09 card, transcribed from the printed art in
 * public/cards/players/08_09_LeBron_James.png. Shot Line 14 puts the arrow on
 * the "14-20" row — the 4th of 5 — which is the specific real-world case this
 * suite exists to lock down.
 */
const LEBRON_08_09 = {
  id: '08_09_LeBron_James',
  name: 'LeBron James',
  team: 'CLE',
  speed: 18,
  power: 15,
  shotLine: 14,
  pos: 'SF',
  paintBoost: 1,
  threePtBoost: 0,
  defBoost: 2,
  salary: 1520,
  chart: [
    { lo: 1, hi: 3, pts: 2, reb: 0, ast: 0 },
    { lo: 4, hi: 9, pts: 2, reb: 1, ast: 1 },
    { lo: 10, hi: 13, pts: 3, reb: 1, ast: 1 },
    { lo: 14, hi: 20, pts: 3, reb: 1, ast: 1 },
    { lo: 21, hi: 99, pts: 4, reb: 1, ast: 1 },
  ],
};

describe('card dimensions', () => {
  it('is fixed at the printed card size', () => {
    expect([CARD_WIDTH, CARD_HEIGHT]).toEqual([843, 1181]);
  });

  it('renders the root at exactly those pixel dimensions', () => {
    const html = render({ card: LEBRON_08_09 });
    expect(html).toContain('width:843px');
    expect(html).toContain('height:1181px');
  });
});

describe('rendering a fully-populated card', () => {
  const html = render({ card: LEBRON_08_09 });

  it('renders every stat the card carries', () => {
    expect(html).toContain('SPEED');
    expect(html).toContain('>18<');
    expect(html).toContain('POWER');
    expect(html).toContain('>15<');
    expect(html).toContain('LeBron James');
    expect(html).toContain('>SF<');
    expect(html).toContain('>1520<');
  });

  it('prints boosts with an explicit sign, including zero', () => {
    expect(html).toContain('>+1<'); // PAINT
    expect(html).toContain('>+0<'); // 3PT
    expect(html).toContain('>+2<'); // DEFENSE
  });

  it('renders one chart row per tier plus a header', () => {
    expect(rows(html)).toHaveLength(6);
    expect(html).toContain('ROLL');
    expect(html).toContain('PTS');
    expect(html).toContain('REB');
    expect(html).toContain('AST');
  });

  it('renders a real card from the shipped 306-card set without crashing', () => {
    const card = CARDS.find(c => c.id === 'Anthony_Edwards') ?? CARDS[0];
    const out = render({ card });
    expect(out).toContain(card.name);
    expect(rows(out).length).toBe(card.chart.length + 1);
  });
});

describe('the shot-line arrow', () => {
  // The arrow marks the LINE between the last roll that misses and the first
  // that makes, so it is carried by the row ABOVE that line and pinned to that
  // row's bottom edge. LeBron 08-09's Shot Line is 14, he misses on 1..13, and
  // 13 is the last roll of "10-13" — so the arrow belongs to "10-13", sitting
  // on the rule it shares with "14-20". Measured in the art at exactly that
  // rule; see findShotLineBoundary.
  it('is carried by the row above the miss/make line, not the row containing it', () => {
    const html = render({ card: LEBRON_08_09 });
    const body = rows(html);
    // body[0] is the header row; tiers start at index 1.
    const arrowRows = body
      .map((row, i) => (row.includes('shot-line-arrow') ? i : -1))
      .filter(i => i !== -1);

    expect(arrowRows).toEqual([3]); // exactly one arrow, on the "10-13" row
    expect(body[3]).toContain('10-13');
    expect(body[4]).toContain('14-20'); // the row on the other side of the line
  });

  it('sits on the row edge in CSS, not in the middle of the row', () => {
    // The markup alone cannot say WHERE in the row the glyph lands, and
    // "on the line" is the whole request. This is the half that lives in CSS.
    const arrow = cssBlock('.shotArrow');
    expect(arrow).toMatch(/bottom:\s*0/);
    expect(arrow).toMatch(/translateY\(50%\)/);
    expect(arrow).not.toMatch(/top:\s*50%/);
  });

  it('renders no arrow when the card has no shot line', () => {
    const { shotLine, ...noShotLine } = LEBRON_08_09;
    expect(render({ card: noShotLine })).not.toContain('shot-line-arrow');
  });

  it('renders no arrow when no tier contains the last miss', () => {
    expect(render({ card: { ...LEBRON_08_09, shotLine: 0 } })).not.toContain('shot-line-arrow');
  });

  it('renders no arrow when the line falls below the bottom of the table', () => {
    // Shot Line 22 puts the last miss (21) inside the open-ended top tier.
    // There is no rule under the last row — only the table frame — so there is
    // nowhere to draw it, and no arrow beats one hanging off the bottom.
    expect(render({ card: { ...LEBRON_08_09, shotLine: 22 } })).not.toContain('shot-line-arrow');
  });

  it('lands on the right rule for every card in the shipped 306-card set', () => {
    // Exhaustive rather than sampled: a shot line sitting exactly on a tier
    // boundary is the off-by-one case, and 306 cards is cheap to render. Every
    // card must get exactly one arrow, on the row holding `shotLine - 1`.
    const wrong = [];
    for (const card of CARDS) {
      const lastMiss = card.shotLine - 1;
      const row = card.chart.findIndex(t => lastMiss >= t.lo && lastMiss <= t.hi);
      const expected = row >= 0 && row < card.chart.length - 1 ? row : -1;
      const body = rows(render({ card })).slice(1); // drop the header row
      const actual = body.findIndex(r => r.includes('shot-line-arrow'));
      const arrowCount = body.filter(r => r.includes('shot-line-arrow')).length;
      if (actual !== expected || arrowCount !== (expected === -1 ? 0 : 1)) {
        wrong.push({ id: card.id, shotLine: card.shotLine, expected, actual, arrowCount });
      }
    }
    expect(wrong).toEqual([]);
  });

  it('agrees with the engine about which rolls miss', () => {
    // src/game/engine.js resolves `total >= shotLine`, so the last miss is
    // shotLine - 1 and the arrow's rule is the one directly below it. If that
    // comparison ever changes to `>`, this is the card-side half that has to
    // move with it.
    const engine = readFileSync(new URL('../game/engine.js', import.meta.url), 'utf8');
    expect(engine).toContain('const hit = total >= player.shotLine');
  });

  it('covers cards whose shot line sits exactly on a tier boundary', () => {
    // Guards the assertion above from silently becoming vacuous: on these the
    // "row containing shotLine" and "row containing shotLine - 1" readings
    // differ, which is exactly the distinction this change is about.
    const boundary = CARDS.filter(c => c.chart.some(t => t.lo === c.shotLine));
    expect(boundary.length).toBeGreaterThan(50);
  });
});

describe('degrading gracefully', () => {
  it('renders a bare { name, team } card without crashing', () => {
    const html = render({ card: { name: 'Zaccharie Risacher', team: 'ATL' } });
    expect(html).toContain('Zaccharie Risacher');
    expect(html).toContain('chart not generated');
    expect(html).toContain('—'); // speed / power / pos / salary / boosts
  });

  it('renders with no card at all', () => {
    expect(() => render({})).not.toThrow();
  });

  it('renders a card whose team is a Basketball-Reference trade aggregate', () => {
    // 45 pool players still carry "2TM"; getTeam falls back to a neutral theme.
    expect(() => render({ card: { name: 'James Harden', team: '2TM' } })).not.toThrow();
  });

  it('renders an empty chart array as the placeholder row', () => {
    const html = render({ card: { name: 'X', team: 'ATL', chart: [] } });
    expect(html).toContain('chart not generated');
  });
});

describe('team theming', () => {
  it('sets the team custom properties on the root', () => {
    const html = render({ card: LEBRON_08_09 });
    expect(html).toContain('--team-primary:#6F263D'); // Cavaliers Wine (official)
    expect(html).toContain('--team-secondary:#B9975B'); // Cavaliers Gold (official)
  });

  it('applies a studio override so a color change re-themes the card', () => {
    const html = render({
      card: LEBRON_08_09,
      teamOverrides: { CLE: { primary: '#FF0000' } },
    });
    expect(html).toContain('--team-primary:#FF0000');
    expect(html).toContain('--team-secondary:#B9975B'); // untouched
  });

  it('computes --team-accent when no override names one', () => {
    // Cavaliers Gold #B9975B is the brighter of the pair and readable on navy.
    expect(render({ card: LEBRON_08_09 })).toContain('--team-accent:#B9975B');
  });

  it('lets a studio override choose --team-accent outright', () => {
    // THE DENVER CASE, in the only place it finally matters: the accent is
    // derived, so editing primary/secondary cannot always produce the color
    // the user wants. This is the path that puts Nuggets gold on the card.
    const html = render({
      card: LEBRON_08_09,
      teamOverrides: { CLE: { accent: '#FEC524' } },
    });
    expect(html).toContain('--team-accent:#FEC524');
    // The brand colors themselves are untouched — only the tinted text moves.
    expect(html).toContain('--team-primary:#6F263D');
    expect(html).toContain('--team-secondary:#B9975B');
  });

  it('goes back to the computed accent when the override is removed', () => {
    // Reset removes the key rather than freezing today's value into it.
    expect(render({ card: LEBRON_08_09, teamOverrides: {} })).toContain('--team-accent:#B9975B');
  });

  it('still recomputes the accent from an overridden pair', () => {
    const html = render({
      card: LEBRON_08_09,
      teamOverrides: { CLE: { secondary: '#FFFFFF' } },
    });
    expect(html).toContain('--team-accent:#FFFFFF');
  });
});

describe('the field is the team primary', () => {
  it('paints the card in the team color rather than a fixed navy', () => {
    // The whole point of the change: a Bulls card is red, not navy with red
    // trim. --field is what .card's background reads.
    expect(render({ card: LEBRON_08_09 })).toContain('--field:#6F263D');
    const bulls = render({ card: { name: 'X', team: 'CHI' } });
    expect(bulls).toContain('--field:#BA0C2F');
  });

  it('follows a primary override, field and all', () => {
    const html = render({
      card: LEBRON_08_09,
      teamOverrides: { CLE: { primary: '#FFC72C' } },
    });
    expect(html).toContain('--field:#FFC72C');
    // ...and flips to dark ink for it, rather than leaving white on gold.
    expect(html).not.toContain('--field-ink:#FFFFFF');
  });

  it('uses the light ink on every stock team', () => {
    for (const abbr of Object.keys(TEAMS)) {
      expect(render({ card: { name: 'X', team: abbr } }), abbr)
        .toContain('--field-ink:#FFFFFF');
    }
  });

  it('sets every custom property the stylesheet reads', () => {
    // The failure this exists for is silent: a var(--typo) in the CSS simply
    // paints nothing, and the card renders looking almost right. Cross-check
    // the stylesheet's own var() calls against what the component sets.
    const css = readFileSync(new URL('./CardTemplate.module.css', import.meta.url), 'utf8');
    const used = new Set(Array.from(css.matchAll(/var\((--[a-z0-9-]+)\)/g), m => m[1]));
    expect(used.size).toBeGreaterThan(10);
    const html = render({ card: LEBRON_08_09 });
    for (const name of used) expect(html, name).toContain(`${name}:`);
  });
});

describe('the sidebar scrim', () => {
  // The translucent bar down the right of the printed cards. Its TONE is
  // fieldTheme's problem and is tested there; what has to hold here is where it
  // sits in the stack, because everything the bar is for depends on that.

  it('paints after the photo and before the sidebar', () => {
    // Not cosmetic ordering — it is the whole mechanism. One step earlier and
    // the photo covers the bar; one step later and the bar veils the logo and
    // the boosts it is supposed to be making legible. These three elements are
    // all position:absolute at z-index auto, so document order IS paint order.
    const html = render({ card: LEBRON_08_09 });
    const photo = html.indexOf('_photoOuter');
    const scrim = html.indexOf('_sidebarScrim');
    const sidebar = html.search(/_sidebar_/);
    expect(photo).toBeGreaterThan(-1);
    expect(scrim).toBeGreaterThan(photo);
    expect(sidebar).toBeGreaterThan(scrim);
  });

  it('keeps the chevron and the card frame above it', () => {
    // The chevron is DOM-earlier than the scrim, so it needs a z-index to stay
    // on top — the printed cards draw its dots at full strength inside the bar,
    // and without the lift there is a seam across them where the bar's top edge
    // crosses. Raising the chevron then has to be answered by raising ::after,
    // which is only "last" while nothing else has climbed above auto.
    const css = readFileSync(new URL('./CardTemplate.module.css', import.meta.url), 'utf8');
    const zIndexIn = selector => {
      const block = css.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`, 's'));
      const z = block?.[0].match(/z-index:\s*(-?\d+)/);
      return z ? Number(z[1]) : 0;
    };
    expect(zIndexIn('.sidebarScrim')).toBe(0);
    expect(zIndexIn('.chevronTop')).toBeGreaterThan(zIndexIn('.sidebarScrim'));
    expect(zIndexIn('.card::after')).toBeGreaterThan(zIndexIn('.chevronTop'));
  });

  it('is drawn from the derived scrim, never a hardcoded wash', () => {
    // The failure mode this guards is a plausible-looking rgba(255,255,255,.08)
    // that reads on a dark field and vanishes on OKC's #0072CE.
    const css = readFileSync(new URL('./CardTemplate.module.css', import.meta.url), 'utf8');
    const block = css.match(/\.sidebarScrim\s*\{[^}]*\}/s)[0];
    expect(block).toContain('var(--field-scrim)');
    expect(block).not.toMatch(/rgba?\(/);
  });

  it('runs corner to corner down the right edge and stops at the frame', () => {
    // The art settles the bar's LEFT edge and nothing else — 814..843 is bare
    // field on both reference cards, and a field-toned scrim leaves no trace on
    // the field. So where the other three edges go is a design call, and the
    // call overrides the art: the bar fills the card's right-hand column from
    // corner to corner. It used to start at the art's y=33 and stop at the photo
    // window's x=828, which left an L of unveiled band across the top corner,
    // and it used to end at the sidebar's own bottom edge (1152), which left a
    // 22px step of bare field in the bottom one. A scrim is a tone rather than
    // an outline, so that step read as a seam across the column, not an edge.
    const block = cssBlock('.sidebarScrim');
    // Read the frame's width off .card::after rather than pinning 7 four times
    // — the whole claim is "as far as the frame", not "as far as 7px".
    const frame = Number(
      cssBlock('.card::after').match(/box-shadow:\s*inset 0 0 0 (\d+)px/)[1],
    );
    expect(pxIn(block, 'top')).toBe(frame);
    expect(pxIn(block, 'left') + pxIn(block, 'width')).toBe(CARD_WIDTH - frame);
    expect(pxIn(block, 'top') + pxIn(block, 'height')).toBe(CARD_HEIGHT - frame);
  });

  it('never reaches the bottom chevron, which is on the far side', () => {
    // The top chevron had to be lifted over the bar and trimmed to its column
    // so the two would meet flush. That question does not arise at the bottom:
    // the ornaments are a top-RIGHT / bottom-LEFT pair, so the bar's column and
    // .chevronBottom are on opposite sides of the card and cannot seam. Asserted
    // rather than assumed, because "do the same at the bottom" is the obvious
    // next edit and this is the reason it is not made.
    const barLeft = pxIn(cssBlock('.sidebarScrim'), 'left');
    // .chevronBottom names itself twice — once in the ornaments' shared rule and
    // once in its own — and cssBlock() returns the first of those. The one with
    // the geometry in it is the second.
    const chevron = CARD_CSS.match(/\.chevronBottom\s*\{[^}]*left:[^}]*\}/s)[0];
    expect(pxIn(chevron, 'left') + pxIn(chevron, 'width')).toBeLessThan(barLeft);
  });

  it('gives the chevron exactly the bar’s column, so the two meet flush', () => {
    // The chevron used to be 152px at right:26px — 665..817 — which straddled
    // the bar's left edge: the bar cut a hard vertical line down the middle of
    // the dot field and left the ornament's left arm outside it on bare field.
    // Trimming the chevron to the bar's own column is what makes them flush,
    // and it has to STAY the bar's column, so assert the two against each other
    // rather than against 701 and 836.
    const scrim = cssBlock('.sidebarScrim');
    const chevron = cssBlock('.chevronTop');
    const left = pxIn(scrim, 'left');
    const right = left + pxIn(scrim, 'width');
    expect(CARD_WIDTH - pxIn(chevron, 'right')).toBe(right);
    expect(CARD_WIDTH - pxIn(chevron, 'right') - pxIn(chevron, 'width')).toBe(left);
  });

  it('phases the chevron’s dots so that column clips none of them', () => {
    // The seam this exists for is small and specific. The dots are a tiled
    // background, so an edge of the chevron's box that lands mid-dot paints the
    // sliver of it that falls inside — and at the right-hand edge that is a row
    // of clipped crescents pressed up against the frame. The bar's column is
    // 135px, which is not a whole number of 13px tiles, so the phase has to be
    // chosen rather than left at 0; at 0 a dot centre lands 1.5px past the right
    // edge and the crescents appear.
    const shared = cssBlock(/\.chevronTop,\s*\.chevronBottom/);
    const pitch = Number(shared.match(/background-size:\s*([\d.]+)px/)[1]);
    // The dot fades out at `transparent <r>px` — that r is its painted radius.
    const radius = Number(shared.match(/transparent\s+([\d.]+)px/)[1]);
    const chevron = cssBlock('.chevronTop');
    const width = pxIn(chevron, 'width');
    const phase = pxIn(chevron, 'background-position') ?? 0;

    // Dot centres relative to the box's left edge, one tile either side so the
    // dots that live just OUTSIDE the box are checked too — those are the ones
    // that bleed back in.
    for (let c = phase + pitch / 2 - pitch; c < width + pitch; c += pitch) {
      expect(Math.abs(c - 0), `dot at ${c} vs left edge`).toBeGreaterThanOrEqual(radius);
      expect(Math.abs(c - width), `dot at ${c} vs right edge`).toBeGreaterThanOrEqual(radius);
    }
  });
});

describe('the sidebar', () => {
  // The bar stopped being a wash behind the sidebar and became an element, so
  // the sidebar's job is now to sit ON it. Everything here is about that.

  it('takes the bar’s exact column, which is what centres it', () => {
    // The box used to be left:658 width:185 — centred on 750.5, 18px left of the
    // bar's own centreline at 768.5. Nothing inside the sidebar was wrong: every
    // line was centred, just centred on the wrong column, which put DEFENSE
    // three pixels outside the bar's left edge and left 33px of bar empty on the
    // right. Assert against the scrim rather than against 701 and 135 so the two
    // cannot drift apart.
    const scrim = cssBlock('.sidebarScrim');
    const sidebar = cssBlock('.sidebar');
    expect(pxIn(sidebar, 'left')).toBe(pxIn(scrim, 'left'));
    expect(pxIn(sidebar, 'width')).toBe(pxIn(scrim, 'width'));
    expect(sidebar).toMatch(/text-align:\s*center/);
    expect(sidebar).toMatch(/align-items:\s*center/);
  });

  it('gives the logo the bar’s width and the column’s spare height', () => {
    // The slot was a 74px square, which sized every mark by its longest side and
    // wasted the bar's width on all 29 of the 31 logo files that are not square.
    // Its two bounds now come from two different places, and both have to hold:
    // the width from the bar, the height from what the fixed rows below it leave.
    const logo = cssBlock('.logo');
    const sidebar = cssBlock('.sidebar');
    expect(pxIn(logo, 'width')).toBeGreaterThan(74);
    expect(pxIn(logo, 'width')).toBeLessThanOrEqual(pxIn(cssBlock('.sidebarScrim'), 'width'));
    expect(logo).toMatch(/object-fit:\s*contain/);

    // The rows below the logo are fixed type at a fixed gap, so the height that
    // is left for it is arithmetic — done here from the stylesheet rather than
    // pinned at 96, so that raising a font size or the gap fails HERE instead of
    // silently pushing the logo out through the top of the sidebar.
    const lineHeight = Number(cssBlock('.card').match(/line-height:\s*([\d.]+)/)[1]);
    const line = block => pxIn(block, 'font-size') * lineHeight;
    const rows =
      line(cssBlock('.pos')) +
      4 * (line(cssBlock('.boostLabel')) + line(cssBlock('.boostValue')));
    const gaps = 5 * pxIn(sidebar, 'gap');
    expect(pxIn(logo, 'height') + rows + gaps).toBeLessThanOrEqual(pxIn(sidebar, 'height'));
  });

  it('keeps the lettered fallback square, so it stays a circle', () => {
    // .logo and .logoFallback shared one rule while the slot was square. They
    // cannot now: the fallback is DRAWN by its rule rather than fitted from a
    // file, and border-radius:50% on a 115x96 box is an ellipse.
    const fallback = cssBlock('.logoFallback');
    expect(pxIn(fallback, 'width')).toBe(pxIn(fallback, 'height'));
    expect(fallback).toMatch(/border-radius:\s*50%/);
    // Same height as the real slot, so the column does not shift between a card
    // with a logo file and one without.
    expect(pxIn(fallback, 'height')).toBe(pxIn(cssBlock('.logo'), 'height'));
  });
});

describe('team logo', () => {
  it('resolves the logo path against the app base path', () => {
    // TEAMS stores '/logos/CLE.png', but the app is served under a base path
    // and public/ assets live beneath it. The bare path 404s — and because the
    // <img> then falls back to the lettered circle, every card LOOKED fine
    // while the present-a-logo path was broken for all 30 teams.
    const base = String(import.meta.env.BASE_URL).replace(/\/+$/, '');
    expect(logoSrc('/logos/CLE.png')).toBe(`${base}/logos/CLE.png`);
    // Never a doubled slash, whether or not the base carries a trailing one.
    expect(logoSrc('/logos/CLE.png')).not.toMatch(/[^:]\/\//);
  });

  it('renders the resolved src, not the raw table path', () => {
    const html = render({ card: LEBRON_08_09 });
    expect(html).toContain(`src="${logoSrc('/logos/CLE.png')}"`);
  });

  it('has no logo url for a team with no logo path', () => {
    expect(logoSrc(null)).toBeNull();
    expect(logoSrc(undefined)).toBeNull();
  });

  it('falls back to the team abbreviation for an unknown team', () => {
    // getTeam('2TM').logo is null, so the <img> is never rendered at all and
    // the lettered circle stands in — deliberate, not a broken-image glyph.
    // The league mark is still there, so this checks for TEAM logo files only.
    const html = render({ card: { name: 'X', team: '2TM' } });
    expect(html).not.toMatch(/\/logos\/(?!NBA\.png)/);
    expect(html).toContain('2TM');
  });
});

describe('league mark', () => {
  it('renders the real NBA logo file, base-path resolved', () => {
    // Was a hand-drawn badge; the printed art uses the actual mark. Same
    // logoSrc() as the team logos, so it cannot drift from the base path.
    const html = render({ card: LEBRON_08_09 });
    expect(html).toContain(`src="${logoSrc(LEAGUE_LOGO)}"`);
    expect(LEAGUE_LOGO).toBe('/logos/NBA.png');
  });

  it('is present on a card with no team at all', () => {
    // It is the LEAGUE's mark — it does not depend on team resolution.
    const html = render({ card: { name: 'X' } });
    expect(html).toContain(`src="${logoSrc(LEAGUE_LOGO)}"`);
  });
});

describe('formatRollRange', () => {
  it('formats a closed range', () => {
    expect(formatRollRange({ lo: 4, hi: 9 })).toBe('4-9');
  });
  it('formats the open-ended top tier as "lo+"', () => {
    expect(formatRollRange({ lo: 21, hi: 99 })).toBe('21+');
  });
  it('formats a single-value tier as just the number', () => {
    expect(formatRollRange({ lo: 7, hi: 7 })).toBe('7');
  });
  it('formats a missing tier as a dash', () => {
    expect(formatRollRange(undefined)).toBe('—');
  });
});

describe('findShotLineBoundary', () => {
  const chart = LEBRON_08_09.chart; // 1-3 | 4-9 | 10-13 | 14-20 | 21+
  it('returns the row ABOVE the miss/make line', () => {
    expect(findShotLineBoundary(chart, 14)).toBe(2); // last miss 13, in "10-13"
    expect(findShotLineBoundary(chart, 10)).toBe(1); // last miss  9, in "4-9"
    expect(findShotLineBoundary(chart, 4)).toBe(0); //  last miss  3, in "1-3"
  });
  it('follows the line, not the row containing it', () => {
    // Shot Line 15 sits INSIDE "14-20", but so does the last miss (14), so the
    // rule is the one above that row — the same rule Shot Line 14 gets. The old
    // containing-tier reading returned 3 for both, one row too low.
    expect(findShotLineBoundary(chart, 15)).toBe(3);
    expect(findShotLineBoundary(chart, 20)).toBe(3);
  });
  it('returns -1 rather than defaulting to row 0', () => {
    expect(findShotLineBoundary(chart, undefined)).toBe(-1);
    expect(findShotLineBoundary(chart, null)).toBe(-1);
    expect(findShotLineBoundary(undefined, 14)).toBe(-1);
    expect(findShotLineBoundary([], 14)).toBe(-1);
  });
  it('returns -1 when there is no rule for it to sit on', () => {
    expect(findShotLineBoundary(chart, 22)).toBe(-1); // last miss below the table
    expect(findShotLineBoundary(chart, 1)).toBe(-1); //  nothing misses at all
  });
});

// pickAccent and resolveAccent moved to teams.js and are tested there, beside
// the table they read. What stays this file's business is that the card puts
// the resolved value on --team-accent — see the team theming block above.

describe('visibleTiers — the blank natural-1 tier is not printed', () => {
  /** What the generator emits: a one-roll blank tier under the real chart. */
  const generated = [
    { lo: 1, hi: 1, pts: 0, reb: 0, ast: 0 },
    { lo: 2, hi: 3, pts: 0, reb: 1, ast: 1 },
    { lo: 4, hi: 19, pts: 3, reb: 1, ast: 1 },
    { lo: 20, hi: 99, pts: 5, reb: 2, ast: 2 },
  ];

  it('drops the structural blank tier so the printed chart starts at roll 2', () => {
    const shown = visibleTiers(generated);
    expect(shown).toHaveLength(3);
    expect(shown[0]).toMatchObject({ lo: 2, hi: 3 });
  });

  it('KEEPS a real bottom band that happens to sit at roll 1', () => {
    // The regression this exists to prevent. The shipped 2025-26 set renders
    // through this same component and its bottom tier is a genuine 3-roll band
    // that often scores — LeBron's "1-3: 2,0,0". Hiding row 0 by POSITION
    // would silently delete a scoring row from all 306 of those cards.
    expect(visibleTiers(LEBRON_08_09.chart)).toEqual(LEBRON_08_09.chart);
  });

  it('keeps an all-zero bottom band that is wider than one roll', () => {
    // 168 of the shipped cards have a 0/0/0 bottom tier, and none of them is
    // one roll wide. "Blank" is not enough to hide a row; it has to be the
    // one-roll structural tier.
    const chart = [{ lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 }, { lo: 4, hi: 99, pts: 2, reb: 1, ast: 0 }];
    expect(visibleTiers(chart)).toEqual(chart);
  });

  it('never prints an empty chart, even if the blank tier is all there is', () => {
    const only = [{ lo: 1, hi: 1, pts: 0, reb: 0, ast: 0 }];
    expect(visibleTiers(only)).toEqual(only);
  });

  it('degrades to an empty list rather than throwing', () => {
    expect(visibleTiers(undefined)).toEqual([]);
    expect(visibleTiers(null)).toEqual([]);
    expect(visibleTiers([])).toEqual([]);
  });

  it('renders one row per VISIBLE tier plus the header', () => {
    const html = render({ card: { ...LEBRON_08_09, chart: generated } });
    expect(rows(html)).toHaveLength(4); // 3 printed tiers + header
    expect(html).not.toContain('>1-1<');
  });

  it('puts the arrow on the right printed row with the blank tier hidden', () => {
    // THE off-by-one this guards. findShotLineBoundary indexes whatever array
    // it is handed; hand it the full chart while rendering the visible one and
    // every arrow sits exactly one row too low — and still looks plausible.
    // Shot line 5 misses on 1..4, and 4 is the first roll of "4-19", so the
    // arrow rides that row's bottom edge — the SECOND printed row (index 1).
    const card = { ...LEBRON_08_09, chart: generated, shotLine: 5 };
    expect(findShotLineBoundary(visibleTiers(generated), 5)).toBe(1);
    const printed = rows(render({ card })).slice(1); // drop the header row
    const withArrow = printed.findIndex(r => r.includes('shot-line-arrow'));
    expect(withArrow).toBe(1);
    expect(printed[withArrow]).toContain('4-19');
  });

  it('still resolves a natural 1 in the DATA, which is why the tier stays there', () => {
    // Hidden from the chart, present for the game: rolling a 1 has to find a
    // tier or the card cannot be resolved at all.
    const forRoll1 = generated.find(t => 1 >= t.lo && 1 <= t.hi);
    expect(forRoll1).toMatchObject({ lo: 1, hi: 1, pts: 0, reb: 0, ast: 0 });
    expect(generated.indexOf(forRoll1)).toBe(0);
  });
});

describe('the chart clears the photo frame', () => {
  // WHY THIS IS ARITHMETIC AND NOT A SCREENSHOT. Both elements are absolutely
  // positioned in the same fixed 843x1181 field, and the chart is
  // BOTTOM-anchored, so it grows upward as tiers are added. Its top edge is a
  // function of the row count — which stopped being a constant when the band
  // merge landed. Nothing in CSS notices when those two numbers cross.

  const chart = cssBlock('.chart');
  const cell = cssBlock(/\.chart th,\s*\.chart td/);
  const outer = cssBlock('.photoOuter');

  const CHART_BOTTOM = pxIn(chart, 'bottom');
  const CELL_H = pxIn(cell, 'height');
  const CHART_BORDER = Number(chart.match(/border:\s*(\d+)px/)[1]);
  /** Six tiers is the generator's cap; one is the blank tier, which is hidden. */
  const MAX_PRINTED_ROWS = 5;

  /** The chart's top edge, in card pixels, for N printed tiers. */
  const chartTop = n => CARD_HEIGHT - CHART_BOTTOM - (n + 1) * CELL_H - CHART_BORDER;

  /**
   * The photo frame's PAINTED bottom — the lowest vertex of its clip-path, not
   * the bottom of its layout box. The box has always ended below the chart;
   * what changed is the clip, and the clip is what is on screen.
   */
  const paintedBottom = () => {
    const top = pxIn(outer, 'top');
    const poly = outer.match(/clip-path:\s*polygon\(([^)]*)\)/)[1];
    const vertexYs = poly.split(',').map(pair => {
      const [, y] = pair.trim().split(/\s+/);
      return y.endsWith('%') ? (parseFloat(y) / 100) * pxIn(outer, 'height') : parseFloat(y);
    });
    return top + Math.max(...vertexYs);
  };

  it('reads the geometry out of the stylesheet, not out of this test', () => {
    expect(CHART_BOTTOM).toBe(21);
    expect(CELL_H).toBe(41);
    expect(CHART_BORDER).toBe(3);
  });

  it('leaves the photo above the TALLEST chart the generator can produce', () => {
    // The tallest case is the only one that can fail: the chart grows upward,
    // so every shorter chart clears by more. Measured in the browser at this
    // exact geometry: photo painted bottom y=900, chart top y=911.
    expect(paintedBottom()).toBe(900);
    expect(chartTop(MAX_PRINTED_ROWS)).toBe(911);
    expect(paintedBottom()).toBeLessThan(chartTop(MAX_PRINTED_ROWS));
  });

  it('clears by at least the gap the printed reference art leaves', () => {
    // The art's photo boundary clears its chart's top border by a minimum of
    // 8px. A positive gap is not enough on its own — 1px would technically
    // pass and would read as a collision.
    expect(chartTop(MAX_PRINTED_ROWS) - paintedBottom()).toBeGreaterThanOrEqual(8);
  });

  it('clears at the SHORTEST chart too, which simply has further to fall', () => {
    for (const n of [2, 3, 4, 5]) {
      expect(paintedBottom(), `${n} printed rows`).toBeLessThan(chartTop(n));
    }
  });

  it('fails loudly if a sixth printed row is ever added', () => {
    // Not a prediction — a tripwire. Six printed rows (seven chart tiers) puts
    // the chart's top edge at y=870, back through the photo, and this is the
    // only place that arithmetic is written down.
    expect(chartTop(MAX_PRINTED_ROWS + 1)).toBeLessThan(paintedBottom());
  });

  it('agrees with every chart in the committed 2026-27 set', () => {
    // Closes the loop: the stylesheet is safe for MAX_PRINTED_ROWS, and no
    // card actually asks for more than that.
    const printed = POOL_PLAYERS.map(p => visibleTiers(p.chart).length);
    const worst = Math.max(...printed);
    // A floor, not the exact size: the pool grows whenever a name is added to
    // card-data/force-include-2026.json, and this test is about chart heights,
    // not about how many players there are. src/studio/players.test.js owns the
    // count.
    expect(printed.length).toBeGreaterThan(300);
    expect(worst).toBe(MAX_PRINTED_ROWS); // non-vacuous: the cap is reached
    expect(Math.min(...printed)).toBeGreaterThanOrEqual(2);
    for (const n of printed) expect(paintedBottom()).toBeLessThan(chartTop(n));
  });
});

describe('nameFontSize', () => {
  // Tomorrow's measured metrics: cap height 0.74em, average uppercase advance
  // ~0.70em. Used here to check the OUTPUT against the printed art in pixels,
  // which is the only thing that actually matters.
  const CAP_RATIO = 0.74;
  const ADVANCE_RATIO = 0.7;
  const capHeight = name => nameFontSize(name) * CAP_RATIO;
  const inkLength = (name, advance = ADVANCE_RATIO) => nameFontSize(name) * advance * name.length;
  const within = (actual, target, pct) => Math.abs(actual - target) / target <= pct;

  it('caps at the display size for short names', () => {
    expect(nameFontSize('LeBron James')).toBe(96);
  });

  it('reproduces the printed reference cards', () => {
    // Measured by bounding box off the art itself, and by canvas TextMetrics
    // off the loaded Tomorrow face at weight 700 for the per-string advance:
    //
    //   08_09_LeBron_James.png  "LeBron James"     71px cap, 772px long, 0.6797em/char
    //   Anthony_Edwards.png     "Anthony Edwards"  62px cap, 872px long, 0.7099em/char
    //
    // One rule has to serve every name in the pool, so neither card is reproduced
    // exactly — but both land close, and that is what the constants in
    // nameFontSize are FOR. Tidy them to rounder numbers and the new cards
    // stop matching the set they are joining.
    expect(within(capHeight('LeBron James'), 71, 0.02), 'LeBron cap').toBe(true);
    expect(within(inkLength('LeBron James', 0.6797), 772, 0.04), 'LeBron length').toBe(true);
    expect(within(capHeight('Anthony Edwards'), 62, 0.02), 'Edwards cap').toBe(true);
    expect(within(inkLength('Anthony Edwards', 0.7099), 872, 0.04), 'Edwards length').toBe(true);
  });

  it('shrinks long names so they fit the card height', () => {
    const long = nameFontSize('Shai Gilgeous-Alexander');
    expect(long).toBeLessThan(96);
    expect(long).toBeGreaterThan(30);
  });

  it('never returns NaN for a missing name', () => {
    expect(Number.isFinite(nameFontSize(undefined))).toBe(true);
  });

  it('keeps every name in the shipped set inside the name slot', () => {
    // 900px is .nameSlot's height in CardTemplate.module.css. A name longer
    // than its slot is a name painted over the top of the card.
    for (const card of CARDS) {
      expect(inkLength(card.name), card.name).toBeLessThanOrEqual(900);
    }
  });

  it('keeps every name in the 2026 pool inside the name slot', () => {
    // The set actually being built, including its longest entries
    // ("Nickeil Alexander-Walker", "Kentavious Caldwell-Pope", 24 chars).
    for (const p of POOL_PLAYERS) {
      expect(inkLength(p.name), p.name).toBeLessThanOrEqual(900);
    }
  });
});
