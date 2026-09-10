// The Free Agent quote index's pure rules (freeAgentQuotes.js): which set a
// requested season lands in, what already has a card, the calibration line,
// and the permanent exclusions.
import { describe, it, expect } from 'vitest';
import {
  unprovableDebutSeasons, classifySeason, cardedIndex, cardedFor, fitLine, calibrated, isNeverCard,
} from './freeAgentQuotes.js';

const flat = { bpm: { mean: 0, sd: 1 }, vorp: { mean: 0, sd: 1 }, ws: { mean: 0, sd: 1 }, ws48: { mean: 0, sd: 1 } };
const dist = seasons => Object.fromEntries(seasons.map(s => [s, { players: 300, metrics: flat }]));
const S = (season, o = {}) => ({ season, games: 70, minutes: 2200, bpm: 0, vorp: 1, ws: 4, ws48: 0.1, ...o });

describe('unprovable debuts', () => {
  it('are the first season of each run the archive holds: 1976, and 1985 after the gap', () => {
    const seasons = [1976, 1977, ...Array.from({ length: 42 }, (_, i) => 1985 + i)];
    expect([...unprovableDebutSeasons(seasons)]).toEqual([1976, 1985]);
  });
});

describe('classifySeason', () => {
  const career = [S(1990, { bpm: 1 }), S(1991, { bpm: 6, vorp: 7 }), S(1992, { bpm: 2 })];
  const opts = { distributions: dist([1990, 1991, 1992]), unprovable: new Set([1985]) };

  it('sends the first season to Rookie, the best to Super Season, and the rest to Throwbacks', () => {
    expect(classifySeason(career, 1990, opts)).toBe('rookie');
    expect(classifySeason(career, 1991, opts)).toBe('super-season');
    expect(classifySeason(career, 1992, opts)).toBe('throwbacks');
  });

  it('gives no rookie card to a debut the archive cannot prove, or one too thin to count', () => {
    const edge = [S(1985, { bpm: 1 }), S(1986, { bpm: 6, vorp: 7 })];
    expect(classifySeason(edge, 1985, { distributions: dist([1985, 1986]), unprovable: new Set([1985]) })).toBe('throwbacks');
    const thin = [S(1990, { games: 12, minutes: 200 }), S(1991, { bpm: 6, vorp: 7 })];
    expect(classifySeason(thin, 1990, opts)).toBe('throwbacks');
  });

  it('lets Rookie outrank Super Season when the first season is also the best', () => {
    const one = [S(2000, { bpm: 9, vorp: 9 }), S(2001, { bpm: 1 })];
    expect(classifySeason(one, 2000, { distributions: dist([2000, 2001]) })).toBe('rookie');
  });
});

describe('what already has a card', () => {
  const index = cardedIndex({
    '2026-27': [{ name: 'Tyrese Maxey' }],
    'super-season': [{ name: 'Nikola Jokić', bbrefId: 'jokicni01', season: 2022 }],
    'summer-standouts': [{ name: 'Kawhi Leonard', bbrefId: 'leonaka01', season: 2019, playoffRun: true }],
  });

  it('finds special cards by id and base cards by name in the base season', () => {
    expect(cardedFor(index, { bbrefId: 'jokicni01', name: 'Nikola Jokic', season: 2022 })).toBe('super-season');
    expect(cardedFor(index, { bbrefId: 'maxeyty01', name: 'Tyrese Maxey', season: 2026 })).toBe('2026-27');
    expect(cardedFor(index, { bbrefId: 'maxeyty01', name: 'Tyrese Maxey', season: 2025 })).toBeNull();
  });

  it('keeps a regular season and a playoff run of the same year apart', () => {
    expect(cardedFor(index, { bbrefId: 'leonaka01', name: 'Kawhi Leonard', season: 2019, playoffs: true })).toBe('summer-standouts');
    expect(cardedFor(index, { bbrefId: 'leonaka01', name: 'Kawhi Leonard', season: 2019 })).toBeNull();
  });
});

describe('the calibration line', () => {
  it('recovers an exact line, and reports the fit', () => {
    const fit = fitLine([[1000, 725], [1500, 1035.5], [500, 414.5]]);   // y = 104 + 0.621x
    expect(fit.a).toBeCloseTo(104, 6);
    expect(fit.b).toBeCloseTo(0.621, 6);
    expect(fit.r).toBeCloseTo(1, 9);
    expect(fitLine([[1, 1]])).toBeNull();
  });

  it('puts a corrected price back on the salary grid and inside its bounds', () => {
    const fit = { a: 104, b: 0.621 };
    const round = x => Math.round(x / 10) * 10;
    expect(calibrated(1000, fit, { round, min: 100, max: 2000 })).toBe(730);
    expect(calibrated(10, fit, { round, min: 150, max: 2000 })).toBe(150);
    expect(calibrated(9999, null, { round, min: 100, max: 2000 })).toBe(2000);
  });
});

describe('the permanent exclusion', () => {
  it('never quotes Enes Kanter or Enes Freedom', () => {
    expect(isNeverCard('Enes Kanter')).toBe(true);
    expect(isNeverCard('Enes Freedom')).toBe(true);
    expect(isNeverCard('Tim Duncan')).toBe(false);
  });
});
