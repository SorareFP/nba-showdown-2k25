// THE TEAM BUILDER'S POOL, signed in: what you own, from every set.
//
// A player's report (2026-10-01): "Unable to select anyone but base set nba
// players in the team builder. Also unable to choose strategy cards." The pool
// was the base NBA set looked up by bare id, so a card whose collection key
// is `set:id` — every special set and the whole WNBA — never appeared.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ALL_CARDS, BASE_SET, cardKey } from '../game/cardSets.js';

const auth = { user: { uid: 'u1' } };
vi.mock('../firebase/AuthProvider.jsx', () => ({ useAuth: () => auth }));
vi.mock('../firebase/savedTeams.js', () => ({ saveTeam: vi.fn(), loadTeams: vi.fn(async () => []) }));
vi.mock('../ui/dialogs.jsx', () => ({ useDialogs: () => ({ toast: () => {}, askText: async () => null }) }));
vi.mock('./CardLightbox.jsx', () => ({ useLightbox: () => ({ open: () => {} }), ZoomImg: () => null }));
vi.mock('./PlayerCard.jsx', () => ({ default: ({ card, actions }) => <div data-card={card.set ?? 'base'}>{card.name}{actions}</div> }));

const { default: TeamBuilderTab } = await import('./TeamBuilderTab.jsx');

const pick = set => ALL_CARDS.find(c => c.set === set && Number.isFinite(c.salary));
const base = ALL_CARDS.find(c => (!c.set || c.set === BASE_SET) && Number.isFinite(c.salary));
const superSeason = pick('super-season');
const wnba = pick('wnba');
const unowned = ALL_CARDS.find(c => (!c.set || c.set === BASE_SET) && c.id !== base.id && c.id !== superSeason.id);

const html = (collection, props = {}) => renderToStaticMarkup(
  <TeamBuilderTab teamA={[]} setTeamA={() => {}} teamB={[]} setTeamB={() => {}} onStartGame={() => {}} collection={collection} {...props} />
);

describe('TeamBuilderTab, signed in', () => {
  const owned = Object.fromEntries([base, superSeason, wnba].map(c => [cardKey(c), { type: 'player', count: 1 }]));

  it('offers every player card you own, whatever set it is from', () => {
    const out = html(owned);
    expect(out).toContain('3 players');
    expect(out).toContain('data-card="super-season"');
    expect(out).toContain('data-card="wnba"');
    expect(out).toContain(`data-card="${BASE_SET}"`);
  });

  it('still offers nothing you do not own', () => {
    const out = html(owned);
    expect(out.match(/data-card=/g)).toHaveLength(3);
    if (![base, superSeason, wnba].some(c => c.name === unowned.name)) expect(out).not.toContain(`>${unowned.name}<`);
  });

  it('says where a strategy deck is built, with a way there', () => {
    expect(html(owned)).not.toContain('Build a strategy deck');  // no handler, no link
    const out = html(owned, { onOpenDecks: () => {} });
    expect(out).toContain('Build a strategy deck');
    expect(out).toContain('default deck');
  });
});

describe('TeamBuilderTab, signed out', () => {
  it('is the base-set sandbox it was, with no deck link', () => {
    auth.user = null;
    try {
      const out = html({}, { onOpenDecks: () => {} });
      expect(out).not.toContain('data-card="super-season"');
      expect(out).not.toContain('Build a strategy deck');
      expect(out.split(`data-card="${BASE_SET}"`).length - 1).toBeGreaterThan(300);
    } finally {
      auth.user = { uid: 'u1' };
    }
  });
});
