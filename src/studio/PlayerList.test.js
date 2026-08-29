// Structure-only assertions via react-dom/server, matching the convention in
// src/cards/CardTemplate.test.js — no DOM, no testing-library. Drag and drop
// is a browser interaction and is verified by hand in the studio, not here.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import PlayerList from './PlayerList.jsx';
import { filterPlayers, SOURCES } from './players.js';

const PLAYERS = [
  { id: 'Kevin_Durant', name: 'Kevin Durant', team: 'HOU', pos: 'SF' },
  { id: 'Luka_Don_i_', name: 'Luka Dončić', team: 'LAL', pos: 'PG' },
  { id: 'Tyrese_Maxey', name: 'Tyrese Maxey', team: 'PHI', pos: 'PG' },
];

const noop = () => {};

function render(overrides = {}) {
  const photoIds = overrides.photoIds ?? new Set();
  const props = {
    players: PLAYERS,
    visible: PLAYERS,
    photoIds,
    selectedId: PLAYERS[0].id,
    onSelect: noop,
    onDropFile: noop,
    droppingId: null,
    onDropTargetChange: noop,
    uploadingId: null,
    query: '',
    onQueryChange: noop,
    missingOnly: false,
    onMissingOnlyChange: noop,
    listRef: null,
    ...overrides,
    photoIds,
  };
  return renderToStaticMarkup(React.createElement(PlayerList, props));
}

/** The value of `attr` for each row, in document order. */
const rowAttrs = (html, attr) =>
  [...html.matchAll(new RegExp(`data-player-id="([^"]+)"[^>]*${attr}="([^"]*)"`, 'g'))].map(m => [
    m[1],
    m[2],
  ]);

describe('the player list', () => {
  it('renders one row per visible player', () => {
    const html = render();
    for (const player of PLAYERS) expect(html).toContain(player.name);
    expect(html.match(/data-player-id=/g)).toHaveLength(3);
  });

  it('shows each player team and position', () => {
    expect(render()).toContain('HOU SF');
  });

  it('marks who has a photo and who does not', () => {
    const html = render({ photoIds: new Set(['Kevin_Durant']) });
    expect(rowAttrs(html, 'data-has-photo')).toEqual([
      ['Kevin_Durant', 'true'],
      ['Luka_Don_i_', 'false'],
      ['Tyrese_Maxey', 'false'],
    ]);
  });

  it('reports progress against the whole set, not the filtered view', () => {
    const html = render({
      photoIds: new Set(['Kevin_Durant']),
      visible: [PLAYERS[0]],
    });
    expect(html).toContain('1 / 3 photos');
    expect(html).toContain('2 to go');
    expect(html).toContain('showing 1 of 3');
  });

  it('marks the selected row', () => {
    const html = render({ selectedId: 'Tyrese_Maxey' });
    const selected = html.match(/aria-selected="true"[\s\S]*?data-player-id="([^"]+)"/);
    expect(selected[1]).toBe('Tyrese_Maxey');
  });

  it('says so when a filter matches nobody instead of showing a blank panel', () => {
    const html = render({ visible: [], query: 'zzzz' });
    expect(html).toContain('no players match that filter');
    expect(html).toContain('showing 0 of 3');
  });

  it('shows an in-flight upload on the row it belongs to', () => {
    expect(render({ uploadingId: 'Luka_Don_i_' })).toContain('saving…');
  });

  it('renders the whole 331-player pool without choking', () => {
    const players = SOURCES.pool.players;
    const html = render({ players, visible: players });
    expect(html.match(/data-player-id=/g)).toHaveLength(331);
    expect(html).toContain('0 / 331 photos');
  });

  it('renders a filtered pool view end to end', () => {
    const players = SOURCES.pool.players;
    const photoIds = new Set([players[0].id]);
    const visible = filterPlayers(players, { query: 'LAL', missingOnly: true, photoIds });
    const html = render({ players, visible, photoIds, missingOnly: true, query: 'LAL' });
    expect(visible.length).toBeGreaterThan(0);
    expect(html.match(/data-player-id=/g)).toHaveLength(visible.length);
    expect(html).toContain(`showing ${visible.length} of 331`);
  });
});
