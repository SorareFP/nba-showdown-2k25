// THREE CARDS FROM THE 2026-09-12 SURVEY.
//
//   Switch the Screen — the defence initiating a switch, so that Overhelp and
//     Burned on the Switch (both offensive answers to one) finally have
//     something other than a rare to answer.
//   First Step — the Speed twin of Power Move; the Speed side had no plain
//     common boost, which is why Beat Him to the Spot triggered half as often
//     as Offensive Foul in the audit.
//   Verticality — the answer to the cards that score with no roll and no shot
//     check, which nothing could touch before.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, burnedSlots } from './engine.js';
import { canPlayCard } from './canPlay.js';
import { execCard } from './execCard.js';

const mk = (id, speed = 10, power = 10, extra = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed, power, defBoost: 0, salary: 500,
  shotLine: 14, paintBoost: 1, threePtBoost: 1,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...extra,
});
const filler = (pre, n) => Array.from({ length: n }, (_, i) => mk(`${pre}f${i}`));

/** A is the offence to beat; B is on the clock with `bHand`. */
function board({ aStarters, bStarters, bHand = [], phase = 'scoring' } = {}) {
  const A = aStarters ?? Array.from({ length: 5 }, (_, i) => mk(`a${i}`));
  const B = bStarters ?? Array.from({ length: 5 }, (_, i) => mk(`b${i}`));
  const g = newGame([...A, ...filler('a', 5)], [...B, ...filler('b', 5)]);
  getTeam(g, 'A').starters = A;
  getTeam(g, 'B').starters = B;
  getTeam(g, 'B').hand = bHand;
  g.phase = phase; g.scoringTurn = 'B'; g.scoringPasses = 0; g.placementStep = 10;
  g.matchupTurn = 'B';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.tempEff = { A: {}, B: {} };
  g.rollResults = { A: [], B: [] };
  return g;
}

describe('Switch the Screen', () => {
  it('swaps two defenders and leaves a switch the offence can answer', () => {
    const g = board({ bHand: ['switch_the_screen'] });
    expect(canPlayCard(g, 'B', 'switch_the_screen').canPlay).toBe(true);
    const r = execCard(g, 'B', 'switch_the_screen', { slots: [0, 3] });
    expect(r.ok).toBe(true);
    // A's players 0 and 3 have exchanged defenders.
    expect(r.game.offMatchups.A[0]).toBe(3);
    expect(r.game.offMatchups.A[3]).toBe(0);
    // And it is on the record as a defensive switch, by this team.
    expect(r.game.lastDefSwitch).toMatchObject({ teamKey: 'B', cardId: 'switch_the_screen' });
  });

  it('revives the two offensive answers that had only a rare to answer', () => {
    const slow = [mk('a0', 18, 10), mk('a1', 8, 10), mk('a2'), mk('a3'), mk('a4')];
    const defs = [mk('b0', 17, 10), mk('b1', 6, 10), mk('b2'), mk('b3'), mk('b4')];
    const g = board({ aStarters: slow, bStarters: defs, bHand: ['switch_the_screen'] });
    const after = execCard(g, 'B', 'switch_the_screen', { slots: [0, 1] }).game;
    // a0 now has the slower defender: Burned on the Switch sees it, and
    // Overhelp answers any defensive switch at all.
    after.teamA.hand = ['burned_switch', 'overhelp'];
    expect(burnedSlots(after, after.lastDefSwitch).length).toBeGreaterThan(0);
    expect(canPlayCard(after, 'A', 'burned_switch').canPlay).toBe(true);
    expect(canPlayCard(after, 'A', 'overhelp').canPlay).toBe(true);
  });

  it('picks the two worst mismatches when no pair is named', () => {
    const stars = [mk('a0', 20, 20), mk('a1', 19, 19), mk('a2', 5, 5), mk('a3', 5, 5), mk('a4', 5, 5)];
    const g = board({ aStarters: stars, bHand: ['switch_the_screen'] });
    const r = execCard(g, 'B', 'switch_the_screen', {});
    expect(r.ok).toBe(true);
    // The two biggest gaps traded defenders; everyone else is untouched.
    expect(r.game.offMatchups.A[0]).toBe(1);
    expect(r.game.offMatchups.A[1]).toBe(0);
    expect(r.game.offMatchups.A.slice(2)).toEqual([2, 3, 4]);
  });
});

describe('First Step', () => {
  it('gives +2 Speed, and +3 once the advantage is already five', () => {
    const plain = board({ bHand: ['first_step'] });
    expect(canPlayCard(plain, 'B', 'first_step').canPlay).toBe(true);
    const small = execCard(plain, 'B', 'first_step', { playerIdx: 0 });
    expect(small.game.tempEff.B.s0).toBe(2);

    // b0 is six faster than the man he faces: the bigger step.
    const quick = board({ bStarters: [mk('b0', 16), mk('b1'), mk('b2'), mk('b3'), mk('b4')], bHand: ['first_step'] });
    const big = execCard(quick, 'B', 'first_step', { playerIdx: 0 });
    expect(big.game.tempEff.B.s0).toBe(3);
  });

  it('is what Beat Him to the Spot answers', () => {
    const g = board({ bHand: ['first_step'] });
    const boosted = execCard(g, 'B', 'first_step', { playerIdx: 0 }).game;
    boosted.teamA.hand = ['beat_to_the_spot'];
    expect(canPlayCard(boosted, 'A', 'beat_to_the_spot').canPlay).toBe(true);
    const answered = execCard(boosted, 'A', 'beat_to_the_spot', {}).game;
    expect(answered.tempEff.B.s0).toBe(1);
  });
});

describe('Verticality', () => {
  /** A scores a free two through `card`; B holds the answer. */
  const freeTwo = (card, aStarters, bStarters) => {
    const g = board({ aStarters, bStarters, bHand: ['verticality'] });
    g.teamA.hand = [card];
    g.scoringTurn = 'A';
    return g;
  };

  it('wipes an Uncontested Layup, score and player line together', () => {
    const quick = [mk('a0', 20, 20), mk('a1'), mk('a2'), mk('a3'), mk('a4')];
    const bigs = [mk('b0', 10, 16, { defBoost: 1 }), mk('b1'), mk('b2'), mk('b3'), mk('b4')];
    const g = freeTwo('uncontested_layup', quick, bigs);
    const scored = execCard(g, 'A', 'uncontested_layup', { playerIdx: 0 }).game;
    expect(scored.teamA.score).toBe(2);
    expect(scored.lastAutoScore).toMatchObject({ teamKey: 'A', playerIdx: 0, pts: 2 });

    expect(canPlayCard(scored, 'B', 'verticality').canPlay).toBe(true);
    const wiped = execCard(scored, 'B', 'verticality', {}).game;
    expect(wiped.teamA.score).toBe(0);
    expect(wiped.lastAutoScore).toBe(null);
  });

  it('needs a defender who can stand him up', () => {
    const quick = [mk('a0', 16, 18), mk('a1'), mk('a2'), mk('a3'), mk('a4')];
    const small = [mk('b0', 10, 8), mk('b1'), mk('b2'), mk('b3'), mk('b4')];
    const g = freeTwo('uncontested_layup', quick, small);
    const scored = execCard(g, 'A', 'uncontested_layup', { playerIdx: 0 }).game;
    const check = canPlayCard(scored, 'B', 'verticality');
    expect(check.canPlay).toBe(false);
    expect(check.reason).toMatch(/Defensive Bonus|Power/);
  });

  it('answers a Putback Dunk, and only once', () => {
    const bigs = [mk('a0', 10, 16), mk('a1'), mk('a2'), mk('a3'), mk('a4')];
    const wall = [mk('b0', 10, 16), mk('b1'), mk('b2'), mk('b3'), mk('b4')];
    const g = freeTwo('putback_dunk', bigs, wall);
    g.teamA.rebounds = 5;
    g.teamB.rebounds = 1;
    const scored = execCard(g, 'A', 'putback_dunk', { playerIdx: 0 }).game;
    expect(scored.teamA.score).toBe(2);
    const wiped = execCard(scored, 'B', 'verticality', {}).game;
    expect(wiped.teamA.score).toBe(0);
    // The hook is spent: a second copy has nothing to answer.
    expect(canPlayCard(wiped, 'B', 'verticality').canPlay).toBe(false);
  });

  it('is never played on your own free basket', () => {
    const bigs = [mk('a0', 10, 16), mk('a1'), mk('a2'), mk('a3'), mk('a4')];
    const g = freeTwo('putback_dunk', bigs, undefined);
    g.teamA.rebounds = 5;
    g.teamB.rebounds = 1;
    const scored = execCard(g, 'A', 'putback_dunk', { playerIdx: 0 }).game;
    scored.teamA.hand = ['verticality'];
    expect(canPlayCard(scored, 'A', 'verticality').canPlay).toBe(false);
  });
});
