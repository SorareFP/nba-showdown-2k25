import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  API_BASE,
  API_KEY_ENV,
  ENDPOINTS,
  FIRST_API_SEASON,
  MAX_RETRIES,
  SEASON_TYPE_PLAYOFFS,
  SEASON_TYPE_REGULAR,
  apiKey,
  apiRequest,
  backoffMs,
  createThrottle,
  fetchSeasonEpm,
  parseSeasonEpmRows,
  redact,
  resetThrottles,
  retryAfterMs,
  seasonEpmCacheKey,
  throttleFor,
  toApiSeasonRate,
} from './dunksAndThreesApi.js';

// ── The fixture is REAL, and that is the point ──────────────────────────────
//
// Six rows taken verbatim from a live season-epm response (2024-25, both season
// types, plus one row the site withheld EPM for). Verbatim matters: a
// hand-written fixture encodes whatever the parser already does, so it can only
// ever confirm the code against itself. These rows can catch a renamed column, a
// moved null and a changed float precision, which are the three ways this
// adapter can actually break.
//
// NO CREDENTIAL IS IN IT. The key travels in an `Authorization` header, so a
// response body cannot contain one — there is nothing to redact, which is itself
// asserted below rather than assumed.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_FILE = path.join(HERE, '__fixtures__', 'sample-season-epm.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8'));
const byName = (name, seasontype = SEASON_TYPE_REGULAR) =>
  fixture.rows.find(r => r.player_name === name && r.seasontype === seasontype);

const KEY = 'test-key-not-a-real-one';
const regularRows = () => fixture.rows.filter(r => r.seasontype === SEASON_TYPE_REGULAR);

const okResponse = body => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => body,
});
const errorResponse = (status, body = '', headers = {}) => ({
  ok: false,
  status,
  headers: new Headers(headers),
  text: async () => body,
  json: async () => JSON.parse(body || 'null'),
});

/** A fetch stub that records what it was called with. */
function recordingFetch(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  impl.calls = calls;
  return impl;
}

/** Injectable timing: nothing sleeps, but every requested wait is recorded. */
function fakeClock() {
  const waits = [];
  return {
    waits,
    sleep: async ms => {
      waits.push(ms);
    },
    now: () => 1_000_000,
  };
}

beforeEach(() => {
  resetThrottles();
});

describe('apiKey', () => {
  it('reads the key from the environment', () => {
    expect(apiKey({ [API_KEY_ENV]: '  abc123  ' })).toBe('abc123');
  });

  // A fresh checkout has no .env.local, and the useful failure there is a
  // sentence saying what to create — not a 401 three layers down.
  it('names the variable, the file and the VITE_ trap when it is missing', () => {
    expect(() => apiKey({})).toThrow(new RegExp(API_KEY_ENV));
    expect(() => apiKey({})).toThrow(/\.env\.local/);
    expect(() => apiKey({})).toThrow(/VITE_/);
  });

  it('treats a blank value as missing', () => {
    expect(() => apiKey({ [API_KEY_ENV]: '   ' })).toThrow(new RegExp(API_KEY_ENV));
  });
});

describe('redact', () => {
  it('removes every occurrence of the key from a message', () => {
    expect(redact(`a ${KEY} b ${KEY}`, KEY)).toBe('a <redacted> b <redacted>');
  });

  it('passes text through when there is no key to remove', () => {
    expect(redact('plain', null)).toBe('plain');
    expect(redact(undefined, KEY)).toBe('');
  });
});

describe('createThrottle', () => {
  it('turns a per-minute allowance into a request spacing', () => {
    expect(createThrottle(90).spacing).toBe(667);
    expect(createThrottle(3).spacing).toBe(20000);
    expect(createThrottle(0).spacing).toBe(0);
  });

  it('does not delay the first request', async () => {
    const clock = fakeClock();
    const throttle = createThrottle(3);
    await throttle.schedule(clock);
    expect(clock.waits).toEqual([]);
  });

  // THE FAILURE MODE A NAIVE SPACER HAS: ten calls made at once all read the
  // same "time since last request" and leave together. Chaining is what stops
  // that, so it is asserted on concurrent calls rather than sequential ones.
  it('serializes concurrent callers instead of letting them all leave at once', async () => {
    const clock = fakeClock();
    const throttle = createThrottle(3);
    await Promise.all([1, 2, 3, 4].map(() => throttle.schedule(clock)));
    expect(clock.waits).toEqual([20000, 20000, 20000]);
  });

  it('keeps working after a caller in the queue rejects', async () => {
    const clock = fakeClock();
    const throttle = createThrottle(90);
    const boom = throttle.schedule({
      ...clock,
      sleep: async () => {
        throw new Error('nope');
      },
    });
    await throttle.schedule(clock);
    await expect(Promise.resolve(boom)).resolves.toBeUndefined();
  });
});

describe('throttleFor', () => {
  // The whole reason throttling is per-endpoint: 90 a minute generally, but
  // team-epm allows THREE, and one global budget earns a 429 immediately.
  it('gives each endpoint its OWN spacing, not one global rate', () => {
    expect(throttleFor('seasonEpm').spacing).toBe(667);
    expect(throttleFor('teamEpm').spacing).toBe(20000);
    expect(ENDPOINTS.teamEpm.perMinute).toBe(3);
  });

  it('returns the same throttle for repeated lookups, so the budget is shared', () => {
    expect(throttleFor('seasonEpm')).toBe(throttleFor('seasonEpm'));
  });

  it('refuses an endpoint it does not know', () => {
    expect(() => throttleFor('nope')).toThrow(/unknown dunksandthrees endpoint/);
  });
});

describe('backoffMs / retryAfterMs', () => {
  it('starts a backoff at the endpoint\'s own spacing and doubles', () => {
    // Backing off one second on a 3-a-minute endpoint just earns another 429.
    expect(backoffMs(0, 20000)).toBe(20000);
    expect(backoffMs(1, 20000)).toBe(40000);
    expect(backoffMs(0, 667)).toBe(1000);
  });

  it('reads Retry-After when the server sends one', () => {
    expect(retryAfterMs(new Headers({ 'retry-after': '12' }))).toBe(12000);
    expect(retryAfterMs(new Headers())).toBeNull();
    expect(retryAfterMs(new Headers({ 'retry-after': 'soon' }))).toBeNull();
  });
});

describe('apiRequest', () => {
  it('sends the key in a header and never in the URL', async () => {
    const fetchImpl = recordingFetch(okResponse([{ a: 1 }]));
    const clock = fakeClock();
    await apiRequest('seasonEpm', { season: 2025, seasontype: 2 }, { fetchImpl, key: KEY, ...clock });
    const [call] = fetchImpl.calls;
    expect(call.url).toBe(`${API_BASE}/season-epm?season=2025&seasontype=2`);
    expect(call.url).not.toContain(KEY);
    expect(call.init.headers.Authorization).toBe(KEY);
  });

  it('drops null and undefined parameters rather than sending them empty', async () => {
    const fetchImpl = recordingFetch(okResponse([]));
    const clock = fakeClock();
    await apiRequest('epm', { season: 2026, date: null, days: undefined }, { fetchImpl, key: KEY, ...clock });
    expect(fetchImpl.calls[0].url).toBe(`${API_BASE}/epm?season=2026`);
  });

  it('waits out a 429 and then succeeds', async () => {
    const fetchImpl = recordingFetch([errorResponse(429), okResponse([{ ok: true }])]);
    const clock = fakeClock();
    const rows = await apiRequest('seasonEpm', {}, { fetchImpl, key: KEY, ...clock });
    expect(rows).toEqual([{ ok: true }]);
    expect(fetchImpl.calls).toHaveLength(2);
    // 1000 is the backoff (the endpoint's 667ms spacing floored at a second);
    // 667 is the throttle spacing before the retry request itself.
    expect(clock.waits).toEqual([1000, 667]);
  });

  it('prefers the server\'s Retry-After over its own backoff', async () => {
    const fetchImpl = recordingFetch([
      errorResponse(429, '', { 'retry-after': '30' }),
      okResponse([1]),
    ]);
    const clock = fakeClock();
    await apiRequest('seasonEpm', {}, { fetchImpl, key: KEY, ...clock });
    expect(clock.waits[0]).toBe(30000);
  });

  it('gives up after the retry budget, naming the endpoint\'s real limit', async () => {
    const fetchImpl = recordingFetch(errorResponse(429));
    const clock = fakeClock();
    await expect(
      apiRequest('teamEpm', {}, { fetchImpl, key: KEY, ...clock })
    ).rejects.toThrow(/rate limited \(429\).*3 requests a minute/s);
    expect(fetchImpl.calls).toHaveLength(MAX_RETRIES + 1);
  });

  it('says the key was rejected on a 401, without echoing it', async () => {
    const fetchImpl = recordingFetch(
      errorResponse(401, JSON.stringify({ message: 'Unauthorized: Invalid or missing API key' }))
    );
    const clock = fakeClock();
    await expect(apiRequest('seasonEpm', {}, { fetchImpl, key: KEY, ...clock })).rejects.toThrow(
      new RegExp(`401 — the API key was rejected.*${API_KEY_ENV}`, 's')
    );
  });

  it('surfaces any other failure with its status and body', async () => {
    const fetchImpl = recordingFetch(errorResponse(400, '{"message":"Incorrect parameter format"}'));
    const clock = fakeClock();
    await expect(apiRequest('seasonEpm', {}, { fetchImpl, key: KEY, ...clock })).rejects.toThrow(
      /400 \{"message":"Incorrect parameter format"\}/
    );
  });

  // The house rule for this directory: a shape nobody expected is a throw, not
  // a silent empty result that flows on as "this player has no prior season".
  it('refuses a body that is not a JSON array', async () => {
    const fetchImpl = recordingFetch(okResponse({ rows: [] }));
    const clock = fakeClock();
    await expect(apiRequest('seasonEpm', {}, { fetchImpl, key: KEY, ...clock })).rejects.toThrow(
      /expected a JSON array, got object/
    );
  });

  // Nothing this module composes contains the key — but an upstream that quoted
  // its own Authorization header back at us would, and that must not reach a
  // terminal.
  it('redacts the key out of an error body that echoes it', async () => {
    const fetchImpl = recordingFetch(errorResponse(500, `bad auth header: ${KEY}`));
    const clock = fakeClock();
    await expect(
      apiRequest('seasonEpm', {}, { fetchImpl, key: KEY, ...clock })
    ).rejects.toThrow(/<redacted>/);
    await expect(
      apiRequest('seasonEpm', {}, { fetchImpl, key: KEY, ...clock })
    ).rejects.not.toThrow(new RegExp(KEY));
  });

  it('refuses an endpoint it does not know before making a request', async () => {
    await expect(apiRequest('nope', {}, { key: KEY })).rejects.toThrow(/unknown dunksandthrees/);
  });
});

describe('parseSeasonEpmRows', () => {
  it('accepts the real payload', () => {
    const rows = parseSeasonEpmRows(regularRows(), { season: 2025, seasonType: SEASON_TYPE_REGULAR });
    expect(rows.map(r => r.player_name)).toContain('Shai Gilgeous-Alexander');
  });

  // season and seasontype are QUERY PARAMETERS, so a silently-ignored one hands
  // back a different table under the right filename. Check the answer.
  it('refuses rows from a season other than the one asked for', () => {
    expect(() =>
      parseSeasonEpmRows(regularRows(), { season: 2024, seasonType: SEASON_TYPE_REGULAR })
    ).toThrow(/served season 2025, not 2024/);
  });

  it('refuses rows from the other season type', () => {
    expect(() =>
      parseSeasonEpmRows(regularRows(), { season: 2025, seasonType: SEASON_TYPE_PLAYOFFS })
    ).toThrow(/served seasontype 2, not 4/);
  });

  it('refuses a payload missing any field the pipeline reads', () => {
    const rows = regularRows().map(({ mp, ...rest }) => rest);
    expect(() => parseSeasonEpmRows(rows, { season: 2025, seasonType: 2 })).toThrow(
      /missing expected fields: mp/
    );
  });

  // A null EPM is normal — the site withholds it under fifty minutes — so the
  // check is on the KEY being present, not on the value being a number.
  it('accepts a row whose values are null, because that is a real state', () => {
    const okafor = fixture.rows.find(r => r.tot === null);
    expect(okafor).toBeDefined();
    expect(() => parseSeasonEpmRows([okafor], { season: 2025, seasonType: 2 })).not.toThrow();
  });

  it('refuses a duplicated player, which would double-count him in the pooling', () => {
    const one = byName('Ty Jerome');
    expect(() => parseSeasonEpmRows([one, { ...one }], { season: 2025, seasonType: 2 })).toThrow(
      /one aggregated row per player/
    );
  });

  it('refuses an empty table rather than returning one', () => {
    expect(() => parseSeasonEpmRows([], { season: 2025, seasonType: 2 })).toThrow(/no rows/);
  });
});

describe('toApiSeasonRate', () => {
  const sga = toApiSeasonRate(byName('Shai Gilgeous-Alexander'));

  it('renames the API columns to the vocabulary the generators speak', () => {
    expect(sga).toMatchObject({
      name: 'Shai Gilgeous-Alexander',
      personId: 1628983,
      team: 'OKC',
      position: 'PG',
      games: 76,
      epm: 8.59236,
      epmOff: 6.96583,
      epmDef: 1.62654,
      tsPct: 0.640536,
      fgPctRim: 0.681529,
      fgPct3: 0.374713,
    });
  });

  // THE SHAPE IS A CONTRACT: poolSeasons.js pools by these names, so a prior
  // season fetched here has to be indistinguishable from a current one scraped
  // by the sibling adapter.
  it('produces every field poolSeasons.js pools on', () => {
    const pooled = [
      'epm', 'epmOff', 'epmDef', 'usage',
      'tsPct', 'efg', 'fgPctRim', 'fgPctMid', 'fgPct2', 'fgPct3', 'ftPct',
      'fgaRimPer75', 'fgaMidPer75', 'fga3Per75', 'ftaPer75', 'fgaPer75',
      'orbPct', 'drbPct', 'astPct', 'tovPct', 'stlPct', 'blkPct',
      'games', 'minutes', 'starts', 'ewins', 'ewinsPerGame',
      'name', 'personId', 'team', 'position', 'age',
    ];
    for (const field of pooled) expect(sga).toHaveProperty(field);
  });

  // The API has no `fga_75` column; the scraped page does. The sum of the two
  // halves IS that number — 16.0613 + 4.67867 = 20.73997 against the scrape's
  // 20.74 for the same player-season — and it matters because eFG% pools on it.
  it('derives total attempts per 75 from the two halves the API does serve', () => {
    const row = byName('Shai Gilgeous-Alexander');
    expect(row.fga_75).toBeUndefined();
    expect(sga.fgaPer75).toBeCloseTo(row.fg2a_75 + row.fg3a_75, 10);
  });

  it('derives expected wins per game from the season total', () => {
    expect(sga.ewinsPerGame).toBeCloseTo(20.9422 / 76, 10);
  });

  it('returns null EW/GP where the site withheld expected wins', () => {
    const rate = toApiSeasonRate(fixture.rows.find(r => r.tot === null));
    expect(rate.ewinsPerGame).toBeNull();
    expect(rate.games).toBe(1);
  });

  // What the scrape could never give: per-75 COUNTS. The scraped ACTUAL page
  // has rebounds and assists only as rate percentages, which is why the scoring
  // chart still reads the PREDICTED leaderboard.
  it('carries the per-75 counting stats the scraped page does not have', () => {
    expect(sga.pts75).toBe(33.8543);
    expect(sga.reb75).toBe(5.16536);
    expect(sga.ast75).toBe(6.62366);
  });

  it('carries the season it came from, so a pooled row can say so', () => {
    expect(sga.season).toBe(2025);
    expect(sga.seasonType).toBe(SEASON_TYPE_REGULAR);
    expect(toApiSeasonRate(byName('Ty Jerome', SEASON_TYPE_PLAYOFFS)).seasonType).toBe(
      SEASON_TYPE_PLAYOFFS
    );
  });
});

describe('fetchSeasonEpm', () => {
  it('caches per season AND season type, so the two splits never collide', () => {
    expect(seasonEpmCacheKey(2025, SEASON_TYPE_REGULAR)).toBe(
      'dunksandthrees-api-season-epm-2025-st2'
    );
    expect(seasonEpmCacheKey(2025, SEASON_TYPE_PLAYOFFS)).toBe(
      'dunksandthrees-api-season-epm-2025-st4'
    );
  });

  // 2001 answers 400 "Incorrect parameter format", so the floor is the API's
  // own. Failing locally beats spending a request to be told.
  it('refuses a season below the API\'s coverage without making a request', async () => {
    await expect(fetchSeasonEpm(FIRST_API_SEASON - 1)).rejects.toThrow(
      new RegExp(`${FIRST_API_SEASON} or later`)
    );
    await expect(fetchSeasonEpm('2025')).rejects.toThrow(/integer year/);
  });
});

// ── The credential must not be anywhere it could be committed ───────────────
//
// The fixture is a real API response and the cache holds real API responses.
// Neither can contain the key, because it is sent as a header — but "cannot"
// is worth being a test rather than an argument, since the cost of being wrong
// is a key in a public repository.
describe('the API key never reaches disk', () => {
  it('is absent from the committed fixture', () => {
    const raw = fs.readFileSync(FIXTURE_FILE, 'utf8');
    // The live key, when this test runs with one loaded. The direct check.
    const live = process.env[API_KEY_ENV];
    if (live) expect(raw).not.toContain(live);
    // And no credential-shaped FIELD at all, `_comment`'s prose excluded — it
    // is documentation about the key, which is the opposite of carrying one.
    const data = JSON.stringify(fixture.rows);
    expect(data).not.toMatch(/authorization|api[_-]?key|bearer|secret|token/i);
  });

  it('is absent from the URL the cache records as the source', () => {
    expect(`${API_BASE}/${ENDPOINTS.seasonEpm.path}`).toBe(
      'https://dunksandthrees.com/api/v1/season-epm'
    );
  });
});
