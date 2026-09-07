// The last-82 window, applied to the EPM side.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// realGames.js already builds every pool player's LAST 82 GAMES (playoffs
// included) and feeds them to the chart. Its header states the rule plainly:
// "One window rule for everyone — the force-include blend, universalized."
//
// The EPM side never got that treatment. Speed+Power and Def Boost read whole
// SEASON rows, and the only thing standing in for a window was
// priorSeasonBlend.js, which folds a prior season in for the nineteen names on
// the force-include list and for nobody else. That gate is shaped by the G>=40
// pool rule, so it catches a player who missed GAMES and misses a player who
// played many games of few MINUTES:
//
//     Ty Jerome        15 games   -> blended (force-included)
//     Nick Richards    48 games at 14.6 mpg, 701 minutes -> NOT blended
//
// Richards printed Def Boost -3 off those 701 minutes — a figure that would
// have made him roughly the second-worst defender in the league — while his two
// larger samples either side of it said -0.96 (1,758 min) and -1.72 (1,256 min).
// The window puts him on 82 real games and prints -2.
//
// ── WHAT IT DOES ────────────────────────────────────────────────────────────
//
// For each player, weight each season's EPM rates by HOW MANY OF HIS LAST 82
// GAMES came from that season. The weights come from realGames.js's own window
// selection, so the chart and the EPM side are measuring the same 82 games
// rather than two different things that happen to share a name.
//
// A player with a full current season is 100% current season and does not move.
// That is the property that makes this a universal rule rather than a threshold:
// there is no cutoff to argue about, because a full sample already ignores the
// prior season on its own.
//
// ELIGIBILITY IS UNTOUCHED. The pool rule (MPG>=12, G>=40) and the
// force-include list still decide WHO gets carded. This decides only what is
// measured about them.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { loadAllWindowSeasonCounts } from './realGames.js';

/** The rate fields the window pools. Everything else stays on the current row. */
export const WINDOW_FIELDS = ['epm', 'epmOff', 'epmDef', 'ewinsPerGame'];

const INDEX_FILE = path.join(REPO_ROOT, 'card-data', 'generated', 'pool-gamelogs-index.json');

const seasonCache = new Map();

/** One season's EPM rows, indexed by normalized name. Stint rows are skipped. */
function seasonEpmIndex(season) {
  if (seasonCache.has(season)) return seasonCache.get(season);
  const raw = readCache(`dunksandthrees-api-season-epm-${season}-st2`);
  const rows = Array.isArray(raw) ? raw : raw?.data ?? [];
  const byName = new Map();
  for (const r of rows) {
    if (!r?.name) continue;
    const key = normalizeName(r.name);
    // A traded player can appear more than once; keep the fullest row, which is
    // the same tie-break the rest of the generator uses.
    const prev = byName.get(key);
    if (!prev || (r.minutes ?? 0) > (prev.minutes ?? 0)) byName.set(key, r);
  }
  seasonCache.set(season, byName);
  return byName;
}

/**
 * `normalized name -> { epm, epmOff, epmDef, ewinsPerGame, basis, windowGames }`
 * for every pool player whose window could be built.
 *
 * A player missing from the game-log index — the carried-forward men who appear
 * in no 2025-26 table at all — is simply absent, and the caller keeps whatever
 * row it already had. Falling back is deliberate: this should never be able to
 * make a card WORSE informed than it was before the window existed.
 */
export function buildWindowEpmIndex({ log = null } = {}) {
  if (!fs.existsSync(INDEX_FILE)) return new Map();
  const idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  const counts = loadAllWindowSeasonCounts();
  const out = new Map();
  let spanning = 0;

  for (const [cardId, entry] of Object.entries(idx.players ?? {})) {
    const mix = counts.get(cardId);
    if (!mix || !entry?.name) continue;
    const key = normalizeName(entry.name);

    const totals = Object.fromEntries(WINDOW_FIELDS.map(f => [f, 0]));
    const weights = Object.fromEntries(WINDOW_FIELDS.map(f => [f, 0]));
    const parts = [];
    let windowGames = 0;

    for (const [seasonKey, n] of Object.entries(mix)) {
      const row = seasonEpmIndex(Number(seasonKey)).get(key);
      if (!row) continue;
      windowGames += n;
      parts.push(`${n}g ${seasonKey}`);
      // Each field carries its own weight so a season missing ONE rate does not
      // silently drop that season's games from the others.
      for (const f of WINDOW_FIELDS) {
        const v = row[f];
        if (!Number.isFinite(v)) continue;
        totals[f] += n * v;
        weights[f] += n;
      }
    }
    if (!windowGames) continue;
    if (parts.length > 1) spanning += 1;

    const pooled = { basis: parts.join(' + '), windowGames };
    for (const f of WINDOW_FIELDS) {
      pooled[f] = weights[f] > 0 ? totals[f] / weights[f] : null;
    }
    out.set(key, pooled);
  }

  if (log) {
    log(`Last-82 EPM window: ${out.size} players, ${spanning} spanning two seasons`);
  }
  return out;
}

/**
 * Rewrite `rows` so the pooled rate fields come from each player's last 82.
 *
 * Non-destructive by design: a row with no window keeps every value it arrived
 * with, and a field the window could not pool keeps its original value too.
 * `windowBasis` is stamped on so a run report can say what a number stands on.
 */
export function applyWindowEpm(rows, index) {
  if (!index?.size) return { rows, applied: 0, moved: [] };
  let applied = 0;
  const moved = [];
  const out = rows.map(row => {
    const w = index.get(normalizeName(row.name ?? ''));
    if (!w) return row;
    applied += 1;
    const next = { ...row, windowBasis: w.basis, windowGames: w.windowGames };
    for (const f of WINDOW_FIELDS) {
      if (w[f] == null) continue;
      if (Number.isFinite(row[f]) && Math.abs(row[f] - w[f]) >= 0.005) {
        moved.push({ name: row.name, field: f, from: row[f], to: w[f], basis: w.basis });
      }
      next[f] = w[f];
    }
    return next;
  });
  return { rows: out, applied, moved };
}
