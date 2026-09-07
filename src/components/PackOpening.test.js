// The reveal ladder.
//
// These exist because of one bug shape, repeated four times: `TABLE[rarity] ||
// fallback` with `legendary` missing from TABLE. It never threw, it never
// logged, and it made the rarest card in the game look and sound like the most
// common one — and be revealed first. Nothing here checks a specific number of
// sparks; what they check is that EVERY tier the game defines has a row, and
// that the rows are ordered.
import { describe, it, expect } from 'vitest';
import { RARITY_ORDER, RARITY_CONFIG } from '../game/rarity.js';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PackOpening, { TIER, burstFor, revealRank } from './PackOpening.jsx';
import { CHIMES } from '../game/packAudio.js';

describe('every rarity the game defines is handled', () => {
  it('has a tier weight for each, and only for those', () => {
    expect(Object.keys(TIER).sort()).toEqual([...RARITY_ORDER].sort());
  });

  it('has a chime for each', () => {
    // The audio table is hand-written — it has to be, the intervals are a
    // musical choice — so this is the one that catches a tier added later.
    for (const rarity of RARITY_ORDER) {
      expect(CHIMES[rarity], `no chime declared for ${rarity}`).toBeTruthy();
    }
  });

  it('has a colour for each, which is where the grey legendary came from', () => {
    for (const rarity of RARITY_ORDER) {
      expect(RARITY_CONFIG[rarity]?.color, rarity).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    // The specific regression: legendary must not resolve to the common grey.
    expect(RARITY_CONFIG.legendary.color).not.toBe(RARITY_CONFIG.common.color);
  });
});

describe('the ladder actually escalates', () => {
  it('reveals rarer cards later, so the pack builds instead of spoiling', () => {
    const ranks = RARITY_ORDER.map(revealRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // The bug in one line: legendary used to tie with common at 0.
    expect(revealRank('legendary')).toBeGreaterThan(revealRank('common'));
    expect(revealRank('legendary')).toBe(RARITY_ORDER.length - 1);
  });

  it('throws more, further and bigger the rarer the card', () => {
    const bursts = RARITY_ORDER.map(burstFor);
    for (let i = 1; i < bursts.length; i += 1) {
      expect(bursts[i].count, RARITY_ORDER[i]).toBeGreaterThan(bursts[i - 1].count);
      expect(bursts[i].reach, RARITY_ORDER[i]).toBeGreaterThan(bursts[i - 1].reach);
      expect(bursts[i].size, RARITY_ORDER[i]).toBeGreaterThan(bursts[i - 1].size);
    }
  });

  it('holds the ray fan back for the top of the ladder', () => {
    // A flourish every card gets is not a flourish. Commons and uncommons get
    // particles only; rays are what says "this one is different".
    expect(burstFor('common').rays).toBe(0);
    expect(burstFor('uncommon').rays).toBe(0);
    expect(burstFor('legendary').rays).toBeGreaterThan(0);
  });

  it('gives a legendary a bigger burst than a common by a wide margin', () => {
    // Not an arbitrary ratio — a guard that the curve is not nearly flat, which
    // is what "handled but indistinguishable" would look like.
    expect(burstFor('legendary').count).toBeGreaterThan(burstFor('common').count * 4);
  });

  it('rises in pitch and richness with rarity', () => {
    const chimes = RARITY_ORDER.map(r => CHIMES[r]);
    for (let i = 1; i < chimes.length; i += 1) {
      expect(chimes[i].root, RARITY_ORDER[i]).toBeGreaterThan(chimes[i - 1].root);
      expect(chimes[i].notes.length, RARITY_ORDER[i])
        .toBeGreaterThanOrEqual(chimes[i - 1].notes.length);
      expect(chimes[i].dur, RARITY_ORDER[i]).toBeGreaterThan(chimes[i - 1].dur);
    }
  });
});

describe('a box opens one pack at a time', () => {
  const tagged = (packIndex, ids) => ids.map(id => ({ id, type: 'player', packIndex, packType: 'booster' }));

  it('shows the first pack of the box and says which pack it is', () => {
    const cards = [...tagged(0, ['Aaron_Gordon']), ...tagged(1, ['Alex_Caruso', 'Al_Horford'])];
    const html = renderToStaticMarkup(React.createElement(PackOpening, { cards, onDone: () => {} }));
    expect(html).toContain('Pack 1/2');
    // Only the first pack is in play: one card left, not three.
    expect(html).toContain('Skip this pack (1 left)');
  });

  it('treats an untagged pack as a single pack, as before', () => {
    const cards = [{ id: 'Aaron_Gordon', type: 'player' }, { id: 'Al_Horford', type: 'player' }];
    const html = renderToStaticMarkup(React.createElement(PackOpening, { cards, onDone: () => {} }));
    expect(html).not.toContain('Pack 1/');
    expect(html).toContain('Skip all (2 left)');
  });
});

describe('the set pill beside the rarity', () => {
  it('names a special set and stays silent for the base set and for strats', async () => {
    const { setPillFor } = await import('./PackOpening.jsx');
    expect(setPillFor({ set: 'rookie' })).toEqual({ id: 'rookie', label: 'Rookie' });
    expect(setPillFor({ set: 'super-season' }).label).toBe('Super Season');
    expect(setPillFor({ set: '2026-27' })).toBeNull();
    expect(setPillFor({ id: 'turnover' })).toBeNull();
    expect(setPillFor(undefined)).toBeNull();
  });
});
