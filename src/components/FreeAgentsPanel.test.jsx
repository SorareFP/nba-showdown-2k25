// The Free Agents panel on first paint, without a browser or a sign-in.
// Effects do not run under static rendering, so this is the loading state:
// the heading, the search box, the limit, and nothing that touches Firebase.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../ui/dialogs.jsx', () => ({ useDialogs: () => ({ toast: () => {}, ask: async () => true }) }));
vi.mock('../firebase/freeAgents.js', () => ({ requestCard: async () => ({}), myCardRequests: async () => [] }));

import FreeAgentsPanel from './FreeAgentsPanel.jsx';

describe('FreeAgentsPanel', () => {
  it('renders the search, the three-request limit, and loading states before anything arrives', () => {
    const out = renderToStaticMarkup(<FreeAgentsPanel uid="u1" loadIndex={() => new Promise(() => {})} />);
    expect(out).toContain('Free Agents');
    expect(out).toContain('Search a player');
    expect(out).toContain('Up to 3 requests can wait at once');
    expect(out).toContain('Loading the archive');
    expect(out).toContain('Your requests');
  });
});
