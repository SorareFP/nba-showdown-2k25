// THE CLIMB'S OPPONENTS (docs/plans/2026-10-18-the-climb.md, Task 4). A run
// starts with five players under $2,200, so the coach's teams are sized like
// the run's (5 at floor 1, 8 for the boss) rather than ten-deep; and the boss
// is a classic team, one franchise from its Super Seasons, Throwbacks and
// reward cards.
import { describe, it, expect } from 'vitest';
import { buildAiRoster, franchiseOf, CLASSIC_SETS, classicCards, classicFranchises, buildClassicRoster } from './aiTeams.js';
import { climbRng } from './climbMap.js';
import { isFeatCard } from '../recordBreakers.js';
import { DORMANT_KEYS, cardKey } from '../cardSets.js';

const sal = r => r.reduce((t, c) => t + (c.salary ?? 0), 0);
const distinctPlayers = r => new Set(r.map(c => c.id)).size === r.length;

describe('a sized coach roster', () => {
  it('drafts five under a small cap, its own franchise first', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const r = buildAiRoster('LAL', { size: 5, cap: 2600, rng: climbRng(seed, 'lal') });
      expect(r, `seed ${seed}`).toHaveLength(5);
      expect(distinctPlayers(r)).toBe(true);
      expect(sal(r), `seed ${seed}`).toBeLessThanOrEqual(2600);
      expect(r.some(c => franchiseOf(c) === 'LAL'), `seed ${seed}`).toBe(true);
    }
  });

  it('is still ten deep when no size is given', () => {
    expect(buildAiRoster('BOS', { rng: climbRng(1, 'bos') })).toHaveLength(10);
  });
});

describe('the classic boss', () => {
  it('reads only live NBA classic cards, one per player', () => {
    expect(CLASSIC_SETS).toEqual(['super-season', 'throwbacks', 'set-rewards', 'team-rewards']);
    const lal = classicCards('LAL');
    expect(lal.length).toBeGreaterThan(5);
    for (const c of lal) {
      expect(CLASSIC_SETS).toContain(c.set);
      expect(franchiseOf(c)).toBe('LAL');
      expect(DORMANT_KEYS.has(cardKey(c)), c.id).toBe(false);
      expect(isFeatCard(c)).toBe(false);
    }
    expect(distinctPlayers(lal)).toBe(true);
  });

  it('builds every eligible franchise: eight players, under the cap, at least half classic', () => {
    const list = classicFranchises({ cap: 5200, size: 8 });
    expect(list.length).toBeGreaterThanOrEqual(20);
    for (const abbr of list) {
      const r = buildClassicRoster(abbr, { cap: 5200, size: 8, rng: climbRng(abbr, 'boss') });
      const classic = new Set(classicCards(abbr).map(cardKey));
      expect(r, abbr).toHaveLength(8);
      expect(sal(r), abbr).toBeLessThanOrEqual(5200);
      expect(distinctPlayers(r), abbr).toBe(true);
      expect(r.filter(c => classic.has(cardKey(c))).length, abbr).toBeGreaterThanOrEqual(4);
    }
  });

  it('is the same team for the same stream', () => {
    const [abbr] = classicFranchises({ cap: 5200, size: 8 });
    const a = buildClassicRoster(abbr, { cap: 5200, size: 8, rng: climbRng(9, 'boss') });
    const b = buildClassicRoster(abbr, { cap: 5200, size: 8, rng: climbRng(9, 'boss') });
    expect(a.map(cardKey)).toEqual(b.map(cardKey));
  });
});
