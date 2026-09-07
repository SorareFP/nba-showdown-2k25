// The AI's defensive assignment, judged by the engine's own matchup verdict.
//
// The regression: the old assignment was a sorted pairing — strongest body on
// biggest threat — which is blind to fit and, on rosters in strength order,
// returns the identity every section. These tests would all fail against it.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, calcAdv } from './engine.js';
import { CARDS } from './cards.js';
import { aiSetMatchups } from './ai.js';

function matchupGame(defenders, attackers) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  // B defends (the AI); A attacks.
  getTeam(g, 'B').starters = defenders.map((o, i) => ({ ...CARDS[10 + i], defBoost: 0, ...o }));
  getTeam(g, 'A').starters = attackers.map((o, i) => ({ ...CARDS[i], ...o }));
  g.phase = 'matchup_strats';
  g.tempEff = { A: {}, B: {} };
  return g;
}

const filler = { speed: 10, power: 10, salary: 300 };
const totalFor = (g, matchups) => {
  const att = getTeam(g, 'A').starters;
  const def = getTeam(g, 'B').starters;
  return matchups.reduce((t, d, a) => t + calcAdv(att[a], def[d], {}, a).rollBonus, 0);
};
const permutations = n => {
  const out = [];
  const walk = (p, used) => {
    if (p.length === n) { out.push(p.slice()); return; }
    for (let d = 0; d < n; d += 1) if (!used[d]) { used[d] = true; p.push(d); walk(p, used); p.pop(); used[d] = false; }
  };
  walk([], []);
  return out;
};

describe('aiSetMatchups', () => {
  it('matches by FIT: the fast defender takes the fast attacker, the strong one the strong one', () => {
    // Same speed+power on both defenders, so a sorted pairing cannot tell them
    // apart. The engine can: the fast guard holds the fast attacker to nothing
    // and the slow centre holds the strong one to nothing; crossed, each gives
    // up a big advantage.
    const g = matchupGame(
      [{ speed: 18, power: 8, salary: 500 }, { speed: 8, power: 18, salary: 500 }, filler, filler, filler],
      [{ speed: 16, power: 8, salary: 500 }, { speed: 8, power: 16, salary: 500 }, filler, filler, filler]
    );
    const { matchups } = aiSetMatchups(g, 'B');
    expect(matchups[0]).toBe(0);
    expect(matchups[1]).toBe(1);
  });

  it('is a permutation — every defender used once', () => {
    const g = matchupGame([filler, filler, filler, filler, filler], [filler, filler, filler, filler, filler]);
    const { matchups } = aiSetMatchups(g, 'B');
    expect([...matchups].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('gives the opponent no more total modifier than any other assignment', () => {
    // Uneven salaries so the weighting is exercised, then checked against the
    // UNWEIGHTED optimum too: the weighted choice must never be worse than the
    // identity, and among equal-salary attackers it must be the true minimum.
    const equal = { salary: 500 };
    const g = matchupGame(
      [{ speed: 14, power: 12, ...equal }, { speed: 9, power: 17, ...equal }, { speed: 16, power: 6, ...equal },
       { speed: 11, power: 11, ...equal }, { speed: 7, power: 15, ...equal }],
      [{ speed: 15, power: 9, ...equal }, { speed: 8, power: 16, ...equal }, { speed: 12, power: 12, ...equal },
       { speed: 17, power: 5, ...equal }, { speed: 10, power: 14, ...equal }]
    );
    const { matchups } = aiSetMatchups(g, 'B');
    const chosen = totalFor(g, matchups);
    const minimum = Math.min(...permutations(5).map(p => totalFor(g, p)));
    expect(chosen).toBeCloseTo(minimum, 9);
    expect(chosen).toBeLessThanOrEqual(totalFor(g, [0, 1, 2, 3, 4]));
  });

  it('spends its best defender on their star, not their twelfth man, when it must choose', () => {
    // One good defender, one attacker who is a star by salary and one who is
    // not, otherwise identical. Salary weighting sends the good defender to
    // the star.
    const g = matchupGame(
      [{ speed: 17, power: 17, salary: 900 }, filler, filler, filler, filler],
      [{ speed: 14, power: 14, salary: 300 }, { speed: 14, power: 14, salary: 1400 }, filler, filler, filler]
    );
    const { matchups } = aiSetMatchups(g, 'B');
    expect(matchups[1]).toBe(0);
  });
});
