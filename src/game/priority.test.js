// Priority in the card windows: a card hands the turn over, a pass hands it
// over and counts, two passes in a row close the window. The regression: the
// turn used to stay put after a card, so the AI chained its hand.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, handOverPriority, passTurn, cardWindow } from './engine.js';
import { execCard } from './execCard.js';
import { CARDS } from './cards.js';

function scoringGame() {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'A').starters = CARDS.slice(0, 5).map(c => ({ ...c, speed: 18, power: 18 }));
  getTeam(g, 'B').starters = CARDS.slice(10, 15).map(c => ({ ...c, speed: 10, power: 10 }));
  g.phase = 'scoring';
  g.scoringTurn = 'A';
  g.scoringPasses = 0;
  g.rollResults = { A: [], B: [] };
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  return g;
}

describe('cardWindow', () => {
  it('is the matchup phase once placement is done, and scoring until rolling opens', () => {
    const g = scoringGame();
    expect(cardWindow(g)?.key).toBe('scoringTurn');
    expect(cardWindow({ ...g, scoringPasses: 99 })).toBeNull();
    expect(cardWindow({ ...g, phase: 'matchup_strats' })?.key).toBe('matchupTurn');
    expect(cardWindow({ ...g, phase: 'matchup_strats', placementStep: 3 })).toBeNull();
    expect(cardWindow({ ...g, phase: 'draft' })).toBeNull();
  });
});

describe('handOverPriority', () => {
  it('gives the other side the turn and clears the pass count after a card', () => {
    const before = { ...scoringGame(), scoringPasses: 1 };
    const after = handOverPriority(before, before, 'A');
    expect(after.scoringTurn).toBe('B');
    expect(after.scoringPasses).toBe(0);
  });

  it('does the same in the matchup phase', () => {
    const before = { ...scoringGame(), phase: 'matchup_strats', matchupTurn: 'B', matchupPasses: 1 };
    const after = handOverPriority(before, before, 'B');
    expect(after.matchupTurn).toBe('A');
    expect(after.matchupPasses).toBe(0);
  });

  it('leaves the turn alone for a reaction during rolling, off-turn, or when the card moved the phase on', () => {
    const rolling = { ...scoringGame(), scoringPasses: 99 };
    expect(handOverPriority(rolling, rolling, 'A').scoringTurn).toBe('A');
    const offTurn = scoringGame();
    expect(handOverPriority(offTurn, offTurn, 'B').scoringTurn).toBe('A');
    const moved = scoringGame();
    expect(handOverPriority(moved, { ...moved, phase: 'draft' }, 'A').scoringTurn).toBe('A');
  });
});

describe('passTurn', () => {
  it('hands over on the first pass and closes the window on the second', () => {
    const g = scoringGame();
    const one = passTurn(g, 'A');
    expect(one.scoringTurn).toBe('B');
    expect(one.scoringPasses).toBe(1);
    const two = passTurn(one, 'B');
    expect(two.scoringPasses).toBe(99);
  });

  it('moves the matchup phase to scoring on two passes, with fresh roll results', () => {
    const g = { ...scoringGame(), phase: 'matchup_strats', matchupTurn: 'A', matchupPasses: 0 };
    const two = passTurn(passTurn(g, 'A'), 'B');
    expect(two.phase).toBe('scoring');
    expect(two.rollResults).toEqual({ A: [], B: [] });
  });
});

describe('the cadence, end to end', () => {
  it('a pass, then a card by the other side, gives the passer the turn back', () => {
    // A passes; B plays This Is My House (B's guards out-speed and out-power
    // nobody here, so give B the strong side for this one).
    const g = scoringGame();
    getTeam(g, 'A').starters = CARDS.slice(0, 5).map(c => ({ ...c, speed: 10, power: 10 }));
    getTeam(g, 'B').starters = CARDS.slice(10, 15).map(c => ({ ...c, speed: 18, power: 18 }));
    const afterPass = passTurn(g, 'A');
    expect(afterPass.scoringTurn).toBe('B');
    const res = execCard(afterPass, 'B', 'this_is_my_house', { offSlot: 0 });
    expect(res.ok).toBe(true);
    expect(res.game.scoringTurn).toBe('A');
    expect(res.game.scoringPasses).toBe(0);
  });
});
