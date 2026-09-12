// THE DIFFICULTY LADDER'S LEVERS (2026-09-12) — one dial, four judgements.
//
// The placement lever has its own test (placementFirst.test.js). These are the
// three added on top: WHICH CARD the coach plays, whether it ANSWERS an
// announced check, and what it does with its assists. Deity (iq 1) must be
// exactly the shipped brain — every simulator, the audit and the tutorial run
// there — so each test pins both ends of the dial.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, SPEND_COSTS } from './engine.js';
import { aiScoringDecision, aiReactionDecision, aiSpendDecision } from './ai.js';
// SPEND_COSTS lives with the engine's own spend rules.

const mk = (id, speed = 10, power = 10) => ({
  id, name: id, team: 'TST', pos: 'PG', speed, power, defBoost: 0, salary: 500,
  shotLine: 14, paintBoost: 1, threePtBoost: 1,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
});
const five = pre => Array.from({ length: 5 }, (_, i) => mk(`${pre}${i}`));
const filler = (pre, n) => Array.from({ length: n }, (_, i) => mk(`${pre}f${i}`));

function scoring(bHand = []) {
  const A = five('a'), B = five('b');
  const g = newGame([...A, ...filler('a', 5)], [...B, ...filler('b', 5)]);
  getTeam(g, 'A').starters = A;
  getTeam(g, 'B').starters = B;
  getTeam(g, 'B').hand = bHand;
  g.phase = 'scoring'; g.scoringTurn = 'B'; g.scoringPasses = 0; g.placementStep = 10;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.tempEff = { A: {}, B: {} };
  g.rollResults = { A: [], B: [] };
  return g;
}

/** What the coach played, over `n` hands of the same four cards. */
function tally(iq, hand, n = 200) {
  const seen = {};
  for (let i = 0; i < n; i += 1) {
    const d = aiScoringDecision(scoring(hand), 'B', { iq });
    const k = d.type === 'play_card' ? d.cardId : 'pass';
    seen[k] = (seen[k] ?? 0) + 1;
  }
  return seen;
}

describe('card judgement', () => {
  const hand = ['you_stand_over_there', 'pin_down_screen', 'green_light', 'from_way_downtown'];

  it('Deity plays the card it rates best; Settler plays any of them', () => {
    const deity = tally(1, hand);
    const best = Object.entries(deity).sort((a, b) => b[1] - a[1])[0];
    // The shipped brain, jitter and all: one card takes the clear majority.
    expect(best[0]).toBe('green_light');
    expect(best[1]).toBeGreaterThan(120);

    const settler = tally(0, hand);
    // Every card in the hand turns up, and none of them dominates.
    expect(Object.keys(settler).sort()).toEqual([...hand].sort());
    expect(Math.max(...Object.values(settler))).toBeLessThan(120);
  });

  it('still plays a legal card — a bad coach is not a stuck one', () => {
    for (let i = 0; i < 25; i += 1) {
      const d = aiScoringDecision(scoring(hand), 'B', { iq: 0 });
      expect(d.type).toBe('play_card');
      expect(hand).toContain(d.cardId);
    }
  });
});

describe('the answer to a check', () => {
  const lastCheck = { teamKey: 'A', playerIdx: 0, playerId: 'a0', type: '3pt', result: { hit: true, pts: 3, die: 9 }, pts: 3, cardLabel: 'x' };

  it('Deity challenges the make; Settler lets it stand', () => {
    const g = scoring(['coaches_challenge']);
    g.lastShotCheck = lastCheck;
    expect(aiReactionDecision(g, 'B', 'opp_scored', { iq: 1 })).toMatchObject({ type: 'play_card', cardId: 'coaches_challenge' });
    expect(aiReactionDecision(g, 'B', 'opp_scored')).toMatchObject({ type: 'play_card', cardId: 'coaches_challenge' });   // no opts = full IQ
    expect(aiReactionDecision(g, 'B', 'opp_scored', { iq: 0 })).toBeNull();
  });
});

describe('the currency', () => {
  it('Settler spends assists the moment it can, where Deity holds them for its cards', () => {
    const g = scoring(['cross_court_dime']);
    getTeam(g, 'B').assists = SPEND_COSTS.assistThree;
    // Cross-Court Dime's three assists are spoken for, so the considered
    // coach takes no check at all.
    expect(aiSpendDecision(g, 'B', { iq: 1 })).toBeNull();
    const spent = aiSpendDecision(g, 'B', { iq: 0 });
    expect(spent).toMatchObject({ type: 'spend_assist' });
  });
});
