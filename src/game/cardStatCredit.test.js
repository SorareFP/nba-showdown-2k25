// EVERY STAT A STRATEGY CARD PAYS GOES ON A PLAYER'S LINE (the user,
// 2026-10-01: "all stats derived from strats should go to a player. Who it
// goes to depends on which player allows it to happen"). Points have gone
// through scorePts since 2026-09-08; these are the assists and rebounds.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { newGame, getTeam, doRoll, creditPaintScore } from './engine.js';
import { CARDS } from './cards.js';
import { execCard, resolvePendingShotCheck } from './execCard.js';

const p = (name, speed, power, extra = {}) => ({
  ...CARDS[0], id: name, name, speed, power, defBoost: 0, salary: 800,
  threePtBoost: 0, paintBoost: 0, shotLine: 18, pos: 'SG', ...extra,
});
const five = (prefix, speed = 10, power = 10, extra = {}) =>
  [0, 1, 2, 3, 4].map(i => p(`${prefix}${i}`, speed, power, extra));

function game({ A, B, hand = [], who = 'A' } = {}) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'A').starters = A || five('a');
  getTeam(g, 'B').starters = B || five('b');
  // A stat row for everyone on the floor, as a real game has for its roster.
  for (const k of ['A', 'B']) {
    for (const s of getTeam(g, k).starters) getTeam(g, k).stats.push({ id: s.id, pts: 0, reb: 0, ast: 0, minutes: 0 });
    getTeam(g, k).hand = [];
  }
  getTeam(g, who).hand = hand;
  g.phase = 'scoring';
  g.scoringTurn = who;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.rollResults = { A: [], B: [] };
  g.tempEff = {}; g.tempDefEff = {};
  return g;
}
const line = (g, team, id) => getTeam(g, team).stats.find(s => s.id === id);
// Math.random pinned so a d20 lands on `die`.
const dice = (die, fn) => {
  vi.spyOn(Math, 'random').mockReturnValue((die - 0.5) / 20);
  try { return fn(); } finally { vi.restoreAllMocks(); }
};
afterEach(() => vi.restoreAllMocks());

describe('a card\'s assists go to the player who earned them', () => {
  it('Hammer Set: the shooter who hits the three gets both assists', () => {
    const A = five('a'); A[0] = p('slasher', 13, 10);
    const g = game({ A, hand: ['hammer_set'] });
    const r = dice(20, () => execCard(g, 'A', 'hammer_set', { playerIdx: 0 }));
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').assists).toBe(2);
    expect(line(r.game, 'A', 'slasher').ast).toBe(2);
    expect(line(r.game, 'A', 'slasher').pts).toBe(3);
  });

  it('Hammer Set: a miss pays nobody', () => {
    const A = five('a'); A[0] = p('slasher', 13, 10);
    const r = dice(1, () => execCard(game({ A, hand: ['hammer_set'] }), 'A', 'hammer_set', { playerIdx: 0 }));
    expect(getTeam(r.game, 'A').assists).toBe(0);
    expect(line(r.game, 'A', 'slasher').ast).toBe(0);
  });

  it('Pin-Down Screen: the assist is "a teammate\'s", so it is not put on the shooter', () => {
    const g = game({ hand: ['pin_down_screen', 'close_out'] });
    const r = dice(20, () => execCard(g, 'A', 'pin_down_screen', { playerIdx: 0, discardId: 'close_out' }));
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').assists).toBe(1);
    expect(line(r.game, 'A', 'a0').ast).toBe(0);
  });

  it('Short-Roll Playmaker: he gets the assist he earned by making the shot', () => {
    const g = game();
    g.tempEff.A = { paintAst2: 1 };
    creditPaintScore(g, 'A', 2, getTeam(g, 'A').starters[2]);
    expect(getTeam(g, 'A').assists).toBe(1);
    expect(line(g, 'A', 'a2').ast).toBe(1);
    // Nobody else's paint score pays.
    creditPaintScore(g, 'A', 1, getTeam(g, 'A').starters[1]);
    expect(line(g, 'A', 'a1').ast).toBe(0);
  });

  it('Spain Pick & Roll: the scorer gets the extra assist on top of his roll\'s', () => {
    const g = game();
    g.tempEff.A = { astOnScore0: 1 };
    const rolled = dice(20, () => doRoll(g, 'A', 0));
    const rr = rolled.rollResults.A[0];
    expect(rr.pts).toBeGreaterThan(0);
    expect(line(rolled, 'A', 'a0').ast).toBe(rr.ast + 1);
    expect(getTeam(rolled, 'A').assists).toBe(rr.ast + 1);
  });

  it('Burst of Momentum: the assist and the rebound are his', () => {
    const g = game({ hand: ['burst_of_momentum'] });
    g.rollResults.A[2] = { isTop: true, pts: 3, reb: 1, ast: 1 };
    const r = execCard(g, 'A', 'burst_of_momentum', { playerIdx: 2 });
    expect(r.ok).toBe(true);
    expect(line(r.game, 'A', 'a2')).toMatchObject({ ast: 1, reb: 1 });
  });
});

describe('a card\'s rebounds go to the player who earned them', () => {
  it('Delayed Slip: the slipping player takes the board', () => {
    const A = five('a'); A[1] = p('slipper', 12, 10);
    const B = five('b', 12, 12);
    const r = execCard(game({ A, B, hand: ['delayed_slip'] }), 'A', 'delayed_slip', { playerIdx: 1 });
    expect(r.ok).toBe(true);
    expect(line(r.game, 'A', 'slipper').reb).toBe(1);
  });

  it('Glass Cleaner: your defender on the shooter gets them, three when he out-muscles him', () => {
    const B = five('b'); B[3] = p('bruiser', 10, 15);
    const g = game({ B, hand: ['glass_cleaner'], who: 'B' });
    g.offMatchups.A = [0, 3, 2, 1, 4];                       // B's slot 3 guards A's slot 1
    g.lastCheckMiss = { teamKey: 'A', type: '3pt', playerIdx: 1, claimed: false };
    const r = execCard(g, 'B', 'glass_cleaner', {});
    expect(r.ok).toBe(true);
    expect(line(r.game, 'B', 'bruiser').reb).toBe(3);
  });

  it('Rim Protector: the defender who protected the rim takes the two boards on a miss', () => {
    const B = five('b'); B[0] = p('wall', 10, 15);
    const g = game({ B });
    g.pendingShotCheck = { teamKey: 'A', playerIdx: 0, type: 'paint', bonus: -4, rimProtector: 'B', cardLabel: 'Paint check' };
    const done = dice(1, () => resolvePendingShotCheck(g));
    expect(line(done, 'B', 'wall').reb).toBe(2);
    expect(line(done, 'A', 'a0').pts).toBe(0);
  });
});
