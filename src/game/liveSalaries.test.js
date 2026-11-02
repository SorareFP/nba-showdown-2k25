// THE NIGHT'S LIVE NUMBERS ON THE SERVER (2026-11-02). The cards a deploy froze
// take the salary and team the nightly job published, in place, so every reader
// of a Live card's rarity (burn value, listing floor, pack bands) follows.
import { describe, it, expect } from 'vitest';
import { applyLiveSalaries, CARD_SETS, getCardByKey, cardKey } from './cardSets.js';
import { burnValueFor, listingFloor } from './marketRules.js';
import { getPlayerRarity, RARITY_SALARY } from './rarity.js';

const card = () => CARD_SETS.live[0];

describe('applyLiveSalaries', () => {
  it('moves a Live card\'s salary and team, and says how many moved', () => {
    const c = card();
    const moved = applyLiveSalaries({ cards: { [c.id]: [RARITY_SALARY.legendary + 10, 'FA'] } });
    expect(moved).toBe(1);
    expect(getCardByKey(cardKey(c))).toMatchObject({ salary: RARITY_SALARY.legendary + 10, team: 'FA' });
  });

  it('moves everything that reads the rarity with it', () => {
    const c = card();
    const key = cardKey(c);
    applyLiveSalaries({ cards: { [c.id]: [RARITY_SALARY.legendary + 10, c.team] } });
    const rich = burnValueFor(key);
    expect(getPlayerRarity(getCardByKey(key))).toBe('legendary');
    applyLiveSalaries({ cards: { [c.id]: [50, c.team] } });
    expect(getPlayerRarity(getCardByKey(key))).toBe('common');
    expect(burnValueFor(key)).toBeLessThan(rich);
    expect(listingFloor(key)).toBe(burnValueFor(key));
  });

  it('leaves alone a card the file does not name, and an unknown id', () => {
    const [a, b] = CARD_SETS.live;
    const before = b.salary;
    applyLiveSalaries({ cards: { [a.id]: [777, a.team], Nobody_Here: [1, 'BOS'] } });
    expect(a.salary).toBe(777);
    expect(b.salary).toBe(before);
  });

  it('touches no card outside the Live set', () => {
    const c = card();
    const base = getCardByKey(c.id);
    const before = base.salary;
    applyLiveSalaries({ cards: { [c.id]: [999, c.team] } });
    expect(base.salary).toBe(before);
  });

  it('ignores a file or an entry that makes no sense', () => {
    const c = card();
    const before = c.salary;
    expect(applyLiveSalaries(null)).toBe(0);
    expect(applyLiveSalaries({})).toBe(0);
    expect(applyLiveSalaries({ cards: { [c.id]: ['lots', 'BOS'] } })).toBe(0);
    expect(applyLiveSalaries({ cards: { [c.id]: [-5, 'BOS'] } })).toBe(0);
    expect(c.salary).toBe(before);
  });
});
