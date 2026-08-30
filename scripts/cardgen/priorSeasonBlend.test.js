import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  PRIOR_STATS_SEASON,
  blendPriorSeason,
  blendRow,
  blendSummary,
} from './priorSeasonBlend.js';
import { REPO_ROOT } from './cache.js';
import { readForceInclude } from './forceInclude.js';

/**
 * A pooled ACTUAL row, the shape poolSeasons.js produces and every generator
 * reads. Defaults are a full, ordinary season; each test overrides the two or
 * three fields its argument is about.
 */
const row = (over = {}) => ({
  name: 'A Player',
  personId: 1,
  team: 'BOS',
  position: 'SG',
  age: 27,
  games: 70,
  minutes: 2100,
  mpg: 30,
  starts: 70,
  epm: 3,
  epmOff: 2,
  epmDef: 1,
  ewins: 7,
  ewinsPerGame: 0.1,
  usage: 0.24,
  tsPct: 0.58,
  efg: 0.55,
  fgPctRim: 0.65,
  fgPctMid: 0.42,
  fgPct2: 0.55,
  fgPct3: 0.37,
  ftPct: 0.8,
  fgaRimPer75: 4,
  fgaMidPer75: 4,
  fga3Per75: 6,
  ftaPer75: 4,
  fgaPer75: 14,
  orbPct: 0.02,
  drbPct: 0.12,
  astPct: 0.2,
  tovPct: 0.1,
  stlPct: 0.02,
  blkPct: 0.01,
  regularGames: 70,
  regularMinutes: 2100,
  playoffGames: 0,
  playoffMinutes: 0,
  pooled: false,
  ...over,
});

/**
 * The pace constant cancels out of every weighted mean here (it appears in the
 * numerator and the denominator alike — see poolSeasons.js), so a
 * minutes-weighted mean is exactly what a possession-weighted one comes to.
 */
const byMinutes = (a, b, field) =>
  (a[field] * a.minutes + b[field] * b.minutes) / (a.minutes + b.minutes);

describe('blendRow — the fold itself', () => {
  // THE WHOLE POINT. Ty Jerome's fifteen 2025-26 games at 6.17 EPM produced the
  // seventh-highest budget in the set; his previous seventy-nine games are four
  // and a half times the evidence and have to count that way. A 50/50 mean of
  // the two rates would put him at 4.6, which is the answer this rules out.
  it('weights the two seasons by VOLUME, not evenly', () => {
    const current = row({ games: 15, minutes: 339, epm: 6.17 });
    const prior = row({ games: 79, minutes: 1582, epm: 3.1 });
    const blended = blendRow(current, prior);
    expect(blended.epm).toBeCloseTo(byMinutes(current, prior, 'epm'), 10);
    expect(blended.epm).toBeCloseTo(3.642, 3);
    // The straight mean is 4.635 — visibly not what this produces.
    expect(blended.epm).not.toBeCloseTo((6.17 + 3.1) / 2, 2);
  });

  // TS% is PTS / (2 * (FGA + 0.44 * FTA)), so its denominator is TRUE SHOOTING
  // ATTEMPTS. Two seasons of equal MINUTES but very different shot volume must
  // not pool 50/50, and the game count must not enter it at all.
  it('pools TS% by true shooting attempts rather than by games or minutes', () => {
    const heavy = row({ games: 20, minutes: 1000, tsPct: 0.5, fgaPer75: 24, ftaPer75: 8 });
    const light = row({ games: 60, minutes: 1000, tsPct: 0.6, fgaPer75: 6, ftaPer75: 2 });
    const blended = blendRow(heavy, light);
    // Equal minutes, so a minutes-weighted answer would be 0.55. The heavy
    // shooter took four times the attempts, so the real answer is 0.52.
    expect(blended.tsPct).toBeCloseTo(0.52, 10);
    expect(blended.tsPct).not.toBeCloseTo(0.55, 3);
  });

  it('pools each location percentage on ITS OWN attempts', () => {
    const current = row({ minutes: 500, fgPct3: 0.2, fga3Per75: 1, fgPctRim: 0.5, fgaRimPer75: 10 });
    const prior = row({ minutes: 500, fgPct3: 0.4, fga3Per75: 9, fgPctRim: 0.7, fgaRimPer75: 10 });
    const blended = blendRow(current, prior);
    // 3P% is dominated by the season he actually shot threes in...
    expect(blended.fgPct3).toBeCloseTo((0.2 * 1 + 0.4 * 9) / 10, 10);
    // ...while rim FG%, on equal rim volume, lands in the middle.
    expect(blended.fgPctRim).toBeCloseTo(0.6, 10);
  });

  it('adds the season totals and re-derives minutes per game from them', () => {
    const current = row({ games: 15, minutes: 339, starts: 15, ewins: 2 });
    const prior = row({ games: 79, minutes: 1582, starts: 70, ewins: 9 });
    const blended = blendRow(current, prior);
    expect(blended.games).toBe(94);
    expect(blended.minutes).toBeCloseTo(1921, 10);
    expect(blended.starts).toBe(85);
    expect(blended.ewins).toBe(11);
    expect(blended.mpg).toBeCloseTo(1921 / 94, 10);
  });

  // EW/GP is already per-game, so it pools by GAMES. Weighting the two rates
  // rather than dividing pooled EW by pooled games is what keeps a season the
  // source declined to rate from silently scoring zero.
  it('pools expected wins per game by games played', () => {
    const current = row({ games: 15, ewinsPerGame: 0.3 });
    const prior = row({ games: 75, ewinsPerGame: 0.1 });
    expect(blendRow(current, prior).ewinsPerGame).toBeCloseTo((0.3 * 15 + 0.1 * 75) / 90, 10);
  });

  it('leaves an unrated prior season out instead of scoring it zero', () => {
    const current = row({ games: 15, ewinsPerGame: 0.3 });
    const prior = row({ games: 4, ewinsPerGame: null, epm: null });
    const blended = blendRow(current, prior);
    expect(blended.ewinsPerGame).toBeCloseTo(0.3, 10);
    expect(blended.epm).toBeCloseTo(current.epm, 10);
  });

  // The card says who he is NOW. A player traded between the two seasons wears
  // this season's jersey and carries both seasons' production.
  it('takes identity from the CURRENT season, not the prior one', () => {
    const current = row({ name: 'Now', team: 'NYK', position: 'SF', age: 30 });
    const prior = row({ name: 'Then', team: 'DAL', position: 'PG', age: 29 });
    expect(blendRow(current, prior)).toMatchObject({
      name: 'Now',
      team: 'NYK',
      position: 'SF',
      age: 30,
    });
  });

  it('carries both seasons\' regular/playoff provenance forward', () => {
    const current = row({ games: 45, regularGames: 38, playoffGames: 7, pooled: true });
    const prior = row({ games: 79, regularGames: 70, playoffGames: 9, pooled: true });
    const blended = blendRow(current, prior);
    expect(blended.regularGames).toBe(108);
    expect(blended.playoffGames).toBe(16);
    expect(blended.blended).toBe(true);
    expect(blended.blendedFrom).toBe(PRIOR_STATS_SEASON);
    expect(blended.currentGames).toBe(45);
    expect(blended.priorGames).toBe(79);
  });

  // A rookie has no prior season, and a card built on one season is the correct
  // card for him. Not an error, and not a reason to shrink anything.
  it('returns the current row untouched when there is no prior sample', () => {
    const current = row({ games: 20 });
    for (const prior of [null, row({ games: 0, minutes: 0 })]) {
      const blended = blendRow(current, prior);
      expect(blended.blended).toBe(false);
      expect(blended.priorGames).toBe(0);
      for (const key of Object.keys(current)) expect(blended[key]).toBe(current[key]);
    }
  });
});

describe('blendPriorSeason — who gets blended', () => {
  const current = [
    row({ name: 'Ty Jerome', personId: 10, games: 15, minutes: 339, epm: 6.17 }),
    row({ name: 'Ordinary Starter', personId: 20, games: 78, minutes: 2500, epm: 1.5 }),
  ];
  const prior = [
    row({ name: 'Ty Jerome', personId: 10, games: 79, minutes: 1582, epm: 3.1 }),
    row({ name: 'Ordinary Starter', personId: 20, games: 80, minutes: 2600, epm: 4.9 }),
  ];

  // The blend is a suspension of the pool rule for named players, not a
  // pipeline-wide change. Everyone who cleared G>=40 on his own keeps his season
  // bit-for-bit, and this is the assertion that says so.
  it('blends ONLY the named players and leaves everyone else identical', () => {
    const { rows, blended } = blendPriorSeason(current, prior, ['Ty Jerome']);
    expect(blended.map(b => b.name)).toEqual(['Ty Jerome']);
    expect(rows[0].epm).toBeCloseTo(3.642, 3);
    expect(rows[1]).toBe(current[1]);
  });

  it('does nothing at all when the list is empty', () => {
    const { rows, blended } = blendPriorSeason(current, prior, []);
    expect(rows).toBe(current);
    expect(blended).toEqual([]);
  });

  // dunksandthrees calls him "Jimmy Butler III" in one season's table and the
  // pool calls him "Jimmy Butler". Matching on the stable numeric id first is
  // what makes that a non-event.
  it('matches a prior season by player id even when the name is spelled differently', () => {
    const now = [row({ name: 'Jimmy Butler III', personId: 202710, games: 39, epm: 4.29 })];
    const then = [row({ name: 'Jimmy Butler', personId: 202710, games: 66, epm: 3.01 })];
    const { blended } = blendPriorSeason(now, then, ['Jimmy Butler']);
    expect(blended).toHaveLength(1);
    expect(blended[0].prior.personId).toBe(202710);
  });

  // A typo in the hand-maintained force-include file is otherwise completely
  // silent: the player keeps his short sample and nothing says why.
  it('reports a name that matches no current row rather than dropping it', () => {
    const { unmatchedNames, blended } = blendPriorSeason(current, prior, ['Ty Jerome', 'Ty Jerume']);
    expect(unmatchedNames).toEqual(['Ty Jerume']);
    expect(blended).toHaveLength(1);
  });

  it('reports a named player with no prior season instead of inventing one', () => {
    const { missingPrior, rows } = blendPriorSeason(current, [], ['Ty Jerome']);
    expect(missingPrior).toEqual(['Ty Jerome']);
    expect(rows[0].blended).toBe(false);
    expect(rows[0].epm).toBe(6.17);
  });

  it('summarises how much prior season was actually added', () => {
    const { blended } = blendPriorSeason(current, prior, ['Ty Jerome']);
    expect(blendSummary(blended)).toEqual({ players: 1, priorGames: 79, currentGames: 15 });
  });
});

// ── The committed artefact, checked against the rule that made it ───────────
//
// Same convention as generateSpecialSets.test.js: what the studio loads is the
// file, so what is asserted is the file.
describe('the generated budgets', () => {
  const totals = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, 'card-data', 'generated', 'speed-power-totals-2026.json'),
      'utf8'
    )
  );
  const forced = new Set(readForceInclude().map(p => p.name));
  const byName = new Map(totals.map(r => [r.name, r]));

  it('blends exactly the force-include list and nobody else', () => {
    const blended = totals.filter(r => r.blended).map(r => r.name).sort();
    expect(blended).toEqual([...forced].sort());
    expect(blended).toHaveLength(19);
  });

  it('records both samples, so a pooled game count cannot be mistaken for one season', () => {
    for (const name of forced) {
      const r = byName.get(name);
      expect(r.priorGames, name).toBeGreaterThan(0);
      expect(r.currentGames, name).toBeGreaterThan(0);
    }
  });

  // THE TWO ARTEFACTS THAT MOTIVATED THE WHOLE EXERCISE. Ty Jerome's 26 off
  // fifteen games was the seventh-highest budget in a 350-card set; Zach Edey's
  // 24 came off eleven. Pinned so that losing the blend would fail loudly.
  it('no longer prices a fifteen-game season into the top of the set', () => {
    const ranked = [...totals].sort((a, b) => b.speedPowerTotal - a.speedPowerTotal);
    const rank = name => ranked.findIndex(r => r.name === name) + 1;
    expect(byName.get('Ty Jerome').speedPowerTotal).toBe(23);
    expect(rank('Ty Jerome')).toBeGreaterThan(20);
    expect(byName.get('Zach Edey').speedPowerTotal).toBe(19);
  });
});
