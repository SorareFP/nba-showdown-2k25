// The headless game and the AI league it is played by.
import { describe, it, expect } from 'vitest';
import { simulateGame, simulateFixture } from './simulate.js';
import { buildAiLeague, buildAiRoster, franchiseOf, franchisePool } from './aiTeams.js';
import { CAP, RANDOM_MIN_SAL } from '../teamRules.js';
import { ROSTER_SIZE } from '../engine.js';

const seeded = (s = 12345) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const salaryOf = roster => roster.reduce((t, c) => t + (c.salary ?? 0), 0);

describe('AI teams', () => {
  it('reads a franchise off a card, era keys and aliases included', () => {
    expect(franchiseOf({ team: 'LAL' })).toBe('LAL');
    expect(franchiseOf({ team: 'LAC16' })).toBe('LAC');
    expect(franchiseOf({ team: 'PHO' })).toBe('PHX');
    expect(franchiseOf({ team: 'BRK' })).toBe('BKN');
    expect(franchiseOf({})).toBe('');
  });

  it('offers well-stocked franchises to build from', () => {
    const pool = franchisePool();
    expect(pool.length).toBeGreaterThanOrEqual(12);
    expect(pool[0].cards.length).toBeGreaterThanOrEqual(pool[pool.length - 1].cards.length);
    for (const f of pool) expect(f.name && f.city).toBeTruthy();
  });

  it('builds a legal ten-card roster that prefers its own franchise', () => {
    const roster = buildAiRoster('LAL', { rng: seeded() });
    expect(roster).toHaveLength(ROSTER_SIZE);
    const sal = salaryOf(roster);
    expect(sal).toBeLessThanOrEqual(CAP);
    expect(sal).toBeGreaterThanOrEqual(RANDOM_MIN_SAL);
    expect(new Set(roster.map(c => c.id)).size).toBe(ROSTER_SIZE);
    // At least a couple of actual Lakers made it.
    expect(roster.filter(c => franchiseOf(c) === 'LAL').length).toBeGreaterThanOrEqual(2);
  });

  it('builds a league of distinct teams sharing no cards', () => {
    const league = buildAiLeague(8, { rng: seeded(99) });
    expect(league).toHaveLength(8);
    const ids = new Set();
    for (const t of league) {
      expect(t.roster).toHaveLength(ROSTER_SIZE);
      expect(salaryOf(t.roster)).toBeLessThanOrEqual(CAP);
      expect(t.human).toBe(false);
      expect(t.id.startsWith('ai:')).toBe(true);
      for (const c of t.roster) {
        expect(ids.has(c.id), `${c.name} twice`).toBe(false);
        ids.add(c.id);
      }
    }
    expect(new Set(league.map(t => t.abbr)).size).toBe(8);
  });

  it('honours cards already taken and franchises to skip', () => {
    const first = buildAiRoster('BOS', { rng: seeded(3) });
    const taken = new Set(first.map(c => c.id));
    const second = buildAiRoster('BOS', { taken, rng: seeded(4) });
    for (const c of second) expect(taken.has(c.id)).toBe(false);
    const league = buildAiLeague(4, { exclude: ['LAL', 'BOS'], rng: seeded(5) });
    expect(league.map(t => t.abbr)).not.toContain('LAL');
    expect(league.map(t => t.abbr)).not.toContain('BOS');
  });
});

describe('simulateGame', () => {
  const league = buildAiLeague(2, { rng: seeded(7) });

  it('plays a whole game and returns a decided result', () => {
    const r = simulateGame(league[0].roster, league[1].roster, { rng: seeded(21) });
    expect(r.sections).toBe(12);
    expect(r.scoreA).toBeGreaterThan(0);
    expect(r.scoreB).toBeGreaterThan(0);
    expect(['A', 'B', null]).toContain(r.winner);
    if (r.winner) expect(r.winner).toBe(r.scoreA > r.scoreB ? 'A' : 'B');
    // Scores land where a twelve-section game lands, not at zero or in the hundreds of hundreds.
    expect(r.scoreA).toBeLessThan(250);
    expect(r.scoreB).toBeLessThan(250);
  });

  it('produces box scores for both sides, in the shape the stats tracker reads', () => {
    const r = simulateGame(league[0].roster, league[1].roster, { rng: seeded(22) });
    for (const box of [r.boxA, r.boxB]) {
      expect(Array.isArray(box)).toBe(true);
      expect(box.length).toBeGreaterThan(0);
      for (const row of box) {
        expect(typeof row.key).toBe('string');
        expect(Number.isFinite(row.pts)).toBe(true);
      }
    }
  });

  it('is repeatable under a seeded rng, and restores Math.random afterwards', () => {
    const real = Math.random;
    const a = simulateGame(league[0].roster, league[1].roster, { rng: seeded(5) });
    const b = simulateGame(league[0].roster, league[1].roster, { rng: seeded(5) });
    expect([a.scoreA, a.scoreB]).toEqual([b.scoreA, b.scoreB]);
    expect(Math.random).toBe(real);
  });

  it('restores Math.random even when the game throws part-way through', () => {
    const real = Math.random;
    const boom = () => { throw new Error('boom'); };
    expect(() => simulateGame(league[0].roster, league[1].roster, { rng: boom })).toThrow('boom');
    expect(Math.random).toBe(real);
  });

  it('gives stars star minutes: the coach picks every section, not a rotation', () => {
    // The simulator used to rotate the five least-used players in after the
    // opening section, so every player on every AI team played exactly 24
    // minutes (the user, 2026-09-10: "my players are playing way more than
    // opposing teams' players"). Each section's five is now the coach's pick.
    let s = 31;
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
    const byRank = Array.from({ length: ROSTER_SIZE }, () => []);
    for (let i = 0; i < 12; i += 1) {
      // Franchise-built, the way a season builds its AI teams.
      const a = buildAiRoster('LAL', { rng });
      const taken = new Set(a.map(c => c.id));
      const b = buildAiRoster('BOS', { rng, taken });
      const g = simulateGame(a, b, { rng, keepGame: true }).game;
      for (const t of [g.teamA, g.teamB]) {
        t.roster
          .map(p => ({ sal: p.salary, min: t.stats.find(x => x.id === p.id)?.totalMinutes ?? 0 }))
          .sort((x, y) => y.sal - x.sal)
          .forEach((r, k) => byRank[k].push(r.min));
      }
    }
    const mpg = byRank.map(xs => xs.reduce((t, x) => t + x, 0) / xs.length);
    expect(mpg[0]).toBeGreaterThan(mpg[ROSTER_SIZE - 1] + 6);   // the best-paid plays clearly more
    expect(mpg.every(m => Math.abs(m - 24) < 0.5)).toBe(false);  // not the old flat 24 for everyone
    expect(Math.round(mpg.reduce((t, m) => t + m, 0))).toBe(240); // still five on the floor, 48 minutes
  });

  it('turns a fixture into a result the standings can read', () => {
    const rosters = { home: league[0].roster, away: league[1].roster };
    const res = simulateFixture({ id: 'r1g1', home: 'home', away: 'away' }, rosters, { rng: seeded(31) });
    expect(res).toMatchObject({ fixtureId: 'r1g1', home: 'home', away: 'away', simulated: true });
    expect(res.winner).toBe(res.homeScore > res.awayScore ? 'home' : 'away');
    expect(() => simulateFixture({ id: 'x', home: 'nope', away: 'away' }, rosters)).toThrow(/no roster/);
  });
});
