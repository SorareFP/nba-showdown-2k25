// Two 2026-09-09 play-test rules:
//   - the AI's Coach's Challenge answers a MAKE, never a miss (a re-roll of a
//     miss can only turn it into a make — it did, for three)
//   - Double Team is once per section
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { execCard } from './execCard.js';
import { canPlayCard } from './canPlay.js';
import { aiScoringDecision, aiReactionDecision } from './ai.js';
import { getStrat } from './strats.js';

const mk = (id, speed = 10, power = 10) => ({
  id, name: id, team: 'TST', pos: 'PG', speed, power, defBoost: 0, salary: 500,
  shotLine: 14, paintBoost: 1, threePtBoost: 1,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
});
const five = pre => Array.from({ length: 5 }, (_, i) => mk(`${pre}${i}`));
const filler = (pre, n) => Array.from({ length: n }, (_, i) => mk(`${pre}f${i}`));

function scoring({ bHand = [] } = {}) {
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

describe("the AI's Coach's Challenge", () => {
  const lastCheck = hit => ({ teamKey: 'A', playerIdx: 0, playerId: 'a0', type: '3pt', result: { hit, pts: hit ? 3 : 0, die: 9 }, pts: hit ? 3 : 0, cardLabel: 'x' });

  it('is never spent on a miss', () => {
    const g = scoring({ bHand: ['coaches_challenge'] });
    g.lastShotCheck = lastCheck(false);
    expect(canPlayCard(g, 'B', 'coaches_challenge').canPlay).toBe(true);   // the rule allows it; the coach declines
    expect(aiScoringDecision(g, 'B').type).toBe('pass');
    expect(aiReactionDecision(g, 'B', 'opp_scored')).toBeNull();
  });

  it('is spent on a make', () => {
    const g = scoring({ bHand: ['coaches_challenge'] });
    g.lastShotCheck = lastCheck(true);
    const d = aiScoringDecision(g, 'B');
    expect(d).toMatchObject({ type: 'play_card', cardId: 'coaches_challenge' });
    expect(aiReactionDecision(g, 'B', 'opp_scored')).toMatchObject({ type: 'play_card', cardId: 'coaches_challenge' });
  });

  it('never challenges its own check', () => {
    const g = scoring({ bHand: ['coaches_challenge'] });
    g.lastShotCheck = { ...lastCheck(true), teamKey: 'B' };
    expect(aiScoringDecision(g, 'B').type).toBe('pass');
  });
});

describe('Double Team', () => {
  it('is once per section, and the card says so', () => {
    expect(getStrat('double_team').desc).toMatch(/Once per section/);
    const g = scoring({ bHand: ['double_team', 'double_team'] });
    expect(canPlayCard(g, 'B', 'double_team').canPlay).toBe(true);
    const r = execCard(g, 'B', 'double_team', { targetIdx: 0, playerIdx: 0 });
    expect(r.ok).toBe(true);
    expect(r.game.tempEff.B.doubleTeamUsed).toBe(true);
    const again = canPlayCard(r.game, 'B', 'double_team');
    expect(again.canPlay).toBe(false);
    expect(again.reason ?? again.msg ?? '').toMatch(/once per section/i);
    expect(execCard(r.game, 'B', 'double_team', { targetIdx: 1, playerIdx: 1 }).ok).toBe(false);
  });
});
