import { describe, it, expect } from 'vitest';
import {
  FT_TRIP_FACTOR,
  RATE_DENOMINATORS,
  poolActualRow,
  poolActualSeasons,
  poolWeighted,
  poolSum,
  poolingSummary,
  volumes,
} from './poolSeasons.js';
import { attemptsFromPer75, fitShrinkage, possessionsFromMinutes } from './shooting.js';

/**
 * A row in `toActualSeasonRate`'s shape.
 *
 * Every attempt rate is spelled out rather than defaulted, because the whole
 * subject of this file is which volume weights which rate — a fixture that
 * quietly shares one attempt rate across rim, three and free throws could not
 * tell a correct denominator from a wrong one.
 */
const row = (over = {}) => ({
  name: 'Player One',
  personId: 100,
  team: 'SAS',
  position: 'C',
  age: 22,
  games: 60,
  minutes: 1800,
  mpg: 30,
  starts: 60,
  epm: 4,
  epmOff: 2,
  epmDef: 2,
  ewins: 12,
  ewinsPerGame: 0.2,
  usage: 0.3,
  tsPct: 0.6,
  efg: 0.55,
  fgPctRim: 0.7,
  fgPctMid: 0.4,
  fgPct2: 0.55,
  fgPct3: 0.36,
  ftPct: 0.8,
  fgaRimPer75: 6,
  fgaMidPer75: 4,
  fga3Per75: 5,
  ftaPer75: 4,
  fgaPer75: 15,
  orbPct: 0.08,
  drbPct: 0.3,
  astPct: 0.17,
  tovPct: 0.11,
  stlPct: 0.017,
  blkPct: 0.1,
  ...over,
});

describe('poolWeighted', () => {
  it('is the combined-sample rate, not the mean of two rates', () => {
    // 70 games at 0.50 and 10 at 0.30 is 0.475, not 0.40.
    expect(poolWeighted([{ value: 0.5, weight: 70 }, { value: 0.3, weight: 10 }])).toBeCloseTo(
      0.475,
      12
    );
  });

  it('drops a part with no value rather than folding in a zero', () => {
    // A centre who attempted no playoff threes has no playoff 3P% to pool. The
    // alternative — treating null as 0% — would invent misses he never took.
    expect(poolWeighted([{ value: 0.4, weight: 300 }, { value: null, weight: 40 }])).toBe(0.4);
  });

  it('drops a part with no weight', () => {
    expect(poolWeighted([{ value: 0.4, weight: 300 }, { value: 0.9, weight: 0 }])).toBe(0.4);
  });

  it('returns null when nothing is usable', () => {
    expect(poolWeighted([{ value: null, weight: 10 }])).toBeNull();
    expect(poolWeighted([])).toBeNull();
  });
});

describe('poolSum', () => {
  it('adds only the numbers present', () => {
    expect(poolSum([60, 22])).toBe(82);
    expect(poolSum([60, null])).toBe(60);
    expect(poolSum([null, undefined])).toBeNull();
  });
});

describe('volumes', () => {
  it('reconstructs attempts from the per-75 rates and total minutes', () => {
    const v = volumes(row({ minutes: 1800, fga3Per75: 5 }));
    expect(v.fga3).toBeCloseTo(attemptsFromPer75(5, 1800), 12);
    expect(v.possessions).toBeCloseTo(possessionsFromMinutes(1800), 12);
  });

  it('uses FGA + 0.44 * FTA as the true-shooting denominator', () => {
    const v = volumes(row());
    expect(v.tsa).toBeCloseTo(v.fga + FT_TRIP_FACTOR * v.fta, 12);
  });

  it('takes 2P attempts as FGA minus 3PA, not rim plus mid', () => {
    // rim + mid is a location split that need not account for every two-pointer:
    // 15 - 5 = 10 twos taken, of which the split accounts for only 6 + 2.5.
    const v = volumes(row({ fgaPer75: 15, fga3Per75: 5, fgaRimPer75: 6, fgaMidPer75: 2.5 }));
    expect(v.fga2).toBeCloseTo(v.fga - v.fga3, 12);
    expect(v.fga2).not.toBeCloseTo(v.fgaRim + v.fgaMid, 6);
  });

  it('is all zeroes for a row with no minutes', () => {
    const v = volumes(row({ minutes: 0, games: 0 }));
    expect(v.possessions).toBe(0);
    expect(v.fga).toBe(0);
    expect(v.tsa).toBe(0);
  });
});

describe('RATE_DENOMINATORS', () => {
  it('weights each shooting percentage by its own attempts', () => {
    expect(RATE_DENOMINATORS.tsPct).toBe('tsa');
    expect(RATE_DENOMINATORS.fgPctRim).toBe('fgaRim');
    expect(RATE_DENOMINATORS.fgPct3).toBe('fga3');
    expect(RATE_DENOMINATORS.ftPct).toBe('fta');
    expect(RATE_DENOMINATORS.fgPct2).toBe('fga2');
    expect(RATE_DENOMINATORS.efg).toBe('fga');
  });

  it('weights the per-100-possession impact rates by possessions', () => {
    for (const key of ['epm', 'epmOff', 'epmDef', 'usage']) {
      expect(RATE_DENOMINATORS[key]).toBe('possessions');
    }
  });

  it('does not try to weight the season totals as if they were rates', () => {
    for (const key of ['games', 'minutes', 'starts', 'ewins', 'mpg', 'ewinsPerGame']) {
      expect(RATE_DENOMINATORS[key]).toBeUndefined();
    }
  });
});

describe('poolActualRow — no playoff row', () => {
  it('returns the regular season untouched', () => {
    const rs = row();
    const pooled = poolActualRow(rs, null);
    for (const key of Object.keys(rs)) expect(pooled[key]).toBe(rs[key]);
    expect(pooled.playoffGames).toBe(0);
    expect(pooled.pooled).toBe(false);
  });

  it('treats a playoff row with no games and no minutes as no playoff row', () => {
    // 24 of the 254 playoff rows are exactly this: a roster spot that never
    // played. Folding one in must be a no-op, not a divide-by-zero.
    const rs = row();
    const dnp = row({ games: 0, minutes: 0, epm: null, tsPct: null });
    const pooled = poolActualRow(rs, dnp);
    expect(pooled.pooled).toBe(false);
    expect(pooled.games).toBe(60);
    expect(pooled.epm).toBe(4);
    expect(pooled.tsPct).toBe(0.6);
  });
});

describe('poolActualRow — per-stat denominators', () => {
  const rs = row({ games: 70, minutes: 2100 });
  const po = row({
    games: 20,
    minutes: 700,
    epm: 1,
    epmOff: 0,
    epmDef: 1,
    ewins: 2,
    ewinsPerGame: 0.1,
    tsPct: 0.5,
    fgPctRim: 0.6,
    fgPct3: 0.2,
    ftPct: 0.9,
    // Deliberately different attempt MIX: he shot far more threes and far fewer
    // rim attempts in the playoffs. A single shared denominator would get every
    // one of these percentages wrong.
    fgaRimPer75: 2,
    fga3Per75: 10,
    ftaPer75: 2,
    fgaPer75: 15,
  });
  const pooled = poolActualRow(rs, po);
  const vRs = volumes(rs);
  const vPo = volumes(po);
  const weighted = (key, wkey) => (rs[key] * vRs[wkey] + po[key] * vPo[wkey]) / (vRs[wkey] + vPo[wkey]);

  it('pools EPM, OFF and DEF by possessions', () => {
    expect(pooled.epm).toBeCloseTo(weighted('epm', 'possessions'), 12);
    expect(pooled.epmOff).toBeCloseTo(weighted('epmOff', 'possessions'), 12);
    expect(pooled.epmDef).toBeCloseTo(weighted('epmDef', 'possessions'), 12);
  });

  it('pools TS% by true shooting attempts, not by games or by FGA', () => {
    expect(pooled.tsPct).toBeCloseTo(weighted('tsPct', 'tsa'), 12);
    expect(pooled.tsPct).not.toBeCloseTo((rs.tsPct + po.tsPct) / 2, 4);
    expect(pooled.tsPct).not.toBeCloseTo(weighted('tsPct', 'games'), 6);
  });

  it('pools each location percentage by that location’s own attempts', () => {
    expect(pooled.fgPctRim).toBeCloseTo(weighted('fgPctRim', 'fgaRim'), 12);
    expect(pooled.fgPct3).toBeCloseTo(weighted('fgPct3', 'fga3'), 12);
    expect(pooled.ftPct).toBeCloseTo(weighted('ftPct', 'fta'), 12);
    // The mix really did differ, so the wrong denominator gives a wrong answer —
    // which is what makes the assertions above worth making.
    expect(pooled.fgPctRim).not.toBeCloseTo(weighted('fgPctRim', 'fga3'), 4);
  });

  it('pools EW/GP by games played', () => {
    const byGames = (rs.ewinsPerGame * rs.games + po.ewinsPerGame * po.games) / (rs.games + po.games);
    expect(pooled.ewinsPerGame).toBeCloseTo(byGames, 12);
  });

  it('sums the season totals and re-derives minutes per game', () => {
    expect(pooled.games).toBe(90);
    expect(pooled.minutes).toBe(2800);
    expect(pooled.ewins).toBeCloseTo(rs.ewins + po.ewins, 12);
    expect(pooled.mpg).toBeCloseTo(2800 / 90, 12);
  });

  it('records how much of the sample is postseason', () => {
    expect(pooled.pooled).toBe(true);
    expect(pooled.regularGames).toBe(70);
    expect(pooled.playoffGames).toBe(20);
    expect(pooled.playoffMinutes).toBe(700);
  });

  it('keeps the pooled rate strictly between the two it came from', () => {
    expect(pooled.epm).toBeGreaterThan(po.epm);
    expect(pooled.epm).toBeLessThan(rs.epm);
  });

  it('leans toward the larger sample rather than splitting the difference', () => {
    // 2100 regular-season minutes against 700 playoff minutes: the pooled EPM
    // must sit nearer the regular season than the midpoint does.
    const midpoint = (rs.epm + po.epm) / 2;
    expect(Math.abs(pooled.epm - rs.epm)).toBeLessThan(Math.abs(midpoint - rs.epm));
  });
});

describe('poolActualRow — missing pieces on one side', () => {
  it('keeps the regular-season EPM when the source withheld a playoff one', () => {
    // dunksandthrees publishes no EPM or EW below fifty minutes, and 74 of the
    // 254 playoff rows fall under that line while carrying real games.
    const rs = row();
    const po = row({ games: 4, minutes: 40, epm: null, epmOff: null, epmDef: null, ewins: null, ewinsPerGame: null });
    const pooled = poolActualRow(rs, po);
    expect(pooled.epm).toBe(rs.epm);
    expect(pooled.epmDef).toBe(rs.epmDef);
  });

  it('does not dilute EW/GP with games the source declined to rate', () => {
    // The trap: summing EW (regular season only) over pooled games would credit
    // zero expected wins to those four playoff games and mark him down for
    // having qualified.
    const rs = row({ games: 60, ewins: 12, ewinsPerGame: 0.2 });
    const po = row({ games: 4, minutes: 40, ewins: null, ewinsPerGame: null });
    const pooled = poolActualRow(rs, po);
    expect(pooled.ewinsPerGame).toBe(0.2);
    expect(pooled.ewinsPerGame).not.toBeCloseTo(12 / 64, 6);
  });

  it('still pools the shooting a short playoff appearance did produce', () => {
    const rs = row();
    const po = row({ games: 4, minutes: 40, epm: null, ewins: null, ewinsPerGame: null, tsPct: 0.4 });
    const pooled = poolActualRow(rs, po);
    expect(pooled.tsPct).toBeLessThan(rs.tsPct);
    expect(pooled.tsPct).toBeGreaterThan(po.tsPct);
  });

  it('keeps a playoff row with no regular-season partner', () => {
    const po = row({ games: 10, minutes: 300 });
    const pooled = poolActualRow(null, po);
    expect(pooled.name).toBe('Player One');
    expect(pooled.games).toBe(10);
    expect(pooled.regularGames).toBe(0);
    expect(pooled.playoffGames).toBe(10);
  });
});

describe('poolActualRow — attempts pool before the shrinkage sees them', () => {
  // The interaction that matters: shooting.js gates a boost on attempt volume,
  // so a deep playoff run must ease the gate. It does, and it does so without
  // shooting.js knowing pooling exists — the pooled per-75 rate multiplied by
  // pooled minutes is exactly regular-season attempts plus playoff attempts.
  const rs = row({ games: 70, minutes: 2100, fga3Per75: 5 });
  const po = row({ games: 22, minutes: 750, fga3Per75: 9, fgPct3: 0.2 });
  const pooled = poolActualRow(rs, po);

  it('reproduces the summed attempt count exactly', () => {
    const separate = attemptsFromPer75(5, 2100) + attemptsFromPer75(9, 750);
    const fromPooledRow = attemptsFromPer75(pooled.fga3Per75, pooled.minutes);
    expect(fromPooledRow).toBeCloseTo(separate, 9);
  });

  it('shrinks the pooled percentage less than the regular season alone', () => {
    const league = [
      { pct: 0.36, n: 400 },
      { pct: 0.34, n: 380 },
      { pct: 0.38, n: 420 },
      { pct: 0.3, n: 300 },
      { pct: 0.4, n: 450 },
      { pct: 0.28, n: 120 },
    ];
    const shrink = fitShrinkage(league);
    const rsAttempts = attemptsFromPer75(rs.fga3Per75, rs.minutes);
    const pooledAttempts = attemptsFromPer75(pooled.fga3Per75, pooled.minutes);
    expect(pooledAttempts).toBeGreaterThan(rsAttempts);

    // Same observed percentage, more attempts behind it: the adjusted figure
    // must sit further from the league mean, i.e. be trusted more.
    const pct = 0.3;
    const distance = n => Math.abs(shrink.apply(pct, n) - shrink.mean);
    expect(distance(pooledAttempts)).toBeGreaterThan(distance(rsAttempts));
  });
});

describe('poolActualSeasons', () => {
  const rs = [
    row({ name: 'Deep Run', personId: 1 }),
    row({ name: 'Missed Playoffs', personId: 2, epm: 1, tsPct: 0.52 }),
  ];
  const po = [row({ name: 'Deep Run', personId: 1, games: 22, minutes: 750, epm: 6 })];

  it('folds in a playoff row and leaves the rest alone', () => {
    const pooled = poolActualSeasons(rs, po);
    expect(pooled).toHaveLength(2);
    const [deep, missed] = pooled;
    expect(deep.pooled).toBe(true);
    expect(deep.games).toBe(82);
    expect(missed.pooled).toBe(false);
    expect(missed.games).toBe(60);
    expect(missed.epm).toBe(1);
    expect(missed.tsPct).toBe(0.52);
  });

  it('matches on player id even when the name is spelled differently', () => {
    const renamed = [row({ name: 'Deep  Run Jr.', personId: 1, games: 22, minutes: 750 })];
    const pooled = poolActualSeasons(rs, renamed);
    expect(pooled[0].playoffGames).toBe(22);
    // The pooled row keeps the regular season's spelling, which is the one every
    // downstream index was built against.
    expect(pooled[0].name).toBe('Deep Run');
  });

  it('falls back to the normalized name when there is no id', () => {
    const noId = [row({ name: 'deep run', personId: null, games: 22, minutes: 750 })];
    const pooled = poolActualSeasons([row({ name: 'Deep Run', personId: null })], noId);
    expect(pooled[0].playoffGames).toBe(22);
  });

  it('is a pure passthrough when there are no playoffs at all', () => {
    const pooled = poolActualSeasons(rs, []);
    expect(pooled).toHaveLength(2);
    for (const p of pooled) expect(p.pooled).toBe(false);
    expect(pooled[0].epm).toBe(rs[0].epm);
  });

  it('keeps a playoff-only player rather than dropping him', () => {
    const orphan = [row({ name: 'Orphan', personId: 9, games: 5, minutes: 150 })];
    const pooled = poolActualSeasons(rs, [...po, ...orphan]);
    expect(pooled.map(p => p.name)).toContain('Orphan');
  });
});

describe('poolingSummary', () => {
  it('counts only the players who actually gained games', () => {
    const summary = poolingSummary([
      { playoffGames: 22 },
      { playoffGames: 0 },
      { playoffGames: 6 },
      { playoffGames: 0 },
    ]);
    expect(summary.players).toBe(4);
    expect(summary.gained).toBe(2);
    expect(summary.playoffGames).toBe(28);
    expect(summary.maxPlayoffGames).toBe(22);
  });

  it('reports zeroes for a pool with no postseason', () => {
    const summary = poolingSummary([{ playoffGames: 0 }]);
    expect(summary.gained).toBe(0);
    expect(summary.playoffGames).toBe(0);
    expect(summary.maxPlayoffGames).toBe(0);
  });
});
