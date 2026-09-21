// THE CLIENT HALF OF "A GAME IS PAID ONCE", and the start buttons' pay terms
// (2026-09-18). The verifiers found both reachable only through components no
// test rendered: a late claim answer stamped the NEXT game paid, and a Deity
// coach handed an empty Team B deck still paid the 1.5x win premium.
import { describe, it, expect } from 'vitest';
import { rungDrawFor, buildGameClaim, paidView, readClaimAnswer, stampBelongs } from './gameClaim.js';
import { settleGameReward, DAILY_MILESTONE_CAP, gamePayFactor } from './coinRewards.js';
import { claimIdOf } from './gameSave.js';

// Won today already, milestone cap spent: a game's plain price.
const today = '2026-09-18';
const spent = { date: today, coins: DAILY_MILESTONE_CAP, firstWin: true };
const price = claim => settleGameReward(claim, spent, today).coins;

describe('rungDrawFor — did the coach draw its own team at the rung', () => {
  it('pays a Deity game with a Team B deck the human chose at no more than 1x', () => {
    const rungDraw = rungDrawFor('random', { opponent: 'ai', aiLevel: 'deity', deckB: 'my-empty-deck' });
    expect(rungDraw).toBe(false);
    expect(gamePayFactor({ aiLevel: 'deity', won: true, rungDraw })).toBe(1);
    const chosen = price(buildGameClaim({ won: true, margin: 20, aiLevel: 'deity', rungDraw }));
    const prince = price(buildGameClaim({ won: true, margin: 20, aiLevel: 'prince', rungDraw: true }));
    expect(chosen).toBe(prince);
  });

  it('pays the premium only for a random opponent drawn at the rung with the default deck', () => {
    expect(rungDrawFor('random', { opponent: 'ai', aiLevel: 'deity', deckB: 'default' })).toBe(true);
    expect(rungDrawFor('built', { opponent: 'ai', aiLevel: 'deity', deckB: 'default' })).toBe(false);
    // Quick Match draws at the plain cap: the rung's own only up to Prince.
    expect(rungDrawFor('quick', { opponent: 'ai', aiLevel: 'deity', deckB: 'default' })).toBe(false);
    expect(rungDrawFor('quick', { opponent: 'ai', aiLevel: 'king', deckB: 'default' })).toBe(false);
    expect(rungDrawFor('quick', { opponent: 'ai', aiLevel: 'prince', deckB: 'default' })).toBe(true);
    expect(rungDrawFor('quick', { opponent: 'ai', aiLevel: 'prince', deckB: 'deck1' })).toBe(false);
  });

  it('never says drawn for hotseat', () => {
    expect(rungDrawFor('random', { opponent: 'human', aiLevel: 'deity', deckB: 'default' })).toBe(false);
  });

  it('keeps a Settler custom game at Settler\'s discount — a custom game is never a premium, never a raise', () => {
    const rungDraw = rungDrawFor('built', { opponent: 'ai', aiLevel: 'settler' });
    expect(gamePayFactor({ aiLevel: 'settler', won: true, rungDraw })).toBe(0.5);
  });
});

describe('buildGameClaim — what GameOver sends', () => {
  it('carries the receipt key, the saved terms and the fixture\'s ids', () => {
    const c = buildGameClaim({
      won: true, margin: 12, milestones: { milestoneIds: ['td'] }, box: [], aiLevel: 'king', rungDraw: true,
      claimId: 'fixture:s1:r1m1', fixtureFrom: { dynastyId: null, leagueId: null, seasonId: 's1' },
    });
    expect(c).toMatchObject({ won: true, pvp: false, margin: 12, milestoneIds: ['td'], aiLevel: 'king', rungDraw: true, gameId: 'fixture:s1:r1m1', seasonId: 's1' });
  });

  it('sends no rung for PvP, and only an explicit true as rungDraw', () => {
    const c = buildGameClaim({ won: false, isPvp: true, aiLevel: 'deity', rungDraw: 'yes' });
    expect(c.aiLevel).toBe(null);
    expect(c.rungDraw).toBe(false);
    expect('gameId' in c).toBe(false);
  });
});

describe('the answer, and the stamp', () => {
  const preview = { coins: 90, breakdown: [{ label: 'Game completed', coins: 75 }] };

  it('reads `already: true` as success: the stamp is what was paid, the screen says so', () => {
    const a = readClaimAnswer({ already: true, coins: 98, breakdown: [{ label: 'Win', coins: 98 }] }, preview);
    expect(a.fresh).toBe(false);
    expect(a.stamp).toEqual({ coins: 98, breakdown: [{ label: 'Win', coins: 98 }] });
    expect(a.view.coins).toBe(98);
    expect(a.view.breakdown.at(-1)).toMatchObject({ label: 'Already paid to your account', note: true });
  });

  it('takes a fresh pay\'s coins and breakdown from the server over the preview', () => {
    const a = readClaimAnswer({ coins: 120, breakdown: [{ label: 'Server', coins: 120 }], bam: false }, preview);
    expect(a.fresh).toBe(true);
    expect(a.view).toMatchObject({ coins: 120, breakdown: [{ label: 'Server', coins: 120 }] });
    expect(a.stamp).toEqual({ coins: 120, breakdown: [{ label: 'Server', coins: 120 }] });
    // No server breakdown: the preview's lines stand.
    expect(readClaimAnswer({ coins: 90 }, preview).stamp.breakdown).toEqual(preview.breakdown);
  });

  it('shows a paid stamp without claiming', () => {
    expect(paidView({ coins: 50, breakdown: [] })).toEqual({ coins: 50, breakdown: [{ label: 'Already paid to your account', coins: 0, note: true }] });
  });

  // The race: the results screen claims game 1, the player presses Play Again
  // and Quick Match, and only then does the callable answer.
  it('does not stamp the next game with a late answer for the last one', () => {
    const done = { done: true };
    const claimed = claimIdOf({ game: done, preset: null, id: 'g1' });
    expect(stampBelongs(claimed, claimIdOf({ game: done, preset: null, id: 'g1' }))).toBe(true);
    // Play Again: no game on the table.
    expect(stampBelongs(claimed, claimIdOf({ game: null, preset: null, id: null }))).toBe(false);
    // Quick Match: a new game, a new id.
    expect(stampBelongs(claimed, claimIdOf({ game: { done: false }, preset: null, id: 'g2' }))).toBe(false);
    // 'Back to the season' and the next fixture's deal.
    const f1 = claimIdOf({ game: done, preset: { key: 's1:r1m1' } });
    expect(stampBelongs(f1, claimIdOf({ game: { done: false }, preset: { key: 's1:r1m2' } }))).toBe(false);
    // A claim with no key stamps nothing.
    expect(stampBelongs(null, null)).toBe(false);
  });
});
