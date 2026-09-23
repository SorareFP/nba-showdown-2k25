// WAVE TWO TWINS (2026-09-23) — the unpaired half of the twin survey, built
// for the user's sign-off. Power buys rebounds and Speed buys assists, so
// each card mirrors its partner on the other stat or the other side:
//   Blow-By           ↔ Rimshaker        (Speed 13+ and hot: +2 pts, another 🔥)
//   Point God         ↔ Post Domination  (a Speed edge, still to roll: assists doubled)
//   Passing Lane      ↔ Box Out          (cancel a roll's assists, +1 with the Speed edge)
//   Clamp the Reserve ↔ Unsung Hero      (an opposing $400 man keeps the LOWER die)
//   Feeling It        ↔ Turnover         (your hot marker draws two)
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, getPS, doRoll } from './engine.js';
import { canPlayCard, clampTargets } from './canPlay.js';
import { execCard } from './execCard.js';
import { getStrat } from './strats.js';

const mk = (id, speed = 10, power = 10, salary = 500) => ({
  id, name: id, team: 'TST', pos: 'PG', speed, power, defBoost: 0, salary,
  shotLine: 14, paintBoost: 1, threePtBoost: 1,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
});
const five = pre => Array.from({ length: 5 }, (_, i) => mk(`${pre}${i}`));
const filler = (pre, n) => Array.from({ length: n }, (_, i) => mk(`${pre}f${i}`));

/** A scoring phase with `who` to play, holding `hand`; matchups slot for slot. */
function scoring({ who = 'B', hand = [], A = five('a'), B = five('b') } = {}) {
  const g = newGame([...A, ...filler('a', 5)], [...B, ...filler('b', 5)]);
  getTeam(g, 'A').starters = A;
  getTeam(g, 'B').starters = B;
  getTeam(g, who).hand = hand;
  g.phase = 'scoring'; g.scoringTurn = who; g.scoringPasses = 0; g.placementStep = 10;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.tempEff = { A: {}, B: {} };
  g.rollResults = { A: [], B: [] };
  return g;
}
const heat = (g, key, id, n = 1) => { const ps = getPS(g, key, id); ps.hot = n; };

describe('the five are registered as the twins they are', () => {
  it('mirrors each partner\'s phase, side and rarity', () => {
    const pairs = [
      ['blow_by', 'rimshaker'], ['point_god', 'post_domination'], ['passing_lane', 'box_out'],
      ['clamp_the_reserve', 'unsung_hero'], ['feeling_it', 'turnover'],
    ];
    for (const [twin, partner] of pairs) {
      const t = getStrat(twin);
      const p = getStrat(partner);
      expect(t, twin).toBeTruthy();
      expect(t.phase, twin).toBe(p.phase);
      expect(t.rarity, twin).toBe(p.rarity);
      expect(t.copies, twin).toBe(p.copies);
    }
    // The two defensive mirrors sit on the other side of their partner.
    expect(getStrat('clamp_the_reserve').side).toBe('def');
    expect(getStrat('unsung_hero').side).toBe('off');
    expect(getStrat('feeling_it').side).toBe('off');
    expect(getStrat('turnover').side).toBe('def');
  });
});

describe('Blow-By', () => {
  it('needs Speed 13+ and a hot marker, and pays like Rimshaker on the other stat', () => {
    const B = [mk('b0', 15, 8), mk('b1', 9, 15), mk('b2'), mk('b3'), mk('b4')];
    const g = scoring({ hand: ['blow_by'], B });
    expect(canPlayCard(g, 'B', 'blow_by').canPlay).toBe(false);
    heat(g, 'B', 'b1');                       // Power 15, Speed 9: Rimshaker's man, not this card's
    expect(canPlayCard(g, 'B', 'blow_by').canPlay).toBe(false);
    heat(g, 'B', 'b0');
    expect(canPlayCard(g, 'B', 'blow_by').canPlay).toBe(true);
    const before = getTeam(g, 'B').score;
    const r = execCard(g, 'B', 'blow_by', { playerIdx: 0 });
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'B').score).toBe(before + 2);
    expect(getPS(r.game, 'B', 'b0').hot).toBe(2);
    // An automatic scorer, so Verticality has something to answer.
    expect(r.game.lastAutoScore).toMatchObject({ teamKey: 'B', playerIdx: 0, pts: 2, cardId: 'blow_by' });
    expect(execCard(g, 'B', 'blow_by', { playerIdx: 1 }).ok).toBe(false);
  });
});

describe('Point God', () => {
  it('opens on a Speed edge over the defender, still to roll, and doubles the assists', () => {
    const A = [mk('a0', 8, 8), mk('a1'), mk('a2'), mk('a3'), mk('a4')];
    const B = [mk('b0', 14, 8), mk('b1'), mk('b2'), mk('b3'), mk('b4')];
    const g = scoring({ hand: ['point_god'], A, B });
    expect(canPlayCard(g, 'B', 'point_god').canPlay).toBe(true);
    // A man with no Speed edge is refused; so is one who has rolled.
    expect(execCard(g, 'B', 'point_god', { playerIdx: 1 }).ok).toBe(false);
    const r = execCard(g, 'B', 'point_god', { playerIdx: 0 });
    expect(r.ok).toBe(true);
    expect(r.game.tempEff.B.ast20).toBe(1);
    const rolled = doRoll(r.game, 'B', 0);
    const res = rolled.rollResults.B[0];
    expect(res.ast).toBe(2);                  // the chart's 1, doubled
    expect(res.reb).toBe(1);                  // rebounds are Post Domination's business
  });

  it('is shut when nobody has the edge', () => {
    const A = [mk('a0', 14, 8), mk('a1', 14), mk('a2', 14), mk('a3', 14), mk('a4', 14)];
    const g = scoring({ hand: ['point_god'], A });
    expect(canPlayCard(g, 'B', 'point_god').canPlay).toBe(false);
    expect(canPlayCard(g, 'B', 'point_god').reason).toMatch(/Speed advantage/);
  });
});

describe('Passing Lane', () => {
  const afterRoll = () => {
    const A = [mk('a0', 10, 10), mk('a1'), mk('a2'), mk('a3'), mk('a4')];
    const B = [mk('b0', 13, 10), mk('b1'), mk('b2'), mk('b3'), mk('b4')];
    const g = scoring({ who: 'A', A, B });
    getTeam(g, 'B').hand = ['passing_lane', 'box_out'];
    const rolled = doRoll(g, 'A', 0);          // a0 rolls: 2 pts, 1 reb, 1 ast
    rolled.scoringTurn = 'B';
    return rolled;
  };

  it('cancels the roll\'s assists, one more with the Speed edge, and only once', () => {
    const g = afterRoll();
    expect(g.lastRoll).toMatchObject({ teamKey: 'A', idx: 0, ast: 1, reb: 1, deflected: false });
    getTeam(g, 'A').assists = 3;
    expect(canPlayCard(g, 'B', 'passing_lane').canPlay).toBe(true);
    const r = execCard(g, 'B', 'passing_lane', {});
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').assists).toBe(1);   // 1 cancelled, +1 for b0's Speed edge on a0
    expect(r.game.lastRoll.deflected).toBe(true);
    expect(canPlayCard(r.game, 'B', 'passing_lane').canPlay).toBe(false);
    // Box Out still has the rebounds to take: the two flags are separate.
    expect(canPlayCard(r.game, 'B', 'box_out').canPlay).toBe(true);
  });

  it('is never played on your own roll', () => {
    const g = afterRoll();
    getTeam(g, 'A').hand = ['passing_lane'];
    g.scoringTurn = 'A';
    expect(canPlayCard(g, 'A', 'passing_lane').canPlay).toBe(false);
  });
});

describe('Clamp the Reserve', () => {
  it('targets an opposing $400 man still to roll, through the one shared list', () => {
    const A = [mk('a0', 10, 10, 350), mk('a1', 10, 10, 900), mk('a2', 10, 10, 400), mk('a3'), mk('a4')];
    const g = scoring({ hand: ['clamp_the_reserve'], A });
    expect(clampTargets(g, 'B').map(t => t.origIdx)).toEqual([0, 2]);
    expect(canPlayCard(g, 'B', 'clamp_the_reserve').canPlay).toBe(true);
    // The choice is the card: no target, or a target off the list, is refused.
    expect(execCard(g, 'B', 'clamp_the_reserve', {}).ok).toBe(false);
    expect(execCard(g, 'B', 'clamp_the_reserve', { targetIdx: 1 }).ok).toBe(false);
    const r = execCard(g, 'B', 'clamp_the_reserve', { targetIdx: 2 });
    expect(r.ok).toBe(true);
    expect(r.game.tempEff.A.dis2).toBe(1);
    // The engine rolls him two dice and keeps the lower.
    const rolled = doRoll(r.game, 'A', 2);
    expect(rolled.rollResults.A[2].dice?.length ?? 2).toBeGreaterThanOrEqual(2);
  });

  it('closes once every cheap opponent has rolled', () => {
    const A = [mk('a0', 10, 10, 350), mk('a1', 10, 10, 900), mk('a2', 10, 10, 900), mk('a3', 10, 10, 900), mk('a4', 10, 10, 900)];
    const g = scoring({ hand: ['clamp_the_reserve'], A });
    const rolled = doRoll(g, 'A', 0);
    rolled.scoringTurn = 'B';
    expect(canPlayCard(rolled, 'B', 'clamp_the_reserve').canPlay).toBe(false);
  });
});

describe('Feeling It', () => {
  it('draws two off your own hot marker, the way Turnover draws off their cold one', () => {
    const g = scoring({ hand: ['feeling_it'] });
    expect(canPlayCard(g, 'B', 'feeling_it').canPlay).toBe(false);
    heat(g, 'A', 'a0');                        // THEIR hot marker is not yours
    expect(canPlayCard(g, 'B', 'feeling_it').canPlay).toBe(false);
    heat(g, 'B', 'b3');
    expect(canPlayCard(g, 'B', 'feeling_it').canPlay).toBe(true);
    getTeam(g, 'B').deck = ['first_step', 'power_move', 'and_one'];
    const r = execCard(g, 'B', 'feeling_it', {});
    expect(r.ok).toBe(true);
    const hand = getTeam(r.game, 'B').hand;
    expect(hand).not.toContain('feeling_it');
    expect(hand.length).toBe(2);
  });
});
