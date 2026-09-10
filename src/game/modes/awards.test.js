// End-of-season awards (awards.js): each award's rule, its threshold, and
// the regular-season snapshot it reads.
import { describe, it, expect } from 'vitest';
import {
  seasonAwards, valueOf, replacementRate, vorpOf, AST_VALUE, REB_VALUE,
  MIN_GAMES_SHARE, DPOY_MIN_MPG, ROOKIE_SETS,
} from './awards.js';
import { CARD_SETS, cardKey } from '../cardSets.js';

const base = CARD_SETS['2026-27'];
const rookie = CARD_SETS.rookie;
const k = i => cardKey(base[i]);

/** Two teams, four regular-season games each; playoffs excluded from standings. */
function seasonWith(rows, extra = {}) {
  const results = [];
  for (let i = 0; i < 4; i += 1) {
    results.push({ fixtureId: `f${i}`, home: 't1', away: 't2', homeScore: 50 + i, awayScore: 40 });
  }
  results.push({ fixtureId: 'p1', home: 't1', away: 't2', homeScore: 60, awayScore: 55, playoff: true });
  return { teams: [{ id: 't1' }, { id: 't2' }], results, regStats: rows, stats: rows, ...extra };
}
const row = (team, key, o = {}) => ({
  team, key, g: 4, pts: 40, reb: 8, ast: 8, min: 96, tpm: 0, tpa: 0,
  alw: 40, mg: 4, mpts: 40, mmin: 96, gs: 4, ...o,
});
const award = (s, id) => seasonAwards(s).awards.find(a => a?.id === id) ?? null;

describe('the value behind MVP', () => {
  it('prices rebounds and assists at what spending them buys', () => {
    expect(AST_VALUE).toBeCloseTo(0.18, 6);
    expect(REB_VALUE).toBeCloseTo(0.12, 6);
    expect(valueOf({ pts: 10, reb: 5, ast: 5 })).toBeCloseTo(10 + 0.6 + 0.9, 6);
  });

  it('counts value above replacement over minutes, not raw points', () => {
    const rows = [row('t1', k(0), { pts: 20, min: 40 }), row('t1', k(1), { pts: 60, min: 190 }), row('t2', k(2), { pts: 10, min: 60 })];
    const repl = replacementRate(rows);
    for (const r of rows) expect(vorpOf(r, repl)).toBeCloseTo((valueOf(r) / r.min - repl) * r.min, 9);
  });
});

describe('the awards', () => {
  it('MVP goes to the most value over replacement among players with half their team\'s games', () => {
    const s = seasonWith([
      row('t1', k(0), { pts: 120, min: 150 }),                  // efficient and busy: the MVP
      row('t1', k(1), { pts: 60, min: 150 }),
      row('t2', k(2), { pts: 10, min: 150 }),
      row('t2', k(3), { g: 1, pts: 90, min: 30 }),              // one game of four: not eligible
    ]);
    expect(MIN_GAMES_SHARE).toBe(0.5);
    expect(award(s, 'mvp').key).toBe(k(0));
  });

  it('DPOY is the fewest points allowed per minute, with a minutes threshold to qualify', () => {
    const s = seasonWith([
      row('t1', k(0), { alw: 30, mmin: 120 }),                  // 0.25 a minute
      row('t1', k(1), { alw: 20, mmin: 100 }),                  // 0.20 a minute: the DPOY
      row('t2', k(2), { alw: 0, mmin: 40 }),                    // 10 a game: under the threshold
      row('t2', k(3), { alw: 5, mg: 1, mmin: 30 }),             // one measured game of four
    ]);
    expect(DPOY_MIN_MPG).toBe(16);
    const d = award(s, 'dpoy');
    expect(d.key).toBe(k(1));
    expect(d.alwpm).toBeCloseTo(0.2, 9);
  });

  it('Sixth Man only considers players who came off the bench in most games', () => {
    const s = seasonWith([
      row('t1', k(0), { pts: 200, gs: 4 }),                     // the best player, but a starter
      row('t1', k(1), { pts: 80, gs: 1 }),                      // off the bench: the Sixth Man
      row('t2', k(2), { pts: 50, gs: 0 }),
    ]);
    expect(award(s, 'sixth').key).toBe(k(1));
  });

  it('Rookie of the Year only considers Rookie-set cards, and is empty without one', () => {
    expect(ROOKIE_SETS).toContain('rookie');
    const r = cardKey(rookie[0]);
    const withRookie = seasonWith([row('t1', k(0), { pts: 200 }), row('t2', r, { pts: 50 })]);
    expect(award(withRookie, 'roy').key).toBe(r);
    expect(award(seasonWith([row('t1', k(0))]), 'roy')).toBeNull();
  });

  it('the Scoring Title is the best points per game among eligible players', () => {
    const s = seasonWith([
      row('t1', k(0), { pts: 100 }),                            // 25 a game
      row('t2', k(1), { pts: 112 }),                            // 28 a game: the title
      row('t2', k(2), { g: 1, pts: 40 }),                       // 40 in one game: not eligible
    ]);
    expect(award(s, 'scoring').key).toBe(k(1));
  });
});

describe('the regular-season snapshot', () => {
  it('reads regStats, not the playoff-inflated totals', () => {
    const regular = [row('t1', k(0), { pts: 100 }), row('t2', k(1), { pts: 90 })];
    const withPlayoffs = [row('t1', k(0), { pts: 100 }), row('t2', k(1), { g: 6, pts: 300 })];
    const s = seasonWith(regular, { stats: withPlayoffs });
    expect(seasonAwards(s).basis).toBe('regular');
    expect(award(s, 'scoring').key).toBe(k(0));
  });

  it('falls back to all games for a season that reached the playoffs before the snapshot, and says so', () => {
    const s = seasonWith(undefined, { stats: [row('t1', k(0))] });
    delete s.regStats;
    expect(seasonAwards(s).basis).toBe('all');
    expect(award(s, 'mvp').key).toBe(k(0));
  });

  it('is empty, not broken, for a season with no stats', () => {
    expect(seasonAwards(seasonWith([])).awards).toEqual([]);
    expect(seasonAwards({ teams: [], results: [] }).awards).toEqual([]);
  });
});
