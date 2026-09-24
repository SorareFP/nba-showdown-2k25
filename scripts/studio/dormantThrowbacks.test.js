// DORMANT THROWBACKS (2026-09-24): a generator-owned Throwback with no photo
// sits out of every set, pack and list, still resolves by key, and is offered
// to Free Agents. The user: "hidden from packs and not occur until someone asks
// for them via free agents", and "Throwbacks WITHOUT photos should stay
// dormant." The photos are local (gitignored), so these read the committed
// list, not the folders.
import { describe, it, expect } from 'vitest';
import { CARD_SETS, DORMANT_CARDS, DORMANT_KEYS, getCardByKey, cardKey } from '../../src/game/cardSets.js';
import { SPECIAL_SETS_IN_PACKS } from '../../src/game/packEngine.js';
import dormant from '../../card-data/generated/dormant-throwbacks.json';
import quoteIndex from '../../card-data/generated/quote-index.json';

const live = new Set(Object.values(CARD_SETS).flat().map(cardKey));

describe('a dormant Throwback', () => {
  it('is the vacated seasons: the Super Season of the same logo era holds the photo', () => {
    // Maya Moore's 2013 Super Season and her 2014 Throwback are both Lynx
    // (MIN11): the photo went back to the Super Season and 2014 sleeps.
    expect(dormant.count).toBe(dormant.keys.length);
    expect(DORMANT_KEYS.has('wnba-throwbacks:Maya_Moore_2014')).toBe(true);
    expect(DORMANT_KEYS.has('throwbacks:Michael_Jordan_1988')).toBe(true);
    expect(live.has('wnba-super-season:Maya_Moore')).toBe(true);
    // A retired season in ANOTHER logo era keeps its photo and stays in packs.
    expect(DORMANT_KEYS.size).toBeGreaterThan(0);
    expect(Object.values(CARD_SETS).flat().some(c => c.set === 'throwbacks' && c.demotedFrom)).toBe(true);
  });

  it('is in no set, so no pack, list or checklist deals it', () => {
    expect(SPECIAL_SETS_IN_PACKS).toEqual(expect.arrayContaining(['throwbacks', 'wnba-throwbacks']));
    for (const key of DORMANT_KEYS) expect(live.has(key), key).toBe(false);
  });

  it('still resolves by key, so a copy someone already holds keeps its card', () => {
    expect(DORMANT_CARDS.length).toBe(DORMANT_KEYS.size);
    for (const card of DORMANT_CARDS) expect(getCardByKey(cardKey(card)), cardKey(card)).toBe(card);
  });

  it('is offered to Free Agents like an uncarded season, as a Throwback or its Rookie card', () => {
    // A retired ROOKIE YEAR requests as a Rookie card, the user's rule
    // (2026-09-18): a season that qualifies for Rookie is not a Throwback.
    // Three were Super Seasons and so had no Rookie card; the request builds
    // one, and the dormant Throwback of the same season simply stays asleep.
    const ROOKIE_YEARS = ['Candace_Parker_2008', 'Michelle_Edwards_1997', 'Tamika_Catchings_2002'];
    const rows = quoteIndex.rows;
    const asRookie = [];
    for (const card of DORMANT_CARDS) {
      const row = rows.find(r => r[0] === card.bbrefId && r[2] === card.season && r[3] === 'r');
      expect(row, `${card.name} ${card.season}`).toBeTruthy();
      if (row[6] !== card.set) {
        expect(row[6], card.id).toBe(card.set.replace('throwbacks', 'rookie'));
        asRookie.push(card.id);
      }
    }
    expect(asRookie.sort()).toEqual(ROOKIE_YEARS);
  });
});
