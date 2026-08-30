// dunksandthrees.com OFFICIAL API adapter — the authenticated one.
//
// SIBLING FILE, NOT A REPLACEMENT. sources/dunksAndThrees.js reads the public
// website by pulling SvelteKit's `__data.json` payloads out of the leaderboard
// pages. It works, it needs no credentials, and it is the source the 2026-27 set
// is currently built from. What it CANNOT do is read a prior season: the site
// serves every row past the top five as "Locked Player" for anyone without a
// subscription, and that single limitation is what has blocked every
// backward-looking piece of the card pipeline.
//
// This file is the key-holder's version of the same data, and it lifts that
// limitation. `season-epm` serves 2002 through 2026, regular season and
// playoffs, 71 columns per player-season.
//
// ── THE TWO SOURCES AGREE EXACTLY, WHICH IS WHY THIS ONE IS TRUSTED ─────────
//
// Verified 2026-08-30 by fetching `season-epm?season=2026&seasontype=2` and
// comparing all 602 rows against the scraped `dunksandthrees-actual-2026` cache
// on EPM, TS%, minutes, expected wins and rim FG%: 602 of 602 matched by
// player_id, maximum relative difference 0.0 — the same numbers to every digit
// the scrape carries. So the API is not a second opinion to be reconciled with
// the scrape; it is the same table, served properly. The current season is left
// on the scrape anyway (nothing is gained by rewiring a working, cached,
// key-free path) and the API is used for the seasons the scrape cannot see.
//
// ── AUTHENTICATION, AND THE ONE RULE ABOUT THE KEY ──────────────────────────
//
// `Authorization: <key>` — the bare key, no `Bearer` prefix. It lives in
// `.env.local` at the repo root as DUNKSANDTHREES_API_KEY, which is gitignored
// by the `*.local` rule, and Node loads it with `--env-file=.env.local`.
//
// IT MUST NEVER BE NAMED WITH A `VITE_` PREFIX. Vite inlines every VITE_* value
// into the client bundle at build time, and this repo is public — a VITE_
// rename would publish the key to GitHub Pages on the next deploy.
//
// It travels in a HEADER and never in a URL, so nothing that records a request
// — the cache's `meta.source`, an error message, a log line — can carry it.
// `redact` below is the belt to that braces: every error this module raises is
// passed through it, so even a server that echoed the key back into its own
// error body could not get it onto the console.
//
// ── RATE LIMITS ARE PER ENDPOINT, NOT GLOBAL ────────────────────────────────
//
// This is the part that bites. The documented general limit is 90 requests a
// minute, but `/team-epm` allows THREE — a 429 arrives on the second call if you
// treat one global budget as covering everything. So the throttle below is keyed
// by endpoint and each endpoint carries its own `perMinute`; a burst of
// `season-epm` calls cannot spend `team-epm`'s allowance and vice versa.
//
// The response carries no rate-limit headers at all (checked: no X-RateLimit-*,
// no Retry-After on a 200), so the spacing is enforced client-side from the
// documented numbers rather than negotiated. A 429 is still handled — see
// `apiRequest` — because a documented limit and an enforced limit are not
// always the same thing.

import { cached, politeDelay } from '../cache.js';

export const API_BASE = 'https://dunksandthrees.com/api/v1';

/** `seasontype` values, matching the scraped adapter's. */
export const SEASON_TYPE_REGULAR = 2;
export const SEASON_TYPE_PLAYOFFS = 4;

/**
 * The earliest season `season-epm` serves.
 *
 * Verified: `season=2001` answers 400 "Incorrect parameter format" rather than
 * an empty list, so this is the API's own floor and not a coverage gap. Asking
 * for a season below it is a programming error worth failing on locally instead
 * of spending a request to be told.
 */
export const FIRST_API_SEASON = 2002;

/**
 * Every endpoint, with the rate limit that applies to IT.
 *
 * `perMinute` is the documented allowance. The default is 90; `team-epm` is 3,
 * which was confirmed the hard way — a 429 on the second consecutive call.
 * Keeping the number next to the path is what stops the next person from
 * assuming one global budget.
 */
export const ENDPOINTS = {
  epm: { path: 'epm', perMinute: 90 },
  epmAll: { path: 'epm-all', perMinute: 90 },
  seasonEpm: { path: 'season-epm', perMinute: 90 },
  teamEpm: { path: 'team-epm', perMinute: 3 },
  gamePredictions: { path: 'game-predictions', perMinute: 90 },
  gamePredictionsBox: { path: 'game-predictions-box', perMinute: 90 },
};

export const API_KEY_ENV = 'DUNKSANDTHREES_API_KEY';

/**
 * The key, or a message saying exactly how to supply one.
 *
 * A fresh checkout has no `.env.local`, and the useful failure there is not
 * "401 Unauthorized" three layers down — it is this sentence, before a request
 * is made.
 */
export function apiKey(env = process.env) {
  const key = env?.[API_KEY_ENV];
  if (typeof key === 'string' && key.trim().length > 0) return key.trim();
  throw new Error(
    `${API_KEY_ENV} is not set. Put the dunksandthrees API key in .env.local at the repo root ` +
      `as \`${API_KEY_ENV}=...\` (that file is gitignored by the \`*.local\` rule) and run node ` +
      'with `--env-file=.env.local`. Do NOT rename it with a VITE_ prefix: Vite inlines VITE_* ' +
      'into the public client bundle.'
  );
}

/**
 * Strips the key out of any text on its way to a human.
 *
 * Defence in depth rather than a live concern — the key is only ever put in a
 * request header, so nothing this module composes contains it. What this guards
 * is the case nobody controls: an upstream error body that quotes back what it
 * was sent. Cheap, and the alternative is a key in a terminal scrollback.
 */
export function redact(text, key) {
  const value = String(text ?? '');
  if (!key) return value;
  return value.split(key).join('<redacted>');
}

// ── Throttling ──────────────────────────────────────────────────────────────

/**
 * A per-endpoint request spacer.
 *
 * SERIALIZED, not just spaced: each call chains onto the previous one, so ten
 * `schedule()` calls made at once leave in order at the right interval instead
 * of all reading the same `last` and departing together. That is the whole
 * failure mode a naive "sleep if it has been less than N ms" has.
 *
 * `sleep` and `now` are injectable so tests can prove the spacing without
 * spending twenty real seconds proving it.
 */
export function createThrottle(perMinute) {
  const spacing = perMinute > 0 ? Math.ceil(60000 / perMinute) : 0;
  let last = -Infinity;
  let chain = Promise.resolve();
  const state = {
    spacing,
    schedule({ sleep = politeDelay, now = Date.now } = {}) {
      const step = async () => {
        const wait = spacing - (now() - last);
        if (wait > 0) await sleep(wait);
        last = now();
      };
      // `.then(step, step)` rather than `.then(step)`: a rejected predecessor
      // must not permanently break the queue for every later request.
      chain = chain.then(step, step);
      return chain;
    },
    /** For tests, and for a long-lived process that wants a clean slate. */
    reset() {
      last = -Infinity;
      chain = Promise.resolve();
    },
  };
  return state;
}

const throttles = new Map();

/** The shared throttle for one endpoint, created on first use. */
export function throttleFor(name) {
  const spec = ENDPOINTS[name];
  if (!spec) throw new Error(`unknown dunksandthrees endpoint ${JSON.stringify(name)}`);
  if (!throttles.has(name)) throttles.set(name, createThrottle(spec.perMinute));
  return throttles.get(name);
}

export function resetThrottles() {
  for (const t of throttles.values()) t.reset();
}

// ── The request ─────────────────────────────────────────────────────────────

/** How many times a 429 is waited out before the run gives up. */
export const MAX_RETRIES = 4;

/**
 * How long to wait after a 429, in ms, for attempt `n` (0-based).
 *
 * Starts at the endpoint's OWN spacing rather than at a fixed second: on
 * `team-epm` the interval that matters is twenty seconds, and backing off for
 * one would just earn another 429. Doubling from there.
 */
export const backoffMs = (attempt, spacing) => Math.max(spacing, 1000) * 2 ** attempt;

/** `Retry-After` in seconds, when the server sends one. */
export function retryAfterMs(headers) {
  const raw = headers?.get?.('retry-after');
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/**
 * One authenticated request, throttled, retried on 429, parsed as JSON.
 *
 * THROWS ON EVERYTHING UNEXPECTED and never returns a partial or empty result
 * in place of a failure — the house rule in this directory, and the one that
 * matters most here: a silently-empty season would flow into the pooling as
 * "this player has no prior season", which is indistinguishable from the truth
 * for exactly the injured players the prior season is being fetched for.
 */
export async function apiRequest(
  endpoint,
  params = {},
  {
    fetchImpl = fetch,
    key = null,
    sleep = politeDelay,
    now = Date.now,
    maxRetries = MAX_RETRIES,
    log = () => {},
  } = {}
) {
  const spec = ENDPOINTS[endpoint];
  if (!spec) throw new Error(`unknown dunksandthrees endpoint ${JSON.stringify(endpoint)}`);
  const authKey = key ?? apiKey();
  const throttle = throttleFor(endpoint);

  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
  );
  const url = `${API_BASE}/${spec.path}${query.size ? `?${query}` : ''}`;
  const fail = message => new Error(redact(message, authKey));

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    await throttle.schedule({ sleep, now });
    // The key goes in a header and ONLY in a header. `url` above is safe to
    // log, cache and print precisely because of that.
    const res = await fetchImpl(url, { headers: { Authorization: authKey } });

    if (res.status === 429) {
      if (attempt === maxRetries) {
        throw fail(
          `dunksandthrees ${spec.path}: rate limited (429) after ${maxRetries + 1} attempts. ` +
            `This endpoint allows ${spec.perMinute} requests a minute — check ENDPOINTS in ` +
            'sources/dunksAndThreesApi.js if that number has changed.'
        );
      }
      const wait = retryAfterMs(res.headers) ?? backoffMs(attempt, throttle.spacing);
      log(`  429 from ${spec.path}; waiting ${Math.round(wait / 1000)}s and retrying`);
      await sleep(wait);
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      throw fail(
        `dunksandthrees ${spec.path}: ${res.status} — the API key was rejected. Check ` +
          `${API_KEY_ENV} in .env.local.`
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw fail(
        `dunksandthrees ${spec.path} failed: ${res.status}${body ? ` ${body.slice(0, 200)}` : ''} ` +
          `(${url})`
      );
    }

    const parsed = await res.json();
    if (!Array.isArray(parsed)) {
      throw fail(
        `dunksandthrees ${spec.path}: expected a JSON array, got ` +
          `${parsed === null ? 'null' : typeof parsed}. The response shape has changed.`
      );
    }
    return parsed;
  }
  /* c8 ignore next */
  throw fail(`dunksandthrees ${spec.path}: exhausted retries without a result`);
}

// ── season-epm ──────────────────────────────────────────────────────────────

/**
 * The columns every row must carry before it is believed.
 *
 * Deliberately short: identity, sample size, and the one impact number every
 * consumer reads. A row can legitimately have a null `tot` (the site withholds
 * EPM below fifty minutes — 30 of the 589 rows in 2025), so PRESENCE of the key
 * is what is checked, not a value. What this catches is a renamed or restructured
 * payload, which is the failure that would otherwise arrive as 589 undefineds.
 */
export const REQUIRED_SEASON_EPM_FIELDS = [
  'season',
  'seasontype',
  'player_id',
  'player_name',
  'gp',
  'mp',
  'tot',
];

/**
 * Validates a `season-epm` body and confirms it is the season that was asked for.
 *
 * CHECKING THE ANSWER RATHER THAN THE REQUEST is the same rule the scraped
 * adapter follows, for the same reason: `season` and `seasontype` are query
 * parameters, and a silently-ignored one hands back a different season's table
 * under the right filename. Every row echoes both, so both are verified on every
 * row rather than on the first.
 */
export function parseSeasonEpmRows(rows, { season, seasonType }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      `season-epm returned no rows for season ${season} seasontype ${seasonType}.`
    );
  }
  const first = rows[0];
  const missing = REQUIRED_SEASON_EPM_FIELDS.filter(f => !(f in first));
  if (missing.length) {
    throw new Error(
      `season-epm rows are missing expected fields: ${missing.join(', ')}. The API's response ` +
        'shape has changed — see REQUIRED_SEASON_EPM_FIELDS in sources/dunksAndThreesApi.js.'
    );
  }
  const wrongSeason = rows.find(r => r.season !== season);
  if (wrongSeason) {
    throw new Error(
      `season-epm served season ${wrongSeason.season}, not ${season} (${wrongSeason.player_name}).`
    );
  }
  const wrongType = rows.find(r => r.seasontype !== seasonType);
  if (wrongType) {
    throw new Error(
      `season-epm served seasontype ${wrongType.seasontype}, not ${seasonType} ` +
        `(${wrongType.player_name}).`
    );
  }
  const ids = new Set(rows.map(r => r.player_id));
  if (ids.size !== rows.length) {
    throw new Error(
      `season-epm returned ${rows.length} rows for ${ids.size} players — the table is supposed ` +
        'to be one aggregated row per player per season type, so a duplicate means a traded ' +
        'player is now being split and the pooling upstream would double-count him.'
    );
  }
  return rows;
}

/**
 * One API row, renamed to the vocabulary the generators already speak.
 *
 * FIELD-FOR-FIELD THE SAME SHAPE `toActualSeasonRate` PRODUCES in
 * sources/dunksAndThrees.js, and that is a requirement rather than a
 * convenience: poolSeasons.js, speedPower.js and generateCards.js all read that
 * shape, so a prior season fetched here drops into the same pipeline as the
 * current one with nothing downstream knowing which source it came from.
 *
 * ── THE ONE DERIVED FIELD ───────────────────────────────────────────────────
 *
 * `fgaPer75` has no API column. The scraped page carries `fga_75`; the API
 * carries the two halves, `fg2a_75` and `fg3a_75`, and their sum is that number
 * — checked against the scrape for the overlapping season (SGA 2025-26:
 * 16.0613 + 4.67867 = 20.73997 against the scrape's 20.74, which is the same
 * value at the six significant figures the scrape rounds to). It matters because
 * `fgaPer75` is what poolSeasons.js weights eFG% by and what the shooting
 * shrinkage counts attempts with, so a null there would quietly drop a player
 * out of both.
 *
 * ── AND THE FIELDS THE SCRAPE NEVER HAD ─────────────────────────────────────
 *
 * `pts75` / `reb75` / `ast75` are the ones to notice. The scraped ACTUAL page
 * reports rebounds and assists only as rate PERCENTAGES, which cannot be
 * inverted into counts without team and opponent totals — which is the entire
 * reason the scoring chart still reads the PREDICTED leaderboard instead of what
 * players actually did (see the header of generateCards.js). These columns close
 * that hole. Nothing reads them yet; they are carried so that when something
 * does, the cache already holds them.
 */
export function toApiSeasonRate(row) {
  const games = row.gp ?? 0;
  const fga2 = row.fg2a_75;
  const fga3 = row.fg3a_75;
  return {
    name: row.player_name,
    personId: row.player_id,
    team: row.team_alias,
    position: row.pos_text,
    age: row.age,
    games,
    minutes: row.mp,
    mpg: row.mpg,
    starts: row.start,
    epm: row.tot,
    epmOff: row.off,
    epmDef: row.def,
    ewins: row.ewins,
    ewinsPerGame: games > 0 && Number.isFinite(row.ewins) ? row.ewins / games : null,
    usage: row.usg,
    tsPct: row.tspct,
    efg: row.efg,
    fgPctRim: row.fgpct_rim,
    fgPctMid: row.fgpct_mid,
    fgPct2: row.fg2pct,
    fgPct3: row.fg3pct,
    ftPct: row.ftpct,
    fgaRimPer75: row.fga_rim_75,
    fgaMidPer75: row.fga_mid_75,
    fga3Per75: fga3,
    ftaPer75: row.fta_75,
    // Derived, not served. See the note above.
    fgaPer75: Number.isFinite(fga2) && Number.isFinite(fga3) ? fga2 + fga3 : null,
    orbPct: row.orbpct,
    drbPct: row.drbpct,
    astPct: row.astpct,
    tovPct: row.topct,
    stlPct: row.stlpct,
    blkPct: row.blkpct,
    // ── Beyond the scrape's reach ──────────────────────────────────────────
    // Per-75 COUNTS, which is what a scoring chart actually needs.
    pts75: row.pts_75,
    reb75: row.reb_75,
    ast75: row.ast_75,
    orb75: row.orb_75,
    drb75: row.drb_75,
    tov75: row.tov_75,
    stl75: row.stl_75,
    blk75: row.blk_75,
    // Provenance, so a pooled row can always say which season it came from.
    season: row.season,
    seasonType: row.seasontype,
    rosterGames: row.roster_games,
    rookieYear: row.rookie_year,
    inches: row.inches,
    weight: row.weight,
  };
}

/** The cache key one season+seasontype lands under. */
export const seasonEpmCacheKey = (season, seasonType) =>
  `dunksandthrees-api-season-epm-${season}-st${seasonType}`;

/**
 * Every player's season, from the API, cached to disk.
 *
 * `season` is the END year, matching every other season argument in this tree
 * (2025 = the 2024-25 season), and matching what the API itself means by the
 * parameter.
 *
 * CACHED PER SEASON AND SEASON TYPE, which is the whole reason a 25-season
 * archive is affordable: a re-run costs nothing and asks nothing. `force` is the
 * escape hatch for the one case a key cannot express — a change to
 * `toApiSeasonRate`, which makes the stored value stale under an unchanged key.
 */
export async function fetchSeasonEpm(
  season,
  { seasonType = SEASON_TYPE_REGULAR, force = false, ...options } = {}
) {
  if (!Number.isInteger(season) || season < FIRST_API_SEASON) {
    throw new Error(
      `season must be an integer year of ${FIRST_API_SEASON} or later (the API's own floor; ` +
        `${FIRST_API_SEASON - 1} answers 400), got ${JSON.stringify(season)}`
    );
  }
  return cached(
    seasonEpmCacheKey(season, seasonType),
    async () => {
      const body = await apiRequest('seasonEpm', { season, seasontype: seasonType }, options);
      return parseSeasonEpmRows(body, { season, seasonType }).map(toApiSeasonRate);
    },
    {
      // The URL is safe to record because the key never travels in one.
      force,
      meta: { source: `${API_BASE}/${ENDPOINTS.seasonEpm.path}`, season, seasonType },
    }
  );
}
