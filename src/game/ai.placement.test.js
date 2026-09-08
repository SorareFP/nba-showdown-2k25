// The placement snake, played out by the AI in points.
//
// The regression each of these guards: the greedy row-by-row score answered
// whatever was in front of it with its best defender and valued a +3 the
// same on every chart. The search here values a pairing by what both charts
// pay and looks at the rows still to come.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, calcAdv } from './engine.js';
import { aiPlacementPick, placementChoices, pairValue, expectedOutput } from './ai.js';

/** A card whose chart pays `pts` a step from a base, so a bonus is worth exactly `slope` points a step. */
const mk = (id, speed, power, { defBoost = 0, base = 4, slope = 0.25, salary = 500 } = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed, power, defBoost, salary,
  shotLine: 14, paintBoost: 1, threePtBoost: 1,
  // Twenty one-wide rows so expectedOutput moves by exactly `slope` per point of bonus.
  chart: Array.from({ length: 40 }, (_, i) => ({ lo: i + 1, hi: i + 1, pts: Math.max(0, base + slope * (i - 10)), reb: 0, ast: 0 })),
});

function placing(A, B, { aPlaced = [], bPlaced = [], step = 0 } = {}) {
  const fill = (pre, n) => Array.from({ length: n }, (_, i) => mk(`${pre}f${i}`, 8, 8));
  const g = newGame([...A, ...fill('a', 10 - A.length)], [...B, ...fill('b', 10 - B.length)]);
  g.phase = 'matchup_strats';
  g.draft = { ...(g.draft || {}), aPicks: A.map(p => p.id), bPicks: B.map(p => p.id) };
  getTeam(g, 'A').starters = aPlaced.map(id => A.find(p => p.id === id));
  getTeam(g, 'B').starters = bPlaced.map(id => B.find(p => p.id === id));
  g.placementStep = step;
  return g;
}

describe('pairValue', () => {
  it('is my points at my bonus less theirs at their bonus', () => {
    const g = placing([mk('a', 14, 10)], [mk('b', 10, 10)]);
    const a = getTeam(g, 'A').roster[0], b = getTeam(g, 'B').roster[0];
    const mine = calcAdv(a, b, {}, 0).rollBonus;      // +4
    const theirs = calcAdv(b, a, {}, 0).rollBonus;    // 0 (both ≤ 0 → penalty of the least negative... −4 speed, 0 power → 0)
    const expected = expectedOutput(a, mine) - expectedOutput(b, theirs) + 0.05 * (mine - theirs);
    expect(pairValue(g, 'A', a, b)).toBeCloseTo(expected, 6);
    // The tie-break is antisymmetric too, so the other chair sees exactly the negative.
    expect(pairValue(g, 'B', b, a)).toBeCloseTo(-expected, 6);
  });

  it('carries fatigue and markers the way the roll does', () => {
    const g = placing([mk('a', 10, 10)], [mk('b', 10, 10)]);
    const a = getTeam(g, 'A').roster[0], b = getTeam(g, 'B').roster[0];
    const fresh = pairValue(g, 'A', a, b);
    getTeam(g, 'A').stats.find(s => s.id === 'a').minutes = 12;   // −6
    expect(pairValue(g, 'A', a, b)).toBeLessThan(fresh);
    getTeam(g, 'A').stats.find(s => s.id === 'a').hot = 3;        // +6, cancels it
    expect(pairValue(g, 'A', a, b)).toBeCloseTo(fresh, 6);
  });
});

describe('aiPlacementPick', () => {
  it('answers a row with the player whose pairing pays most in points, not in raw bonus', () => {
    // A led with a strong attacker. B's choices: a defender who holds him to
    // nothing but scores nothing back, and a scorer who gives up +2 but has
    // a steep chart. The steep chart at −2 still out-earns the flat one.
    const star = mk('star', 14, 14, { base: 8, slope: 0.4 });
    const wall = mk('wall', 14, 14, { base: 2, slope: 0.05, defBoost: 2 });
    const scorer = mk('scorer', 12, 12, { base: 9, slope: 0.5 });
    const g = placing([star, mk('a2', 8, 8), mk('a3', 8, 8), mk('a4', 8, 8), mk('a5', 8, 8)],
      [wall, scorer, mk('b3', 8, 8), mk('b4', 8, 8), mk('b5', 8, 8)], { aPlaced: ['star'], step: 1 });
    const pick = aiPlacementPick(g, 'B');
    const byRow = placementChoices(g, 'B');
    expect(byRow.map(c => c.player.id)).toContain('wall');
    // Whatever wins, it is the one the search values highest — and the search's
    // own row value for the winner beats the loser's.
    const win = byRow[0], lose = byRow.find(c => c.player.id !== win.player.id && ['wall', 'scorer'].includes(c.player.id));
    expect(pick.playerId).toBe(win.player.id);
    expect(win.value).toBeGreaterThanOrEqual(lose.value);
  });

  it('does not spend its best defender on a scrub when a star is still to come', () => {
    // A leads row 1 with a nobody. Greedy answers with the stopper (biggest
    // edge-minus-edge); the search keeps the stopper for A's star, who by the
    // snake must land in a row B answers (rows 3 or 5) or B leads (2, 4).
    const nobody = mk('nobody', 6, 6, { base: 1, slope: 0.05, salary: 150 });
    const aStar = mk('aStar', 16, 16, { base: 10, slope: 0.6, salary: 950 });
    const stopper = mk('stopper', 15, 15, { base: 2, slope: 0.05, defBoost: 3 });
    const body1 = mk('body1', 9, 9, { base: 3, slope: 0.2 });
    const body2 = mk('body2', 9, 9, { base: 3, slope: 0.2 });
    const g = placing([nobody, aStar, mk('a3', 9, 9), mk('a4', 9, 9), mk('a5', 9, 9)],
      [stopper, body1, body2, mk('b4', 9, 9), mk('b5', 9, 9)], { aPlaced: ['nobody'], step: 1 });
    const pick = aiPlacementPick(g, 'B');
    expect(pick.playerId).not.toBe('stopper');
  });

  it('leads a row with the player whose worst answer is best', () => {
    // B leads row 2 (step 2). Its scorer is fine against anyone A has left;
    // its slow big, on a flat chart, gets punished by A's fast guard on a
    // steep one — the guard's +11 pays far more than the big's +10 back.
    // Lead with the scorer and keep the big for a row B answers.
    const scorer = mk('scorer', 12, 12, { base: 7, slope: 0.3 });
    const big = mk('big', 6, 16, { base: 6, slope: 0.2 });
    const guard = mk('guard', 17, 6, { base: 8, slope: 0.6 });
    const g = placing([mk('a1', 10, 10), guard, mk('a3', 10, 10), mk('a4', 10, 10), mk('a5', 10, 10)],
      [mk('b1', 10, 10), scorer, big, mk('b4', 10, 10), mk('b5', 10, 10)], { aPlaced: ['a1'], bPlaced: ['b1'], step: 2 });
    const choices = placementChoices(g, 'B');
    expect(choices[0].answering).toBe(false);
    expect(choices.find(c => c.player.id === 'scorer').value).toBeGreaterThan(choices.find(c => c.player.id === 'big').value);
  });

  it('only ever places a remaining pick, and returns null once all five are down', () => {
    const A = Array.from({ length: 5 }, (_, i) => mk(`a${i}`, 8 + i, 12 - i));
    const B = Array.from({ length: 5 }, (_, i) => mk(`b${i}`, 12 - i, 8 + i));
    const g = placing(A, B, { aPlaced: ['a0', 'a1', 'a2'], bPlaced: ['b0', 'b1', 'b2'], step: 6 });
    const pick = aiPlacementPick(g, 'B');
    expect(['b3', 'b4']).toContain(pick.playerId);
    getTeam(g, 'B').starters = B;
    g.placementStep = 10;
    expect(aiPlacementPick(g, 'B')).toBeNull();
  });

  it('plays the whole snake out without a stale state — every step, both sides, in one game', () => {
    const A = Array.from({ length: 5 }, (_, i) => mk(`a${i}`, 8 + 2 * i, 16 - 2 * i, { base: 3 + i, slope: 0.1 + 0.05 * i }));
    const B = Array.from({ length: 5 }, (_, i) => mk(`b${i}`, 16 - 2 * i, 8 + 2 * i, { base: 3 + i, slope: 0.1 + 0.05 * i }));
    const g = placing(A, B);
    for (let step = 0; step < 10; step += 1) {
      const key = g.placementOrder[step];
      const pick = aiPlacementPick(g, key);
      expect(pick).toBeTruthy();
      const team = getTeam(g, key);
      expect(team.starters.some(p => p.id === pick.playerId)).toBe(false);
      team.starters.push(team.roster.find(r => r.id === pick.playerId));
      g.placementStep = step + 1;
    }
    expect(getTeam(g, 'A').starters).toHaveLength(5);
    expect(getTeam(g, 'B').starters).toHaveLength(5);
  });
});
