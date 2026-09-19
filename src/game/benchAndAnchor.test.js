// Two 2026-09-08 play-test fixes at the engine seams: who sat out last section
// is a flag, not "zero minutes" (halftime zeroes everyone); and Defensive
// Anchor doubles a defender's Defensive Bonus instead of asking for +3.
import { describe, it, expect } from 'vitest';
import { newGame, endSection, getPS, satOutLast, calcAdv, matchupContest, returnCardToDeck, lastReturnedCard, undoReturnCard } from './engine.js';
import { canPlayCard } from './canPlay.js';
import { execCard } from './execCard.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 10, power: 10,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
const roster = prefix => Array.from({ length: 10 }, (_, i) => mk(`${prefix}${i}`));

function scoringGame(quarter = 1, section = 1) {
  const g = newGame(roster('a'), roster('b'));
  g.quarter = quarter; g.section = section; g.phase = 'scoring';
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.rollResults = { A: [0, 1, 2, 3, 4].map(() => ({ pts: 1, reb: 0, ast: 0 })), B: [0, 1, 2, 3, 4].map(() => ({ pts: 1, reb: 0, ast: 0 })) };
  return g;
}

describe('who sat out last section', () => {
  it('is written for everyone at the section end: starters false, bench true', () => {
    const g = scoringGame(1, 1);
    const ng = endSection(g);
    for (let i = 0; i < 10; i += 1) {
      const ps = getPS(ng, 'A', `a${i}`);
      expect(ps.wasBenched).toBe(i >= 5);
    }
  });

  it('survives halftime: a player who played Q2S3 is not "benched" at Q3S1 even though minutes reset', () => {
    const g = scoringGame(2, 3);
    getPS(g, 'A', 'a0').minutes = 12;
    const ng = endSection(g);
    expect(ng.quarter).toBe(3);
    expect(getPS(ng, 'A', 'a0').minutes).toBe(0);          // halftime reset
    expect(satOutLast(ng, 'A', ng.teamA.roster[0])).toBe(false);
    expect(satOutLast(ng, 'A', ng.teamA.roster[7])).toBe(true);
    // Defensive Stopper needs a starter who actually sat: none of the five who played.
    ng.phase = 'matchup_strats'; ng.matchupTurn = 'A'; ng.placementStep = 10;
    ng.teamA.starters = ng.teamA.roster.slice(0, 5);
    ng.teamA.hand = ['defensive_stopper'];
    expect(canPlayCard(ng, 'A', 'defensive_stopper').canPlay).toBe(false);
    ng.teamA.starters = [ng.teamA.roster[7], ...ng.teamA.roster.slice(1, 5)];
    expect(canPlayCard(ng, 'A', 'defensive_stopper').canPlay).toBe(true);
    expect(execCard(ng, 'A', 'defensive_stopper', { playerIdx: 1 }).ok).toBe(false);   // a1 played
    expect(execCard(ng, 'A', 'defensive_stopper', { playerIdx: 0 }).ok).toBe(true);    // a7 sat
  });
});

describe('Defensive Anchor', () => {
  it('needs any positive Defensive Bonus and makes it count double, on the matchup and the contest', () => {
    const g = scoringGame(1, 2);
    g.phase = 'matchup_strats'; g.matchupTurn = 'A'; g.placementStep = 10;
    g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
    g.teamA.hand = ['defensive_anchor'];
    g.teamA.starters[0] = mk('wall', { defBoost: 2 });
    g.teamB.starters[0] = mk('flash', { speed: 14, power: 10 });   // Speed +4 on the wall
    expect(canPlayCard(g, 'A', 'defensive_anchor').canPlay).toBe(true);
    const before = calcAdv(g.teamB.starters[0], g.teamA.starters[0], {}, 0, g.tempDefEff?.A ?? null, 0);
    expect(before.rollBonus).toBe(2);                     // +4 less a +2 boost
    expect(matchupContest(g, 'B', 0, '3pt')).toBe(2);
    const { game: g2, ok } = execCard(g, 'A', 'defensive_anchor', { playerIdx: 0 });
    expect(ok).toBe(true);
    const after = calcAdv(g2.teamB.starters[0], g2.teamA.starters[0], {}, 0, g2.tempDefEff.A, 0);
    expect(after.rollBonus).toBe(0);                      // +4 less a doubled +4
    expect(matchupContest(g2, 'B', 0, '3pt')).toBe(4);
    expect(g2.log.at(-1).msg).toMatch(/Def \+2 counts double \(\+4\)/);
  });

  it('refuses a defender with no bonus', () => {
    const g = scoringGame(1, 2);
    g.phase = 'matchup_strats'; g.matchupTurn = 'A'; g.placementStep = 10;
    g.teamA.hand = ['defensive_anchor'];
    expect(canPlayCard(g, 'A', 'defensive_anchor').canPlay).toBe(false);
    expect(execCard(g, 'A', 'defensive_anchor', { playerIdx: 0 }).ok).toBe(false);
  });
});

describe('returning a card to the deck', () => {
  it('moves it from the hand to the bottom of the deck and logs it', () => {
    const g = scoringGame();
    g.teamA.hand = ['x1', 'x2', 'x3'];
    g.teamA.deck = ['d1', 'd2'];
    const ng = returnCardToDeck(g, 'A', 1);
    expect(ng.teamA.hand).toEqual(['x1', 'x3']);
    expect(ng.teamA.deck).toEqual(['x2', 'd1', 'd2']);
    expect(ng.log.at(-1).msg).toMatch(/returns .* to the bottom of the deck/);
    expect(returnCardToDeck(g, 'A', 9)).toBe(g);   // out of range: untouched
  });

  // THE UNDO (2026-09-11): "Just accidentally went to play a card and sent it
  // to the bottom of my deck."
  it('takes a put-back back into the hand, newest first, for the rest of the section', () => {
    const g = scoringGame();
    g.teamA.hand = ['x1', 'x2', 'x3'];
    g.teamA.deck = ['d1', 'd2'];
    let ng = returnCardToDeck(returnCardToDeck(g, 'A', 1), 'A', 0);   // x2, then x1
    expect(lastReturnedCard(ng, 'A').id).toBe('x1');
    ng = undoReturnCard(ng, 'A');
    expect(ng.teamA.hand).toEqual(['x3', 'x1']);
    expect(ng.teamA.deck).toEqual(['x2', 'd1', 'd2']);
    expect(ng.log.at(-1).msg).toMatch(/takes .* back into the hand/);
    ng = undoReturnCard(ng, 'A');
    expect(ng.teamA.hand).toEqual(['x3', 'x1', 'x2']);
    expect(ng.teamA.deck).toEqual(['d1', 'd2']);
    expect(lastReturnedCard(ng, 'A')).toBeNull();
    expect(undoReturnCard(ng, 'A')).toBe(ng);   // nothing left to take back: untouched
  });

  it('will not take one back once the section has moved on, the card is buried, or the game is over', () => {
    const g = scoringGame();
    g.teamA.hand = ['x1'];
    g.teamA.deck = ['d1'];
    const ng = returnCardToDeck(g, 'A', 0);
    expect(lastReturnedCard(ng, 'A')).not.toBeNull();
    expect(lastReturnedCard({ ...ng, section: ng.section + 1 }, 'A')).toBeNull();
    const buried = { ...ng, teamA: { ...ng.teamA, deck: ['crunch_card', ...ng.teamA.deck] } };
    expect(lastReturnedCard(buried, 'A')).toBeNull();
    expect(lastReturnedCard({ ...ng, done: true }, 'A')).toBeNull();
    expect(lastReturnedCard(ng, 'B')).toBeNull();   // the other side has nothing to take back
  });

  // OVERTIME IS A NEW SECTION FOR THE UNDO (2026-09-18). Overtime keeps Q4 S3,
  // so a put-back compared on quarter and section alone stayed undoable from
  // regulation's last section into overtime. The rule says "until the section
  // ends", and regulation has ended.
  it('a Q4 S3 put-back is not undoable in overtime; one put back inside overtime is, in that overtime only', () => {
    const g = scoringGame(4, 3);
    g.teamA.hand = ['x1', 'x2'];
    g.teamA.deck = Array.from({ length: 12 }, (_, i) => `d${i}`);   // enough that the refill never reaches x1
    const back = returnCardToDeck(g, 'A', 0);
    expect(lastReturnedCard(back, 'A').id).toBe('x1');
    back.teamA.score = 50; back.teamB.score = 50;
    const ot = endSection(back);
    expect([ot.quarter, ot.section, ot.overtime]).toEqual([4, 3, 1]);
    expect(ot.teamA.deck[0]).toBe('x1');           // still the deck bottom, still refused
    expect(lastReturnedCard(ot, 'A')).toBeNull();
    expect(undoReturnCard(ot, 'A')).toBe(ot);

    const hand = ot.teamA.hand.slice();
    const inOt = returnCardToDeck(ot, 'A', 0);
    expect(inOt.teamA.returned.at(-1)).toMatchObject({ quarter: 4, section: 3, overtime: 1 });
    expect(lastReturnedCard(inOt, 'A').id).toBe(hand[0]);
    expect(undoReturnCard(inOt, 'A').teamA.hand).toContain(hand[0]);
    expect(lastReturnedCard({ ...inOt, overtime: 2 }, 'A')).toBeNull();   // the next overtime is another section
  });
});

// THE REST RULE AT THE SECTION END. A section on the bench clears the
// tracker at or under eight minutes and takes four off above it — the
// original rule, restored 2026-09-16 (the user: "12 rests to 8 and then 8
// rests to 0"). On 2026-09-10 the section end and the paper rule were found
// on different numbers, which is why this pins the section end to
// restMinutes rather than to a literal.
describe('the rest rule at the section end', () => {
  it('rests a benched player by the rule — 12 to 8, 8 to 0 — clears his markers, and adds four to a starter', () => {
    const g = scoringGame(1, 1);                       // a0-a4 played, a5-a9 sat
    Object.assign(getPS(g, 'A', 'a7'), { minutes: 12, hot: 2 });
    getPS(g, 'A', 'a8').minutes = 8;
    getPS(g, 'A', 'a9').minutes = 4;
    getPS(g, 'A', 'a0').minutes = 8;
    const ng = endSection(g);
    expect(getPS(ng, 'A', 'a7')).toMatchObject({ minutes: 8, hot: 0, cold: 0 });   // 12 -> 8: still −2
    expect(getPS(ng, 'A', 'a8').minutes).toBe(0);                                 // 8 -> 0: fresh again
    expect(getPS(ng, 'A', 'a9').minutes).toBe(0);
    expect(getPS(ng, 'A', 'a0').minutes).toBe(12);                                // a section of play: +4
  });
});
