// From Way Downtown is playable on a player whose roll was skipped by their
// own card, not on one whose roll was blocked by the other side's.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { CARDS } from './cards.js';
import { canPlayCard, fwdTargets } from './canPlay.js';

function game(rollsA, blockedA = {}) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'A').starters = CARDS.slice(0, 5);
  g.phase = 'scoring';
  g.scoringTurn = 'A';
  g.rollResults = { A: rollsA, B: [] };
  g.blockedRolls = { A: blockedA };
  return g;
}

describe('From Way Downtown', () => {
  it('offers players who have not rolled', () => {
    expect(fwdTargets(game([]), 'A').map(t => t.idx)).toEqual([0, 1, 2, 3, 4]);
  });

  it('offers a player whose roll was SKIPPED (You Stand Over There), not one who rolled', () => {
    const rolls = [{ die: 12 }, { die: '-', isReplaced: true }, undefined, undefined, undefined];
    expect(fwdTargets(game(rolls), 'A').map(t => t.idx)).toEqual([1, 2, 3, 4]);
  });

  it('does not offer a player whose roll was BLOCKED by This Is My House', () => {
    expect(fwdTargets(game([], { 2: true }), 'A').map(t => t.idx)).toEqual([0, 1, 3, 4]);
  });

  it('greys the card when every roll is in', () => {
    const rolls = [{ die: 1 }, { die: 2 }, { die: 3 }, { die: 4 }, { die: 5 }];
    expect(canPlayCard(game(rolls), 'A', 'from_way_downtown').canPlay).toBe(false);
    rolls[3] = { die: '-', isReplaced: true };
    expect(canPlayCard(game(rolls), 'A', 'from_way_downtown').canPlay).toBe(true);
  });
});
