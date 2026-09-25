// THE PICKER NAMES EACH PLAYER'S MATCHUP (2026-09-25). The user: "When
// playing a card that makes you choose a player for something, it should
// probably show who their current matchup is, and what their roll boost is
// currently."
import { describe, it, expect, vi } from 'vitest';
import { newGame, matchupAdv } from '../../game/engine.js';

vi.mock('../../ui/dialogs.jsx', () => ({ useDialogs: () => ({ toast: () => {}, ask: async () => false }) }));
const { pickerMatchup } = await import('./CourtBoard.jsx');

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'F', speed: 10, power: 10, defBoost: 0,
  shotLine: 14, paintBoost: 0, threePtBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }], ...over,
});
function game() {
  const g = newGame(Array.from({ length: 10 }, (_, i) => mk(`a${i}`, i === 0 ? { speed: 16 } : {})),
    Array.from({ length: 10 }, (_, i) => mk(`b${i}`)));
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.phase = 'scoring';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  return g;
}

describe('the picker matchup line', () => {
  it('names the man guarding him and the roll bonus the court tile shows', () => {
    const g = game();
    const mu = pickerMatchup(g, 'A', 'a0');
    expect(mu.vs.id).toBe('b0');
    expect(mu.adv).toEqual(matchupAdv(g, 'A', 0));
    expect(mu.adv.rollBonus).toBeGreaterThan(0);          // Speed 16 on Speed 10
    expect(mu.guards).toBeNull();                          // the pair is mutual
  });

  it('says whom he guards when a switch has split the pair', () => {
    const g = game();
    g.offMatchups.B = [2, 1, 0, 3, 4];                     // A's 2 now guards B's 0
    expect(pickerMatchup(g, 'A', 'a0').guards.id).toBe('b2');
    expect(pickerMatchup(g, 'A', 'a2').guards.id).toBe('b0');
  });

  it('works for the other side\'s players too (a defensive card picks one of theirs)', () => {
    expect(pickerMatchup(game(), 'B', 'b0').vs.id).toBe('a0');
  });

  it('is pending while the placement snake has not put his man on the floor', () => {
    const g = game();
    g.phase = 'matchup_strats';
    g.teamB.starters = g.teamB.starters.slice(0, 2);
    expect(pickerMatchup(g, 'A', 'a3')).toEqual({ pending: true });
    expect(pickerMatchup(g, 'A', 'a1').vs.id).toBe('b1');
  });

  it('is nothing for a player off the floor or a card in a deck search', () => {
    expect(pickerMatchup(game(), 'A', 'a7')).toBeNull();
    expect(pickerMatchup(game(), 'A', 'energizer')).toBeNull();
  });
});
