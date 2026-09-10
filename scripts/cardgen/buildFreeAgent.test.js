// The Free Agents builder's pure rules (buildFreeAgent.mjs): which sets it
// will build into, and how a requested card is named inside its set.
import { describe, it, expect } from 'vitest';
import { freeAgentCardId, BUILDABLE_SETS } from './buildFreeAgent.mjs';

describe('building a requested card', () => {
  it('builds into Rookie, Super Season and Summer Standouts in both leagues, and waits on Throwbacks', () => {
    expect(BUILDABLE_SETS).toEqual(['rookie', 'super-season', 'summer-standouts', 'wnba-rookie', 'wnba-super-season']);
    expect(BUILDABLE_SETS).not.toContain('throwbacks');
    expect(BUILDABLE_SETS).not.toContain('wnba-throwbacks');
  });

  it('uses the player id, and adds the season only when the set already holds it', () => {
    expect(freeAgentCardId('Bob Sura', 1996, 'rookie', new Set())).toBe('Bob_Sura');
    expect(freeAgentCardId('Bob Sura', 1996, 'rookie', new Set(['rookie:Bob_Sura']))).toBe('Bob_Sura_1996');
    expect(freeAgentCardId('Bob Sura', 1996, 'rookie', new Set(['super-season:Bob_Sura']))).toBe('Bob_Sura');
  });
});
