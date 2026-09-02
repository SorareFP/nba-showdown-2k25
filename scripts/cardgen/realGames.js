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
import { REPO_ROOT, readCache } from './cache.js';

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
 * The adjusted last-82 window for one player, or null when no logs exist.
 * `indexEntry` is this player's row from pool-gamelogs-index.json.
 */
export function loadRealGames(indexEntry, defense) {
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
  // Token appearances are not evidence: a 0:00 game divides bands.js's
  // 36/m² normalization by zero (one such game NaN-poisoned an entire
  // pricing run), and a 90-second garbage-time stint would top the chart
  // through the same formula. Under two minutes, the row is noise.
  const played = rows.filter(g => minutesToDecimal(g.minutes) >= 2);
  if (!played.length) return null;
  played.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const window = played.slice(0, WINDOW_GAMES);

  const totalMin = window.reduce((s, g) => s + minutesToDecimal(g.minutes), 0);
  const mpg = totalMin / window.length;
  const damp = Math.pow(Math.min(mpg, 36) / 36, MINUTES_DAMP);
  const dampReb = Math.pow(Math.min(mpg, 36) / 36, rebDampExponent(mpg));

  const adjusted = window.map(g => {
    const alias = TEAM_ALIAS[g.opp] ?? g.opp;
    const depm = defense.get(`${g.season}|${alias}`) ?? 0;
    const oppFactor = LEAGUE_ORTG / Math.max(90, LEAGUE_ORTG - depm);
    return {
      minutes: minutesToDecimal(g.minutes),
      pts: g.pts * oppFactor * damp,
      reb: g.reb * dampReb,
      ast: g.ast * oppFactor * damp,
    };
  });

  // Winsorize single-game spikes: a fringe player's one garbage-time
  // explosion is his window's p90 and prints his top chart tier (the user
  // caught Nae'Qwan Tomlin's ceiling doing exactly this). Capping each stat
  // at 3× the player's own window mean trims the fluke game while never
  // touching a star — a consistent scorer's mean sits far above the cap's
  // bite point. Floor of 2 so near-zero means don't zero out real games.
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
