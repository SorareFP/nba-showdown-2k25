// A CLIMB FIVE IN MY TEAMS (the user, 2026-10-19: "we definitely need to be
// able to pre-make eligible lineups"). The collection-only editor, with the
// Climb's limits: five players exactly, $2,200 at most.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));
vi.mock('../firebase/AuthProvider.jsx', () => ({ useAuth: () => ({ user: null }) }));

import TeamEditor from './TeamEditor.jsx';
import { LightboxProvider } from './CardLightbox.jsx';
import { CLIMB_FIVE } from '../game/modes/run.js';

describe('the team editor with the Climb\'s limits', () => {
  it('counts against $2,200 and five, and says what a Climb five needs', () => {
    const out = renderToStaticMarkup(<LightboxProvider><TeamEditor team={null} collection={{}} limits={CLIMB_FIVE} onSaved={() => {}} onCancel={() => {}} /></LightboxProvider>);
    expect(out).toContain('$0/2200 · 0/5');
    expect(out).toContain('5 more for a Climb five');
  });

  it('keeps the plain team limits by default', () => {
    const out = renderToStaticMarkup(<LightboxProvider><TeamEditor team={null} collection={{}} onSaved={() => {}} onCancel={() => {}} /></LightboxProvider>);
    expect(out).toContain('$0/5500 · 0/10');
  });
});
