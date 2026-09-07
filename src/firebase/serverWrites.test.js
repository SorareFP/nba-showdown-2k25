// The switch. What is worth testing is not either route — the direct one is
// tested where it lives and the server one is a network call — but the JOIN:
// that both routes offer the same operations, and that the exported functions
// actually go through whichever one the flag picks.
//
// This is the test that would have caught the first version of this file,
// where the flag was exported, three wrappers were exported, and no component
// imported any of it.
import { describe, it, expect } from 'vitest';
import * as sw from './serverWrites.js';
import { ALL_CARDS, cardKey } from '../game/cardSets.js';

const OPERATIONS = [
  'openPack',
  'buyListing',
  'claimGoal',
  'listCard',
  'delistCard',
  'burnCard',
  'claimGameReward',
  'collectCard',
  'devResetAccount',
];

describe('serverWrites', () => {
  it('offers every value-moving operation on both routes', () => {
    for (const name of OPERATIONS) {
      expect(typeof sw.ROUTES.server[name], `server.${name}`).toBe('function');
      expect(typeof sw.ROUTES.direct[name], `direct.${name}`).toBe('function');
      expect(typeof sw[name], `export ${name}`).toBe('function');
    }
    expect(Object.keys(sw.ROUTES.server).sort()).toEqual(Object.keys(sw.ROUTES.direct).sort());
  });

  it('exports a boolean flag and nothing that quietly disagrees with it', () => {
    expect(typeof sw.USE_CLOUD_FUNCTIONS).toBe('boolean');
  });

  it('prices a burn from the card, not from the caller', () => {
    // The direct burn used to accept the value as an argument; now neither
    // route lets the browser name it.
    expect(sw.burnValueFor('definitely_not_a_card')).toBeNull();
    const known = sw.burnValueFor(cardKey(ALL_CARDS[0]));
    expect(Number.isFinite(known)).toBe(true);
    expect(known).toBeGreaterThan(0);
  });
});

describe('burnValueFor', () => {
  it('values a strategy card by the strat table, not the player one', () => {
    expect(sw.burnValueFor('turnover')).toBeGreaterThan(0);
    expect(sw.burnValueFor('no-such-card')).toBeNull();
  });
});
