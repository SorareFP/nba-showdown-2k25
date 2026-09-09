// This Is My House takes the roll AND every card that would take the roll as
// checks instead. Patrick Williams, shut out, hit two threes off Green Light
// (the user, 2026-09-09) — the block only stopped the die.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { execCard } from './execCard.js';
import { canPlayCard } from './canPlay.js';
import { aiBuildCardOpts } from './ai.js';

const mk = (id, speed, power, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed, power, defBoost: 0, salary: 500,
  shotLine: 14, paintBoost: 1, threePtBoost: 2, chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }], ...over,
});
const filler = (pre, n) => Array.from({ length: n }, (_, i) => mk(`${pre}${i}`, 10, 10));

/** A's slot 0 (Williams) is guarded by B's slot 0, who is faster AND stronger. */
function board() {
  const A = [mk('williams', 10, 10), mk('a1', 10, 10), mk('a2', 10, 10), mk('a3', 10, 10), mk('a4', 10, 10)];
  const B = [mk('oneale', 14, 14), mk('b1', 10, 10), mk('b2', 10, 10), mk('b3', 10, 10), mk('b4', 10, 10)];
  const g = newGame([...A, ...filler('af', 5)], [...B, ...filler('bf', 5)]);
  getTeam(g, 'A').starters = A;
  getTeam(g, 'B').starters = B;
  getTeam(g, 'A').hand = ['green_light', 'you_stand_over_there', 'cross_court_dime', 'five_out'];
  getTeam(g, 'A').assists = 5;
  getTeam(g, 'B').hand = ['this_is_my_house'];
  g.phase = 'scoring'; g.scoringTurn = 'B'; g.placementStep = 10;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.tempEff = { A: {}, B: {} };
  g.rollResults = { A: [], B: [] };
  return g;
}

describe('a shut-out player', () => {
  it('cannot take his roll as checks through any roll-replacing card', () => {
    const g = board();
    const house = execCard(g, 'B', 'this_is_my_house', { targetIdx: 0, playerIdx: 0, defIdx: 0 });
    expect(house.ok).toBe(true);
    const ng = house.game;
    expect(ng.blockedRolls.A[0]).toBe(true);
    for (const id of ['green_light', 'you_stand_over_there', 'cross_court_dime', 'five_out']) {
      const r = execCard(ng, 'A', id, { playerIdx: 0 });
      expect(r.ok, id).toBe(false);
      expect(r.msg, id).toMatch(/shut out/);
      expect((r.game.rollResults.A || [])[0], id).toBeUndefined();
    }
    // A teammate who is not shut out still can.
    expect(execCard(ng, 'A', 'green_light', { playerIdx: 1 }).ok).toBe(true);
  });

  it('is not offered to Green Light when he is the only one left, and is never the AI\'s pick', () => {
    const g = board();
    const ng = execCard(g, 'B', 'this_is_my_house', { targetIdx: 0, playerIdx: 0, defIdx: 0 }).game;
    // Everyone else has rolled: nobody is left for Green Light.
    ng.rollResults.A = [undefined, { die: 10, pts: 2 }, { die: 10, pts: 2 }, { die: 10, pts: 2 }, { die: 10, pts: 2 }];
    expect(canPlayCard(ng, 'A', 'green_light').canPlay).toBe(false);
    expect(canPlayCard(ng, 'A', 'green_light').reason).toMatch(/shut out/);
    // Slot 1 free again: the coach aims Green Light there, never at the blocked slot 0.
    ng.rollResults.A[1] = undefined;
    expect(canPlayCard(ng, 'A', 'green_light').canPlay).toBe(true);
    expect(aiBuildCardOpts(ng, 'A', 'green_light').playerIdx).toBe(1);
    expect(aiBuildCardOpts(ng, 'A', 'five_out').playerIdx).toBe(1);
  });
});
