// scripts/cardgen/overrides.test.js
import { describe, it, expect } from 'vitest';
import { applyOverrides } from './overrides.js';

describe('applyOverrides', () => {
  it('deep-merges a tier override onto the generated chart for that player only', () => {
    const players = {
      jokic: { chart: [{ lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 }, { lo: 4, hi: 11, pts: 3, reb: 1, ast: 1 }] },
      lebron: { chart: [{ lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 }] },
    };
    const overrides = { jokic: { chart: { 1: { pts: 4 } } } };
    const result = applyOverrides(players, overrides);
    expect(result.jokic.chart[1]).toMatchObject({ pts: 4, reb: 1, ast: 1 });
    expect(result.lebron).toEqual(players.lebron);
  });

  it('is a no-op for players with no override entry', () => {
    const players = { jokic: { chart: [{ lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 }] } };
    expect(applyOverrides(players, {})).toEqual(players);
  });
});
