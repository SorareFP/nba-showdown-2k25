// A CARD THAT SPENDS REBOUNDS NEEDS THE LEAD TO PAY FOR THEM (2026-09-24).
// The user: "For cards that use rebounds, the player using it should need to
// LEAD the rebounding battle by the cost it takes to play it. It shouldn't
// just give unearned rebounds to the other team."
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { canPlayCard, reboundLead, reboundLeadProblem, REBOUND_CARD_COST } from './canPlay.js';
import { execCard } from './execCard.js';
import { getStrat } from './strats.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PF', speed: 10, power: 10, defBoost: 0, salary: 500,
  shotLine: 14, paintBoost: 1, threePtBoost: 1,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
const five = pre => Array.from({ length: 5 }, (_, i) => mk(`${pre}${i}`));
function scoring({ mine, theirs, assists = 0, hand }) {
  const g = newGame([...five('a'), ...five('af')], [...five('b'), ...five('bf')]);
  getTeam(g, 'A').starters = five('a');
  getTeam(g, 'B').starters = five('b');
  getTeam(g, 'A').hand = hand;
  getTeam(g, 'B').hand = [];
  getTeam(g, 'A').rebounds = mine;
  getTeam(g, 'B').rebounds = theirs;
  getTeam(g, 'A').assists = assists;
  g.phase = 'scoring'; g.scoringTurn = 'A'; g.scoringPasses = 0; g.placementStep = 10;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.tempEff = { A: {}, B: {} };
  g.rollResults = { A: [], B: [] };
  return g;
}

describe('the rebound lead a card needs', () => {
  it('names every card that spends rebounds, and nothing else', () => {
    for (const id of Object.keys(REBOUND_CARD_COST)) expect(getStrat(id), id).toBeTruthy();
    expect(REBOUND_CARD_COST.grab_and_go).toBe(3);
    expect(reboundLeadProblem(scoring({ mine: 0, theirs: 9, hand: [] }), 'A', 'glass_cleaner')).toBeNull();
  });

  it('refuses a spend the bank covers but the lead does not — on the board and in the engine', () => {
    // Nine banked, but they have seven: a lead of two cannot pay three.
    const g = scoring({ mine: 9, theirs: 7, hand: ['grab_and_go'] });
    expect(reboundLead(g, 'A')).toBe(2);
    const verdict = canPlayCard(g, 'A', 'grab_and_go');
    expect(verdict.canPlay).toBe(false);
    expect(verdict.reason).toMatch(/Lead the rebound battle by 3/);
    const refused = execCard(g, 'A', 'grab_and_go', {});
    expect(refused.ok).toBe(false);
    expect(getTeam(refused.game, 'A').rebounds).toBe(9);
  });

  it('allows it at a lead of exactly the cost, leaving the teams level at worst', () => {
    const g = scoring({ mine: 10, theirs: 7, hand: ['grab_and_go'] });
    expect(canPlayCard(g, 'A', 'grab_and_go').canPlay).toBe(true);
    const r = execCard(g, 'A', 'grab_and_go', {});
    expect(r.ok).toBe(true);
    expect(reboundLead(r.game, 'A')).toBe(0);
  });

  it('says a wrong phase first, the lead only once the card could otherwise be played', () => {
    const g = scoring({ mine: 1, theirs: 5, hand: ['grab_and_go'] });
    g.phase = 'matchup_strats';
    expect(canPlayCard(g, 'A', 'grab_and_go').reason).not.toMatch(/rebound battle/);
  });

  it('holds for the cards that spend assists too (Crash and Kick: 3 REB and 1 AST)', () => {
    expect(canPlayCard(scoring({ mine: 5, theirs: 3, assists: 1, hand: ['crash_and_kick'] }), 'A', 'crash_and_kick').canPlay).toBe(false);
    expect(canPlayCard(scoring({ mine: 6, theirs: 3, assists: 1, hand: ['crash_and_kick'] }), 'A', 'crash_and_kick').canPlay).toBe(true);
  });
});
