// The WNBA size proxy, and the defensive imbalance it exists to fix.
//
// The bug was invisible in every existing test because nothing was WRONG in any
// single card — each one was a legal split of a legal budget. It only showed up
// in the DISTRIBUTION: too many cards with speed equal to power, and a defender
// with no weaker axis has no hole to attack. So these are distribution tests,
// and the one that matters compares the two leagues rather than checking a
// number somebody wrote down.
import { describe, it, expect } from 'vitest';
import {
  bignessBasis, bigness, leagueBasis, splitWnba, wnbaSpeedShare,
  BIG_RATES, GUARD_RATES, BIGNESS_SPEED_SHARE,
} from './bigness.js';
import { SPEED_SHARE_BOUNDS } from '../attributes.js';
import { CARD_SETS } from '../../../src/game/cardSets.js';

const WNBA_SETS = ['wnba', 'wnba-super-season', 'wnba-rookie', 'wnba-team-rewards'];
const cardsOf = ids => ids.flatMap(id => CARD_SETS[id] ?? []);
const wnba = cardsOf(WNBA_SETS);
const nba = Object.entries(CARD_SETS)
  .filter(([id]) => !WNBA_SETS.includes(id))
  .flatMap(([, cards]) => cards);

/** What an attacker has to beat: they come at the defender's weaker stat. */
const wall = c => Math.min(c.speed, c.power) + Math.max(0, c.defBoost || 0);
const balancedPct = list =>
  (100 * list.filter(c => Math.abs(c.speed - c.power) <= 1).length) / list.length;

describe('the index measures size, not quality', () => {
  const basis = {
    trbPct: { mean: 10, sd: 5 }, blkPct: { mean: 1.5, sd: 2 },
    astPct: { mean: 13, sd: 8 }, fg3aRate: { mean: 0.26, sd: 0.22 },
  };

  it('calls a rebounding shot-blocker big and a passing shooter small', () => {
    const big = bigness({ trbPct: 20, blkPct: 5, astPct: 5, fg3aRate: 0.02 }, basis);
    const guard = bigness({ trbPct: 4, blkPct: 0.2, astPct: 30, fg3aRate: 0.7 }, basis);
    expect(big).toBeGreaterThan(0);
    expect(guard).toBeLessThan(0);
    expect(big).toBeGreaterThan(guard);
  });

  it('is blind to how GOOD a player is', () => {
    // Two players with identical shape and wildly different production score
    // the same. Speed/Power is a style axis; the budget it splits is where
    // quality already lives.
    const shape = { trbPct: 15, blkPct: 3, astPct: 8, fg3aRate: 0.1 };
    expect(bigness({ ...shape, per: 30, usgPct: 34 }, basis))
      .toBe(bigness({ ...shape, per: 9, usgPct: 12 }, basis));
  });

  it('says nothing rather than "average" when it has no evidence', () => {
    // The distinction that keeps an unmeasurable player on her positional
    // centre instead of being asserted to be exactly league-average size.
    expect(bigness({}, basis)).toBeNull();
    expect(bigness({ trbPct: 20 }, basis)).not.toBeNull();
  });

  it('reads none of the rating columns, so it cannot double-count defence', () => {
    // The concrete trap: dbpmHat already drives defBoost. If it leaked in here
    // a good defender would get both a boost AND a balanced split, which makes
    // the wall worse — the exact bug this file fixes.
    for (const key of [...BIG_RATES, ...GUARD_RATES]) {
      expect(key).not.toMatch(/bpm|epm|per$|ws$/i);
    }
  });
});

describe('the split it produces', () => {
  const basis = leagueBasis();

  it('has a real league basis to work from', () => {
    expect(basis).toBeTruthy();
    expect(basis.trbPct.n).toBeGreaterThan(1000);
    expect(basis.trbPct.sd).toBeGreaterThan(0);
  });

  it('always spends the whole budget and never zeroes a stat', () => {
    for (const total of [4, 12, 21, 30]) {
      for (const row of [{ pos: 'G', astPct: 30 }, { pos: 'C', trbPct: 25 }, { pos: 'F' }, {}]) {
        const { speed, power } = splitWnba(total, row, basis);
        expect(speed + power, `${total} ${row.pos}`).toBe(total);
        expect(speed).toBeGreaterThan(0);
        expect(power).toBeGreaterThan(0);
      }
    }
  });

  it('stays inside the same share bounds the NBA split uses', () => {
    // The two leagues differ in what measures size and in nothing else.
    for (const z of [-8, -3, 0, 3, 8]) {
      const share = wnbaSpeedShare(
        { pos: 'F', trbPct: 10 + z * 5, blkPct: 1.5 + z * 2, astPct: 13 - z * 8, fg3aRate: 0.26 - z * 0.22 },
        basis
      );
      expect(share).toBeGreaterThanOrEqual(SPEED_SHARE_BOUNDS.min);
      expect(share).toBeLessThanOrEqual(SPEED_SHARE_BOUNDS.max);
    }
  });

  it('gives a big player less Speed than a guard on the same budget', () => {
    const big = splitWnba(30, { pos: 'F', trbPct: 22, blkPct: 5, astPct: 6, fg3aRate: 0.03 }, basis);
    const guard = splitWnba(30, { pos: 'F', trbPct: 4, blkPct: 0.2, astPct: 28, fg3aRate: 0.6 }, basis);
    expect(big.speed).toBeLessThan(guard.speed);
    expect(big.power).toBeGreaterThan(guard.power);
  });

  it('leans the right way — bigger means LESS speed', () => {
    expect(BIGNESS_SPEED_SHARE).toBeLessThan(0);
  });
});

describe('the shipped WNBA sets are no longer defensively out of line', () => {
  it('has a balanced-split rate close to the NBA, not double it', () => {
    // WAS 40.9% against the NBA's 21.3%. That is the whole bug in one number:
    // a card with speed equal to power has no weaker axis to attack, so twice
    // as many hole-free defenders came out of a pool a fifth the size.
    //
    // The shipped model is this index PLUS measured height and weight — see
    // wnbaSize.js — because the two see different things and neither alone
    // reaches the NBA's spread. This asserts the result of both.
    const w = balancedPct(wnba);
    const n = balancedPct(nba);
    expect(w).toBeLessThan(30);
    expect(Math.abs(w - n)).toBeLessThan(8);
  });

  it('no longer clusters the legends on one identical split', () => {
    // Six WNBA Super Season cards printed exactly S15/P15. Distinct splits are
    // what makes two great players two different cards.
    const legends = CARD_SETS['wnba-super-season'] ?? [];
    const splits = new Set(legends.map(c => `${c.speed}/${c.power}`));
    expect(splits.size).toBeGreaterThan(legends.length / 2);
  });

  it('keeps the mean defensive wall within reach of the NBA', () => {
    const mean = list => list.reduce((s, c) => s + wall(c), 0) / list.length;
    // Not equality. A residual gap is expected and is NOT a split problem: the
    // WNBA pool cut is stricter (MPG>=16, G>=20 against MPG>=12, G>=40), which
    // removes marginal players and lifts every distribution.
    expect(mean(wnba) - mean(nba)).toBeLessThan(1.2);
  });
});
