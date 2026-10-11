// THE DOT (the user, 2026-10-08): "when you have My Collection filtered to
// 'Spare to sell or burn' have a little dot on any excess card that says 'A
// friend needs this card for a collection. List it?'"
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CARDS } from '../game/cards.js';
import { cardKey } from '../game/cardSets.js';
import { getMarketPrice } from '../game/rarity.js';

vi.mock('../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));
const { default: MyCollection } = await import('./MyCollection.jsx');

// A card the market prices (MyCollection only offers Sell, and so the dot, when it has a suggested price).
const card = CARDS.find(c => getMarketPrice(c) > 0);
const key = cardKey(card);
const wants = new Map([[key, [{ uid: 'u1', name: 'Sam', goalLabel: 'Atlanta Hawks collection', missing: 1 }]]]);
const render = (collection, extra = {}) => renderToStaticMarkup(
  <MyCollection collection={collection} onBurn={() => {}} onList={() => {}} onCollect={() => {}} friendWants={wants} initialCopiesFilter="spare" {...extra} />
);

describe('the friend dot', () => {
  it('sits on a sellable spare a friend needs, in words, with the sentence as its title', () => {
    const html = render({ [key]: { type: 'player', count: 2, collected: true } });
    expect(html).toContain(`data-friend-want="${key}"`);
    expect(html).toContain('Sam needs this');
    expect(html).toContain('Sam needs this for the Atlanta Hawks collection (1 to go). List it?');
  });

  it('is not there when the only copy is the collected one', () => {
    expect(render({ [key]: { type: 'player', count: 1, collected: true } })).not.toContain('data-friend-want');
  });

  it('is not there outside the spare filter', () => {
    expect(render({ [key]: { type: 'player', count: 2, collected: true } }, { initialCopiesFilter: 'all' })).not.toContain('data-friend-want');
  });
});
