// The modules the Cloud Functions share with the browser must run WITHOUT a
// browser.
//
// This is the failure that does not show up until a cold start in production:
// an import chain that reaches a React component, `window`, or `localStorage`
// throws inside the Functions runtime, and the error reads as a deploy problem
// rather than as an import problem. So it is checked here, where it costs a
// second, against the exact list prepare.mjs copies.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generatePack, PACK_TYPES } from '../src/game/packEngine.js';
import { goalProgress, goalCoinReward, REWARD_BY_GOAL } from '../src/game/collections.js';
import { settleGameReward, DAILY_MILESTONE_CAP, MILESTONES } from '../src/game/coinRewards.js';
import { getCardByKey, ALL_CARDS, cardKey } from '../src/game/cardSets.js';
import { getPlayerRarity, BURN_VALUES } from '../src/game/rarity.js';

const prepare = readFileSync(fileURLToPath(new URL('./prepare.mjs', import.meta.url)), 'utf8');
/** The module list prepare.mjs will copy, read from the file itself. */
const COPIED = [...prepare.matchAll(/'(src\/[^']+\.js)'/g)].map(m => m[1]);

describe('what the server is given', () => {
  it('copies a non-empty list of modules', () => {
    expect(COPIED.length).toBeGreaterThan(5);
  });

  it('copies every module that exists on disk', () => {
    for (const rel of COPIED) {
      expect(existsSync(fileURLToPath(new URL(`../${rel}`, import.meta.url))), rel).toBe(true);
    }
  });

  it('never reaches a browser API', () => {
    // Not a proxy for the real thing — the real thing is that these files are
    // imported at the top of this test file and it loaded.
    for (const rel of COPIED) {
      const src = readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const banned of [/\bwindow\./, /\bdocument\./, /\blocalStorage\b/, /\bnavigator\./]) {
        expect(code, `${rel} touches ${banned}`).not.toMatch(banned);
      }
    }
  });

  it('never reaches a React component', () => {
    for (const rel of COPIED) {
      expect(rel, 'a .jsx file cannot be imported by the functions runtime').not.toMatch(/\.jsx$/);
      const src = readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
      expect(src, `${rel} imports react`).not.toMatch(/from\s+['"]react/);
    }
  });
});

describe('the functions can do their job with what they are given', () => {
  it('generates a pack server-side, supply and all', () => {
    // The exact call openPack makes. If this works here it works there — the
    // runtime difference is the Admin SDK, which this half does not touch.
    const cards = generatePack('booster', { supply: {} });
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c.id).toBeTruthy();
  });

  it('honours a pack price, which is what openPack charges', () => {
    for (const [key, def] of Object.entries(PACK_TYPES)) {
      expect(Number.isFinite(def.price), key).toBe(true);
      expect(def.price, key).toBeGreaterThanOrEqual(0);
    }
  });

  it('can re-derive goal eligibility from a collection alone', () => {
    // claimGoal reads the player's collection and answers the question itself
    // rather than believing the client. This is that path.
    const goalId = Object.keys(REWARD_BY_GOAL)[0];
    expect(goalId).toBeTruthy();
    // A SET, which is what goalProgress asks `.has()` of — and the shape this
    // test caught claimGoal getting wrong before it ever ran on real data.
    const empty = goalProgress(goalId, new Set());
    expect(empty.complete).toBe(false);
    expect(typeof goalCoinReward(goalId)).toBe('number');
  });
});

describe('the four functions added after reading the rules', () => {
  it('prices a burn from the card, which is what burnCard refuses to take from the client', () => {
    const key = cardKey(ALL_CARDS[0]);
    const value = BURN_VALUES[getPlayerRarity(getCardByKey(key))];
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
    expect(getCardByKey('not_a_card')).toBeUndefined();
  });

  it('caps a game claim server-side with the same function the client shows', () => {
    // Every milestone claimed at once, twice in a day: the second is worth
    // nothing beyond completion. This is the property claimGameReward rests on.
    const all = MILESTONES.map(m => m.id);
    const a = settleGameReward({ won: false, milestoneIds: all }, { date: '', coins: 0 }, '2026-09-05');
    expect(a.milestoneCoins).toBe(DAILY_MILESTONE_CAP);
    const b = settleGameReward({ won: false, milestoneIds: all }, a.daily, '2026-09-05');
    expect(b.milestoneCoins).toBe(0);
  });
});

// THE COPY IS CLOSED UNDER IMPORT (2026-10-14). packEngine.js and collections.js
// began importing src/game/recordBreakers.js, which the list did not name; the
// existence check above stayed green while prepare.mjs's own load check would
// have aborted the deploy. Every relative .js import of a copied module must be
// copied too.
describe('what the server is given, imported', () => {
  it('copies every module a copied module imports', () => {
    const abs = rel => fileURLToPath(new URL(`../${rel}`, import.meta.url));
    const copied = new Set(COPIED.map(abs));
    const missing = [];
    for (const rel of COPIED) {
      const src = readFileSync(abs(rel), 'utf8');
      for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s+['"](\.{1,2}\/[^'"]+\.js)['"]/g)) {
        const target = fileURLToPath(new URL(m[1], new URL(`../${rel}`, import.meta.url)));
        if (!copied.has(target)) missing.push(`${rel} -> ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
