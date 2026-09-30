// THE RARITY-CHANGE SETTLEMENT (2026-09-30). The user: "Change the cards,
// deploy net coins for total collection change, with a floor of zero."
import { describe, it, expect } from 'vitest';
import { RARITY_SHIFT, RARITY_SHIFTS, rarityShiftPayout, settleShifts, heldBefore, timeOf, mayBeOwed, settlementMessage } from './rarityShift.js';
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

describe('settleShifts: more than one table', () => {
  const later = {
    id: 'rarity-shift:test-2',
    cutoff: '2026-09-30T20:00:00.000Z',
    shifts: {
      Down_Rare: { from: 'uncommon', to: 'common', coins: 3 },
      Up_Late: { from: 'rare', to: 'super-rare', coins: -55 },
    },
  };
  const between = Date.parse(CUT) + 60_000; // after the first cut, before the second

  it('pays each table on its own terms and sums them', () => {
    const r = settleShifts([{ cardKey: 'Down_Rare', mintedAt: before }], [table, later]);
    expect(r.receipts.map(x => x.coins)).toEqual([40, 3]);
    expect(r).toMatchObject({ id: 'rarity-shift:test-2', coins: 43, net: 43, cards: 2 });
  });

  it('floors each table at zero on its own: a later upgrade never takes back an earlier payment', () => {
    const r = settleShifts([{ cardKey: 'Down_Rare', mintedAt: before }, { cardKey: 'Up_Late', mintedAt: before }], [table, later]);
    expect(r.receipts.map(x => [x.coins, x.net])).toEqual([[40, 40], [0, -52]]);
    expect(r.coins).toBe(40);
  });

  it("uses each table's own cutoff", () => {
    const r = settleShifts([{ cardKey: 'Down_Rare', mintedAt: between }], [table, later]);
    expect(r.receipts.map(x => x.coins)).toEqual([0, 3]);
  });

  it('settles only the tables it is handed, which is how a claimed one is skipped', () => {
    const r = settleShifts([{ cardKey: 'Down_Rare', mintedAt: before }], [later]);
    expect(r).toMatchObject({ id: 'rarity-shift:test-2', coins: 3, receipts: [{ id: 'rarity-shift:test-2' }] });
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
describe('the committed tables', () => {
  it('each has its own id, a cutoff and the burn values it priced with, oldest first', () => {
    expect(RARITY_SHIFTS.length).toBeGreaterThanOrEqual(2);
    for (const t of RARITY_SHIFTS) {
      expect(t.id).toMatch(/^rarity-shift:\d{4}-\d{2}-\d{2}(-\d+)?$/);
      expect(Number.isFinite(timeOf(t.cutoff))).toBe(true);
      expect(t.rates).toEqual(BURN_VALUES);
    }
    expect(new Set(RARITY_SHIFTS.map(t => t.id)).size).toBe(RARITY_SHIFTS.length);
    const cutoffs = RARITY_SHIFTS.map(t => timeOf(t.cutoff));
    expect(cutoffs).toEqual([...cutoffs].sort((a, b) => a - b));
    expect(RARITY_SHIFT).toBe(RARITY_SHIFTS.at(-1));
  });

  it('every entry is priced at the burn difference of a real move', () => {
    const wrong = [];
    for (const t of RARITY_SHIFTS) {
      for (const [key, move] of Object.entries(t.shifts)) {
        if (move.coins !== BURN_VALUES[move.from] - BURN_VALUES[move.to] || move.from === move.to) wrong.push(`${t.id} ${key}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('the tables chain: a key lands where the next table picks it up, and the last one on the card as it is now', () => {
    const wrong = [];
    const keys = new Set(RARITY_SHIFTS.flatMap(t => Object.keys(t.shifts)));
    for (const key of keys) {
      const moves = RARITY_SHIFTS.map(t => t.shifts[key]).filter(Boolean);
      for (let i = 1; i < moves.length; i += 1) {
        if (moves[i].from !== moves[i - 1].to) wrong.push(`${key}: ${moves[i - 1].to} then from ${moves[i].from}`);
      }
      const card = getCardByKey(key);
      const now = card && getPlayerRarity(card);
      // A key only the older table moved: the card must still be where it landed
      // unless a later table moved it again (then the check above covers it).
      if (now !== moves.at(-1).to) wrong.push(`${key}: last table says ${moves.at(-1).to}, card is ${now ?? 'missing'}`);
    }
    expect(wrong).toEqual([]);
  });
});
