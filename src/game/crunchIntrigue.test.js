// TWO CARDS FOR THE END OF THE GAME (the user, 2026-09-12).
//
//   Hack-A-____ — "skip an opposing player's scoring roll and make them shoot
//     4 FTs instead." Crunch-only. The dilemma is the real one: an FT check is
//     d20 + 10 against the shot line, so four of them pay about 3.4 points off
//     a 14 line and about 2.2 off a 19 — hack the wrong man and you have
//     handed him the game.
//   Foul Trouble — "forces a player to the bench next segment." Enforced where
//     the next section's five are chosen, so the picker, the coach and the
//     simulator all obey one filter.
import { describe, it, expect } from 'vitest';
import { newGame, endSection, getTeam, CRUNCH_MARGIN } from './engine.js';
import { canPlayCard, foulTroubleTargets } from './canPlay.js';
import { execCard } from './execCard.js';
import { aiBuildCardOpts } from './ai.js';
import { CRUNCH_CARDS } from './strats.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 10, power: 10,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
const roster = (prefix, n = 10, over = {}) =>
  Array.from({ length: n }, (_, i) => mk(`${prefix}${i}`, over));

/** A game in the scoring phase with identity matchups and both hands set. */
function board({ a = roster('a'), b = roster('b'), aHand = [], bHand = [] } = {}) {
  const g = newGame(a, b);
  getTeam(g, 'A').starters = a.slice(0, 5);
  getTeam(g, 'B').starters = b.slice(0, 5);
  getTeam(g, 'A').hand = aHand;
  getTeam(g, 'B').hand = bHand;
  g.phase = 'scoring';
  g.scoringTurn = 'A'; g.scoringPasses = 0; g.placementStep = 10;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.rollResults = { A: [], B: [] };
  return g;
}

/** …and the clock at the final section, inside the margin. */
function crunch(g, margin = 4) {
  g.quarter = 4; g.section = 3;
  g.teamA.score = 60; g.teamB.score = 60 + margin;
  g.crunch = { active: margin <= CRUNCH_MARGIN, margin, used: {}, extra: {}, timeoutUsed: {}, searched: {} };
  return g;
}

describe('Hack-A-____', () => {
  it('only exists in crunch time', () => {
    const g = board({ aHand: ['hack_a'] });
    expect(CRUNCH_CARDS).toContain('hack_a');
    expect(canPlayCard(g, 'A', 'hack_a').canPlay).toBe(false);
    expect(canPlayCard(crunch(g), 'A', 'hack_a').canPlay).toBe(true);
  });

  it('takes the roll away and sends him to the line four times', () => {
    const g = crunch(board({ aHand: ['hack_a'] }));
    const r = execCard(g, 'A', 'hack_a', { targetIdx: 2 });
    expect(r.ok).toBe(true);
    // His scoring roll is gone, the same way This Is My House takes one.
    expect(r.game.blockedRolls.B[2]).toBe(true);
    // Four free throws, resolved on the spot: a free throw never pauses.
    expect(r.game.pendingShotCheck).toBe(null);
    const lines = r.game.log.filter(l => /Hack-A: /.test(l.msg));
    expect(lines).toHaveLength(4);
    expect(r.game.log.some(l => /HACK-A-B2!/.test(l.msg))).toBe(true);
  });

  it('pays the points to the man who shot them, not the man who fouled', () => {
    // A shot line of 4 makes every free throw: d20 + 10 clears it always.
    const b = roster('b'); b[2] = mk('b2', { shotLine: 4 });
    const g = crunch(board({ b, aHand: ['hack_a'] }));
    const before = { a: g.teamA.score, b: g.teamB.score };
    const after = execCard(g, 'A', 'hack_a', { targetIdx: 2 }).game;
    expect(after.teamB.score - before.b).toBe(4);
    expect(after.teamA.score).toBe(before.a);
    // And on his own line, so the box score and the plus-minus agree.
    const ps = after.teamB.stats.find(s => s.id === 'b2');
    expect(ps.pts).toBe(4);
  });

  it('is worth nothing against a shooter and everything against a brick', () => {
    // Same chart, opposite lines: the coach hacks the one who cannot shoot.
    const b = roster('b');
    b[1] = mk('b1', { shotLine: 4 });    // makes all four
    b[3] = mk('b3', { shotLine: 20 });   // needs a 10+
    const g = crunch(board({ b, aHand: ['hack_a'] }));
    expect(aiBuildCardOpts(g, 'A', 'hack_a').targetIdx).toBe(3);
  });

  it('will not foul a man who has already gone to work', () => {
    const g = crunch(board({ aHand: ['hack_a'] }));
    g.rollResults.B[2] = { die: 12, pts: 3 };
    expect(execCard(g, 'A', 'hack_a', { targetIdx: 2 }).ok).toBe(false);
    // The card itself stays lit while anyone else is still to roll.
    expect(canPlayCard(g, 'A', 'hack_a').canPlay).toBe(true);
    g.teamB.starters.forEach((_, i) => { g.rollResults.B[i] = { die: 5, pts: 1 }; });
    expect(canPlayCard(g, 'A', 'hack_a').canPlay).toBe(false);
  });
});

describe('Foul Trouble', () => {
  /** A's slot-0 attacker beats B's slot-0 defender by 6 on Power. */
  const mismatch = (extra = {}) => {
    const a = roster('a'); a[0] = mk('a0', { power: 16 });
    const b = roster('b', extra.bench ?? 10); b[0] = mk('b0', { power: 10 });
    return board({ a, b, aHand: ['foul_trouble'] });
  };

  it('needs a defender who is actually being beaten', () => {
    const even = board({ aHand: ['foul_trouble'] });
    const check = canPlayCard(even, 'A', 'foul_trouble');
    expect(check.canPlay).toBe(false);
    expect(check.reason).toMatch(/beating their defender/);

    const g = mismatch();
    expect(canPlayCard(g, 'A', 'foul_trouble').canPlay).toBe(true);
    expect(foulTroubleTargets(g, 'A').map(t => t.defIdx)).toEqual([0]);
  });

  it('sits him for the next section, and only the next one', () => {
    const g = mismatch();
    const played = execCard(g, 'A', 'foul_trouble', { defIdx: 0 }).game;
    expect(played.foulTrouble.B).toEqual(['b0']);
    expect(played.teamB.starters.map(p => p.id)).toContain('b0'); // still on now

    const next = endSection(played);
    expect(next.draft.bPool.map(p => p.id)).not.toContain('b0');
    expect(next.draft.aPool).toHaveLength(10);
    expect(next.log.some(l => /b0 is in foul trouble/.test(l.msg))).toBe(true);
    // The debt is paid once: he is back in the pool the section after.
    expect(next.foulTrouble.B).toEqual([]);
    next.teamA.starters = next.teamA.roster.slice(0, 5);
    next.teamB.starters = next.teamB.roster.slice(0, 5);
    expect(endSection(next).draft.bPool.map(p => p.id)).toContain('b0');
  });

  it('refuses when there is no next section to sit', () => {
    const g = crunch(mismatch());
    const check = canPlayCard(g, 'A', 'foul_trouble');
    expect(check.canPlay).toBe(false);
    expect(check.reason).toMatch(/No section left/);
  });

  it('refuses when the opponent has nobody to replace him', () => {
    const g = mismatch({ bench: 5 });
    const check = canPlayCard(g, 'A', 'foul_trouble');
    expect(check.canPlay).toBe(false);
    expect(check.reason).toMatch(/no bench/);
  });

  it('sends the most valuable of the beaten defenders to the bench', () => {
    const a = roster('a');
    a[0] = mk('a0', { power: 16 });
    a[1] = mk('a1', { power: 16 });
    const b = roster('b');
    b[0] = mk('b0', { power: 10, chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }] });
    b[1] = mk('b1', { power: 10, chart: [{ lo: 1, hi: 99, pts: 6, reb: 2, ast: 2 }] });
    const g = board({ a, b, aHand: ['foul_trouble'] });
    expect(foulTroubleTargets(g, 'A')).toHaveLength(2);
    expect(aiBuildCardOpts(g, 'A', 'foul_trouble').defIdx).toBe(1);
  });
});
