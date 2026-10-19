// WHO A CARD IS FOR (2026-10-19): the fixed half of each card's condition, for
// the Climb's reward screen ("it could glow a little and say 'matches (player)'").
import { describe, it, expect } from 'vitest';
import { CARD_FIT, cardFit } from './cardFit.js';
import { STRAT_MAP } from './strats.js';

const p = (name, o = {}) => ({ id: name, name, speed: 10, power: 10, threePtBoost: 0, paintBoost: 0, defBoost: 0, salary: 500, ...o });

describe('cardFit', () => {
  it('names only real cards, and every number it checks is printed on the card', () => {
    for (const [id, f] of Object.entries(CARD_FIT)) {
      expect(STRAT_MAP[id], id).toBeTruthy();
      for (const n of f.nums) expect(STRAT_MAP[id].desc.includes(String(n)), `${id} prints ${n}`).toBe(true);
    }
  });

  it('finds Delayed Slip\'s man at Speed 12 and Power 10, and says so when nobody is', () => {
    const fit = cardFit('delayed_slip', [p('Fast', { speed: 12, power: 10 }), p('Big', { speed: 9, power: 15 })]);
    expect(fit.ok).toBe(true);
    expect(fit.matches.map(x => x.name)).toEqual(['Fast']);
    expect(cardFit('delayed_slip', [p('Big', { speed: 9, power: 15 })])).toEqual({ matches: [], ok: false });
    expect(cardFit('high_screen_roll', [p('Any')])).toBeNull();   // asks nothing fixed of a player
  });

  it('counts the players a card needs, and Stagger Action needs two different ones', () => {
    expect(cardFit('energy_injection', [p('A', { salary: 300 })]).ok).toBe(false);
    expect(cardFit('energy_injection', [p('A', { salary: 300 }), p('B', { salary: 390 })]).ok).toBe(true);
    expect(cardFit('stagger_action', [p('Both', { speed: 13, threePtBoost: 1 })]).ok).toBe(false);
    expect(cardFit('stagger_action', [p('Fast', { speed: 13 }), p('Shooter', { threePtBoost: 1 })]).ok).toBe(true);
  });
});
