// Who leads the placement snake, and how sharp the coach is when it answers.
//
// The user (2026-09-09): "putting the first player on the board is a
// disadvantage" — so in a season the VISITOR places first and the home side
// answers; and the coach's matchup IQ is the first difficulty lever, from
// Settler (random) to Deity (the full search).
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { aiPlacementPick, placementChoices } from './ai.js';
import { AI_LEVELS, iqOf, levelById, loadAiLevel, saveAiLevel, DEFAULT_AI_LEVEL } from './aiLevels.js';
import { simulateGame } from './modes/simulate.js';
import { CARDS } from './cards.js';

const mk = (id, speed, power, { base = 4, slope = 0.25 } = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed, power, defBoost: 0, salary: 500,
  shotLine: 14, paintBoost: 1, threePtBoost: 1,
  chart: Array.from({ length: 40 }, (_, i) => ({ lo: i + 1, hi: i + 1, pts: Math.max(0, base + slope * (i - 10)), reb: 0, ast: 0 })),
});

describe('who places first', () => {
  it('Team A by default; the option hands the lead to B, and the snake stays a snake', () => {
    const a = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20));
    expect(a.placementOrder).toEqual(['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A', 'A', 'B']);
    const b = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, { placementFirst: 'B' });
    expect(b.placementOrder).toEqual(['B', 'A', 'A', 'B', 'B', 'A', 'A', 'B', 'B', 'A']);
    for (const order of [a.placementOrder, b.placementOrder]) {
      expect(order.filter(k => k === 'A')).toHaveLength(5);
      expect(order.filter(k => k === 'B')).toHaveLength(5);
    }
  });

  it('a simulated fixture has the visitor (B) lead the snake', () => {
    const seeded = (s = 3) => () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const r = simulateGame(CARDS.slice(0, 10), CARDS.slice(10, 20), { rng: seeded(), keepGame: true });
    expect(r.game.placementOrder[0]).toBe('B');
    expect(r.game.done).toBe(true);
  });

  it('the coach searches the snake it is given, whichever side leads', () => {
    const A = Array.from({ length: 5 }, (_, i) => mk(`a${i}`, 8 + 2 * i, 16 - 2 * i, { base: 3 + i, slope: 0.1 + 0.05 * i }));
    const B = Array.from({ length: 5 }, (_, i) => mk(`b${i}`, 16 - 2 * i, 8 + 2 * i, { base: 3 + i, slope: 0.1 + 0.05 * i }));
    const g = newGame([...A, ...Array.from({ length: 5 }, (_, i) => mk(`af${i}`, 8, 8))], [...B, ...Array.from({ length: 5 }, (_, i) => mk(`bf${i}`, 8, 8))], null, null, { placementFirst: 'B' });
    g.phase = 'matchup_strats';
    g.draft = { ...(g.draft || {}), aPicks: A.map(p => p.id), bPicks: B.map(p => p.id) };
    g.placementStep = 0;
    // Step 0 is B's lead now: the coach leads, answers nothing yet.
    const first = placementChoices(g, 'B');
    expect(first[0].answering).toBe(false);
    for (let step = 0; step < 10; step += 1) {
      const key = g.placementOrder[step];
      const pick = aiPlacementPick(g, key);
      getTeam(g, key).starters.push(getTeam(g, key).roster.find(r => r.id === pick.playerId));
      g.placementStep = step + 1;
    }
    expect(getTeam(g, 'A').starters).toHaveLength(5);
    expect(getTeam(g, 'B').starters).toHaveLength(5);
  });
});

describe('the difficulty ladder', () => {
  it('runs Settler to Deity with IQ rising from 0 to 1', () => {
    expect(AI_LEVELS.map(l => l.id)).toEqual(['settler', 'chieftain', 'warlord', 'prince', 'king', 'deity']);
    for (let i = 1; i < AI_LEVELS.length; i += 1) expect(AI_LEVELS[i].iq).toBeGreaterThan(AI_LEVELS[i - 1].iq);
    expect(iqOf('settler')).toBe(0);
    expect(iqOf('deity')).toBe(1);
    expect(levelById('nonsense').id).toBe(DEFAULT_AI_LEVEL);
  });

  it('remembers the choice per browser and falls back to the default', () => {
    const store = {};
    globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
    expect(loadAiLevel()).toBe(DEFAULT_AI_LEVEL);
    saveAiLevel('warlord');
    expect(loadAiLevel()).toBe('warlord');
    store['showdown.aiLevel'] = 'bogus';
    expect(loadAiLevel()).toBe(DEFAULT_AI_LEVEL);
    delete globalThis.localStorage;
  });

  it('Deity always plays the search; Settler spreads its placements across the options', () => {
    const star = mk('star', 14, 14, { base: 8, slope: 0.4 });
    const wall = mk('wall', 14, 14, { base: 2, slope: 0.05 });
    const scorer = mk('scorer', 12, 12, { base: 9, slope: 0.5 });
    const others = [mk('b3', 8, 8), mk('b4', 8, 8)];
    const build = () => {
      const g = newGame([star, ...Array.from({ length: 9 }, (_, i) => mk(`a${i}`, 8, 8))], [wall, scorer, ...others, ...Array.from({ length: 5 }, (_, i) => mk(`bf${i}`, 8, 8))]);
      g.phase = 'matchup_strats';
      g.draft = { ...(g.draft || {}), aPicks: ['star', 'a0', 'a1', 'a2', 'a3'], bPicks: ['wall', 'scorer', 'b3', 'b4', 'bf0'] };
      getTeam(g, 'A').starters = [star];
      g.placementStep = 1;
      return g;
    };
    const best = placementChoices(build(), 'B')[0].player.id;
    for (let k = 0; k < 20; k += 1) expect(aiPlacementPick(build(), 'B', { iq: 1 }).playerId).toBe(best);
    const seen = new Set();
    for (let k = 0; k < 200; k += 1) seen.add(aiPlacementPick(build(), 'B', { iq: 0 }).playerId);
    expect(seen.size).toBeGreaterThan(2);
    // In between, the best answer comes up more often than any other.
    const tally = {};
    for (let k = 0; k < 300; k += 1) { const id = aiPlacementPick(build(), 'B', { iq: 0.75 }).playerId; tally[id] = (tally[id] || 0) + 1; }
    expect(tally[best]).toBeGreaterThan(150);
  });
});
