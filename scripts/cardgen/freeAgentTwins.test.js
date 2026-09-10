// Where a requested season lands when it is two things at once, and how a
// WNBA career is classified (freeAgentQuotes.js).
import { describe, it, expect } from 'vitest';
import { settleTwin, classifyWnbaSeason, WNBA_SETS } from './freeAgentQuotes.js';
import { SUPER_SEASON_MIN_SALARY } from '../../src/cards/badges.js';

describe('the twin rule', () => {
  it('keeps a rookie-year best season gold only when it would print gold', () => {
    const twin = { alsoBest: true, trusted: true };
    expect(settleTwin('rookie', { ...twin, salary: SUPER_SEASON_MIN_SALARY })).toBe('super-season');
    expect(settleTwin('rookie', { ...twin, salary: SUPER_SEASON_MIN_SALARY - 10 })).toBe('rookie');
    expect(settleTwin('rookie', { alsoBest: true, trusted: false, salary: 1500 })).toBe('rookie');
    expect(settleTwin('rookie', { alsoBest: false, trusted: true, salary: 1500 })).toBe('rookie');
    expect(settleTwin('throwbacks', { ...twin, salary: 1500 })).toBe('throwbacks');
    expect(settleTwin('wnba-rookie', { ...twin, salary: 1000 }, { rookie: 'wnba-rookie', best: 'wnba-super-season' }))
      .toBe('wnba-super-season');
  });
});

describe('a WNBA career', () => {
  const row = (season, games, minutes, score) => ({ season, games, minutes, mpg: minutes / games, minGames: 24, score });

  it('is a rookie year first, then the best season, then Throwbacks', () => {
    const career = [row(2001, 30, 600, 0.2), row(2002, 32, 1000, 1.5), row(2003, 30, 900, 0.8)];
    expect(classifyWnbaSeason(career, 2001)).toBe(WNBA_SETS.rookie);
    expect(classifyWnbaSeason(career, 2002)).toBe(WNBA_SETS.best);
    expect(classifyWnbaSeason(career, 2003)).toBe(WNBA_SETS.other);
  });

  it('gives no rookie card to a first season below the WNBA Rookie bar (10 games, 16 a game)', () => {
    const career = [row(2001, 30, 300, 0.2), row(2002, 32, 1000, 1.5)];
    expect(classifyWnbaSeason(career, 2001)).toBe(WNBA_SETS.other);
  });
});
