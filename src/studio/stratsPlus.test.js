// THE PRACTICED FACES (2026-10-19): a studio source the exporter renders into
// public/cards/strats-plus/, one face per starter-kit card, from the strategy
// cards' own art and crops, titled with the "+" and carrying the "+" text.
import { describe, it, expect } from 'vitest';
import { SOURCES } from './players.js';
import { PLUS } from '../game/strats.js';

describe('the strats-plus source', () => {
  it('holds every card with "+" text, named with the "+", on the strategy cards\' art', () => {
    const src = SOURCES['strats-plus'];
    expect(src).toMatchObject({ set: 'strats-plus', template: 'strat', artSet: 'strats', editable: false });
    expect(new Set(src.players.map(p => p.id))).toEqual(new Set(Object.keys(PLUS)));   // the approved "+", not the kits (they grew 2026-10-19)
    for (const p of src.players) {
      expect(p.name, p.id).toMatch(/\+$/);
      expect(p.desc, p.id).toBe(PLUS[p.id].desc);
      expect(p.upgraded, p.id).toBe(true);
    }
  });
});
