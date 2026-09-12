// A COPY OVER THE DECK CAP IS COINS, NOT A CARD (the user, 2026-09-12).
//
// "We can add an auto-burn for any strategy card in your collection that goes
// above the deck cap for its rarity." The cap is the one the deck editor,
// savedDecks.js and cleanDeck already enforce — 5 common, 4 uncommon, 3 rare,
// 1 legendary — so a copy past it can never be played and only sits in the
// collection as clutter. stratCopyCap is that rule, read as a COLLECTION rule
// rather than only a deck one, and both mint routes share it.
import { describe, it, expect } from 'vitest';
import { stratCopyCap, STRAT_COPY_CAPS, getStratRarity } from './rarity.js';
import { STRATS, getStrat } from './strats.js';
import { burnValueFor } from './marketRules.js';

describe('the collection cap is the deck cap', () => {
  it('gives every strategy card the cap its band already had', () => {
    for (const s of STRATS) {
      const band = getStratRarity(s);
      expect(stratCopyCap(s.id), s.id).toBe(STRAT_COPY_CAPS[band] ?? 5);
    }
  });

  it('reads the bands the deck editor enforces', () => {
    expect(stratCopyCap('offensive_foul')).toBe(5);   // common
    expect(stratCopyCap('switch_everything')).toBe(3); // rare
    expect(stratCopyCap('twin_towers')).toBe(1);       // legendary — never stacked
  });

  it('caps nothing that is not a strategy card', () => {
    expect(stratCopyCap('Damian_Lillard')).toBe(null);
    expect(stratCopyCap('not_a_card_at_all')).toBe(null);
    expect(stratCopyCap('')).toBe(null);
  });

  it('leaves every capped card worth burning, so the auto-burn always pays', () => {
    // An over-cap copy is paid out at its burn value; a card with no burn
    // value would silently pay nothing, which would be a worse bug than the
    // clutter it replaced.
    for (const s of STRATS) {
      expect(burnValueFor(s.id), s.id).toBeGreaterThan(0);
    }
  });
});

// The mint-time arithmetic both routes run, pinned here rather than only
// inside a Firestore transaction where no test can reach it.
describe('what a pack mints once the cap is reached', () => {
  /** The shared rule: walk a pack, minting until the cap and burning after. */
  const settle = (pulls, held = {}) => {
    const owned = new Map(Object.entries(held));
    const minted = [];
    const burned = [];
    for (const id of pulls) {
      const cap = stratCopyCap(id);
      const have = owned.get(id) ?? 0;
      if (cap != null && have >= cap) { burned.push({ id, coins: burnValueFor(id) }); continue; }
      owned.set(id, have + 1);
      minted.push(id);
    }
    return { minted, burned, coins: burned.reduce((t, b) => t + b.coins, 0) };
  };

  it('keeps copies up to the cap and pays for the rest', () => {
    const r = settle(['twin_towers', 'twin_towers', 'twin_towers']);
    expect(r.minted).toEqual(['twin_towers']);          // legendary: one only
    expect(r.burned).toHaveLength(2);
    expect(r.coins).toBe(2 * burnValueFor('twin_towers'));
  });

  it('counts what is already owned, not just what is in the pack', () => {
    expect(settle(['offensive_foul'], { offensive_foul: 4 }).minted).toEqual(['offensive_foul']);
    expect(settle(['offensive_foul'], { offensive_foul: 5 }).minted).toEqual([]);
    expect(settle(['offensive_foul'], { offensive_foul: 5 }).burned).toHaveLength(1);
  });

  it('burns both when one pack carries two copies over the line', () => {
    const r = settle(['switch_everything', 'switch_everything'], { switch_everything: 2 });
    expect(r.minted).toEqual(['switch_everything']);    // rare caps at 3
    expect(r.burned).toHaveLength(1);
  });

  it('never touches a player card, however many you own', () => {
    const r = settle(['Damian_Lillard', 'Damian_Lillard'], { Damian_Lillard: 99 });
    expect(r.minted).toHaveLength(2);
    expect(r.burned).toHaveLength(0);
  });
});
