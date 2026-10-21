// A TIMEOUT HOLDS THE OTHER TEAM (the user, 2026-10-21: "When I call timeout,
// the other team shouldn't be able to roll. Same on both sides."). The coach
// rolled straight through the human's timeout: nothing on the roll path read
// timeoutActive. Now one rule, heldByTimeout, closes the other side's dice —
// its rolls, its spend checks, its turn in the roll gate, the coach's card
// window — until endTimeout, and the turn line says so.
import { describe, it, expect } from 'vitest';
import {
  newGame, spendTimeout, endTimeout, doRoll, rollGate, coachCardWindow, rollTurnLine, spendAssist,
  heldByTimeout, CRUNCH_MARGIN,
} from './engine.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 10, power: 10,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
const roster = p => Array.from({ length: 10 }, (_, i) => mk(`${p}${i}`));

/** Crunch time, rolling open, each side with one die thrown so either may call its timeout. */
function crunchRolling() {
  const g = newGame(roster('a'), roster('b'));
  g.quarter = 4; g.section = 3; g.phase = 'scoring';
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.teamA.score = 80; g.teamB.score = 84;
  g.crunch = { active: true, margin: 4 <= CRUNCH_MARGIN ? 4 : 0, used: {}, extra: {}, timeoutUsed: {} };
  g.scoringPasses = 99;
  let r = doRoll(g, 'A', 0);
  r = doRoll(r, 'B', 0);
  return r;
}
const rolled = (g, k, i) => (g.rollResults[k] || [])[i] != null;

describe('a timeout holds the other team', () => {
  for (const [caller, other] of [['A', 'B'], ['B', 'A']]) {
    it(`Team ${caller}'s timeout: Team ${other} throws no die until play resumes`, () => {
      const t = spendTimeout(crunchRolling(), caller);
      expect(t.ok, t.msg).toBe(true);
      const g = t.game;
      expect(heldByTimeout(g, other)).toBe(true);
      expect(heldByTimeout(g, caller)).toBe(false);
      // The roll itself is refused, whichever route asks.
      expect(rolled(doRoll(g, other, 1), other, 1)).toBe(false);
      expect(rollGate(g)[other]).toBe(false);
      expect(spendAssist({ ...g, [other === 'A' ? 'teamA' : 'teamB']: { ...g[other === 'A' ? 'teamA' : 'teamB'], assists: 9 } }, other, '3pt', 1).ok).toBe(false);
      expect(coachCardWindow(g, other)).toBe(false);
      // Play resumes: the held side rolls again.
      const back = endTimeout(g);
      expect(heldByTimeout(back, other)).toBe(false);
      expect(rolled(doRoll(back, other, 1), other, 1)).toBe(true);
    });
  }

  it('lets the side that called it keep its own turn', () => {
    const { game } = spendTimeout(crunchRolling(), 'A');
    expect(rollGate(game).A).toBe(true);
    expect(rolled(doRoll(game, 'A', 1), 'A', 1)).toBe(true);
  });

  it('says who waits, against the coach and in PvP', () => {
    const a = spendTimeout(crunchRolling(), 'A').game;
    const b = spendTimeout(crunchRolling(), 'B').game;
    expect(rollTurnLine(a, rollGate(a))).toBe('Your timeout: the coach waits to roll');
    expect(rollTurnLine(b, rollGate(b))).toBe("The coach's timeout: you wait to roll");
    expect(rollTurnLine(a, null)).toBe('Team A timeout: Team B waits to roll');
    expect(rollTurnLine(crunchRolling(), null)).toBe('All players may roll');
  });
});
