// The tutorial lessons that read the board, checked against a board built by
// hand — the coach's counter-pick reasoning, the placement indicators, and the
// High Screen & Roll suggestion. Each text is computed from calcAdv, so the
// numbers here are the game's numbers.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { TUTORIAL_TOOLTIPS } from './tutorialData.js';

const mk = (id, speed, power, defBoost = 0) => ({
  id, name: id.replace(/_/g, ' '), team: 'TST', pos: 'PG', speed, power, defBoost,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
});
const tip = id => TUTORIAL_TOOLTIPS.find(t => t.id === id);
const text = (id, g) => { const t = tip(id); return typeof t.text === 'function' ? t.text(g) : t.text; };
const detail = (id, g) => { const t = tip(id); return typeof t.detail === 'function' ? t.detail(g) : t.detail; };

/** Q1S1, placement under way: A led row 1 with Tatum, B answered with Mobley and led row 2 with Giannis. */
function midPlacement() {
  const A = [mk('Tatum', 12, 14), mk('Edwards', 12, 7), mk('Adebayo', 9, 16, 2), mk('Haliburton', 17, 5), mk('Bridges', 12, 11, 1)];
  const B = [mk('Mobley', 10, 14, 1), mk('Giannis', 12, 18), mk('Luka', 11, 10), mk('Shai', 15, 8), mk('Gobert', 6, 15, 3)];
  const g = newGame([...A, ...Array(5).fill(0).map((_, i) => mk(`a${i}`, 8, 8))], [...B, ...Array(5).fill(0).map((_, i) => mk(`b${i}`, 8, 8))]);
  g.phase = 'matchup_strats';
  g.draft = { ...(g.draft || {}), aPicks: A.map(p => p.id), bPicks: B.map(p => p.id) };
  getTeam(g, 'A').starters = [A[0]];
  getTeam(g, 'B').starters = [B[0], B[1]];
  g.placementStep = 3;
  g.matchupPasses = 0;
  return g;
}

describe('the placement lessons', () => {
  it('fire at the coach-answered step, in the order answer then indicators', () => {
    const g = midPlacement();
    const live = TUTORIAL_TOOLTIPS.filter(t => t.trigger.phase === g.phase && t.trigger.condition(g)).sort((a, b) => b.priority - a.priority).map(t => t.id);
    expect(live.slice(0, 2)).toEqual(['s1_place_answer', 's1_place_indicators']);
    g.placementStep = 0;
    expect(TUTORIAL_TOOLTIPS.filter(t => t.trigger.phase === g.phase && t.trigger.condition(g)).map(t => t.id)).toEqual(['s1_place_intro']);
  });

  it('explains the coach\'s answer with both directions of the pairing', () => {
    const g = midPlacement();
    const t = text('s1_place_answer', g);
    // Tatum S12 P14 vs Mobley S10 P14 Def+1: Tatum's Speed +2 soaks to +1; Mobley attacking Tatum is S−2 P0 → roll 0.
    expect(t).toContain('answered your Tatum (S12 P14) with Mobley (S10 P14 Def+1)');
    expect(t).toContain('your roll is +1');
    expect(t).toContain('the Def Boost soaks part of your edge');
    expect(t).toContain('theirs against you is 0');
  });

  it('reads the indicators for the row the coach led, and names the best answer by the coach\'s own score', () => {
    const g = midPlacement();
    const t = text('s1_place_indicators', g);
    expect(t).toContain('Now you answer row 2, where the coach led with Giannis (S12 P18)');
    expect(t).toContain('⚔ is your roll bonus attacking them, 🛡 is theirs attacking you');
    const d = detail('s1_place_indicators', g);
    // Adebayo (S9 P16 Def+2): Giannis S+3 P+2 → soaked by Def+2 to +1; Bam attacks Giannis at S−3 P−2 → −2 penalty. score −2−1+2 = −1.
    // Haliburton (S17 P5): attacks Giannis S+5 → +5; Giannis attacks him P+13 → 13. score −8.
    // Bridges (S12 P11 Def+1): Giannis S0 P+7 → +6; Bridges attacks S0 P−7 → penalty −7. score −13+1... the best is Adebayo.
    expect(d).toContain('Best answer right now by that reading: Adebayo');
  });
});

describe('the High Screen & Roll lesson', () => {
  it('names the swap that gains the most, with before-and-after numbers', () => {
    const g = midPlacement();
    // Everyone placed, identity rows: Tatum/Mobley, Edwards/Giannis, Adebayo/Luka, Haliburton/Shai, Bridges/Gobert.
    const A = getTeam(g, 'A'); const B = getTeam(g, 'B');
    A.starters = g.draft.aPicks.map(id => A.roster.find(r => r.id === id));
    B.starters = g.draft.bPicks.map(id => B.roster.find(r => r.id === id));
    g.placementStep = 10; g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
    const live = TUTORIAL_TOOLTIPS.filter(t => t.trigger.phase === g.phase && t.trigger.condition(g)).map(t => t.id);
    expect(live).toContain('s1_matchup_window');
    const t = text('s1_matchup_window', g);
    expect(t).toMatch(/Your High Screen & Roll is lit/);
    expect(t).toMatch(/Best swap now: .+ and .+ trade defenders — .+'s roll goes from [+−-]?\d+ to [+−-]?\d+/);
    expect(tip('s1_matchup_window').highlight).toBe('[data-card-id="high_screen_roll"]');
  });

  it('says to hold it when no swap gains', () => {
    const g = midPlacement();
    const A = getTeam(g, 'A'); const B = getTeam(g, 'B');
    // Five identical pairings: no swap can change anything.
    A.starters = Array.from({ length: 5 }, (_, i) => mk(`x${i}`, 10, 10));
    B.starters = Array.from({ length: 5 }, (_, i) => mk(`y${i}`, 10, 10));
    g.placementStep = 10; g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
    expect(text('s1_matchup_window', g)).toMatch(/no swap gains anything/);
  });
});
