// THE CONTEST AND THE SCORE (2026-09-23). The matchup brain prices a
// defender's contest on the checks the man he guards takes, and plays the
// score: spread is worth having behind and a cost ahead, more so late.
import { describe, it, expect } from 'vitest';
import {
  CHECK_RATE, rateAt, checkPoints, contestOf, riskWeight, sectionsLeftInGame, outputVariance,
  expectedOutput, pairValue, RISK_CAP,
} from './ai.js';
import { newGame, getTeam } from './engine.js';
import { CARDS } from './cards.js';

const shooter = { shotLine: 12, threePtBoost: 2, paintBoost: 1 };   // 3PT need 10: a 55% three
const brick = { shotLine: 20, threePtBoost: -3, paintBoost: -3 };   // cannot hit

describe('the check rate', () => {
  it('reads the measured table, carries the ends, and stays a rate', () => {
    expect(rateAt(CHECK_RATE['3pt'], 0.30)).toBeCloseTo(0.136, 6);
    expect(rateAt(CHECK_RATE['3pt'], 0.375)).toBeCloseTo((0.136 + 0.594) / 2, 6);
    expect(rateAt(CHECK_RATE['3pt'], 0)).toBe(0);
    expect(rateAt(CHECK_RATE['3pt'], 0.6)).toBeGreaterThan(0.594);
    expect(rateAt(CHECK_RATE['3pt'], 1)).toBeLessThanOrEqual(1);
    // Steep in the shooter's quality: the reason a contest matters on some rows and not others.
    expect(rateAt(CHECK_RATE['3pt'], 0.45) / rateAt(CHECK_RATE['3pt'], 0.15)).toBeGreaterThan(20);
  });
});

describe('checkPoints', () => {
  it('prices a contest by the checks the shooter takes: a lot on a shooter, nothing on a brick', () => {
    const denyShooter = checkPoints(shooter, 0) - checkPoints(shooter, 3);
    const denyBrick = checkPoints(brick, 0) - checkPoints(brick, 3);
    expect(denyShooter).toBeGreaterThan(0.25);
    expect(denyBrick).toBe(0);
    // Hot markers ride on checks as on rolls.
    expect(checkPoints(shooter, 0, 4)).toBeGreaterThan(checkPoints(shooter, 0, 0));
  });

  it('reads a contest the way the engine rolls it', () => {
    const g = { crunch: null, tempDefEff: { B: { 2: { dbExtra: 2 } } } };
    expect(contestOf(g, { defBoost: 2 })).toBe(2);
    expect(contestOf(g, { defBoost: -1 })).toBe(0);
    expect(contestOf(g, { defBoost: 2 }, 'B', 2)).toBe(4);                  // Defensive Anchor
    expect(contestOf({ crunch: { active: true } }, { defBoost: 1 })).toBe(2); // Crunch Time, with a bonus
    expect(contestOf({ crunch: { active: true } }, { defBoost: 0 })).toBe(0); // ... and without one
  });
});

describe('playing the score', () => {
  const game = (a, b, quarter = 1, section = 1, overtime = 0) => {
    const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
    getTeam(g, 'A').score = a;
    getTeam(g, 'B').score = b;
    return Object.assign(g, { quarter, section, overtime });
  };

  it('counts the sections left', () => {
    expect(sectionsLeftInGame(game(0, 0, 1, 1))).toBe(12);
    expect(sectionsLeftInGame(game(0, 0, 4, 3))).toBe(1);
    expect(sectionsLeftInGame(game(0, 0, 4, 3, 1))).toBe(1);
  });

  it('wants spread behind and shuns it ahead, more as the game shortens, never past the cap', () => {
    expect(riskWeight(game(50, 50), 'A')).toBeCloseTo(0, 10);
    expect(riskWeight(game(40, 50), 'A')).toBeGreaterThan(0);
    expect(riskWeight(game(40, 50), 'B')).toBeLessThan(0);
    expect(riskWeight(game(40, 50, 4, 3), 'A')).toBeGreaterThan(riskWeight(game(40, 50, 2, 1), 'A'));
    expect(riskWeight(game(0, 90, 4, 3), 'A')).toBe(RISK_CAP);
    expect(riskWeight(game(90, 0, 4, 3), 'A')).toBe(-RISK_CAP);
  });

  it('adds the weighted spread of both charts to a row, and nothing at kappa 0', () => {
    const g = game(0, 0);
    const [a, b] = [CARDS[0], CARDS[1]];
    const plain = pairValue(g, 'A', a, b);
    expect(pairValue(g, 'A', a, b, {}, 0, 0)).toBe(plain);
    const behind = pairValue(g, 'A', a, b, {}, 0, 0.1);
    expect(behind).toBeGreaterThan(plain);
    expect(pairValue(g, 'A', a, b, {}, 0, -0.1)).toBeLessThan(plain);
    expect(outputVariance({ chart: [{ lo: 1, hi: 99, pts: 2, reb: 0, ast: 0 }] })).toBe(0);
    expect(expectedOutput({ chart: [{ lo: 1, hi: 99, pts: 2, reb: 0, ast: 0 }] })).toBe(2);
  });
});
