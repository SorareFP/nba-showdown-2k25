// A SET'S NAME WHERE A PLAYER SEES IT (the final review, 2026-10-14). My
// Collection's set filter and tag, and Dynasty's card tag, read hand-kept
// tables that never learned Record Breakers (nor, in My Collection, Throwbacks
// or Set Rewards): an owned card showed its raw id and the filter left it out.
import { describe, it, expect } from 'vitest';
import { SETS } from '../cards/sets.js';
import { BASE_SET } from '../game/cardSets.js';

describe('the set names players see', () => {
  it('My Collection names every set, Record Breakers included', async () => {
    const { SET_LABELS } = await import('./MyCollection.jsx');
    expect(SET_LABELS?.['record-breakers']).toBe('Record Breakers');
    expect(SET_LABELS?.[BASE_SET]).toBe('2026-27 Base');
    for (const set of SETS) expect(SET_LABELS?.[set.id], set.id).toBeTruthy();
  });

  it('Dynasty tags a Record Breakers card by its set', async () => {
    const { SET_WORD } = await import('./dynasty/DynastyScreens.jsx');
    expect(SET_WORD?.['record-breakers']).toBe('Record Breaker');
  });
});
