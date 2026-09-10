// The coach places against what it can SEE. The user (2026-09-10): "When
// doing the matchup calculations, does the CPU already know my five players?
// They technically should not." The lineup pick is secret; during the snake a
// coach knows the players already on the floor and the opponent's roster, not
// which five were picked. So its placement must not change with the
// opponent's hidden picks.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { CARDS } from './cards.js';
import { placementChoices, aiDraftPick } from './ai.js';
import { placePlayer } from './placement.js';

/** Placement about to start, A's secret five given, B's fixed. */
function atPlacement(aPicks, first = 'B') {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(20, 30), null, null, { placementFirst: first });
  g.draft = { ...(g.draft ?? {}), aPicks: aPicks.map(i => g.teamA.roster[i].id), bPicks: g.teamB.roster.slice(0, 5).map(p => p.id) };
  g.teamA.starters = [];
  g.teamB.starters = [];
  g.placementStep = 0;
  g.phase = 'matchup_strats';
  return g;
}
const choice = g => placementChoices(g, 'B').map(c => [c.player.id, Number(c.value.toFixed(6))]);

describe('the coach does not see your secret five', () => {
  it('leads the snake the same way whichever five you picked', () => {
    expect(choice(atPlacement([0, 1, 2, 3, 4]))).toEqual(choice(atPlacement([5, 6, 7, 8, 9])));
    expect(choice(atPlacement([0, 2, 4, 6, 8]))).toEqual(choice(atPlacement([1, 3, 5, 7, 9])));
  });

  it('answers what you have PLACED, and nothing you have not', () => {
    // A leads with the same player in both games; the rest of A's five differ.
    let g1 = atPlacement([0, 1, 2, 3, 4], 'A');
    let g2 = atPlacement([0, 5, 6, 7, 8], 'A');
    g1 = placePlayer(g1, g1.teamA.roster[0].id);
    g2 = placePlayer(g2, g2.teamA.roster[0].id);
    expect(choice(g1)).toEqual(choice(g2));
  });

  it('still reads its own picks, which it does know', () => {
    const g = atPlacement([0, 1, 2, 3, 4]);
    const own = new Set(g.draft.bPicks);
    expect(placementChoices(g, 'B').every(c => own.has(c.player.id))).toBe(true);
  });

  it('picks its own lineup without looking at yours', () => {
    const g = newGame(CARDS.slice(0, 10), CARDS.slice(20, 30), null, null, {});
    g.draft = { aPool: [...g.teamA.roster], bPool: [...g.teamB.roster], aPicks: [], bPicks: [] };
    const before = aiDraftPick(g, 'B').playerId;
    g.draft.aPicks = g.teamA.roster.slice(0, 5).map(p => p.id);
    getTeam(g, 'A').starters = g.teamA.roster.slice(0, 5);
    expect(aiDraftPick(g, 'B').playerId).toBe(before);
  });
});
