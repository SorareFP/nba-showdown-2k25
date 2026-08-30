// Who gets a WNBA card, and what stat line each one is carded on.
//
// Two jobs, and the second is the interesting one.
//
// ── 1. THE POOL ─────────────────────────────────────────────────────────────
//
// MPG >= 16 and G >= 20 in the 2026 table — 101 of the league's 230 players —
// OR named in card-data/wnba-force-include-2026.json. The rule and the list
// COMPOSE exactly as they do on the NBA side (`passes the rule OR is named`),
// so a name can only ever ADD a player, never remove or alter one.
//
// ── 2. THE TWO-SEASON BLEND, AND WHY IT IS POSSIBLE HERE ────────────────────
//
// The six force-included players are stars who missed most of 2026: Napheesa
// Collier played 11 games at 30.0 minutes, Kelsey Plum 17 at 30.5. Carding
// them on that sample alone is what the NBA pool was forced to do with its
// nineteen injury exceptions — and memory/new_season_player_pool.md records
// exactly why it had to: dunksandthrees paywalls prior seasons, so the NBA
// blend would mean cross-source normalisation onto a scale that does not exist
// before this year.
//
// NONE OF THAT APPLIES HERE. Basketball-Reference publishes WNBA 2025 in full,
// in the same three tables, with the same columns. So the blend is the ordinary
// volume-weighted pooling scripts/cardgen/poolSeasons.js already does for the
// playoffs, and this module follows that file's rule rather than inventing one:
//
//     pooled = (rate_a * volume_a + rate_b * volume_b) / (volume_a + volume_b)
//
// with THE RIGHT VOLUME PER STAT. A straight 50/50 average of two rates is the
// thing being ruled out; it would give an 11-game season the same say as a
// 44-game one.
//
//   per-100 and rate percentages   POSSESSIONS
//   shooting percentages           THE RELEVANT ATTEMPTS — true-shooting
//                                  attempts for TS%, three-point attempts for
//                                  3P%, two-point attempts for 2P%, free-throw
//                                  attempts for FT%. Unlike the NBA path these
//                                  are REAL COUNTS, not reconstructions: the
//                                  WNBA per-game table gives attempts per game
//                                  and games played, so the product is the
//                                  attempt total exactly.
//   season totals (WS/OWS/DWS,     SUMMED, and the rates re-derived from the
//   games, minutes, starts)        pooled totals afterwards.
//
// ── THE ONE PLACE THIS DIFFERS FROM poolSeasons.js, AND WHY ─────────────────
//
// poolSeasons.js observes that its pace constant cancels between numerator and
// denominator, so its possession weights are minutes weights in effect. THAT IS
// NOT TRUE ACROSS TWO SEASONS. The WNBA played at 77.32 possessions per 40
// minutes in 2025 and 79.24 in 2026 — genuinely different denominators, a 2.5%
// difference — so possessions are computed with EACH SEASON'S OWN pace and the
// constant does not cancel. It is a small correction and it is free.
//
// The per-100 COUNTING stats get a second, larger version of the same
// treatment: they are converted to per-four-minute production at each season's
// own pace, pooled on minutes (which is exactly right, since per-four-minute
// production is minutes-denominated), and restated in 2026 per-100 units. That
// is the difference between "what she produced per possession in two leagues
// of different speed" and "what she produced in four minutes", and a scoring
// chart pays out over four minutes.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cache.js';
import { normalizeName } from '../resolveTeams.js';
import {
  WNBA_SEASON,
  WNBA_BLEND_SEASON,
  WNBA_POOL_RULE,
  WNBA_GAME_MINUTES,
  leaguePace,
  possessionsFromMinutes,
} from './constants.js';
import { isAggregateTeam } from '../sources/wnbaReference.js';
import { positionGroup } from './bpmModel.js';

export const FORCE_INCLUDE_FILE = path.join(
  REPO_ROOT,
  'card-data',
  'wnba-force-include-2026.json'
);

/** Free-throw weight inside a true-shooting attempt. The standard 0.44. */
export const FT_TRIP_FACTOR = 0.44;

/**
 * The force-include list as `{ name, reason }`, in file order.
 *
 * Its own file, deliberately not an extra section of card-data/
 * force-include-2026.json: that list is read by the NBA pool generator, whose
 * every name must match a row in the NBA per-game table or the run fails.
 */
export function readForceInclude(file = FORCE_INCLUDE_FILE) {
  if (!fs.existsSync(file)) return [];
  const { _comment, ...entries } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.entries(entries).map(([name, reason]) => ({ name, reason }));
}

/** Joins one season's four tables into one row per player. */
export function joinWnbaSeason({ season, perGame, advanced, perPoss, totals = [] }) {
  const adv = new Map(advanced.map(r => [r.playerId, r]));
  const poss = new Map(perPoss.map(r => [r.playerId, r]));
  const tot = new Map(totals.map(r => [r.playerId, r]));
  return perGame.map(g => {
    const a = adv.get(g.playerId) ?? {};
    const p = poss.get(g.playerId) ?? {};
    // Exact season counts where the totals table has them; the per-game table
    // times games where it does not, which is the same number to within its own
    // rounding decimal. Falling back rather than failing keeps the pipeline
    // working on a cache written before the totals table was fetched.
    const t = tot.get(g.playerId) ?? null;
    const games = g.games ?? 0;
    return {
      season,
      playerId: g.playerId,
      name: g.name,
      team: g.team,
      pos: g.pos ?? a.pos ?? p.pos ?? null,
      games,
      minutes: g.minutes ?? 0,
      mpg: g.mpg ?? null,
      starts: g.starts ?? null,
      // Advanced.
      per: a.per ?? null,
      tsPct: a.tsPct ?? null,
      efg: a.efg ?? null,
      fg3aRate: a.fg3aRate ?? null,
      ftRate: a.ftRate ?? null,
      orbPct: a.orbPct ?? null,
      trbPct: a.trbPct ?? null,
      astPct: a.astPct ?? null,
      stlPct: a.stlPct ?? null,
      blkPct: a.blkPct ?? null,
      tovPct: a.tovPct ?? null,
      usgPct: a.usgPct ?? null,
      offRtg: a.offRtg ?? null,
      defRtg: a.defRtg ?? null,
      ows: a.ows ?? null,
      dws: a.dws ?? null,
      ws: a.ws ?? null,
      wsPer40: a.wsPer40 ?? null,
      // Per 100 possessions.
      pts100: p.pts100 ?? null,
      trb100: p.trb100 ?? null,
      orb100: p.orb100 ?? null,
      drb100: p.drb100 ?? null,
      ast100: p.ast100 ?? null,
      stl100: p.stl100 ?? null,
      blk100: p.blk100 ?? null,
      tov100: p.tov100 ?? null,
      pf100: p.pf100 ?? null,
      fga100: p.fga100 ?? null,
      fg3a100: p.fg3a100 ?? null,
      fg2a100: p.fg2a100 ?? null,
      fta100: p.fta100 ?? null,
      // Shooting percentages, and the REAL attempt totals behind them.
      fgPct: g.fgPct ?? null,
      fgPct3: g.fgPct3 ?? null,
      fgPct2: g.fgPct2 ?? null,
      ftPct: g.ftPct ?? null,
      fgaTotal: t?.fga ?? (g.fga ?? 0) * games,
      fg3aTotal: t?.fg3a ?? (g.fg3a ?? 0) * games,
      fg2aTotal: t?.fg2a ?? (g.fg2a ?? 0) * games,
      ftaTotal: t?.fta ?? (g.fta ?? 0) * games,
      // ── THE CHART'S ANCHOR ────────────────────────────────────────────────
      //
      // Season counts, so per-four-minute production is `4 * total / minutes` —
      // arithmetic, with no pace in it. The alternative is the NBA pipeline's
      // reconstruction from a per-100 rate at an assumed league pace, and on
      // this table that carries each player's own TEAM pace as error: Golden
      // State ran at 74.6 possessions per 40 minutes against a league 79.24, so
      // a Valkyrie's chart would come out 6% too big and an Indiana player's 2%
      // too small. See wnba/constants.js.
      ptsTotal: t?.pts ?? (g.pts ?? 0) * games,
      trbTotal: t?.trb ?? (g.trb ?? 0) * games,
      astTotal: t?.ast ?? (g.ast ?? 0) * games,
    };
  });
}

/**
 * Production per four-minute section, straight from the season counts.
 *
 * `4 * total / minutes`. THE definition, not an estimate of it — which is why
 * this and not the per-100 route is what the scoring chart is built on.
 */
export function per4MinFromTotals(total, minutes) {
  if (!Number.isFinite(total) || !Number.isFinite(minutes) || minutes <= 0) return 0;
  return (4 * total) / minutes;
}

/**
 * The team a player FINISHED the season on, from her split rows.
 *
 * `TOT` is not a franchise: it themes to the neutral grey fallback and prints
 * no logo, which is the right signal for genuinely unknown data and the wrong
 * one for a player whose team is perfectly well known and merely split across
 * two rows. The split rows are the only place that team is written down.
 *
 * ── LAST, NOT MOST GAMES, AND THE DIFFERENCE IS EIGHT PLAYERS ───────────────
 *
 * This rule was "the franchise she played the most games for", which is a
 * reasonable answer to a question nobody asked. A card prints where a player
 * IS, not where she spent the most of a season that is over: Kelsey Plum went
 * LAS (12 games) then PHO (5), and most-games put her on the Sparks — which is
 * the report that sent this back for a fix.
 *
 * Basketball-Reference lists a moved player's split rows in the order she
 * played for them, so the last non-aggregate row is the team she finished on.
 * That is an assumption about a source, so it is CHECKED rather than trusted:
 * for all 16 players with a TOT row in the 2026 table, the last split row
 * agrees with wnba.com's live roster and most-games disagrees on eight of them.
 * See scripts/cardgen/wnba/resolveWnbaTeams.js, which prefers that roster
 * outright and falls back to this.
 */
export function resolveDisplayTeams(splits) {
  const byPlayer = new Map();
  for (const row of splits) {
    if (isAggregateTeam(row.team)) continue;
    // Last write wins, which IS the rule — the rows arrive in the order she
    // played for them.
    byPlayer.set(row.playerId, row.team);
  }
  return byPlayer;
}

/**
 * The pool: the rule, OR the list. A named player who matches no row is
 * returned in `unmatched` rather than silently dropped.
 */
export function buildPool(rows, { rule = WNBA_POOL_RULE, forceInclude = [] } = {}) {
  const named = new Set(forceInclude.map(f => normalizeName(f.name ?? f)));
  const passes = r => (r.mpg ?? 0) >= rule.minMpg && (r.games ?? 0) >= rule.minGames;
  const pool = rows.filter(r => passes(r) || named.has(normalizeName(r.name)));
  const present = new Set(rows.map(r => normalizeName(r.name)));
  return {
    pool: [...pool].sort((a, b) => (b.mpg ?? 0) - (a.mpg ?? 0)),
    byRule: rows.filter(passes).length,
    forced: pool.filter(r => named.has(normalizeName(r.name)) && !passes(r)),
    unmatched: forceInclude
      .map(f => f.name ?? f)
      .filter(name => !present.has(normalizeName(name))),
  };
}

/** Volume-weighted mean over `{ value, weight }` parts. Unusable parts drop out. */
export function poolWeighted(parts) {
  const usable = (parts ?? []).filter(
    p => p && Number.isFinite(p.value) && Number.isFinite(p.weight) && p.weight > 0
  );
  if (usable.length === 0) return null;
  const total = usable.reduce((a, p) => a + p.weight, 0);
  return total > 0 ? usable.reduce((a, p) => a + p.value * p.weight, 0) / total : null;
}

const poolSum = values => {
  const usable = (values ?? []).filter(Number.isFinite);
  return usable.length ? usable.reduce((a, v) => a + v, 0) : null;
};

/** Which volume each rate pools on. The substance of the blend. */
export const RATE_DENOMINATORS = {
  per: 'possessions',
  tsPct: 'tsa',
  efg: 'fga',
  fgPct: 'fga',
  fgPct3: 'fg3a',
  fgPct2: 'fg2a',
  ftPct: 'fta',
  fg3aRate: 'fga',
  ftRate: 'fga',
  orbPct: 'possessions',
  trbPct: 'possessions',
  astPct: 'possessions',
  stlPct: 'possessions',
  blkPct: 'possessions',
  tovPct: 'possessions',
  usgPct: 'possessions',
  offRtg: 'possessions',
  defRtg: 'possessions',
};

/**
 * The per-100 COUNTING stats, pooled through per-four-minute production.
 *
 * Not on this list and not pooled on possessions, because the two seasons'
 * possessions are not the same length of time. See the header.
 */
export const PER_100_COUNTS = [
  'pts100', 'trb100', 'orb100', 'drb100', 'ast100', 'stl100', 'blk100', 'tov100',
  'pf100', 'fga100', 'fg3a100', 'fg2a100', 'fta100',
];

/**
 * Season TOTALS, which pool by addition.
 *
 * The counting totals being here is what makes the blend exact for the scoring
 * chart: pooled per-four-minute production is `4 * (pts_a + pts_b) / (min_a +
 * min_b)`, which is the rate the two seasons would have produced if they had
 * never been split — no weighting scheme to get wrong, and no pace in it.
 */
export const SUMMED_FIELDS = ['games', 'minutes', 'starts', 'ws', 'ows', 'dws',
  'fgaTotal', 'fg3aTotal', 'fg2aTotal', 'ftaTotal',
  'ptsTotal', 'trbTotal', 'astTotal'];

/** Every volume one season-row contributes, in real counts. */
export function volumes(row) {
  const minutes = Number.isFinite(row?.minutes) && row.minutes > 0 ? row.minutes : 0;
  const fga = row?.fgaTotal ?? 0;
  const fta = row?.ftaTotal ?? 0;
  return {
    games: row?.games ?? 0,
    minutes,
    possessions: possessionsFromMinutes(minutes, row?.season),
    fga,
    fta,
    fg3a: row?.fg3aTotal ?? 0,
    fg2a: row?.fg2aTotal ?? 0,
    // TS% = PTS / (2 * (FGA + 0.44 * FTA)). This is that denominator.
    tsa: fga + FT_TRIP_FACTOR * fta,
  };
}

/**
 * Two (or more) of one player's seasons, folded into a single row.
 *
 * A single season passes through UNCHANGED — same fields, same values — with
 * only the provenance block added, so the 101 players who are not blended are
 * not silently re-derived.
 */
export function poolSeasonRows(rows, { targetSeason = WNBA_SEASON } = {}) {
  const usable = (rows ?? []).filter(r => r && (r.games ?? 0) > 0);
  if (usable.length === 0) return null;
  const identity = usable.find(r => r.season === targetSeason) ?? usable[0];
  if (usable.length === 1) {
    return { ...usable[0], seasonsPooled: [usable[0].season], blended: false };
  }

  const vols = usable.map(volumes);
  const pooled = {};
  for (const [field, weightKey] of Object.entries(RATE_DENOMINATORS)) {
    pooled[field] = poolWeighted(
      usable.map((r, i) => ({ value: r[field], weight: vols[i][weightKey] }))
    );
  }
  for (const field of SUMMED_FIELDS) pooled[field] = poolSum(usable.map(r => r[field]));

  // The per-100 counts, through per-four-minute production at each season's
  // own pace and back into the target season's per-100 units.
  const targetPace = leaguePace(targetSeason);
  for (const field of PER_100_COUNTS) {
    const per4 = poolWeighted(
      usable.map((r, i) => ({
        value: ((r[field] ?? null) === null ? null : (r[field] * leaguePace(r.season)) / 1000),
        weight: vols[i].minutes,
      }))
    );
    pooled[field] = per4 === null ? null : (per4 * 1000) / targetPace;
  }

  const games = pooled.games ?? 0;
  const minutes = pooled.minutes ?? 0;
  return {
    ...identity,
    ...pooled,
    season: targetSeason,
    mpg: games > 0 ? minutes / games : null,
    // Re-derived from the pooled totals rather than pooled as a rate — which is
    // the same number and says so out loud.
    wsPer40: minutes > 0 ? ((pooled.ws ?? 0) * WNBA_GAME_MINUTES) / minutes : null,
    seasonsPooled: usable.map(r => r.season).sort(),
    blended: true,
    parts: usable.map(r => ({
      season: r.season,
      team: r.team,
      games: r.games,
      minutes: r.minutes,
      mpg: r.mpg,
      pts100: r.pts100,
      tsPct: r.tsPct,
      per: r.per,
      ws: r.ws,
    })),
  };
}

/**
 * Every pool player's carded row: 2026 alone, or 2026 pooled with 2025 for the
 * named six.
 *
 * Matched on Basketball-Reference's own WNBA player id, never on name — the
 * same rule and the same reason as the NBA history path.
 */
export function cardedRows({ pool, blendRows, blendSeason = WNBA_BLEND_SEASON, blendIds }) {
  const prior = new Map((blendRows ?? []).map(r => [r.playerId, r]));
  return pool.map(row => {
    if (!blendIds.has(row.playerId)) return poolSeasonRows([row]);
    const before = prior.get(row.playerId);
    const pooledRow = poolSeasonRows(before ? [before, row] : [row]);
    if (!before) pooledRow.blendMissing = blendSeason;
    return pooledRow;
  });
}

/** One WNBA row in the flat shape bpmModel.js reads. */
export function wnbaFeatureRow(row) {
  const minutes = row.minutes ?? 0;
  const games = row.games ?? 0;
  const rate = total =>
    Number.isFinite(total) && minutes > 0 ? (total * WNBA_GAME_MINUTES) / minutes : null;
  return {
    ...row,
    league: 'wnba',
    posGroup: positionGroup(row.pos),
    minShare: games > 0 ? minutes / (games * WNBA_GAME_MINUTES) : null,
    // WS per 40, the WNBA's own analogue of the NBA's WS per 48.
    wsRate: row.wsPer40 ?? rate(row.ws),
    owsRate: rate(row.ows),
    dwsRate: rate(row.dws),
  };
}
