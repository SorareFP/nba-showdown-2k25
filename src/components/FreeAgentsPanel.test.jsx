// The Free Agents panel on first paint, without a browser or a sign-in.
// Effects do not run under static rendering, so this is the loading state:
// the heading, the search box, the limit, and nothing that touches Firebase.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../ui/dialogs.jsx', () => ({ useDialogs: () => ({ toast: () => {}, ask: async () => true }) }));
vi.mock('../firebase/freeAgents.js', () => ({
  requestCard: async () => ({}), myCardRequests: async () => [],
  signFreeAgent: async () => ({}), declineCardRequest: async () => ({}),
}));

import FreeAgentsPanel from './FreeAgentsPanel.jsx';

describe('FreeAgentsPanel', () => {
  it('renders the search, the three-request limit, and loading states before anything arrives', () => {
    const out = renderToStaticMarkup(<FreeAgentsPanel uid="u1" loadIndex={() => new Promise(() => {})} />);
    expect(out).toContain('Free Agents');
    expect(out).toContain('Search a player');
    expect(out).toContain('can wait at once');
    // Where the archive stops, said up front (the user: "we need to say where the cutoff date is").
    expect(out).toContain('NBA regular seasons from 1984-85 to 2025-26 (plus 1975-76 and 1976-77), and playoff runs from 2002 to 2026');
    expect(out).not.toContain('Sue Bird');
    expect(out).toContain('Loading the archive');
    expect(out).toContain('Your requests');
  });
});
