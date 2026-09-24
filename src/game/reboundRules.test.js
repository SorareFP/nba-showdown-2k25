// THE GLASS AS DIALS (2026-09-23). The rebound paint check's rules live in
// REBOUND_RULES so the balance work can sweep them: when it is open (a
// section-end lead on the Rebound Track, or any time the bank covers it), the
// bonus it carries, and the glass winner's extra. The engine enforces the
// gate itself; the board and the coach read the same predicate.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  newGame, getTeam, endSection, spendReboundBonus, checkNeed, SPEND_COSTS,
  REBOUND_RULES, reboundCheckOpen, reboundCheckBonus, reboundCheckProblem,
  gainRebounds, loseRebounds, trackRebounds, reboundTrackLead, doRoll,
} from './engine.js';
import { aiSpendDecision } from './ai.js';
import { reboundLeadProblem } from './canPlay.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'C', speed: 10, power: 10, defBoost: 0,
  shotLine: 14, paintBoost: 2, threePtBoost: -3, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
const roster = p => Array.from({ length: 10 }, (_, i) => mk(`${p}${i}`));
function game() {
  const g = newGame(roster('a'), roster('b'));
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.phase = 'scoring';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.teamA.hand = []; g.teamB.hand = [];
  return g;
}
const DEFAULTS = { ...REBOUND_RULES };
const DEFAULT_COST = SPEND_COSTS.reboundPaint;
afterEach(() => { Object.assign(REBOUND_RULES, DEFAULTS); SPEND_COSTS.reboundPaint = DEFAULT_COST; });
const GATED = { paintGate: 3, oncePerSection: true, paintBonus: 0, leadBonus: 0, leadGate: 3 };

describe('the rule shipped 2026-09-23', () => {
  it("opens the bank like the assists, at the assist paint check's price, with +2 for a 3+ glass win", () => {
    expect(REBOUND_RULES).toMatchObject({ paintGate: 0, oncePerSection: false, paintBonus: 0, leadBonus: 2, leadGate: 3, leadToSpend: false });
    expect(SPEND_COSTS.reboundPaint).toBe(SPEND_COSTS.assistPaint);
  });

  it('says so in the section-end log', () => {
    const g = game();
    g.teamA.rebounds = 14; g.teamB.rebounds = 10;
    const lines = endSection(g).log.map(l => l.msg);
    expect(lines.some(m => /Rebound Track lead → .* \+1 AST · next rebound paint check \+2/.test(m))).toBe(true);
  });
});

describe('the track and the bank are split (2026-09-24)', () => {
  // The user: "When I use a paint shot check, all of a sudden the other team is
  // +5 in rebounds." A lead-to-spend rule fixed it and cut the checks from 7.2
  // a game to 0.8, so the user took the split: the track counts rebounds WON,
  // the bank what a team holds to spend. "Yeah let's do that."
  const cost = () => SPEND_COSTS.reboundPaint;
  const won = (g, a, b) => { gainRebounds(g.teamA, a); gainRebounds(g.teamB, b); return g; };

  it('is the shipped rule: the check needs only the bank', () => {
    expect(REBOUND_RULES.leadToSpend).toBe(false);
    const g = won(game(), 12, 12);
    expect(reboundTrackLead(g, 'A')).toBe(0);
    expect(reboundCheckOpen(g, 'A')).toBe(true);
  });

  it('a spend never moves the track: the reported +5 is gone', () => {
    const g = won(game(), 12, 12);
    const spent = spendReboundBonus(g, 'A', 'paint_check', 0);
    expect(spent.ok).toBe(true);
    expect(getTeam(spent.game, 'A')).toMatchObject({ rebounds: 12 - cost(), reboundsWon: 12 });
    expect(reboundTrackLead(spent.game, 'B')).toBe(0);
  });

  it('a scoring roll adds to both', () => {
    const g = game();
    const r = doRoll(g, 'A', 0);
    expect(getTeam(r, 'A')).toMatchObject({ rebounds: 1, reboundsWon: 1 });
  });

  it('the section end pays the track, not the bank', () => {
    const g = won(game(), 10, 7);
    g.teamA.rebounds = 2;                                  // spent 8 of its 10
    const ng = endSection(g);
    expect(ng.teamA.assists).toBe(1);
    expect(ng.reboundBonuses.A).toMatchObject({ diff: 3 });
    expect(ng.log.some(l => /Rebound Track lead → .* \+1 AST · next rebound paint check \+2/.test(l.msg))).toBe(true);
  });

  it('a cancel comes off the track too, since the rebounds were never won', () => {
    const t = { rebounds: 0 };
    gainRebounds(t, 4);
    t.rebounds = 1;                                        // spent 3
    expect(loseRebounds(t, 2)).toBe(2);
    expect(t).toMatchObject({ rebounds: 0, reboundsWon: 2 });
  });

  it('a game saved before the split reads its bank as the track until its next rebound', () => {
    const t = { rebounds: 6 };
    expect(trackRebounds(t)).toBe(6);
    gainRebounds(t, 1);
    expect(t).toMatchObject({ rebounds: 7, reboundsWon: 7 });
  });

  it('a rebound card still needs the lead, now on rebounds won', () => {
    const g = won(game(), 10, 7);
    g.teamA.rebounds = 4;                                  // under the opponent's bank of 7
    expect(reboundLeadProblem(g, 'A', 'offensive_board')).toBeNull();        // costs 3, lead 3
    expect(reboundLeadProblem(g, 'A', 'own_the_glass')).toMatch(/lead by 3/);
  });

  it('the dial, on, gates the check on the track lead', () => {
    REBOUND_RULES.leadToSpend = true;
    const g = won(game(), 12, 12);
    expect(reboundCheckProblem(g, 'A')).toBe(`Lead the rebound battle by ${cost()} to spend ${cost()} REB (you are level)`);
    const refused = spendReboundBonus(g, 'A', 'paint_check', 0);
    expect(refused.ok).toBe(false);
    expect(getTeam(refused.game, 'A').rebounds).toBe(12);
  });
});

describe('the gated check (the rule before 2026-09-23, still a setting)', () => {
  beforeEach(() => { Object.assign(REBOUND_RULES, GATED); });
  it('opens only for a section won on the glass by the gate, and only with the bank to pay', () => {
    const g = game();
    g.teamA.rebounds = 20;
    expect(reboundCheckOpen(g, 'A')).toBe(false);
    g.reboundBonuses = { A: { diff: 3, paintCheck: true } };
    expect(reboundCheckOpen(g, 'A')).toBe(true);
    g.teamA.rebounds = SPEND_COSTS.reboundPaint - 1;
    expect(reboundCheckOpen(g, 'A')).toBe(false);
  });

  it('is refused by the engine when closed, and taken once when open', () => {
    const g = game();
    g.teamA.rebounds = 20;
    const closed = spendReboundBonus(g, 'A', 'paint_check', 0);
    expect(closed.ok).toBe(false);
    expect(getTeam(closed.game, 'A').rebounds).toBe(20);
    g.reboundBonuses = { A: { diff: 4, paintCheck: true } };
    const once = spendReboundBonus(g, 'A', 'paint_check', 0);
    expect(once.ok).toBe(true);
    expect(getTeam(once.game, 'A').rebounds).toBe(20 - SPEND_COSTS.reboundPaint);
    expect(spendReboundBonus(once.game, 'A', 'paint_check', 0).ok).toBe(false);
  });

  it('is published at the section end by the gate on the dial', () => {
    const g = game();
    g.teamA.rebounds = 12; g.teamB.rebounds = 10;
    expect(endSection(g).reboundBonuses.A).toMatchObject({ diff: 2, paintCheck: false });
    REBOUND_RULES.paintGate = 2;
    expect(endSection(g).reboundBonuses.A).toMatchObject({ diff: 2, paintCheck: true });
  });
});

describe('the open check', () => {
  it('needs only the bank, and can be taken again', () => {
    Object.assign(REBOUND_RULES, { paintGate: 0, oncePerSection: false });
    const g = game();
    g.teamA.rebounds = 2 * SPEND_COSTS.reboundPaint;
    expect(reboundCheckOpen(g, 'A')).toBe(true);
    const first = spendReboundBonus(g, 'A', 'paint_check', 0);
    expect(first.ok).toBe(true);
    const second = spendReboundBonus(first.game, 'A', 'paint_check', 0);
    expect(second.ok).toBe(true);
    expect(getTeam(second.game, 'A').rebounds).toBe(0);
  });

  it('carries the flat bonus on every check and the glass winner\'s extra once, itemised as REB', () => {
    Object.assign(REBOUND_RULES, { paintGate: 0, oncePerSection: false, paintBonus: 1, leadBonus: 2, leadGate: 3 });
    const g = game();
    g.teamA.rebounds = 20;
    expect(reboundCheckBonus(g, 'A')).toBe(1);
    g.reboundBonuses = { A: { diff: 3, paintCheck: true } };
    expect(reboundCheckBonus(g, 'A')).toBe(3);
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.2);   // a 5
    const first = spendReboundBonus(g, 'A', 'paint_check', 0);
    spy.mockRestore();
    expect(first.game.log.at(-1).msg).toContain('+3 REB');
    expect(reboundCheckBonus(first.game, 'A')).toBe(1);
  });
});

describe('the button and the coach ask the check the spend will take', () => {
  it('reads the rebound bonus and leaves the banked assist boost out', () => {
    const g = game();
    g.tempEff = { A: { astBoost_0: 1 }, B: {} };
    const assist = checkNeed(g, 'A', 0, 'paint');
    const rebound = checkNeed(g, 'A', 0, 'paint', { extra: 2, banked: false });
    expect(rebound.need).toBe(assist.need - 1);
  });

  it('gated: the coach always takes the published check', () => {
    Object.assign(REBOUND_RULES, GATED);
    const g = game();
    g.teamA.rebounds = SPEND_COSTS.reboundPaint;
    g.reboundBonuses = { A: { diff: 3, paintCheck: true } };
    expect(aiSpendDecision(g, 'A')).toMatchObject({ type: 'spend_rebound', rebType: 'paint_check' });
  });

  it('open: the coach spends the bank like assists, holding back what its rebound cards need', () => {
    Object.assign(REBOUND_RULES, { paintGate: 0, oncePerSection: false });
    const g = game();
    g.teamA.rebounds = SPEND_COSTS.reboundPaint;
    expect(aiSpendDecision(g, 'A')).toMatchObject({ type: 'spend_rebound' });
    g.teamA.hand = ['offensive_board'];                 // costs 3 REB: the reserve
    expect(aiSpendDecision(g, 'A')).toBeNull();
    g.teamA.rebounds = SPEND_COSTS.reboundPaint + 3;
    expect(aiSpendDecision(g, 'A')).toMatchObject({ type: 'spend_rebound' });
  });
});
