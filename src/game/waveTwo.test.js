// WAVE TWO of the strategy-card backlog — four of the six.
//
// The designs are the user's, recovered from the damaged docx
// (docs/strategy-cards-backlog-recovered.md) and confirmed card by card on
// 2026-09-07. Run the Floor and Twin Towers are NOT here: they persist across
// sections and their two checks are allocated by the OPPONENT, an interaction
// this game has never had, so they wait on a decision rather than a guess.
//
// What is worth testing about a card is its CONDITION and its payout, not that
// the engine can add. Each of these four has a gate that a real hand will hit.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { CARDS } from './cards.js';
import { execCard, applyShotCheck } from './execCard.js';
import { canPlayCard } from './canPlay.js';

const p = (name, speed, power, extra = {}) => ({
  ...CARDS[0], id: name, name, speed, power, defBoost: 0, salary: 800,
  threePtBoost: 0, paintBoost: 0, shotLine: 18, pos: 'SG', ...extra,
});

/** A scoring-phase game with named fives and a hand. */
function game({ hand = [], A, B, phase = 'scoring' } = {}) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'A').starters = A || [0, 1, 2, 3, 4].map(i => p(`a${i}`, 10, 10));
  getTeam(g, 'B').starters = B || [0, 1, 2, 3, 4].map(i => p(`b${i}`, 10, 10));
  getTeam(g, 'A').hand = hand;
  getTeam(g, 'B').hand = [];
  g.phase = phase;
  g.scoringTurn = 'A';
  g.matchupTurn = 'A';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.rollResults = { A: [], B: [] };
  g.tempEff = {}; g.tempDefEff = {};
  return g;
}

afterEach(() => vi.restoreAllMocks());

describe('Outside Pick', () => {
  it('refuses with nothing to discard, and spends a card when it has one', () => {
    expect(canPlayCard(game({ hand: ['outside_pick'] }), 'A', 'outside_pick').canPlay).toBe(false);
    const g = game({ hand: ['outside_pick', 'close_out'] });
    expect(canPlayCard(g, 'A', 'outside_pick').canPlay).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const r = execCard(g, 'A', 'outside_pick', { playerIdx: 0, discardId: 'close_out' });
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').hand).not.toContain('close_out');
    expect(r.game.log.some(e => /discards close out/.test(e.msg))).toBe(true);
  });

  it('shoots the three at +5 and pays an assist on the hit', () => {
    // A near-max die with +5 clears any line; the assist is the card's own.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const g = game({ hand: ['outside_pick', 'close_out'] });
    const before = getTeam(g, 'A').assists;
    const r = execCard(g, 'A', 'outside_pick', { playerIdx: 0, discardId: 'close_out' });
    const t = getTeam(r.game, 'A');
    expect(t.score).toBe(3);
    expect(t.assists).toBe(before + 1);
    expect(r.game.log.some(e => /Outside Pick.*3PT at \+5/.test(e.msg))).toBe(true);
  });
});

describe('Short-Roll Playmaker', () => {
  it('needs the 8/8 bar, which a lopsided star fails', () => {
    // Curry's shape: fast, slight. The card is for balanced players and this
    // is the point of the condition, not an accident of it.
    const lopsided = [p('curry', 18, 5), ...[1, 2, 3, 4].map(i => p(`a${i}`, 7, 7))];
    expect(canPlayCard(game({ hand: ['short_roll_playmaker'], A: lopsided, phase: 'matchup_strats' }), 'A', 'short_roll_playmaker').canPlay).toBe(false);
    const balanced = [p('big', 9, 12), ...[1, 2, 3, 4].map(i => p(`a${i}`, 7, 7))];
    expect(canPlayCard(game({ hand: ['short_roll_playmaker'], A: balanced, phase: 'matchup_strats' }), 'A', 'short_roll_playmaker').canPlay).toBe(true);
  });

  it('refuses a player who does not clear both numbers', () => {
    const A = [p('tall', 6, 18), p('quick', 16, 6), ...[2, 3, 4].map(i => p(`a${i}`, 9, 9))];
    const g = game({ hand: ['short_roll_playmaker'], A, phase: 'matchup_strats' });
    expect(execCard(g, 'A', 'short_roll_playmaker', { playerIdx: 0 }).ok).toBe(false);
    expect(execCard(g, 'A', 'short_roll_playmaker', { playerIdx: 1 }).ok).toBe(false);
    expect(execCard(g, 'A', 'short_roll_playmaker', { playerIdx: 2 }).ok).toBe(true);
  });

  it('pays +1 assist on a PAINT score and on nothing else', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const A = [p('roller', 10, 10), ...[1, 2, 3, 4].map(i => p(`a${i}`, 9, 9))];
    const g = execCard(game({ hand: ['short_roll_playmaker'], A, phase: 'matchup_strats' }), 'A', 'short_roll_playmaker', { playerIdx: 0 }).game;

    const paint = { ...g, teamA: { ...g.teamA } };
    const beforePaint = getTeam(paint, 'A').assists;
    applyShotCheck(paint, { teamKey: 'A', playerIdx: 0, type: 'paint', bonus: 0, cardLabel: 'test' });
    expect(getTeam(paint, 'A').assists).toBe(beforePaint + 1);

    // A three by the same player is not a paint score, so it pays nothing.
    const three = { ...g, teamA: { ...g.teamA } };
    const beforeThree = getTeam(three, 'A').assists;
    applyShotCheck(three, { teamKey: 'A', playerIdx: 0, type: '3pt', bonus: 0, cardLabel: 'test' });
    expect(getTeam(three, 'A').assists).toBe(beforeThree);
  });
});

describe('Pick-and-Roll Maestro', () => {
  const fastFive = () => [p('guard', 15, 8), ...[1, 2, 3, 4].map(i => p(`a${i}`, 9, 9))];

  it('needs a Speed 14+ ball-handler', () => {
    const slow = [1, 2, 3, 4, 5].map(i => p(`a${i}`, 13, 9));
    expect(canPlayCard(game({ hand: ['pick_and_roll_maestro'], A: slow, phase: 'matchup_strats' }), 'A', 'pick_and_roll_maestro').canPlay).toBe(false);
    expect(canPlayCard(game({ hand: ['pick_and_roll_maestro'], A: fastFive(), phase: 'matchup_strats' }), 'A', 'pick_and_roll_maestro').canPlay).toBe(true);
  });

  it('swaps the two defenders and checks only when the new one is 5+ slower', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    // Guard is 15. Slot 0 is guarded by b0 (Speed 14 — only 1 slower), slot 1
    // by b1 (Speed 6 — nine slower). Swapping buys the mismatch.
    const B = [p('b0', 14, 9), p('b1', 6, 9), ...[2, 3, 4].map(i => p(`b${i}`, 9, 9))];
    const g = game({ hand: ['pick_and_roll_maestro'], A: fastFive(), B, phase: 'matchup_strats' });
    const r = execCard(g, 'A', 'pick_and_roll_maestro', { playerIdx: 0, player2Idx: 1 });
    expect(r.ok).toBe(true);
    expect(r.game.offMatchups.A[0]).toBe(1); // now guarded by b1
    expect(r.game.offMatchups.A[1]).toBe(0); // and the teammate takes b0
    expect(r.game.log.some(e => /9 slower/.test(e.msg))).toBe(true);
    expect(getTeam(r.game, 'A').score).toBe(2);
  });

  it('still switches when the gap is short, and says so instead of checking', () => {
    // The swap is the card; the check is its reward. A swap that buys nothing
    // must still happen, or the card would be a free look at the matchups.
    const B = [p('b0', 12, 9), p('b1', 12, 9), ...[2, 3, 4].map(i => p(`b${i}`, 9, 9))];
    const g = game({ hand: ['pick_and_roll_maestro'], A: fastFive(), B, phase: 'matchup_strats' });
    const r = execCard(g, 'A', 'pick_and_roll_maestro', { playerIdx: 0, player2Idx: 1 });
    expect(r.ok).toBe(true);
    expect(r.game.offMatchups.A[0]).toBe(1);
    expect(getTeam(r.game, 'A').score).toBe(0);
    expect(r.game.log.some(e => /only 3 slower — no check/.test(e.msg))).toBe(true);
  });

  it('refuses without a teammate to trade with', () => {
    const g = game({ hand: ['pick_and_roll_maestro'], A: fastFive(), phase: 'matchup_strats' });
    expect(execCard(g, 'A', 'pick_and_roll_maestro', { playerIdx: 0 }).ok).toBe(false);
    expect(execCard(g, 'A', 'pick_and_roll_maestro', { playerIdx: 0, player2Idx: 0 }).ok).toBe(false);
  });
});

describe('Inside-Out', () => {
  it('is unplayable until one of YOUR players scores in the paint', () => {
    const g = game({ hand: ['inside_out'] });
    expect(canPlayCard(g, 'A', 'inside_out').canPlay).toBe(false);
    // The opponent scoring inside is not an invitation.
    g.lastPaintScore = { teamKey: 'B', playerIdx: 0, playerId: 'b0' };
    expect(canPlayCard(g, 'A', 'inside_out').canPlay).toBe(false);
    g.lastPaintScore = { teamKey: 'A', playerIdx: 2, playerId: 'a2' };
    expect(canPlayCard(g, 'A', 'inside_out').canPlay).toBe(true);
  });

  it('kicks out to a teammate, never back to the scorer', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const g = game({ hand: ['inside_out'] });
    g.lastPaintScore = { teamKey: 'A', playerIdx: 2, playerId: 'a2' };
    expect(execCard(g, 'A', 'inside_out', { playerIdx: 2, player2Idx: 2 }).ok).toBe(false);
    const r = execCard(g, 'A', 'inside_out', { playerIdx: 2, player2Idx: 3 });
    expect(r.ok).toBe(true);
    expect(r.game.log.some(e => /Inside-Out: kicked out to a3/.test(e.msg))).toBe(true);
  });

  it('spends the paint score, so a second copy cannot play off the same bucket', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const g = game({ hand: ['inside_out', 'inside_out'] });
    g.lastPaintScore = { teamKey: 'A', playerIdx: 2, playerId: 'a2' };
    const r = execCard(g, 'A', 'inside_out', { playerIdx: 2, player2Idx: 3 });
    expect(r.game.lastPaintScore).toBeNull();
    expect(canPlayCard(r.game, 'A', 'inside_out').canPlay).toBe(false);
  });
});

describe('the paint-score event itself', () => {
  it('is written by a paint hit and by nothing else', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const hit = game();
    applyShotCheck(hit, { teamKey: 'A', playerIdx: 1, type: 'paint', bonus: 0, cardLabel: 'test' });
    expect(hit.lastPaintScore).toMatchObject({ teamKey: 'A', playerIdx: 1 });

    const three = game();
    applyShotCheck(three, { teamKey: 'A', playerIdx: 1, type: '3pt', bonus: 0, cardLabel: 'test' });
    expect(three.lastPaintScore ?? null).toBeNull();
  });

  it('is not written by a paint MISS', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.001);
    const miss = game();
    applyShotCheck(miss, { teamKey: 'A', playerIdx: 1, type: 'paint', bonus: -20, cardLabel: 'test' });
    expect(miss.lastPaintScore ?? null).toBeNull();
  });
});
