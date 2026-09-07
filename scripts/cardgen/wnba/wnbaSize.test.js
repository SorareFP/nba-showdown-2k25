// Measured size, and the fact that it is only half the answer.
//
// The headline is easy to get wrong: real height and weight arrived and the
// box-score proxy stayed. That is not indecision. Measured on the shipped sets,
// each signal alone falls short of the NBA's spread of speed shares and the two
// together land on it, because they see different things — how big somebody is,
// and what she did with it.
import { describe, it, expect } from 'vitest';
import {
  loadWnbaBiometrics, wnbaPositionSize, wnbaSizeContext, wnbaSpeedShareFor,
  splitWnbaBySize, SIZE_STRENGTH, SIZE_MODEL,
} from './wnbaSize.js';
import { leagueRows } from './bigness.js';
import { POSITIONS, SIZE_SPEED_SHARE, SPEED_SHARE_BOUNDS } from '../attributes.js';
import { CARD_SETS } from '../../../src/game/cardSets.js';

const bios = loadWnbaBiometrics();

describe('the biometrics that were fetched', () => {
  it('cover most of the carded players', () => {
    const ids = new Set();
    for (const set of ['wnba', 'wnba-super-season', 'wnba-rookie', 'wnba-team-rewards']) {
      for (const c of CARD_SETS[set] ?? []) if (c.bbrefId) ids.add(c.bbrefId);
    }
    const have = [...ids].filter(id => bios[id]).length;
    expect(have / ids.size).toBeGreaterThan(0.85);
  });

  it('lists plausible WNBA sizes, not NBA ones', () => {
    // A parser that grabbed the wrong number would most likely grab an NBA-sized
    // one or a jersey number, and both would sail through a null check.
    for (const [id, b] of Object.entries(bios)) {
      expect(b.inches, id).toBeGreaterThan(62);
      expect(b.inches, id).toBeLessThan(84);
      expect(b.weight, id).toBeGreaterThan(110);
      expect(b.weight, id).toBeLessThan(300);
    }
  });
});

describe('the positional baselines', () => {
  const { positionSize } = wnbaPositionSize(leagueRows(), bios);

  it('has an entry for every position speedShare can weight', () => {
    // THE BUG THIS CAUGHT. Baselines keyed 'G'/'F'/'C' matched none of the five
    // positions speedShare spreads a label across, so it bailed to the bare
    // centre and the size term did nothing — silently. Strength 0 and strength
    // 1 produced byte-identical cards.
    for (const pos of POSITIONS) {
      expect(positionSize[pos], pos).toBeTruthy();
      expect(positionSize[pos].inches, pos).toBeGreaterThan(0);
    }
  });

  it('measures the WNBA and not the NBA', () => {
    // A size term is a deviation from what a position normally is, so a WNBA
    // player against NBA baselines would read as off-the-scale small and say
    // nothing about how she played.
    for (const pos of POSITIONS) {
      expect(positionSize[pos].inches, pos).toBeLessThan(SIZE_SPEED_SHARE ? 82 : 82);
      expect(positionSize[pos].inches, pos).toBeLessThan(POSITIONS.length ? 82 : 82);
    }
    expect(positionSize.C.inches).toBeLessThan(80);
    expect(positionSize.C.inches).toBeGreaterThan(positionSize.SG.inches);
  });
});

describe('the split it produces', () => {
  const ctx = wnbaSizeContext(leagueRows());

  it('uses the NBA sensitivity unchanged, with no fudge multiplier', () => {
    expect(SIZE_STRENGTH).toBe(1);
    expect(SIZE_MODEL).toBe(SIZE_SPEED_SHARE);
  });

  it('gives a tall heavy player less Speed than a small light one', () => {
    const row = { pos: 'F', playerId: 'x', trbPct: 10, blkPct: 1.5, astPct: 13, fg3aRate: 0.26 };
    const big = wnbaSpeedShareFor(row, { ...ctx, bios: { x: { inches: 78, weight: 210 } } });
    const small = wnbaSpeedShareFor(row, { ...ctx, bios: { x: { inches: 68, weight: 140 } } });
    expect(big.share).toBeLessThan(small.share);
    expect(big.source).toBe('measured');
  });

  it('falls back to the box score rather than to nothing', () => {
    // Eleven carded players have no listed size, mostly 1997-2000 rosters. The
    // proxy is a worse answer than a measurement and a much better one than the
    // bare positional centre.
    const out = wnbaSpeedShareFor(
      { pos: 'F', playerId: 'nobody', trbPct: 22, blkPct: 5, astPct: 5, fg3aRate: 0.02 },
      ctx
    );
    expect(out.source).toBe('inferred');
    expect(out.share).toBeGreaterThan(SPEED_SHARE_BOUNDS.min);
  });

  it('always spends the whole budget', () => {
    for (const total of [4, 17, 30]) {
      const { speed, power } = splitWnbaBySize(total, { pos: 'G', playerId: 'x' }, ctx);
      expect(speed + power).toBe(total);
      expect(speed).toBeGreaterThan(0);
      expect(power).toBeGreaterThan(0);
    }
  });
});
