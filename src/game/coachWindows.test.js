// TWO THINGS THE COACH GOT WRONG IN A LIVE GAME (the user, 2026-09-12).
//
//   "the AI is not playing obvious cards like Putback Dunk when available"
//     — not hoarding: measured over 150 simulated games it played the card in
//     36 of the 37 games it was ever legal in. The hole was WHEN it was asked.
//     Every card window in PlayTab hung off "does the coach still need to
//     roll", so once its five were in, its hand went dead for the rest of the
//     section while the human's stayed live — and a rebound lead, which is
//     what Putback Dunk wants, is likeliest AFTER the rolls, not before.
//     coachCardWindow is that rule, now in the engine where it can be read.
//
//   "AI also seems to play Switch Everything in a way that gives me massive
//     advantages" — it asked only whether anybody MOVED, never whether the
//     move beat the doubling the card pays for, and it applied the assignment
//     that would be best if the card were free. One play in six was a net
//     loss; the worst handed over 8.1 of weighted roll bonus.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, coachCardWindow, rollGate, calcAdv } from './engine.js';
import { canPlayCard } from './canPlay.js';
import { aiScoringDecision, aiBuildCardOpts, switchEverythingValue, aiSetMatchups } from './ai.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 10, power: 10,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
const roster = (p, over = {}) => Array.from({ length: 10 }, (_, i) => mk(`${p}${i}`, over));

function board({ a = roster('a'), b = roster('b'), bHand = [] } = {}) {
  const g = newGame(a, b);
  getTeam(g, 'A').starters = a.slice(0, 5);
  getTeam(g, 'B').starters = b.slice(0, 5);
  getTeam(g, 'B').hand = bHand;
  g.phase = 'scoring';
  g.scoringTurn = 'B'; g.scoringPasses = 99; g.placementStep = 10;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.rollResults = { A: [], B: [] };
  return g;
}
const allRolled = (g, key) => {
  g.rollResults[key] = [0, 1, 2, 3, 4].map(() => ({ die: 10, pts: 2, reb: 1, ast: 0 }));
  return g;
};

describe('the coach keeps a card window after its last roll', () => {
  it('is open while the alternation says it may roll', () => {
    const g = board();
    expect(rollGate(g).B).toBe(false);      // the human leads on equal counts
    expect(coachCardWindow(g, 'B')).toBe(false);
    allRolled(g, 'A');
    expect(rollGate(g).B).toBe(true);
    expect(coachCardWindow(g, 'B')).toBe(true);
  });

  it('is open once its five are in, whatever the human has left', () => {
    const g = allRolled(board(), 'B');
    expect(rollGate(g).B).toBe(false);      // nothing left to roll, so no die
    expect(coachCardWindow(g, 'B')).toBe(true);   // but the hand is still live
    // Both sides done is still the window: the section has not ended.
    expect(coachCardWindow(allRolled(g, 'A'), 'B')).toBe(true);
  });

  it('is shut outside the scoring phase', () => {
    const g = allRolled(board(), 'B');
    g.phase = 'matchup_strats';
    expect(coachCardWindow(g, 'B')).toBe(false);
  });

  it('is the window Putback Dunk needs — its condition ripens on the rolls', () => {
    const b = roster('b'); b[0] = mk('b0', { power: 16 });
    const g = board({ b, bHand: ['putback_dunk'] });
    // Before the dice, nobody leads the glass and the card is dead.
    expect(canPlayCard(g, 'B', 'putback_dunk').canPlay).toBe(false);
    // The rolls are what hand it a rebound lead.
    g.teamB.rebounds = 4; g.teamA.rebounds = 1;
    allRolled(g, 'B');
    expect(canPlayCard(g, 'B', 'putback_dunk').canPlay).toBe(true);
    expect(coachCardWindow(g, 'B')).toBe(true);
    expect(aiScoringDecision(g, 'B').cardId).toBe('putback_dunk');
  });
});

describe('Switch Everything is priced against its own doubling', () => {
  /** A's stars hold advantages B cannot answer; the switch only doubles them. */
  const lopsided = () => {
    const a = roster('a');
    a[0] = mk('a0', { speed: 20, power: 20, salary: 900 });
    a[1] = mk('a1', { speed: 18, power: 18, salary: 900 });
    const b = roster('b', { speed: 6, power: 6 });
    return board({ a, b, bHand: ['switch_everything'] });
  };

  it('refuses the card when the doubling costs more than the switch gains', () => {
    const g = lopsided();
    const { gain } = switchEverythingValue(g, 'B');
    expect(gain).toBeLessThan(0);
    // And so the coach does not reach for it.
    expect(aiScoringDecision(g, 'B').type).toBe('pass');
  });

  it('still plays it when the reassignment beats the price', () => {
    // The coach holds its own everywhere — so the doubling costs it almost
    // nothing — except one star its stopper is not on. Putting him right is
    // worth more than the price, and that is the case the card is FOR.
    const a = roster('a');
    a[0] = mk('a0', { speed: 20, power: 20, salary: 900 });
    const b = roster('b', { speed: 12, power: 12 });
    b[3] = mk('b3', { speed: 20, power: 20 });
    const g = board({ a, b, bHand: ['switch_everything'] });
    g.offMatchups.A = [0, 1, 2, 3, 4];              // the stopper is on nobody
    const { gain, matchups } = switchEverythingValue(g, 'B');
    expect(gain).toBeGreaterThan(0);
    expect(matchups[0]).toBe(3);                     // b3 takes the star
    const d = aiScoringDecision(g, 'B');
    expect(d.cardId).toBe('switch_everything');
    expect(d.opts.assignments).toEqual(matchups);
  });

  it('builds the assignment that is best UNDER the doubling', () => {
    const a = roster('a');
    a[0] = mk('a0', { speed: 20, power: 6, salary: 900 });
    a[1] = mk('a1', { speed: 6, power: 20, salary: 900 });
    const b = roster('b', { speed: 4, power: 4 });
    b[2] = mk('b2', { speed: 19, power: 4 });
    b[4] = mk('b4', { speed: 4, power: 19 });
    const g = board({ a, b, bHand: ['switch_everything'] });
    const { matchups } = switchEverythingValue(g, 'B');
    const built = aiBuildCardOpts(g, 'B', 'switch_everything').assignments;
    expect(built).toEqual(matchups);
    // The doubling never makes a WORSE board look better than the plain
    // optimum would: whatever it picks, it concedes no more than the
    // free-card optimum does once the price is counted in.
    const cost = perm => perm.reduce((t, d, i) => {
      const att = g.teamA.starters[i], def = g.teamB.starters[d];
      return t + calcAdv(att, def, { doubleAdv: true }, i).rollBonus;
    }, 0);
    expect(cost(built)).toBeLessThanOrEqual(cost(aiSetMatchups(g, 'B').matchups));
  });
});
