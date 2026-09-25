// TWO GATES ON THE DICE (the user, 2026-09-25):
//   "can you make it impossible to do a scoring roll before the strategy
//    phase is over? Currently you can still do it before passing."
//   "I think one person should have to roll before taking a timeout in
//    crunch time."
import { describe, it, expect } from 'vitest';
import { rollingOpen, passTurn, timeoutProblem, teamRolled, CRUNCH_MARGIN } from './engine.js';
import { tutorialReducer } from './tutorialFlow.js';
import { aiCrunchDecision } from './ai.js';
import { tutorialStart, openRolling } from './tutorialWalk.testkit.js';

/** A section at the scoring phase's strategy turn: lineups, snake and the matchup window done, nobody passed yet. */
function atStrategyTurn() {
  let g = openRolling(tutorialStart());
  g = { ...g, scoringPasses: 0, scoringTurn: 'A' };
  return g;
}

describe('the scoring roll', () => {
  it('waits for both passes of the strategy turn', () => {
    let g = atStrategyTurn();
    expect(rollingOpen(g)).toBe(false);
    g = passTurn(g, 'A');
    expect(rollingOpen(g)).toBe(false);                    // one pass is not enough
    g = passTurn(g, g.scoringTurn);
    expect(g.scoringPasses).toBe(99);
    expect(rollingOpen(g)).toBe(true);
    expect(rollingOpen({ ...g, phase: 'matchup_strats' })).toBe(false);
    // The simulators close the window at 2 rather than 99; that counts.
    expect(rollingOpen({ ...g, scoringPasses: 2 })).toBe(true);
  });

  it('is refused by the reducer before then — a click that got through changes nothing', () => {
    const g = atStrategyTurn();
    const after = tutorialReducer(g, { type: 'ROLL', teamKey: 'A', idx: 0 });
    expect(after).toBe(g);
    expect(after.rollResults.A[0]).toBeUndefined();
    const open = passTurn(passTurn(g, 'A'), 'B');
    expect(tutorialReducer(open, { type: 'ROLL', teamKey: 'A', idx: 0 }).rollResults.A[0]).toBeTruthy();
  });
});

describe('the crunch-time timeout', () => {
  function crunchRolling() {
    const g = passTurn(passTurn(atStrategyTurn(), 'A'), 'B');
    return { ...g, quarter: 4, section: 3, crunch: { active: true, margin: CRUNCH_MARGIN, used: {}, extra: {}, timeoutUsed: {} } };
  }

  it('opens for a side only once the OTHER side has rolled, the coach included', () => {
    const g = crunchRolling();
    expect(teamRolled(g, 'A') || teamRolled(g, 'B')).toBe(false);
    expect(timeoutProblem(g, 'A')).toMatch(/The other team has to roll/);
    expect(aiCrunchDecision(g, 'B')).toBeNull();
    // Your roll opens the coach's timeout, not yours.
    const rolled = tutorialReducer(g, { type: 'ROLL', teamKey: 'A', idx: 0 });
    expect(teamRolled(rolled, 'A')).toBe(true);
    expect(timeoutProblem(rolled, 'A')).toMatch(/The other team has to roll/);
    expect(timeoutProblem(rolled, 'B')).toBeNull();
    expect(aiCrunchDecision(rolled, 'B')).toEqual({ type: 'timeout' });
    // The coach's roll opens yours.
    const answered = tutorialReducer(rolled, { type: 'ROLL', teamKey: 'B', idx: 0 });
    expect(timeoutProblem(answered, 'A')).toBeNull();
  });
});
