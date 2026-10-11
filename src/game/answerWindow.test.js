// THE COACH WAITS FOR YOUR ANSWER (the user, 2026-10-11: "There are still a
// lot of instances where the CPU plays so fast that I can't play things like
// glass cleaner. A lot of post-shot check stuff.").
//
// Two causes. The 5-assist and 5-rebound checks never left the miss record
// the post-miss cards read, so Glass Cleaner could never answer one. And the
// coach acted again 0.7 s after its own check or roll, replacing what your
// card would have answered.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { newGame, getTeam, spendReboundBonus, spendAssist, doRoll } from './engine.js';
import { canPlayCard, answerWindow, passAnswer } from './canPlay.js';
import { CARDS } from './cards.js';

const p = (name, over = {}) => ({
  ...CARDS[0], id: name, name, speed: 10, power: 10, defBoost: 0, salary: 500,
  threePtBoost: 0, paintBoost: 0, shotLine: 15, pos: 'F', ...over,
});
function game({ handA = [] } = {}) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  for (const k of ['A', 'B']) {
    getTeam(g, k).starters = [0, 1, 2, 3, 4].map(i => p(`${k}${i}`));
    for (const s of getTeam(g, k).starters) getTeam(g, k).stats.push({ id: s.id, pts: 0, reb: 0, ast: 0, minutes: 0 });
    getTeam(g, k).hand = [];
  }
  getTeam(g, 'A').hand = handA;
  g.phase = 'scoring';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.rollResults = { A: [], B: [] };
  g.tempEff = {}; g.tempDefEff = {};
  const b = getTeam(g, 'B');
  b.rebounds = 20; b.reboundsWon = 20; b.assists = 20;
  return g;
}
const die = (n, fn) => {
  vi.spyOn(Math, 'random').mockReturnValue((n - 0.5) / 20);
  try { return fn(); } finally { vi.restoreAllMocks(); }
};
afterEach(() => vi.restoreAllMocks());

describe('a missed spend check opens the post-miss window', () => {
  it('the 5-rebound paint check: Glass Cleaner can answer the miss', () => {
    const r = die(1, () => spendReboundBonus(game({ handA: ['glass_cleaner'] }), 'B', 'paint_check', 0));
    expect(r.ok).toBe(true);
    expect(r.game.lastCheckMiss).toMatchObject({ teamKey: 'B', type: 'paint', playerIdx: 0, claimed: false });
    expect(canPlayCard(r.game, 'A', 'glass_cleaner').canPlay).toBe(true);
  });

  it('the 5-assist paint and three-point checks record theirs too, and a make clears it', () => {
    const paint = die(1, () => spendAssist(game(), 'B', 'paint', 1));
    expect(paint.game.lastCheckMiss).toMatchObject({ teamKey: 'B', type: 'paint', playerIdx: 1 });
    const three = die(1, () => spendAssist(game(), 'B', '3pt', 2));
    expect(three.game.lastCheckMiss).toMatchObject({ teamKey: 'B', type: '3pt', playerIdx: 2 });
    const made = die(20, () => spendAssist(paint.game, 'B', 'paint', 1));
    expect(made.game.lastCheckMiss).toBeNull();
  });
});

describe('the coach waits while you hold an answer', () => {
  it('opens on the coach\'s miss when Glass Cleaner is in your hand, and closes when you pass', () => {
    const r = die(1, () => spendReboundBonus(game({ handA: ['glass_cleaner', 'hammer_set'] }), 'B', 'paint_check', 0));
    expect(answerWindow(r.game, 'A')).toEqual(['glass_cleaner']);
    const passed = passAnswer(r.game);
    expect(answerWindow(passed, 'A')).toEqual([]);
    // The coach's next miss is a new moment: it opens again.
    const again = die(1, () => spendReboundBonus(passed, 'B', 'paint_check', 1));
    expect(answerWindow(again.game, 'A')).toEqual(['glass_cleaner']);
  });

  it('stays shut when you hold nothing that can answer', () => {
    const r = die(1, () => spendReboundBonus(game({ handA: ['hammer_set'] }), 'B', 'paint_check', 0));
    expect(answerWindow(r.game, 'A')).toEqual([]);
  });

  it('opens on the coach\'s roll for Box Out, and a new roll is a new moment', () => {
    const g = game({ handA: ['box_out'] });
    // Every roll wins two rebounds, so there is something to box out.
    for (const s of getTeam(g, 'B').starters) s.chart = [{ lo: 1, hi: 99, pts: 2, reb: 2, ast: 1 }];
    const rolled = die(10, () => doRoll(g, 'B', 0));
    expect(rolled.lastRoll).toMatchObject({ teamKey: 'B', reb: 2 });
    expect(answerWindow(rolled, 'A')).toEqual(['box_out']);
    const passed = passAnswer(rolled);
    expect(answerWindow(passed, 'A')).toEqual([]);
    const next = die(10, () => doRoll(passed, 'B', 1));
    expect(answerWindow(next, 'A')).toEqual(['box_out']);
  });
});
