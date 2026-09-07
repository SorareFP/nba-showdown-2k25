import { describe, it, expect } from 'vitest';
import { WNBA_LEAGUE_FACTOR, leagueScaleTotals } from './constants.js';

describe('the league factor on Speed+Power', () => {
  it('is the user\'s 0.88 and scales every finite total', () => {
    expect(WNBA_LEAGUE_FACTOR).toBe(0.88);
    expect(leagueScaleTotals([30, 16, NaN])).toEqual([26.4, 14.08, NaN]);
    // The floor holds: a bench card at the printed minimum stays a 6.
    expect(leagueScaleTotals([6, 5, 7])).toEqual([6, 6, 6.16]);
  });
});
