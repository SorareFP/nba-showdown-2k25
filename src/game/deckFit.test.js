// THE DECK FITTER — which fifty an AI team plays, given the ten it fields.
//
// The user, 2026-09-16: "Deck-matched AI opponents are what I want, yes."
// The measurement behind it (scripts/analysis/runDeckBuild.js): a deck built
// for the roster is worth +6.23 a game to the roster the default fifty
// misfits worst, and nothing to the rosters it already suits. So the fitter
// hands out an archetype's deck only when a roster is genuinely near it, and
// the default fifty otherwise.
//
// The table is injectable, so these do not depend on the generated
// archetypeDecks.js — they pin the CLASSIFIER, which is the part with logic
// in it. The generated table is pinned separately below, for shape only.
import { describe, it, expect } from 'vitest';
import { FEATURES, FIT_CUTOFF, rosterFeatures, nearestArchetype, fitDeck } from './deckFit.js';
import { ARCHETYPE_DECKS, DECK_FIT_SCALE } from './archetypeDecks.js';
import { DEFAULT_DECK_COPIES } from './defaultDeckWeights.js';
import { stratCopyCap } from './rarity.js';
import { getStrat } from './strats.js';
import { CARDS } from './cards.js';
import { createSeason } from './modes/season.js';

/** A pool where every feature has mean 0 and sd 1, so z-scores read as raw means. */
const unitScale = Object.fromEntries(FEATURES.map(f => [f.key, { mean: 0, sd: 1 }]));
const card = (speed, power, three = 0, paint = 0, def = 0) => ({ speed, power, threePtBoost: three, paintBoost: paint, defBoost: def });

const TABLE = [
  { id: 'fast', centroid: { speed: 2, power: -1, threePtBoost: 1, paintBoost: -1, defBoost: 0 }, deck: { catch_and_shoot: 3, high_screen_roll: 4 } },
  { id: 'big', centroid: { speed: -1, power: 2, threePtBoost: -1, paintBoost: 1, defBoost: 0 }, deck: { bully_ball: 3, high_screen_roll: 4 } },
];
const opts = { table: TABLE, scale: unitScale };
const FIFTY = Object.values(DEFAULT_DECK_COPIES).reduce((a, b) => a + b, 0);

describe('rosterFeatures', () => {
  it('is the mean of each attribute, in the pool\'s standard deviations', () => {
    const roster = [card(10, 20), card(14, 16)];
    const scale = { ...unitScale, speed: { mean: 10, sd: 2 }, power: { mean: 12, sd: 4 } };
    const f = rosterFeatures(roster, scale);
    expect(f.speed).toBeCloseTo((12 - 10) / 2);     // mean 12, one sd above
    expect(f.power).toBeCloseTo((18 - 12) / 4);     // mean 18, 1.5 sd above
    expect(f.threePtBoost).toBe(0);
  });

  it('treats a missing boost as zero rather than skipping the card', () => {
    const f = rosterFeatures([{ speed: 1, power: 1 }, card(3, 3, 2)], unitScale);
    expect(f.threePtBoost).toBe(1);                 // (0 + 2) / 2
  });
});

describe('nearestArchetype', () => {
  it('finds the archetype a roster sits nearest', () => {
    const fast = [card(2, -1, 1, -1), card(2, -1, 1, -1)];
    expect(nearestArchetype(fast, opts)).toMatchObject({ id: 'fast', distance: 0 });
    const big = [card(-1, 2, -1, 1)];
    expect(nearestArchetype(big, opts).id).toBe('big');
  });

  it('answers null for an empty table or an empty roster', () => {
    expect(nearestArchetype([card(2, -1)], { table: [], scale: unitScale })).toBeNull();
    expect(nearestArchetype([], opts)).toBeNull();
  });
});

describe('fitDeck', () => {
  it('hands a near roster the archetype\'s deck, as a copy', () => {
    const deck = fitDeck([card(2, -1, 1, -1)], opts);
    expect(deck).toEqual(TABLE[0].deck);
    expect(deck).not.toBe(TABLE[0].deck);
  });

  it('leaves a roster that is near nothing on the default fifty', () => {
    // Everything at the pool mean: exactly sqrt(7) sd from either centroid.
    expect(fitDeck([card(0, 0)], opts)).toBeNull();
    expect(fitDeck([card(0, 0)], { ...opts, cutoff: 10 })).not.toBeNull();
    expect(FIT_CUTOFF).toBeGreaterThan(0);
  });

  it('is the default fifty for everyone while the table is empty', () => {
    expect(fitDeck(CARDS.slice(0, 10), { table: [], scale: unitScale })).toBeNull();
  });
});

describe('the generated table, when there is one', () => {
  it('is a fifty a deck, under the copy caps, with the switching floors intact', () => {
    for (const arch of ARCHETYPE_DECKS) {
      const total = Object.values(arch.deck).reduce((a, b) => a + b, 0);
      expect(total, arch.id).toBe(FIFTY);
      for (const [id, n] of Object.entries(arch.deck)) {
        expect(getStrat(id), `${arch.id}: ${id} is a card`).toBeTruthy();
        expect(n, `${arch.id}: ${id}`).toBeLessThanOrEqual(stratCopyCap(id));
      }
      // The user's design steer (card_design_steers): the switching family
      // keeps the designed fifty's copies whatever the profile says — a coach
      // that cannot contest a switch is playing a different game. Read off
      // the default itself: the builder's first version typed one id wrong
      // and lost a floor without anything noticing.
      for (const id of ['high_screen_roll', 'veer_switch', 'burned_switch', 'go_under', 'fight_over', 'overhelp']) {
        expect(arch.deck[id] ?? 0, `${arch.id}: ${id}`).toBeGreaterThanOrEqual(DEFAULT_DECK_COPIES[id]);
      }
    }
  });

  it('carries a scale for every feature the classifier reads', () => {
    if (!ARCHETYPE_DECKS.length) return;
    for (const f of FEATURES) expect(DECK_FIT_SCALE[f.key]?.sd, f.key).toBeGreaterThan(0);
  });
});

describe('a season fits its AI teams and leaves the humans alone', () => {
  it('gives every AI team a deck field and keeps the human\'s own', () => {
    const mine = { cards: { high_screen_roll: 4 } };
    let s = 7;
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
    const season = createSeason({
      id: 'fit', size: 4, length: 'online', rng,
      humans: [{ id: 'me', name: 'Me', roster: CARDS.slice(0, 10), deck: mine.cards, deckName: 'Mine' }],
    });
    const human = season.teams.find(t => t.human);
    expect(human.deck).toEqual(mine.cards);
    for (const t of season.teams.filter(x => !x.human)) {
      expect('deck' in t, t.name).toBe(true);
      // null (the default fifty) or a fitted fifty — never a human's.
      if (t.deck) expect(Object.values(t.deck).reduce((a, b) => a + b, 0)).toBe(FIFTY);
    }
  });
});
