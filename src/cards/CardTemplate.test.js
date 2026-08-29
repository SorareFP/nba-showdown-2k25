// Tests render the component with react-dom/server rather than
// @testing-library/react. Rationale: everything asserted here — that a card
// renders at all, that missing fields degrade to placeholders, and WHICH chart
// row carries the shot-line arrow — is structural and fully visible in static
// markup. Going the testing-library route would mean adding two devDeps and
// switching the suite (or this file) to a jsdom environment to buy assertions
// we don't need. react-dom is already a production dependency here.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import CardTemplate, {
  CARD_WIDTH,
  CARD_HEIGHT,
  formatRollRange,
  findShotLineIndex,
  pickAccent,
  nameFontSize,
} from './CardTemplate.jsx';
import { CARDS } from '../game/cards.js';
import { TEAMS } from './teams.js';

const render = props => renderToStaticMarkup(React.createElement(CardTemplate, props));

/** The <tr> blocks of the rendered chart table, in document order. */
const rows = html => html.match(/<tr>.*?<\/tr>/gs) ?? [];

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
  it('lands on the row whose roll range contains the shot line', () => {
    const html = render({ card: LEBRON_08_09 });
    const body = rows(html);
    // body[0] is the header row; tiers start at index 1.
    const arrowRows = body
      .map((row, i) => (row.includes('shot-line-arrow') ? i : -1))
      .filter(i => i !== -1);

    expect(arrowRows).toEqual([4]); // exactly one arrow, on the "14-20" row
    expect(body[4]).toContain('14-20');
  });

  it('renders no arrow when the card has no shot line', () => {
    const { shotLine, ...noShotLine } = LEBRON_08_09;
    expect(render({ card: noShotLine })).not.toContain('shot-line-arrow');
  });

  it('renders no arrow when no tier contains the shot line', () => {
    expect(render({ card: { ...LEBRON_08_09, shotLine: 0 } })).not.toContain('shot-line-arrow');
  });

  it('lands on the right row for every card in the shipped 306-card set', () => {
    // Exhaustive rather than sampled: a shot line sitting exactly on a tier
    // boundary (lo or hi) is the off-by-one case, and 306 cards is cheap to
    // render. Every card must get exactly one arrow, on the containing tier.
    const wrong = [];
    for (const card of CARDS) {
      const expected = card.chart.findIndex(t => card.shotLine >= t.lo && card.shotLine <= t.hi);
      const body = rows(render({ card })).slice(1); // drop the header row
      const actual = body.findIndex(r => r.includes('shot-line-arrow'));
      const arrowCount = body.filter(r => r.includes('shot-line-arrow')).length;
      if (actual !== expected || arrowCount !== 1) {
        wrong.push({ id: card.id, shotLine: card.shotLine, expected, actual, arrowCount });
      }
    }
    expect(wrong).toEqual([]);
  });

  it('covers cards whose shot line sits exactly on a tier boundary', () => {
    // Guards the assertion above from silently becoming vacuous.
    const boundary = CARDS.filter(c =>
      c.chart.some(t => t.lo === c.shotLine || t.hi === c.shotLine)
    );
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

describe('findShotLineIndex', () => {
  const chart = LEBRON_08_09.chart;
  it('finds the containing tier', () => {
    expect(findShotLineIndex(chart, 14)).toBe(3);
    expect(findShotLineIndex(chart, 1)).toBe(0);
    expect(findShotLineIndex(chart, 99)).toBe(4);
  });
  it('returns -1 rather than defaulting to row 0', () => {
    expect(findShotLineIndex(chart, undefined)).toBe(-1);
    expect(findShotLineIndex(chart, null)).toBe(-1);
    expect(findShotLineIndex(undefined, 14)).toBe(-1);
    expect(findShotLineIndex([], 14)).toBe(-1);
  });
});

describe('pickAccent', () => {
  it('picks the brighter of the two brand colors', () => {
    expect(pickAccent('#1D4289', '#FFC72C')).toBe('#FFC72C'); // Warriors
  });
  it('never returns a color too dark to read on the navy field', () => {
    // Bulls: Red #BA0C2F / Black #010101 — both dark, neither usable as text.
    expect(pickAccent('#BA0C2F', '#010101')).toBe('#E6ECF8');
    // Timberwolves: mid-tone blue on a navy card, verified too dim in-studio.
    expect(pickAccent('#0C2340', '#236192')).toBe('#E6ECF8');
    // Spurs: official Silver is bright enough to keep.
    expect(pickAccent('#9EA2A2', '#010101')).toBe('#9EA2A2');
  });

  it('produces a readable accent for every one of the 30 teams', () => {
    for (const [abbr, team] of Object.entries(TEAMS)) {
      const accent = pickAccent(team.primary, team.secondary);
      expect(accent, abbr).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(accent, abbr).not.toBe('#000000');
    }
  });

  it('survives a garbage override color rather than crashing', () => {
    expect(pickAccent(undefined, 'not-a-color')).toBe('#E6ECF8');
  });
});

describe('nameFontSize', () => {
  it('caps at the display size for short names', () => {
    expect(nameFontSize('LeBron James')).toBe(78);
  });
  it('shrinks long names so they fit the card height', () => {
    const long = nameFontSize('Shai Gilgeous-Alexander');
    expect(long).toBeLessThan(78);
    expect(long).toBeGreaterThan(30);
  });
  it('never returns NaN for a missing name', () => {
    expect(Number.isFinite(nameFontSize(undefined))).toBe(true);
  });

  it('keeps every name in the shipped set within the card', () => {
    for (const card of CARDS) {
      const px = nameFontSize(card.name);
      expect(px * 0.55 * card.name.length, card.name).toBeLessThanOrEqual(880);
    }
  });
});
