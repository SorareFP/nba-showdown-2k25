// Unsung Hero rolls two and keeps the higher; Swarming Defense two and keeps
// the lower; the log shows every die thrown. Pinned under a fixed random
// sequence so the kept die is not a matter of luck.
import { describe, it, expect, vi } from 'vitest';
import { newGame, doRoll } from './engine.js';
import { execCard } from './execCard.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 10, power: 10,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 0, salary: 300,
  chart: [{ lo: 1, hi: 10, pts: 1, reb: 0, ast: 0 }, { lo: 11, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
const roster = prefix => Array.from({ length: 10 }, (_, i) => mk(`${prefix}${i}`));

function rolling() {
  const g = newGame(roster('a'), roster('b'));
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.phase = 'scoring'; g.scoringPasses = 99; g.scoringTurn = 'A';
  g.rollResults = { A: [], B: [] };
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  return g;
}

/** Feed doRoll a fixed die sequence: values are the d20 results wanted. */
function withDice(values, fn) {
  const seq = [...values];
  const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
    const d = seq.length ? seq.shift() : 10;
    return (d - 1) / 20 + 0.001;   // floor(random*20)+1 === d
  });
  try { return fn(); } finally { spy.mockRestore(); }
}

describe('two dice', () => {
  it('Unsung Hero keeps the higher of two, and the log shows both', () => {
    const g = rolling();
    g.teamA.hand = ['unsung_hero'];
    g.scoringPasses = 0;   // the card is played in the window
    const { game: armed, ok } = execCard(g, 'A', 'unsung_hero', { playerIdx: 0 });
    expect(ok).toBe(true);
    expect(armed.tempEff.A.adv0).toBe(1);
    armed.scoringPasses = 99;
    const after = withDice([3, 15], () => doRoll(armed, 'A', 0));
    const r = after.rollResults.A[0];
    expect(r.dice).toEqual([3, 15]);
    expect(r.die).toBe(15);
    expect(after.log.at(-1).msg).toMatch(/a0 🎲\[3 15\]→15/);
  });

  it('a disadvantage keeps the lower', () => {
    const g = rolling();
    g.tempEff = { A: { dis0: 1 } };
    const after = withDice([17, 4], () => doRoll(g, 'A', 0));
    expect(after.rollResults.A[0].dice).toEqual([17, 4]);
    expect(after.rollResults.A[0].die).toBe(4);
    expect(after.log.at(-1).msg).toMatch(/🎲\[17 4\]→4/);
  });

  it('a plain roll prints one die, as before', () => {
    const g = rolling();
    const after = withDice([12], () => doRoll(g, 'A', 0));
    expect(after.rollResults.A[0].dice).toEqual([12]);
    expect(after.log.at(-1).msg).toMatch(/a0 🎲12/);
    expect(after.log.at(-1).msg).not.toMatch(/\[/);
  });
});
