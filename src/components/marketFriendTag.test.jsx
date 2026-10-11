import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CARDS } from '../game/cards.js';
import { cardKey } from '../game/cardSets.js';

// No mocks: a static render runs no effects, so nothing is fetched (Market.owned.test.jsx imports it the same way).
const { default: Market, FriendTag, loadMarketRows } = await import('./Market.jsx');

describe('the market\'s friend tag', () => {
  const key = cardKey(CARDS[0]);
  it('names a friend\'s listing, and says when it is one you need', () => {
    expect(renderToStaticMarkup(<FriendTag listing={{ id: 'l1', seller: 'alex', cardKey: key }} friendNames={new Map([['alex', 'Alex']])} needKeys={new Set()} />)).toContain('Your friend Alex');
    expect(renderToStaticMarkup(<FriendTag listing={{ id: 'l1', seller: 'alex', cardKey: key }} friendNames={new Map([['alex', 'Alex']])} needKeys={new Set([key])} />)).toContain('Your friend Alex · you need this');
    expect(renderToStaticMarkup(<FriendTag listing={{ id: 'l1', seller: 'kim', cardKey: key }} friendNames={new Map([['alex', 'Alex']])} needKeys={new Set([key])} />)).toBe('');
  });
  it('still renders the market with no friends at all', () => {
    expect(() => renderToStaticMarkup(<Market uid="me" coins={0} onTraded={() => {}} />)).not.toThrow();
  });
});

// A FRIEND'S LISTING IS READ FRESH ON EVERY REFRESH (final review, 2026-10-11):
// it was loaded once and appended to every refresh, so a listing you had just
// bought stayed in the Market with a Buy button that could only fail.
describe('the market reads friends listings fresh', () => {
  const key = cardKey(CARDS[0]);
  it('drops a friend listing the moment the server no longer has it', async () => {
    let friendRows = [{ id: 'f1', seller: 'alex', cardKey: key, price: 10 }];
    const load = async () => [{ id: 'p1', seller: 'kim', cardKey: key, price: 5 }];
    const loadBy = async uids => (uids.includes('alex') ? friendRows : []);
    expect((await loadMarketRows(['alex'], { load, loadBy })).map(r => r.id)).toEqual(['p1', 'f1']);
    friendRows = [];
    expect((await loadMarketRows(['alex'], { load, loadBy })).map(r => r.id)).toEqual(['p1']);
  });

  it('never lists one listing twice, and asks nothing extra with no friends', async () => {
    const both = [{ id: 'p1', seller: 'alex', cardKey: key, price: 5 }];
    const rows = await loadMarketRows(['alex'], { load: async () => both, loadBy: async () => both });
    expect(rows.map(r => r.id)).toEqual(['p1']);
    const alone = await loadMarketRows([], { load: async () => both, loadBy: async () => { throw new Error('should not be asked'); } });
    expect(alone.map(r => r.id)).toEqual(['p1']);
  });
});
