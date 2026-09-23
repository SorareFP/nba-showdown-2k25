// THE WRAPPER AND THE FANFARE (the user, 2026-09-23: "an actual pack-ripping
// animation" and "more fanfare when opening a Super Rare or Legendary").
// Static markup: a pack opens sealed, the wrapper is a control that names the
// pack, and the fanfare exists for exactly the two top bands.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));

import PackRip, { TEAR_DONE, RIP_MS } from './PackRip.jsx';
import PackOpening, { Fanfare, FANFARE } from './PackOpening.jsx';
import { CARDS } from '../game/cards.js';
import { cardKey } from '../game/cardSets.js';
import { RARITY_ORDER } from '../game/rarity.js';
import { playRip, playFanfare } from '../game/packAudio.js';

const html = el => renderToStaticMarkup(el);

describe('the sealed pack', () => {
  it('is a control that names the pack and says what is inside', () => {
    const out = html(<PackRip name="Booster Pack" count={7} />);
    expect(out).toContain('role="button"');
    expect(out).toContain('Tear open the Booster Pack');
    expect(out).toContain('7 cards');
    expect(out).toContain('Drag across the top');
    // Both strip pieces, clipped against the tear.
    expect(out).toContain('--tear:0');
  });

  it('needs more than half a drag before it counts, and gives the stack a beat to rise', () => {
    expect(TEAR_DONE).toBeGreaterThan(0.5);
    expect(TEAR_DONE).toBeLessThan(1);
    expect(RIP_MS).toBeGreaterThanOrEqual(500);
  });
});

describe('a pack opening', () => {
  const pulls = [
    { type: 'strat', id: 'high_screen_roll', packIndex: 0, packType: 'booster' },
    { type: 'player', id: cardKey(CARDS[0]), packIndex: 0, packType: 'booster' },
    { type: 'player', id: cardKey(CARDS[1]), packIndex: 0, packType: 'booster' },
  ];

  it('starts sealed, wearing the pack type its pulls carry', () => {
    const out = html(<PackOpening cards={pulls} onDone={() => {}} />);
    expect(out).toContain('Tear open the Booster Pack');
    expect(out).toContain('3 cards inside');
    expect(out).not.toContain('Tap to reveal');
  });

  it('wears the caller\'s name when the pulls carry none', () => {
    const bare = pulls.map(({ packType, ...p }) => p);
    expect(html(<PackOpening cards={bare} packName="Rookie Pack" onDone={() => {}} />)).toContain('Tear open the Rookie Pack');
    expect(html(<PackOpening cards={bare} onDone={() => {}} />)).toContain('Tear open the Pack');
  });
});

describe('the fanfare', () => {
  it('exists for the two top bands and for nothing below them', () => {
    expect(Object.keys(FANFARE).sort()).toEqual(['legendary', 'super-rare']);
    for (const rarity of RARITY_ORDER) {
      const out = html(<Fanfare rarity={rarity} />);
      if (FANFARE[rarity]) {
        expect(out, rarity).toContain(FANFARE[rarity].stamp);
        expect(out, rarity).toContain('--spin');
      } else {
        expect(out, rarity).toBe('');
      }
    }
  });

  it('throws more confetti for a legendary than for a super-rare', () => {
    expect(FANFARE.legendary.confetti).toBeGreaterThan(FANFARE['super-rare'].confetti);
    const count = out => (out.match(/--spin/g) ?? []).length;
    expect(count(html(<Fanfare rarity="legendary" />))).toBe(FANFARE.legendary.confetti);
    expect(count(html(<Fanfare rarity="super-rare" />))).toBe(FANFARE['super-rare'].confetti);
  });

  it('has sounds that are safe to call where there is no audio', () => {
    expect(() => { playRip(); playFanfare('legendary'); playFanfare('super-rare'); playFanfare('rare'); }).not.toThrow();
  });
});
