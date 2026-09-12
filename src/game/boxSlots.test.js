// A BOX HOLDS SLOTS, NOT CARDS (the user, 2026-09-12).
//
// "When I buy the booster box, all the cards from those packs shouldn't even
// be decided. They should be decided when the pack is opened." Buying used to
// roll all thirty-six boosters and the bonus pack in one call and mint every
// card before the reveal screen opened, which put the entire box into the
// collection at the till — so a box put down half-opened spoiled itself.
//
// nextBoxPack is the rule both routes read for "what comes out next", and it
// is the piece that has to agree between the callable (functions/index.js) and
// the direct route (serverWrites.js) or slot 37 means two different things.
import { describe, it, expect } from 'vitest';
import { nextBoxPack, PACK_TYPES, generatePack } from './packEngine.js';

const freshBox = () => {
  const def = PACK_TYPES.booster_box;
  return { packType: 'booster', bonus: def.bonus, left: def.box, bonusLeft: def.bonus ? 1 : 0 };
};

describe('what a box hands over next', () => {
  it('deals its boosters first, then the bonus, then nothing', () => {
    const box = freshBox();
    expect(box.left).toBe(36);
    expect(nextBoxPack(box)).toBe('booster');

    box.left = 1;
    expect(nextBoxPack(box)).toBe('booster');

    box.left = 0;
    expect(nextBoxPack(box)).toBe(PACK_TYPES.booster_box.bonus);

    box.bonusLeft = 0;
    expect(nextBoxPack(box)).toBe(null);
  });

  it('walks a whole box in exactly 37 opens', () => {
    const box = freshBox();
    let opens = 0;
    for (let guard = 0; guard < 100; guard += 1) {
      const type = nextBoxPack(box);
      if (!type) break;
      expect(PACK_TYPES[type]).toBeTruthy();
      if (box.left > 0) box.left -= 1; else box.bonusLeft -= 1;
      opens += 1;
    }
    expect(opens).toBe(37);
    expect(nextBoxPack(box)).toBe(null);
  });

  it('is safe on a box that is missing, empty or malformed', () => {
    expect(nextBoxPack(null)).toBe(null);
    expect(nextBoxPack(undefined)).toBe(null);
    expect(nextBoxPack({})).toBe(null);
    expect(nextBoxPack({ left: 0, bonusLeft: 0 })).toBe(null);
    // A box with slots but no named type still deals a booster.
    expect(nextBoxPack({ left: 3 })).toBe('booster');
  });
});

describe('the packs a box deals are ordinary packs', () => {
  it('rolls a real booster each time, and two opens are not the same pack', () => {
    const a = generatePack('booster', {});
    const b = generatePack('booster', {});
    const def = PACK_TYPES.booster;
    expect(a).toHaveLength(def.players + def.strats);
    expect(b).toHaveLength(def.players + def.strats);
    // Rolled independently: identical contents in the same order would mean
    // the box was handing back one pre-rolled pack.
    expect(a.map(c => c.id).join()).not.toBe(b.map(c => c.id).join());
  });
});
