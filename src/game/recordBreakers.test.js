// RECORD BREAKERS IN PACKS AND COLLECTIONS (2026-10-14, docs/plans/2026-10-14-record-breakers-design.md).
// The user: feat cards come only from feats; the blocks and steals cards are
// dealt in packs like any special set; the goal "does not need to have a
// reward card". A card with no photo yet is dormant: in no pack, no goal.
import { describe, it, expect } from 'vitest';
import { CARD_SETS, DORMANT_CARDS, cardKey } from './cardSets.js';
import { isFeatCard, RECORD_BREAKERS_GOAL_ON } from './recordBreakers.js';
import { PACK_TYPES, SPECIAL_SETS_IN_PACKS, poolFor, generatePack } from './packEngine.js';
import { GOALS, COINS_ONLY_GOALS } from './collections.js';

const live = CARD_SETS['record-breakers'] ?? [];
const featKeys = new Set(live.filter(isFeatCard).map(cardKey));
const dormant = DORMANT_CARDS.filter(c => c.set === 'record-breakers');

describe('Record Breakers in packs', () => {
  it('is a special set the boosters mix in', () => {
    expect(SPECIAL_SETS_IN_PACKS).toContain('record-breakers');
  });

  it('never puts a feat card in any pack pool', () => {
    expect(featKeys.size).toBeGreaterThan(0);
    for (const [key, def] of Object.entries(PACK_TYPES)) {
      expect(poolFor(def).filter(isFeatCard).map(c => c.name), key).toEqual([]);
    }
  });

  it('deals its live pack cards and never a dormant one', () => {
    const pool = poolFor(PACK_TYPES.booster);
    for (const card of live.filter(c => c.earn === 'pack')) expect(pool, card.id).toContain(card);
    const dormantIds = new Set(dormant.map(c => c.id));
    expect(pool.filter(c => c.set === 'record-breakers' && dormantIds.has(c.id))).toEqual([]);
  });

  it('never deals a feat card in many boosters', () => {
    for (let i = 0; i < 300; i += 1) {
      const pack = generatePack('booster');
      expect(pack.filter(c => featKeys.has(c.id))).toEqual([]);
    }
  });
});

// THE GOAL OPENS WITH THE FEATS (part 2). Until a feat can be done, eight of
// the twelve cards cannot be had, and a goal nobody can finish would sit at the
// top of every new player's closest collections and in every friend's needs.
// RECORD_BREAKERS_GOAL_ON is the one switch, as LIVE_SERIES_ON is the Live
// Series'.
describe('the Record Breakers goal', () => {
  const goal = GOALS.find(g => g.id === 'set-record-breakers');

  it('is closed until the feats ship', () => {
    expect(RECORD_BREAKERS_GOAL_ON).toBe(false);
    expect(goal).toBeUndefined();
    expect(COINS_ONLY_GOALS.has('set-record-breakers')).toBe(false);
  });

  it.runIf(RECORD_BREAKERS_GOAL_ON)('asks for every live card in the set, and pays coins only', () => {
    expect(goal.requires).toEqual(live.map(cardKey).sort());
    expect(COINS_ONLY_GOALS.has('set-record-breakers')).toBe(true);
  });
});

// TEAM PACKS TOO (the final review, 2026-10-14): a team pack takes its
// franchise's special cards straight from SPECIAL_SETS_IN_PACKS, not through
// poolFor, and 8 of 1,500 Lakers Team Rare Deluxes dealt LeBron's 2022-23. Every
// path that builds a pool reads one predicate, dealable.
describe('Record Breakers feat cards in team packs', () => {
  it('never come out of a Lakers team pack or Team Rare Deluxe', () => {
    for (let i = 0; i < 1500; i += 1) {
      const pack = generatePack('team_rare_deluxe', { team: 'LAL' });
      expect(pack.filter(c => featKeys.has(c.id)).map(c => c.id)).toEqual([]);
    }
    for (let i = 0; i < 500; i += 1) {
      const pack = generatePack('team_pack', { team: 'LAL' });
      expect(pack.filter(c => featKeys.has(c.id)).map(c => c.id)).toEqual([]);
    }
  });
});
