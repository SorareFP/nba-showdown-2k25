// The sound of a pull: a rarity LADDER played through a set INSTRUMENT. What
// is testable without an AudioContext is the two tables and how they combine —
// which is where every audible decision lives.
import { describe, it, expect } from 'vitest';
import { CHIMES, CHIME_RARITIES, INSTRUMENTS, instrumentFor } from './packAudio.js';
import { CARD_SETS } from './cardSets.js';
import { RARITY_ORDER } from './rarity.js';

describe('the rarity ladder', () => {
  it('has a row for every rarity, in the rarity order', () => {
    expect(CHIME_RARITIES).toEqual(RARITY_ORDER);
  });

  it('climbs: each rarity is higher, longer and no quieter than the last', () => {
    for (let i = 1; i < RARITY_ORDER.length; i += 1) {
      const lo = CHIMES[RARITY_ORDER[i - 1]];
      const hi = CHIMES[RARITY_ORDER[i]];
      expect(hi.root).toBeGreaterThan(lo.root);
      expect(hi.dur).toBeGreaterThan(lo.dur);
      expect(hi.notes.length).toBeGreaterThanOrEqual(lo.notes.length);
    }
  });
});

describe('the set instruments', () => {
  it('resolves every set a pack can produce, and the strat kind', () => {
    for (const set of [...Object.keys(CARD_SETS), 'strats']) {
      const inst = instrumentFor(set);
      expect(inst, set).toBeTruthy();
      expect(typeof inst.shift, set).toBe('number');
    }
  });

  it('gives the special sets a different voice from the base chime', () => {
    const base = instrumentFor('2026-27');
    for (const kind of ['super-season', 'rookie', 'summer-standouts', 'dissonance', 'team-rewards', 'strats']) {
      expect(instrumentFor(kind), kind).not.toEqual(base);
    }
  });

  it('voices the WNBA brighter on top of whatever kind it is', () => {
    expect(instrumentFor('wnba').shift).toBeGreaterThan(instrumentFor('2026-27').shift);
    expect(instrumentFor('wnba-rookie').shift).toBe(instrumentFor('rookie').shift + 3);
    expect(instrumentFor('wnba-rookie').type).toBe(INSTRUMENTS.rookie.type);
    // The bell keeps its own partial; the shimmer is only for kinds without one.
    expect(instrumentFor('wnba-super-season').overtone.ratio).toBe(2.76);
    expect(instrumentFor('wnba').overtone.ratio).toBe(2);
  });

  it('makes Dissonance actually dissonant, and nothing else', () => {
    expect(INSTRUMENTS.dissonance.extraNotes).toContain(6);
    for (const [kind, inst] of Object.entries(INSTRUMENTS)) {
      if (kind !== 'dissonance') expect(inst.extraNotes, kind).toBeUndefined();
    }
  });

  it('falls back to the base chime for a set it has never heard of', () => {
    expect(instrumentFor('mystery-set')).toBe(INSTRUMENTS.base);
    expect(instrumentFor(null)).toBe(INSTRUMENTS.base);
  });
});
