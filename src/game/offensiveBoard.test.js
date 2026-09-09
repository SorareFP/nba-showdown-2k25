// Offensive Board Mastery: spend 3 rebounds, a player who has rolled takes a
// second scoring roll at −2. The card wrote the grant and nothing read it —
// "Merrill was never given a second scoring roll. There is no button to do
// so." (the user, 2026-09-09). The grant is now a thing the roll, the turn
// gate and the AI all know about.
import { describe, it, expect, vi } from 'vitest';
import { newGame, getTeam, getPS, doRoll, canRollSlot, pendingRolls, extraRollPending } from './engine.js';
import { execCard } from './execCard.js';
import { canPlayCard } from './canPlay.js';
import { aiRollDecision, aiBuildCardOpts } from './ai.js';

const mk = (id, speed = 10, power = 10, chart = null) => ({
  id, name: id, team: 'TST', pos: 'PG', speed, power, defBoost: 0, salary: 500,
  shotLine: 14, paintBoost: 1, threePtBoost: 1,
  chart: chart ?? [{ lo: 1, hi: 10, pts: 0, reb: 1, ast: 0 }, { lo: 11, hi: 99, pts: 2, reb: 0, ast: 1 }],
});
const filler = (pre, n) => Array.from({ length: n }, (_, i) => mk(`${pre}${i}`));

function rolling() {
  // Merrill is an even matchup (10/10 against 10/10), so the second roll's only modifier is the card's −2.
  const A = [mk('merrill', 10, 10, [{ lo: 1, hi: 8, pts: 0, reb: 0, ast: 0 }, { lo: 9, hi: 99, pts: 3, reb: 0, ast: 0 }]), mk('a1'), mk('a2'), mk('a3'), mk('a4')];
  const B = [mk('b0'), mk('b1'), mk('b2'), mk('b3'), mk('b4')];
  const g = newGame([...A, ...filler('af', 5)], [...B, ...filler('bf', 5)]);
  getTeam(g, 'A').starters = A;
  getTeam(g, 'B').starters = B;
  getTeam(g, 'A').hand = ['offensive_board'];
  getTeam(g, 'A').rebounds = 3;
  g.phase = 'scoring'; g.scoringPasses = 99; g.placementStep = 10;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.tempEff = { A: {}, B: {} };
  g.rollResults = { A: [], B: [] };
  return g;
}
const withDie = (n, fn) => { const spy = vi.spyOn(Math, 'random').mockReturnValue((n - 0.5) / 20); try { return fn(); } finally { spy.mockRestore(); } };

describe('Offensive Board Mastery', () => {
  it('waits until someone has rolled, then goes only to a player who has', () => {
    const g = rolling();
    expect(canPlayCard(g, 'A', 'offensive_board').canPlay).toBe(false);
    expect(execCard(g, 'A', 'offensive_board', { playerIdx: 0 }).ok).toBe(false);
    const g2 = withDie(12, () => doRoll(g, 'A', 0));           // Merrill rolls a 12 → 3 pts
    expect(g2.rollResults.A[0].pts).toBe(3);
    expect(canPlayCard(g2, 'A', 'offensive_board').canPlay).toBe(true);
    expect(execCard(g2, 'A', 'offensive_board', { playerIdx: 1 }).ok).toBe(false);   // a1 has not rolled
    const r = execCard(g2, 'A', 'offensive_board', { playerIdx: 0 });
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').rebounds).toBe(0);
    expect(extraRollPending(r.game, 'A', 0)).toBe(true);
    expect(canRollSlot(r.game, 'A', 0)).toBe(true);
    expect(pendingRolls(r.game, 'A')).toBe(5);                 // four first rolls + Merrill's second
    // Not owed twice.
    getTeam(r.game, 'A').rebounds = 3;
    expect(execCard(r.game, 'A', 'offensive_board', { playerIdx: 0 }).ok).toBe(false);
  });

  it('the second roll lands at −2, adds to the first, and the slot closes again', () => {
    let g = withDie(12, () => doRoll(rolling(), 'A', 0));
    g = execCard(g, 'A', 'offensive_board', { playerIdx: 0 }).game;
    const before = getTeam(g, 'A').score;
    const ng = withDie(10, () => doRoll(g, 'A', 0));          // 10 − 2 = 8 → the 0-pt row
    const rr = ng.rollResults.A[0];
    expect(rr.second).toBe(true);
    expect(rr.bonus).toBe(-2);
    expect(rr.finalRoll).toBe(8);
    expect(rr.pts).toBe(0);
    expect(rr.prev.pts).toBe(3);
    expect(getTeam(ng, 'A').score).toBe(before);              // the miss added nothing; the 3 stands
    expect(getPS(ng, 'A', 'merrill').pts).toBe(3);
    expect(extraRollPending(ng, 'A', 0)).toBe(false);
    expect(canRollSlot(ng, 'A', 0)).toBe(false);
    expect(ng.log.some(l => /2nd roll — merrill/.test(l.msg))).toBe(true);
    // A third roll is refused outright.
    expect(withDie(20, () => doRoll(ng, 'A', 0))).toBe(ng);
    // And a hit on the second roll counts on top.
    const hit = withDie(15, () => doRoll(g, 'A', 0));         // 15 − 2 = 13 → 3 pts
    expect(getTeam(hit, 'A').score).toBe(before + 3);
    expect(getPS(hit, 'A', 'merrill').pts).toBe(6);
  });

  it('the AI takes its own second roll, and aims the card at the steepest chart', () => {
    let g = withDie(12, () => doRoll(rolling(), 'A', 0));
    for (let i = 1; i < 5; i += 1) g = withDie(12, () => doRoll(g, 'A', i));
    expect(aiRollDecision(g, 'A')).toBeNull();                 // everyone rolled
    expect(aiBuildCardOpts(g, 'A', 'offensive_board')).toEqual({ playerIdx: 0 });   // Merrill's chart pays most
    g = execCard(g, 'A', 'offensive_board', { playerIdx: 0 }).game;
    expect(aiRollDecision(g, 'A')).toMatchObject({ type: 'roll', playerIdx: 0 });
  });
});
