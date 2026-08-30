import { describe, it, expect } from 'vitest';
import {
  FT_TRIP_FACTOR,
  PER_100_COUNTS,
  per4MinFromTotals,
  RATE_DENOMINATORS,
  buildPool,
  cardedRows,
  joinWnbaSeason,
  poolSeasonRows,
  poolWeighted,
  readForceInclude,
  resolveDisplayTeams,
  volumes,
  wnbaFeatureRow,
} from './pool.js';
import {
  NBA_PER_100_TO_PER_4MIN,
  nbaConventionPer100,
  SECTIONS_PER_GAME,
  WNBA_GAME_MINUTES,
  WNBA_LEAGUE_PACE,
  WNBA_POOL_RULE,
  leaguePace,
  per4MinFromPer100,
  possessionsPerSection,
  toNbaConventionPer100,
} from './constants.js';

const player = (over = {}) => ({
  playerId: 'x01w',
  name: 'X',
  team: 'MIN',
  pos: 'F',
  season: 2026,
  games: 40,
  minutes: 1200,
  mpg: 30,
  ...over,
});

describe('the 40-minute game', () => {
  it('says a four-minute section is pace x 4/40, not the NBA 4/48', () => {
    expect(SECTIONS_PER_GAME).toBe(10);
    expect(WNBA_GAME_MINUTES).toBe(40);
    // 79.24 possessions per 40 minutes -> 7.924 in a four-minute section.
    expect(possessionsPerSection(79.24)).toBeCloseTo(7.924, 3);
    // The NBA convention, for comparison: 100 possessions per 48 minutes.
    expect(100 * NBA_PER_100_TO_PER_4MIN).toBeCloseTo(8.333, 3);
  });

  it('makes a WNBA section SMALLER than an NBA one, not bigger', () => {
    // The trap: correcting only for the shorter game says 20% MORE possessions
    // per section. The slower league takes all of that back and a little more.
    const wnba = possessionsPerSection(leaguePace(2026));
    expect(wnba).toBeLessThan(100 * NBA_PER_100_TO_PER_4MIN);
    expect(wnba / (100 * NBA_PER_100_TO_PER_4MIN)).toBeCloseTo(0.951, 2);
  });

  it('measures the pace per season rather than assuming one', () => {
    expect(WNBA_LEAGUE_PACE[2025]).not.toBe(WNBA_LEAGUE_PACE[2026]);
    expect(leaguePace(2025)).toBe(WNBA_LEAGUE_PACE[2025]);
    // An unknown season falls back to the set's own rather than to NaN.
    expect(leaguePace(1999)).toBe(WNBA_LEAGUE_PACE[2026]);
  });

  it('anchors the chart on TOTALS, so no pace enters the path at all', () => {
    // 4 * 962 points / 1185 minutes — A'ja Wilson's real 2026 line. The per-100
    // route would have said 40.9 * 0.07924 = 3.241: 0.2% out for her, because
    // Las Vegas play at the league's pace, and 6% out for a Golden State player,
    // because BBRef's per-100 is against her own TEAM's pace and the conversion
    // back can only use the league's.
    expect(per4MinFromTotals(962, 1185)).toBeCloseTo(3.2473, 4);
    // And the unit change into what variance.js reads is exact, not an estimate.
    const per4 = per4MinFromTotals(962, 1185);
    expect(nbaConventionPer100(per4) * NBA_PER_100_TO_PER_4MIN).toBeCloseTo(per4, 12);
  });

  it('has no answer for zero minutes rather than dividing by zero', () => {
    expect(per4MinFromTotals(100, 0)).toBe(0);
    expect(per4MinFromTotals(null, 100)).toBe(0);
  });

  it('restates a WNBA per-100 so variance.js\'s own 4/48 lands on the right per-4', () => {
    // The one substitution that carries the whole correction — see constants.js.
    const per100 = 30;
    const real = per4MinFromPer100(per100);
    expect(toNbaConventionPer100(per100) * NBA_PER_100_TO_PER_4MIN).toBeCloseTo(real, 10);
  });

  it('gives variance.js the right per-36 covariate for free', () => {
    // variance.js reads `per100 * 36/48` as per-36 production. Per-36 is nine
    // times per-4-minute in either league, so the same substitution fixes both.
    const per100 = 24;
    const input = toNbaConventionPer100(per100);
    expect(input * (36 / 48)).toBeCloseTo(9 * per4MinFromPer100(per100), 10);
  });
});

describe('buildPool', () => {
  const league = [
    player({ playerId: 'a', name: 'Passes', mpg: 20, games: 30 }),
    player({ playerId: 'b', name: 'Too Few Minutes', mpg: 15.9, games: 40 }),
    player({ playerId: 'c', name: 'Too Few Games', mpg: 30, games: 19 }),
    player({ playerId: 'd', name: 'Star Hurt', mpg: 30, games: 11 }),
  ];

  it('applies the declared bar', () => {
    expect(WNBA_POOL_RULE).toEqual({ minMpg: 16, minGames: 20 });
    const { pool, byRule } = buildPool(league, { forceInclude: [] });
    expect(byRule).toBe(1);
    expect(pool.map(p => p.name)).toEqual(['Passes']);
  });

  it('composes with the list rather than being replaced by it — a name can only ADD', () => {
    const { pool, forced } = buildPool(league, { forceInclude: [{ name: 'Star Hurt' }] });
    expect(pool.map(p => p.name).sort()).toEqual(['Passes', 'Star Hurt']);
    expect(forced.map(p => p.name)).toEqual(['Star Hurt']);
  });

  it('naming someone the rule already admits changes nothing', () => {
    const { pool, forced } = buildPool(league, { forceInclude: [{ name: 'Passes' }] });
    expect(pool.map(p => p.name)).toEqual(['Passes']);
    expect(forced).toEqual([]);
  });

  it('reports a name that matches no row instead of leaving the pool short', () => {
    // A misspelling is otherwise completely silent: the player simply never
    // appears and nothing says why.
    const { unmatched } = buildPool(league, { forceInclude: [{ name: 'Nobody At All' }] });
    expect(unmatched).toEqual(['Nobody At All']);
  });

  it('matches names through the same normaliser every other join uses', () => {
    const { pool } = buildPool([player({ name: 'Betnijah Laney-Hamilton', mpg: 10, games: 5 })], {
      forceInclude: [{ name: 'betnijah laneyhamilton' }],
    });
    expect(pool).toHaveLength(1);
  });
});

describe('the committed force-include list', () => {
  const list = readForceInclude();

  it('names exactly the seven the user chose, each with its reason', () => {
    expect(list.map(f => f.name).sort()).toEqual([
      'Brittney Griner',
      'Brittney Sykes',
      'DiJonai Carrington',
      'Kelsey Plum',
      'Leonie Fiebich',
      'Napheesa Collier',
      'Skylar Diggins',
    ]);
    for (const entry of list) expect(entry.reason).toMatch(/\d+ G at \d/);
  });

  it('says which of them is not an injury case', () => {
    // Six are injury exceptions chosen against a stated standard (25+ MPG when
    // healthy). Carrington is a direct user pick who does not meet it, and the
    // file is required to SAY so rather than quietly widening what "injury-
    // shortened" is allowed to mean — otherwise the next person reads seven
    // injuries and takes the standard to be looser than it is.
    const byName = Object.fromEntries(list.map(f => [f.name, f.reason]));
    expect(byName['DiJonai Carrington']).toMatch(/user pick/i);
    // `injury-shortened` is the marker the six carry, and it is what this
    // asserts on — not the bare word "injury", which her reason legitimately
    // contains in the phrase that says she is NOT one.
    const injuries = list.filter(f => /injury-shortened/.test(f.reason));
    expect(injuries.map(f => f.name)).not.toContain('DiJonai Carrington');
    expect(injuries).toHaveLength(6);
  });

  it('drops the _comment, which is documentation and not a player', () => {
    expect(list.map(f => f.name)).not.toContain('_comment');
  });
});

describe('resolveDisplayTeams', () => {
  it('gives a TOT player the team she FINISHED the season on', () => {
    // Kelsey Plum's real 2026 rows. The old rule was "most games", which put
    // her on the Sparks — the wrong answer, and the one the user reported: a
    // card prints where a player IS.
    const splits = [
      { playerId: 'p', team: 'TOT', games: 17, minutes: 519 },
      { playerId: 'p', team: 'LAS', games: 12, minutes: 380 },
      { playerId: 'p', team: 'PHO', games: 5, minutes: 139 },
    ];
    expect(resolveDisplayTeams(splits).get('p')).toBe('PHO');
  });

  it('does not care how few games the last stint was', () => {
    // A one-game stint after forty is still where she is. There is no
    // threshold, because a threshold would be a second rule to get wrong.
    const splits = [
      { playerId: 'p', team: 'CHI', games: 40, minutes: 1200 },
      { playerId: 'p', team: 'PHO', games: 1, minutes: 6 },
    ];
    expect(resolveDisplayTeams(splits).get('p')).toBe('PHO');
  });

  it('reads three stints in order, not by size', () => {
    // Kiana Williams: PHO, then LAS, then TOR. LAS has the most games.
    const splits = [
      { playerId: 'p', team: 'TOT', games: 24, minutes: 300 },
      { playerId: 'p', team: 'PHO', games: 8, minutes: 90 },
      { playerId: 'p', team: 'LAS', games: 13, minutes: 170 },
      { playerId: 'p', team: 'TOR', games: 3, minutes: 40 },
    ];
    expect(resolveDisplayTeams(splits).get('p')).toBe('TOR');
  });

  it('never answers with an aggregate code', () => {
    const splits = [{ playerId: 'p', team: 'TOT', games: 40, minutes: 1200 }];
    expect(resolveDisplayTeams(splits).has('p')).toBe(false);
  });
});

describe('poolWeighted', () => {
  it('is a volume-weighted mean, not an average of two rates', () => {
    // The rule poolSeasons.js states and this follows: an 11-game season must
    // not get the same say as a 44-game one.
    expect(
      poolWeighted([
        { value: 30, weight: 300 },
        { value: 20, weight: 900 },
      ])
    ).toBe(22.5);
    expect((30 + 20) / 2).not.toBe(22.5);
  });

  it('DROPS a part with no value rather than treating it as zero', () => {
    // A player who attempted no threes in one season has no 3P% to fold in;
    // folding in a zero would invent an 0-for-however-many she never took.
    expect(poolWeighted([{ value: null, weight: 900 }, { value: 0.4, weight: 100 }])).toBe(0.4);
    expect(poolWeighted([])).toBeNull();
  });
});

describe('volumes', () => {
  it('uses REAL attempt totals, not a reconstruction from a rate and a pace', () => {
    const v = volumes(player({ fgaTotal: 400, ftaTotal: 100, fg3aTotal: 150, fg2aTotal: 250 }));
    expect(v.fga).toBe(400);
    expect(v.tsa).toBeCloseTo(400 + FT_TRIP_FACTOR * 100, 6);
  });

  it('computes possessions at THAT season\'s pace, which does not cancel across seasons', () => {
    const a = volumes(player({ season: 2025, minutes: 1000 }));
    const b = volumes(player({ season: 2026, minutes: 1000 }));
    expect(a.possessions).not.toBeCloseTo(b.possessions, 3);
    expect(b.possessions / a.possessions).toBeCloseTo(
      WNBA_LEAGUE_PACE[2026] / WNBA_LEAGUE_PACE[2025],
      6
    );
  });
});

describe('poolSeasonRows', () => {
  it('passes a single season through untouched', () => {
    const one = player({ pts100: 25, tsPct: 0.55 });
    const out = poolSeasonRows([one]);
    expect(out.blended).toBe(false);
    expect(out.pts100).toBe(25);
    expect(out.tsPct).toBe(0.55);
    expect(out.games).toBe(one.games);
  });

  it('sums the season totals', () => {
    const out = poolSeasonRows([
      player({ season: 2025, games: 33, minutes: 1065, ws: 5.0, starts: 33 }),
      player({ season: 2026, games: 11, minutes: 330, ws: 1.6, starts: 11 }),
    ]);
    expect(out.games).toBe(44);
    expect(out.minutes).toBe(1395);
    expect(out.ws).toBeCloseTo(6.6, 6);
    expect(out.mpg).toBeCloseTo(1395 / 44, 6);
    // Re-derived from the pooled totals, per FORTY minutes.
    expect(out.wsPer40).toBeCloseTo((6.6 * 40) / 1395, 6);
    expect(out.seasonsPooled).toEqual([2025, 2026]);
    expect(out.blended).toBe(true);
  });

  it('weights TS% by TRUE SHOOTING ATTEMPTS, not by games or by minutes', () => {
    // TS% = PTS / (2 * (FGA + 0.44*FTA)), so its denominator is TSA. Weighting
    // it by anything else gives a number that is not any season's TS%.
    const a = player({ season: 2025, minutes: 1000, tsPct: 0.5, fgaTotal: 400, ftaTotal: 0 });
    const b = player({ season: 2026, minutes: 1000, tsPct: 0.6, fgaTotal: 100, ftaTotal: 0 });
    const out = poolSeasonRows([a, b]);
    expect(out.tsPct).toBeCloseTo((0.5 * 400 + 0.6 * 100) / 500, 6);
    // Equal minutes, so a minutes-weighted fold would have said 0.55.
    expect(out.tsPct).not.toBeCloseTo(0.55, 3);
  });

  it('weights each shooting percentage by ITS OWN attempts', () => {
    expect(RATE_DENOMINATORS.fgPct3).toBe('fg3a');
    expect(RATE_DENOMINATORS.fgPct2).toBe('fg2a');
    expect(RATE_DENOMINATORS.ftPct).toBe('fta');
    const out = poolSeasonRows([
      player({ season: 2025, fgPct3: 0.3, fg3aTotal: 10, fg2aTotal: 500, fgPct2: 0.5 }),
      player({ season: 2026, fgPct3: 0.5, fg3aTotal: 90, fg2aTotal: 100, fgPct2: 0.6 }),
    ]);
    expect(out.fgPct3).toBeCloseTo((0.3 * 10 + 0.5 * 90) / 100, 6);
    expect(out.fgPct2).toBeCloseTo((0.5 * 500 + 0.6 * 100) / 600, 6);
  });

  it('pools the per-100 COUNTS through per-four-minute production', () => {
    // Not on possessions, because the two seasons' possessions are not the same
    // length of time — 2025 ran at 77.32 per 40 minutes and 2026 at 79.24. What
    // a scoring chart pays out over is four MINUTES.
    for (const key of PER_100_COUNTS) expect(RATE_DENOMINATORS[key]).toBeUndefined();
    const a = player({ season: 2025, minutes: 1000, pts100: 30 });
    const b = player({ season: 2026, minutes: 1000, pts100: 30 });
    const out = poolSeasonRows([a, b]);
    const expected =
      ((30 * leaguePace(2025)) / 1000 + (30 * leaguePace(2026)) / 1000) / 2;
    expect(per4MinFromPer100(out.pts100, 2026)).toBeCloseTo(expected, 9);
    // The pooled figure is restated in 2026 units, so it is NOT simply 30.
    expect(out.pts100).not.toBeCloseTo(30, 3);
  });

  it('sums the counting totals, which makes the blended chart EXACT', () => {
    // Pooled per-four-minute production is 4 * (pts_a + pts_b) / (min_a +
    // min_b) — the rate the two seasons would have produced had they never been
    // split. There is no weighting scheme here to get wrong.
    const out = poolSeasonRows([
      player({ season: 2025, games: 33, minutes: 1065, ptsTotal: 660, trbTotal: 250, astTotal: 100 }),
      player({ season: 2026, games: 11, minutes: 330, ptsTotal: 199, trbTotal: 81, astTotal: 31 }),
    ]);
    expect(out.ptsTotal).toBe(859);
    expect(out.minutes).toBe(1395);
    expect(per4MinFromTotals(out.ptsTotal, out.minutes)).toBeCloseTo((4 * 859) / 1395, 9);
  });

  it('keeps the parts, so the blend can be checked by hand', () => {
    const out = poolSeasonRows([
      player({ season: 2025, games: 33, minutes: 1065 }),
      player({ season: 2026, games: 11, minutes: 330 }),
    ]);
    expect(out.parts.map(p => p.season)).toEqual([2025, 2026]);
    expect(out.parts.map(p => p.games)).toEqual([33, 11]);
  });

  it('takes identity from the TARGET season, so the card is not labelled by the old one', () => {
    const out = poolSeasonRows([
      player({ season: 2025, team: 'LVA', pos: 'C' }),
      player({ season: 2026, team: 'LAS', pos: 'G' }),
    ]);
    expect(out.team).toBe('LAS');
    expect(out.season).toBe(2026);
  });
});

describe('cardedRows', () => {
  const pool = [
    player({ playerId: 'star', name: 'Star', games: 11, minutes: 330 }),
    player({ playerId: 'ordinary', name: 'Ordinary' }),
  ];
  const prior = [
    player({ playerId: 'star', name: 'Star', season: 2025, games: 33, minutes: 1065 }),
    player({ playerId: 'ordinary', name: 'Ordinary', season: 2025, games: 40, minutes: 1300 }),
  ];

  it('blends ONLY the named players, even when a prior season exists for everyone', () => {
    const out = cardedRows({ pool, blendRows: prior, blendIds: new Set(['star']) });
    expect(out.find(r => r.name === 'Star').games).toBe(44);
    expect(out.find(r => r.name === 'Ordinary').games).toBe(40);
    expect(out.find(r => r.name === 'Ordinary').blended).toBe(false);
  });

  it('matches on the Basketball-Reference id, never on the name', () => {
    const renamed = [{ ...prior[0], name: 'Star (Married Name)' }];
    const out = cardedRows({ pool, blendRows: renamed, blendIds: new Set(['star']) });
    expect(out.find(r => r.playerId === 'star').games).toBe(44);
  });

  it('records when a named player has no prior season rather than silently not blending', () => {
    const out = cardedRows({ pool, blendRows: [], blendIds: new Set(['star']) });
    expect(out.find(r => r.playerId === 'star').blendMissing).toBe(2025);
  });
});

describe('wnbaFeatureRow', () => {
  it('divides minutes by a FORTY-minute game, not a forty-eight-minute one', () => {
    const row = wnbaFeatureRow(player({ games: 40, minutes: 1200 }));
    expect(row.minShare).toBeCloseTo(1200 / (40 * 40), 9);
    expect(row.league).toBe('wnba');
  });

  it('uses WS per 40 as the Win Shares rate', () => {
    const row = wnbaFeatureRow(player({ ws: 6.6, minutes: 1395, wsPer40: 0.189 }));
    expect(row.wsRate).toBe(0.189);
    // And falls back to the identity when the column is absent.
    const derived = wnbaFeatureRow(player({ ws: 6.6, minutes: 1395, wsPer40: null }));
    expect(derived.wsRate).toBeCloseTo((6.6 * 40) / 1395, 9);
  });

  it('collapses the position to the three the WNBA lists', () => {
    expect(wnbaFeatureRow(player({ pos: 'G-F' })).posGroup).toBe('G');
    expect(wnbaFeatureRow(player({ pos: 'C-F' })).posGroup).toBe('C');
  });
});

describe('joinWnbaSeason', () => {
  it('turns attempts per game into season totals, exactly', () => {
    const joined = joinWnbaSeason({
      season: 2026,
      perGame: [{ playerId: 'p', name: 'P', team: 'MIN', games: 40, minutes: 1200, fga: 10, fg3a: 4, fg2a: 6, fta: 3 }],
      advanced: [],
      perPoss: [],
    });
    expect(joined[0].fgaTotal).toBe(400);
    expect(joined[0].fg3aTotal).toBe(160);
    expect(joined[0].ftaTotal).toBe(120);
  });

  it('survives a player missing from one of the three tables', () => {
    const joined = joinWnbaSeason({
      season: 2026,
      perGame: [{ playerId: 'p', name: 'P', team: 'MIN', games: 4, minutes: 40 }],
      advanced: [],
      perPoss: [],
    });
    expect(joined).toHaveLength(1);
    expect(joined[0].per).toBeNull();
    expect(joined[0].pts100).toBeNull();
  });
});
