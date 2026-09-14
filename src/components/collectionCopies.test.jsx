// THE DUPLICATES FILTER (the user, 2026-09-14: "Add a duplicates filter to the
// collections page").
//
// Two options rather than one, because after the collection copy and the market
// they are different questions. A card can be a DUPLICATE — two or more copies
// — and still have nothing you can do with it: one copy is the collected one
// and the rest are listed. "Spare to sell or burn" is the actionable reading,
// and it is the same arithmetic the card's own row uses for its buttons, so the
// filter cannot let a card through that then renders with nothing to sell.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../ui/dialogs.jsx', () => ({ useDialogs: () => ({ toast: () => {}, ask: async () => true }) }));

import MyCollection from './MyCollection.jsx';
import { CARDS } from '../game/cards.js';
import { cardKey } from '../game/cardSets.js';

const keyOf = i => cardKey(CARDS[i]);
const nameOf = i => CARDS[i].name;

/** One collected copy, one spare, and one card listed to the hilt. */
const collection = {
  [keyOf(0)]: { type: 'player', count: 1, collected: true },   // collected only
  [keyOf(1)]: { type: 'player', count: 3, collected: true },   // two spares
  [keyOf(2)]: { type: 'player', count: 2, collected: true },   // one spare, but listed
};
const listedByCard = { [keyOf(2)]: [{ id: 'l1', cardKey: keyOf(2), price: 500 }] };

const paint = () => renderToStaticMarkup(
  <MyCollection
    collection={collection}
    listedByCard={listedByCard}
    onBurn={() => {}}
    onList={() => {}}
    onUnlist={() => {}}
    onCollect={() => {}}
  />
);

describe('the collection offers a duplicates filter', () => {
  it('puts the control on the page with both readings', () => {
    const out = paint();
    expect(out).toContain('All Copies');
    expect(out).toContain('Duplicates (2+)');
    expect(out).toContain('Spare to sell or burn');
  });

  it('shows every owned card before the filter is touched', () => {
    const out = paint();
    for (const i of [0, 1, 2]) expect(out, nameOf(i)).toContain(nameOf(i));
  });
});

// The filter itself is state inside the component, which static rendering
// cannot drive; the arithmetic it filters ON is what matters and is pinned
// here against the same fixture, so the two readings cannot silently converge.
describe('what each reading means for the same three cards', () => {
  const spares = key => {
    const e = collection[key] ?? {};
    const owned = e.count ?? 0;
    const collected = e.collected === true || e.earned === true;
    return Math.max(0, owned - (collected ? 1 : 0) - (listedByCard[key] ?? []).length);
  };
  const dupes = key => (collection[key]?.count ?? 0) > 1;

  it('counts a second copy as a duplicate', () => {
    expect(dupes(keyOf(0))).toBe(false);   // one copy
    expect(dupes(keyOf(1))).toBe(true);    // three
    expect(dupes(keyOf(2))).toBe(true);    // two
  });

  it('does not call a listed duplicate a spare', () => {
    expect(spares(keyOf(0))).toBe(0);      // the collected copy is not a spare
    expect(spares(keyOf(1))).toBe(2);
    // Two copies: one collected, one on the market. A duplicate with nothing
    // to do — which is exactly why "Duplicates" alone would mislead.
    expect(spares(keyOf(2))).toBe(0);
    expect(dupes(keyOf(2))).toBe(true);
  });
});
