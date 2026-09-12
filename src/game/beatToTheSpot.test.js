// BEAT HIM TO THE SPOT (2026-09-12) — the Speed twin of Offensive Foul, and
// the slot-key fix that came with it. Power buys rebounds and Speed buys
// assists, so each card halves its own boost and docks its own currency.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { canPlayCard } from './canPlay.js';
import { execCard } from './execCard.js';

const mk = (id, speed = 10, power = 10) => ({
  id, name: id, team: 'TST', pos: 'PG', speed, power, defBoost: 0, salary: 500,
  shotLine: 14, paintBoost: 1, threePtBoost: 1,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
});
const five = pre => Array.from({ length: 5 }, (_, i) => mk(`${pre}${i}`));
const filler = (pre, n) => Array.from({ length: n }, (_, i) => mk(`${pre}f${i}`));

/** B to play, holding `hand`; A is the opponent whose boosts are in play. */
function scoring({ bHand = [], aEff = {} } = {}) {
  const A = five('a'), B = five('b');
  const g = newGame([...A, ...filler('a', 5)], [...B, ...filler('b', 5)]);
  getTeam(g, 'A').starters = A;
  getTeam(g, 'B').starters = B;
  getTeam(g, 'B').hand = bHand;
  g.phase = 'scoring'; g.scoringTurn = 'B'; g.scoringPasses = 0; g.placementStep = 10;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.tempEff = { A: aEff, B: {} };
  g.rollResults = { A: [], B: [] };
  return g;
}

describe('Beat Him to the Spot', () => {
  it('waits for a Speed boost to punish', () => {
    const none = scoring({ bHand: ['beat_to_the_spot'] });
    expect(canPlayCard(none, 'B', 'beat_to_the_spot').canPlay).toBe(false);
    expect(canPlayCard(none, 'B', 'beat_to_the_spot').reason).toMatch(/boosts Speed/);

    const boosted = scoring({ bHand: ['beat_to_the_spot'], aEff: { s2: 5 } });
    expect(canPlayCard(boosted, 'B', 'beat_to_the_spot').canPlay).toBe(true);
  });

  it('is never played off your own burst', () => {
    // The boost is B's, and B holds the card: nothing to answer.
    const mine = scoring({ bHand: ['beat_to_the_spot'] });
    mine.tempEff.B = { s1: 4 };
    expect(canPlayCard(mine, 'B', 'beat_to_the_spot').canPlay).toBe(false);
  });

  it('halves every Speed boost and takes an assist', () => {
    const g = scoring({ bHand: ['beat_to_the_spot'], aEff: { s0: 5, s3: 2, p0: 6 } });
    getTeam(g, 'A').assists = 3;
    const r = execCard(g, 'B', 'beat_to_the_spot', {});
    expect(r.ok).toBe(true);
    expect(r.game.tempEff.A.s0).toBe(2);          // 5 halved, rounded down
    expect(r.game.tempEff.A.s3).toBe(1);
    expect(r.game.tempEff.A.p0).toBe(6);          // Power is Offensive Foul's business
    expect(getTeam(r.game, 'A').assists).toBe(2);
  });

  it('never takes an assist below zero', () => {
    const g = scoring({ bHand: ['beat_to_the_spot'], aEff: { s0: 3 } });
    getTeam(g, 'A').assists = 0;
    expect(getTeam(execCard(g, 'B', 'beat_to_the_spot', {}).game, 'A').assists).toBe(0);
  });
});

describe('Offensive Foul reads slot keys only', () => {
  it('is not triggered by the facilitator\'s assist counter', () => {
    // `paintAst0` (Short-Roll Playmaker) starts with a p and is not a Power
    // boost; startsWith('p') used to make it playable, and halve the counter.
    const g = scoring({ bHand: ['offensive_foul'], aEff: { paintAst0: 2 } });
    expect(canPlayCard(g, 'B', 'offensive_foul').canPlay).toBe(false);
    const real = scoring({ bHand: ['offensive_foul'], aEff: { p1: 4, paintAst0: 2 } });
    const r = execCard(real, 'B', 'offensive_foul', {});
    expect(r.game.tempEff.A.p1).toBe(2);
    expect(r.game.tempEff.A.paintAst0).toBe(2);   // untouched
  });
});
