// EVERY CARD-CUED CHECK IS ANNOUNCED — but the game only stops when the
// defence can actually answer it.
//
// The user's rule, 2026-09-07: "Every card that cues a shot check of any sort
// would be 'announcing' one. The game should only stop if there's an
// oppositional card in the other player's hand that can be played."
import { describe, it, expect, vi, afterEach } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { CARDS } from './cards.js';
import { execCard, resolvePendingShotCheck, announceCheck } from './execCard.js';
import { canAnswerCheck } from './canPlay.js';

const p = (name, speed, power, extra = {}) => ({
  ...CARDS[0], id: name, name, speed, power, defBoost: 0, salary: 800,
  threePtBoost: 0, paintBoost: 0, shotLine: 18, pos: 'SG', ...extra,
});
const five = prefix => [0, 1, 2, 3, 4].map(i => p(`${prefix}${i}`, 10, 10));

function game({ hand = [], defHand = [], A, B } = {}) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'A').starters = A || five('a');
  getTeam(g, 'B').starters = B || five('b');
  getTeam(g, 'A').hand = hand;
  getTeam(g, 'B').hand = defHand;
  g.phase = 'scoring';
  g.scoringTurn = 'A';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.rollResults = { A: [], B: [] };
  g.tempEff = {}; g.tempDefEff = {};
  return g;
}
const check = extra => ({ teamKey: 'A', playerIdx: 0, type: '3pt', bonus: 0, cardLabel: 'Test', ...extra });

afterEach(() => vi.restoreAllMocks());

describe('canAnswerCheck', () => {
  it('is false on an empty hand, and on a hand with nothing that applies', () => {
    expect(canAnswerCheck(game(), check())).toBe(false);
    // Rim Protector answers a PAINT check, not a three.
    const g = game({ defHand: ['rim_protector'], B: [p('wall', 10, 13, { defBoost: 3 }), ...five('b').slice(1)] });
    expect(canAnswerCheck(g, check({ type: '3pt' }))).toBe(false);
    expect(canAnswerCheck(g, check({ type: 'paint' }))).toBe(true);
  });

  it('is false when the card is held but its own conditions fail', () => {
    // Rim Protector needs Power + Defensive Bonus of 15 on the man guarding him.
    const weak = game({ defHand: ['rim_protector'], B: [p('small', 10, 8), ...five('b').slice(1)] });
    expect(canAnswerCheck(weak, check({ type: 'paint' }))).toBe(false);
  });

  it('is never true for a free throw', () => {
    const g = game({ defHand: ['close_out'] });
    expect(canAnswerCheck(g, check({ type: 'ft' }))).toBe(false);
  });
});

describe('announceCheck', () => {
  it('resolves on the spot when nobody can answer, and pauses when they can', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const quiet = game();
    expect(announceCheck(quiet, check())).toBe(false);
    expect(quiet.pendingShotCheck).toBeNull();
    expect(quiet.log.some(e => e.msg.startsWith('Test:'))).toBe(true);

    const armed = game({ defHand: ['close_out'] });
    expect(announceCheck(armed, check())).toBe(true);
    expect(armed.pendingShotCheck).toMatchObject({ cardLabel: 'Test' });
    expect(armed.log.some(e => e.msg.startsWith('Test:'))).toBe(false);
  });

  it('runs a whole chain when nobody can answer', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const g = game();
    announceCheck(g, check({ cardLabel: 'One', then: [{ cardLabel: 'Two' }, { cardLabel: 'Three' }] }));
    expect(g.log.filter(e => /^(One|Two|Three):/.test(e.msg))).toHaveLength(3);
    expect(g.pendingShotCheck).toBeNull();
  });

  it('pauses mid-chain and picks the rest up on resolve', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const g = game({ defHand: ['close_out'] });
    announceCheck(g, check({ cardLabel: 'One', then: [{ cardLabel: 'Two' }] }));
    expect(g.pendingShotCheck).toMatchObject({ cardLabel: 'One' });
    expect(g.pendingShotCheck.then).toHaveLength(1);
    // The defence answers, the check resolves, and the SECOND one follows —
    // with the hand now empty of answers, straight through.
    const after = resolvePendingShotCheck({ ...g, teamB: { ...g.teamB, hand: [] } });
    expect(after.pendingShotCheck).toBeNull();
    expect(after.log.filter(e => /^(One|Two):/.test(e.msg))).toHaveLength(2);
  });

  it('does not carry one check\'s answer onto the next', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const g = game({ defHand: ['close_out'] });
    announceCheck(g, check({ cardLabel: 'One', then: [{ cardLabel: 'Two' }] }));
    g.pendingShotCheck.closeOutBonus = -3;
    g.pendingShotCheck.reacted = 'B';
    const after = resolvePendingShotCheck({ ...g, teamB: { ...g.teamB, hand: [] } });
    expect(after.pendingShotCheck).toBeNull();
    // The Close Out belonged to the FIRST check. The second inherits nothing:
    // its line is clean, whatever happened to the first.
    const second = after.log.find(e => e.msg.startsWith('Two:'));
    expect(second).toBeTruthy();
    expect(second.msg).not.toContain('Close Out');
  });
});

describe('the cards themselves', () => {
  it('Green Light fires three threes and replaces the roll', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const A = five('a'); A[0] = p('shooter', 10, 10, { threePtBoost: 3 });
    const r = execCard(game({ A, hand: ['green_light'] }), 'A', 'green_light', { playerIdx: 0 });
    expect(r.ok).toBe(true);
    expect(r.game.log.filter(e => e.msg.startsWith('Green Light'))).toHaveLength(3);
    expect(r.game.rollResults.A[0]).toMatchObject({ isReplaced: true, replacedBy: 'green_light' });
  });

  it('Green Light stops after the first check when the defence can answer', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const A = five('a'); A[0] = p('shooter', 10, 10, { threePtBoost: 3 });
    const g = game({ A, hand: ['green_light'], defHand: ['close_out'] });
    const r = execCard(g, 'A', 'green_light', { playerIdx: 0 });
    expect(r.game.pendingShotCheck).toMatchObject({ cardLabel: 'Green Light #1' });
    expect(r.game.pendingShotCheck.then).toHaveLength(2);
    expect(r.game.rollResults.A[0] ?? null).toBeNull();
    // Resolving with the hand spent runs the remaining two and writes the roll.
    const done = resolvePendingShotCheck({ ...r.game, teamB: { ...r.game.teamB, hand: [] } });
    expect(done.log.filter(e => e.msg.startsWith('Green Light'))).toHaveLength(3);
    expect(done.rollResults.A[0]).toMatchObject({ isReplaced: true });
  });

  it('a free throw is never interrupted, however armed the defence is', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const A = five('a'); A[0] = p('slasher', 16, 10);
    const g = game({ A, hand: ['drive_the_lane'], defHand: ['close_out', 'rim_protector'] });
    const r = execCard(g, 'A', 'drive_the_lane', { playerIdx: 0 });
    expect(r.ok).toBe(true);
    expect(r.game.pendingShotCheck).toBeNull();
  });
});
