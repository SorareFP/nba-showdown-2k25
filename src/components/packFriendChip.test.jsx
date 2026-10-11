// THE PACK REVEAL'S FRIEND CHIP (2026-10-11): the moment you pack a card a
// friend needs, the nameplate says so.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FriendChip } from './PackOpening.jsx';

describe('the friend chip', () => {
  it('names the friend on the pulled card', () => {
    const html = renderToStaticMarkup(<FriendChip cardId="Tyrese_Maxey" note="Sam needs this one" />);
    expect(html).toContain('data-friend-note="Tyrese_Maxey"');
    expect(html).toContain('Sam needs this one');
  });

  it('is nothing when no friend needs it', () => {
    expect(renderToStaticMarkup(<FriendChip cardId="Tyrese_Maxey" note={null} />)).toBe('');
  });
});
