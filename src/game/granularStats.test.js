// THE FINER STAT LINE (2026-09-10). The user: "I would like the stat-keeping
// to be as granular as possible." Games started, free throws, paint checks,
// checks taken against a defender and the misses his contest turned
// (blocks), on-floor points for and against — and the regular-season
// snapshot the awards read.
//
// Each has an identity it must satisfy across whole simulated games; a
// scoring or checking site that forgets to record one breaks it.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, getPS, creditCheckDefended, spendAssist, spendReboundBonus } from './engine.js';
import { CARDS } from './cards.js';
import { simulateGame } from './modes/simulate.js';
import { boxScoreFor } from './boxScore.js';
import { createSeason, advance, simulateRound, simulatePlayoffRound, PHASE } from './modes/season.js';
import { seasonAwards } from './modes/awards.js';

const seeded = (s = 5) => () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const sum = (xs, f) => xs.reduce((t, x) => t + (x[f] || 0), 0);
const GAMES = Array.from({ length: 12 }, (_, i) =>
  simulateGame(CARDS.slice(20 * i, 20 * i + 10), CARDS.slice(20 * i + 10, 20 * i + 20), { rng: seeded(300 + i), keepGame: true }).game);

describe('blocks', () => {
  it('a miss the contest turned is a block, a clean miss or a make is not, free throws are nobody\'s, and a reversal takes it back', () => {
    const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
    getTeam(g, 'A').starters = getTeam(g, 'A').roster.slice(0, 5);
    getTeam(g, 'B').starters = getTeam(g, 'B').roster.slice(0, 5);
    g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
    const def = () => getPS(g, 'B', getTeam(g, 'B').starters[0].id);
    const missByOne = { hit: false, total: 13, line: 14 };
    expect(creditCheckDefended(g, 'A', 0, '3pt', missByOne, 2)).toBe(true);          // 13 + 2 would have reached 14
    expect(def()).toMatchObject({ dca: 1, dcm: 0, blk: 1 });
    expect(creditCheckDefended(g, 'A', 0, '3pt', { hit: false, total: 9, line: 14 }, 2)).toBe(false);
    expect(creditCheckDefended(g, 'A', 0, 'paint', { hit: true, total: 15, line: 14 }, 2)).toBe(false);
    expect(def()).toMatchObject({ dca: 3, dcm: 1, blk: 1 });
    expect(creditCheckDefended(g, 'A', 0, 'ft', { hit: true, total: 20, line: 14 }, 0)).toBe(false);
    expect(def().dca).toBe(3);
    creditCheckDefended(g, 'A', 0, '3pt', { ...missByOne, blk: true }, 0, -1);        // Coach's Challenge
    expect(def()).toMatchObject({ dca: 2, dcm: 1, blk: 0 });
  });
});

describe('across whole simulated games', () => {
  it('every 3PT and paint check one side takes is a check against one defender, every make a make against', () => {
    for (const [i, g] of GAMES.entries()) {
      for (const [att, dfn] of [['A', 'B'], ['B', 'A']]) {
        const a = getTeam(g, att).stats, d = getTeam(g, dfn).stats;
        expect(sum(d, 'dca'), `game ${i}: ${att}'s attempts`).toBe(sum(a, 'threepa') + sum(a, 'pnta'));
        expect(sum(d, 'dcm'), `game ${i}: ${att}'s makes`).toBe(sum(a, 'threepm') + sum(a, 'pntm'));
      }
    }
  });

  it('blocks happen, and never outnumber the misses against', () => {
    let blocks = 0;
    for (const g of GAMES) {
      for (const k of ['A', 'B']) {
        const s = getTeam(g, k).stats;
        expect(sum(s, 'blk')).toBeLessThanOrEqual(sum(s, 'dca') - sum(s, 'dcm'));
        blocks += sum(s, 'blk');
      }
    }
    expect(blocks).toBeGreaterThan(0);
  });

  it('each section\'s five share its whole score: on-floor points are five times the final, for and against', () => {
    for (const [i, g] of GAMES.entries()) {
      for (const [k, o] of [['A', 'B'], ['B', 'A']]) {
        const s = getTeam(g, k).stats;
        expect(sum(s, 'onf'), `game ${i}: ${k} for`).toBe(5 * getTeam(g, k).score);
        expect(sum(s, 'ona'), `game ${i}: ${k} against`).toBe(5 * getTeam(g, o).score);
      }
    }
  });

  it('five players start, and paint makes never exceed paint attempts', () => {
    for (const g of GAMES) {
      for (const k of ['A', 'B']) {
        const s = getTeam(g, k).stats;
        expect(s.filter(p => p.gs).length).toBe(5);
        for (const p of s) expect(p.pntm || 0).toBeLessThanOrEqual(p.pnta || 0);
      }
    }
  });

  it('the box score carries every new field as a non-negative whole number', () => {
    const box = boxScoreFor(GAMES[0], 'A');
    expect(box.length).toBeGreaterThan(0);
    for (const f of ['gs', 'fta', 'ftm', 'pnta', 'pntm', 'dca', 'dcm', 'blk', 'onf', 'ona']) {
      expect(box.every(l => Number.isInteger(l[f]) && l[f] >= 0), f).toBe(true);
    }
  });
});

describe('the regular-season snapshot', () => {
  it('startPlayoffs keeps the regular season\'s totals, playoff games leave them alone, and the awards read them', () => {
    const rng = seeded(21);
    let s = createSeason({ id: 's', humans: [{ id: 'you', name: 'You', roster: CARDS.slice(0, 10) }], size: 4, length: 'short', rng });
    for (let guard = 0; s.phase === PHASE.regular && guard < 30; guard += 1) {
      s = simulateRound(s, { rng });
      s = advance(s);
    }
    expect(s.phase).toBe(PHASE.playoffs);
    expect(s.regStats).toEqual(s.stats);
    const regular = JSON.stringify(s.regStats);
    s = simulatePlayoffRound(s, { rng });
    expect(JSON.stringify(s.regStats)).toBe(regular);
    expect(JSON.stringify(s.stats)).not.toBe(regular);
    const { basis, awards } = seasonAwards(s);
    expect(basis).toBe('regular');
    expect(awards.find(a => a?.id === 'mvp')).toBeTruthy();
    expect(awards.find(a => a?.id === 'dpoy')).toBeTruthy();
  });
});

describe('the final whistle', () => {
  it('nothing scores after it: the spends refuse a finished game', () => {
    const g = GAMES[6];
    expect(g.done).toBe(true);
    const before = { A: g.teamA.score, B: g.teamB.score };
    const rich = JSON.parse(JSON.stringify(g));
    rich.teamA.assists = 20; rich.teamB.rebounds = 20;
    rich.reboundBonuses = { B: { paintCheck: true } };
    const a = spendAssist(rich, 'A', '3pt', 0);
    const b = spendReboundBonus(rich, 'B', 'paint_check', 0);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(a.game.teamA.score).toBe(before.A);
    expect(b.game.teamB.score).toBe(before.B);
  });
});

