// The Live Series generator (2026-09-23): in mirror mode every base card
// again, the same id and numbers, in the live set with the LIVE pill and a
// stamp saying what it is; the season mode refuses until it is wired.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { liveCard, main, MODES, OUTPUT_FILE, BASE_FILE } from './generateLive.js';
import { LIVE_SET, CURRENT_SET, setBadge, setTreatment } from '../../src/cards/sets.js';
import { LIVE_BADGE } from '../../src/cards/badges.js';

describe('a live card', () => {
  it('is its base card with the set, the pill and a stamp changed, and nothing else', () => {
    const base = { id: 'X', name: 'X', team: 'BOS', salary: 900, speed: 12, power: 10, badges: ['super-season'] };
    const live = liveCard(base, { mode: 'mirror', asOf: '2026-09-23T09:00:00.000Z', source: 'cards-2026-27.json' });
    expect(live).toMatchObject({ ...base, set: LIVE_SET, badges: ['super-season', LIVE_BADGE] });
    expect(live.live).toEqual({ mode: 'mirror', asOf: '2026-09-23T09:00:00.000Z', source: 'cards-2026-27.json' });
    // Once is enough for the pill.
    expect(liveCard({ ...base, badges: [LIVE_BADGE] }, { mode: 'mirror', asOf: 'x', source: 'y' }).badges).toEqual([LIVE_BADGE]);
  });

  it('wears the blue trim and the LIVE pill by its set', () => {
    expect(setTreatment(LIVE_SET)).toBe('blue-accent');
    expect(setBadge(LIVE_SET)).toBe(LIVE_BADGE);
  });
});

describe('the committed file', () => {
  const live = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  const base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));

  it('mirrors the base set card for card until the season mode is wired', () => {
    expect(live.set).toBe(LIVE_SET);
    expect(live.live.mode).toBe('mirror');
    expect(live.cards.map(c => c.id)).toEqual(base.cards.map(c => c.id));
    for (const [i, c] of live.cards.entries()) {
      const b = base.cards[i];
      expect([c.salary, c.speed, c.power, c.shotLine, c.team], c.id).toEqual([b.salary, b.speed, b.power, b.shotLine, b.team]);
      expect(c.badges).toContain(LIVE_BADGE);
      expect(c.live.source).toBe(`cards-${CURRENT_SET}.json`);
    }
  });

  it('refuses the season mode until it is wired, and names its modes', () => {
    expect(MODES).toEqual(['mirror', 'season']);
    expect(() => main({ mode: 'season', log: () => {} })).toThrow(/not wired yet/);
    expect(() => main({ mode: 'nope', log: () => {} })).toThrow(/no such mode/);
  });
});
