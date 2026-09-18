// The Market's owned count (2026-09-18): the Collection's x-count pill on a
// listing you already own, from the same collection index; nothing otherwise.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OwnedMark } from './Market.jsx';

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
