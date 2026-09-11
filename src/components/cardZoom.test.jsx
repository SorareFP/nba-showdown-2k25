// A CARD IMAGE OPENS THE WHOLE CARD (the user, 2026-09-11) — ZoomImg, the one
// piece every card image on a menu goes through. Static markup: inside the
// lightbox it is a zoom-in button; outside one, or for a card that does not
// exist, a plain picture.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));

import { LightboxProvider, ZoomImg } from './CardLightbox.jsx';
import { CARDS } from '../game/cards.js';
import { cardKey } from '../game/cardSets.js';

const html = el => renderToStaticMarkup(el);

describe('ZoomImg', () => {
  it('is a zoom-in button inside the lightbox, and a plain picture outside it', () => {
    const key = cardKey(CARDS[0]);
    const inside = html(<LightboxProvider><ZoomImg player={key} src="x.webp" alt="" /></LightboxProvider>);
    expect(inside).toContain('role="button"');
    expect(inside).toContain('zoom-in');
    expect(inside).toContain(CARDS[0].name);
    expect(html(<ZoomImg player={key} src="x.webp" alt="" />)).not.toContain('role="button"');
  });

  it('knows a strategy card by its id, and leaves an unknown card a plain picture', () => {
    expect(html(<LightboxProvider><ZoomImg strat="unethical_hoops" src="s.webp" alt="" /></LightboxProvider>)).toContain('role="button"');
    expect(html(<LightboxProvider><ZoomImg player="Nobody_At_All" src="n.webp" alt="" /></LightboxProvider>)).not.toContain('role="button"');
  });
});
