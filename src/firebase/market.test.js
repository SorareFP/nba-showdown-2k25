// What can be tested about the market without a Firestore emulator.
//
// None of the firebase/ modules have tests, because exercising them needs an
// emulator this repo does not run. That is a fine reason to skip a CRUD helper
// and a bad reason to skip THIS file: the market's central promise — that a
// trade moves a copy and never creates one — is the promise the entire supply
// model rests on, and breaking it would not fail anything else.
//
// So this covers the two things that are checkable today:
//   1. the pure price rule, which is ordinary unit-testable logic
//   2. a SOURCE-LEVEL invariant that the trade path never writes to `supply/`
//
// (2) is an unusual shape for a test and is deliberate. The alternative is no
// enforcement at all until an emulator exists, and the failure it guards is
// silent: a card duplicated into circulation does not throw, it just quietly
// makes every printed pull rate wrong.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validPrice, MAX_PRICE } from './market.js';

const SOURCE = readFileSync(fileURLToPath(new URL('./market.js', import.meta.url)), 'utf8');
/** The file with its comments removed — a comment may say "supply", code may not. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('what a seller may ask', () => {
  it('takes a whole number of coins above zero', () => {
    expect(validPrice(1)).toBe(true);
    expect(validPrice(750)).toBe(true);
    expect(validPrice(MAX_PRICE)).toBe(true);
  });

  it('refuses free, negative and fractional prices', () => {
    // Free has no way to say who gets it; fractional rounds differently on the
    // two sides of a trade.
    for (const bad of [0, -1, -750, 12.5, 0.99]) {
      expect(validPrice(bad), String(bad)).toBe(false);
    }
  });

  it('refuses anything that is not a number at all', () => {
    for (const bad of [null, undefined, NaN, Infinity, '500', {}, []]) {
      expect(validPrice(bad), String(bad)).toBe(false);
    }
  });

  it('has an upper bound, so a typo cannot list at a trillion', () => {
    expect(validPrice(MAX_PRICE + 1)).toBe(false);
  });
});

describe('a trade moves a copy and never mints one', () => {
  it('never writes to the supply counter', () => {
    // THE INVARIANT. `buyCard` used to create a card from coins, which is
    // minting by another name; the market replaced it precisely so that supply
    // moves on mints and burns and on nothing else. If this ever fails, a trade
    // has started changing circulation and every pull rate in the design doc is
    // wrong.
    expect(CODE).not.toMatch(/['"]supply['"]/);
    expect(CODE).not.toMatch(/supply\/current/);
  });

  it('does not import the pack engine or anything that generates cards', () => {
    // A second angle on the same rule: the market has no business reaching for
    // card generation, and an import is how that would start.
    expect(CODE).not.toMatch(/from\s+['"].*packEngine/);
    expect(CODE).not.toMatch(/generatePack/);
  });

  it('buys inside a transaction rather than a batch', () => {
    // A batch writes atomically but reads nothing, so two buyers would both
    // succeed and the copy would exist twice. The listing has to be re-read.
    expect(CODE).toMatch(/runTransaction/);
    const buy = CODE.slice(CODE.indexOf('export async function buyListing'));
    expect(buy).toMatch(/tx\.get\(listingDoc\)/);
    expect(buy).toMatch(/already sold/);
  });
});

describe('only spares are sellable', () => {
  it('selects the copy to list by state rather than taking an id', () => {
    // The collected copy and any earned copy are unreachable from listCard by
    // construction — it looks for COPY_STATE.SPARE — rather than by a check
    // that a future caller could route around.
    const list = CODE.slice(CODE.indexOf('export async function listCard'), CODE.indexOf('export async function delistCard'));
    expect(list).toMatch(/COPY_STATE\.SPARE/);
    expect(list).toMatch(/COPY_STATE\.LISTED/);
  });

  it('says why when the only copy is protected', () => {
    // A refusal a player cannot act on is a bug report. Both protected states
    // get their own sentence: a reward can NEVER be sold, a collection copy
    // just needs a spare.
    expect(SOURCE).toMatch(/can never be sold/);
    expect(SOURCE).toMatch(/collect a spare to sell/);
  });

  it('re-checks the copy state inside the buy transaction', () => {
    // Belt and braces: listCard is the gate, but a listing that has gone stale
    // must not sell a copy that is no longer listed.
    const buy = CODE.slice(CODE.indexOf('export async function buyListing'));
    expect(buy).toMatch(/state !== COPY_STATE\.LISTED/);
  });

  it('hands a bought card over as a spare — collecting is the buyer\'s act', () => {
    // Until 2026-09-05 a card bought when you owned none locked itself into
    // the collection on arrival. Now nothing collects itself: the buyer gets a
    // spare and presses Collect if that is what they bought it for.
    const buy = CODE.slice(CODE.indexOf('export async function buyListing'));
    expect(buy).toMatch(/state: COPY_STATE\.SPARE/);
    expect(buy).not.toMatch(/COPY_STATE\.COLLECTED/);
  });
});
