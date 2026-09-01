import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildPositionShares,
  indexPositionShares,
  normalizeShares,
  POSITION_SHARES_FILE,
} from './positionShares.js';
import { parseSeasonTableHtml, SEASON_TABLES } from './sources/basketballReference.js';
import { trimSeasonTable } from './fetchCalibrationData.js';

const FIXTURE = readFileSync(
  new URL('./sources/__fixtures__/sample-play-by-play.html', import.meta.url),
  'utf8'
);
const fixtureRows = trimSeasonTable(
  parseSeasonTableHtml(FIXTURE, SEASON_TABLES.playByPlay.tableId),
  'playByPlay'
);

describe('trimSeasonTable(playByPlay)', () => {
  it('carries the five position estimates through as a keyed object', () => {
    expect(fixtureRows[0]).toMatchObject({
      playerId: 'thompam01',
      name: 'Amen Thompson',
      pos: 'PG',
      pct: { PG: 83, SG: 16, SF: 1, PF: 0, C: 0 },
    });
  });
});

describe('normalizeShares', () => {
  // The page prints whole percents, so a row totals 99 to 102. Blending against
  // an un-normalized vector would scale a player's whole positional centre by
  // that error — in one direction, not at random.
  it('scales a row that does not total 100 back onto 1', () => {
    const shares = normalizeShares({ PG: 50, SG: 52, SF: 0, PF: 0, C: 0 });
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(shares.SG).toBeCloseTo(52 / 102, 12);
  });

  it('is the identity on a vector that already sums to 1', () => {
    expect(normalizeShares({ PG: 0.25, SG: 0.75, SF: 0, PF: 0, C: 0 })).toEqual({
      PG: 0.25,
      SG: 0.75,
      SF: 0,
      PF: 0,
      C: 0,
    });
  });

  // Null, not a uniform fifth: a player with no measurement should fall back to
  // his LABEL, and inventing an even blend would instead hand every unmeasured
  // player the same middling split.
  it('returns null rather than guessing when nothing was measured', () => {
    expect(normalizeShares({ PG: 0, SG: 0, SF: 0, PF: 0, C: 0 })).toBeNull();
    expect(normalizeShares(null)).toBeNull();
    expect(normalizeShares({})).toBeNull();
  });

  it('ignores a negative or non-numeric component instead of propagating it', () => {
    const shares = normalizeShares({ PG: 100, SG: -5, SF: null, PF: undefined, C: NaN });
    expect(shares).toEqual({ PG: 1, SG: 0, SF: 0, PF: 0, C: 0 });
  });
});

describe('buildPositionShares', () => {
  const seasonRows = {
    2025: [
      { playerId: 'aa01', name: 'Older Guy', games: 70, pct: { PG: 10, SG: 80, SF: 10, PF: 0, C: 0 } },
      { playerId: 'zz99', name: 'Retired Guy', games: 70, pct: { PG: 0, SG: 0, SF: 0, PF: 0, C: 100 } },
    ],
    2026: [
      { playerId: 'aa01', name: 'Older Guy', games: 70, pct: { PG: 60, SG: 40, SF: 0, PF: 0, C: 0 } },
      { playerId: 'bb02', name: 'Rookie Guy', games: 55, pct: { PG: 0, SG: 0, SF: 30, PF: 70, C: 0 } },
    ],
  };
  const pool = [{ name: 'Older Guy' }, { name: 'Rookie Guy' }, { name: 'Nobody At All' }];

  it('keeps every season of a pool player and drops everyone else', () => {
    const { records } = buildPositionShares({ seasonRows, pool, lastSeason: 2026 });
    expect(records.map(r => `${r.id}:${r.season}`)).toEqual(['aa01:2025', 'aa01:2026', 'bb02:2026']);
  });

  it('reports a pool player with no row in the resolving season', () => {
    const { missing, players } = buildPositionShares({ seasonRows, pool, lastSeason: 2026 });
    expect(missing).toEqual(['Nobody At All']);
    expect(players).toBe(2);
  });

  // Positional role is the thing that MOVES, which is why this table is one row
  // per player-SEASON while player-biometrics.json is one row per player.
  it('keeps a player whose role changed as two different rows', () => {
    const { records } = buildPositionShares({ seasonRows, pool, lastSeason: 2026 });
    const [older2025, older2026] = records.filter(r => r.id === 'aa01');
    expect(older2025.pct).toEqual([10, 80, 10, 0, 0]);
    expect(older2026.pct).toEqual([60, 40, 0, 0, 0]);
  });

  // A traded player's whole season is his aggregate row, which has the most
  // games. Taking either half would describe a role he only partly played.
  it('keeps the multi-team aggregate over either team split', () => {
    const traded = {
      2026: [
        { playerId: 'cc03', name: 'Traded Guy', games: 70, pct: { PG: 50, SG: 50, SF: 0, PF: 0, C: 0 } },
        { playerId: 'cc03', name: 'Traded Guy', games: 30, pct: { PG: 100, SG: 0, SF: 0, PF: 0, C: 0 } },
        { playerId: 'cc03', name: 'Traded Guy', games: 40, pct: { PG: 10, SG: 90, SF: 0, PF: 0, C: 0 } },
      ],
    };
    const { records } = buildPositionShares({
      seasonRows: traded,
      pool: [{ name: 'Traded Guy' }],
      lastSeason: 2026,
    });
    expect(records).toHaveLength(1);
    expect(records[0].pct).toEqual([50, 50, 0, 0, 0]);
  });

  it('spells a name the way the POOL spells it, since that is what the base set joins on', () => {
    const { records } = buildPositionShares({
      seasonRows: { 2026: [{ playerId: 'dd04', name: 'Jabari Smith', games: 70, pct: { PG: 0, SG: 0, SF: 20, PF: 80, C: 0 } }] },
      pool: [{ name: 'Jabari Smith Jr.' }],
      lastSeason: 2026,
    });
    expect(records[0].name).toBe('Jabari Smith Jr.');
  });
});

describe('indexPositionShares', () => {
  const records = [
    { id: 'jacksja02', name: 'Jaren Jackson Jr.', season: 2026, pct: [0, 0, 5, 60, 35] },
    { id: 'jacksja01', name: 'Jaren Jackson', season: 2000, pct: [0, 0, 40, 55, 5] },
  ];
  const index = indexPositionShares(records);

  it('normalizes on the way out, so a consumer never sees raw percentages', () => {
    const shares = index.forId('jacksja02', 2026);
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(shares.PF).toBeCloseTo(0.6, 12);
  });

  // The father/son case history.js warns about. `normalizeName` strips "Jr.",
  // so these two share a name key and are told apart only by id and season.
  it('keeps two players who share a normalized name apart by id', () => {
    expect(index.forId('jacksja01', 2000).SF).toBeCloseTo(0.4, 12);
    expect(index.forId('jacksja02', 2000)).toBeNull();
  });

  it('answers null for anything it does not carry', () => {
    expect(index.forId('nobody01', 2026)).toBeNull();
    expect(index.forName('Nobody At All', 2026)).toBeNull();
    expect(indexPositionShares(null).size).toBe(0);
  });

  it('looks a base-set player up by his pool name and season', () => {
    expect(index.forName('Jaren Jackson Jr.', 2026).C).toBeCloseTo(0.35, 12);
  });
});

describe('the committed table', () => {
  const records = JSON.parse(readFileSync(POSITION_SHARES_FILE, 'utf8'));

  it('covers every player in the 2026-27 pool for the season the base set is built from', () => {
    const pool = JSON.parse(
      readFileSync(new URL('../../card-data/generated/player-pool-2026.json', import.meta.url), 'utf8')
    );
    const index = indexPositionShares(records);
    // The CARRIED-FORWARD players are exempt, and necessarily: they played no
    // 2025-26 minutes, so there is no play-by-play row for them in the season
    // this checks. Their card reads the shares of the season it is BUILT from
    // instead, which the assertion below holds. See carryForward.js.
    const carried = pool.filter(p => p.carriedFrom != null);
    const missing = pool
      .filter(p => p.carriedFrom == null)
      .filter(p => !index.forName(p.name, 2026));
    expect(missing.map(p => p.name)).toEqual([]);
    // They have no row in ANY season here, and that is the generator's own
    // stated behaviour rather than a gap: it reports "no 2026 play-by-play row"
    // for them and says they keep the position-LABEL split. Asserted so the
    // fallback is a decision on the record and not an accident nobody noticed.
    expect(carried.length).toBeGreaterThan(0);
    for (const p of carried) expect(index.forName(p.name, p.carriedFrom)).toBeFalsy();
  });

  it('reaches back far enough for the Rookie set s oldest card', () => {
    const seasons = records.map(r => r.season);
    expect(Math.min(...seasons)).toBeLessThanOrEqual(2004);
    expect(Math.max(...seasons)).toBe(2026);
  });

  it('stores five whole percentages per row, in PG-to-C order', () => {
    for (const r of records) {
      expect(r.pct).toHaveLength(5);
      for (const v of r.pct) expect(Number.isInteger(v)).toBe(true);
      const sum = r.pct.reduce((a, b) => a + b, 0);
      expect(sum).toBeGreaterThan(90);
      expect(sum).toBeLessThan(110);
    }
  });
});
