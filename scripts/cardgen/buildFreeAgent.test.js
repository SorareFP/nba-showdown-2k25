// The Free Agents builder's pure rules (buildFreeAgent.mjs): which sets it
// will build into, and how a requested card is named inside its set.
import { describe, it, expect } from 'vitest';
import { freeAgentCardId, BUILDABLE_SETS } from './buildFreeAgent.mjs';

describe('building a requested card', () => {
  it('builds into every set a request can land in, Throwbacks included, in both leagues', () => {
    expect(BUILDABLE_SETS).toEqual([
      'rookie', 'super-season', 'summer-standouts', 'throwbacks',
      'wnba-rookie', 'wnba-super-season', 'wnba-throwbacks',
    ]);
    expect(BUILDABLE_SETS).not.toContain('dissonance');
  });

  it('always puts the season on a Throwbacks id, to match the art\'s file names', () => {
    expect(freeAgentCardId('Marissa Coleman', 2010, 'wnba-throwbacks', new Set())).toBe('Marissa_Coleman_2010');
    expect(freeAgentCardId('Jawad Williams', 2011, 'throwbacks', new Set())).toBe('Jawad_Williams_2011');
  });

  it('uses the player id, and adds the season only when the set already holds it', () => {
    expect(freeAgentCardId('Bob Sura', 1996, 'rookie', new Set())).toBe('Bob_Sura');
    expect(freeAgentCardId('Bob Sura', 1996, 'rookie', new Set(['rookie:Bob_Sura']))).toBe('Bob_Sura_1996');
    expect(freeAgentCardId('Bob Sura', 1996, 'rookie', new Set(['super-season:Bob_Sura']))).toBe('Bob_Sura');
  });
});
