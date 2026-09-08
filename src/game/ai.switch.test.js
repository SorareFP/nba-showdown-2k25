// The screen and its cancellers, judged in points.
//
// Before: High Screen & Roll was a flat 6 and, with no gaining swap, swapped
// slots 0 and 1 anyway; Go Under / Fight Over / Veer Switch fired at any
// switch at all. The AI cancelled switches that had cost it nothing and paid
// Go Under's free three to do it. These pin the new reading.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { execCard } from './execCard.js';
import { aiScoringDecision, aiBuildCardOpts, bestScreen, switchCancelValue, goUnderPrice, aiReactionDecision } from './ai.js';

const mk = (id, speed, power, { defBoost = 0, base = 5, slope = 0.3, threePtBoost = 1, shotLine = 14 } = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed, power, defBoost, salary: 500, shotLine, paintBoost: 1, threePtBoost,
  chart: Array.from({ length: 40 }, (_, i) => ({ lo: i + 1, hi: i + 1, pts: Math.max(0, base + slope * (i - 10)), reb: 0, ast: 0 })),
});
const filler = (pre, n) => Array.from({ length: n }, (_, i) => mk(`${pre}${i}`, 10, 10));

/** Matchup window open, everyone placed on identity rows, A to move. */
function board(A, B, { aHand = [], bHand = [] } = {}) {
  const g = newGame([...A, ...filler('af', 10 - A.length)], [...B, ...filler('bf', 10 - B.length)]);
  getTeam(g, 'A').starters = A.slice(0, 5);
  getTeam(g, 'B').starters = B.slice(0, 5);
  getTeam(g, 'A').hand = aHand;
  getTeam(g, 'B').hand = bHand;
  g.phase = 'matchup_strats'; g.placementStep = 10; g.matchupTurn = 'A'; g.matchupPasses = 0;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.tempEff = { A: {}, B: {} };
  return g;
}

describe('High Screen & Roll', () => {
  it('is not played when no swap gains anything', () => {
    const A = [mk('a0', 10, 10), mk('a1', 10, 10), mk('a2', 10, 10), mk('a3', 10, 10), mk('a4', 10, 10)];
    const B = [mk('b0', 10, 10), mk('b1', 10, 10), mk('b2', 10, 10), mk('b3', 10, 10), mk('b4', 10, 10)];
    const g = board(A, B, { aHand: ['high_screen_roll'] });
    expect(bestScreen(g, 'A').delta).toBeCloseTo(0, 6);
    expect(aiScoringDecision(g, 'A').type).toBe('pass');
  });

  it('is played for the swap that pays most in points, and names that pair', () => {
    // a0 (fast) is guarded by the fast b0, a1 (strong) by the strong b1: no
    // edge either row. Trade them and each attacks a mismatch.
    const A = [mk('a0', 16, 8, { base: 8, slope: 0.4 }), mk('a1', 8, 16, { base: 8, slope: 0.4 }), mk('a2', 10, 10), mk('a3', 10, 10), mk('a4', 10, 10)];
    const B = [mk('b0', 16, 8), mk('b1', 8, 16), mk('b2', 10, 10), mk('b3', 10, 10), mk('b4', 10, 10)];
    const g = board(A, B, { aHand: ['high_screen_roll', 'extra_pass'] });
    const sc = bestScreen(g, 'A');
    expect([sc.i, sc.j]).toEqual([0, 1]);
    expect(sc.delta).toBeGreaterThan(2);
    const d = aiScoringDecision(g, 'A');
    expect(d.type).toBe('play_card');
    expect(d.cardId).toBe('high_screen_roll');
    expect(d.opts).toEqual({ swapSlot1: 0, swapSlot2: 1 });
    expect(aiBuildCardOpts(g, 'A', 'high_screen_roll')).toEqual({ swapSlot1: 0, swapSlot2: 1 });
  });
});

describe('the cancellers', () => {
  function afterScreen({ gaining }) {
    const A = gaining
      ? [mk('a0', 16, 8, { base: 8, slope: 0.4 }), mk('a1', 8, 16, { base: 8, slope: 0.4 }), mk('a2', 10, 10), mk('a3', 10, 10), mk('a4', 10, 10)]
      : [mk('a0', 10, 10), mk('a1', 10, 10), mk('a2', 10, 10), mk('a3', 10, 10), mk('a4', 10, 10)];
    const B = gaining
      ? [mk('b0', 16, 8), mk('b1', 8, 16), mk('b2', 10, 10), mk('b3', 10, 10), mk('b4', 10, 10)]
      : [mk('b0', 10, 10), mk('b1', 10, 10), mk('b2', 10, 10), mk('b3', 10, 10), mk('b4', 10, 10)];
    const g = board(A, B, { aHand: ['high_screen_roll'], bHand: ['go_under', 'fight_over', 'veer_switch', 'extra_pass'] });
    const r = execCard(g, 'A', 'high_screen_roll', { swapSlot1: 0, swapSlot2: 1 });
    expect(r.ok).toBe(true);
    return r.game;
  }

  it('let a switch that gained nothing stand', () => {
    const g = afterScreen({ gaining: false });
    for (const id of ['go_under', 'fight_over', 'veer_switch']) {
      expect(switchCancelValue(g, 'B', id).gain).toBeCloseTo(0, 6);
    }
    const d = aiScoringDecision(g, 'B');
    expect(['pass', 'play_card']).toContain(d.type);
    if (d.type === 'play_card') expect(['go_under', 'fight_over', 'veer_switch']).not.toContain(d.cardId);
    expect(aiReactionDecision(g, 'B', 'screen_card')).toBeNull();
  });

  it('cancel a switch that hurt, with the canceller that takes back the most', () => {
    const g = afterScreen({ gaining: true });
    const v = Object.fromEntries(['go_under', 'fight_over', 'veer_switch'].map(id => [id, switchCancelValue(g, 'B', id)]));
    expect(v.go_under.gain).toBeGreaterThan(2);
    // Veer keeps the placed pairings at no price; Fight Over pays +2 to the
    // faster attacker; Go Under pays a three-point check.
    expect(v.veer_switch.saved).toBeGreaterThanOrEqual(v.fight_over.saved);
    expect(v.veer_switch.saved).toBeGreaterThanOrEqual(v.go_under.saved);
    const d = aiScoringDecision(g, 'B');
    expect(d.type).toBe('play_card');
    expect(['go_under', 'fight_over', 'veer_switch']).toContain(d.cardId);
    expect(aiReactionDecision(g, 'B', 'screen_card').cardId).toBe('veer_switch');
    // Veer's option: the placed pairing (keep) holds them lower than the trade.
    expect(aiBuildCardOpts(g, 'B', 'veer_switch')).toEqual({ veerSwap: false });
  });

  it('give Go Under\'s check to the worse shooter', () => {
    const g = afterScreen({ gaining: true });
    // a1 is the worse three-point shooter by a mile.
    getTeam(g, 'A').starters[1].threePtBoost = -3;
    getTeam(g, 'A').starters[1].shotLine = 19;
    expect(aiBuildCardOpts(g, 'B', 'go_under')).toEqual({ goUnderTarget: 1 });
    const price = goUnderPrice(g, 'A', [0, 1], [getTeam(g, 'B').starters[0], getTeam(g, 'B').starters[1]]);
    expect(price.slot).toBe(1);
    expect(price.pts).toBeLessThan(1);
  });

  it('always fire in demo mode, for the tutorial', () => {
    const g = afterScreen({ gaining: false });
    const d = aiScoringDecision(g, 'B', { demo: true });
    expect(d.type).toBe('play_card');
    expect(['go_under', 'fight_over', 'veer_switch']).toContain(d.cardId);
  });
});
