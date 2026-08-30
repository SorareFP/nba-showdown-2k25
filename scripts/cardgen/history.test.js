import { describe, it, expect } from 'vitest';
import {
  BEST_SEASON_METRIC_SETS,
  BEST_SEASON_MIN_MINUTES,
  BEST_SEASON_WEIGHTS,
  bestSeason,
  bestSeasonByMetricSet,
  careerSeasons,
  metricsDisagree,
  perMetricBest,
  rookieSeason,
  seasonFromRows,
  seasonScore,
  zAgainstSeason,
} from './history.js';
import { ARCHIVED_METRICS, dedupeForDistribution, seasonDistribution } from './fetchHistory.js';

const row = (over = {}) => ({
  season: 2020,
  playerId: 'testpl01',
  name: 'Test Player',
  team: 'BOS',
  games: 70,
  minutes: 2000,
  bpm: 2,
  vorp: 2,
  ws: 6,
  ws48: 0.14,
  ...over,
});

/** Every archived metric measured in plain sd units above a zero mean. */
const flatDistribution = {
  metrics: Object.fromEntries(ARCHIVED_METRICS.map(m => [m, { mean: 0, sd: 1 }])),
};

describe('zAgainstSeason', () => {
  it('scores a value against that season\'s own mean and spread', () => {
    expect(zAgainstSeason(3, { mean: 1, sd: 2 })).toBe(1);
  });

  it('returns 0 rather than dividing by a zero spread', () => {
    expect(zAgainstSeason(3, { mean: 1, sd: 0 })).toBe(0);
    expect(zAgainstSeason(3, null)).toBe(0);
    expect(zAgainstSeason(null, { mean: 1, sd: 2 })).toBe(0);
  });
});

describe('seasonScore — the combining rule', () => {
  it('scores on BPM alone', () => {
    const { score } = seasonScore({ bpm: 2, vorp: 1, ws: 3, ws48: 2 }, flatDistribution);
    expect(score).toBe(2);
  });

  it('IGNORES WIN SHARES ENTIRELY — the change this rule exists to make', () => {
    // Win Shares allocates TEAM wins, so it docks a good player on a bad team
    // and flatters a rotation player on a good one. The whole point of the
    // removal is that no amount of it can move the pick any more: same BPM,
    // wildly different WS and WS/48, identical score.
    const badTeam = seasonScore({ bpm: 5, vorp: 4, ws: 3, ws48: 0.08 }, flatDistribution);
    const goodTeam = seasonScore({ bpm: 5, vorp: 4, ws: 14, ws48: 0.26 }, flatDistribution);
    expect(badTeam.score).toBe(goodTeam.score);
  });

  it('still records every archived metric\'s z, including the dropped two', () => {
    // The rule ignores WS; the RECORD does not, because "what would Win Shares
    // have chosen" is the evidence for what the removal did.
    const { z } = seasonScore({ bpm: 2, vorp: 1, ws: 3, ws48: 2 }, flatDistribution);
    expect(z).toEqual({ bpm: 2, vorp: 1, ws: 3, ws48: 2 });
  });

  it('takes its metric set from the weights, so swapping is one line', () => {
    // BPM+VORP is the alternative on the table: it restores the volume
    // dimension BPM-only gives up, without restoring Win Shares' team bias.
    const s = seasonScore({ bpm: 4, vorp: 2, ws: 40, ws48: 40 }, flatDistribution, {
      bpm: 1,
      vorp: 1,
    });
    expect(s.score).toBe(3);
  });

  it('declares the active rule as BPM only, with BPM+VORP alongside it', () => {
    expect(BEST_SEASON_WEIGHTS).toBe(BEST_SEASON_METRIC_SETS.bpmOnly);
    expect(Object.keys(BEST_SEASON_WEIGHTS)).toEqual(['bpm']);
    expect(Object.keys(BEST_SEASON_METRIC_SETS.bpmVorp).sort()).toEqual(['bpm', 'vorp']);
    // Neither declared set may reach for a Win Shares column.
    for (const weights of Object.values(BEST_SEASON_METRIC_SETS)) {
      expect(Object.keys(weights)).not.toContain('ws');
      expect(Object.keys(weights)).not.toContain('ws48');
    }
  });
});

describe('seasonFromRows', () => {
  it('takes the whole-season aggregate as the stat line', () => {
    const season = seasonFromRows([
      row({ team: '2TM', games: 70, minutes: 2000, ws: 6 }),
      row({ team: 'BOS', games: 40, minutes: 1100, ws: 3.5 }),
      row({ team: 'MIA', games: 30, minutes: 900, ws: 2.5 }),
    ]);
    expect(season.ws).toBe(6);
    expect(season.games).toBe(70);
  });

  it('takes the TEAM from the split he played the most minutes for', () => {
    // Not the most games: a deadline trade can leave a player with more
    // appearances for the team he finished with while the season was spent
    // somewhere else.
    const season = seasonFromRows([
      row({ team: '2TM', games: 70, minutes: 2000 }),
      row({ team: 'BOS', games: 30, minutes: 1400 }),
      row({ team: 'MIA', games: 40, minutes: 600 }),
    ]);
    expect(season.team).toBe('BOS');
    expect(season.traded).toBe(true);
    expect(season.teams.sort()).toEqual(['BOS', 'MIA']);
  });

  it('never puts an aggregate code on a card', () => {
    for (const code of ['TOT', '2TM', '3TM', '5TM']) {
      const season = seasonFromRows([
        row({ team: code }),
        row({ team: 'PHX', minutes: 900 }),
      ]);
      expect(season.team).toBe('PHX');
    }
  });

  it('leaves a single-team season entirely alone', () => {
    const season = seasonFromRows([row({ team: 'DEN' })]);
    expect(season.team).toBe('DEN');
    expect(season.traded).toBe(false);
    expect(season.partialSeason).toBe(false);
  });

  it('marks a season it could only assemble from splits', () => {
    // Half a season's counting stats would score far too low if it were
    // silently treated as the whole thing, so the case is flagged rather than
    // dropped or hidden.
    const season = seasonFromRows([
      row({ team: 'BOS', minutes: 1100 }),
      row({ team: 'MIA', minutes: 900 }),
    ]);
    expect(season.partialSeason).toBe(true);
    expect(season.team).toBe('BOS');
  });
});

describe('careerSeasons', () => {
  it('collapses each season and orders the career forward', () => {
    const seasons = careerSeasons([
      row({ season: 2022 }),
      row({ season: 2020, team: '2TM' }),
      row({ season: 2020, team: 'SEA', minutes: 1500 }),
      row({ season: 2021 }),
    ]);
    expect(seasons.map(s => s.season)).toEqual([2020, 2021, 2022]);
    expect(seasons[0].team).toBe('SEA');
  });

  it('returns nothing for a player with no rows', () => {
    expect(careerSeasons([])).toEqual([]);
  });
});

describe('bestSeason', () => {
  const distributions = { 2019: flatDistribution, 2020: flatDistribution, 2021: flatDistribution };

  it('picks the highest-scoring season', () => {
    const { best } = bestSeason(
      [
        row({ season: 2019, bpm: 1, vorp: 1, ws: 1, ws48: 1 }),
        row({ season: 2020, bpm: 5, vorp: 5, ws: 5, ws48: 5 }),
        row({ season: 2021, bpm: 3, vorp: 3, ws: 3, ws48: 3 }),
      ],
      distributions
    );
    expect(best.season).toBe(2020);
  });

  it('ignores a spectacular season nobody played', () => {
    // The whole reason the floor exists: a rate over 300 minutes is one good
    // month, and without this the set fills up with them.
    const { best } = bestSeason(
      [
        row({ season: 2019, minutes: 300, bpm: 9, vorp: 9, ws: 9, ws48: 9 }),
        row({ season: 2020, minutes: 2400, bpm: 3, vorp: 3, ws: 3, ws48: 3 }),
      ],
      distributions
    );
    expect(best.season).toBe(2020);
    expect(BEST_SEASON_MIN_MINUTES).toBe(1000);
  });

  it('drops the floor rather than the player when no season clears it', () => {
    const { best, usedFallbackFloor } = bestSeason(
      [
        row({ season: 2019, minutes: 200, bpm: 1, vorp: 1, ws: 1, ws48: 1 }),
        row({ season: 2020, minutes: 400, bpm: 3, vorp: 3, ws: 3, ws48: 3 }),
      ],
      distributions
    );
    expect(best.season).toBe(2020);
    expect(usedFallbackFloor).toBe(true);
  });

  it('scores every season, not just the winner', () => {
    const { scored } = bestSeason([row({ season: 2020 }), row({ season: 2021 })], distributions);
    expect(scored).toHaveLength(2);
    for (const s of scored) expect(s.z).toHaveProperty('bpm');
  });

  it('WILL take the shorter season when its rate is higher — the known cost', () => {
    // Pinned deliberately, because it is the price of dropping the volume
    // metrics and the user was told about it. Above the 1000-minute floor,
    // BPM-only has nothing left to say about durability: a thousand minutes at
    // +6.0 beats twenty-eight hundred at +5.8. Karl-Anthony Towns is the real
    // case — 2019-20's 35 games at 7.8 BPM over 2017-18's 82 at 5.1.
    const { best } = bestSeason(
      [
        row({ season: 2020, games: 82, minutes: 2800, bpm: 5.8, vorp: 5.2, ws: 14, ws48: 0.23 }),
        row({ season: 2021, games: 35, minutes: 1050, bpm: 6.0, vorp: 2.9, ws: 5.1, ws48: 0.204 }),
      ],
      distributions
    );
    expect(best.season).toBe(2021);
    // And the alternative on the table is exactly the thing that undoes it.
    const alt = bestSeason(
      [
        row({ season: 2020, games: 82, minutes: 2800, bpm: 5.8, vorp: 5.2, ws: 14, ws48: 0.23 }),
        row({ season: 2021, games: 35, minutes: 1050, bpm: 6.0, vorp: 2.9, ws: 5.1, ws48: 0.204 }),
      ],
      distributions,
      BEST_SEASON_METRIC_SETS.bpmVorp
    );
    expect(alt.best.season).toBe(2020);
  });
});

describe('bestSeasonByMetricSet', () => {
  const distributions = { 2020: flatDistribution, 2021: flatDistribution };
  const career = [
    row({ season: 2020, minutes: 2800, bpm: 5.8, vorp: 5.2 }),
    row({ season: 2021, minutes: 1050, bpm: 6.0, vorp: 2.9 }),
  ];

  it('answers "and what would the other rule have picked?" without a code change', () => {
    const bySet = bestSeasonByMetricSet(career, distributions);
    expect(bySet.bpmOnly.best.season).toBe(2021);
    expect(bySet.bpmVorp.best.season).toBe(2020);
  });

  it('covers every declared set, so a new one shows up in the report for free', () => {
    expect(Object.keys(bestSeasonByMetricSet(career, distributions)).sort()).toEqual(
      Object.keys(BEST_SEASON_METRIC_SETS).sort()
    );
  });
});

describe('perMetricBest and metricsDisagree', () => {
  const scored = [
    { season: 2019, z: { bpm: 1, vorp: 3, ws: 3, ws48: 1 } },
    { season: 2020, z: { bpm: 3, vorp: 1, ws: 1, ws48: 3 } },
  ];

  it('names the season each metric would have chosen alone', () => {
    expect(perMetricBest(scored)).toEqual({ bpm: 2020, vorp: 2019, ws: 2019, ws48: 2020 });
  });

  it('reports a disagreement when they do not all agree', () => {
    expect(metricsDisagree(perMetricBest(scored))).toBe(true);
    expect(
      metricsDisagree({ bpm: 2020, vorp: 2020, ws: 2020, ws48: 2020 })
    ).toBe(false);
  });
});

describe('rookieSeason', () => {
  it('is the earliest season in the career', () => {
    const seasons = careerSeasons([row({ season: 2019 }), row({ season: 2017 })]);
    expect(rookieSeason(seasons, 2000).season).toBe(2017);
  });

  it('flags a debut the archive cannot see past', () => {
    // "Earliest row is the first season fetched" cannot be told apart from
    // "debuted before we started looking", so it is carried rather than assumed
    // away — a legends extension would land here immediately.
    const seasons = careerSeasons([row({ season: 2000 })]);
    expect(rookieSeason(seasons, 2000).beyondRange).toBe(true);
    expect(rookieSeason(careerSeasons([row({ season: 2004 })]), 2000).beyondRange).toBe(false);
  });

  it('returns null for an empty career instead of throwing', () => {
    expect(rookieSeason([], 2000)).toBeNull();
  });
});

describe('the season distributions the scores are taken against', () => {
  it('measures only players with a real sample behind them', () => {
    const dist = seasonDistribution([
      row({ playerId: 'a', minutes: 2000, bpm: 4 }),
      row({ playerId: 'b', minutes: 2000, bpm: 0 }),
      row({ playerId: 'c', minutes: 40, bpm: 40 }),
    ]);
    expect(dist.players).toBe(2);
    expect(dist.metrics.bpm.mean).toBe(2);
  });

  it('counts a traded player once, on his whole-season row', () => {
    const rows = [
      row({ playerId: 'a', team: '2TM', games: 70, minutes: 2000, bpm: 3 }),
      row({ playerId: 'a', team: 'BOS', games: 40, minutes: 1200, bpm: 5 }),
      row({ playerId: 'a', team: 'MIA', games: 30, minutes: 800, bpm: 1 }),
    ];
    expect(dedupeForDistribution(rows)).toHaveLength(1);
    expect(seasonDistribution(rows).metrics.bpm.mean).toBe(3);
  });
});
