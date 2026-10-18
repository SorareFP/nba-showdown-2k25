// A GAME THAT STARTS AT Q4 (The Climb, docs/plans/2026-10-18-the-climb.md,
// Task 3). A run game is one quarter — Q4 section 1 onward, crunch and
// overtime as any game has them — and each player walks on with the fatigue
// the run has left on his tracker. "The first section" is the game's own
// opening, not Q1's.
import { describe, it, expect } from 'vitest';
import { newGame, endSection, getFatigue, satOutLast, isOpeningSection, CRUNCH_MARGIN } from './engine.js';
import { canPlayCard } from './canPlay.js';
import { simulateGame } from './modes/simulate.js';
import { CARDS } from './cards.js';
import { climbRng } from './modes/climbMap.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 10, power: 10,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
const roster = prefix => Array.from({ length: 5 }, (_, i) => mk(`${prefix}${i}`));
const onFloor = g => {
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  return g;
};

describe('a game that starts at Q4', () => {
  it('opens at quarter 4, section 1, in the lineup phase', () => {
    const g = newGame(roster('a'), roster('b'), null, null, { startQuarter: 4 });
    expect(g.quarter).toBe(4);
    expect(g.section).toBe(1);
    expect(g.phase).toBe('draft');
    expect(isOpeningSection(g)).toBe(true);
    expect(isOpeningSection(newGame(roster('a'), roster('b')))).toBe(true);
  });

  it('puts the carried fatigue on the tracker, and the roll feels it', () => {
    const g = onFloor(newGame(roster('a'), roster('b'), null, null, { startQuarter: 4, fatigue: { A: { a0: 12 } } }));
    expect(g.teamA.stats.find(s => s.id === 'a0').minutes).toBe(12);
    expect(g.teamA.stats.find(s => s.id === 'a1').minutes).toBe(0);
    expect(getFatigue(g, 'A', 0)).toBe(-6);
    expect(getFatigue(g, 'A', 1)).toBe(0);
    expect(g.teamB.stats.every(s => s.minutes === 0)).toBe(true);
  });

  it('has nobody sitting out "last section" at its opening', () => {
    const g = onFloor(newGame(roster('a'), roster('b'), null, null, { startQuarter: 4 }));
    for (const p of g.teamA.roster) expect(satOutLast(g, 'A', p), p.id).toBe(false);
  });

  it('lets Second Wind find a carried-tired player in its opening section, and a normal game\'s still refuses', () => {
    const run = onFloor(newGame(roster('a'), roster('b'), null, null, { startQuarter: 4, fatigue: { A: { a0: 12 } } }));
    run.phase = 'matchup_strats';
    expect(canPlayCard(run, 'A', 'second_wind').canPlay).toBe(true);
    const plain = onFloor(newGame(roster('a'), roster('b')));
    plain.phase = 'matchup_strats';
    expect(canPlayCard(plain, 'A', 'second_wind').canPlay).toBe(false);
  });

  it('goes to overtime when tied after its third section', () => {
    const g = onFloor(newGame(roster('a'), roster('b'), null, null, { startQuarter: 4 }));
    g.section = 3; g.phase = 'scoring';
    g.teamA.score = 30; g.teamB.score = 30;
    const ot = endSection(g);
    expect(ot.done).toBe(false);
    expect(ot.overtime).toBe(1);
    g.teamB.score = 31;
    expect(endSection(g).done).toBe(true);
  });

  it('plays three sections when simulated, with crunch armed by the margin', () => {
    const a = CARDS.slice(0, 10);
    const b = CARDS.slice(10, 20);
    for (let seed = 1; seed <= 6; seed += 1) {
      const r = simulateGame(a, b, { rng: climbRng(seed, 'q4'), keepGame: true, gameOpts: { startQuarter: 4 } });
      expect(r.game.quarter, `seed ${seed}`).toBe(4);
      expect(r.sections, `seed ${seed}`).toBe(3 + (r.game.overtime || 0));
      expect(r.game.crunch, `seed ${seed}`).toBeTruthy();
      expect(r.game.crunch.active, `seed ${seed}`).toBe(r.game.crunch.margin <= CRUNCH_MARGIN);
      expect(r.game.done, `seed ${seed}`).toBe(true);
    }
  });
});
