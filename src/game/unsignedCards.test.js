// UNSIGNED PLAYERS (the user, 2026-10-14: "If they're unlisted, you can remove
// them from their teams", then "Out of packs until he signs", and the set goal
// does not ask for him either). A 2026-27 card whose player is on no NBA roster
// wears FREE_AGENT: nobody's franchise, required by no goal, dealt by no pack.
// An owned copy is still a card: it resolves, plays and sells.
import { describe, it, expect } from 'vitest';
import { FREE_AGENT, isUnsignedCard, getTeam, currentFranchise } from '../cards/teams.js';
import { CARD_SETS, BASE_SET, cardKey, getCardByKey } from './cardSets.js';
import { GOALS, TEAM_CODES, TEAM_ROSTERS } from './collections.js';
import { PACK_TYPES, poolFor, generatePack, favoriteTeamOptions } from './packEngine.js';

const unsigned = (CARD_SETS[BASE_SET] ?? []).filter(isUnsignedCard);
const unsignedKeys = new Set(unsigned.map(cardKey));

describe('an unsigned player', () => {
  it('is on the 2026-27 set today (eight were, the day the rule came in)', () => {
    expect(unsigned.length).toBeGreaterThan(0);
    expect(unsigned.every(c => c.team === FREE_AGENT)).toBe(true);
  });

  it('prints on a neutral Free Agent face and belongs to no franchise', () => {
    expect(getTeam(FREE_AGENT)).toMatchObject({ name: 'Free Agent', logo: null });
    expect(currentFranchise(FREE_AGENT)).toBeNull();
  });

  it('is on no team roster, so no team, division or conference goal asks for him', () => {
    expect(TEAM_CODES).not.toContain(FREE_AGENT);
    for (const keys of Object.values(TEAM_ROSTERS)) expect(keys.filter(k => unsignedKeys.has(k))).toEqual([]);
    for (const goal of GOALS) expect(goal.requires.filter(k => unsignedKeys.has(k)), goal.id).toEqual([]);
  });

  it('leaves the Complete 2026-27 Set goal one card shorter for each of them', () => {
    const set = GOALS.find(g => g.id === 'nba-set');
    expect(set.requires).toHaveLength(CARD_SETS[BASE_SET].length - unsigned.length);
  });

  it('is in no pack pool, and is not a favourite team', () => {
    for (const [key, def] of Object.entries(PACK_TYPES)) {
      expect(poolFor(def).filter(isUnsignedCard).map(c => c.name), key).toEqual([]);
    }
    expect(favoriteTeamOptions()).not.toContain(`nba:${FREE_AGENT}`);
  });

  it('never comes out of a pack', () => {
    for (let i = 0; i < 200; i += 1) {
      const pack = generatePack('nba_booster');
      expect(pack.filter(c => c.type === 'player' && unsignedKeys.has(c.id))).toEqual([]);
    }
  });

  it('is still a card: a copy someone holds resolves', () => {
    for (const card of unsigned) expect(getCardByKey(cardKey(card))?.name).toBe(card.name);
  });
});
