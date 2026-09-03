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
  AwardMark,
  assetCandidates,
  CARD_WIDTH,
  CARD_HEIGHT,
  formatRollRange,
  findShotLineBoundary,
  nameFontSize,
  logoSrc,
  leagueMarkFallbackClass,
  LEAGUE_LOGO,
  LEAGUE_LOGOS,
  visibleTiers,
} from './CardTemplate.jsx';
// Every use of CARDS in this file means the FINISHED 2025-26 reference set —
// the printed cards whose rendering these tests pin — so it stays on the
// frozen shipped module while the playable set moves with the pipeline.
import { SHIPPED_CARDS as CARDS } from '../game/shippedCards.js';
import {
  TEAMS,
  HISTORICAL_TEAMS,
  WNBA_TEAMS,
  WNBA_HISTORICAL_TEAMS,
  resolveAccent,
} from './teams.js';
import { deriveFieldTheme } from './fieldTheme.js';
import { GOLD, applyTreatment } from './treatments.js';
import {
  BADGES,
  BEST_SEASON_BADGE,
  ROOKIE_BADGE,
  SUPER_SEASON_BADGE,
  SUPER_SEASON_MIN_SALARY,
  badgeColors,
  badgeLabels,
  getBadge,
} from './badges.js';
import {
  CURRENT_SET,
  FINISHED_SET,
  IMAGE_EXTENSIONS,
  ROOKIE_SET,
  SETS,
  SET_IDS,
  SUPER_SEASON_SET,
  SUMMER_STANDOUTS_SET,
  WNBA_SET,
  WNBA_ROOKIE_SET,
  WNBA_SUPER_SEASON_SET,
  photoUrlPath,
  setLeague,
  showsSeason,
} from './sets.js';
import { AWARD_CODES, MAX_CARD_AWARDS, awardImagePath, getAward } from './awards.js';
import { AWARDS_FILE, BADGE_FILE, POOL_PLAYERS, SOURCES } from '../studio/players.js';

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

  it('starts flush with the left border of the chart box, not inside the column', () => {
    // "it should be flush with the left side of the box, blending in with the
    // border". The cell's padding box begins one collapsed border inside the
    // table, so the offset has to be exactly minus that border's width.
    const arrow = cssBlock('.shotArrow');
    const border = Number(cssBlock('.chart').match(/border:\s*(\d+)px/)[1]);
    const left = Number(arrow.match(/left:\s*(-?\d+)px/)[1]);
    expect(left).toBe(-border);
  });

  it('is painted above the row below, which used to slice it in half', () => {
    // Every .rollCell is positioned, so the cells paint in tree order and the
    // make row's background covered the half of the triangle hanging into it.
    // The glyph is raised; the card's frame stays above it, which is what
    // .card::after's z-index 2 is for.
    const arrowZ = Number(cssBlock('.shotArrow').match(/z-index:\s*(\d+)/)[1]);
    const frameZ = Number(cssBlock('.card::after').match(/z-index:\s*(\d+)/)[1]);
    expect(arrowZ).toBeGreaterThan(0);
    expect(frameZ).toBeGreaterThan(arrowZ);
    // ...and raising the CELL would lift all five equally and fix nothing.
    expect(cssBlock('.rollCell')).not.toMatch(/z-index/);
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

    // Every row in the column is fixed type at a fixed gap, so the height the
    // logo may have is arithmetic — done here from the stylesheet rather than
    // pinned at 96, so that raising a font size or the gap fails HERE instead of
    // silently pushing the logo out through the top of the sidebar.
    //
    // The TALLEST case, which is a Super Season card of a season that carried
    // hardware: the award row, the badge and the season are three extra rows
    // and three extra gaps. Nikola Jokić's 2021-22 draws all three; a base-set
    // card with neither an award nor a badge stacks the same content 136px
    // lower in the same box.
    const lineHeight = Number(cssBlock('.card').match(/line-height:\s*([\d.]+)/)[1]);
    const line = block => pxIn(block, 'font-size') * lineHeight;
    const badge = cssBlock('.badge');
    const rows =
      pxIn(cssBlock('.awardFallback'), 'height') +
      line(badge) + 2 * pxIn(badge, 'padding') +
      line(cssBlock('.season')) +
      line(cssBlock('.pos')) +
      4 * (line(cssBlock('.boostLabel')) + line(cssBlock('.boostValue')));
    const gaps = 8 * pxIn(sidebar, 'gap');
    expect(pxIn(logo, 'height') + rows + gaps).toBeLessThanOrEqual(pxIn(sidebar, 'height'));
  });

  it('keeps its bottom edge where the printed art puts the last row', () => {
    // The box grew UPWARD to make room for the badge and the season, and that
    // is the only direction it may grow: everything in the column is measured
    // off the art by its bottom, and a box that grew downward would move the
    // salary row off it on all four sets at once.
    const sidebar = cssBlock('.sidebar');
    expect(pxIn(sidebar, 'top') + pxIn(sidebar, 'height')).toBe(1152);
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

// ── THE FORMAT PROBE ────────────────────────────────────────────────────────
//
// The user's question, and it was a fair one: "Can we really only do pngs? I
// thought we changed things to be able to use other formats." Player photos had
// been fixed; logos and award marks had not, because their paths are spelled in
// DATA and logoSrc passes the spelling through. assetCandidates is the fix, and
// the half of it that a test can hold is which URLs get tried and in what
// order — the walk itself needs a real failed fetch, which static markup cannot
// produce (the same limit leagueMarkFallbackClass and AwardMark live with).
describe('resolving an asset in whatever format it was saved', () => {
  it('tries the DECLARED path first, always', () => {
    // The property that makes this free for the 60-odd files already on disk:
    // every team mark is a .png and the table says .png, so the common case is
    // one request and no 404s at all.
    expect(assetCandidates('/logos/CLE.png')[0]).toBe('/logos/CLE.png');
    expect(assetCandidates('/awards/MVP.png')[0]).toBe('/awards/MVP.png');
    for (const team of Object.values({ ...TEAMS, ...WNBA_TEAMS })) {
      if (!team.logo) continue;
      expect(assetCandidates(team.logo)[0], team.name).toBe(team.logo);
    }
    for (const code of AWARD_CODES) {
      expect(assetCandidates(awardImagePath(code))[0], code).toBe(awardImagePath(code));
    }
  });

  it('then offers the same stem under every format this build accepts', () => {
    const candidates = assetCandidates('/awards/AS.png');
    // Every accepted extension is reachable, exactly once, on the right stem.
    expect(candidates).toHaveLength(IMAGE_EXTENSIONS.length);
    expect(new Set(candidates).size).toBe(candidates.length);
    for (const ext of IMAGE_EXTENSIONS) expect(candidates, ext).toContain(`/awards/AS${ext}`);
    // The user's own award files are in four different formats. Each of them is
    // a URL this will actually ask for.
    for (const ext of ['.avif', '.webp', '.jpg', '.jfif']) {
      expect(candidates, ext).toContain(`/awards/AS${ext}`);
    }
  });

  it('keeps a declared extension the list does not carry, rather than dropping it', () => {
    // public/logos/WNBA/HOU.gif — the Houston Comets' wordmark, the one non-PNG
    // in the logo directories and the reason "declared first" is a rule and not
    // an optimisation. .gif is not on IMAGE_EXTENSIONS, so if the declared path
    // were merely one candidate among the six it would never be requested and a
    // mark that works today would stop working.
    const candidates = assetCandidates('/logos/WNBA/HOU.gif');
    expect(candidates[0]).toBe('/logos/WNBA/HOU.gif');
    expect(candidates).toHaveLength(IMAGE_EXTENSIONS.length + 1);
    expect(WNBA_HISTORICAL_TEAMS.HOU.logo).toBe('/logos/WNBA/HOU.gif');
  });

  it('does not offer the declared extension twice, whatever its case', () => {
    expect(assetCandidates('/logos/CLE.PNG')).toHaveLength(IMAGE_EXTENSIONS.length);
    expect(assetCandidates('/logos/CLE.PNG')[0]).toBe('/logos/CLE.PNG');
    // The retries are lowercase, because that is how the files are named.
    expect(assetCandidates('/logos/CLE.PNG').slice(1)).not.toContain('/logos/CLE.PNG');
  });

  it('has nothing to vary for a path with no extension, and says so', () => {
    // Guessing six extensions onto a stem that never had one would be six 404s
    // for a path no data in this repo produces.
    expect(assetCandidates('/logos/CLE')).toEqual(['/logos/CLE']);
    // A dot in a DIRECTORY name is not an extension.
    expect(assetCandidates('/logos/v1.2/CLE')).toEqual(['/logos/v1.2/CLE']);
  });

  it('answers nothing for nothing, so a team with no logo asks for no file', () => {
    for (const empty of [null, undefined, '', 0, {}, []]) {
      expect(assetCandidates(empty), JSON.stringify(empty)).toEqual([]);
    }
  });

  it('stays bare and root-relative, so logoSrc still owns the base path', () => {
    // Doing the base path here as well would double it. Same contract the raw
    // table paths keep.
    for (const path of assetCandidates('/awards/MVP.png')) {
      expect(path.startsWith('/')).toBe(true);
      expect(path).not.toMatch(/^https?:|^\.\.?\//);
      expect(logoSrc(path)).not.toMatch(/[^:]\/\//);
    }
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

  it('draws the WNBA mark, and never the NBA one, on a WNBA card', () => {
    // An NBA mark on a WNBA card would be a factual error printed on the face
    // of it — the same argument that keeps Kevin Durant's rookie card on SEA.
    const html = render({ card: { name: 'X', team: 'MIN' }, set: WNBA_SET });
    expect(LEAGUE_LOGOS.WNBA).toBe('/logos/WNBA/WNBA.png');
    expect(html).toContain(`src="${logoSrc(LEAGUE_LOGOS.WNBA)}"`);
    expect(html).toContain('alt="WNBA"');
    // The NBA file, not merely the letters "NBA" — which "WNBA" contains.
    expect(html).not.toContain(logoSrc(LEAGUE_LOGO));
    // And it is a real <img>, not the lettered stand-in.
    expect(html).toMatch(/<img[^>]*leagueMark/);
  });

  it('gives the four-letter fallback a class narrow enough for the 28px box', () => {
    // The box is measured off the printed art for three letters. A fourth at
    // the same size runs off the band's left edge.
    //
    // Asserted on the helper rather than on rendered markup because the
    // fallback is no longer REACHABLE from a render: both declared leagues have
    // a mark file now, so the only route to it is an <img> that fails to load,
    // which renderToStaticMarkup cannot produce. The rule still governs what
    // gets drawn when a file goes missing, so it is still pinned.
    expect(leagueMarkFallbackClass('WNBA')).toMatch(/leagueMarkFallbackWide/);
    expect(leagueMarkFallbackClass('NBA')).not.toMatch(/leagueMarkFallbackWide/);
    // Neither card renders it today, which is the point of the two above.
    expect(render({ card: { name: 'X' }, set: WNBA_SET })).not.toMatch(/leagueMarkFallback/);
    expect(render({ card: { name: 'X' }, set: CURRENT_SET })).not.toMatch(/leagueMarkFallback/);
  });

  it('keeps every NBA set on the NBA mark without either being edited', () => {
    // DEFAULT_LEAGUE is what does this, and it is why no set that predates the
    // WNBA needed a line added when the WNBA arrived. The exclusion list grew
    // when the WNBA legends set did — it is a second WNBA set, and a card type
    // rather than a season, so it declares its league for the same reason.
    const wnbaSets = SET_IDS.filter(i => setLeague(i) === 'WNBA');
    expect(wnbaSets).toEqual([WNBA_SET, WNBA_SUPER_SEASON_SET, WNBA_ROOKIE_SET]);
    for (const id of SET_IDS.filter(i => !wnbaSets.includes(i))) {
      expect(setLeague(id), id).toBe('NBA');
      expect(LEAGUE_LOGOS[setLeague(id)], id).toBe(LEAGUE_LOGO);
    }
    for (const id of wnbaSets) expect(LEAGUE_LOGOS[setLeague(id)]).toBe(LEAGUE_LOGOS.WNBA);
  });
});

describe('a WNBA card', () => {
  const COLLIER = {
    id: 'Napheesa_Collier',
    name: 'Napheesa Collier',
    team: 'MIN',
    pos: 'F',
    speed: 14,
    power: 14,
    shotLine: 14,
    paintBoost: 0,
    threePtBoost: 2,
    defBoost: 2,
    salary: 1270,
    seasonLabel: '2025+2026',
    chart: [
      { lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 },
      { lo: 3, hi: 5, pts: 0, reb: 1, ast: 0 },
      { lo: 6, hi: 13, pts: 2, reb: 1, ast: 0 },
      { lo: 14, hi: 20, pts: 3, reb: 1, ast: 1 },
      { lo: 21, hi: 99, pts: 4, reb: 2, ast: 1 },
    ],
  };

  it('themes from the WNBA table, not from the NBA team sharing the code', () => {
    const html = render({ card: COLLIER, set: WNBA_SET });
    // Minnesota Lynx blue, not Minnesota Timberwolves blue — different hexes,
    // and the failure this guards is a card that looks perfectly fine.
    expect(html.toLowerCase()).not.toContain(TEAMS.MIN.primary.toLowerCase());
    expect(html.toLowerCase()).toContain(WNBA_TEAMS.MIN.primary.toLowerCase());
  });

  it('renders the real team mark out of the WNBA\'s OWN logo directory', () => {
    const html = render({ card: COLLIER, set: WNBA_SET });
    expect(html).toContain(`src="${logoSrc('/logos/WNBA/MIN.png')}"`);
    // The Lynx, named as the Lynx. And NOT public/logos/MIN.png, which is the
    // Timberwolves' file — the directory is the whole defence against nine
    // abbreviations that mean a different franchise in each league, and a card
    // that picked up the wrong one would look completely fine.
    expect(html).toContain('alt="Lynx"');
    expect(html).not.toMatch(/src="[^"]*\/logos\/MIN\.png"/);
    // No lettered circle: the file exists, so the degraded path is not taken.
    expect(html).not.toMatch(/logoFallback/);
  });

  it('prints NO season, exactly like the current-season set it is', () => {
    // A USER DECISION, recorded as `showsSeason: false` in sets.js. The season
    // text belongs to the Super Season and Rookie sets, where WHICH season a
    // card represents is the point of the card. This is a current-season set,
    // so it prints like 2026-27: no season, no badge.
    const html = render({ card: COLLIER, set: WNBA_SET });
    expect(showsSeason(WNBA_SET)).toBe(false);
    expect(html).not.toContain('2025+2026');
    // The DATA still carries it — this is a print rule, not a data one, and the
    // generated cards keep `seasonLabel` for anything that wants to report it.
    expect(COLLIER.seasonLabel).toBe('2025+2026');
  });

  it('hides the structural blank tier, like every other generated set', () => {
    expect(visibleTiers(COLLIER.chart, WNBA_SET)).toHaveLength(4);
  });

  it('carries no card-type badge — the league mark already says WNBA', () => {
    const html = render({ card: COLLIER, set: WNBA_SET });
    expect(html).not.toMatch(/class="[^"]*badge/);
  });
});

describe('the curated photo is looked up in THIS card\'s set', () => {
  // THE BUG THIS PINS: CardTemplate resolved every photo without saying which
  // set it was rendering, so resolvePhotoUrl fell back to its default — the
  // 2026-27 set — and pointed at card-art/sets/2026-27/photos/{id} whatever was
  // on screen. It stayed invisible while 2026-27 was the only set with photos
  // in it; the moment the WNBA set got its first one, that player counted as
  // having a photo (the /__studio/state scan IS per set) and rendered a hole.
  const MABREY = { id: 'Marina_Mabrey', name: 'Marina Mabrey', team: 'TOR' };
  const srcOf = html => html.match(/<img[^>]*class="[^"]*photo[^"]*"[^>]*>/i)?.[0] ?? html;

  it('points at the set it was told to render, not at the default set', () => {
    const html = render({ card: MABREY, hasPhoto: true, photoExt: '.webp', set: WNBA_SET });
    expect(html).toContain(photoUrlPath('Marina_Mabrey', WNBA_SET, '.webp'));
    expect(html).not.toContain(photoUrlPath('Marina_Mabrey', CURRENT_SET, '.webp'));
  });

  it('gives every set its own path, including the two special ones', () => {
    for (const id of SET_IDS) {
      const html = render({ card: MABREY, hasPhoto: true, set: id });
      expect(srcOf(html), id).toContain(`/card-art/sets/${id}/photos/Marina_Mabrey.jpg`);
    }
  });

  it('still defaults to the set being built when no set is given', () => {
    // The batch export and any other caller that predates multi-set rendering.
    const html = render({ card: MABREY, hasPhoto: true });
    expect(html).toContain(photoUrlPath('Marina_Mabrey', CURRENT_SET));
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

describe('visibleTiers — rows that pay nothing are hidden for the sets that generate them', () => {
  /**
   * What the 2026-27 generator emits: a blank 1-2 tier under the real chart.
   * Its no-scoring tier keeps a rebound AND an assist, so it is NOT empty and
   * goes on printing — the Gobert case, and the reason this fixture is the one
   * the arrow tests below are written against.
   */
  const generated = [
    { lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 },
    { lo: 3, hi: 3, pts: 0, reb: 1, ast: 1 },
    { lo: 4, hi: 19, pts: 3, reb: 1, ast: 1 },
    { lo: 20, hi: 99, pts: 5, reb: 2, ast: 2 },
  ];

  /** The commoner shape: the no-scoring tier's reb and ast round to zero too. */
  const twoEmpty = [
    { lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 },
    { lo: 3, hi: 3, pts: 0, reb: 0, ast: 0 },
    { lo: 4, hi: 19, pts: 3, reb: 1, ast: 1 },
    { lo: 20, hi: 99, pts: 5, reb: 2, ast: 2 },
  ];

  it('drops the structural blank tier so the printed chart starts at roll 3', () => {
    const shown = visibleTiers(generated, CURRENT_SET);
    expect(shown).toHaveLength(3);
    expect(shown[0]).toMatchObject({ lo: 3, hi: 3 });
  });

  it('drops a SECOND row when it also pays nothing — Jalen Brunson\'s "3: 0-0-0"', () => {
    const shown = visibleTiers(twoEmpty, CURRENT_SET);
    expect(shown).toHaveLength(2);
    expect(shown[0]).toMatchObject({ lo: 4, hi: 19 });
  });

  it('KEEPS a no-scoring row that carries a rebound — the Gobert case', () => {
    // "3-4 | 0 | 1 | 0" is exactly what the no-scoring tier exists for, so it
    // is not empty and must not be hidden. pts:0 alone is never the test.
    const gobert = [
      { lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 },
      { lo: 3, hi: 4, pts: 0, reb: 1, ast: 0 },
      { lo: 5, hi: 99, pts: 4, reb: 3, ast: 0 },
    ];
    const shown = visibleTiers(gobert, CURRENT_SET);
    expect(shown).toHaveLength(2);
    expect(shown[0]).toMatchObject({ lo: 3, hi: 4, reb: 1 });
    expect(render({ card: { ...LEBRON_08_09, chart: gobert }, set: CURRENT_SET })).toContain('3-4');
  });

  it('hides a PREFIX, never a row out of the middle', () => {
    // The justification for hiding an empty row is that every roll below the
    // lowest PRINTED row implicitly produces nothing. That is only true at the
    // bottom: dropping an empty row from the middle would leave the printed
    // ranges with a hole in them and a roll of 6 matching no row at all. No
    // generated chart has one (864 cards checked, 0 occurrences); if one ever
    // appears it prints.
    const holed = [
      { lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 },
      { lo: 3, hi: 5, pts: 1, reb: 0, ast: 0 },
      { lo: 6, hi: 7, pts: 0, reb: 0, ast: 0 },
      { lo: 8, hi: 99, pts: 2, reb: 1, ast: 1 },
    ];
    const shown = visibleTiers(holed, CURRENT_SET);
    expect(shown).toHaveLength(3);
    expect(shown.map(t => t.lo)).toEqual([3, 6, 8]);
  });

  it('PRINTS the same shape for the finished set, where it is a real row', () => {
    // THE REGRESSION THIS SCOPING EXISTS TO PREVENT. 66 of the shipped 306
    // cards print "1-2: 0,0,0" as a genuine hand-made bottom row. It is the
    // same three numbers over the same two rolls as the generated blank tier,
    // so nothing about the SHAPE can tell them apart — only the set can.
    const shipped = CARDS.filter(
      c => c.chart[0].lo === 1 && c.chart[0].hi === 2 && c.chart[0].pts === 0
        && c.chart[0].reb === 0 && c.chart[0].ast === 0
    );
    expect(shipped.length).toBe(66); // non-vacuous, and the exact count
    for (const card of shipped) {
      expect(visibleTiers(card.chart, FINISHED_SET), card.name).toEqual(card.chart);
      const printed = rows(render({ card, set: FINISHED_SET })).slice(1);
      expect(printed.length, card.name).toBe(card.chart.length);
      expect(printed[0], card.name).toContain('1-2');
    }
  });

  it('prints everything for an unknown set — the fail-loud default', () => {
    // An extra row overflows the chart into the photo and trips the height
    // check below. A row wrongly hidden would just be invisible.
    expect(visibleTiers(generated, undefined)).toEqual(generated);
    expect(visibleTiers(generated, 'some-other-set')).toEqual(generated);
  });

  it('KEEPS a real bottom band that happens to sit at roll 1', () => {
    // The shipped set's bottom tier is often a genuine 3-roll band that scores
    // — LeBron's "1-3: 2,0,0". Even under the current set's rule, a tier that
    // produces something is never the structural one.
    expect(visibleTiers(LEBRON_08_09.chart, CURRENT_SET)).toEqual(LEBRON_08_09.chart);
  });

  it('hides a WIDER all-zero floor, which the merge can produce', () => {
    // 33 cards have rolls 1-4 producing nothing, because their bottom decile
    // genuinely rounds to zero. Width is not what identifies the blank tier;
    // starting at roll 1 and paying nothing is.
    const chart = [{ lo: 1, hi: 4, pts: 0, reb: 0, ast: 0 }, { lo: 5, hi: 99, pts: 2, reb: 1, ast: 0 }];
    expect(visibleTiers(chart, CURRENT_SET)).toHaveLength(1);
    expect(visibleTiers(chart, FINISHED_SET)).toEqual(chart);
  });

  it('never prints an empty chart, even if the blank tier is all there is', () => {
    const only = [{ lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 }];
    expect(visibleTiers(only, CURRENT_SET)).toEqual(only);
  });

  it('keeps the LAST row when every row is empty, rather than none', () => {
    // A chart with no rows at all is not a card. The row it keeps is the top
    // tier, which is the one a reader would look for.
    const allEmpty = [
      { lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 },
      { lo: 3, hi: 9, pts: 0, reb: 0, ast: 0 },
      { lo: 10, hi: 99, pts: 0, reb: 0, ast: 0 },
    ];
    expect(visibleTiers(allEmpty, CURRENT_SET)).toEqual([{ lo: 10, hi: 99, pts: 0, reb: 0, ast: 0 }]);
  });

  it('degrades to an empty list rather than throwing', () => {
    expect(visibleTiers(undefined, CURRENT_SET)).toEqual([]);
    expect(visibleTiers(null, CURRENT_SET)).toEqual([]);
    expect(visibleTiers([], CURRENT_SET)).toEqual([]);
  });

  it('renders one row per VISIBLE tier plus the header', () => {
    const html = render({ card: { ...LEBRON_08_09, chart: generated }, set: CURRENT_SET });
    expect(rows(html)).toHaveLength(4); // 3 printed tiers + header
    expect(html).not.toContain('>1-2<');
  });

  it('puts the arrow on the right printed row with the blank tier hidden', () => {
    // THE off-by-one this guards. findShotLineBoundary indexes whatever array
    // it is handed; hand it the full chart while rendering the visible one and
    // every arrow sits exactly one row too low — and still looks plausible.
    // Shot line 5 misses on 1..4, and 4 is the first roll of "4-19", so the
    // arrow rides that row's bottom edge — the SECOND printed row (index 1).
    const card = { ...LEBRON_08_09, chart: generated, shotLine: 5 };
    expect(findShotLineBoundary(visibleTiers(generated, CURRENT_SET), 5)).toBe(1);
    const printed = rows(render({ card, set: CURRENT_SET })).slice(1); // drop the header
    const withArrow = printed.findIndex(r => r.includes('shot-line-arrow'));
    expect(withArrow).toBe(1);
    expect(printed[withArrow]).toContain('4-19');
  });

  it('puts the arrow on the right printed row with TWO rows hidden', () => {
    // The same off-by-one, one row deeper. Hiding a second empty row shifts
    // every index again, so the arrow is only ever right if it is searched on
    // the same list that gets rendered. Shot line 20 misses on 1..19, and 19 is
    // the last roll of "4-19", so the arrow rides that row's bottom edge — the
    // FIRST printed row now that both empty rows are gone.
    const card = { ...LEBRON_08_09, chart: twoEmpty, shotLine: 20 };
    expect(findShotLineBoundary(visibleTiers(twoEmpty, CURRENT_SET), 20)).toBe(0);
    const printed = rows(render({ card, set: CURRENT_SET })).slice(1);
    expect(printed).toHaveLength(2);
    const withArrow = printed.findIndex(r => r.includes('shot-line-arrow'));
    expect(withArrow).toBe(0);
    expect(printed[withArrow]).toContain('4-19');
  });

  it('drops the arrow rather than misplacing it when the last miss is hidden', () => {
    // Two rookie cards (Jay Huff, Jordan Goodwin — both Shot Line 18, both
    // paying nothing at all below roll 18) now have their last-miss row hidden.
    // The rule the arrow would sit on is the TABLE'S TOP BORDER, which is a
    // frame and not a dividing line, so findShotLineBoundary refuses it. A
    // missing arrow beats a wrong one.
    const huff = [
      { lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 },
      { lo: 3, hi: 17, pts: 0, reb: 0, ast: 0 },
      { lo: 18, hi: 23, pts: 0, reb: 1, ast: 0 },
      { lo: 24, hi: 99, pts: 0, reb: 3, ast: 1 },
    ];
    expect(findShotLineBoundary(visibleTiers(huff, ROOKIE_SET), 18)).toBe(-1);
    const html = render({ card: { ...LEBRON_08_09, chart: huff, shotLine: 18 }, set: ROOKIE_SET });
    expect(html).not.toContain('shot-line-arrow');
  });

  it('leaves EVERY chart in the finished set exactly as it was printed', () => {
    // The regression that would be invisible: the generalised rule fires on
    // "all three numbers are zero" and the finished set has 66 such rows, so
    // the only thing keeping them on the card is that its set does not hide
    // them. Asserted over all 306, not just the 66.
    for (const card of CARDS) {
      expect(visibleTiers(card.chart, FINISHED_SET), card.name).toBe(card.chart);
    }
  });

  it('still resolves a natural 1 or 2 in the DATA, which is why the tier stays there', () => {
    // Hidden from the chart, present for the game: rolling a 1 or a 2 has to
    // find a tier or the card cannot be resolved at all — and those are the
    // same two rolls engine.js hands out a cold marker for.
    for (const roll of [1, 2]) {
      const forRoll = generated.find(t => roll >= t.lo && roll <= t.hi);
      expect(forRoll).toMatchObject({ lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 });
      expect(generated.indexOf(forRoll)).toBe(0);
    }
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

  const CHART_MID = pxIn(chart, 'top');
  const CELL_H = pxIn(cell, 'height');
  const CHART_BORDER = Number(chart.match(/border:\s*(\d+)px/)[1]);
  /** Six tiers is the generator's cap; one is the blank tier, which is hidden. */
  const MAX_PRINTED_ROWS = 5;

  /** A chart's own height, in card pixels, for N printed tiers (+1 header). */
  const chartHeight = n => (n + 1) * CELL_H + CHART_BORDER;
  /**
   * The chart's top edge. It is CENTRED on CHART_MID via translateY(-50%),
   * so it grows equally in both directions rather than upward from a pinned
   * bottom — see the .chart rule's comment.
   */
  const chartTop = n => CHART_MID - chartHeight(n) / 2;
  const chartBottom = n => CHART_MID + chartHeight(n) / 2;

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
    expect(CHART_MID).toBe(1040);
    expect(CELL_H).toBe(41);
    expect(CHART_BORDER).toBe(3);
  });

  it('centres the chart in the band below the photo', () => {
    // The whole point of the centring: leftover field is split evenly above
    // and below at EVERY row count, instead of all of it landing on top.
    for (const n of [2, 3, 4, 5]) {
      const above = chartTop(n) - paintedBottom();
      const below = CARD_HEIGHT - chartBottom(n);
      expect(Math.abs(above - below), `${n} printed rows`).toBeLessThanOrEqual(1);
    }
  });

  it('stays inside the card at the tallest row count', () => {
    expect(chartBottom(MAX_PRINTED_ROWS)).toBeLessThan(CARD_HEIGHT);
  });

  it('leaves the photo above the TALLEST chart the generator can produce', () => {
    // The tallest case is the only one that can fail: it reaches highest
    // toward the photo, so every shorter chart clears by more. Photo painted
    // bottom is y=900; a six-row table centred on 1040 tops out at 915.5.
    expect(paintedBottom()).toBe(900);
    expect(chartTop(MAX_PRINTED_ROWS)).toBe(915.5);
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
    const printed = POOL_PLAYERS.map(p => visibleTiers(p.chart, CURRENT_SET).length);
    const worst = Math.max(...printed);
    // A floor, not the exact size: the pool grows whenever a name is added to
    // card-data/force-include-2026.json, and this test is about chart heights,
    // not about how many players there are. src/studio/players.test.js owns the
    // count.
    expect(printed.length).toBeGreaterThan(300);
    // THE CAP IS NO LONGER REACHED, and that is the section chart model working
    // rather than a chart going missing. Every one of the 350 cards now opens
    // with TWO all-zero tiers — the founding requirement of the redesign, a
    // guaranteed natural-1 blank plus a second non-scoring tier — and an
    // editable set hides that leading run, so the tallest card prints four rows
    // of a possible five. The stylesheet is still checked against
    // MAX_PRINTED_ROWS below, which is the thing that would actually break the
    // frame; `worst` is held here only so a chart that starts printing MORE
    // than the sheet allows still fails.
    expect(worst).toBeLessThanOrEqual(MAX_PRINTED_ROWS);
    expect(worst).toBeGreaterThanOrEqual(4); // non-vacuous: tall charts exist
    expect(Math.min(...printed)).toBeGreaterThanOrEqual(2);
    // The frame check must still be exercised at the full height the sheet
    // allows, even though no card asks for it today.
    expect(paintedBottom()).toBeLessThan(chartTop(MAX_PRINTED_ROWS));
    for (const n of printed) expect(paintedBottom()).toBeLessThan(chartTop(n));
  });

  it('agrees with every chart in BOTH special sets too', () => {
    // Hiding empty rows freed a row on 697 of the 864 generated cards, so the
    // tallest chart is the one worth re-checking — and it is still five rows,
    // because the cards that keep five had nothing empty above the floor.
    for (const set of [SUPER_SEASON_SET, ROOKIE_SET]) {
      const players = SOURCES[set].players;
      if (players.length === 0) continue; // set not generated in this checkout
      const printed = players.map(p => visibleTiers(p.chart, set).length);
      expect(Math.max(...printed), set).toBeLessThanOrEqual(MAX_PRINTED_ROWS);
      // Two rows is the floor the rookie set actually reaches — four cards
      // whose whole chart above the floor is a single make band.
      expect(Math.min(...printed), set).toBeGreaterThanOrEqual(2);
      for (const n of printed) expect(paintedBottom(), `${set} ${n}`).toBeLessThan(chartTop(n));
    }
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

describe('the set treatment on the rendered card', () => {
  /** A card with the structural blank tier and a full five printed rows. */
  const CARD = {
    id: 'Kevin_Durant',
    name: 'Kevin Durant',
    team: 'SEA',
    pos: 'SG',
    speed: 10,
    power: 7,
    shotLine: 14,
    paintBoost: 1,
    threePtBoost: 2,
    defBoost: 0,
    salary: 480,
    chart: [
      { lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 },
      { lo: 3, hi: 7, pts: 1, reb: 1, ast: 0 },
      { lo: 8, hi: 13, pts: 2, reb: 1, ast: 1 },
      { lo: 14, hi: 18, pts: 3, reb: 2, ast: 1 },
      { lo: 19, hi: 99, pts: 5, reb: 2, ast: 2 },
    ],
  };

  /**
   * The same card priced into the GILDED tier.
   *
   * CARD is $480 and that is not an accident to be edited away — it is a Kevin
   * Durant ROOKIE card, and a rookie card is cheap. But $480 is under
   * SUPER_SEASON_MIN_SALARY, so on the Super Season set that same record is now
   * a BEST SEASON card with no foil on it, and every assertion about the gold
   * has to name a card that actually gets the gold. Exactly at the line, which
   * is the inclusive side: "under [the line]" is what was asked for, so the
   * line itself is gold.
   */
  const GILDED = { ...CARD, salary: SUPER_SEASON_MIN_SALARY };

  const forSet = (set, card = CARD) => render({ card, set });

  it('leaves BOTH season sets with no treatment markup at all', () => {
    // The regression that matters most in this file: these two sets shipped
    // before treatments existed and must render as if they still did not.
    for (const set of [CURRENT_SET, FINISHED_SET]) {
      const html = forSet(set);
      expect(html, set).not.toContain('data-treatment');
      expect(html, set).not.toContain('--treatment-sheen');
      expect(html, set).not.toContain('--treatment-band');
      expect(html, set).not.toContain('--treatment-frame');
    }
  });

  it('still hides the blank tier for the set being built and prints it for the finished one', () => {
    // Restated here against a treated-card fixture, because `set` now does two
    // jobs — it picks the treatment AND decides this — and a change to one must
    // not be able to quietly move the other.
    expect(rows(forSet(CURRENT_SET))).toHaveLength(5); // header + 4 printed
    expect(rows(forSet(FINISHED_SET))).toHaveLength(6); // header + 5 printed
  });

  it('marks a treated card with the treatment it carries', () => {
    expect(forSet(SUPER_SEASON_SET, GILDED)).toContain('data-treatment="gold-foil"');
    expect(forSet(ROOKIE_SET)).toContain('data-treatment="green-accent"');
  });

  it('paints the Super Season card with a static foil, no animation', () => {
    const html = forSet(SUPER_SEASON_SET, GILDED);
    expect(html).toContain('linear-gradient');
    expect(html).not.toMatch(/animation|keyframes|transition/i);
    // The two extra boxes: a sheen under the content and a gradient keyline
    // over it. See the z-order note in CardTemplate.
    expect(html).toContain('repeating-linear-gradient');
    expect(html).toMatch(/--treatment-frame:\s*linear-gradient/);
  });

  it('withholds the whole foil from a Super Season card under the salary line', () => {
    // "not make the tab gold for anyone under 700 salary" — 900 since. The
    // threshold moved; this rule did not. The gold is not one
    // surface — it is the band, the frame, the field sheen and the 96px name —
    // so the tier does not strip the pill and leave the rest. The card keeps
    // the TEAM's palette, exactly as `applyTreatment(base, null)` returns it,
    // and the assertion is the same absence the two season sets are held to.
    const html = forSet(SUPER_SEASON_SET, CARD); // $480
    expect(html).not.toContain('data-treatment');
    expect(html).not.toContain('--treatment-');
    expect(html).not.toContain('linear-gradient');
    // Still a historical card, and this is what keeps it from reading as a
    // base card: the season line, which no 2026-27 card prints.
    expect(html).toContain('BEST SEASON');
    expect(html).not.toContain('SUPER SEASON');
  });

  it('gilds at the line and not one dollar below it', () => {
    // The boundary, both sides, on the same record. A real card sits exactly at
    // the line — Jonas Valančiūnas' 2020-21 at $900 — so this is not a
    // hypothetical edge. (It was A.J. Green and Miles Bridges at $700.)
    const at = render({ card: { ...CARD, salary: SUPER_SEASON_MIN_SALARY }, set: SUPER_SEASON_SET });
    const below = render({
      card: { ...CARD, salary: SUPER_SEASON_MIN_SALARY - 10 },
      set: SUPER_SEASON_SET,
    });
    expect(at).toContain('data-treatment="gold-foil"');
    expect(at).toContain('SUPER SEASON');
    expect(below).not.toContain('data-treatment');
    expect(below).toContain('BEST SEASON');
  });

  it('leaves the Rookie set gilt-free and therefore tier-free', () => {
    // The green treatment is not the gold and does not tier: a rookie card is
    // cheap by definition, and "this was his first season" is not a claim that
    // can be overstated by a small salary. CARD is $480 — under the line — and
    // keeps everything the Rookie set declares.
    const html = forSet(ROOKIE_SET, CARD);
    expect(html).toContain('data-treatment="green-accent"');
    expect(html).toContain('ROOKIE');
    // And at every price, so nothing can start reading the salary here.
    for (const salary of [10, 890, 900, 1500, undefined]) {
      expect(render({ card: { ...CARD, salary }, set: ROOKIE_SET }), String(salary))
        .toContain('data-treatment="green-accent"');
    }
  });

  it('keeps the gold when the card has no salary at all', () => {
    // The studio's contract: a half-built record renders. Demotion needs
    // EVIDENCE — a real number below the line — because the other default would
    // strip the foil off the whole set on a checkout where the salary generator
    // had not been run. See `tierBadge` in badges.js.
    const { salary, ...noSalary } = CARD;
    const html = render({ card: noSalary, set: SUPER_SEASON_SET });
    expect(html).toContain('data-treatment="gold-foil"');
    expect(html).toContain('SUPER SEASON');
  });

  it('keeps the Rookie card plain — a green accent, not a second look', () => {
    const html = forSet(ROOKIE_SET);
    expect(html).toMatch(/--treatment-sheen:\s*none/);
    expect(html).toMatch(/--treatment-band:\s*none/);
    expect(html).toMatch(/--treatment-frame:\s*none/);
    // The one thing it does paint.
    expect(html).toMatch(/--treatment-band-edge:\s*#/);
  });

  it('hides the blank tier on both special sets too', () => {
    for (const set of [SUPER_SEASON_SET, ROOKIE_SET]) {
      expect(rows(forSet(set)), set).toHaveLength(5);
    }
  });

  it('renders a defunct franchise without falling back to the neutral grey', () => {
    // Kevin Durant's rookie card says SEA. The logo file does not exist and is
    // not supposed to — the lettered circle is the intended fallback — but the
    // COLOURS have to be Seattle's, or the card looks like a data error.
    const html = forSet(ROOKIE_SET);
    expect(html).toContain(HISTORICAL_TEAMS.SEA.primary);
    expect(html).toContain('SEA');
  });

  it('renders every set for every team without throwing', () => {
    // The sweep. Four sets times thirty-seven franchises: the treated themes
    // are searched per field, so this is the cheapest way to catch a field the
    // search cannot handle at all.
    for (const set of SET_IDS) {
      for (const team of [...Object.keys(TEAMS), ...Object.keys(HISTORICAL_TEAMS)]) {
        const html = render({ card: { ...CARD, team }, set });
        expect(html.length, `${set} ${team}`).toBeGreaterThan(1000);
      }
    }
  });
});

describe('the season and the card-type badge', () => {
  // THE SEASON IS SET-LEVEL, exactly like the hidden empty rows: which season a
  // card represents is the whole point of a Super Season or a Rookie card, and
  // is noise on a base-set card that IS this season. The finished set's legend
  // cards carry a season too — but in the hand-made art, so the template must
  // not print a second one over the top of it.
  //
  // THE BADGE IS NOT. It used to be, and the exclusion rule was why: a player
  // whose best season is the most recent one got no Super Season card, so no
  // card outside that set could ever want the pill. Now his BASE card carries
  // it. So the badge is the union of what the SET declares and what the CARD
  // does — see pickBadge in badges.js — and a 2026-27 card gains a badge and
  // NOT a season, which is the case these tests exist to pin.

  /** Tomorrow 700, measured off the loaded face in the browser at 1000px. */
  const TOMORROW_CAP = 0.74;
  const TOMORROW_DIGIT = 0.6975;
  const TOMORROW_HYPHEN = 0.46;
  /** A season label is six digits and one hyphen — "2008-09". */
  const seasonAdvance = size => size * (6 * TOMORROW_DIGIT + TOMORROW_HYPHEN);

  /** A Super Season card as the generator emits one, seasonLabel included. */
  const SPECIAL = {
    id: 'Stephen_Curry',
    name: 'Stephen Curry',
    team: 'GSW',
    pos: 'PG',
    speed: 16,
    power: 8,
    shotLine: 12,
    paintBoost: 0,
    threePtBoost: 5,
    defBoost: 0,
    salary: 1490,
    season: 2016,
    seasonLabel: '2015-16',
    chart: [
      { lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 },
      { lo: 3, hi: 3, pts: 0, reb: 0, ast: 0 },
      { lo: 4, hi: 11, pts: 3, reb: 1, ast: 1 },
      { lo: 12, hi: 19, pts: 4, reb: 1, ast: 2 },
      { lo: 20, hi: 99, pts: 6, reb: 2, ast: 3 },
    ],
  };

  const themeFor = (abbr, treatment) =>
    applyTreatment(
      deriveFieldTheme(TEAMS[abbr].primary, TEAMS[abbr].secondary, resolveAccent(TEAMS[abbr])),
      treatment
    );

  it('prints the badge and the season on both special sets', () => {
    expect(render({ card: SPECIAL, set: SUPER_SEASON_SET })).toContain('SUPER SEASON');
    expect(render({ card: SPECIAL, set: ROOKIE_SET })).toContain('ROOKIE');
    for (const set of [SUPER_SEASON_SET, ROOKIE_SET]) {
      expect(render({ card: SPECIAL, set }), set).toContain('2015-16');
    }
  });

  it('prints NEITHER on either season set', () => {
    // The regression that would be silent on screen and loud on 23 finished
    // cards: the 2025-26 legend cards already have a season drawn into the art.
    for (const set of [CURRENT_SET, FINISHED_SET]) {
      const html = render({ card: SPECIAL, set });
      expect(html, set).not.toContain('2015-16');
      expect(html, set).not.toContain('SUPER SEASON');
      expect(html, set).not.toContain('ROOKIE');
    }
  });

  it('gates on the SET, not on whether the record happens to carry a season', () => {
    // A base-set record has no seasonLabel at all, so gating on the data would
    // look identical today and would start printing the moment a generator
    // added the field. And a special-set card with the field missing must
    // degrade to the card's own placeholder rather than throwing or vanishing.
    const { seasonLabel, ...noSeason } = SPECIAL;
    const html = render({ card: noSeason, set: ROOKIE_SET });
    expect(html).toContain('ROOKIE');
    expect(html).toContain('—');
  });

  it('stacks the badge, then the season, then the logo', () => {
    // The column is a bottom-anchored flex stack, so DOM order IS the order on
    // the card. The badge is the loudest of the three and sits furthest from
    // the type below it; the season sits directly above the mark, which is
    // where all 23 printed legend cards put theirs.
    const html = render({ card: SPECIAL, set: SUPER_SEASON_SET });
    const at = s => html.indexOf(s);
    expect(at('SUPER SEASON')).toBeGreaterThan(-1);
    expect(at('SUPER SEASON')).toBeLessThan(at('2015-16'));
    expect(at('2015-16')).toBeLessThan(at('/logos/GSW.png'));
  });

  it('reproduces the printed season line: 12px caps, untracked, ~74px of ink', () => {
    // MEASURED off all 23 legend cards in public/cards/players/: every one of
    // them has a 12px digit height, and LeBron's, Wade's and McGrady's
    // "2008-09" spans exactly 74px of ink (the set ranges 66-74, hand-set).
    const season = cssBlock('.season');
    const size = pxIn(season, 'font-size');
    expect(size * TOMORROW_CAP).toBeCloseTo(12, 0);
    // Untracked, unlike the rest of the column: 1px of tracking would put
    // "2008-09" at 80px and overshoot every card in the reference.
    expect(season).toMatch(/letter-spacing:\s*0\s*;/);
    expect(seasonAdvance(size)).toBeCloseTo(74, 0);
    // And the tracking claim, stated rather than asserted by absence: 1px would
    // put it 6px over the widest card in the reference.
    expect(seasonAdvance(size) + 6).toBeGreaterThan(74 + 5);
    // Inherited ink — the same white the art uses and the rest of the sidebar
    // takes from .card. A colour here would be a second source of truth.
    expect(season).not.toMatch(/(?:^|[;{\s])color:/);
  });

  it('fits the longest declared badge label inside the pill', () => {
    // The same budget nameFontSize is held to, and the same conservative
    // estimate: 0.7em average uppercase advance over-states the real width
    // (SUPER SEASON measures 118.8px off the loaded face, 121.2 here), so
    // passing this is passing with room to spare.
    const badge = cssBlock('.badge');
    const inner = pxIn(badge, 'width');
    const size = pxIn(badge, 'font-size');
    const tracking = Number(badge.match(/letter-spacing:\s*([\d.]+)px/)[1]);
    // EVERY LABEL A BADGE CAN PRINT, which is no longer the same as every
    // declared badge. Two things this must not become: the declared SETS (a set
    // names a badge by id, and ids are shorter than the labels they stand for,
    // so measuring those would have quietly stopped measuring anything), and
    // `BADGES.map(b => b.text)` (which stopped being the full list when the
    // ROOKIE pill learned to date itself — "25-26 ROOKIE" is twice the length of
    // "ROOKIE" and is the string 33 base cards actually draw).
    //
    // Fed EVERY set's declared stats season, so the longest label this build can
    // produce is measured whatever the seasons are. It is deliberately the
    // whole list rather than STATS_SEASON: a season label is a fixed seven
    // characters, but nothing here should depend on that staying true.
    const labels = badgeLabels(SETS.map(s => s.statsSeason));
    expect(labels.length).toBeGreaterThan(BADGES.length); // non-vacuous, and dated
    expect(labels).toContain('25-26 ROOKIE');
    for (const label of labels) {
      const width = label.length * (0.7 * size + tracking);
      expect(width, `${label} at ${size}px`).toBeLessThanOrEqual(inner);
    }
  });

  it('stays inside the bar, clear of the card frame', () => {
    // The pill is the widest thing in the column, so it is the one that can
    // reach the keyline. Centred in the 135px bar, it has to leave room on both
    // sides — and the right side is the one that matters, because .card::after
    // paints its 7px frame over everything.
    const badge = pxIn(cssBlock('.badge'), 'width');
    const bar = pxIn(cssBlock('.sidebarScrim'), 'width');
    expect(badge).toBeLessThan(bar);
    expect((bar - badge) / 2).toBeGreaterThanOrEqual(4);
  });

  it('takes both badge colours from the theme, never a literal', () => {
    // A hex in the stylesheet would be a colour no contrast sweep can see.
    const badge = cssBlock('.badge');
    expect(badge).toMatch(/background:\s*var\(--badge-fill,/);
    expect(badge).toMatch(/color:\s*var\(--badge-ink,/);
    expect(badge).not.toMatch(/#[0-9A-Fa-f]{3,6}/);
    // On the treated sets AND on an untreated base card, which is the pairing
    // that did not exist before: no treatment properties are emitted there at
    // all, so the pill has to bring its own two or fall back to the accent.
    for (const [set, card] of [
      [SUPER_SEASON_SET, SPECIAL],
      [ROOKIE_SET, SPECIAL],
      [CURRENT_SET, { ...SPECIAL, badges: [SUPER_SEASON_BADGE] }],
      [CURRENT_SET, { ...SPECIAL, badges: [ROOKIE_BADGE] }],
    ]) {
      const html = render({ card, set });
      expect(html, set).toMatch(/--badge-fill:\s*#[0-9A-F]{6}/i);
      expect(html, set).toMatch(/--badge-ink:\s*#[0-9A-F]{6}/i);
    }
  });

  it('emits no badge properties at all on a card with no badge', () => {
    const html = render({ card: SPECIAL, set: CURRENT_SET });
    expect(html).not.toContain('--badge-fill');
    expect(html).not.toContain('--badge-ink');
  });

  it("gives Super Season a gold pill and Rookie the TEAM's accent", () => {
    // "Super Season can be gold, while rookie can just be secondary/accent team
    // color". Curry's card is Golden State, whose accent is their yellow — so
    // the two badges produce two different pills on the same card, and the
    // rookie one is emphatically not the green that treatment paints.
    //
    // Read off the UNTREATED theme, because that is what CardTemplate hands the
    // badge — and asserted against the TREATED palettes to show the pill is
    // still in step with the foil name and still out of step with the green.
    const base = deriveFieldTheme(
      TEAMS.GSW.primary, TEAMS.GSW.secondary, resolveAccent(TEAMS.GSW)
    );
    expect(badgeColors(base, getBadge(SUPER_SEASON_BADGE)).fill).toBe(GOLD);
    expect(badgeColors(base, getBadge(SUPER_SEASON_BADGE)).fill)
      .toBe(themeFor('GSW', 'gold-foil').accentOnField);
    expect(badgeColors(base, getBadge(ROOKIE_BADGE)).fill).toBe(resolveAccent(TEAMS.GSW));
    expect(badgeColors(base, getBadge(ROOKIE_BADGE)).fill)
      .not.toBe(themeFor('GSW', 'green-accent').accentOnField);
  });

  it('badges a 2026-27 card from its OWN record, and gilds it in foil', () => {
    // REVISED 2026-09-02 (the Brandon Miller decision): a base-set card whose
    // best season IS the stats season now takes the GOLD FOIL along with the
    // gilded pill — "add the gold foil to him and just have his badge indicate
    // it was a 25-26 Super Season." The season still does not print (the card
    // is this season by definition); the foil rides the same salary tier the
    // pill does, so a demoted BEST SEASON card stays untreated.
    const html = render({
      card: { ...SPECIAL, badges: [SUPER_SEASON_BADGE] },
      set: CURRENT_SET,
    });
    expect(html).toContain('SUPER SEASON');
    expect(html).not.toContain('2015-16');
    expect(html).toContain('data-treatment="gold-foil"');
  });

  it('prints the HIGHEST-PRIORITY badge only, never two pills', () => {
    // THE 33 WHO ARE BOTH, and the one case the priority is ever asked about.
    // Their rookie season is the current one, so it is also their best one —
    // which is exactly why ROOKIE wins: "his best season" is a superlative over
    // a career of one season and says nothing, while "his rookie season" is the
    // fact. The sidebar still keeps its single badge row.
    const html = render({
      card: { ...SPECIAL, badges: [ROOKIE_BADGE, SUPER_SEASON_BADGE] },
      set: CURRENT_SET,
    });
    expect(html).toContain('25-26 ROOKIE');
    expect(html.match(/ROOKIE/g)).toHaveLength(1);
    // The outranked pill is gone entirely, not merely second.
    expect(html).not.toContain('SUPER SEASON');
  });

  it('was long asserted to be unreachable, and now prints on all 33', () => {
    // THIS TEST USED TO SAY THE OPPOSITE, and the reasoning it gave was sound:
    // a first season is trivially also a best season, so every rookie-badged
    // player carried the Super Season badge too, and with Super Season ranked
    // first the ROOKIE pill was structurally unreachable on a base card. All of
    // that was true. What it was not was intended — the user, seeing SUPER
    // SEASON on Cooper Flagg's card, asked for the rookie badge instead. So the
    // structural claim is now the other way round, and it is asserted over the
    // REAL badge file rather than over one contrived record.
    const overlap = POOL_PLAYERS.filter(p => p.badges.includes(ROOKIE_BADGE));
    expect(overlap.length).toBe(33);
    for (const player of overlap) {
      // Nested, still: every rookie is also a Super Season, which is the fact
      // that makes the priority a matter of which one is worth saying.
      expect(player.badges, player.name).toContain(SUPER_SEASON_BADGE);
      const html = render({ card: player, set: CURRENT_SET });
      expect(html, player.name).toContain('25-26 ROOKIE');
      expect(html, player.name).not.toContain('SUPER SEASON');
    }
    // And the other 107 print the Super Season pill — at whichever of its two
    // TIERS their salary puts them, which is the half of this that is new.
    const superSeason = POOL_PLAYERS.filter(
      p => p.badges.includes(SUPER_SEASON_BADGE) && !p.badges.includes(ROOKIE_BADGE)
    );
    expect(superSeason.length).toBe(107);
    for (const player of superSeason) {
      const html = render({ card: player, set: CURRENT_SET });
      expect(html, player.name).not.toContain('ROOKIE');
      // Every one of them says one of the two things, and never both.
      const gilded = player.salary >= SUPER_SEASON_MIN_SALARY;
      expect(html, player.name).toContain(gilded ? 'SUPER SEASON' : 'BEST SEASON');
      expect(html, player.name).not.toContain(gilded ? 'BEST SEASON' : 'SUPER SEASON');
      // REVISED 2026-09-02: the gilded tier now carries the gold foil on the
      // base set too (the Brandon Miller decision) — pill and foil move on the
      // same salary line, so they can never disagree about whether the card is
      // gold. The demoted tier stays untreated.
      if (gilded) {
        expect(html, player.name).toContain('data-treatment="gold-foil"');
      } else {
        expect(html, player.name).not.toContain('--treatment-');
      }
    }
  });

  it('tiers the base cards by the same line the Super Season set is tiered by', () => {
    // THE CONSEQUENCE WORTH STATING OUT LOUD. The pill is the pill: a $10 base
    // card wearing the gold while a $10 Super Season card does not would be the
    // rule contradicting itself about the same player in the same season. So
    // the 107 split 12/95 on the same constant, and card-badges.json's own
    // `printed` counts — computed through the same pickBadge — agree. (It was
    // 41/66 while the line was $700, and 13/94 while salary was a linear fit on
    // card attributes rather than a measure of what the card does in play; all
    // three numbers moved together, which is the property this test exists to
    // hold.)
    const superSeason = POOL_PLAYERS.filter(
      p => p.badges.includes(SUPER_SEASON_BADGE) && !p.badges.includes(ROOKIE_BADGE)
    );
    const gilded = superSeason.filter(p => p.salary >= SUPER_SEASON_MIN_SALARY);
    // 15/92 after the defBoost contest reprice — defence value now includes
    // conversion denial, and two badged defenders crossed the gilded line.
    expect(gilded.length).toBe(12);
    expect(superSeason.length - gilded.length).toBe(95);
    expect(BADGE_FILE.counts.printed[SUPER_SEASON_BADGE]).toBe(12);
    expect(BADGE_FILE.counts.printed[BEST_SEASON_BADGE]).toBe(95);
    expect(BADGE_FILE.counts.printed[ROOKIE_BADGE]).toBe(33);
  });

  it('lets a card badge itself on the finished set too, without a treatment', () => {
    // The mechanism is not special-cased to 2026-27 — that set is simply the
    // first whose cards carry their own. Asserted on a DIFFERENT untreated set
    // so nothing can start branching on the current one.
    //
    // AND THE PILL DATES ITSELF FROM THE SET, not from a constant: this set is
    // built from 2024-25 stats, one year back from the current one, so the same
    // record that reads "25-26 ROOKIE" over there reads "24-25 ROOKIE" here.
    const html = render({ card: { ...SPECIAL, badges: [ROOKIE_BADGE] }, set: FINISHED_SET });
    expect(html).toContain('24-25 ROOKIE');
    expect(html).not.toContain('2015-16');
  });

  it('ignores a badge id it does not know, and a badges field that is not a list', () => {
    for (const badges of [['championship-standout'], 'super-season', 42, null]) {
      const html = render({ card: { ...SPECIAL, badges }, set: CURRENT_SET });
      expect(html, JSON.stringify(badges)).not.toContain('--badge-fill');
      expect(html, JSON.stringify(badges)).not.toContain('SUPER SEASON');
    }
  });

  it('renders both special sets for every franchise without throwing', () => {
    for (const set of [SUPER_SEASON_SET, ROOKIE_SET]) {
      for (const team of [...Object.keys(TEAMS), ...Object.keys(HISTORICAL_TEAMS)]) {
        const html = render({ card: { ...SPECIAL, team }, set });
        expect(html, `${set} ${team}`).toContain('2015-16');
      }
    }
  });
});

// ── AWARD MARKS ─────────────────────────────────────────────────────────────
//
// "I'd like to add them to the sidebar above the badges if a player won them."
//
// Three things have to hold and they fail in three different ways. WHICH marks
// (the -1 rule, tested exhaustively in awards.test.js and here against the real
// generated file, because a trophy on the wrong card is the failure this
// feature cannot have). WHERE they sit (above the badge, in a bottom-anchored
// column, so a card that wins nothing is unchanged to the pixel). And WHAT
// happens while public/awards/ is empty, which is the state every card is in
// today.
describe('the award marks', () => {
  /** A card whose season carried hardware, in the shape the studio hands over. */
  const MARKED = {
    id: 'Shai_Gilgeous_Alexander',
    name: 'Shai Gilgeous-Alexander',
    team: 'OKC',
    pos: 'PG',
    speed: 17,
    power: 9,
    shotLine: 12,
    paintBoost: 1,
    threePtBoost: 2,
    defBoost: 1,
    salary: 1500,
    awards: ['MVP', 'CPOY'],
    chart: [
      { lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 },
      { lo: 3, hi: 9, pts: 3, reb: 1, ast: 1 },
      { lo: 10, hi: 19, pts: 4, reb: 1, ast: 2 },
      { lo: 20, hi: 99, pts: 6, reb: 2, ast: 3 },
    ],
  };

  it('prints a chip per award, above the badge and above the season', () => {
    // DOM order IS the order on the card — the column is a bottom-anchored flex
    // stack — so the assertion is on positions in the markup. Reading downward:
    // what he won, what kind of card this is, which season, then the team.
    const html = render({
      card: { ...MARKED, season: 2026, seasonLabel: '2025-26', badges: [SUPER_SEASON_BADGE] },
      set: SUPER_SEASON_SET,
    });
    const at = s => html.indexOf(s);
    expect(at('/awards/MVP.png')).toBeGreaterThan(-1);
    expect(at('/awards/MVP.png')).toBeLessThan(at('/awards/CPOY.png'));
    expect(at('/awards/CPOY.png')).toBeLessThan(at('SUPER SEASON'));
    expect(at('SUPER SEASON')).toBeLessThan(at('2025-26'));
    expect(at('2025-26')).toBeLessThan(at('/logos/OKC.png'));
  });

  it('draws no row at all for a card that won nothing', () => {
    // The contract that makes this safe to add to five sets at once: a card
    // without the feature carries none of it — no row, no custom properties —
    // so it renders exactly as it did before this existed.
    const { awards, ...unmarked } = MARKED;
    const html = render({ card: unmarked, set: CURRENT_SET });
    expect(html).not.toContain('--award-fill');
    expect(html).not.toContain('/awards/');
    for (const code of AWARD_CODES) expect(html, code).not.toContain(`>${code}<`);
  });

  it('ignores an awards field that is not a list of codes it knows', () => {
    // NBA1/DEF1 are the real undeclared codes now that All-Star is in — the
    // shape of the failure is unchanged, the example had to move.
    for (const awards of [['NBA1', 'DEF1'], 'MVP', 42, null, [null, {}]]) {
      const html = render({ card: { ...MARKED, awards }, set: CURRENT_SET });
      expect(html, JSON.stringify(awards)).not.toContain('--award-fill');
      expect(html, JSON.stringify(awards)).not.toContain('/awards/');
    }
  });

  it('emits the chip colours, and only for a card that has marks', () => {
    const html = render({ card: MARKED, set: CURRENT_SET });
    expect(html).toMatch(/--award-fill:\s*#[0-9A-F]{6}/i);
    expect(html).toMatch(/--award-ink:\s*#[0-9A-F]{6}/i);
  });

  it('falls back to the lettered chip when there is no art to point at', () => {
    // WHAT THE USER SEES TODAY, and the one thing a static render cannot show
    // by itself. public/awards/ is empty, so every <img> above 404s in a
    // browser and `onError` swaps in this chip — but markup rendered to a
    // string never fetches anything, so the swap is unreachable from `render`.
    // Same problem leagueMarkFallbackClass has, and the same answer: reach the
    // fallback by its OTHER door, an award with no path at all, and pin the
    // shape there.
    const chip = renderToStaticMarkup(
      React.createElement(AwardMark, { award: { code: 'XX', name: 'Not A Real Award' } })
    );
    expect(chip).toContain('>XX<');
    expect(chip).not.toContain('<img');
    // No browser broken-image glyph can reach the batch export, which is the
    // whole reason the fallback is a rendered element rather than a bare <img>.
    expect(chip).toContain('Not A Real Award');
    // The box does not change size when art arrives, so the column will not
    // shift under the user as they add files. The SLOT is what holds the size
    // now — `.award` is fitted into it with max-width/max-height rather than
    // sized — and the chip keeps a fixed near-square of its own, because a chip
    // stretched to a flexing 127px slot would read as a banner rather than as
    // a mark. One chip, one size: the count variants left with the wrap layout.
    expect(cssBlock('.award')).toMatch(/max-width:\s*100%/);
    expect(cssBlock('.award')).toMatch(/max-height:\s*100%/);
    expect(cssBlock('.award')).toMatch(/object-fit:\s*contain/);
    const chipBlock = cssBlock('.awardFallback');
    expect(pxIn(chipBlock, 'width')).toBeLessThanOrEqual(pxIn(cssBlock('.awardSlot'), 'width'));
    expect(pxIn(chipBlock, 'height')).toBeLessThanOrEqual(pxIn(cssBlock('.awardSlot'), 'height'));
  });

  it('points at public/awards/{CODE}.png through the app base path', () => {
    // The <img> src the fallback replaces. Asserted through logoSrc rather than
    // as a literal, because a bare path 404s under this app's base — the exact
    // bug that once made every team logo silently fall back.
    for (const code of AWARD_CODES) {
      const stem = getAward(code).file ?? code;
      expect(logoSrc(awardImagePath(code)), code).toContain(`/awards/${stem}.png`);
      expect(logoSrc(awardImagePath(code)).endsWith(`/awards/${stem}.png`), code).toBe(true);
    }
    // Seven of the eight are named by their code. The ring is the exception —
    // it is in no awards column, so nothing outside this repo dictates its
    // spelling and the user's own filename stands. See AWARDS in awards.js.
    expect(logoSrc(awardImagePath('CHAMP')).endsWith('/awards/LarryOBrien.png')).toBe(true);
  });

  it('stacks the marks bottom-up above the badge, and every count fits the box', () => {
    // "stacking awards starting bottom up, so like above the logo or
    // year/badge" — the marks are the bottom-anchored sidebar stack's TOP row,
    // and the room to grow is the box top moving to the chevron's foot. Both
    // bounds re-derived from the stylesheet so a move fails here rather than
    // overlapping at export time.
    const bar = cssBlock('.sidebar');
    const chev = cssBlock('.chevronTop');
    expect(pxIn(bar, 'top')).toBeGreaterThanOrEqual(pxIn(chev, 'top') + pxIn(chev, 'height'));
    // The box still ends at y=1152, where the printed art puts the last row.
    expect(pxIn(bar, 'top') + pxIn(bar, 'height')).toBe(1152);

    // ONE PER ROW: a column, not a wrap — the wrap was what shrank the
    // All-Star to seat the MVP and the Clutch trophy beside each other.
    const block = cssBlock('.awards');
    expect(block).toMatch(/flex-direction:\s*column/);
    expect(block).not.toMatch(/flex-wrap/);

    // Fewer marks, bigger marks — and the four-mark slot no smaller than the
    // ONE-mark slot of the wrap era (82px).
    const heights = [
      pxIn(cssBlock('.awardSlotOne'), 'height'),
      pxIn(cssBlock('.awardSlotTwo'), 'height'),
      pxIn(cssBlock('.awardSlotThree'), 'height'),
      pxIn(cssBlock('.awardSlot'), 'height'),
    ];
    for (let i = 1; i < heights.length; i += 1) expect(heights[i]).toBeLessThan(heights[i - 1]);
    expect(heights[3]).toBeGreaterThanOrEqual(82);
    // Every slot takes the full usable width of the bar.
    for (const slot of ['.awardSlot', '.awardSlotOne', '.awardSlotTwo', '.awardSlotThree']) {
      expect(pxIn(cssBlock(slot), 'width')).toBe(pxIn(block, 'width'));
    }

    // WORST CASE FITS BY ARITHMETIC: the tallest awards block over the
    // tallest stack, inside the box. The stack below the marks needs at most
    // 488px: the pre-move box was 640px and held it PLUS a 152px wrap-era
    // awards block — 640 - 152 = 488, gap included, measured by that layout
    // shipping. So the marks may use everything above that line.
    expect(MAX_CARD_AWARDS).toBe(4);
    const gap = pxIn(cssBlock('.awards'), 'gap');
    const worstAwards = MAX_CARD_AWARDS * pxIn(cssBlock('.awardSlot'), 'height') + (MAX_CARD_AWARDS - 1) * gap;
    expect(worstAwards).toBeLessThanOrEqual(pxIn(bar, 'height') - 488);

    // The longest declared code, on the same conservative 0.7em average advance
    // the name budget and the badge budget use, against the chip.
    const size = pxIn(cssBlock('.awardFallback'), 'font-size');
    const chipWidth = pxIn(cssBlock('.awardFallback'), 'width');
    for (const code of AWARD_CODES) {
      expect(code.length * 0.7 * size, `${code} at ${size}px`).toBeLessThanOrEqual(chipWidth);
    }
  });

  it('renders every declared code on every franchise without throwing', () => {
    for (const code of AWARD_CODES) {
      for (const team of [...Object.keys(TEAMS), ...Object.keys(HISTORICAL_TEAMS)]) {
        const html = render({ card: { ...MARKED, team, awards: [code] }, set: CURRENT_SET });
        const stem = getAward(code).file ?? code;
        expect(html, `${code} ${team}`).toContain(`/awards/${stem}.png`);
      }
    }
  });
});

// ── THE REAL DATA, JOINED ───────────────────────────────────────────────────
describe('the generated award file, on the cards it belongs to', () => {
  // The unit tests in awards.test.js prove the -1 rule against strings. This
  // proves it against the file that will actually be shipped, on the two names
  // the whole feature is judged by.

  const marked = set => (AWARDS_FILE?.sets?.[set] ?? []).filter(r => r.awards.length > 0);

  it('was generated, and covers the five sets with Basketball-Reference seasons', () => {
    expect(AWARDS_FILE).not.toBeNull();
    expect(Object.keys(AWARDS_FILE.sets).sort()).toEqual(
      [CURRENT_SET, ROOKIE_SET, SUMMER_STANDOUTS_SET, SUPER_SEASON_SET, 'dissonance'].sort()
    );
    // The WNBA sets are absent, and that is a data gap rather than a decision:
    // Basketball-Reference serves that league under a different path and the
    // adapter for it reads no awards column. Absent means no marks, not an error.
    for (const set of [WNBA_SET, WNBA_SUPER_SEASON_SET]) {
      expect(AWARDS_FILE.sets[set], set).toBeUndefined();
    }
  });

  it('gives Shai Gilgeous-Alexander an MVP on his 2026-27 card', () => {
    const sga = marked(CURRENT_SET).find(r => r.id === 'Shai_Gilgeous_Alexander');
    expect(sga.raw).toContain('MVP-1');
    // MVP, Clutch Player and the All-Star selection, in priority order — three
    // of the four the wrapped row draws, so nothing is dropped.
    expect(sga.awards).toEqual(['MVP', 'CPOY', 'AS']);
    expect(sga.awards.length).toBeLessThan(MAX_CARD_AWARDS);
    // Oklahoma City won 2025, not 2026, so his BASE card carries no ring — the
    // season selection doing its job. His Super Season card, which IS 2024-25,
    // carries one instead, and that pair is the clearest evidence in the file
    // that the ring is read per card rather than per set.
    expect(sga.awards).not.toContain('CHAMP');
    expect(sga.champion).toBeNull();
    // AND THE SUPER SEASON CARD IS THE FULLEST IN THREE SETS: he won the 2025
    // MVP, the 2025 Finals MVP and the title, and made the All-Star team —
    // four marks, exactly MAX_CARD_AWARDS, nothing dropped. The Finals MVP is
    // the mark the base card cannot have and this one must, off a column the
    // base card's season has its own row in.
    const ss = marked(SUPER_SEASON_SET).find(r => r.id === 'Shai_Gilgeous_Alexander');
    expect(ss.season).toBe(2025);
    expect(ss.awards).toEqual(['MVP', 'FMVP', 'CHAMP', 'AS']);
    expect(ss.awards).toHaveLength(MAX_CARD_AWARDS);
    expect(ss.champion).toBe('OKC');
    expect(ss.rawPost).toBe('Finals MVP-1');
    expect(sga.rawPost).toBeNull();
    const html = render({
      card: POOL_PLAYERS.find(p => p.id === sga.id),
      set: CURRENT_SET,
    });
    expect(html).toContain('/awards/MVP');
    expect(html).toContain('/awards/CPOY');
    expect(html).toContain('/awards/AS');
  });

  it('gives Luka Dončić an ALL-STAR mark and no MVP, off the same row', () => {
    // THE TEST THIS FEATURE EXISTS TO PASS, now carrying both halves. He
    // finished FOURTH in the MVP voting and made the All-Star team, and the two
    // facts live in one string: `MVP-4,CPOY-8,AS,NBA1`. A parser that read the
    // code and not the rank would print an MVP trophy on his card, on Donovan
    // Mitchell's and on eight more every season; admitting All-Star must not
    // have softened that by a hair, and this is where it is checked against the
    // real generated file rather than against an invented string.
    const luka = (AWARDS_FILE.sets[CURRENT_SET] ?? []).find(r => r.id === 'Luka_Doncic');
    expect(luka.raw).toContain('MVP-4');
    expect(luka.raw).toContain('AS');
    expect(luka.awards).toEqual(['AS']);
    const html = render({
      card: POOL_PLAYERS.find(p => p.id === 'Luka_Doncic'),
      set: CURRENT_SET,
    });
    expect(html).toContain('/awards/AS');
    // Not the MVP he did not win, not the Clutch Player he came eighth in, and
    // not the All-NBA selection this build does not declare.
    expect(html).not.toContain('/awards/MVP');
    expect(html).not.toContain('/awards/CPOY');
    expect(html).not.toContain('/awards/NBA1');
    // He is a marked card now, so the chip colours DO appear — the contract
    // that a card without marks carries none of them is asserted elsewhere.
    expect(html).toContain('--award-fill');
  });

  it('never marks a card on anything but a -1 win or a declared selection', () => {
    // The rule, restated over every record in the file rather than over two —
    // and it is TWO rules now, so each code is checked against the one that
    // applies to it. A trophy needs its -1 in the raw row; a selection needs
    // the bare token. Nothing else can put a mark on a card.
    const selections = new Set(AWARD_CODES.filter(c => getAward(c).selection));
    // The ring is EXTERNAL — in no awards string at all — so it is checked
    // against the roster join instead, in its own test below. A record can now
    // exist with `raw: null` for that reason: most of a title-winning roster
    // wins nothing individually, and fourteen of the Knicks' twenty have no
    // awards string.
    const external = new Set(AWARD_CODES.filter(c => getAward(c).external));
    // AND A THIRD RULE NOW: a postseason code is earned by the PLAYOFF column
    // and must be checked against `rawPost`, never against `raw`. Checking it
    // against the wrong string is the mistake this split exists to make
    // impossible, so the test makes the same split the generator does.
    const postSeason = new Set(AWARD_CODES.filter(c => getAward(c).postSeason));
    for (const records of Object.values(AWARDS_FILE.sets)) {
      for (const r of records) {
        const tokens = (r.raw ?? '').split(',').map(t => t.trim());
        const postTokens = (r.rawPost ?? '').split(',').map(t => t.trim());
        // A record with NO regular-season string exists only for a fact that
        // was never in that column: the ring, the Finals MVP, or both.
        if (r.raw === null) {
          expect(r.awards.every(c => external.has(c) || postSeason.has(c)), r.name).toBe(true);
        }
        for (const code of r.awards) {
          if (external.has(code)) continue;
          // Every code it recorded is one this build declares and can draw.
          expect(AWARD_CODES, `${r.name} ${code}`).toContain(code);
          const where = postSeason.has(code) ? postTokens : tokens;
          const wanted = selections.has(code) ? code : `${getAward(code).token ?? code}-1`;
          expect(
            where.includes(wanted),
            `${r.name} ${r.season} ${code} not earned by ${postSeason.has(code) ? r.rawPost : r.raw}`
          ).toBe(true);
        }
        // And no trophy ever rides in on a selection's rule.
        for (const code of r.awards) {
          if (selections.has(code) || external.has(code)) continue;
          const where = postSeason.has(code) ? postTokens : tokens;
          expect(where, `${r.name} ${code}`).not.toContain(getAward(code).token ?? code);
        }
        // THE PLAYOFF COLUMN CANNOT REACH A REGULAR-SEASON MARK. Brunson's
        // `Finals MVP-1` sits next to nothing else, and no card anywhere takes
        // a non-postseason code out of that string.
        for (const code of r.awards) {
          if (postSeason.has(code) || external.has(code)) continue;
          expect(
            postTokens.includes(selections.has(code) ? code : `${code}-1`),
            `${r.name} ${code} came out of the PLAYOFF column`
          ).toBe(false);
        }
      }
    }
  });

  it('puts every rookie set mark on a Rookie of the Year and nothing else', () => {
    // A season-selection sanity check that no amount of string parsing gives
    // you: the rookie set reads each card's ROOKIE season, so ROY is the only
    // trophy that can land there. The count moved 17 -> 19 when the Summer
    // Standouts joined the awards plan, and 19 -> 25 when the standout
    // newcomers' rookie years arrived — six of the nineties rookies won
    // something (five ROYs and Shaq's ROY+All-Star among them).
    const rookies = marked(ROOKIE_SET);
    expect(rookies.length).toBe(25);
    // ALL-STAR DID NOT MOVE THIS SET AT ALL — no player in the rookie pool was
    // an All-Star in his rookie year. Blake Griffin (`MVP-10,ROY-1,AS`,
    // 2010-11) is the case that would have, and he is retired and out of the
    // pool. Pinned so that a pool change which adds one is visible here.
    expect(AWARDS_FILE.counts[ROOKIE_SET].byCode.AS).toBe(1);
    // THE RING IS THE ONLY OTHER THING A ROOKIE CARD CAN CARRY, and it is a
    // team fact rather than a trophy: six of them won a title in their first
    // year. Nobody holds both — a Rookie of the Year on a champion would, and
    // none of the eleven is one. ONE EXCEPTION since the nineties arrived:
    // rookie Shaquille O'Neal was an All-Star, the only rookie in the set who
    // was — so his card reads ROY+AS and everyone else's stays one mark.
    for (const r of rookies) {
      if (r.name === "Shaquille O'Neal") {
        expect(r.awards).toEqual(['ROY', 'AS']);
        continue;
      }
      expect(r.awards, r.name).toEqual(r.champion ? ['CHAMP'] : ['ROY']);
    }
    expect(rookies.filter(r => r.awards.includes('ROY'))).toHaveLength(17);
    expect(rookies.filter(r => r.awards.includes('CHAMP'))).toHaveLength(8);
    // And no Rookie of the Year is on a Super Season card, for the same reason
    // from the other side: a player whose best season is his rookie one is
    // excluded from that set.
    for (const r of marked(SUPER_SEASON_SET)) {
      expect(r.awards, r.name).not.toContain('ROY');
    }
  });

  it('reads each set from the right season, which is the point of the feature', () => {
    // A base card shows the season it is built FROM (2025-26 stats -> 2026);
    // a Super Season or Rookie card shows ITS OWN season. Getting this wrong is
    // invisible on screen and wrong on every historical card.
    for (const r of AWARDS_FILE.sets[CURRENT_SET]) expect(r.season, r.name).toBe(2026);
    for (const set of [SUPER_SEASON_SET, ROOKIE_SET]) {
      const cards = new Map(SOURCES[set].players.map(c => [c.id, c]));
      for (const r of AWARDS_FILE.sets[set]) {
        expect(r.season, `${set} ${r.name}`).toBe(cards.get(r.id)?.season);
      }
    }
  });

  it('reaches the special sets through the studio, not only the file', () => {
    // The join the studio actually performs. Nikola Jokić's 2021-22 is a Super
    // Season card whose season carried an MVP, which is the case the whole
    // feature was argued for.
    const jokic = SOURCES[SUPER_SEASON_SET].players.find(c => c.id === 'Nikola_Jokic');
    expect(jokic.season).toBe(2022);
    expect(jokic.awards).toEqual(['MVP', 'AS']);
    const html = render({ card: jokic, set: SUPER_SEASON_SET });
    expect(html).toContain('/awards/MVP');
    expect(html).toContain('/awards/AS');
    expect(html).toContain('SUPER SEASON');
    expect(html).toContain('2021-22');
  });
});
