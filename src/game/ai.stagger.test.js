// Stagger Action names two different players, whatever the lineup order.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { CARDS } from './cards.js';
import { aiBuildCardOpts } from './ai.js';
import { execCard } from './execCard.js';

function game(starters) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'B').starters = starters;
  getTeam(g, 'B').hand = [{ id: 'stagger_action' }];
  g.phase = 'matchup_strats'; g.placementStep = 10; g.matchupTurn = 'B';
  return g;
}
const p = (name, speed, three = 0) => ({ ...CARDS[0], id: name, name, speed, threePtBoost: three });

describe('the AI stagger targets', () => {
  it('never picks the Speed-13 player as his own partner — the "Murray & Murray" case', () => {
    const g = game([p('Slow', 8), p('Murray', 15), p('Big', 9), p('Wing', 10), p('C', 7)]);
    const opts = aiBuildCardOpts(g, 'B', 'stagger_action');
    expect(opts.playerIdx).toBe(1);
    expect(opts.player2Idx).not.toBe(1);
  });

  it('still prefers a 3PT shooter as the partner when one is there', () => {
    const g = game([p('Slow', 8), p('Murray', 15), p('Shooter', 9, 2), p('Wing', 10), p('C', 7)]);
    expect(aiBuildCardOpts(g, 'B', 'stagger_action')).toEqual({ playerIdx: 1, player2Idx: 2 });
  });
});

describe('the engine refuses the same player twice', () => {
  it('fails Stagger Action with idx === idx2', () => {
    const g = game([p('Slow', 8), p('Murray', 15), p('Big', 9), p('Wing', 10), p('C', 7)]);
    const res = execCard(g, 'B', 'stagger_action', { playerIdx: 1, player2Idx: 1 });
    expect(res.ok).toBe(false);
    expect(res.msg).toMatch(/different players/);
  });
});
