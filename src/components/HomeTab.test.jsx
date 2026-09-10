// THE HOME PAGE, RENDERED WITHOUT A BROWSER OR A SIGN-IN. Static markup, so
// effects do not run and nothing touches Firebase: what renders is the first
// paint — the greeting, the news, the panels' loading and empty states — which
// is exactly the page that used to be blank.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../firebase/AuthProvider.jsx', () => ({
  useAuth: () => ({ user: { uid: 'u1', displayName: 'Hoops Person' }, loading: false }),
}));
vi.mock('../firebase/CardStatsProvider.jsx', () => ({
  useCardStats: () => ({ stats: {}, refresh: () => {} }),
}));
vi.mock('../firebase/collection.js', () => ({ getUserData: async () => null, loadClaims: async () => ({}) }));
vi.mock('../firebase/seasons.js', () => ({ listSeasons: async () => [] }));
vi.mock('../firebase/leagues.js', () => ({ listMyLeagues: async () => [], seasonOfLeague: () => null }));
vi.mock('../firebase/games.js', () => ({ loadRemoteGame: async () => null }));

import HomeTab from './HomeTab.jsx';

const html = props => renderToStaticMarkup(<HomeTab {...props} />);

describe('HomeTab', () => {
  it('greets the player and shows every panel on first paint', () => {
    const out = html({});
    expect(out).toContain('Welcome back, Hoops');
    expect(out).toContain('Seasons in progress');
    expect(out).toContain('Closest collections');
    expect(out).toContain('Latest news');
    expect(out).toContain('Your career leaders');
    expect(out).toContain('Go to the Pack Shop');
  });

  it('leads the news with the Starter Pack while it is unopened', () => {
    const out = html({ starter: { opened: false, favorite: false, bonusSeen: true } });
    expect(out).toContain('Your Starter Pack is waiting');
    expect(out.indexOf('Your Starter Pack is waiting')).toBeLessThan(out.indexOf('Undo a placement'));
    expect(html({ starter: { opened: true } })).not.toContain('Your Starter Pack is waiting');
  });

  it('shows the empty career panel for an account that has not played', () => {
    expect(html({})).toContain('Play one and the leaders show up here');
  });
});
