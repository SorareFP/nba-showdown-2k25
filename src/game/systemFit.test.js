// IN SYSTEM (the Climb, 2026-10-20): a run's playbook pays the players who fit it.
import { describe, it, expect } from 'vitest';
import { SYSTEM_FIT, fitsSystem, systemLine } from './systemFit.js';
import { newGame, climbCheckParts, checkNeed } from './engine.js';
import { CLIMB, newRun, chooseCamp, chooseStop, openStops, presetFor } from './modes/run.js';
import { CARDS } from './cards.js';
import { cardKey } from './cardSets.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 10, power: 10,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
/** Slot 0 of A is a Speed 14 guard, slot 1 a Power 14 big; B's slot 0 a Defense +2 stopper. */
function board(system) {
  const a = [mk('a0', { speed: 14 }), mk('a1', { power: 14 }), mk('a2'), mk('a3'), mk('a4')];
  const b = [mk('b0', { defBoost: 2 }), mk('b1'), mk('b2'), mk('b3'), mk('b4')];
  const g = newGame(a, b, null, null, system ? { system } : {});
  g.teamA.starters = g.teamA.roster.slice(0, 5).map(p => ({ ...p }));
  g.teamB.starters = g.teamB.roster.slice(0, 5).map(p => ({ ...p }));
  return g;
}

describe('In System', () => {
  it('has one line a playbook asks for, and prints it', () => {
    expect(Object.keys(SYSTEM_FIT)).toEqual(['speed', 'paint', 'defense']);
    expect(fitsSystem('speed', { speed: 12 })).toBe(true);
    expect(fitsSystem('speed', { speed: 11 })).toBe(false);
    expect(fitsSystem('paint', { power: 12 })).toBe(true);
    expect(fitsSystem('defense', { defBoost: 1 })).toBe(true);
    expect(fitsSystem('defense', { defBoost: 0 })).toBe(false);
    expect(fitsSystem(null, { speed: 20 })).toBe(false);
    expect(systemLine('speed')).toBe('In System: Speed 12+, +1 on their shot checks');
  });

  it('gives a fitting shooter +1 on their shot checks, never a free throw', () => {
    const g = board({ A: 'speed' });
    expect(climbCheckParts(g, 'A', '3pt', 0)).toEqual([{ label: 'In System', n: 1 }]);
    expect(climbCheckParts(g, 'A', 'paint', 0)).toEqual([{ label: 'In System', n: 1 }]);
    expect(climbCheckParts(g, 'A', 'ft', 0)).toEqual([]);
    expect(climbCheckParts(g, 'A', '3pt', 1)).toEqual([]);   // Speed 10
    expect(climbCheckParts(g, 'B', '3pt', 0)).toEqual([]);   // the coach has no system
    expect(checkNeed(g, 'A', 0, '3pt').need).toBe(checkNeed(board(null), 'A', 0, '3pt').need - 1);
    const paint = board({ A: 'paint' });
    expect(climbCheckParts(paint, 'A', 'paint', 1)).toEqual([{ label: 'In System', n: 1 }]);
    expect(climbCheckParts(paint, 'A', 'paint', 0)).toEqual([]);
  });

  it('Defense makes the checks against a fitting defender −1', () => {
    const g = board({ B: 'defense' });
    // B's slot 0 (Defense +2) guards A's slot 0 by default.
    expect(climbCheckParts(g, 'A', '3pt', 0)).toEqual([{ label: 'Their system', n: -1 }]);
    expect(climbCheckParts(g, 'A', '3pt', 1)).toEqual([]);
    expect(climbCheckParts(g, 'A', 'ft', 0)).toEqual([]);
    // Who guards whom moves it: the stopper on A's slot 1 now.
    g.offMatchups = { A: [1, 0, 2, 3, 4] };
    expect(climbCheckParts(g, 'A', '3pt', 0)).toEqual([]);
    expect(climbCheckParts(g, 'A', '3pt', 1)).toEqual([{ label: 'Their system', n: -1 }]);
  });

  it('does nothing outside a run', () => {
    const g = board(null);
    expect(g.system).toBeNull();
    expect(climbCheckParts(g, 'A', '3pt', 0)).toEqual([]);
  });

  it('rides into every run game as the playbook, and the dial turns it off', () => {
    const FIVE = [...CARDS].sort((x, y) => x.salary - y.salary || x.id.localeCompare(y.id)).slice(100, 105);
    const r0 = newRun({ id: 'r1', seed: 42, rung: 'prince', rosterKeys: FIVE.map(cardKey), now: 1 });
    const run = chooseCamp(r0, { playbook: 'paint', boon: r0.camp.boons.find(b => b !== 'cut_two') });
    const at = chooseStop(run, openStops(run)[0].id);
    expect(presetFor(at).gameOpts.system).toEqual({ A: 'paint' });
    CLIMB.system = false;
    try {
      expect(presetFor(at).gameOpts.system).toBeUndefined();
    } finally {
      CLIMB.system = true;
    }
  });
});
