// Go Under: the defence cancels the screen; the OFFENCE chooses which of the
// two players involved takes the consolation 3PT check at +2 (the user,
// 2026-09-09). The check waits as a pending choice until they do.
import { describe, it, expect, vi } from 'vitest';
import { newGame, getTeam, getPS } from './engine.js';
import { execCard, resolveGoUnder } from './execCard.js';
import { aiGoUnderChoice } from './ai.js';
import { simulateGame } from './modes/simulate.js';
import { CARDS } from './cards.js';

const mk = (id, speed, power, { threePtBoost = 1, shotLine = 14 } = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed, power, defBoost: 0, salary: 500, shotLine, paintBoost: 1, threePtBoost,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
});
const filler = (pre, n) => Array.from({ length: n }, (_, i) => mk(`${pre}${i}`, 10, 10));

function afterScreen() {
  const A = [mk('a0', 16, 8, { threePtBoost: 3 }), mk('a1', 8, 16, { threePtBoost: -2, shotLine: 17 }), mk('a2', 10, 10), mk('a3', 10, 10), mk('a4', 10, 10)];
  const B = [mk('b0', 16, 8), mk('b1', 8, 16), mk('b2', 10, 10), mk('b3', 10, 10), mk('b4', 10, 10)];
  const g = newGame([...A, ...filler('af', 5)], [...B, ...filler('bf', 5)]);
  getTeam(g, 'A').starters = A; getTeam(g, 'B').starters = B;
  getTeam(g, 'A').hand = ['high_screen_roll']; getTeam(g, 'B').hand = ['go_under'];
  g.phase = 'matchup_strats'; g.placementStep = 10; g.matchupTurn = 'A'; g.matchupPasses = 0;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.tempEff = { A: {}, B: {} };
  const r = execCard(g, 'A', 'high_screen_roll', { swapSlot1: 0, swapSlot2: 1 });
  expect(r.ok).toBe(true);
  return r.game;
}

describe('Go Under', () => {
  it('cancels the screen and leaves the check as the offence\'s choice', () => {
    const g = afterScreen();
    const r = execCard(g, 'B', 'go_under', {});
    expect(r.ok).toBe(true);
    const ng = r.game;
    expect(ng.offMatchups.A.slice(0, 2)).toEqual([0, 1]);           // pairings restored
    expect(ng.pendingChoice).toMatchObject({ kind: 'go_under', teamKey: 'A', slots: [0, 1], extra: 2, by: 'B' });
    expect(ng.lastMatchupCard).toBeNull();
    expect(getTeam(ng, 'A').score).toBe(0);                          // nothing shot yet
    expect(ng.log.some(l => /Go Under: canceled HSR — Team A chooses which of a0 \/ a1 takes a 3PT check at \+2/.test(l.msg))).toBe(true);
  });

  it('the offence names one of the two, the check is taken, and the choice clears', () => {
    const g = execCard(afterScreen(), 'B', 'go_under', {}).game;
    expect(resolveGoUnder(g, 3).ok).toBe(false);                     // not in the screen
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.55);      // a 12: +2 +3 3PT = 17 vs 14 → in
    const r = resolveGoUnder(g, 0);
    spy.mockRestore();
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').score).toBe(3);
    expect(getPS(r.game, 'A', 'a0').pts).toBe(3);
    expect(r.game.pendingChoice).toBeNull();
    expect(r.game.log.some(l => /Go Under: a0 takes the 3PT check: 🎲12 \+2 card \+3 3PT = 17 vs 14 → 3pts ✓/.test(l.msg))).toBe(true);
    expect(resolveGoUnder(r.game, 0).ok).toBe(false);                // nothing waiting now
  });

  it('the coach, as the offence, sends its better shooter', () => {
    const g = execCard(afterScreen(), 'B', 'go_under', {}).game;
    expect(aiGoUnderChoice(g, 'A')).toBe(0);                         // a0 shoots +3 at 14; a1 −2 at 17
    expect(aiGoUnderChoice(g, 'B')).toBeNull();                      // not B's choice
    getTeam(g, 'A').starters[0].threePtBoost = -6;                  // 15% now; a1's 20% wins
    expect(aiGoUnderChoice(g, 'A')).toBe(1);
  });

  it('whole simulated games resolve it without stalling', () => {
    const seeded = (s = 21) => () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const r = simulateGame(CARDS.slice(20, 30), CARDS.slice(30, 40), { rng: seeded(), keepGame: true });
    expect(r.game.done).toBe(true);
    expect(r.game.pendingChoice ?? null).toBeNull();
  });
});
