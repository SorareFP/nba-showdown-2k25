// WHAT RARITY MEANS FOR A STRATEGY CARD, pinned.
//
// Rebanded 2026-09-07. The old bands tracked nothing measurable: 47 of 86
// cards fire every time they are held, and those 47 held 11 rares, 23
// uncommons and 13 commons. Meanwhile the ablation harness
// (scripts/analysis/runStratAudit.js --ablate) put every card it could measure
// at +1 to +4 points of win rate, differences far inside the noise — so
// rarity CANNOT be set on measured power, and these tests pin the rule that
// replaced it instead of pinning a table of numbers.
//
//   common      the staples, and every ANSWER
//   uncommon    fires often, or fires always with a payoff worth noticing
//   rare        a demanding condition or a scarce resource, with a real payoff
//   legendary   a card you build a roster toward
import { describe, it, expect } from 'vitest';
import { STRATS, getStrat } from './strats.js';
import { getStratRarity, STRAT_BURN_VALUES, RARITY_ORDER } from './rarity.js';
import { generatePack } from './packEngine.js';

const idsAt = band => STRATS.filter(s => s.rarity === band).map(s => s.id);

describe('the bands themselves', () => {
  it('gives every card a band the rest of the game knows', () => {
    for (const s of STRATS) {
      expect(RARITY_ORDER, s.id).toContain(s.rarity);
      // super-rare is a PLAYER band; no strategy card uses it.
      expect(s.rarity, s.id).not.toBe('super-rare');
    }
  });

  it('is a pyramid — more commons than uncommons, more uncommons than rares', () => {
    const n = b => idsAt(b).length;
    expect(n('common')).toBeGreaterThan(n('uncommon'));
    expect(n('uncommon')).toBeGreaterThan(n('rare'));
    expect(n('rare')).toBeGreaterThan(n('legendary'));
    // The shape that was wrong before: a quarter of the set cannot be rare.
    expect(n('rare') / STRATS.length).toBeLessThan(0.2);
    expect(n('common') / STRATS.length).toBeGreaterThan(0.4);
  });

  it('keeps the apex band small and deliberate', () => {
    const apex = idsAt('legendary');
    expect(apex.length).toBeLessThanOrEqual(6);
    // Each one is a card you construct a roster toward.
    expect(apex).toContain('twin_towers');
    expect(apex).toContain('run_the_floor');
    expect(apex).toContain('strength_in_numbers');
    expect(apex).toContain('this_is_my_house');
  });
});

describe('answers stay cheap', () => {
  // THE ONE RULE THAT IS NOT ABOUT POWER. These fire 11-14% of the time
  // because their trigger is rare, not because they are precious, and a game
  // whose answers are scarce is a game that cannot be answered. See the
  // switching floor in the default deck.
  const ANSWERS = [
    'go_under', 'fight_over', 'veer_switch', 'burned_switch', 'overhelp',
    'close_out', 'box_out', 'glass_cleaner', 'drop_coverage', 'smothering_defense',
    'offensive_foul', 'hustle_play', 'rim_protector',
  ];

  it('bands every counter as common', () => {
    for (const id of ANSWERS) {
      expect(getStrat(id), id).toBeTruthy();
      expect(getStratRarity(getStrat(id)), id).toBe('common');
    }
  });
});

describe('burning a spare', () => {
  it('prices every band a strategy card can be in', () => {
    for (const s of STRATS) {
      expect(STRAT_BURN_VALUES[s.rarity], s.id).toBeGreaterThan(0);
    }
  });

  it('climbs with the band and never flattens', () => {
    const v = STRAT_BURN_VALUES;
    expect(v.uncommon).toBeGreaterThan(v.common);
    expect(v.rare).toBeGreaterThan(v.uncommon);
    expect(v.legendary).toBeGreaterThan(v.rare);
  });
});

describe('an apex strat is reachable', () => {
  // Bounded to 'rare','rare', the three guaranteed-strat slots could never
  // deal one of the four, leaving them on the 0.3% base odds — roughly one
  // every 667 boosters. Legendary Chase is the deliberate path, the same role
  // it already plays for players.
  it('comes out of Legendary Chase often enough to be a goal', () => {
    let apex = 0;
    for (let i = 0; i < 300; i += 1) {
      for (const c of generatePack('legendary_chase')) {
        if (c.type === 'strat' && getStratRarity(getStrat(c.id)) === 'legendary') apex += 1;
      }
    }
    expect(apex).toBeGreaterThan(0);
  });

  it('is far likelier there than in a cheaper pack', () => {
    // NOT "never elsewhere": every pack can hit the apex on the 0.3% BASE odds,
    // for strats exactly as for players, and that is deliberate. What the
    // cheaper packs must not do is GUARANTEE one — Deluxe caps its players at
    // super-rare, so an apex strat in its guaranteed slot would be cheaper than
    // an apex player. The difference between the two rates is that guarantee.
    const apexRate = (packType, packs) => {
      let strats = 0;
      let apex = 0;
      for (let i = 0; i < packs; i += 1) {
        for (const c of generatePack(packType)) {
          if (c.type !== 'strat') continue;
          strats += 1;
          if (getStratRarity(getStrat(c.id)) === 'legendary') apex += 1;
        }
      }
      return apex / strats;
    };
    const chase = apexRate('legendary_chase', 400);
    const deluxe = apexRate('deluxe', 400);
    expect(chase).toBeGreaterThan(0.08);
    expect(deluxe).toBeLessThan(0.03);
    expect(chase).toBeGreaterThan(deluxe * 4);
  });
});
