// Crunch Time invariants — the recovered original rules (rules doc Section 9)
// plus the 2026-09-02 decisions, asserted at the engine seams.
import { describe, it, expect } from 'vitest';
import {
  newGame, endSection, doRoll, matchupContest, spendTimeout, endTimeout,
  clutchAvailable, clutchDiceFor, clutchEligible, CRUNCH_MARGIN, getPS,
} from './engine.js';
import { canPlayCard } from './canPlay.js';
import { execCard } from './execCard.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 10, power: 10,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});

const roster = prefix => Array.from({ length: 10 }, (_, i) => mk(`${prefix}${i}`));

function crunchGame(margin = 4, opts = {}) {
  const g = newGame(roster('a'), roster('b'), null, null, opts);
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.phase = 'scoring';
  g.quarter = 4;
  g.section = 3;
  g.teamA.score = 50;
  g.teamB.score = 50 + margin;
  g.crunch = { active: margin <= CRUNCH_MARGIN, margin, used: {}, extra: {}, timeoutUsed: {} };
  return g;
}

describe('the crunch window', () => {
  it('arms via endSection at Q4S3 only inside the margin', () => {
    const g = newGame(roster('a'), roster('b'));
    g.quarter = 4; g.section = 2; g.phase = 'scoring';
    g.teamA.starters = g.teamA.roster.slice(0, 5);
    g.teamB.starters = g.teamB.roster.slice(0, 5);
    g.teamA.score = 80; g.teamB.score = 80 + CRUNCH_MARGIN;
    const close = endSection(g);
    expect(close.quarter).toBe(4);
    expect(close.section).toBe(3);
    expect(close.crunch?.active).toBe(true);
    expect(close.crunch.margin).toBe(CRUNCH_MARGIN);

    g.teamB.score = 80 + CRUNCH_MARGIN + 1;
    const blowout = endSection(g);
    expect(blowout.crunch?.active).toBe(false);
  });

  it('gives Defensive-Bonus defenders +1 contest, and only them', () => {
    const g = crunchGame();
    g.teamB.starters[0] = mk('stopper', { defBoost: 3 });
    g.teamB.starters[1] = mk('sieve', { defBoost: 0 });
    // A's slot-0 attacker is guarded by B's slot-0 defender (identity matchups)
    expect(matchupContest(g, 'A', 0, '3pt')).toBe(4); // 3 + crunch intensity
    expect(matchupContest(g, 'A', 1, '3pt')).toBe(0); // no bonus, no intensity
    g.crunch.active = false;
    expect(matchupContest(g, 'A', 0, '3pt')).toBe(3);
  });
});

describe('clutch possessions', () => {
  it('counts dice from awards and spends the possession', () => {
    const g = crunchGame(4, { clutchDice: { a0: 2 } });
    expect(clutchAvailable(g, 'A')).toBe(1);
    expect(clutchDiceFor(g, g.teamA.starters[0])).toBe(4); // Shai's four
    expect(clutchDiceFor(g, g.teamA.starters[1])).toBe(2);
    const after = doRoll(g, 'A', 0, { clutch: true });
    expect(after.crunch.used.A).toBe(1);
    expect(clutchAvailable(after, 'A')).toBe(0);
    expect(after.log.some(l => /CLUTCH \(4 dice\)/.test(l.msg))).toBe(true);
    // A second attempt is an ordinary roll — no possession left.
    const again = doRoll(after, 'A', 1, { clutch: true });
    expect(again.crunch.used.A).toBe(1);
  });

  it('honors the fatigue gate', () => {
    const g = crunchGame();
    const ps = getPS(g, 'A', g.teamA.starters[0].id);
    ps.minutes = 12; // -6 on this scale = the original's -4 gate
    expect(clutchEligible(g, 'A', 0)).toBe(false);
    const after = doRoll(g, 'A', 0, { clutch: true });
    expect(after.crunch.used.A ?? 0).toBe(0); // rolled, but not clutch
  });

  it('Second Closer grants exactly one extra', () => {
    const g = crunchGame();
    g.teamA.hand = ['second_closer'];
    expect(canPlayCard(g, 'A', 'second_closer').canPlay).toBe(true);
    const { game: g2, ok } = execCard(g, 'A', 'second_closer', {});
    expect(ok).toBe(true);
    expect(clutchAvailable(g2, 'A')).toBe(2);
    expect(canPlayCard(g2, 'A', 'second_closer').canPlay).toBe(false);
  });
});

describe('the timeout and its riders', () => {
  it('is one per team, crunch only, and gates the riders to its window', () => {
    const g = crunchGame();
    g.teamA.hand = ['ato_masterpiece'];
    expect(canPlayCard(g, 'A', 'ato_masterpiece').canPlay).toBe(false); // no timeout yet
    const to = spendTimeout(g, 'A');
    expect(to.ok).toBe(true);
    expect(canPlayCard(to.game, 'A', 'ato_masterpiece').canPlay).toBe(true);
    // The OTHER team's riders stay closed during A's timeout.
    to.game.teamB.hand = ['ato_masterpiece'];
    expect(canPlayCard(to.game, 'B', 'ato_masterpiece').canPlay).toBe(false);
    // No second timeout, and none outside crunch.
    const resumed = endTimeout(to.game);
    expect(spendTimeout(resumed, 'A').ok).toBe(false);
    const cold = crunchGame(CRUNCH_MARGIN + 5);
    expect(spendTimeout(cold, 'A').ok).toBe(false);
  });

  it('Fresh Legs sheds four minutes from up to two players', () => {
    const g = crunchGame();
    g.timeoutActive = 'A';
    g.teamA.hand = ['fresh_legs'];
    getPS(g, 'A', g.teamA.starters[0].id).minutes = 10;
    getPS(g, 'A', g.teamA.starters[1].id).minutes = 3;
    const { game: g2, ok } = execCard(g, 'A', 'fresh_legs', { playerIdx: 0, player2Idx: 1 });
    expect(ok).toBe(true);
    expect(getPS(g2, 'A', g2.teamA.starters[0].id).minutes).toBe(6);
    expect(getPS(g2, 'A', g2.teamA.starters[1].id).minutes).toBe(0);
  });

  it('Ice and Reset move the markers they name', () => {
    const g = crunchGame();
    g.timeoutActive = 'A';
    g.teamA.hand = ['ice_the_hot_hand', 'reset'];
    getPS(g, 'B', g.teamB.starters[2].id).hot = 2;
    getPS(g, 'A', g.teamA.starters[1].id).cold = 3;
    const ice = execCard(g, 'A', 'ice_the_hot_hand', { targetIdx: 2 });
    expect(ice.ok).toBe(true);
    expect(getPS(ice.game, 'B', ice.game.teamB.starters[2].id).hot).toBe(0);
    const reset = execCard(ice.game, 'A', 'reset', { playerIdx: 1 });
    expect(reset.ok).toBe(true);
    expect(getPS(reset.game, 'A', reset.game.teamA.starters[1].id).cold).toBe(0);
  });
});

describe('desperation press', () => {
  it('is trailing-only and re-rolls exactly one top-tier roll', () => {
    const g = crunchGame(4); // A trails by 4
    g.teamA.hand = ['desperation_press'];
    g.teamB.hand = ['desperation_press'];
    expect(canPlayCard(g, 'A', 'desperation_press').canPlay).toBe(true);
    expect(canPlayCard(g, 'B', 'desperation_press').canPlay).toBe(false); // leading
    const { game: armed, ok } = execCard(g, 'A', 'desperation_press', {});
    expect(ok).toBe(true);
    expect(armed.pressArmed.B).toBe(1);
    // Every roll on the one-band fixture chart is top-tier, so the press
    // fires on B's next roll and is consumed.
    const rolled = doRoll(armed, 'B', 0);
    expect(rolled.pressArmed.B).toBe(0);
    expect(rolled.log.some(l => /PRESSED/.test(l.msg))).toBe(true);
    const second = doRoll(rolled, 'B', 1);
    expect(second.log.filter(l => /PRESSED/.test(l.msg)).length).toBe(1);
  });
});
