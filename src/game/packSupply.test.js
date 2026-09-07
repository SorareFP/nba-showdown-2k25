// SUPPLY-DRIVEN PACK WEIGHTS — step 2 of the card economy.
//
// The claim being tested is narrow and load-bearing: a card gets HARDER to pull
// as copies enter circulation, the BAND rate never moves, and an empty supply
// map reproduces the engine exactly as it behaved before any of this existed.
// That last one is what let the feature ship behind a caller that had not wired
// readSupply() yet, so it is tested first and hardest.
import { describe, it, expect } from 'vitest';
import {
  generatePack, decay, SUPPLY_DECAY_SCALE, SPECIAL_BAND_SHARE, PACK_TYPES,
} from './packEngine.js';
import { CARD_SETS, BASE_SET, cardKey } from './cardSets.js';
import { CARD_MAP } from './cards.js';
import { getPlayerRarity } from './rarity.js';

const players = cards => cards.filter(c => c.type === 'player');
const rarityOf = pull => getPlayerRarity(CARD_MAP[pull.id]);

/** Open `n` boosters and count how often each card and each band came out. */
function sample(n, supply) {
  const byCard = {};
  const byBand = {};
  for (let i = 0; i < n; i += 1) {
    for (const pull of players(generatePack('booster', supply ? { supply } : {}))) {
      byCard[pull.id] = (byCard[pull.id] ?? 0) + 1;
      const r = rarityOf(pull);
      byBand[r] = (byBand[r] ?? 0) + 1;
    }
  }
  return { byCard, byBand };
}

describe('the decay curve', () => {
  it('is 1 at zero, so an unminted card is weighted exactly as before', () => {
    expect(decay(0)).toBe(1);
    expect(decay(undefined)).toBe(1);
  });

  it('falls monotonically and never reaches zero', () => {
    let prev = decay(0);
    for (const n of [1, 5, 20, 100, 1000, 100000]) {
      const d = decay(n);
      expect(d).toBeLessThan(prev);
      expect(d).toBeGreaterThan(0);
      prev = d;
    }
  });

  it('halves at the scale, which is what "/5" means', () => {
    expect(decay(SUPPLY_DECAY_SCALE)).toBeCloseTo(0.5, 10);
    expect(decay(SUPPLY_DECAY_SCALE * 3)).toBeCloseTo(0.25, 10);
  });

  it('treats a negative count as zero rather than inverting the weight', () => {
    // circulating is mints minus burns and must never go below zero, but a
    // corrupt counter that did would otherwise produce a NEGATIVE weight and
    // silently break the roulette.
    expect(decay(-10)).toBe(1);
  });
});

describe('an empty supply changes nothing', () => {
  it('is the default, so every existing caller is unaffected', () => {
    // Not a statistical claim — a structural one. No option, no behaviour change.
    const before = generatePack('booster');
    expect(players(before)).toHaveLength(PACK_TYPES.booster.players);
  });

  it('produces the same band rates with {} as with no supply at all', () => {
    const N = 900;
    const a = sample(N).byBand;
    const b = sample(N, {}).byBand;
    const total = o => Object.values(o).reduce((s, x) => s + x, 0);
    for (const band of ['common', 'uncommon', 'rare']) {
      const pa = (a[band] ?? 0) / total(a);
      const pb = (b[band] ?? 0) / total(b);
      expect(Math.abs(pa - pb), band).toBeLessThan(0.06);
    }
  });
});

describe('supply moves WHICH card, never WHICH BAND', () => {
  it('leaves the band rates alone even when a whole band is saturated', () => {
    // The guarantee the whole economy is balanced on: PACK_WEIGHTS decides the
    // band. If saturating every rare could suppress the rare RATE, every pull
    // rate in the design doc would be a lie.
    const rares = (CARD_SETS[BASE_SET] ?? []).filter(c => getPlayerRarity(c) === 'rare');
    expect(rares.length).toBeGreaterThan(0);
    const saturated = Object.fromEntries(rares.map(c => [cardKey(c), 500]));

    const N = 1200;
    const plain = sample(N).byBand;
    const heavy = sample(N, saturated).byBand;
    const total = o => Object.values(o).reduce((s, x) => s + x, 0);
    const pPlain = (plain.rare ?? 0) / total(plain);
    const pHeavy = (heavy.rare ?? 0) / total(heavy);
    expect(Math.abs(pPlain - pHeavy)).toBeLessThan(0.05);
  });

  it('suppresses a minted card in favour of its bandmates', () => {
    const commons = (CARD_SETS[BASE_SET] ?? []).filter(c => getPlayerRarity(c) === 'common');
    expect(commons.length).toBeGreaterThan(5);
    const victim = commons[0];

    const N = 700;
    const plain = sample(N).byCard[victim.id] ?? 0;
    const heavy = sample(N, { [cardKey(victim)]: 400 }).byCard[victim.id] ?? 0;
    // 400 copies is decay ~0.012 — it should all but vanish, not merely dip.
    expect(heavy).toBeLessThan(Math.max(1, plain * 0.5));
  });

  it('never makes a card truly unobtainable, however saturated', () => {
    // The design decision this pins: there is no floor, BECAUSE the curve is
    // asymptotic rather than clamped. A floor would prop up the over-minted
    // card; a zero would strand a collection forever. Neither happens.
    expect(decay(1e6)).toBeGreaterThan(0);
  });
});

describe('the relative share self-corrects, which is why no floor is needed', () => {
  // The table in docs/plans/2026-09-04-card-economy-design.md, as arithmetic.
  // If these ever stop holding, the argument for having no floor is gone.
  const share = (mine, others, n) => {
    const w = decay(mine);
    return w / (w + n * decay(others));
  };

  it('is even when everything is minted equally, at any level', () => {
    for (const level of [0, 25, 50, 500]) {
      expect(share(level, level, 13)).toBeCloseTo(1 / 14, 10);
    }
  });

  it('collapses the over-minted card while the rest sit at zero', () => {
    expect(share(50, 0, 13)).toBeLessThan(0.01);
  });

  it('returns to even as the others catch up, with nothing reset', () => {
    expect(share(50, 25, 13)).toBeGreaterThan(share(50, 0, 13));
    expect(share(50, 50, 13)).toBeCloseTo(1 / 14, 10);
  });

  it('makes it the SCARCE one once the others pass it', () => {
    expect(share(50, 100, 13)).toBeGreaterThan(1 / 14);
  });
});

describe('the special-set share survives supply', () => {
  it('still splits a band at SPECIAL_BAND_SHARE when specials are saturated', () => {
    // Decay applies WITHIN each side of the split, never to the split itself —
    // otherwise a run of Super Season pulls would quietly change how often
    // special cards appear at all, which is the one number the split holds.
    const specialSets = ['super-season', 'rookie', 'summer-standouts'];
    const specials = specialSets.flatMap(id => CARD_SETS[id] ?? []);
    const saturated = Object.fromEntries(specials.map(c => [cardKey(c), 300]));

    let special = 0;
    let n = 0;
    for (let i = 0; i < 700; i += 1) {
      for (const pull of players(generatePack('booster', { supply: saturated }))) {
        n += 1;
        // A prefix alone is not special any more: `wnba:` is a BASE pull now
        // that the everyday packs draw from both leagues.
        if (specialSets.includes(String(pull.id).split(':')[0])) special += 1;
      }
    }
    expect(special / n).toBeGreaterThan(SPECIAL_BAND_SHARE - 0.07);
    expect(special / n).toBeLessThan(SPECIAL_BAND_SHARE + 0.07);
  });
});

describe('guarantees still hold under supply', () => {
  it('keeps a Legendary Chase legendary even when every legendary is saturated', () => {
    const legs = (CARD_SETS[BASE_SET] ?? []).filter(c => getPlayerRarity(c) === 'legendary');
    const saturated = Object.fromEntries(legs.map(c => [cardKey(c), 900]));
    for (let i = 0; i < 60; i += 1) {
      const pulls = players(generatePack('legendary_chase', { supply: saturated })).map(rarityOf);
      expect(pulls).toContain('legendary');
    }
  });

  it('never launders a legendary into a guaranteed super-rare', () => {
    const srs = (CARD_SETS[BASE_SET] ?? []).filter(c => getPlayerRarity(c) === 'super-rare');
    const saturated = Object.fromEntries(srs.map(c => [cardKey(c), 900]));
    for (let i = 0; i < 120; i += 1) {
      for (const r of players(generatePack('mega_deluxe', { supply: saturated })).map(rarityOf)) {
        expect(r).toBe('super-rare');
      }
    }
  });
});
