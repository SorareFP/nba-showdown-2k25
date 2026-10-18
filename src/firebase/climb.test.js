// WHERE A RUN LIVES (The Climb, docs/plans/2026-10-18-the-climb.md, Task 8):
// users/{uid}/runs/{id}. What can be tested without an emulator is the
// packing: Firestore refuses an array of arrays, and the act map is exactly
// that, so the map is left out and rebuilt from the run's seed on the way in.
import { describe, it, expect } from 'vitest';
import { packRun, unpackRun, isActiveRun } from './climb.js';
import { newRun, chooseCamp, chooseStop } from '../game/modes/run.js';
import { CARDS } from '../game/cards.js';
import { cardKey } from '../game/cardSets.js';

const FIVE = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).slice(100, 105).map(cardKey);
const run = () => {
  const r = newRun({ id: 'r9', seed: 7, rung: 'king', rosterKeys: FIVE, now: 5 });
  return chooseStop(chooseCamp(r, { playbook: 'paint', boon: r.camp.boons[0] }), '1-1');
};
const nestedArray = v => (Array.isArray(v) ? v.some(x => Array.isArray(x) || nestedArray(x)) : v && typeof v === 'object' ? Object.values(v).some(nestedArray) : false);

describe('a stored run', () => {
  it('holds no array of arrays and no undefined, and comes back the same run', () => {
    const r = { ...run(), lostAt: undefined };
    const stored = packRun(r);
    expect(stored.map).toBeUndefined();
    expect(nestedArray(stored)).toBe(false);
    expect(JSON.stringify(stored)).not.toContain('undefined');
    const { lostAt, ...want } = r;
    expect(unpackRun(stored)).toEqual(want);
  });

  it('is active until it is lost or its pot is banked', () => {
    expect(packRun(run()).active).toBe(true);
    expect(isActiveRun({ ...run(), status: 'lost' })).toBe(false);
    expect(isActiveRun({ ...run(), status: 'retired' })).toBe(true);
    expect(isActiveRun({ ...run(), status: 'retired', banked: { coins: 90, booster: false } })).toBe(false);
    expect(isActiveRun({ ...run(), status: 'won', banked: { coins: 400, booster: true } })).toBe(false);
  });
});
