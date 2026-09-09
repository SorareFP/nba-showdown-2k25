// Ice the Hot Hand and Reset name a player. The board used to send no
// choice and the engine defaulted Ice to slot 0 (the user, 2026-09-09: "Ice
// the Hot Hand was auto-settling on one player and did not allow me to
// choose. Same with Reset."). Now a missing choice is a refusal.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, getPS } from './engine.js';
import { execCard } from './execCard.js';
import { CARDS } from './cards.js';

function timeoutBoard() {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20));
  getTeam(g, 'A').starters = getTeam(g, 'A').roster.slice(0, 5);
  getTeam(g, 'B').starters = getTeam(g, 'B').roster.slice(0, 5);
  getTeam(g, 'A').hand = ['ice_the_hot_hand', 'reset', 'fresh_legs'];
  g.phase = 'scoring'; g.tempEff = { A: {}, B: {} }; g.timeoutActive = 'A';
  g.crunch = { active: true, extra: {}, timeoutUsed: { A: true } };
  const b2 = getTeam(g, 'B').starters[2]; getPS(g, 'B', b2.id).hot = 2;
  const a1 = getTeam(g, 'A').starters[1]; getPS(g, 'A', a1.id).cold = 1;
  for (const [i, min] of [[0, 8], [3, 12]]) getPS(g, 'A', getTeam(g, 'A').starters[i].id).minutes = min;
  return g;
}

describe('the timeout riders name a player', () => {
  it('Ice the Hot Hand refuses without a target and ices the named one', () => {
    const g = timeoutBoard();
    const none = execCard(g, 'A', 'ice_the_hot_hand', {});
    expect(none.ok).toBe(false);
    expect(none.msg).toMatch(/Choose an opposing player/);
    const b0 = getTeam(g, 'B').starters[0];
    expect(execCard(g, 'A', 'ice_the_hot_hand', { targetIdx: 0 }).ok).toBe(false);   // slot 0 holds none
    expect(getPS(g, 'B', b0.id).hot || 0).toBe(0);
    const r = execCard(g, 'A', 'ice_the_hot_hand', { targetIdx: 2 });
    expect(r.ok).toBe(true);
    expect(getPS(r.game, 'B', getTeam(g, 'B').starters[2].id).hot).toBe(0);
  });

  it('Reset refuses without a player and clears the named one', () => {
    const g = timeoutBoard();
    const none = execCard(g, 'A', 'reset', {});
    expect(none.ok).toBe(false);
    expect(none.msg).toMatch(/Choose one of your players/);
    expect(execCard(g, 'A', 'reset', { playerIdx: 0 }).ok).toBe(false);              // no cold markers there
    const r = execCard(g, 'A', 'reset', { playerIdx: 1 });
    expect(r.ok).toBe(true);
    expect(getPS(r.game, 'A', getTeam(g, 'A').starters[1].id).cold).toBe(0);
  });

  it('Fresh Legs refuses without a choice, rests one, or rests two', () => {
    const g = timeoutBoard();
    const none = execCard(g, 'A', 'fresh_legs', {});
    expect(none.ok).toBe(false);
    expect(none.msg).toMatch(/Choose up to two players/);
    const a = getTeam(g, 'A').starters;
    const one = execCard(g, 'A', 'fresh_legs', { playerIdx: 3 });
    expect(one.ok).toBe(true);
    expect(getPS(one.game, 'A', a[3].id).minutes).toBe(8);
    expect(getPS(one.game, 'A', a[0].id).minutes).toBe(8);                        // untouched
    const two = execCard(g, 'A', 'fresh_legs', { playerIdx: 3, player2Idx: 0 });
    expect(two.ok).toBe(true);
    expect(getPS(two.game, 'A', a[3].id).minutes).toBe(8);
    expect(getPS(two.game, 'A', a[0].id).minutes).toBe(4);
  });
});
