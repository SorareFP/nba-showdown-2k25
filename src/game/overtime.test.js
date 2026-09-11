// OVERTIME (2026-09-11). The user: "Overtime should just be another
// 'Crunch-Time' section, should there be a tie after regulation. In any game."
import { describe, it, expect } from 'vitest';
import { newGame, endSection, periodLabel, MAX_OVERTIMES } from './engine.js';
import { simulateGame } from './modes/simulate.js';
import { CARDS } from './cards.js';

/** The last section of regulation, about to end, at `a`–`b`. */
function buzzer(a, b) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  g.quarter = 4;
  g.section = 3;
  g.phase = 'scoring';
  g.teamA.score = a;
  g.teamB.score = b;
  g.crunch = { active: true, margin: 0, used: { A: 1 }, extra: {}, timeoutUsed: { A: true, B: true }, searched: { A: true } };
  return g;
}

describe('overtime', () => {
  it('ends a game that is decided at the buzzer', () => {
    expect(endSection(buzzer(101, 99)).done).toBe(true);
  });

  it('sends a tie to overtime — another Crunch-Time section, with a fresh timeout and Clutch Possession', () => {
    const ot = endSection(buzzer(100, 100));
    expect(ot.done).toBeFalsy();
    expect(ot.overtime).toBe(1);
    expect(ot.phase).toBe('draft');
    expect([ot.quarter, ot.section]).toEqual([4, 3]);
    expect(ot.crunch).toMatchObject({ active: true, margin: 0, used: {}, timeoutUsed: {}, searched: {} });
    expect(ot.log.some(l => /OT — tied at 100/.test(l.msg))).toBe(true);
    expect(periodLabel(ot)).toBe('OT');
  });

  it('goes to double overtime if it is still tied, and ends as soon as it is not', () => {
    const first = endSection(buzzer(100, 100));
    const tiedAgain = endSection({ ...first, phase: 'scoring', teamA: { ...first.teamA, score: 110 }, teamB: { ...first.teamB, score: 110 } });
    expect(tiedAgain.overtime).toBe(2);
    expect(periodLabel(tiedAgain)).toBe('2OT');
    const decided = endSection({ ...tiedAgain, phase: 'scoring', teamA: { ...tiedAgain.teamA, score: 121 } });
    expect(decided.done).toBe(true);
  });

  it('lets a tie stand only after the safety bound', () => {
    const g = { ...buzzer(90, 90), overtime: MAX_OVERTIMES };
    expect(endSection(g).done).toBe(true);
  });

  it('labels regulation as it always has', () => {
    const g = buzzer(0, 0);
    expect(periodLabel(g)).toBe('Q4 · Sec 3/3');
    expect(periodLabel(g, { short: true })).toBe('Q4 Sec 3');
  });

  it('never leaves a simulated game tied', () => {
    let s = 7;
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
    for (let i = 0; i < 12; i += 1) {
      const r = simulateGame(CARDS.slice(i, i + 10), CARDS.slice(i + 20, i + 30), { rng });
      expect(r.winner).not.toBeNull();
      expect(r.sections).toBeGreaterThanOrEqual(12);
    }
  });
});
