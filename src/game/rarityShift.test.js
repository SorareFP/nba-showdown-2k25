// THE RARITY-CHANGE SETTLEMENT (2026-09-30). The user: "Change the cards,
// deploy net coins for total collection change, with a floor of zero."
import { describe, it, expect } from 'vitest';
import { RARITY_SHIFT, rarityShiftPayout, heldBefore, timeOf, mayBeOwed, settlementMessage } from './rarityShift.js';
import { getCardByKey } from './cardSets.js';
import { getPlayerRarity, BURN_VALUES } from './rarity.js';

const CUT = '2026-09-30T12:00:00.000Z';
const before = Date.parse(CUT) - 1000;
const after = Date.parse(CUT) + 1000;
const table = {
  id: 'rarity-shift:test',
  cutoff: CUT,
  shifts: {
    Down_Rare: { from: 'rare', to: 'uncommon', coins: 40 },
    'super-season:Down_Legend': { from: 'legendary', to: 'super-rare', coins: 150 },
    Up_Common: { from: 'common', to: 'uncommon', coins: -3 },
    'rookie:Up_Big': { from: 'super-rare', to: 'legendary', coins: -150 },
  },
};

describe('rarityShiftPayout', () => {
  it('pays the burn difference per copy held, summed', () => {
    const r = rarityShiftPayout([
      { cardKey: 'Down_Rare', mintedAt: before },
      { cardKey: 'Down_Rare', mintedAt: before, state: 'collected' },
      { cardKey: 'super-season:Down_Legend', mintedAt: before, state: 'listed' },
      { cardKey: 'Unmoved_Card', mintedAt: before },
    ], table);
    expect(r).toMatchObject({ id: 'rarity-shift:test', coins: 230, net: 230 });
    expect(r.lines).toEqual([
      { key: 'super-season:Down_Legend', from: 'legendary', to: 'super-rare', each: 150, copies: 1, coins: 150 },
      { key: 'Down_Rare', from: 'rare', to: 'uncommon', each: 40, copies: 2, coins: 80 },
    ]);
  });

  it('nets the cards that moved up against the ones that moved down', () => {
    const r = rarityShiftPayout([
      { cardKey: 'Down_Rare', mintedAt: before },
      { cardKey: 'Up_Common', mintedAt: before },
      { cardKey: 'Up_Common', mintedAt: before },
    ], table);
    expect(r).toMatchObject({ coins: 34, net: 34 });
  });

  it('never charges: a collection that gained value is paid zero', () => {
    const r = rarityShiftPayout([
      { cardKey: 'Down_Rare', mintedAt: before },
      { cardKey: 'rookie:Up_Big', mintedAt: before },
    ], table);
    expect(r).toMatchObject({ coins: 0, net: -110 });
    expect(r.lines).toHaveLength(2);
  });

  it('counts only copies held before the cutoff: acquiredAt first, then mintedAt', () => {
    const r = rarityShiftPayout([
      { cardKey: 'Down_Rare', mintedAt: after },                       // pulled after the change
      { cardKey: 'Down_Rare', mintedAt: before, acquiredAt: after },  // bought on the market after it
      { cardKey: 'Down_Rare', mintedAt: after, acquiredAt: before },  // impossible, but acquiredAt rules
      { cardKey: 'Down_Rare' },                                        // no timestamp: predates both fields
    ], table);
    expect(r.coins).toBe(80);
    expect(r.lines[0].copies).toBe(2);
  });

  it('reads a copy suffix as the card and ignores copies with no key', () => {
    const r = rarityShiftPayout([{ cardKey: 'Down_Rare~2', mintedAt: before }, {}, null], table);
    expect(r.coins).toBe(40);
  });

  it('pays nothing with no table', () => {
    expect(rarityShiftPayout([{ cardKey: 'Down_Rare' }], null)).toEqual({ id: null, coins: 0, net: 0, lines: [] });
  });
});

describe('the time helpers', () => {
  it('reads Firestore timestamps, dates, numbers, strings and bare seconds', () => {
    const ms = Date.parse(CUT);
    expect(timeOf({ toMillis: () => ms })).toBe(ms);
    expect(timeOf(new Date(ms))).toBe(ms);
    expect(timeOf(ms)).toBe(ms);
    expect(timeOf(CUT)).toBe(ms);
    expect(timeOf({ seconds: ms / 1000, nanoseconds: 0 })).toBe(ms);
    expect(timeOf(null)).toBeNull();
    expect(timeOf('not a date')).toBeNull();
  });

  it('heldBefore is strict at the cutoff', () => {
    const ms = Date.parse(CUT);
    expect(heldBefore({ mintedAt: ms - 1 }, ms)).toBe(true);
    expect(heldBefore({ mintedAt: ms }, ms)).toBe(false);
  });

  it('an account created after the cutoff is never called for', () => {
    expect(mayBeOwed(new Date(after).toUTCString(), table)).toBe(false);
    expect(mayBeOwed(new Date(before - 60_000).toUTCString(), table)).toBe(true);
    expect(mayBeOwed(undefined, table)).toBe(true);
    expect(mayBeOwed(before, { ...table, id: null })).toBe(false);
  });
});

describe('settlementMessage', () => {
  it('says what was paid, what came out ahead, or nothing', () => {
    expect(settlementMessage({ coins: 80, cards: 2 })).toMatch(/^\+80 coins: 2 of your cards changed rarity/);
    expect(settlementMessage({ coins: 40, cards: 1 })).toMatch(/^\+40 coins: one of your cards/);
    expect(settlementMessage({ coins: 0, cards: 3 })).toMatch(/^3 of your cards changed rarity, and your collection came out ahead/);
    expect(settlementMessage({ coins: 0, cards: 0, lines: [] })).toBeNull();
  });
});

// THE TABLE MUST DESCRIBE THE CARDS THAT SHIP. If this fails, a card changed
// rarity after the table was cut. Not deployed yet: re-cut it
// (node scripts/cardgen/rarityShift.mjs). Already deployed (accounts hold
// receipts under this id): cut a NEW table with a new --id, --from the ref
// that was deployed.
describe('the committed table', () => {
  it('has an id, a cutoff and the burn values it priced with', () => {
    expect(RARITY_SHIFT.id).toMatch(/^rarity-shift:\d{4}-\d{2}-\d{2}$/);
    expect(Number.isFinite(timeOf(RARITY_SHIFT.cutoff))).toBe(true);
    expect(RARITY_SHIFT.rates).toEqual(BURN_VALUES);
  });

  it('every entry lands on the rarity its card has now, at the burn difference', () => {
    const wrong = [];
    for (const [key, move] of Object.entries(RARITY_SHIFT.shifts)) {
      const card = getCardByKey(key);
      const now = card && getPlayerRarity(card);
      if (now !== move.to || move.coins !== BURN_VALUES[move.from] - BURN_VALUES[move.to] || move.from === move.to) {
        wrong.push(`${key}: table ${move.from} -> ${move.to} (${move.coins}), card is ${now ?? 'missing'}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
