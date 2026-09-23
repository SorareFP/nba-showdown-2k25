// The Live Series' synthetic-fill level (2026-09-23): fitted on the base
// set's real-log rows so a synthetic game and a real one are on one scale.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  OUTPUT_FILE,
  MIN_WINDOW_GAMES,
  bandsEv,
  fitFillLevels,
  levelPoints,
  levelTable,
  scaleLevelsToBands,
} from './calibrateLiveFill.js';
import * as V from './variance.js';
import { computeStatBands } from './bands.js';

describe('the level points', () => {
  // Two players: a 30-minute starter whose rows sit on his rate, and a
  // 12-minute reserve whose rows sit well above it (the 36/m² divide).
  const rows = (n, minutes, pts) => Array.from({ length: n }, () => ({ minutes, pts, reb: 4, ast: 2 }));
  const realGamesById = new Map([
    ['Starter_One', rows(60, 30, 20)],
    ['Reserve_Two', rows(60, 12, 5)],
    ['Short_Three', rows(10, 30, 20)],
  ]);
  // 20 points in 30 minutes is 2.67 a section; per-100 of 32 is 2.67 a section too.
  const rates = [
    { name: 'Starter One', pts100: 32, orb100: 2, drb100: 6, ast100: 4 },
    { name: 'Reserve Two', pts100: 20, orb100: 2, drb100: 6, ast100: 0.1 },
    { name: 'Short Three', pts100: 32, orb100: 2, drb100: 6, ast100: 4 },
  ];
  const pool = [{ name: 'Starter One' }, { name: 'Reserve Two' }, { name: 'Short Three' }, { name: 'Nobody Four' }];
  const { points, players } = levelPoints({ realGamesById, rates, pool });

  it('takes one point per stat from every player with a full enough window and a rate', () => {
    expect(players).toBe(2);
    expect(points.pts.map(p => p.name)).toEqual(['Starter One', 'Reserve Two']);
    // The reserve's assists rate is under MIN_RATE, so that point is not made.
    expect(points.ast.map(p => p.name)).toEqual(['Starter One']);
    expect(MIN_WINDOW_GAMES).toBe(40);
  });

  it('measures the real rows the way computeStatBands reads them', () => {
    const starter = points.pts[0];
    // v = 4 * 20 * 36 / 30² = 3.2 a game, over T = 32 / 12 = 2.667 → 1.2
    expect(starter.mpg).toBe(30);
    expect(starter.ratio).toBeCloseTo(V.normalizedValue(20, 30) / V.per4MinFromPer100(32), 6);
    expect(starter.weight).toBe(60);
    const reserve = points.pts[1];
    expect(reserve.ratio).toBeGreaterThan(starter.ratio);
  });

  it('fits a line predictInflation can read, and tabulates it', () => {
    const levels = fitFillLevels(points);
    for (const s of V.CHART_STATS) for (const k of ['a', 'b', 'r2', 'n']) expect(Number.isFinite(levels[s][k]), `${s}.${k}`).toBe(true);
    expect(V.predictInflation({ level: levels.pts }, 30)).toBeCloseTo(points.pts[0].ratio, 1);
    expect(Object.keys(levelTable(levels).pts)).toEqual(['12', '18', '24', '30', '36']);
  });

  it('then scales each level until the synthetic bands carry the real bands\' expected value', () => {
    const body = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    const levels = fitFillLevels(points);
    const { levels: scaled, scale, players: n } = scaleLevelsToBands({
      realGamesById, rates, pool, levels, shape: body.shape, iterations: 6,
    });
    expect(n).toBe(2);
    for (const s of V.CHART_STATS) {
      expect(Number.isFinite(scale[s]), s).toBe(true);
      expect(scaled[s].a).toBeCloseTo(levels[s].a + Math.log(scale[s]), 10);
      expect(scaled[s].b).toBe(levels[s].b);
    }
    // The match itself, on the starter's points: synthetic bands at the scaled
    // level within a rounding step of his real bands' expected value.
    const real = bandsEv(computeStatBands(realGamesById.get('Starter_One'), 'pts'));
    const synthetic = bandsEv(computeStatBands(V.synthesizeGames({
      per100: { pts: 32 }, mpg: 30, games: 82, fit: { level: scaled.pts, shape: body.shape }, sections: false,
    }), 'pts'));
    expect(Math.abs(synthetic - real)).toBeLessThan(1);
  });
});

describe('the committed calibration', () => {
  const body = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));

  it('carries a finite level for each chart stat and says what it stands on', () => {
    for (const s of V.CHART_STATS) {
      expect(Number.isFinite(body.levels[s].a), s).toBe(true);
      expect(Number.isFinite(body.levels[s].b), s).toBe(true);
      expect(body.levels[s].n).toBeGreaterThan(200);
    }
    expect(body.players).toBeGreaterThan(250);
    expect(body.basis).toMatch(/real last-82 window/);
    // The band-matched scale is folded into the level the fill reads.
    for (const s of V.CHART_STATS) {
      expect(body.levels[s].a).toBeCloseTo(body.rowLevels[s].a + Math.log(body.levelScale[s]), 10);
      expect(body.levelScale[s]).toBeGreaterThan(0.5);
      expect(body.levelScale[s]).toBeLessThan(2);
    }
  });

  it('carries the spread from the same rows, in the shape synthesizeGames reads', () => {
    expect(body.shape.grid).toEqual(V.SHAPE_GRID);
    expect(body.shape.coef.length).toBe(V.SHAPE_GRID.length);
    expect(body.shape.players).toBeGreaterThan(250);
    // A quantile curve: non-decreasing across the grid at a typical level.
    const curve = V.predictShape({ shape: body.shape }, 10);
    for (let i = 1; i < curve.length; i += 1) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
  });
});
