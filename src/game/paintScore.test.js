// A PAINT BUCKET IS A PAINT BUCKET, WHEREVER IT CAME FROM (the user, 2026-09-14).
//
// "Not sure my short-roll playmaker was given their assists here" — and they
// were not. Amen Thompson was the designated playmaker and hit two paint
// checks in the period, both of them SPENDS:
//
//   Spent 5 AST: Amen Thompson Paint check 19 +2 Paint = 21 vs 15 -> 2pts!
//   Rebound Paint Check (-5 REB): Amen Thompson 17 +2 Paint +2 = 21 vs 15 -> 2pts!
//
// Three routes score in the paint — a card's announced check, five assists
// spent, and the rebound-differential check — and only the first told anybody.
// So Short-Roll Playmaker paid nothing, and Inside-Out, which waits on a paint
// score, could not see either bucket. creditPaintScore is the one place that
// records it now; this pins all three routes so a fourth cannot skip it.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, spendAssist, spendReboundBonus, SPEND_COSTS } from './engine.js';
import { applyShotCheck } from './execCard.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 10, power: 10,
  // A shot line of 1 means every paint check lands, so the test is about the
  // credit and never about the dice.
  shotLine: 1, paintBoost: 0, threePtBoost: 0, defBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
const roster = p => Array.from({ length: 10 }, (_, i) => mk(`${p}${i}`));

/** A scoring-phase board with the playmaker flag already on slot 0. */
function board({ designate = true } = {}) {
  const a = roster('a');
  const b = roster('b');
  const g = newGame(a, b);
  getTeam(g, 'A').starters = a.slice(0, 5);
  getTeam(g, 'B').starters = b.slice(0, 5);
  g.phase = 'scoring';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.rollResults = { A: [], B: [] };
  g.tempEff = { A: designate ? { paintAst0: 1 } : {}, B: {} };
  return g;
}

const assistsOf = g => getTeam(g, 'A').assists;

describe('Short-Roll Playmaker pays on every route to a paint bucket', () => {
  it('pays when five assists buy the check', () => {
    const g = board();
    g.teamA.assists = SPEND_COSTS.assistPaint;
    const r = spendAssist(g, 'A', 'paint', 0);
    expect(r.ok).toBe(true);
    // The spend took its cost and the card handed one back.
    expect(assistsOf(r.game)).toBe(1);
    expect(r.game.log.some(l => /Short-Roll Playmaker/.test(l.msg))).toBe(true);
  });

  it('pays when the rebound differential buys the check', () => {
    const g = board();
    g.teamA.rebounds = SPEND_COSTS.reboundPaint;
    g.reboundBonuses = { A: { paintCheck: true }, B: {} };
    const r = spendReboundBonus(g, 'A', 'paint_check', 0);
    expect(r.ok).toBe(true);
    expect(assistsOf(r.game)).toBe(1);
    expect(r.game.log.some(l => /Short-Roll Playmaker/.test(l.msg))).toBe(true);
  });

  it('still pays when a card announces the check', () => {
    // Straight at applyShotCheck rather than through a particular card, so
    // the test is about the credit and not about that card's conditions.
    const g = board();
    applyShotCheck(g, { teamKey: 'A', playerIdx: 0, type: 'paint', bonus: 0 });
    expect(assistsOf(g)).toBe(1);
    expect(g.log.some(l => /Short-Roll Playmaker/.test(l.msg))).toBe(true);
  });

  it('pays nobody when no one was designated', () => {
    const g = board({ designate: false });
    g.teamA.assists = SPEND_COSTS.assistPaint;
    const r = spendAssist(g, 'A', 'paint', 0);
    expect(assistsOf(r.game)).toBe(0);
    expect(r.game.log.some(l => /Short-Roll Playmaker/.test(l.msg))).toBe(false);
  });

  it('pays only the designated player, not whoever takes the check', () => {
    const g = board();                       // the flag is on slot 0
    g.teamA.assists = SPEND_COSTS.assistPaint;
    const r = spendAssist(g, 'A', 'paint', 2);
    expect(assistsOf(r.game)).toBe(0);
  });
});

describe('and the paint score is on the record for whatever reads it next', () => {
  // Inside-Out waits on lastPaintScore, and was blind to both spend routes.
  it('records the bucket on every route', () => {
    const spend = board({ designate: false });
    spend.teamA.assists = SPEND_COSTS.assistPaint;
    expect(spendAssist(spend, 'A', 'paint', 1).game.lastPaintScore)
      .toMatchObject({ teamKey: 'A', playerIdx: 1 });

    const reb = board({ designate: false });
    reb.teamA.rebounds = SPEND_COSTS.reboundPaint;
    reb.reboundBonuses = { A: { paintCheck: true }, B: {} };
    expect(spendReboundBonus(reb, 'A', 'paint_check', 3).game.lastPaintScore)
      .toMatchObject({ teamKey: 'A', playerIdx: 3 });
  });
});
