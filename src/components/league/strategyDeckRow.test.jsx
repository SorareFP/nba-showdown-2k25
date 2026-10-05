// THE TEAM PICKER SAYS WHICH STRATEGY DECK COMES WITH THE TEAM, even when you
// have built none (Ryan, through the suggestion box, 2026-10-02: "when
// starting a season you aren't prompted if there are none built ... I would
// consider changing to strategy deck or at least prompting to select a deck").
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../firebase/savedTeams.js', () => ({ loadTeams: async () => [] }));
vi.mock('../../firebase/savedDecks.js', () => ({ loadDecks: async () => [] }));

const { StrategyDeckRow } = await import('./RosterPicker.jsx');
const html = props => renderToStaticMarkup(<StrategyDeckRow {...props} />);

describe('the strategy deck row', () => {
  it('with no deck saved: names the default deck and offers to build one, with the hint', () => {
    const out = html({ decks: [], loaded: true, hint: 'Fixed for the whole season.' });
    expect(out).toContain('data-no-strategy-deck="true"');
    expect(out).toContain('Strategy deck');
    expect(out).toContain('Default deck');
    expect(out).toContain('Build your own');
    expect(out).toContain('Fixed for the whole season.');
  });

  it('says nothing until the decks have loaded, so it never flashes "no deck" at someone who has one', () => {
    expect(html({ decks: [], loaded: false })).toBe('');
  });

  it('with decks saved: a choice, the default fifty first', () => {
    const out = html({ decks: [{ id: 'd1', name: 'Pace and Space' }], loaded: true, deckId: 'default' });
    expect(out).toContain('<select');
    expect(out).toMatch(/<option value="default"[^>]*>The default fifty<\/option>/);
    expect(out).toContain('Pace and Space');
    expect(out).not.toContain('Build your own');
  });

  it('opens Collection, Strategy Decks through the event the app listens for', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8');
    const picker = readFileSync(new URL('./RosterPicker.jsx', import.meta.url), 'utf8');
    expect(picker).toContain("new CustomEvent('showdown-open-decks')");
    expect(app).toMatch(/addEventListener\('showdown-open-decks'/);
    expect(app).toMatch(/setCollectionView\('decks'\)/);
  });
});
