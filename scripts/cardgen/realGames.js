// The real-games feed for chart building: each pool player's LAST 82 GAMES
// (playoffs included), opponent-adjusted and minutes-damped, in exactly the
// row shape computeStatBands eats ({minutes, pts, reb, ast}).
//
// Three transforms, each an approved design decision:
//
//   WINDOW      rows from the 2025-26 page (regular + playoffs) topped up from
//               2024-25, sorted by date descending, first 82. One window rule
//               for everyone — the force-include blend, universalized.
//
//   OPPONENT    pts and ast scale by LEAGUE_ORTG / (LEAGUE_ORTG - opp DEF EPM):
//               production against the Thunder defense counts for more than
//               production against the Jazz. Rebounds stay raw — they hinge on
//               miss volume, not defensive quality, to first order. League-wide
//               the factors mean out to ~1, so no bias enters.
//
//   MINUTES     bands.js's normalize loads v with (36/MPG)^1.33 (measured), but
//               the published cards' own EV/T slope is (36/MPG)^0.267 — nearly
//               flat. Scaling each game's counts by (MPG/36)^MINUTES_DAMP
//               reproduces the published treatment instead of the raw formula's
//               low-minute inflation. The exponent is verified against the
//               223-player published overlap after building.
//
// Counts are re-rounded to integers after adjustment: real logs are integers,
// and the ties integers create are what give band widths their variety.
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, REPO_ROOT, readCache } from './cache.js';

export const LEAGUE_ORTG = 115;
export const MINUTES_DAMP = 0.9; // softened from 1.06: integer rounding turned full damping into variance-death for role players (box-score sim)
// Rebounds damp on an MPG-DEPENDENT exponent, fitted by the box-score sim:
// low-MPG bigs' per-minute boards are the cheapest stat in basketball
// (Valančiūnas at 13 MPG simmed 23.5 reb/36 against a real 14.4 under the
// flat 0.9), but a flat harder exponent crushed mid-minute players who were
// already right (Caruso, perfect at 0.9, fell to 2.8 vs 5.1 under a flat
// 1.35). 0.9 at 22+ MPG, ramping to 1.4 at 12.
export const rebDampExponent = mpg => Math.min(1.4, 0.9 + 0.5 * Math.max(0, (22 - mpg) / 10));
export const WINDOW_GAMES = 82;

// Games below this many minutes are excluded from the sample. The bands
// pipeline normalizes each game as (stat * 36 / minutes) / minutes — a
// quadratic divide — so a 2-minute cameo with a single bucket extrapolates to
// 9 per unit and dominates the p90 (Nae'Qwan Tomlin's 21+ tier reached 6 pts,
// Josh Minott's reached 8). 6 minutes is 1.5 four-minute sections — the
// minimum honest evidence that a player got real rotation minutes rather than
// mop-up duty. Verified: raising from 2 to 6 collapses those outliers
// (Tomlin p90 9.73 -> 2.50, Minott 13.17 -> 3.33) without moving Caruso,
// Jokic, Pritchard or Allen a hundredth. Row totals for affected players
// still clear the 10-game / 400-minute season floor comfortably.
export const MPG_FLOOR = 6;

const SEASONS = [2026, 2025];

// Basketball-Reference team codes → dunksandthrees aliases.
const TEAM_ALIAS = { BRK: 'BKN', CHO: 'CHA', PHO: 'PHX' };

/** End-of-season DEF EPM per team alias, per season — the opponent table. */
export function teamDefense() {
  const out = new Map();
  for (const season of SEASONS) {
    const rows = readCache(`dunksandthrees-api-team-epm-${season}`) ?? [];
    const latest = new Map();
    for (const r of rows) {
      const prev = latest.get(r.team_alias);
      if (!prev || r.game_dt > prev.game_dt) latest.set(r.team_alias, r);
    }
    for (const [alias, r] of latest) out.set(`${season}|${alias}`, r.team_depm ?? 0);
  }
  return out;
}

export function minutesToDecimal(mp) {
  if (typeof mp === 'number') return mp;
  const [m, s] = String(mp).split(':').map(Number);
  return m + (s || 0) / 60;
}

/**
 * The shared tail of every window: MPG_FLOOR-minute floor, opponent
 * adjustment, minutes damp, spike winsorization, integer rounding.
 * `defenseKey` maps a row to its opponent-table key.
 */
function finishWindow(rows, defense, defenseKey) {
  // Games below MPG_FLOOR are cameos, not evidence — see the const's comment.
  const played = rows.filter(g => minutesToDecimal(g.minutes) >= MPG_FLOOR);
  if (!played.length) return null;

  const totalMin = played.reduce((s, g) => s + minutesToDecimal(g.minutes), 0);
  const mpg = totalMin / played.length;
  const damp = Math.pow(Math.min(mpg, 36) / 36, MINUTES_DAMP);
  const dampReb = Math.pow(Math.min(mpg, 36) / 36, rebDampExponent(mpg));

  const adjusted = played.map(g => {
    const depm = defense.get(defenseKey(g)) ?? 0;
    const oppFactor = LEAGUE_ORTG / Math.max(90, LEAGUE_ORTG - depm);
    return {
      minutes: minutesToDecimal(g.minutes),
      pts: g.pts * oppFactor * damp,
      reb: g.reb * dampReb,
      ast: g.ast * oppFactor * damp,
    };
  });

  // Winsorize single-game spikes — see loadRealGames' comment.
  const cap = {};
  for (const stat of ['pts', 'reb', 'ast']) {
    const m = adjusted.reduce((s, g) => s + g[stat], 0) / adjusted.length;
    cap[stat] = Math.max(2, 3 * m);
  }
  return adjusted.map(g => ({
    minutes: g.minutes,
    pts: Math.round(Math.min(g.pts, cap.pts)),
    reb: Math.round(Math.min(g.reb, cap.reb)),
    ast: Math.round(Math.min(g.ast, cap.ast)),
  }));
}

/**
 * Every cached team-defense season at once, for the historical sets — the
 * team-epm archive runs 2002-2026. A season with no cache (pre-2002) simply
 * misses every lookup and its games go unadjusted (factor 1).
 */
export function historicalTeamDefense() {
  const out = new Map();
  for (const f of fs.readdirSync(CACHE_DIR)) {
    const m = f.match(/^dunksandthrees-api-team-epm-(\d{4})\.json$/);
    if (!m) continue;
    const season = Number(m[1]);
    const rows = readCache(`dunksandthrees-api-team-epm-${season}`) ?? [];
    const latest = new Map();
    for (const r of rows) {
      const prev = latest.get(r.team_alias);
      if (!prev || r.game_dt > prev.game_dt) latest.set(r.team_alias, r);
    }
    for (const [alias, r] of latest) out.set(`${season}|${alias}`, r.team_depm ?? 0);
  }
  return out;
}

/**
 * One SPECIFIC season's games for a historical card — the special sets'
 * window. Regular season plus playoffs, or the playoff run alone for a
 * Summer Standout, whose card celebrates exactly those games.
 */
export function loadSeasonRealGames(playerId, season, defense, { playoffOnly = false } = {}) {
  const log = readCache(`gamelog-full-${playerId}-${season}`);
  if (!log) return null;
  const phases = playoffOnly ? ['post'] : ['reg', 'post'];
  const rows = phases.flatMap(phase => log[phase] ?? []);
  // Ten real games AND four hundred real minutes, or the card goes to the
  // synthetic path. The game floor is PERCENTILE.EXC's p=0.1 needing n >= 9
  // (a 7-game rookie year threw #NUM). The minutes floor is the quadratic
  // 36/m² normalization: a garbage-time season of 3-minute stints explodes
  // per-game v no matter what the raw stats are — Josh Minott's 150-minute
  // 2023-24 printed a chart of zeros with one 7-point tier at 32+ — and the
  // fringe-prior shrink over there was measured on exactly these seasons.
  const played = rows.filter(g => minutesToDecimal(g.minutes) >= MPG_FLOOR);
  const totalMin = played.reduce((s, g) => s + minutesToDecimal(g.minutes), 0);
  if (played.length < 10 || totalMin < 400) return null;
  const alias = g => `${season}|${TEAM_ALIAS[g.opp] ?? g.opp}`;
  return finishWindow(played, defense, alias);
}

/**
 * A WNBA season's games — same pipeline, two differences: no opponent
 * adjustment (no team defensive EPM exists for the league) and a 300-minute
 * floor, since a full WNBA season is 40-44 games of 40 minutes. The minutes
 * damp anchors on 36 as it does for the NBA: a WNBA starter's 30-34 of 40
 * sits in the same absolute range as an NBA starter's share of 48.
 */
export function loadWnbaSeasonRealGames(playerId, season) {
  const log = readCache(`gamelog-wnba-${playerId}-${season}`);
  if (!log) return null;
  const rows = [...(log.reg ?? []), ...(log.post ?? [])];
  const played = rows.filter(g => minutesToDecimal(g.minutes) >= MPG_FLOOR);
  const totalMin = played.reduce((s, g) => s + minutesToDecimal(g.minutes), 0);
  if (played.length < 10 || totalMin < 300) return null;
  return finishWindow(played, new Map(), () => '');
}

/**
 * The exact last-82 window's rows (with season attached), before the
 * adjustment tail. Token appearances are not evidence: a 0:00 game divides
 * bands.js's 36/m² normalization by zero (one such game NaN-poisoned an
 * entire pricing run), and a 90-second garbage-time stint would top the
 * chart through the same formula — so rows under two minutes never enter
 * the window at all.
 */
function selectWindow(indexEntry) {
  if (!indexEntry?.playerId) return null;
  const rows = [];
  for (const season of SEASONS) {
    if (!indexEntry.seasons?.[season]) continue;
    const log = readCache(`gamelog-full-${indexEntry.playerId}-${season}`);
    if (!log) continue;
    for (const phase of ['reg', 'post']) {
      for (const g of log[phase] ?? []) {
        rows.push({ ...g, season });
      }
    }
  }
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  return sorted.filter(g => minutesToDecimal(g.minutes) >= MPG_FLOOR).slice(0, WINDOW_GAMES);
}

/**
 * The adjusted last-82 window for one player, or null when no logs exist.
 * `indexEntry` is this player's row from pool-gamelogs-index.json.
 * finishWindow damps by minutes share and winsorizes single-game spikes at
 * 3× the window mean (the Nae'Qwan Tomlin catch).
 */
export function loadRealGames(indexEntry, defense) {
  const window = selectWindow(indexEntry);
  if (!window?.length) return null;
  return finishWindow(window, defense, g => `${g.season}|${TEAM_ALIAS[g.opp] ?? g.opp}`);
}

/**
 * Games per season inside the exact last-82 window — the chart's own season
 * mix, e.g. { 2025: 70, 2026: 19 } for a player back from injury. This is
 * the weighting the EPM inputs should follow when they claim to describe the
 * same player the chart describes.
 */
export function windowSeasonCounts(indexEntry) {
  const window = selectWindow(indexEntry);
  if (!window?.length) return null;
  const counts = {};
  for (const g of window) counts[g.season] = (counts[g.season] ?? 0) + 1;
  return counts;
}

/** The whole pool's window season mixes, keyed by card id like loadAllRealGames. */
export function loadAllWindowSeasonCounts() {
  const idxPath = path.join(REPO_ROOT, 'card-data', 'generated', 'pool-gamelogs-index.json');
  if (!fs.existsSync(idxPath)) return new Map();
  const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  const out = new Map();
  for (const [cardId, entry] of Object.entries(idx.players ?? {})) {
    const counts = windowSeasonCounts(entry);
    if (counts) out.set(cardId, counts);
  }
  return out;
}

/** The whole pool's real-game windows, keyed by card id. */
export function loadAllRealGames() {
  const idxPath = path.join(REPO_ROOT, 'card-data', 'generated', 'pool-gamelogs-index.json');
  if (!fs.existsSync(idxPath)) return new Map();
  const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  const defense = teamDefense();
  const out = new Map();
  for (const [cardId, entry] of Object.entries(idx.players ?? {})) {
    const games = loadRealGames(entry, defense);
    if (games && games.length >= 20) out.set(cardId, games);
  }
  return out;
}
