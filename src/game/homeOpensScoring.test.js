// THE HOME SIDE OPENS THE SCORING PHASE (2026-10-20). The user, asked whether
// the home team or whoever placed second should play the first scoring card:
// "home team". The coach had opened every scoring phase, home or away.
import { describe, it, expect } from 'vitest';
import { newGame } from './engine.js';
import { CARDS } from './cards.js';

describe('who opens the scoring phase', () => {
  it('is the home side: the one that answers in the snake', () => {
    const away = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
    expect(away.placementOrder[0]).toBe('A');
    expect(away.home).toBe('B');
    expect(away.scoringTurn).toBe('B');
    const home = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, { placementFirst: 'B' });
    expect(home.placementOrder[0]).toBe('B');
    expect(home.home).toBe('A');
    expect(home.scoringTurn).toBe('A');
  });
});
