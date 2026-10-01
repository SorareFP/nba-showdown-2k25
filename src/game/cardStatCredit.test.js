// EVERY STAT A STRATEGY CARD PAYS GOES ON A PLAYER'S LINE (the user,
// 2026-10-01: "all stats derived from strats should go to a player. Who it
// goes to depends on which player allows it to happen"). Points have gone
// through scorePts since 2026-09-08; these are the assists and rebounds.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { newGame, getTeam, doRoll, creditPaintScore } from './engine.js';
import { CARDS } from './cards.js';
import { execCard, resolvePendingShotCheck, pinDownPasser } from './execCard.js';

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

  it('Pin-Down Screen: the assist is "a teammate\'s" — the highest-salary guard beside the shooter', () => {
    const A = [p('shooter', 10, 10, { pos: 'SG', salary: 2000 }), p('wing', 10, 10, { pos: 'SF' }),
      p('lead', 10, 10, { pos: 'PG', salary: 900 }), p('combo', 10, 10, { pos: 'G-F', salary: 1200 }), p('big', 6, 14, { pos: 'C' })];
    const g = game({ A, hand: ['pin_down_screen', 'close_out'] });
    const r = dice(20, () => execCard(g, 'A', 'pin_down_screen', { playerIdx: 0, discardId: 'close_out' }));
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').assists).toBe(1);
    // Never the shooter, though he is the dearest guard out there.
    expect(line(r.game, 'A', 'shooter').ast).toBe(0);
    expect(line(r.game, 'A', 'combo').ast).toBe(1);
    expect(line(r.game, 'A', 'lead').ast).toBe(0);
    expect(r.game.log.some(l => l.msg.includes('+1 AST (combo)'))).toBe(true);
  });

  it('Pin-Down Screen\'s passer: no guard beside him, the slowest forward; no forward either, the slowest teammate', () => {
    const noGuard = [p('shooter', 12, 8, { pos: 'PG' }), p('quick', 13, 9, { pos: 'SF' }), p('slow', 8, 13, { pos: 'PF' }), p('c1', 5, 15, { pos: 'C' }), p('c2', 7, 14, { pos: 'C' })];
    expect(pinDownPasser(noGuard, 0).id).toBe('slow');
    const centres = [p('shooter', 12, 8, { pos: 'SG' }), ...['c1', 'c2', 'c3', 'c4'].map((id, i) => p(id, 9 - i, 14, { pos: 'C' }))];
    expect(pinDownPasser(centres, 0).id).toBe('c4');
    // A tie goes to the earlier slot.
    const tied = [p('g1', 10, 10, { pos: 'PG', salary: 800 }), p('shooter', 10, 10, { pos: 'SG' }), p('g2', 10, 10, { pos: 'SG', salary: 800 }), p('f', 10, 10, { pos: 'SF' }), p('c', 10, 10, { pos: 'C' })];
    expect(pinDownPasser(tied, 1).id).toBe('g1');
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

  it('Strength in Numbers: one assist each to the three biggest edges, the earlier slot on a tie', () => {
    // Edges over a 10/10 defence: +5, +2, +2, +1, +3.
    const A = [p('big', 15, 10), p('tie1', 12, 10), p('tie2', 10, 12), p('small', 11, 10), p('mid', 13, 10)];
    const r = execCard(game({ A, hand: ['strength_in_numbers'] }), 'A', 'strength_in_numbers', {});
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').assists).toBe(3);
    expect(['big', 'tie1', 'tie2', 'small', 'mid'].map(id => line(r.game, 'A', id).ast)).toEqual([1, 1, 0, 0, 1]);
    expect(r.game.log.some(l => l.msg.includes('big (+5), mid (+3), tie1 (+2) one each'))).toBe(true);
  });

  it('Grab and Go: both assists go to the player on the floor with the most rebounds this game', () => {
    const g = game({ hand: ['grab_and_go'] });
    getTeam(g, 'A').rebounds = 3;
    line(g, 'A', 'a3').reb = 7;
    line(g, 'A', 'a1').reb = 4;
    const r = execCard(g, 'A', 'grab_and_go', {});
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').assists).toBe(2);
    expect(line(r.game, 'A', 'a3').ast).toBe(2);
    expect(line(r.game, 'A', 'a1').ast).toBe(0);
  });

  it('Passing Lane: the cancelled assists come off the roller\'s own line, and never below zero', () => {
    const B = five('b'); B[1] = p('thief', 14, 10);              // faster than the roller: one more comes off
    const g = game({ B, hand: ['passing_lane'], who: 'B' });
    getTeam(g, 'A').assists = 4;
    line(g, 'A', 'a1').ast = 2;                                   // the two his roll just won
    g.lastRoll = { teamKey: 'A', idx: 1, reb: 0, ast: 2, pts: 3, boxed: false, deflected: false };
    const r = execCard(g, 'B', 'passing_lane', {});
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').assists).toBe(1);                 // 2 from the roll, 1 more for the Speed edge
    expect(line(r.game, 'A', 'a1').ast).toBe(0);                  // 2 - 3, floored
  });

  it('Pin-Down Screen costs a discard: the engine takes one, and refuses with nothing to pay', () => {
    // No card named: the last other card in hand pays.
    const r = dice(1, () => execCard(game({ hand: ['pin_down_screen', 'close_out', 'box_out'] }), 'A', 'pin_down_screen', { playerIdx: 0 }));
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').hand).toEqual(['close_out']);
    // Nothing else in hand: no play.
    expect(execCard(game({ hand: ['pin_down_screen'] }), 'A', 'pin_down_screen', { playerIdx: 0 }).ok).toBe(false);
  });
});

// A MAKE THE CHALLENGE OVERTURNS NEVER HAPPENED (the user, 2026-10-01): the
// assists it paid leave the pool and the line they were written on.
describe('Coach\'s Challenge takes back the assists an overturned make paid', () => {
  // A hits the card's check on a 20; B challenges, and the re-roll lands on `reroll`.
  const challenged = (g, card, opts, reroll) => {
    const made = dice(20, () => execCard(g, 'A', card, opts)).game;
    getTeam(made, 'B').hand = ['coaches_challenge'];
    return { made, after: dice(reroll, () => execCard(made, 'B', 'coaches_challenge', {})) };
  };

  it('Hammer Set overturned: both assists come off the pool and off the shooter', () => {
    const A = five('a'); A[0] = p('slasher', 13, 10);
    const { made, after } = challenged(game({ A, hand: ['hammer_set'] }), 'hammer_set', { playerIdx: 0 }, 1);
    expect(getTeam(made, 'A').assists).toBe(2);
    expect(after.ok).toBe(true);
    expect(getTeam(after.game, 'A').assists).toBe(0);
    expect(line(after.game, 'A', 'slasher')).toMatchObject({ ast: 0, pts: 0 });
    expect(after.game.log.some(l => l.msg.includes('2 AST taken back'))).toBe(true);
  });

  it('the call stands: a re-roll that goes in leaves the assists where they were', () => {
    const A = five('a'); A[0] = p('slasher', 13, 10);
    const { after } = challenged(game({ A, hand: ['hammer_set'] }), 'hammer_set', { playerIdx: 0 }, 20);
    expect(getTeam(after.game, 'A').assists).toBe(2);
    expect(line(after.game, 'A', 'slasher')).toMatchObject({ ast: 2, pts: 3 });
  });

  it('Pin-Down Screen overturned: the assist comes off the teammate it went to', () => {
    const A = five('a'); A[2] = p('lead', 10, 10, { pos: 'PG', salary: 1500 });
    const { made, after } = challenged(game({ A, hand: ['pin_down_screen', 'close_out'] }), 'pin_down_screen', { playerIdx: 0 }, 1);
    expect(line(made, 'A', 'lead').ast).toBe(1);
    expect(getTeam(after.game, 'A').assists).toBe(0);
    expect(line(after.game, 'A', 'lead').ast).toBe(0);
  });

  it('assists already spent stay spent: the pool stops at zero, and a standing call returns only what was taken', () => {
    const A = five('a'); A[0] = p('slasher', 13, 10);
    const made = dice(20, () => execCard(game({ A, hand: ['hammer_set'] }), 'A', 'hammer_set', { playerIdx: 0 })).game;
    getTeam(made, 'A').assists = 1;                       // one of the two already spent
    getTeam(made, 'B').hand = ['coaches_challenge', 'coaches_challenge'];
    const missed = dice(1, () => execCard(structuredClone(made), 'B', 'coaches_challenge', {}));
    expect(getTeam(missed.game, 'A').assists).toBe(0);
    const stood = dice(20, () => execCard(structuredClone(made), 'B', 'coaches_challenge', {}));
    expect(getTeam(stood.game, 'A').assists).toBe(1);
  });

  it('Short-Roll Playmaker\'s assist on a paint make goes back with the make', () => {
    const g = game();
    g.tempEff.A = { paintAst0: 1 };
    g.pendingShotCheck = { teamKey: 'A', playerIdx: 0, type: 'paint', bonus: 0, cardLabel: 'Paint check' };
    const made = dice(20, () => resolvePendingShotCheck(g));
    expect(line(made, 'A', 'a0').ast).toBe(1);
    getTeam(made, 'B').hand = ['coaches_challenge'];
    const after = dice(1, () => execCard(made, 'B', 'coaches_challenge', {}));
    expect(after.ok).toBe(true);
    expect(getTeam(after.game, 'A').assists).toBe(0);
    expect(line(after.game, 'A', 'a0').ast).toBe(0);
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

  it('Box Out: the cancelled boards come off the roller\'s own line as well as the track', () => {
    const g = game({ hand: ['box_out'], who: 'B' });
    getTeam(g, 'A').rebounds = 2; getTeam(g, 'A').reboundsWon = 2;
    line(g, 'A', 'a1').reb = 2;
    g.lastRoll = { teamKey: 'A', idx: 1, reb: 2, ast: 0, pts: 3, boxed: false, deflected: false };
    const r = execCard(g, 'B', 'box_out', {});
    expect(r.ok).toBe(true);
    expect(line(r.game, 'A', 'a1').reb).toBe(0);
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
