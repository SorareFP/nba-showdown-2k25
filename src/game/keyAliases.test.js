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
  it('holds exactly the one old key, and its target is a live card', () => {
    expect(KEY_ALIASES).toEqual({
      'team-rewards:Anthony_Parker': 'super-season:Anthony_Parker',
      // The Spurs reward changed id when its season was demoted to a Throwback (2026-09-22).
      'team-rewards:David_Robinson': 'team-rewards:David_Robinson_1994',
    });
    expect(getCardByKey('team-rewards:David_Robinson')).toBe(getCardByKey('team-rewards:David_Robinson_1994'));
    expect(getCardByKey('team-rewards:David_Robinson_1994')).toMatchObject({ name: 'David Robinson', wears: 'throwbacks', rewardFor: 'SAS' });
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
