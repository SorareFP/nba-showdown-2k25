// The Market's owned count (2026-09-18): the Collection's x-count pill on a
// listing you already own, from the same collection index; nothing otherwise.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OwnedMark, filterListings } from './Market.jsx';

// "Hide mine" (2026-09-18): your own listings leave the browse; "My listings"
// still shows only yours, and wins while it is on.
describe('the market filters', () => {
  const card = (name, team = 'BOS') => ({ name, team });
  const rows = [
    { id: 'a', seller: 'me', card: card('Jayson Tatum') },
    { id: 'b', seller: 'you', card: card('Jaylen Brown') },
    { id: 'c', seller: 'them', card: card('Jalen Brunson', 'NYK') },
  ];
  const ids = list => list.map(l => l.id);
  it('hides your own listings when asked, and shows everything otherwise', () => {
    expect(ids(filterListings(rows, { uid: 'me' }))).toEqual(['a', 'b', 'c']);
    expect(ids(filterListings(rows, { uid: 'me', hideMine: true }))).toEqual(['b', 'c']);
  });
  it('lets "My listings" win over "Hide mine", and still searches either way', () => {
    expect(ids(filterListings(rows, { uid: 'me', mineOnly: true, hideMine: true }))).toEqual(['a']);
    expect(ids(filterListings(rows, { uid: 'me', hideMine: true, search: 'nyk' }))).toEqual(['c']);
    expect(ids(filterListings(rows, { uid: 'me', hideMine: true, search: 'tatum' }))).toEqual([]);
  });
});

describe('the owned mark on a market listing', () => {
  it('shows the count you own, like the collection, and nothing when you own none', () => {
    expect(renderToStaticMarkup(<OwnedMark count={2} />)).toContain('x2');
    expect(renderToStaticMarkup(<OwnedMark count={1} />)).toContain('You own 1');
    expect(renderToStaticMarkup(<OwnedMark count={0} />)).toBe('');
    expect(renderToStaticMarkup(<OwnedMark count={undefined} />)).toBe('');
    // The phone form is the same count in its own class, beside the name.
    expect(renderToStaticMarkup(<OwnedMark count={3} inline />)).toContain('x3');
  });
});
