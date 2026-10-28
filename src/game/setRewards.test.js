// The set-completion rewards: one per special set, moved out of its home set.
import { describe, it, expect } from 'vitest';
import { CARD_SETS, getCardByKey } from './cardSets.js';
import { GOALS_BY_ID, REWARD_BY_GOAL, SPECIAL_SETS, goalCoinReward } from './collections.js';

describe('set rewards', () => {
  // The Live Series (on 2026-10-28) pays coins and no card: its set moves
  // every night, so "migrate the strongest" has nothing fixed to move, and the
  // user chose coins ("Coins are fine"), priced as every goal's are
  // (goalCoinReward).
  it('every special-set goal has a reward card that lives in a set-rewards set', () => {
    expect(GOALS_BY_ID['set-live']?.reward ?? null).toBeNull();
    expect(goalCoinReward('set-live')).toBeGreaterThan(0);
    for (const { id } of SPECIAL_SETS.filter(s => s.id !== 'live')) {
      const goal = `set-${id}`;
      const key = REWARD_BY_GOAL[goal];
      expect(key, goal).toBeTruthy();
      const card = getCardByKey(key);
      expect(card, key).toBeTruthy();
      expect(['set-rewards', 'wnba-set-rewards']).toContain(card.set);
      expect(card.rewardGoal).toBe(goal);
      expect(card.migratedFrom?.set).toBe(id);
      expect(GOALS_BY_ID[goal].reward).toBe(key);
    }
  });

  it('a moved card is gone from its home set, so the set is completable without it', () => {
    for (const set of ['set-rewards', 'wnba-set-rewards']) {
      for (const card of CARD_SETS[set]) {
        const home = CARD_SETS[card.migratedFrom.set] ?? [];
        expect(home.some(c => c.id === card.id), `${card.id} still in ${card.migratedFrom.set}`).toBe(false);
        expect(GOALS_BY_ID[card.rewardGoal].requires).not.toContain(`${card.migratedFrom.set}:${card.id}`);
      }
    }
  });
});
