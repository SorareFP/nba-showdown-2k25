// The Live Series' window fill (2026-09-23): real games topped up to the
// window with evenly sampled synthetic ones, and the provisional flag that
// says a window was part synthetic.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildCard, evenSample, fillGames, actualShootingInput } from './generateCards.js';
import { CALIBRATION_FILE } from './calibrateAttributes.js';
import * as S from './shooting.js';
import { MIN_SYNTHETIC_GAMES } from './variance.js';

const calibration = JSON.parse(readFileSync(CALIBRATION_FILE, 'utf8'));

describe('evenSample', () => {
  it('takes every k-th row through the list rather than the first k', () => {
    const rows = Array.from({ length: 20 }, (_, i) => i);
    // synthesizeGames lays rows out in ascending quantile order, so the first
    // five would be the floor of the distribution; these span it.
    expect(evenSample(rows, 5)).toEqual([2, 6, 10, 14, 18]);
    expect(evenSample(rows, 1)).toEqual([10]);
  });

  it('returns the list itself when asked for at least all of it', () => {
    const rows = [1, 2, 3];
    expect(evenSample(rows, 3)).toBe(rows);
    expect(evenSample(rows, 9)).toBe(rows);
  });
});

describe('fillGames', () => {
  const synthesize = count => Array.from({ length: Math.max(count, MIN_SYNTHETIC_GAMES) }, (_, i) => ({ synthetic: i }));

  it('leaves a full window alone, and never calls the synthesizer for it', () => {
    const real = Array.from({ length: 82 }, (_, i) => ({ real: i }));
    let called = 0;
    expect(fillGames(real, 82, () => { called += 1; return []; })).toBe(real);
    expect(fillGames(real, 0, () => { called += 1; return []; })).toBe(real);
    expect(called).toBe(0);
  });

  it('tops a short log up to the window with evenly sampled synthetic games', () => {
    const real = [{ real: 0 }, { real: 1 }, { real: 2 }];
    const filled = fillGames(real, 82, synthesize);
    expect(filled.length).toBe(82);
    expect(filled.slice(0, 3)).toEqual(real);
    expect(filled.slice(3).every(g => 'synthetic' in g)).toBe(true);
    // Five real games short of twenty: the synthesizer still makes its
    // minimum, and the fill samples through it instead of taking the head.
    const nearly = fillGames(Array.from({ length: 77 }, (_, i) => ({ real: i })), 82, synthesize);
    expect(nearly.slice(77).map(g => g.synthetic)).toEqual([2, 6, 10, 14, 18]);
  });
});

describe('buildCard with a window to fill', () => {
  const rate = { name: 'Fill Player', pts100: 30, ast100: 6, orb100: 2, drb100: 8, usage: 0.25 };
  const actual = {
    name: 'Fill Player', games: 70, minutes: 2100, tsPct: 0.58, fgPctRim: 0.66, fgPct3: 0.37,
    fgaRimPer75: 4, fga3Per75: 6, epmDef: 0.4,
  };
  const player = { name: 'Fill Player', team: 'SAS', pos: 'PG', mpg: 30, games: 82 };
  const shooting = S.buildShootingLayer([actualShootingInput(actual)], {
    shotLineTarget: calibration.shotLine.target,
    paint: calibration.paintBoost,
    three: calibration.threePtBoost,
  }).players[0];
  const game = i => ({ minutes: 30 + (i % 5), pts: 12 + (i % 9), reb: 3 + (i % 4), ast: 4 + (i % 3) });
  const build = (realGames, fillTo) =>
    buildCard({ player, rate, actual, shooting, speedPowerTotal: 20, calibration, realGames, fillTo });

  it('marks a part-synthetic window provisional and a full real one not', () => {
    expect(build(Array.from({ length: 3 }, (_, i) => game(i)), 82).provisional).toBe(true);
    expect(build(Array.from({ length: 82 }, (_, i) => game(i)), 82).provisional).toBe(false);
    // The base set's rule is untouched: real games of any count are not provisional.
    expect(build(Array.from({ length: 3 }, (_, i) => game(i)), 0).provisional).toBe(false);
    expect(build(null, 82).provisional).toBe(true);
  });

  it('still cuts a printable chart from three real games among seventy-nine synthetic ones', () => {
    const c = build(Array.from({ length: 3 }, (_, i) => game(i)), 82);
    expect(c.chart.length).toBeGreaterThanOrEqual(2);
    for (const t of c.chart) for (const k of ['lo', 'hi', 'pts', 'reb', 'ast']) expect(Number.isFinite(t[k]), k).toBe(true);
    expect(c.chart[c.chart.length - 1].hi).toBe(99);
  });
});
