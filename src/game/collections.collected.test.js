// Collected, not owned: the rule the goal ladder and claimGoal share.
import { describe, it, expect } from 'vitest';
import { collectedKeys, collectableKeys, GOALS_BY_ID } from './collections.js';

describe('collectedKeys', () => {
  it('counts a card only once its owner has collected it', () => {
    const keys = collectedKeys({
      a: { count: 3 },                        // three spares, none collected
      b: { count: 1, collected: true },
      c: { count: 2, collected: true },
    });
    expect([...keys].sort()).toEqual(['b', 'c']);
  });

  it('treats a goal reward as collected from the moment it exists', () => {
    expect(collectedKeys({ r: { count: 1, earned: true } }).has('r')).toBe(true);
  });

  it('never counts a card that has left, whatever its flags say', () => {
    expect(collectedKeys({ gone: { count: 0, collected: true } }).size).toBe(0);
    expect(collectedKeys(undefined).size).toBe(0);
  });
});

describe('collectableKeys', () => {
  it('is the owned player cards not yet in the binder — never strats, never rewards', () => {
    const [a, b, r] = GOALS_BY_ID['nba-set'].requires;
    const keys = collectableKeys({
      [a]: { type: 'player', count: 2 },                    // waiting
      [b]: { type: 'player', count: 1, collected: true },   // done
      [r]: { type: 'player', count: 1, earned: true },      // reward: collected from birth
      turnover: { type: 'strat', count: 3 },                // not collectable
      [GOALS_BY_ID['nba-set'].requires[3]]: { type: 'player', count: 0 }, // gone
    });
    expect([...keys]).toEqual([a]);
  });

  it('ignores a card no collection wants — the Rookie-card-with-nowhere-to-go case', () => {
    expect(collectableKeys({ 'no-such-set:nobody': { type: 'player', count: 1 } }).size).toBe(0);
    // And a special-set card IS wanted now: its set has a goal.
    const rookie = GOALS_BY_ID['set-rookie'].requires[0];
    expect(collectableKeys({ [rookie]: { type: 'player', count: 1 } }).has(rookie)).toBe(true);
  });
});
