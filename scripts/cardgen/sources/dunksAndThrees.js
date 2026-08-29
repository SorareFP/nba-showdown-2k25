// dunksandthrees.com adapter.
//
// TWO DIFFERENT THINGS LIVE HERE and they are not interchangeable:
//
//  - `fetchSeasonRates` returns ONE season-level rate record per player: per-100
//    possession production, shooting splits by location, and the EPM triple
//    (off / def / tot). These are point estimates. They are what the Speed/Power,
//    Shot Line, boost and salary layers consume, and they are the MEAN the
//    provisional scoring charts are anchored to.
//  - `fetchGameLog` still throws. The game-log API is not public, and a chart
//    needs a real per-game distribution rather than a mean — see
//    scripts/cardgen/variance.js for how that gap is bridged.
//
// HOW THE DATA IS READ. https://dunksandthrees.com/epm renders the leaderboard
// as a virtualized table: only ~29 of the ~600 rows exist in the served HTML at
// any time, so scraping the markup gets a arbitrary 29-player slice. The site is
// SvelteKit, which serves every page's load-function payload at the page's own
// `__data.json`. Requesting `/epm/__data.json` returns the WHOLE leaderboard —
// one request instead of six hundred, which is also by far the most courteous
// way to read it.
//
// That payload is devalue-encoded (SvelteKit's serializer): a flat array where
// every object's field values are INTEGER INDICES into the same array rather
// than inline values, so repeated values are stored once. `unflattenDevalue`
// below is that format's documented resolution algorithm.
//
// ONE HARD LIMIT, VERIFIED 2026-08-29: only the CURRENT season is public. Ask
// for `?season=2025` and the payload comes back with every row past the top
// five replaced by a placeholder literally named "Locked Player" — the rest is
// behind a subscription. So prior-season work (fitting anything against the
// finished 2025-26 card set, whose stats are 2024-25) has to come from
// Basketball-Reference instead. fetchSeasonRates throws rather than returning
// the mostly-locked table, because a silent 5-real-rows result would poison
// whatever it fed.

import { cached } from '../cache.js';

// The `x-sveltekit-invalidated` parameter is not optional. Without it SvelteKit
// answers with its STREAMING form (content-type `text/sveltekit-data`): several
// JSON documents concatenated, which JSON.parse rejects at the first byte of the
// second one. With it, the response is a single `application/json` body.
const EPM_DATA_URL = 'https://dunksandthrees.com/epm/__data.json?x-sveltekit-invalidated=001';
const LOCKED_PLAYER_NAME = 'Locked Player';

/**
 * Resolves SvelteKit's devalue "flattened" array into a plain value.
 *
 * Every entry is either a literal (string/number/boolean/null) or a container
 * whose members are integer indices back into the same array. A handful of
 * negative indices are sentinels for values JSON cannot express.
 */
export function unflattenDevalue(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('unflattenDevalue: expected a non-empty array');
  }
  const hydrated = new Array(values.length);
  const seen = new Set();

  function hydrate(index) {
    if (index === -1 || index === -2) return undefined; // undefined / array hole
    if (index === -3) return NaN;
    if (index === -4) return Infinity;
    if (index === -5) return -Infinity;
    if (index === -6) return -0;
    if (seen.has(index)) return hydrated[index];
    seen.add(index);

    const value = values[index];
    if (!value || typeof value !== 'object') {
      hydrated[index] = value;
    } else if (Array.isArray(value)) {
      // devalue tags non-plain types (Date, Set, Map, BigInt) with a leading
      // string. None of them appear in this payload; passing the raw tagged
      // array through is better than guessing at a type we have never seen.
      if (typeof value[0] === 'string') {
        hydrated[index] = value[0] === 'Date' ? new Date(value[1]) : value;
      } else {
        const array = [];
        hydrated[index] = array;
        for (let i = 0; i < value.length; i += 1) {
          if (value[i] === -2) continue; // sparse hole
          array[i] = hydrate(value[i]);
        }
      }
    } else {
      const object = {};
      hydrated[index] = object;
      for (const key of Object.keys(value)) object[key] = hydrate(value[key]);
    }
    return hydrated[index];
  }

  return hydrate(0);
}

/** Pulls the leaderboard rows out of a `__data.json` body. */
export function parseEpmPayload(body) {
  const node = (body?.nodes ?? []).find(n => n && n.type === 'data' && Array.isArray(n.data));
  if (!node) throw new Error('parseEpmPayload: no data node in the __data.json body');
  const page = unflattenDevalue(node.data);
  const rows = page?.stats;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('parseEpmPayload: payload carried no `stats` array');
  }
  const locked = rows.filter(r => r?.player_name === LOCKED_PLAYER_NAME).length;
  if (locked > 0) {
    throw new Error(
      `parseEpmPayload: ${locked} of ${rows.length} rows are "${LOCKED_PLAYER_NAME}" — this ` +
        'season is behind dunksandthrees\' subscription. Only the current season is public.'
    );
  }
  return { season: page.season, asOf: page.date, rows };
}

/** The subset of each row the card generators actually use, with plain names. */
export function toSeasonRate(row) {
  return {
    name: row.player_name,
    personId: row.player_id,
    team: row.team_alias,
    position: row.position,
    age: row.age,
    // EPM: the impact triple. `def` is what the Def Boost is derived from.
    epm: row.tot,
    epmOff: row.off,
    epmDef: row.def,
    // Playing time and pace context.
    minutesPer48: row.p_mp_48,
    teamPossPer48: row.p_t_poss_48,
    usage: row.p_usg,
    startedShare: row.p_pct_start,
    // Per-100-possession production — the scoring chart's anchor.
    pts100: row.p_pts_100,
    ast100: row.p_ast_100,
    orb100: row.p_orb_100,
    drb100: row.p_drb_100,
    tov100: row.p_tov_100,
    stl100: row.p_stl_100,
    blk100: row.p_blk_100,
    // Shooting, split by location — the Shot Line / Paint / 3PT layer.
    tsPct: row.p_tspct,
    efg: row.p_efg,
    fga2Per100: row.p_fg2a_100,
    fga3Per100: row.p_fg3a_100,
    ftaPer100: row.p_fta_100,
    fgaRimPer100: row.p_fga_rim_100,
    fgaMidPer100: row.p_fga_mid_100,
    fgPct2: row.p_fg2pct,
    fgPct3: row.p_fg3pct,
    fgPctRim: row.p_fgpct_rim,
    fgPctMid: row.p_fgpct_mid,
    ftPct: row.p_ftpct,
  };
}

/** Total rebounds per 100 — the site splits them, the card does not. */
export const trb100 = rate => (rate.orb100 ?? 0) + (rate.drb100 ?? 0);

/**
 * Season-level per-100 rates for every player, cached to disk.
 *
 * `season` is the END year, matching every other season argument in this tree
 * (2026 = the 2025-26 season). Only the current season is public; see the
 * header note.
 */
export async function fetchSeasonRates(season, { force = false, fetchImpl = fetch } = {}) {
  return cached(
    `dunksandthrees-epm-${season}`,
    async () => {
      const res = await fetchImpl(EPM_DATA_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`dunksandthrees fetch failed: ${res.status}`);
      const parsed = parseEpmPayload(await res.json());
      if (parsed.season !== season) {
        throw new Error(
          `dunksandthrees served season ${parsed.season}, not ${season}. Only the current ` +
            'season is public — prior seasons come back as "Locked Player" rows.'
        );
      }
      return parsed.rows.map(toSeasonRate);
    },
    { force, meta: { source: EPM_DATA_URL, season } }
  );
}

/**
 * Still unavailable. Kept so the orchestrator's source interface stays honest
 * about which provider can supply which shape of data.
 */
export async function fetchGameLog() {
  throw new Error(
    'dunksandthrees.com game-log source not yet available — use sources/basketballReference.js'
  );
}
