// THE BOX SHELF (2026-10-21; the user: "The packs earned from the Climb show
// up as booster box packs, not the actual kind of pack they are").
import { describe, it, expect } from 'vitest';
import { boxShelfLine, boxReveal, tagPack } from './boxShelf.js';

const climbBox = packType => ({ id: 'c1', packType, bonus: null, left: 1, bonusLeft: 0, boughtAs: 'climb' });
const boosterBox = { id: 'b1', packType: 'booster', bonus: 'super', left: 36, bonusLeft: 1, boughtAs: 'booster_box' };
const cards = [{ cardKey: 'x' }, { cardKey: 'y' }];

describe('a box on the shelf', () => {
  it('is named by what is in it', () => {
    expect(boxShelfLine(climbBox('mega_deluxe'))).toEqual({ title: 'Mega Deluxe to open', line: "From The Climb's pot: a Mega Deluxe, rolled when you open it." });
    expect(boxShelfLine(climbBox('rare_deluxe')).title).toBe('Rare Deluxe to open');
    expect(boxShelfLine(climbBox('booster')).title).toBe('Booster Pack to open');
    expect(boxShelfLine(boosterBox)).toMatchObject({ title: '37 packs still to open' });
    expect(boxShelfLine(boosterBox).line).toMatch(/booster box/);
    expect(boxShelfLine(climbBox('mega_deluxe')).line).not.toMatch(/booster box/);
  });
});

describe('opening a box', () => {
  it('opens a box of one as that pack, its name on the wrapper', () => {
    expect(boxReveal(climbBox('mega_deluxe'), { cards, packType: 'mega_deluxe', left: 0, bonusLeft: 0 }))
      .toEqual({ cards, packType: 'mega_deluxe', options: {} });
  });

  it('opens a booster box as a box, each pack carrying its own name', () => {
    const r = boxReveal(boosterBox, { cards, packType: 'booster', left: 35, bonusLeft: 1 });
    expect(r.packType).toBe('booster_box');
    expect(r.box).toEqual({ id: 'b1', left: 35, bonusLeft: 1 });
    expect(r.cards.every(c => c.packType === 'booster' && c.packIndex === 0)).toBe(true);
    // The bonus pack at the end names itself.
    expect(tagPack(cards, 36, 'super').every(c => c.packType === 'super' && c.packIndex === 36)).toBe(true);
  });
});
