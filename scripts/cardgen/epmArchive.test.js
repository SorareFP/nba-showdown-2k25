// The absolute Speed+Power reference, checked as a measurement and as an artefact.
//
// Two halves, deliberately. `measureArchive` is exercised on fixtures, because
// the arithmetic has to be checkable without 25 seasons of somebody else's data
// on disk. The COMMITTED file is then checked as itself, because it is what
// every generator reads and what the whole card set is priced against — a
// regeneration that changed the population or the shape would show up here as a
// failing claim about the file, not as a silently different card set.
import { describe, it, expect } from 'vitest';
import {
  ARCHIVE_RULE,
  FIRST_ARCHIVE_SEASON,
  LAST_ARCHIVE_SEASON,
  REFINEMENT_WEIGHT,
  archiveBasis,
  compositeFrom,
  isCardable,
  loadArchive,
  measureArchive,
  quantile,
} from './epmArchive.js';
import { POOL_RULE } from './generatePool.js';
import { PRINTED_SCALE, mapToReferenceScale } from './speedPower.js';

const row = (name, season, epm, ewinsPerGame, over = {}) => ({
  name,
  season,
  epm,
  ewinsPerGame,
  games: 70,
  mpg: 30,
  ...over,
});

describe('isCardable', () => {
  it('is the pool rule and not a second opinion about it', () => {
    // The scale exists to spread a card set across a range, so the population
    // that defines it has to be the population that gets carded.
    expect(ARCHIVE_RULE).toBe(POOL_RULE);
  });

  it('drops a player under either bar, and a row with no rating', () => {
    expect(isCardable(row('In', 2010, 2, 0.1))).toBe(true);
    expect(isCardable(row('FewGames', 2010, 2, 0.1, { games: 39 }))).toBe(false);
    expect(isCardable(row('FewMinutes', 2010, 2, 0.1, { mpg: 11.9 }))).toBe(false);
    expect(isCardable(row('Unrated', 2010, null, 0.1))).toBe(false);
    expect(isCardable(row('NoWins', 2010, 2, null))).toBe(false);
    expect(isCardable(null)).toBe(false);
  });
});

describe('measureArchive', () => {
  const rows = [
    row('Peak', 2009, 9, 0.3),
    row('Star', 2009, 5, 0.2),
    row('Good', 2010, 2, 0.12),
    row('Average', 2010, 0, 0.06),
    row('Below', 2011, -2, 0.02),
    row('Fringe', 2011, -4, -0.01),
    // Excluded by the rule, so it must not move any of the numbers above.
    row('Cameo', 2011, 8, 0.02, { games: 12 }),
  ];

  it('measures only the cardable rows', () => {
    const a = measureArchive(rows);
    expect(a.n).toBe(6);
    expect(a.composites).toHaveLength(6);
    expect(a.seasons).toEqual([2009, 2010, 2011]);
    // The 12-game cameo has the second-highest EPM in the list; if it were in
    // the population it would be the top of the distribution.
    expect(a.top[0].name).toBe('Peak');
  });

  it('returns the distribution sorted, because the tail anchor is a quantile of it', () => {
    const { composites } = measureArchive(rows);
    expect(composites).toEqual([...composites].sort((a, b) => a - b));
  });

  it('centres and scales the composite on itself', () => {
    const a = measureArchive(rows);
    expect(a.composite.mean).toBeCloseTo(0, 4);
    expect(a.composite.sd).toBeGreaterThan(0);
  });

  it('carries a per-season table, which is the evidence for the whole change', () => {
    // If every season's mean were different the recalibration would be
    // re-levelling the sets rather than re-ranking them; if every season's
    // spread were the same there would have been nothing wrong with calibrating
    // on one pool. Both claims are only checkable because this table exists.
    const a = measureArchive(rows);
    expect(a.bySeason.map(s => s.season)).toEqual([2009, 2010, 2011]);
    expect(a.bySeason.reduce((t, s) => t + s.players, 0)).toBe(a.n);
    for (const s of a.bySeason) expect(Number.isFinite(s.max)).toBe(true);
  });

  it('respects the refinement weight', () => {
    const withWins = measureArchive(rows).composites;
    const without = measureArchive(rows, { weight: 0 }).composites;
    expect(withWins).not.toEqual(without);
    expect(REFINEMENT_WEIGHT).toBe(0.35);
  });
});

describe('compositeFrom', () => {
  const basis = { epm: { mean: -0.32, sd: 2.14 }, ewinsPerGame: { mean: 0.051, sd: 0.049 } };

  it('depends on the row and the basis, and on nothing else', () => {
    // The whole reason the archive exists: two players' composites can be
    // computed independently and still be comparable.
    expect(compositeFrom({ epm: 4, ewinsPerGame: 0.16 }, basis)).toBeCloseTo(
      (4 + 0.32) / 2.14 + 0.35 * ((0.16 - 0.051) / 0.049),
      10
    );
  });

  it('reads a missing input as the basis mean rather than as NaN', () => {
    expect(compositeFrom({ epm: null, ewinsPerGame: null }, basis)).toBe(0);
    expect(compositeFrom({ epm: 4, ewinsPerGame: null }, basis)).toBeCloseTo((4 + 0.32) / 2.14, 10);
  });
});

describe('quantile', () => {
  it('interpolates between the two neighbouring values', () => {
    expect(quantile([0, 1, 2, 3], 0.5)).toBeCloseTo(1.5, 10);
    expect(quantile([0, 10], 0.25)).toBeCloseTo(2.5, 10);
    expect(quantile([5], 0.9)).toBe(5);
    expect(quantile([], 0.5)).toBeNull();
  });
});

describe('the committed archive', () => {
  const archive = loadArchive();

  it('exists, because every card in every set is priced against it', () => {
    expect(archive).toBeTruthy();
  });

  it('covers every season the API serves, and only cardable player-seasons', () => {
    expect(archive.seasons[0]).toBe(FIRST_ARCHIVE_SEASON);
    expect(archive.seasons[archive.seasons.length - 1]).toBe(LAST_ARCHIVE_SEASON);
    expect(archive.seasons).toHaveLength(LAST_ARCHIVE_SEASON - FIRST_ARCHIVE_SEASON + 1);
    expect(archive.rule).toEqual(POOL_RULE);
    expect(archive.n).toBe(archive.composites.length);
    // Every season contributes a full card set's worth of players, so no season
    // is quietly dominating the scale.
    for (const s of archive.bySeason) {
      expect(s.players, `${s.season}`).toBeGreaterThan(250);
      expect(s.players, `${s.season}`).toBeLessThan(400);
    }
  });

  it('shows EPM re-centred every season — the level is NOT what moved', () => {
    // The result people expect to see and do not: pooling 25 seasons barely
    // touches the middle of the distribution, so a current player is not
    // systematically demoted by being measured against history.
    for (const s of archive.bySeason) {
      expect(Math.abs(s.mean), `${s.season}`).toBeLessThan(0.1);
    }
  });

  it('shows the SPREAD varying by season — which is what per-pool calibration erased', () => {
    const sds = archive.bySeason.map(s => s.sd);
    expect(Math.max(...sds) - Math.min(...sds)).toBeGreaterThan(0.15);
  });

  it('earns its ceiling season by season rather than handing one out per year', () => {
    // The complaint this whole change answers, checked directly: run every
    // season in the archive through the printed scale and count how many cards
    // reach the top. Under per-pool calibration this was the same small number
    // every year by construction. It is not any more — the weakest season in
    // range puts NOBODY on the ceiling and the strongest puts a handful.
    const totals = mapToReferenceScale(archive.composites, PRINTED_SCALE, {
      calibrateOn: archive.composites,
    });
    const basis = archiveBasis(archive);
    const ceilingFor = season => {
      const s = archive.bySeason.find(b => b.season === season);
      // The season's best composite, mapped: the only card that can reach the
      // ceiling is one at or above it.
      return mapToReferenceScale([s.max], PRINTED_SCALE, { calibrateOn: archive.composites })[0];
    };
    expect(Object.keys(basis).sort()).toEqual(['epm', 'ewinsPerGame']);
    expect(Math.max(...totals)).toBe(PRINTED_SCALE.max);
    expect(Math.min(...totals)).toBe(PRINTED_SCALE.min);
    const best = archive.bySeason.map(s => ceilingFor(s.season));
    expect(Math.min(...best)).toBeLessThan(PRINTED_SCALE.max);
    expect(Math.max(...best)).toBe(PRINTED_SCALE.max);
  });

  it('puts genuine all-time peaks at the top of the distribution', () => {
    // Not a taste check: the ordering IS the artefact, and a join that silently
    // broke would show up as a top-ten full of nobodies.
    const names = archive.top.slice(0, 10).map(t => `${t.name} ${t.season}`);
    expect(names).toContain('Stephen Curry 2016');
    expect(names).toContain('LeBron James 2009');
    expect(archive.top[0].composite).toBeGreaterThan(archive.top[9].composite);
  });
});
