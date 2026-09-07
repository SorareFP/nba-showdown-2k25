// And One reads Speed OR Power, whichever is larger — never their sum.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { CARDS } from './cards.js';
import { execCard } from './execCard.js';

const p = (name, speed, power) => ({ ...CARDS[0], id: name, name, speed, power, defBoost: 0, salary: 800 });

function game() {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  // Daniels-vs-Edwards shape: Speed +2, Power +4 for the attacker in slot 0.
  getTeam(g, 'A').starters = [p('Daniels', 14, 11), p('a1', 10, 10), p('a2', 10, 10), p('a3', 10, 10), p('a4', 10, 10)];
  getTeam(g, 'B').starters = [p('Edwards', 12, 7), p('b1', 10, 10), p('b2', 10, 10), p('b3', 10, 10), p('b4', 10, 10)];
  getTeam(g, 'A').hand = ['and_one'];
  g.phase = 'scoring'; g.scoringTurn = 'A';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.rollResults = { A: [], B: [] };
  return g;
}

describe('And One', () => {
  it('scores on the larger single advantage, not the two added together', () => {
    const r = execCard(game(), 'A', 'and_one', { playerIdx: 0 });
    expect(r.ok).toBe(true);
    const line = r.game.log.find(e => e.msg.startsWith('And One'));
    // Speed +2 and Power +4: the advantage is 4 (Power), not 6.
    expect(line.msg).toContain('Power advantage +4');
    expect(line.msg).toContain('Speed +2, Power +4');
    // Under 5, so no free throw is attempted.
    expect(r.game.log.some(e => e.msg.startsWith('Free throw'))).toBe(false);
  });

  it('reaches 6 only when a boost actually lifts one stat that far', () => {
    const g = game();
    g.tempEff = { A: { p0: 2 } };   // Power Move on the attacker: Power 13 vs 7
    const r = execCard(g, 'A', 'and_one', { playerIdx: 0 });
    expect(r.ok).toBe(true);
    const line = r.game.log.find(e => e.msg.startsWith('And One'));
    expect(line.msg).toContain('Power advantage +6');
    expect(r.game.log.some(e => e.msg.startsWith('Free throw'))).toBe(true);
  });

  it('refuses below +3 on both stats', () => {
    const g = game();
    getTeam(g, 'A').starters[0] = p('Even', 12, 9);   // Speed 0, Power +2
    const r = execCard(g, 'A', 'and_one', { playerIdx: 0 });
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/has 2/);
  });
});
