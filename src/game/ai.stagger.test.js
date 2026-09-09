// Stagger Action names two different players, whatever the lineup order.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { CARDS } from './cards.js';
import { aiBuildCardOpts } from './ai.js';
import { execCard } from './execCard.js';
import { canPlayCard } from './canPlay.js';

function game(starters) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'B').starters = starters;
  getTeam(g, 'B').hand = [{ id: 'stagger_action' }];
  g.phase = 'matchup_strats'; g.placementStep = 10; g.matchupTurn = 'B';
  return g;
}
const p = (name, speed, three = 0) => ({ ...CARDS[0], id: name, name, speed, threePtBoost: three });

describe('the AI stagger targets', () => {
  it('with no positive shooter the card is not playable, and the coach names nobody twice', () => {
    // Brunson and Thompson: negative 3PT bonuses are NOT bonuses.
    const g = game([p('Slow', 8), p('Murray', 15), p('Brunson', 9, -1), p('Thompson', 10, -2), p('C', 7)]);
    expect(canPlayCard(g, 'B', 'stagger_action').canPlay).toBe(false);
    expect(execCard(g, 'B', 'stagger_action', { playerIdx: 1, player2Idx: 2 }).ok).toBe(false);
    expect(execCard(g, 'B', 'stagger_action', { playerIdx: 2, player2Idx: 1 }).ok).toBe(false);
    const opts = aiBuildCardOpts(g, 'B', 'stagger_action');
    expect(execCard(g, 'B', 'stagger_action', opts).ok).toBe(false);
  });

  it('pairs the Speed-13 player with a positive shooter, never with himself', () => {
    const g = game([p('Slow', 8), p('Murray', 15), p('Shooter', 9, 2), p('Wing', 10), p('C', 7)]);
    expect(canPlayCard(g, 'B', 'stagger_action').canPlay).toBe(true);
    expect(aiBuildCardOpts(g, 'B', 'stagger_action')).toEqual({ playerIdx: 1, player2Idx: 2 });
    expect(execCard(g, 'B', 'stagger_action', { playerIdx: 1, player2Idx: 2 }).ok).toBe(true);
    expect(execCard(g, 'B', 'stagger_action', { playerIdx: 2, player2Idx: 1 }).ok).toBe(true);   // either order
  });

  it('a fast shooter needs a DIFFERENT partner in each role', () => {
    // Murray is both fast and a shooter; the only other shooter is slow. Fine.
    const one = game([p('Slow', 8, 1), p('Murray', 15, 3), p('Big', 9), p('Wing', 10), p('C', 7)]);
    expect(aiBuildCardOpts(one, 'B', 'stagger_action')).toEqual({ playerIdx: 1, player2Idx: 0 });
    // Murray is the only shooter AND the only fast man: no pair.
    const none = game([p('Slow', 8), p('Murray', 15, 3), p('Big', 9), p('Wing', 10), p('C', 7)]);
    expect(canPlayCard(none, 'B', 'stagger_action').canPlay).toBe(false);
    expect(execCard(none, 'B', 'stagger_action', { playerIdx: 1, player2Idx: 1 }).ok).toBe(false);
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
