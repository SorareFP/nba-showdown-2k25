// THE LIVE SERIES TABLE (2026-10-28; the user: "a leaderboard-style table of
// all players and their details. Then add a little 'collected' badge"). The
// rows' arithmetic is liveMoves.test.js; this is what the table draws.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const { default: LiveMovers } = await import('./LiveMovers.jsx');

const card = (id, name, salary, over = {}) => ({
  id, name, team: 'MIA', pos: 'C', set: 'live',
  salary, speed: 9, power: 16, shotLine: 16, paintBoost: 2, threePtBoost: 1, defBoost: 2,
  chart: [{ lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 }, { lo: 3, hi: 9, pts: 0, reb: 1, ast: 1 }, { lo: 10, hi: 99, pts: 2, reb: 1, ast: 1 }],
  live: { games: { real: 4 } },
  ...over,
});
const cards = [card('A_One', 'Bam Adebayo', 910), card('B_Two', 'Victor Wembanyama', 2210, { speed: 11 })];
const history = {
  fields: ['salary', 'speed', 'power', 'shotLine', 'paintBoost', 'threePtBoost', 'defBoost', 'games'],
  nights: ['2026-10-22', '2026-10-27', '2026-10-28'],
  players: {
    A_One: {
      rows: [[1430, 10, 16, 16, 3, 2, 3, 0], [960, 9, 16, 16, 2, 1, 2, 3], [910, 9, 16, 16, 2, 1, 2, 4]],
      charts: { 0: [[1, 2, 0, 0, 0], [3, 8, 0, 1, 0], [9, 99, 3, 2, 1]], 1: [[1, 2, 0, 0, 0], [3, 99, 1, 1, 1]], 2: [[1, 2, 0, 0, 0], [3, 9, 0, 1, 1], [10, 99, 2, 1, 1]] },
    },
    B_Two: {
      rows: [[1790, 11, 19, 15, 3, 1, 5, 0], [2320, 11, 19, 15, 3, 1, 5, 3], [2210, 11, 19, 15, 3, 1, 5, 4]],
      charts: { 0: [[1, 99, 1, 0, 0]] },
    },
  },
};
const render = props => renderToStaticMarkup(<LiveMovers cards={cards} history={history} {...props} />);
// A row runs to the next row (its charts have rows of their own).
const rowOf = (html, id) => {
  const rest = html.slice(html.indexOf(`data-live-row="${id}"`) + 1);
  const next = rest.indexOf('data-live-row=');
  return next < 0 ? rest : rest.slice(0, next);
};

describe('the Live Series table', () => {
  it('lists every Live card, the biggest salary move first', () => {
    const html = render({});
    expect(html.indexOf('data-live-row="A_One"')).toBeLessThan(html.indexOf('data-live-row="B_Two"'));
    expect(html).toContain('Bam Adebayo');
    expect(html).toContain('Victor Wembanyama');
  });

  it('marks the cards in your collection', () => {
    const html = render({ collection: { 'live:B_Two': { count: 1 } } });
    expect(rowOf(html, 'B_Two')).toContain('COLLECTED');
    expect(rowOf(html, 'A_One')).not.toContain('COLLECTED');
  });

  it('opens on the 7-day window and offers the other three', () => {
    const html = render({});
    for (const label of ['Latest night', '7 days', '21 days', 'Season']) expect(html).toContain(label);
    expect(html).toMatch(/aria-pressed="true"[^>]*>7 days/);
  });

  it('shows salary then and now, the rarity crossing, and the move', () => {
    const row = rowOf(render({}), 'A_One');
    expect(row).toContain('$1430');
    expect(row).toContain('$910');
    expect(row).toContain('Legendary');
    expect(row).toContain('Rare');
    expect(row).toMatch(/data-move="down"[^>]*>▼\$520/);
  });

  it('draws the chart then and now, today\'s marked roll for roll', () => {
    const row = rowOf(render({}), 'A_One');
    expect(row).toContain('data-chart="then"');
    expect(row).toContain('data-chart="now"');
    // The blank 1-2 row is not printed, on either chart.
    expect(row).not.toContain('>1-2<');
    // Roll 10 paid 3/2/1 and pays 2/1/1.
    expect(row).toMatch(/data-cell="down"[^>]*>2</);
  });

  it('keeps only your cards when the box is ticked, and says so when you have none', () => {
    const html = render({ collection: {}, initialOnlyMine: true });
    expect(html).not.toContain('data-live-row=');
    expect(html).toMatch(/no Live cards/i);
  });

  it('reads with no history yet', () => {
    const html = render({ history: null });
    expect(html).toContain('data-live-row="A_One"');
    expect(rowOf(html, 'A_One')).not.toContain('data-move="down"');
  });
});
