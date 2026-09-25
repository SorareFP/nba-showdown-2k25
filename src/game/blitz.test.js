// BLITZ (2026-09-25). The user: "We need a reaction strategy card that forces
// the offense to select another shooter for an already-announced shot check",
// and of the design: "This is all perfect". Each rule it was approved with is
// pinned here.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { execCard, resolvePendingShotCheck, resolveChoice } from './execCard.js';
import { canPlayCard, blitzSlots } from './canPlay.js';
import { aiChoice, aiReactionDecision, blitzSaves, BLITZ_MIN_SAVE } from './ai.js';
import { getStrat } from './strats.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'F', speed: 10, power: 10, defBoost: 0,
  shotLine: 16, paintBoost: 0, threePtBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }], ...over,
});
/** A's a0 is the star shooter (3PT +6), a2 the next best (+2); B holds Blitz and Close Out. */
function game() {
  const g = newGame(
    Array.from({ length: 10 }, (_, i) => mk(`a${i}`, i === 0 ? { threePtBoost: 6 } : i === 2 ? { threePtBoost: 2 } : {})),
    Array.from({ length: 10 }, (_, i) => mk(`b${i}`)),
  );
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.phase = 'scoring'; g.scoringPasses = 99; g.scoringTurn = 'A';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.teamA.hand = ['elevator_doors', 'five_out'];
  g.teamB.hand = ['blitz', 'close_out'];
  return g;
}
/** A announces Elevator Doors' 3PT check (card +3) on a0: paused, since B can answer. */
function announced(cardId = 'elevator_doors') {
  const r = execCard(game(), 'A', cardId, { playerIdx: 0 });
  expect(r.ok).toBe(true);
  expect(r.game.pendingShotCheck).toMatchObject({ teamKey: 'A', playerIdx: 0, type: '3pt' });
  return r.game;
}
afterEach(() => vi.restoreAllMocks());

describe('Blitz', () => {
  it('is the approved card: a defensive reaction, uncommon, two copies', () => {
    expect(getStrat('blitz')).toMatchObject({ phase: 'reaction', side: 'def', rarity: 'uncommon', copies: 2 });
  });

  it('answers only the other side\'s 3PT or paint check, once, and never a free throw', () => {
    const g = announced();
    expect(canPlayCard(g, 'B', 'blitz').canPlay).toBe(true);
    expect(canPlayCard(g, 'A', 'blitz').canPlay).toBe(false);
    const ft = { ...g, pendingShotCheck: { ...g.pendingShotCheck, type: 'ft' } };
    expect(canPlayCard(ft, 'B', 'blitz').canPlay).toBe(false);
    const done = execCard(g, 'B', 'blitz', {}).game;
    const twice = { ...resolveChoice(done, 2).game };
    twice.teamB.hand = [...twice.teamB.hand, 'blitz'];
    expect(canPlayCard(twice, 'B', 'blitz').canPlay).toBe(false);
  });

  it('holds the check until the offense names someone else on the floor', () => {
    const g = execCard(announced(), 'B', 'blitz', {}).game;
    expect(g.pendingChoice).toMatchObject({ kind: 'blitz', teamKey: 'A', from: 0 });
    expect(g.pendingChoice.slots).toEqual([1, 2, 3, 4]);
    expect(blitzSlots(g)).toEqual([1, 2, 3, 4]);
    expect(resolvePendingShotCheck(g)).toBe(g);                         // no die yet
    expect(canPlayCard(g, 'B', 'close_out').canPlay).toBe(false);       // answers wait for the pick
    expect(resolveChoice(g, 0).ok).toBe(false);                         // not the man blitzed
    const picked = resolveChoice(g, 2).game;
    expect(picked.pendingChoice).toBeNull();
    expect(picked.pendingShotCheck).toMatchObject({ playerIdx: 2, blitzFrom: 0, bonus: 3, type: '3pt' });
  });

  it('keeps the card bonus, and the new shooter makes or misses it', () => {
    const picked = resolveChoice(execCard(announced(), 'B', 'blitz', {}).game, 2).game;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);                      // an 11: +3 card +2 3PT = 16, the line
    const done = resolvePendingShotCheck(picked);
    const a2 = getTeam(done, 'A').stats.find(s => s.id === 'a2');
    const a0 = getTeam(done, 'A').stats.find(s => s.id === 'a0');
    expect(a2.pts).toBe(3);
    expect(a0.pts ?? 0).toBe(0);
  });

  it('stacks with Close Out, which then lands on the new shooter', () => {
    let g = resolveChoice(execCard(announced(), 'B', 'blitz', {}).game, 2).game;
    expect(canPlayCard(g, 'B', 'close_out').canPlay).toBe(true);
    g = execCard(g, 'B', 'close_out', {}).game;
    expect(g.pendingShotCheck).toMatchObject({ playerIdx: 2, closeOutBonus: -3 });
    // and in the other order: Close Out first, Blitz still legal
    const first = execCard(announced(), 'B', 'close_out', {}).game;
    expect(canPlayCard(first, 'B', 'blitz').canPlay).toBe(true);
  });

  it('moves only the check just announced: the rest of the chain goes back, and the spent roll stays the original man\'s', () => {
    let g = announced('five_out');
    g = resolveChoice(execCard(g, 'B', 'blitz', {}).game, 2).game;
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    g = resolvePendingShotCheck(g);
    // B still holds Close Out, so the second check pauses — on a0 again.
    expect(g.pendingShotCheck).toMatchObject({ playerIdx: 0 });
    expect(g.pendingShotCheck.blitzFrom).toBeUndefined();
    g = resolvePendingShotCheck(g);
    expect(g.rollResults.A[0]).toMatchObject({ isReplaced: true });
    expect(g.rollResults.A[2]).toBeUndefined();
  });
});

describe('the coach and Blitz', () => {
  it('as the offense, hands the check to its best other shooter', () => {
    const g = execCard(announced(), 'B', 'blitz', {}).game;
    expect(aiChoice(g, 'A')).toBe(2);
  });

  it('as the defense, blitzes a star shooter and keeps it against an even line-up', () => {
    const g = announced();
    expect(blitzSaves(g, 'B')).toBeCloseTo(3 * (6 - 2) / 20, 5);         // +6 to +2: 20% of a three
    expect(blitzSaves(g, 'B')).toBeGreaterThanOrEqual(BLITZ_MIN_SAVE);
    expect(aiReactionDecision(g, 'B', 'shot_check')).toMatchObject({ type: 'play_card', cardId: 'blitz' });
    const even = execCard({ ...game(), teamA: { ...game().teamA, starters: game().teamA.starters.map(p => ({ ...p, threePtBoost: 2 })) } }, 'A', 'elevator_doors', { playerIdx: 0 }).game;
    expect(blitzSaves(even, 'B')).toBe(0);
    expect(aiReactionDecision(even, 'B', 'shot_check')?.cardId).not.toBe('blitz');
  });
});
