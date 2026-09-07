// HELP DEFENDER — the answer to a mismatch you are stuck with.
//
// The docx draft could never fire (it asked for "a teammate not yet matched
// up", and the placement snake matches all five). The user approved this
// shape on 2026-09-07: a second defender rotates over for one possession,
// the mismatch loses its edge, and the man the helper left is open.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { newGame, getTeam, doRoll } from './engine.js';
import { CARDS } from './cards.js';
import { execCard } from './execCard.js';
import { canPlayCard, helpTargets } from './canPlay.js';
import { aiBuildCardOpts } from './ai.js';

const p = (name, speed, power, extra = {}) => ({
  ...CARDS[0], id: name, name, speed, power, defBoost: 0, salary: 800,
  threePtBoost: 0, paintBoost: 0, shotLine: 18, pos: 'SG', ...extra,
});
const five = prefix => [0, 1, 2, 3, 4].map(i => p(`${prefix}${i}`, 10, 10));

/** A is on defence; B has a star in slot 0 beating his man by +5 Speed. */
function game({ mismatch = 5, hand = ['help_defender'] } = {}) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  const A = five('d');            // my defenders
  const B = five('o');            // their attackers
  B[0] = p('star', 10 + mismatch, 10);
  getTeam(g, 'A').starters = A;
  getTeam(g, 'B').starters = B;
  getTeam(g, 'A').hand = hand;
  getTeam(g, 'B').hand = [];
  g.phase = 'scoring';
  g.scoringTurn = 'A';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.rollResults = { A: [], B: [] };
  g.tempEff = {}; g.tempDefEff = {};
  return g;
}

afterEach(() => vi.restoreAllMocks());

describe('helpTargets', () => {
  it('finds only opponents yet to roll who are beating their man by +4', () => {
    const g = game({ mismatch: 5 });
    const t = helpTargets(g, 'A');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ offSlot: 0, defIdx: 0, adv: 5 });
    expect(t[0].off.name).toBe('star');
  });

  it('ignores a mismatch under +4, and one who has already rolled', () => {
    expect(helpTargets(game({ mismatch: 3 }), 'A')).toHaveLength(0);
    const rolled = game({ mismatch: 5 });
    rolled.rollResults.B[0] = { pts: 3 };
    expect(helpTargets(rolled, 'A')).toHaveLength(0);
  });
});

describe('playability', () => {
  it('lights only when there is a mismatch to help on, in the scoring phase', () => {
    const g = game({ mismatch: 5 });
    expect(canPlayCard(g, 'A', 'help_defender').canPlay).toBe(true);
    expect(canPlayCard(game({ mismatch: 2 }), 'A', 'help_defender').canPlay).toBe(false);
    const matchup = { ...g, phase: 'matchup_strats' };
    expect(canPlayCard(matchup, 'A', 'help_defender').canPlay).toBe(false);
  });
});

describe('the effect', () => {
  it('kills the attacker\'s edge and opens the man the helper left', () => {
    const g = game();
    // Defender 3 rotates over; he was guarding B's slot 3.
    const r = execCard(g, 'A', 'help_defender', { targetIdx: 0, helperIdx: 3 });
    expect(r.ok).toBe(true);
    expect(r.game.tempDefEff.A[0].anchor).toBe(true);
    expect(r.game.tempEff.B.r3).toBe(3);
    const line = r.game.log.find(e => e.msg.startsWith('Help Defender'));
    expect(line.msg).toContain('d3 rotates onto star');
    expect(line.msg).toContain('o3 is open');
  });

  it('actually zeroes the mismatch on the roll, and pays the open man', () => {
    const g = execCard(game(), 'A', 'help_defender', { targetIdx: 0, helperIdx: 3 }).game;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // The star's +5 edge is gone.
    expect(doRoll({ ...g, scoringTurn: 'B' }, 'B', 0).rollResults.B[0].bonus).toBe(0);
    // And the man left open carries +3.
    expect(doRoll({ ...g, scoringTurn: 'B' }, 'B', 3).rollResults.B[3].bonus).toBe(3);
  });

  it('refuses the defender who is already on him, and a missing helper', () => {
    const g = game();
    expect(execCard(g, 'A', 'help_defender', { targetIdx: 0, helperIdx: 0 }).msg).toMatch(/already guarding/);
    expect(execCard(g, 'A', 'help_defender', { targetIdx: 0 }).msg).toMatch(/Choose which defender/);
    expect(execCard(game({ mismatch: 1 }), 'A', 'help_defender', { targetIdx: 0, helperIdx: 2 }).ok).toBe(false);
  });

  it('leaves the assignments alone — it is help, not a switch', () => {
    const g = game();
    const before = [...g.offMatchups.B];
    const r = execCard(g, 'A', 'help_defender', { targetIdx: 0, helperIdx: 2 });
    expect(r.game.offMatchups.B).toEqual(before);
    expect(r.game.lastDefSwitch ?? null).toBeNull();
  });
});

describe('the AI', () => {
  it('helps on the worst mismatch and leaves the least dangerous man open', () => {
    const g = game();
    const opts = aiBuildCardOpts(g, 'A', 'help_defender');
    expect(opts.targetIdx).toBe(0);
    expect(opts.helperIdx).not.toBe(0);
    expect(execCard(g, 'A', 'help_defender', opts).ok).toBe(true);
  });

  it('hands back nothing when there is no mismatch, rather than a bad play', () => {
    expect(aiBuildCardOpts(game({ mismatch: 1 }), 'A', 'help_defender')).toEqual({});
  });
});
