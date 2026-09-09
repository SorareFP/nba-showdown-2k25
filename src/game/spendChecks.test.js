// The spend checks — an assist three, an assist paint check, the rebound
// paint check — print WHERE their bonus came from, the way the card checks
// do. The user (2026-09-08) read "Jaren Jackson Jr. 🎲8=8 vs 14 → MISS" on a
// player with Paint −1 and a hot marker and could not tell whether the marker
// had been counted. It had: −1 Paint, +2 🔥, −1 contest. Now the line says so.
import { describe, it, expect, vi } from 'vitest';
import { newGame, getTeam, getPS, spendAssist, spendReboundBonus, shotCheck, checkLine, checkNeed, SPEND_COSTS } from './engine.js';
import { aiSpendDecision } from './ai.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'C', speed: 10, power: 10, defBoost: 0,
  shotLine: 14, paintBoost: -1, threePtBoost: 2, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
const roster = (prefix, over) => Array.from({ length: 10 }, (_, i) => mk(`${prefix}${i}`, over));

function game() {
  const g = newGame(roster('a'), roster('b', { defBoost: 1 }));
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.phase = 'scoring';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  // The dealt hand is random and the coach keeps assists back for the assist
  // cards it holds; these tests set the hand themselves where it matters.
  g.teamA.hand = [];
  g.teamB.hand = [];
  return g;
}

describe('shotCheck with itemised parts', () => {
  it('sums an array of parts and keeps each one, dropping zeros', () => {
    const p = mk('p', { hot: 0 });
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.35);   // a 8
    const r = shotCheck(p, 'paint', [{ label: 'AST', n: 0 }, { label: 'contest', n: -1 }], { hot: 1 });
    spy.mockRestore();
    expect(r.die).toBe(8);
    expect(r.parts).toEqual([{ label: 'contest', n: -1 }, { label: 'Paint', n: -1 }, { label: '🔥', n: 2 }]);
    expect(r.bonus).toBe(0);
    expect(r.total).toBe(8);
    expect(checkLine(r)).toBe('🎲8 −1 contest −1 Paint +2 🔥 = 8 vs 14 → MISS');
  });

  it('still labels a plain number as a card bonus', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.35);
    const r = shotCheck(mk('p'), '3pt', 1, {});
    spy.mockRestore();
    expect(r.parts).toEqual([{ label: 'card', n: 1 }, { label: '3PT', n: 2 }]);
  });
});

describe('any player may spend', () => {
  it('a three or a paint check no longer needs a bonus — the bonus rides on the die either way', () => {
    const g = game();
    g.teamA.assists = SPEND_COSTS.assistThree;
    g.teamA.starters[0].threePtBoost = -2;   // a non-shooter
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.85);   // a 18
    const { game: ng, ok } = spendAssist(g, 'A', '3pt', 0);
    spy.mockRestore();
    expect(ok).toBe(true);
    const line = ng.log[ng.log.length - 1].msg;
    // 18 −1 contest −2 3PT = 15 vs 14 → in, at a price the bonus made plain
    expect(line).toContain('🎲18 −1 contest −2 3PT = 15 vs 14 → 3pts!');
    const g2 = game();
    g2.teamA.assists = SPEND_COSTS.assistPaint;
    expect(spendAssist(g2, 'A', 'paint', 0).ok).toBe(true);     // Paint −1, still allowed
  });

  it('checkNeed says the least die that converts, from the same sum the check makes', () => {
    const g = game();
    // a0: Paint −1, 3PT +2, contest 1 (b0 Def+1), Shot Line 14.
    expect(checkNeed(g, 'A', 0, '3pt')).toEqual({ need: 13, pHit: 0.4, bonus: 1 });
    expect(checkNeed(g, 'A', 0, 'paint')).toEqual({ need: 16, pHit: 0.25, bonus: -2 });
    getPS(g, 'A', 'a0').hot = 1;                                  // +2
    g.tempEff = { A: { astBoost_0: 1 }, B: {} };                  // +1 banked
    expect(checkNeed(g, 'A', 0, '3pt')).toEqual({ need: 10, pHit: 0.55, bonus: 4 });
    g.teamA.starters[0].shotLine = 30;
    expect(checkNeed(g, 'A', 0, '3pt').pHit).toBe(0);
  });

  it('the AI takes the best check by expected points, keeps what its cards need, and never hoards', () => {
    const g = game();
    g.teamA.assists = SPEND_COSTS.assistThree;
    g.teamA.starters[3].threePtBoost = 5;                         // the shooter: need 8+, 65%
    expect(aiSpendDecision(g, 'A')).toMatchObject({ type: 'spend_assist', spendType: '3pt', playerIdx: 3 });
    // Cross-Court Dime in hand: three assists are its, so five is not enough to shoot.
    g.teamA.hand = ['cross_court_dime'];
    expect(aiSpendDecision(g, 'A')).toBeNull();
    g.teamA.assists = SPEND_COSTS.assistThree + 3;
    expect(aiSpendDecision(g, 'A')).toMatchObject({ type: 'spend_assist', spendType: '3pt', playerIdx: 3 });
    // A poor-shooting lineup at the cost: the best check is under the bar → hold.
    const poor = game();
    poor.teamA.assists = SPEND_COSTS.assistThree;
    for (const p of poor.teamA.starters) { p.threePtBoost = -6; p.paintBoost = -6; }
    expect(aiSpendDecision(poor, 'A')).toBeNull();
    // Twice the cost: a fair check goes; three times: anything goes — nothing sits forever.
    for (const p of poor.teamA.starters) { p.threePtBoost = -1; p.paintBoost = -1; }   // a ~25% three
    poor.teamA.assists = 2 * SPEND_COSTS.assistThree;
    expect(aiSpendDecision(poor, 'A')).toMatchObject({ type: 'spend_assist', spendType: '3pt' });
    for (const p of poor.teamA.starters) { p.threePtBoost = -4; p.paintBoost = -4; }   // ~5%
    expect(aiSpendDecision(poor, 'A')).toBeNull();
    poor.teamA.assists = 3 * SPEND_COSTS.assistThree;
    expect(aiSpendDecision(poor, 'A').type).toBe('spend_assist');
    // Paint over three when its expected points are higher.
    const inside = game();
    inside.teamA.assists = SPEND_COSTS.assistPaint;
    for (const p of inside.teamA.starters) { p.threePtBoost = -4; p.paintBoost = 4; }   // three ~5%, paint ~55%
    expect(aiSpendDecision(inside, 'A')).toMatchObject({ type: 'spend_assist', spendType: 'paint' });
  });
});

describe('the spend lines', () => {
  it('rebound paint check: Paint −1, 🔥 +2, contest −1 read as parts, net zero', () => {
    const g = game();
    g.teamA.rebounds = SPEND_COSTS.reboundPaint;
    g.reboundBonuses = { A: { paintCheck: true } };
    getPS(g, 'A', 'a0').hot = 1;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.35);
    const { game: ng, ok } = spendReboundBonus(g, 'A', 'paint_check', 0);
    spy.mockRestore();
    expect(ok).toBe(true);
    const line = ng.log[ng.log.length - 1].msg;
    expect(line).toBe(`Rebound Paint Check (−${SPEND_COSTS.reboundPaint} REB): a0 🎲8 −1 contest −1 Paint +2 🔥 = 8 vs 14 → MISS`);
  });

  it('assist three: the banked +1 boost, the 3PT bonus and the contest, itemised', () => {
    const g = game();
    g.teamA.assists = SPEND_COSTS.assistThree;
    g.tempEff = { A: { astBoost_0: 1 }, B: {} };
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.55);   // a 12
    const { game: ng, ok } = spendAssist(g, 'A', '3pt', 0);
    spy.mockRestore();
    expect(ok).toBe(true);
    const line = ng.log[ng.log.length - 1].msg;
    expect(line).toBe(`Spent ${SPEND_COSTS.assistThree} AST: a0 3PT check 🎲12 +1 AST −1 contest +2 3PT = 14 vs 14 → 3pts!`);
    expect(getTeam(ng, 'A').score).toBe(3);
  });
});
