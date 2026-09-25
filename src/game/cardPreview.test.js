// THE PICKER SAYS ONLY WHAT THE CARD WOULD DO (2026-09-25). The user asked for
// each choice's matchup and roll, then: "it's confusing when I play a card
// for a 3pt shot check and it shows the matchup details as if they are
// relevant to the shot check... we need all the *relevant* details on the
// choice prompt" — and for a defensive card, "their matchup's roll bonus and
// how it would change with playing the card".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { newGame, doRoll, checkNeed, scoringRollModifier, getTeam } from './engine.js';
import { choicePreview } from './cardPreview.js';

vi.mock('../ui/dialogs.jsx', () => ({ useDialogs: () => ({ toast: () => {}, ask: async () => false }) }));
const { previewLines } = await import('../components/game/CourtBoard.jsx');

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'F', speed: 10, power: 10, defBoost: 1,
  shotLine: 14, paintBoost: 1, threePtBoost: 2, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }], ...over,
});
function game(phase = 'scoring') {
  const g = newGame(
    Array.from({ length: 10 }, (_, i) => mk(`a${i}`, i === 1 ? { salary: 200 } : {})),
    Array.from({ length: 10 }, (_, i) => mk(`b${i}`, i === 0 ? { speed: 16 } : {})),
  );
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.phase = phase;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.matchupTurn = 'A'; g.scoringTurn = 'A';
  return g;
}
afterEach(() => vi.restoreAllMocks());

describe('the scoring-roll modifier the previews read', () => {
  it('is what doRoll adds to the die', () => {
    const g = game();
    getTeam(g, 'B').stats.find(s => s.id === 'b0').hot = 1;
    g.tempEff = { A: {}, B: { r0: -1 } };
    const m = scoringRollModifier(g, 'B', 0);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);          // an 11
    const rolled = doRoll(g, 'B', 0).rollResults.B[0];
    expect(rolled.finalRoll - rolled.die).toBe(m.total);
    expect(m).toMatchObject({ matchup: 5, card: -1, markers: 2 });   // Speed +6, less the defender's +1
  });
});

describe('a shot-check card', () => {
  it('shows the check and what the die needs, itemised, and no scoring-roll matchup', () => {
    const g = game();
    const random = vi.spyOn(Math, 'random');
    const pv = choicePreview(g, 'A', 'elevator_doors', { playerIdx: 0 });
    expect(random).not.toHaveBeenCalled();                  // nothing is rolled
    expect(pv.rolls).toEqual([]);
    expect(pv.checks).toHaveLength(1);
    const [c] = pv.checks;
    expect(c).toMatchObject({ type: '3pt', idx: 0 });
    expect(c.need).toBe(checkNeed(g, 'A', 0, '3pt', { extra: 3, banked: false }).need);
    expect(c.parts.map(p => p.label)).toEqual(['card', '3PT', 'contest (b0)']);
    const lines = previewLines(pv, { teamKey: 'A', idx: 0 }).map(l => l.text);
    expect(lines).toEqual([`3PT check: needs ${c.need}+ on the die (${Math.round((21 - c.need) / 20 * 100)}%) — card +3 · 3PT +2 · contest (b0) -1`]);
    expect(lines.join(' ')).not.toMatch(/Roll|vs /);
  });

  it('counts a card\'s several checks as one line, and says the roll is spent', () => {
    const pv = choicePreview(game(), 'A', 'five_out', { playerIdx: 0 });
    const lines = previewLines(pv, { teamKey: 'A', idx: 0 }).map(l => l.text);
    expect(lines[0]).toMatch(/^Two 3PT checks: needs \d+\+/);
    expect(lines).toContain('Replaces the scoring roll');
  });
});

describe('a defensive card', () => {
  it('shows the roll of the man the chosen defender guards, before and after', () => {
    const g = game('matchup_strats');
    const pv = choicePreview(g, 'A', 'energizer', { playerIdx: 1 });
    expect(pv.checks).toEqual([]);
    expect(pv.rolls).toEqual([{ teamKey: 'B', idx: 1, name: 'b1', vs: 'a1', before: 0, after: -3 }]);
    expect(previewLines(pv, { teamKey: 'A', idx: 1 }).map(l => l.text)).toEqual(["b1's roll vs a1: 0 → -3"]);
  });

  it('on one of theirs, reads as that player\'s own roll', () => {
    const pv = choicePreview(game('matchup_strats'), 'A', 'pick_up_full_court', { targetIdx: 0 });
    expect(previewLines(pv, { teamKey: 'B', idx: 0 }).map(l => l.text)).toEqual(['Roll vs a0: +5 → +4']);
  });
});

describe('a play the engine would refuse', () => {
  it('has no preview at all, rather than a guess', () => {
    expect(choicePreview(game(), 'A', 'defensive_stopper', { playerIdx: 0 })).toBeNull();
    expect(previewLines(null)).toEqual([]);
  });
});
