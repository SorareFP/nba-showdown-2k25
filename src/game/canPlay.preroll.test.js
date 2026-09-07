// The pre-roll family lights only when someone can still be targeted.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { CARDS } from './cards.js';
import { canPlayCard, preRollTargets } from './canPlay.js';

function game({ rolls = [], blocked = {}, threes = [] } = {}) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'A').starters = CARDS.slice(0, 5).map((c, i) => ({ ...c, threePtBoost: threes.includes(i) ? 1 : 0 }));
  getTeam(g, 'A').assists = 5;
  g.phase = 'scoring';
  g.scoringTurn = 'A';
  g.rollResults = { A: rolls, B: [] };
  g.blockedRolls = { A: blocked };
  return g;
}
const allRolled = [1, 2, 3, 4, 5].map(die => ({ die }));

describe('preRollTargets', () => {
  it('is everyone before the rolls, nobody after, minus the blocked and the filtered', () => {
    expect(preRollTargets(game(), 'A').map(t => t.idx)).toEqual([0, 1, 2, 3, 4]);
    expect(preRollTargets(game({ rolls: allRolled }), 'A')).toEqual([]);
    expect(preRollTargets(game({ blocked: { 1: true } }), 'A').map(t => t.idx)).toEqual([0, 2, 3, 4]);
    expect(preRollTargets(game({ threes: [3] }), 'A', p => p.threePtBoost > 0).map(t => t.idx)).toEqual([3]);
  });
});

describe('Elevator Doors', () => {
  it('greys when every 3PT shooter has rolled — the Kon Knueppel case', () => {
    const rolls = [undefined, undefined, { die: 12 }, undefined, undefined];
    const g = game({ rolls, threes: [2] });
    const play = canPlayCard(g, 'A', 'elevator_doors');
    expect(play.canPlay).toBe(false);
    expect(play.reason).toMatch(/already rolled/);
  });

  it('lights while a 3PT shooter still has a roll to come', () => {
    expect(canPlayCard(game({ threes: [2] }), 'A', 'elevator_doors').canPlay).toBe(true);
  });
});

describe('the rest of the family', () => {
  for (const id of ['cross_court_dime', 'power_move', 'pin_down_screen', 'you_stand_over_there']) {
    it(`${id} greys when every roll is in`, () => {
      expect(canPlayCard(game(), 'A', id).canPlay).toBe(true);
      expect(canPlayCard(game({ rolls: allRolled }), 'A', id).canPlay).toBe(false);
    });
  }
});
