// THE COACH NEVER TAKES A CHECK IT CANNOT MAKE (the user, 2026-10-11: "The AI
// is playing a lot of shot checks that they can't make, which really
// shouldn't even be a thing on the lowest difficulty, but it's happening on
// Deity"). With three times a check's cost in the bank the spending floor fell
// to zero, and a lower rung spent whenever it could afford it: both took the
// best check on the floor even when it needed a 21.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { newGame, getTeam, checkNeed } from './engine.js';
import { aiSpendDecision } from './ai.js';
import { CARDS } from './cards.js';

const p = (name, over = {}) => ({
  ...CARDS[0], id: name, name, speed: 10, power: 10, defBoost: 0, salary: 500,
  threePtBoost: 0, paintBoost: 0, shotLine: 15, pos: 'F', ...over,
});
/** The coach (B) with a full bank and, unless `makeable`, nobody who can make a check. */
function game({ makeable = false } = {}) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  for (const k of ['A', 'B']) {
    getTeam(g, k).starters = [0, 1, 2, 3, 4].map(i => p(`${k}${i}`, k === 'B' ? { shotLine: makeable && i === 2 ? 15 : 40 } : {}));
    for (const s of getTeam(g, k).starters) getTeam(g, k).stats.push({ id: s.id, pts: 0, reb: 0, ast: 0, minutes: 0 });
    getTeam(g, k).hand = [];
  }
  g.phase = 'scoring';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.rollResults = { A: [], B: [] };
  g.tempEff = {}; g.tempDefEff = {};
  const b = getTeam(g, 'B');
  b.assists = 30; b.rebounds = 30; b.reboundsWon = 30;
  return g;
}
afterEach(() => vi.restoreAllMocks());

describe('the coach and a check it cannot make', () => {
  it('the fixture really is impossible: every coach shooter needs a 21 or more', () => {
    const g = game();
    for (const i of [0, 1, 2, 3, 4]) {
      expect(checkNeed(g, 'B', i, 'paint').pHit).toBe(0);
      expect(checkNeed(g, 'B', i, '3pt').pHit).toBe(0);
    }
  });

  it('Deity keeps its assists and rebounds rather than throw them at a 0% check', () => {
    expect(aiSpendDecision(game(), 'B', { iq: 1 })).toBeNull();
  });

  it('the lowest rung, misplaying, still never takes one', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);   // misplays() is true at any iq below 1
    expect(aiSpendDecision(game(), 'B', { iq: 0.2 })).toBeNull();
  });

  it('still spends on a check that can go in', () => {
    const d = aiSpendDecision(game({ makeable: true }), 'B', { iq: 1 });
    expect(d).not.toBeNull();
    expect(d.playerIdx).toBe(2);
  });
});
