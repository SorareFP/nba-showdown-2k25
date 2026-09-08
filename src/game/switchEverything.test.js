// Switch Everything's price: every POSITIVE advantage the offence holds is
// doubled for the section. The card wrote the flag (`tempEff.doubleAdv`) and
// nothing ever read it — the user (2026-09-08): "Jackson should have had a
// +10 here" on a S+5 P+1 matchup after the AI switched everything. The
// doubling lives in calcAdv now, so the roll, the board's matchup line and
// the AI's reading all agree.
import { describe, it, expect, vi } from 'vitest';
import { newGame, getTeam, calcAdv, doRoll } from './engine.js';
import { execCard } from './execCard.js';

const mk = (id, speed, power, defBoost = 0) => ({
  id, name: id, team: 'TST', pos: 'PG', speed, power, defBoost, salary: 500,
  shotLine: 14, paintBoost: 1, threePtBoost: 1,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
});
const filler = (pre, n) => Array.from({ length: n }, (_, i) => mk(`${pre}${i}`, 10, 10));

function board() {
  const A = [mk('jjj', 15, 11), mk('a1', 10, 10), mk('a2', 6, 6), mk('a3', 10, 10), mk('a4', 10, 10)];
  const B = [mk('randle', 10, 10), mk('b1', 10, 10), mk('b2', 12, 12, 1), mk('b3', 10, 10), mk('b4', 10, 10)];
  const g = newGame([...A, ...filler('af', 5)], [...B, ...filler('bf', 5)]);
  getTeam(g, 'A').starters = A;
  getTeam(g, 'B').starters = B;
  getTeam(g, 'B').hand = ['switch_everything'];
  g.phase = 'scoring'; g.scoringTurn = 'B'; g.placementStep = 10;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.tempEff = { A: {}, B: {} };
  return g;
}

describe('Switch Everything doubles the offence\'s advantages', () => {
  it('sets the flag, and calcAdv doubles a positive edge but not a penalty', () => {
    const g = board();
    const r = execCard(g, 'B', 'switch_everything', { assignments: [0, 1, 2, 3, 4] });
    expect(r.ok).toBe(true);
    const ng = r.game;
    expect(ng.tempEff.A.doubleAdv).toBe(true);
    const A = getTeam(ng, 'A').starters, B = getTeam(ng, 'B').starters;
    // Jackson S+5 P+1 → Roll +10 (and +2 on the power side).
    const jjj = calcAdv(A[0], B[0], ng.tempEff.A, 0);
    expect(jjj).toMatchObject({ speedAdv: 10, powerAdv: 2, rollBonus: 10, hasPenalty: false });
    // A penalty is a penalty; it is not doubled.
    const a2 = calcAdv(A[2], B[2], ng.tempEff.A, 2);
    expect(a2.hasPenalty).toBe(true);
    expect(a2.rollBonus).toBe(-6);   // S−6 P−6 → the least negative, untouched
    // Without the flag, the same pairing is +5.
    expect(calcAdv(A[0], B[0], {}, 0).rollBonus).toBe(5);
    // The defence's own attackers are untouched.
    expect(ng.tempEff.B.doubleAdv).toBeUndefined();
  });

  it('the roll carries the doubled bonus', () => {
    const g = board();
    const ng = execCard(g, 'B', 'switch_everything', { assignments: [0, 1, 2, 3, 4] }).game;
    ng.scoringPasses = 99;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.35);   // die 8
    const rolled = doRoll(ng, 'A', 0);
    spy.mockRestore();
    expect(rolled.rollResults.A[0].bonus).toBe(10);
    expect(rolled.rollResults.A[0].die).toBe(8);
    expect(rolled.log.some(l => /🎲8\+10=18|🎲8 \+10|\+10/.test(l.msg))).toBe(true);
  });
});
