// The NBA end of the WNBA equalization.
//
// What is worth asserting here is not the ridge regression — bpmModel.test.js
// owns that — but the two things this file adds: that the population is the same
// population the EPM archive uses, and that the distribution it produces really
// does line up with the EPM one it is standing in for. The second is the whole
// justification for reading a BPM z-score onto an EPM scale, so it is measured
// rather than asserted in a comment.
import { describe, it, expect } from 'vitest';
import {
  ARCHIVE_RULE,
  ARCHIVE_SEASONS,
  NBA_GAME_MINUTES,
  REPLACEMENT_BPM,
  archiveBasis,
  compositeFrom,
  isCardable,
  loadArchive,
  measureArchive,
  vorpPerGame,
} from './nbaBpmArchive.js';
import { FIT_SEASONS } from './fitBpmModel.js';
import { POOL_RULE } from '../generatePool.js';
import { loadArchive as loadEpmArchive, quantile } from '../epmArchive.js';
import { PRINTED_SCALE, mapToReferenceScale } from '../speedPower.js';

const row = (bpmHat, over = {}) => ({
  name: 'X',
  season: 2020,
  games: 70,
  minutes: 2100,
  mpg: 30,
  bpmHat,
  realBpm: bpmHat,
  vorpPerGameHat: vorpPerGame(bpmHat, { minutes: 2100, games: 70 }),
  ...over,
});

describe('vorpPerGame', () => {
  it('is value above replacement times time on the floor', () => {
    // 2100 minutes over 70 games is 30 a night, which is 30/48 of an NBA game.
    expect(vorpPerGame(4, { minutes: 2100, games: 70 })).toBeCloseTo(6 * (30 / 48), 10);
    expect(REPLACEMENT_BPM).toBe(-2);
    expect(NBA_GAME_MINUTES).toBe(48);
  });

  it('is null rather than zero when there is no sample to divide by', () => {
    expect(vorpPerGame(4, { minutes: 0, games: 70 })).toBeNull();
    expect(vorpPerGame(4, { minutes: 2100, games: 0 })).toBeNull();
    expect(vorpPerGame(null, { minutes: 2100, games: 70 })).toBeNull();
  });
});

describe('the population', () => {
  it('is the pool rule, the same one the EPM archive uses', () => {
    expect(ARCHIVE_RULE).toBe(POOL_RULE);
  });

  it('is the seasons the model was fitted on, so nothing is extrapolated by era', () => {
    expect(ARCHIVE_SEASONS).toBe(FIT_SEASONS);
  });

  it('drops a player under either bar', () => {
    expect(isCardable(row(2))).toBe(true);
    expect(isCardable(row(2, { games: 39 }))).toBe(false);
    expect(isCardable(row(2, { mpg: 11.9 }))).toBe(false);
    expect(isCardable(row(null))).toBe(false);
  });
});

describe('measureArchive', () => {
  const rows = [row(8), row(4), row(1), row(-1), row(-3), row(6, { games: 10 })];

  it('measures only the cardable rows and returns the distribution sorted', () => {
    const a = measureArchive(rows);
    expect(a.n).toBe(5);
    expect(a.composites).toEqual([...a.composites].sort((x, y) => x - y));
    expect(a.composite.mean).toBeCloseTo(0, 4);
  });

  it('exposes a basis in the shape compositeFrom wants', () => {
    const a = measureArchive(rows);
    expect(Object.keys(archiveBasis(a)).sort()).toEqual(['bpm', 'vorpPerGame']);
    expect(compositeFrom(row(8), archiveBasis(a))).toBeGreaterThan(
      compositeFrom(row(1), archiveBasis(a))
    );
  });
});

describe('the committed archive', () => {
  const archive = loadArchive();

  it('exists, because it is what puts a WNBA card on the NBA scale', () => {
    expect(archive).toBeTruthy();
    expect(archive.n).toBe(archive.composites.length);
    expect(archive.seasons).toEqual(ARCHIVE_SEASONS);
  });

  it('lands on the same distribution as the EPM archive it stands in for', () => {
    // THE ASSERTION THE WHOLE BRIDGE RESTS ON. A WNBA player is placed by her
    // position in THIS distribution and read onto a scale calibrated on the EPM
    // one, so if the two disagreed in shape she would be systematically mis-
    // priced. Measured at four points across the range; the tolerance is loose
    // at the tail because that is where two samples of 4,780 and 7,773 genuinely
    // differ, and tight in the body because that is where the cards are.
    const epm = loadEpmArchive();
    const q = p => [quantile(archive.composites, p), quantile(epm.composites, p)];
    for (const p of [0.1, 0.5, 0.9]) {
      const [bpm, e] = q(p);
      expect(Math.abs(bpm - e), `p${p}`).toBeLessThan(0.15);
    }
    const [bpm99, epm99] = q(0.99);
    expect(Math.abs(bpm99 - epm99)).toBeLessThan(0.4);
  });

  it('spans the printed scale from end to end', () => {
    const totals = mapToReferenceScale(archive.composites, PRINTED_SCALE, {
      calibrateOn: archive.composites,
    });
    expect(Math.min(...totals)).toBe(PRINTED_SCALE.min);
    expect(Math.max(...totals)).toBe(PRINTED_SCALE.max);
  });

  it('rates the seasons a reader would expect at the top', () => {
    const names = archive.top.slice(0, 6).map(t => t.name);
    expect(names).toContain('LeBron James');
    expect(names).toContain('Nikola Jokić');
  });

  it('is FITTED BPM on both sides, which is what makes the comparison fair', () => {
    // A fitted value is compressed toward the mean relative to what it predicts.
    // Scoring the NBA on real BPM and the WNBA on predicted BPM would hand the
    // WNBA a narrower spread and a middle-heavy set; both being predicted makes
    // the compression cancel. The real value is carried for provenance only, and
    // the gap between the two is exactly the compression being cancelled.
    const top = archive.top[0];
    expect(top.bpmHat).not.toBe(top.realBpm);
    expect(top.bpmHat).toBeLessThan(top.realBpm + 2);
  });
});
