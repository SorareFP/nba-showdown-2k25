// The one derivation the collection-only editor rests on: which of the things
// in a collection are player cards a team can be made of. Get this wrong and
// the editor either offers strategy cards as players or drops a legitimately
// owned card from a special set.
import { describe, it, expect } from 'vitest';
import {
  ownedPlayers, ownedRoster, capSal, randomizeTeam, filterPool, sortPool, POOL_SORTS, POSITIONS,
  DEFAULT_FILTERS, CAP, MAX, MIN_TO_PLAY, RANDOM_MIN_SAL, salaryOrder } from './teamRules.js';
import { ALL_CARDS, BASE_SET, cardKey } from './cardSets.js';

const base = ALL_CARDS.find(c => (!c.set || c.set === BASE_SET) && Number.isFinite(c.salary));
const special = ALL_CARDS.find(c => c.set && c.set !== BASE_SET && Number.isFinite(c.salary));

describe('ownedPlayers', () => {
  it('keeps owned player cards, keyed the way a saved team stores them', () => {
    const out = ownedPlayers({ [cardKey(base)]: { type: 'player', count: 2 } });
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe(cardKey(base));
    expect(out[0].card).toBe(base);
    expect(out[0].count).toBe(2);
  });

  it('includes a card from a special set — collecting one is the point of it', () => {
    expect(special, 'a special-set player exists to test with').toBeTruthy();
    const out = ownedPlayers({ [cardKey(special)]: { type: 'player', count: 1 } });
    expect(out.map(o => o.card)).toContain(special);
  });

  it('drops strategy cards, zero counts and keys that resolve to nothing', () => {
    const out = ownedPlayers({
      [cardKey(base)]: { type: 'player', count: 0 },
      Second_Wind: { type: 'strat', count: 4 },
      Nobody_At_All: { type: 'player', count: 3 },
    });
    expect(out).toEqual([]);
  });

  it('tolerates a missing collection', () => {
    expect(ownedPlayers(undefined)).toEqual([]);
    expect(ownedPlayers(null)).toEqual([]);
  });
});

describe('the roster rules', () => {
  it('are the numbers the sandbox builder has always used', () => {
    expect(CAP).toBe(5500);
    expect(MAX).toBe(10);
    expect(MIN_TO_PLAY).toBe(5);
  });

  it('sums salary and treats a card without one as free', () => {
    expect(capSal([{ salary: 400 }, { salary: 250 }, {}])).toBe(650);
  });
});

describe('randomizeTeam', () => {
  it('fills a full roster inside the salary band, every time', () => {
    // Quick Match used to shuffle the set and take the first ten, which is
    // how a $2,400 roster ended up facing a $5,500 one. Twenty draws, none
    // allowed outside the band.
    for (let i = 0; i < 20; i += 1) {
      const r = randomizeTeam([], false, null);
      expect(r).toHaveLength(MAX);
      const sal = capSal(r);
      expect(sal).toBeGreaterThanOrEqual(RANDOM_MIN_SAL);
      expect(sal).toBeLessThanOrEqual(CAP);
      expect(new Set(r.map(c => c.id)).size).toBe(MAX);
    }
  });

  it('draws only from a collection when told to', () => {
    const r = randomizeTeam([], true, { [ALL_CARDS[0].id]: { count: 1 } });
    for (const c of r) expect(c.id).toBe(ALL_CARDS[0].id);
    expect(r.length).toBeLessThanOrEqual(1);
  });
});

describe('the pool controls', () => {
  const cards = [
    { name: 'Alpha', team: 'BOS', pos: 'PG', salary: 900, speed: 15, power: 8, paintBoost: 0, threePtBoost: 2, defBoost: -1 },
    { name: 'Bravo', team: 'LAL', pos: 'C', salary: 400, speed: 6, power: 16, paintBoost: 3, threePtBoost: 0, defBoost: 2 },
    { name: 'Charlie', team: 'BOS', pos: 'SF', salary: 600, speed: 11, power: 11, paintBoost: 1, threePtBoost: 1, defBoost: 0 },
  ];

  it('filters by name or team text, team, position and salary', () => {
    expect(filterPool(cards, { ...DEFAULT_FILTERS, search: 'bra' }).map(c => c.name)).toEqual(['Bravo']);
    expect(filterPool(cards, { ...DEFAULT_FILTERS, search: 'bos' }).map(c => c.name)).toEqual(['Alpha', 'Charlie']);
    expect(filterPool(cards, { ...DEFAULT_FILTERS, team: 'LAL' }).map(c => c.name)).toEqual(['Bravo']);
    expect(filterPool(cards, { ...DEFAULT_FILTERS, pos: 'SF' }).map(c => c.name)).toEqual(['Charlie']);
    expect(filterPool(cards, { ...DEFAULT_FILTERS, maxSal: 600 }).map(c => c.name)).toEqual(['Bravo', 'Charlie']);
  });

  it('sorts by every key the menu offers', () => {
    const names = sort => sortPool(cards, sort).map(c => c.name);
    expect(names('salary-desc')).toEqual(['Alpha', 'Charlie', 'Bravo']);
    expect(names('salary-asc')).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(names('speed')).toEqual(['Alpha', 'Charlie', 'Bravo']);
    expect(names('power')).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(names('paint')).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(names('three')).toEqual(['Alpha', 'Charlie', 'Bravo']);
    expect(names('defense')).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(names('name')).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('offers the five positions and does not mutate the input', () => {
    expect(POSITIONS).toEqual(['PG', 'SG', 'SF', 'PF', 'C']);
    const before = cards.map(c => c.name);
    sortPool(cards, 'name');
    expect(cards.map(c => c.name)).toEqual(before);
    expect(Object.keys(POOL_SORTS).length).toBe(8);
  });
});

describe('ownedRoster', () => {
  it('drops a saved team\'s cards that are no longer in the collection', () => {
    const { roster, dropped } = ownedRoster(['a', 'b', 'c'], { a: { count: 1 }, b: { count: 0 } });
    expect(roster).toEqual(['a']);
    expect(dropped).toEqual(['b', 'c']);
  });

  it('enforces nothing without a collection — the sandbox rule', () => {
    expect(ownedRoster(['a', 'b'], {})).toEqual({ roster: ['a', 'b'], dropped: [] });
    expect(ownedRoster(['a', 'b'], null)).toEqual({ roster: ['a', 'b'], dropped: [] });
  });

  it('tolerates a team with no players', () => {
    expect(ownedRoster(undefined, { a: { count: 1 } })).toEqual({ roster: [], dropped: [] });
  });
});

describe('salaryOrder', () => {
  it('lists slots richest first, ties by slot, and copes with a hole', () => {
    const starters = [{ salary: 300 }, { salary: 950 }, { salary: 300 }, null, { salary: 600 }];
    expect(salaryOrder(starters)).toEqual([1, 4, 0, 2, 3]);
    expect(salaryOrder([])).toEqual([]);
  });
});
