import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CARDS } from '../game/cards.js';
import { cardKey } from '../game/cardSets.js';

// No mocks: a static render runs no effects, so nothing is fetched (Market.owned.test.jsx imports it the same way).
const { default: Market, FriendTag } = await import('./Market.jsx');

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
