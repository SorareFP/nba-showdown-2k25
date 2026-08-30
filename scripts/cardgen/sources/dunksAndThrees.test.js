import { describe, it, expect } from 'vitest';
import {
  unflattenDevalue,
  parseEpmPayload,
  parseActualPayload,
  toSeasonRate,
  toActualSeasonRate,
  fetchActualSeasonRates,
  trb100,
  fetchGameLog,
  SEASON_TYPE_PLAYOFFS,
} from './dunksAndThrees.js';

/**
 * Encodes a value the way SvelteKit's devalue does, so the fixtures below are
 * the real wire format rather than an approximation of it.
 *
 * The format is a flat array in which every object field and array element is an
 * INTEGER INDEX back into that same array — repeated values are stored once and
 * pointed at many times. Writing the encoder here rather than hand-rolling the
 * arrays is what makes these tests worth having: a hand-built fixture drifts
 * toward whatever the parser already does.
 */
function flatten(value) {
  const out = [];
  const seen = new Map();
  const put = v => {
    if (v === undefined) return -1;
    const key = typeof v === 'object' && v !== null ? v : `${typeof v}:${String(v)}`;
    if (seen.has(key)) return seen.get(key);
    const index = out.length;
    out.push(null);
    seen.set(key, index);
    if (Array.isArray(v)) out[index] = v.map(put);
    else if (v && typeof v === 'object') {
      out[index] = Object.fromEntries(Object.entries(v).map(([k, child]) => [k, put(child)]));
    } else out[index] = v;
    return index;
  };
  put(value);
  return out;
}

const payload = rows => ({
  nodes: [
    { type: 'skip' },
    { type: 'data', data: flatten({ season: 2026, date: '2026-06-13', stats: rows }) },
  ],
});

const row = (name, extra = {}) => ({
  player_name: name,
  player_id: 1,
  team_alias: 'SAS',
  position: 'F-C',
  tot: 7.8,
  off: 3.8,
  def: 4.0,
  p_pts_100: 36.5,
  p_ast_100: 3.9,
  p_orb_100: 3.4,
  p_drb_100: 13.0,
  ...extra,
});

describe('unflattenDevalue', () => {
  it('resolves integer indices back into a real object graph', () => {
    // ["shared" is stored once and pointed at twice.]
    const flat = [{ a: 1, b: 2 }, 'shared', { c: 1 }];
    expect(unflattenDevalue(flat)).toEqual({ a: 'shared', b: { c: 'shared' } });
  });

  it('handles arrays and the JSON-inexpressible sentinels', () => {
    const flat = [[1, 2, -1, -3], 'x', 5];
    expect(unflattenDevalue(flat)).toEqual(['x', 5, undefined, NaN]);
  });

  it('does not loop forever on a self-referential graph', () => {
    // devalue emits these for cyclic data; a naive resolver recurses to death.
    const flat = [{ self: 0 }];
    expect(() => unflattenDevalue(flat)).not.toThrow();
  });

  it('refuses an empty or non-array payload rather than returning undefined', () => {
    expect(() => unflattenDevalue([])).toThrow();
    expect(() => unflattenDevalue(null)).toThrow();
  });
});

describe('parseEpmPayload', () => {
  it('pulls out the season, the as-of date and every row', () => {
    const parsed = parseEpmPayload(payload([row('Victor Wembanyama'), row('Nikola Jokic')]));
    expect(parsed.season).toBe(2026);
    expect(parsed.asOf).toBe('2026-06-13');
    expect(parsed.rows.map(r => r.player_name)).toEqual(['Victor Wembanyama', 'Nikola Jokic']);
  });

  // VERIFIED 2026-08-29: ask for a prior season and everything past the top five
  // comes back as a placeholder named "Locked Player" — it is behind the site's
  // subscription. Returning that table would poison whatever consumed it, and
  // the failure would look like a matching bug three modules downstream.
  it('throws rather than returning a subscription-locked table', () => {
    const body = payload([row('Nikola Jokic'), row('Locked Player'), row('Locked Player')]);
    expect(() => parseEpmPayload(body)).toThrow(/Locked Player/);
  });

  it('throws when the payload has no data node or no rows', () => {
    expect(() => parseEpmPayload({ nodes: [{ type: 'skip' }] })).toThrow(/no data node/);
    expect(() => parseEpmPayload(payload([]))).toThrow(/no `stats` array/);
  });
});

describe('toSeasonRate', () => {
  const rate = toSeasonRate(row('Victor Wembanyama'));

  it('renames the site\'s columns to the ones the generators speak', () => {
    expect(rate).toMatchObject({
      name: 'Victor Wembanyama',
      team: 'SAS',
      position: 'F-C',
      epm: 7.8,
      epmDef: 4.0,
      pts100: 36.5,
      ast100: 3.9,
    });
  });

  it('keeps the offensive and defensive EPM split, which Def Boost needs', () => {
    expect(rate.epmOff).toBe(3.8);
    expect(rate.epmDef).toBe(4.0);
  });
});

// The ACTUAL route serves each row as a bare array plus one shared `k` map from
// column name to index. Building the fixture the same way — declare the row by
// name, then knock it down to an array through `k` — is what makes these tests
// able to catch an off-by-one in the zip, which is the only interesting way this
// parser can fail. A hand-written array fixture would just encode the bug.
const ACTUAL_COLUMNS = [
  'player_name',
  'player_id',
  'team_alias',
  'pos_text',
  'gp',
  'mp',
  'mpg',
  'off',
  'def',
  'tot',
  'ewins',
  'tspct',
  'fgpct_rim',
  'fg3pct',
  'fg3a_75',
];

const actualPayload = (rows, extra = {}) => {
  const k = Object.fromEntries(ACTUAL_COLUMNS.map((name, i) => [name, i]));
  return {
    nodes: [
      { type: 'skip' },
      {
        type: 'data',
        data: flatten({
          season: 2026,
          seasontype: 2,
          k,
          stats: rows.map(r => ACTUAL_COLUMNS.map(c => r[c] ?? null)),
          ...extra,
        }),
      },
    ],
  };
};

const actualRow = (name, extra = {}) => ({
  player_name: name,
  player_id: 1641705,
  team_alias: 'SAS',
  pos_text: 'C',
  gp: 64,
  mp: 1865.74,
  mpg: 29.1406,
  off: 4.29721,
  def: 4.44645,
  tot: 8.74366,
  ewins: 15.2306,
  tspct: 0.625489,
  fgpct_rim: 0.731235,
  fg3pct: 0.348571,
  fg3a_75: 6.71184,
  ...extra,
});

describe('parseActualPayload', () => {
  it('zips each row array back together against the `k` column index', () => {
    const parsed = parseActualPayload(
      actualPayload([actualRow('Victor Wembanyama'), actualRow('Nikola Jokic', { gp: 70 })])
    );
    expect(parsed.season).toBe(2026);
    expect(parsed.seasonType).toBe(2);
    expect(parsed.rows.map(r => r.player_name)).toEqual(['Victor Wembanyama', 'Nikola Jokic']);
    expect(parsed.rows[0].tspct).toBeCloseTo(0.625489, 10);
    expect(parsed.rows[1].gp).toBe(70);
  });

  it('throws when the `k` column index is missing', () => {
    const body = actualPayload([actualRow('Victor Wembanyama')]);
    const data = body.nodes[1].data;
    // Blank out whatever `k` resolved to, leaving the rest of the payload valid.
    const kIndex = data.findIndex(v => v && typeof v === 'object' && !Array.isArray(v) && 'k' in v);
    data[kIndex] = { ...data[kIndex], k: -1 };
    expect(() => parseActualPayload(body)).toThrow(/`k` column index/);
  });

  it('throws on a subscription-locked table, like the predicted route does', () => {
    const body = actualPayload([actualRow('Nikola Jokic'), actualRow('Locked Player')]);
    expect(() => parseActualPayload(body)).toThrow(/Locked Player/);
  });

  it('throws when there is no data node or no rows', () => {
    expect(() => parseActualPayload({ nodes: [{ type: 'skip' }] })).toThrow(/no data node/);
    expect(() => parseActualPayload(actualPayload([]))).toThrow(/no `stats` array/);
  });
});

describe('toActualSeasonRate', () => {
  const rate = toActualSeasonRate(actualRow('Victor Wembanyama'));

  it('renames the actual columns to the ones the generators speak', () => {
    expect(rate).toMatchObject({
      name: 'Victor Wembanyama',
      team: 'SAS',
      position: 'C',
      games: 64,
      epm: 8.74366,
      epmOff: 4.29721,
      epmDef: 4.44645,
      tsPct: 0.625489,
      fgPctRim: 0.731235,
      fgPct3: 0.348571,
    });
  });

  // EW is a season TOTAL, so raw EW rewards availability as much as play. Every
  // consumer wants the rate, so the division happens once, here.
  it('derives expected wins per game from the season total', () => {
    expect(rate.ewinsPerGame).toBeCloseTo(15.2306 / 64, 10);
  });

  it('returns null rather than Infinity for a player with no games', () => {
    expect(toActualSeasonRate(actualRow('Ghost', { gp: 0 })).ewinsPerGame).toBeNull();
  });
});

describe('fetchActualSeasonRates', () => {
  const okResponse = body => ({ ok: true, json: async () => body });

  it('refuses a payload for a season other than the one asked for', async () => {
    const fetchImpl = async () => okResponse(actualPayload([actualRow('X')], { season: 2025 }));
    await expect(
      fetchActualSeasonRates(2026, { force: true, fetchImpl })
    ).rejects.toThrow(/season 2025, not 2026/);
  });

  // The seasontype is a query parameter, so a silently-ignored one would hand
  // back regular-season rows labelled as playoff rows. Check the answer, not the
  // request.
  it('refuses a payload for a season type other than the one asked for', async () => {
    const fetchImpl = async () => okResponse(actualPayload([actualRow('X')]));
    await expect(
      fetchActualSeasonRates(2026, { force: true, fetchImpl, seasonType: SEASON_TYPE_PLAYOFFS })
    ).rejects.toThrow(/seasontype 2, not 4/);
  });

  it('surfaces a failed request rather than caching an empty result', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503 });
    await expect(fetchActualSeasonRates(2026, { force: true, fetchImpl })).rejects.toThrow(/503/);
  });
});

describe('trb100', () => {
  // The site splits rebounds; the card does not.
  it('adds the two rebound rates', () => {
    expect(trb100({ orb100: 3.4, drb100: 13.0 })).toBeCloseTo(16.4, 10);
  });

  it('treats a missing half as zero rather than NaN', () => {
    expect(trb100({ orb100: 3.4 })).toBe(3.4);
    expect(trb100({})).toBe(0);
  });
});

describe('fetchGameLog', () => {
  // The game-log API is still not public. The stub has to keep saying so, and
  // has to point at the source that can actually serve one.
  it('still refuses, and names the source that works', async () => {
    await expect(fetchGameLog()).rejects.toThrow(/basketballReference/);
  });
});
