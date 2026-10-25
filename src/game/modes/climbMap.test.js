// THE CLIMB'S MAP AND POT (docs/plans/2026-10-18-the-climb.md, Task 2). The
// browser and the server build the same act from the run's seed, so the
// server prices every stop itself and never takes the browser's word.
import { describe, it, expect } from 'vitest';
import {
  climbRng, generateMap, stopById, nextStops, reachableGame, POT, stopPot, potOf, runClaimPreview, FALLBACK_SEED_USE,
} from './climbMap.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 13);

/** Every path from floor 1 to the boss, as lists of stops. */
function paths(map) {
  const out = [];
  const walk = (stop, acc) => {
    const next = [...acc, stop];
    if (stop.kind === 'boss') { out.push(next); return; }
    for (const id of stop.next) walk(stopById(map, id), next);
  };
  for (const s of map.floors[0]) walk(s, []);
  return out;
}

describe('the seeded stream', () => {
  it('gives the same numbers for the same seed and parts, and different ones otherwise', () => {
    const a = climbRng(42, 'map');
    const b = climbRng(42, 'map');
    const c = climbRng(42, 'offers', '3-1');
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
});

describe('the act map', () => {
  it('has seven floors of three lanes and a boss', () => {
    const m = generateMap(1);
    expect(m.floors).toHaveLength(7);
    for (const [i, floor] of m.floors.entries()) {
      expect(floor.map(s => s.lane)).toEqual([0, 1, 2]);
      for (const s of floor) { expect(s.floor).toBe(i + 1); expect(s.id).toBe(`${i + 1}-${s.lane}`); }
    }
    expect(m.boss).toMatchObject({ id: 'boss', floor: 8, kind: 'boss', next: [] });
  });

  it('opens on games, rests before the boss, and never rests on floor 6', () => {
    for (const seed of SEEDS) {
      const m = generateMap(seed);
      expect(m.floors[0].every(s => s.kind === 'game'), `seed ${seed}`).toBe(true);
      expect(m.floors[6].every(s => s.kind === 'rest' && s.next.join() === 'boss'), `seed ${seed}`).toBe(true);
      expect(m.floors[5].some(s => s.kind === 'rest'), `seed ${seed}`).toBe(false);
    }
  });

  it('puts a Rivalry and a Rest Day on every path, and never two Rest Days in a row', () => {
    for (const seed of SEEDS) {
      for (const p of paths(generateMap(seed))) {
        const mid = p.filter(s => s.floor >= 2 && s.floor <= 6);
        expect(mid.some(s => s.kind === 'rivalry'), `seed ${seed}`).toBe(true);
        expect(mid.some(s => s.kind === 'rest'), `seed ${seed}`).toBe(true);
        for (let i = 1; i < p.length; i += 1) {
          expect(p[i - 1].kind === 'rest' && p[i].kind === 'rest', `seed ${seed}`).toBe(false);
        }
      }
    }
  });

  it('links each stop to one or two neighbours above, with no crossings and nothing unreachable', () => {
    for (const seed of SEEDS) {
      const m = generateMap(seed);
      for (let f = 0; f < 6; f += 1) {
        const links = m.floors[f].flatMap(s => s.next.map(id => [s.lane, stopById(m, id).lane]));
        for (const s of m.floors[f]) {
          expect(s.next.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
          expect(s.next.length, `seed ${seed}`).toBeLessThanOrEqual(2);
          for (const id of s.next) expect(Math.abs(stopById(m, id).lane - s.lane)).toBeLessThanOrEqual(1);
        }
        for (const [a, b] of links) for (const [c, d] of links) {
          if (a < c) expect(b <= d, `seed ${seed} floor ${f + 1}: ${a}->${b} crosses ${c}->${d}`).toBe(true);
        }
        for (const above of m.floors[f + 1]) {
          expect(m.floors[f].some(s => s.next.includes(above.id)), `seed ${seed}: ${above.id}`).toBe(true);
        }
      }
    }
  });

  it('is the same map every time for one seed, and rarely needs the fallback', () => {
    expect(generateMap(7)).toEqual(generateMap(7));
    expect(generateMap(7)).not.toEqual(generateMap(8));
    let fallbacks = 0;
    for (const seed of SEEDS) if (generateMap(seed)[FALLBACK_SEED_USE]) fallbacks += 1;
    expect(fallbacks).toBeLessThan(SEEDS.length * 0.05);
  });
});

describe('moving on the map', () => {
  // Version 1, whose stops are Games, Rivalries and Rest Days only: the ? stops
  // of version 2 have a test of their own (the map version, below).
  const m = generateMap(3, 1);
  it('opens on floor 1 and follows the links', () => {
    expect(nextStops(m, null).map(s => s.id)).toEqual(['1-0', '1-1', '1-2']);
    const s = m.floors[0][1];
    expect(nextStops(m, s.id).map(x => x.id)).toEqual(s.next);
    expect(nextStops(m, m.floors[6][0].id).map(x => x.id)).toEqual(['boss']);
  });

  it('lets the server accept a game behind Rest Days only', () => {
    // A rest stop and the game it leads to.
    const restStop = m.floors.slice(1, 5).flat().find(s => s.kind === 'rest');
    const before = m.floors[restStop.floor - 2].find(s => s.next.includes(restStop.id));
    const after = stopById(m, restStop.next[0]);
    expect(reachableGame(m, before.id, after.id)).toBe(true);
    // Not the rest stop itself, and not a game two floors up through a game.
    expect(reachableGame(m, before.id, restStop.id)).toBe(false);
    const game = m.floors[1].find(s => !['rest', 'event'].includes(s.kind));
    const start = m.floors[0].find(s => s.next.includes(game.id));
    const twoUp = stopById(m, game.next[0]);
    if (!['rest', 'event'].includes(twoUp.kind)) expect(reachableGame(m, start.id, twoUp.id)).toBe(false);
    // Floor 1 from the start; the boss through floor 7's Rest Day.
    expect(reachableGame(m, null, '1-0')).toBe(true);
    expect(reachableGame(m, null, '2-0')).toBe(false);
    const six = m.floors[5][0];
    expect(reachableGame(m, six.id, 'boss')).toBe(true);
  });
});

describe('the pot', () => {
  it('pays a Game by its floor, a Rivalry 70 and the boss 120', () => {
    expect(POT).toEqual({ gameBase: 30, gamePerFloor: 5, rivalry: 70, boss: 120 });
    expect(stopPot({ kind: 'game', floor: 1 })).toBe(30);
    expect(stopPot({ kind: 'game', floor: 6 })).toBe(55);
    expect(stopPot({ kind: 'rivalry', floor: 3 })).toBe(70);
    expect(stopPot({ kind: 'boss', floor: 8 })).toBe(120);
    expect(stopPot({ kind: 'rest', floor: 4 })).toBe(0);
  });

  it('adds the cleared stops once, at the rung, with a Booster for the boss', () => {
    const m = generateMap(11);
    const g1 = m.floors[0][0];
    const riv = m.floors.flat().find(s => s.kind === 'rivalry');
    const fake = { ...m, floors: m.floors.map(f => f.map(s => (s.id === g1.id ? { ...s, kind: 'game' } : s))) };
    expect(potOf(fake, [g1.id, riv.id, 'boss'], 'king')).toEqual({ coins: Math.round((30 + 70 + 120) * 1.25), booster: true });
    expect(potOf(fake, [g1.id, g1.id], 'prince')).toEqual({ coins: 30, booster: false });
    expect(potOf(fake, [], 'settler')).toEqual({ coins: 0, booster: false });
    expect(potOf(fake, ['nowhere'], 'prince')).toEqual({ coins: 0, booster: false });
  });

  it('previews a run game: into the pot, or the pot lost', () => {
    // The game's own quarter first (climbGamePay, 2026-10-19), the pot last.
    const won = runClaimPreview({ kind: 'game', floor: 2 }, 'deity', true, 6);
    expect(won.coins).toBeGreaterThan(0);
    expect(won.breakdown[0].label).toMatch(/Quarter played/);
    expect(won.breakdown.at(-1).label).toContain('+53');
    expect(runClaimPreview({ kind: 'boss', floor: 8 }, 'prince', true).breakdown.at(-1).label).toMatch(/\+120.*Booster/);
    const lost = runClaimPreview({ kind: 'game', floor: 2 }, 'prince', false, -9);
    expect(lost.breakdown.at(-1).label).toMatch(/pot is lost/);
    expect(lost.coins).toBe(19);
  });
});

// A RUN KEEPS THE MAP IT STARTED ON (final review, 2026-10-18): the server
// rebuilds the map from the seed, so a later change to the generator would
// reshape every run in flight. Each run carries the version it was drawn at.
describe('the map version', () => {
  it('is 2, draws the same map named or not, keeps version 1 for runs drawn under it, and refuses a version it does not know', async () => {
    const { MAP_VERSION } = await import('./climbMap.js');
    // 2 since 2026-10-25: ? stops (events).
    expect(MAP_VERSION).toBe(2);
    expect(generateMap(11, 2)).toEqual(generateMap(11));
    expect(generateMap(11, 1).floors.flat().some(s => s.kind === 'event')).toBe(false);
    expect(() => generateMap(11, 99)).toThrow(/version/);
  });

  // ? STOPS (2026-10-25): about one in six of floors 2-6, never floor 1 or 7,
  // and a way to a game passes through one as through a Rest Day.
  it('draws ? stops on floors 2-6, and lets a way to a game pass through one', () => {
    let events = 0, mid = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const m = generateMap(seed, 2);
      expect(m.floors[0].concat(m.floors[6]).some(s => s.kind === 'event'), `seed ${seed}`).toBe(false);
      const midStops = m.floors.slice(1, 6).flat();
      mid += midStops.length;
      events += midStops.filter(s => s.kind === 'event').length;
      const ev = midStops.find(s => s.kind === 'event' && s.next.some(id => !['rest', 'event'].includes(stopById(m, id).kind)));
      if (ev) {
        const below = m.floors[ev.floor - 2].find(s => s.next.includes(ev.id) && !['rest', 'event'].includes(s.kind));
        const above = ev.next.map(id => stopById(m, id)).find(s => !['rest', 'event'].includes(s.kind));
        if (below && above) expect(reachableGame(m, below.id, above.id), `seed ${seed}`).toBe(true);
        expect(reachableGame(m, below?.id ?? null, ev.id)).toBe(false);   // an event is no game to open
      }
    }
    expect(events / mid).toBeGreaterThan(0.1);
    expect(events / mid).toBeLessThan(0.22);
  });
});
