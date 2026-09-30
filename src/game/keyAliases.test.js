// OLD KEYS THAT STILL RESOLVE (2026-09-22, the reward/identity batch).
//
// team-rewards:Anthony_Parker was Parker's ONLY card and dynasties draft from
// every non-base card (dynasty.js draftClassCards), so when the Toronto reward
// was re-picked (Vince Carter 1999-2000) a saved or friends dynasty holding
// him would have lost him silently. His 2006-07 qualifies as his Super Season
// and that is where the card lives now; the alias is the bridge. The user on
// the rewards themselves: "No one has them yet, it doesn't matter" — so Beal
// and Zubac need none (Beal's rookie card is the draft's preference; Zubac has
// a base card).
import { describe, it, expect } from 'vitest';
import { KEY_ALIASES, canonicalKey, getCardByKey, cardKey, CARD_SETS } from './cardSets.js';
import { collectedKeys, collectableKeys } from './collections.js';

describe('KEY_ALIASES', () => {
  // THE RULE, not the list (2026-09-30): the reward re-pick grew the list to
  // forty-odd keys, every one an old key whose card moved. Each must name a
  // key that no longer resolves on its own, and land on a live card.
  it('names only keys that no longer resolve, each landing on a live card', () => {
    const live = new Set(Object.values(CARD_SETS).flat().map(cardKey));
    for (const [old, now] of Object.entries(KEY_ALIASES)) {
      expect(live.has(now), `${old} -> ${now} is a live card`).toBe(true);
      expect(live.has(old), `${old} is not itself a live key`).toBe(false);
      expect(getCardByKey(old), old).toBe(getCardByKey(now));
    }
  });

  it('lands each kind of 2026-09-30 move on the same player and season', () => {
    const same = (old, now, season) => {
      expect(getCardByKey(old), old).toBe(getCardByKey(now));
      expect(getCardByKey(now)?.season, now).toBe(season);
    };
    same('team-rewards:Josh_Smith', 'throwbacks:Josh_Smith_2009', 2009);            // a built reward, now a Throwback
    same('team-rewards:Gerald_Wallace', 'super-season:Gerald_Wallace', 2007);       // …or his Super Season
    same('team-rewards:Kevin_Garnett', 'summer-standouts:Kevin_Garnett', 2012);     // a moved reward, home again
    same('team-rewards:Joel_Embiid', 'set-rewards:Joel_Embiid', 2023);              // a conference reward, now a set reward
    same('set-rewards:Michael_Jordan', 'rookie:Michael_Jordan', 1985);              // a set reward back in its set
    same('team-rewards:Kobe_Bryant', 'throwbacks:Kobe_Bryant_2006', 2006);           // an older alias, re-aimed
    same('team-rewards:David_Robinson', 'throwbacks:David_Robinson_1994', 1994);
    // Pulled from a pack before the card moved into a reward (the derived rule).
    same('super-season:Stephen_Curry', 'set-rewards:Stephen_Curry', 2016);
    same('rookie:David_Robinson', 'set-rewards:David_Robinson', 1990);
    same('throwbacks:Dwyane_Wade_2009', 'team-rewards:Dwyane_Wade_2009', 2009);
  });

  it('keeps the first old key, Anthony Parker, on his Super Season', () => {
    expect(KEY_ALIASES['team-rewards:Anthony_Parker']).toBe('super-season:Anthony_Parker');
    const parker = getCardByKey('super-season:Anthony_Parker');
    expect(parker).toBeTruthy();
    expect(parker.set).toBe('super-season');
    expect(parker.season).toBe(2007);
    // The old key no longer names a card of its own.
    expect(CARD_SETS['team-rewards'].some(c => c.id === 'Anthony_Parker')).toBe(false);
  });

  it('resolves the old key only after a direct miss, copy suffix included', () => {
    const parker = getCardByKey('super-season:Anthony_Parker');
    expect(getCardByKey('team-rewards:Anthony_Parker')).toBe(parker);
    expect(getCardByKey('team-rewards:Anthony_Parker~2')).toBe(parker);
    // A live key is never rerouted: every card resolves to itself.
    for (const card of Object.values(CARD_SETS).flat()) {
      expect(getCardByKey(cardKey(card))).toBe(card);
    }
    expect(getCardByKey('team-rewards:Nobody_Here')).toBeUndefined();
  });

  it('canonicalKey folds an old key onto the card it is, and leaves every other key alone', () => {
    expect(canonicalKey('team-rewards:Anthony_Parker')).toBe('super-season:Anthony_Parker');
    expect(canonicalKey('team-rewards:Anthony_Parker~3')).toBe('super-season:Anthony_Parker~3');
    expect(canonicalKey('super-season:Anthony_Parker')).toBe('super-season:Anthony_Parker');
    expect(canonicalKey('Nikola_Jokic')).toBe('Nikola_Jokic');
    expect(canonicalKey('team-rewards:Vince_Carter')).toBe('team-rewards:Vince_Carter');
  });

  it('an EARNED copy under the old key still counts as collected under the new one', () => {
    const collection = { 'team-rewards:Anthony_Parker': { count: 1, earned: true } };
    expect([...collectedKeys(collection)]).toEqual(['super-season:Anthony_Parker']);
    // And a spare under the old key is collectable toward the Super Season goal.
    const spare = { 'team-rewards:Anthony_Parker': { count: 1 } };
    expect([...collectableKeys(spare)]).toEqual(['super-season:Anthony_Parker']);
    // A key nothing wants stays uncollectable, alias or not.
    expect([...collectableKeys({ 'team-rewards:Nobody_Here': { count: 1 } })]).toEqual([]);
  });
});

// A THROWBACK WHOSE SEASON IS THE SUPER SEASON AGAIN (2026-09-30). Elton
// Brand's 2005-06 was retired to a dormant Throwback by the value pick on
// 2026-09-24 and is his Super Season again since the never-worse rebuild; the
// Throwback's key must land on the Super Season, the same season.
describe('a returned Throwback', () => {
  it('resolves to the Super Season of the same season', () => {
    const ss = getCardByKey('super-season:Elton_Brand');
    expect(ss?.season).toBe(2006);
    expect(getCardByKey('throwbacks:Elton_Brand_2006')).toBe(ss);
    expect(canonicalKey('throwbacks:Elton_Brand_2006')).toBe('super-season:Elton_Brand');
  });

  it('never outranks a live card of the same key', () => {
    for (const card of CARD_SETS.throwbacks ?? []) expect(getCardByKey(cardKey(card))).toBe(card);
  });
});
