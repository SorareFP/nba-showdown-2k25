// THREE ACTS (2026-10-20, docs/plans/2026-10-20-the-climb-three-acts.md). The
// user: "the point of the game is to have 3 acts like Slay the Spire. The
// options should be 'take what you've earned and quit,' or 'keep going and
// adding to the pot.' The game gets harder and the rewards get bigger as you
// go up" — and, of the pot: one pot, a loss in any act loses all of it.
import { describe, it, expect } from 'vitest';
import {
  CLIMB, ACT_DIALS, newRun, chooseCamp, openStops, chooseStop, gameSetup, recordResult, continueClimb,
  potPreview, bossTeam, stopCap, actOfRun, rareChanceOf, runFromView, runView,
} from './run.js';
import { generateMap, stopById, potOfRun, actOf, bossIdOf, runClaimPreview, ACTS, ACT_POT, BOSS_PACKS, packWords } from './climbMap.js';
import { CARDS } from '../cards.js';
import { STRAT_MAP } from '../strats.js';
import { cardKey } from '../cardSets.js';
import { capOf } from '../coinRewards.js';

const FIVE = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).slice(100, 105);
const QUIET = { player: -1, perk: -1 };
function camped() {
  const r = newRun({ id: 'r1', seed: 42, rung: 'prince', rosterKeys: FIVE.map(cardKey), now: 1 });
  return { ...chooseCamp(r, { playbook: 'speed', boon: r.camp.boons.find(b => b !== 'cut_two') }), dropOdds: QUIET };
}
/** A run that has just beaten an act's boss. */
const wonAct = (act = 1) => {
  const r = camped();
  const ids = Array.from({ length: act }, (_, i) => [`${i ? `a${i + 1}:` : ''}1-0`, bossIdOf(i + 1)]).flat();
  return { ...r, act, map: generateMap(r.seed, 1, act), status: 'won', at: bossIdOf(act), cleared: ids };
};

describe('the acts\' maps', () => {
  it('keeps Act I\'s map exactly as it was, and draws Acts II and III from their own streams', () => {
    const one = generateMap(42);
    expect(generateMap(42, 1, 1)).toEqual(one);
    expect(one.act).toBeUndefined();
    const two = generateMap(42, 1, 2);
    expect(two.act).toBe(2);
    expect(two.boss.id).toBe('a2:boss');
    for (const s of two.floors.flat()) {
      expect(s.id.startsWith('a2:')).toBe(true);
      for (const n of s.next) expect(n.startsWith('a2:')).toBe(true);
    }
    expect(stopById(two, 'a2:1-0')).toMatchObject({ floor: 1, kind: 'game' });
    expect(stopById(two, '1-0')).toBeNull();
    expect(stopById(one, 'a2:1-0')).toBeNull();
    expect(two.floors.flat().map(s => s.kind)).not.toEqual(one.floors.flat().map(s => s.kind));
    expect([actOf('1-0'), actOf('boss'), actOf('a2:4-1'), actOf('a3:boss')]).toEqual([1, 1, 2, 3]);
  });

  it('rebuilds the act\'s map from a saved run or the board\'s view', () => {
    const r = continueClimb(wonAct(1));
    expect(runFromView(runView(r)).map).toEqual(r.map);
    expect(runFromView(runView(r)).map.boss.id).toBe('a2:boss');
  });
});

describe('the pot is one pot', () => {
  it('pays each act\'s stops at its rate and each beaten boss\'s pack', () => {
    const base = { seed: 42, mapVersion: 1, rung: 'prince' };
    const one = potOfRun({ ...base, cleared: ['1-0'] }).coins;
    expect(potOfRun({ ...base, cleared: ['a2:1-0'] }).coins).toBe(Math.round(one * ACT_POT[2]));
    expect(potOfRun({ ...base, cleared: ['a3:1-0'] }).coins).toBe(Math.round(one * ACT_POT[3]));
    expect(potOfRun({ ...base, cleared: ['1-0', 'boss', 'a2:boss', 'a3:boss'] }).packs).toEqual([...BOSS_PACKS[1], ...BOSS_PACKS[2], ...BOSS_PACKS[3]]);
    expect(BOSS_PACKS[3]).toEqual(['mega_deluxe']);
    expect(packWords(['booster', 'rare_deluxe', 'mega_deluxe'])).toBe('a Booster, a Rare Deluxe and a Mega Deluxe');
    const r = wonAct(2);
    expect(potPreview(r)).toEqual(potOfRun(r));
  });

  it('says a later boss\'s packs on the results screen', () => {
    const map = generateMap(42, 1, 2);
    expect(runClaimPreview(map.boss, 'prince', true, 4).breakdown.at(-1).label).toMatch(/and a Rare Deluxe$/);
  });
});

describe('keeping climbing', () => {
  it('starts the next act rested, a floor richer, on its own map, with the boss\'s reward', () => {
    const won = { ...wonAct(1), fatigue: { x: 12 }, cap: 5000 };
    const next = continueClimb(won);
    expect(actOfRun(next)).toBe(2);
    expect(next.map.boss.id).toBe('a2:boss');
    expect(next.at).toBeNull();
    expect(next.fatigue).toEqual({});
    expect(next.cap).toBe(5000 + CLIMB.capPerFloor);
    expect(next.status).toBe('reward');
    // Three cards, the third rare (a Rivalry's offer), and the drops sure.
    expect(next.offers.strats).toHaveLength(3);
    expect(STRAT_MAP[next.offers.strats[2]].rarity === 'rare' || STRAT_MAP[next.offers.strats[2]].climbOnly).toBe(true);
    expect(next.offers.players.length).toBeGreaterThan(0);
    expect(next.offers.perks.length).toBeGreaterThan(0);
    expect(next.cleared).toEqual(won.cleared);   // the pot rides on
  });

  it('opens the next act at its first floor, and only after a beaten boss', () => {
    const next = { ...continueClimb(wonAct(1)), status: 'map', offers: null };
    expect(openStops(next).map(s => s.id).every(id => /^a2:1-/.test(id))).toBe(true);
    expect(() => continueClimb(camped())).toThrow(/Beat the boss/);
    expect(() => continueClimb({ ...wonAct(1), banked: { coins: 1 } })).toThrow(/Beat the boss/);
    expect(() => continueClimb(wonAct(ACTS))).toThrow(/complete/);
  });

  it('a boss win in a later act waits on the same choice', () => {
    const r = { ...continueClimb(wonAct(1)), status: 'map', offers: null };
    const atBoss = { ...r, at: r.map.floors[6][0].id };
    const won = recordResult(chooseStop(atBoss, 'a2:boss'), { stopId: 'a2:boss', won: true, margin: 3 });
    expect(won.status).toBe('won');
    expect(won.cleared.at(-1)).toBe('a2:boss');
    expect(potPreview(won).packs).toEqual(['booster', 'rare_deluxe']);
  });
});

describe('harder as you go up', () => {
  it('sets each act\'s fights from its own dials', () => {
    const one = { ...camped(), status: 'map' };
    const two = { ...continueClimb(wonAct(1)), status: 'map', offers: null };
    const three = { ...continueClimb(wonAct(2)), status: 'map', offers: null };
    const mult = capOf('prince');
    expect(stopCap(two, stopById(two.map, 'a2:1-0'))).toBe(Math.round(ACT_DIALS[2].floorCaps[0] * mult));
    expect(stopCap(three, three.map.boss)).toBe(Math.round(ACT_DIALS[3].bossCap * mult));
    expect(stopCap(one, one.map.boss)).toBe(Math.round(CLIMB.bossCap * mult));
    // A floor-1 Game in each act is a bigger team than the last.
    const cap1 = stopCap(one, stopById(one.map, '1-0'));
    const cap2 = stopCap(two, stopById(two.map, 'a2:1-0'));
    const cap3 = stopCap(three, stopById(three.map, 'a3:1-0'));
    expect(cap1 < cap2 && cap2 < cap3).toBe(true);
    const g2 = gameSetup(two, 'a2:1-0');
    expect(g2.rosterB).toHaveLength(ACT_DIALS[2].oppSize[0]);
    expect(g2.act).toBe(2);
    const b3 = gameSetup(three, 'a3:boss');
    expect(b3.rosterB).toHaveLength(ACT_DIALS[3].bossSize);
    expect(b3.opponent.classic).toBe(true);
    // Rarer cards higher up.
    expect(rareChanceOf(7, 1)).toBeLessThanOrEqual(rareChanceOf(1, 2));
    expect(rareChanceOf(7, 2)).toBeLessThanOrEqual(rareChanceOf(1, 3));
  });

  it('meets a different classic team at each act\'s top', () => {
    const r = camped();
    const bosses = [1, 2, 3].map(act => bossTeam({ ...r, act }).abbr);
    expect(new Set(bosses).size).toBe(3);
  });
});
