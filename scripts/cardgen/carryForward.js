/**
 * Cards for players who did not play at all.
 *
 * DISTINCT FROM force-include-2026.json, and the distinction is what makes this
 * a separate file rather than more names in that one. Force-include adds a
 * player who PLAYED but missed the MPG-and-games bar; it matches a name against
 * Basketball-Reference's 2025-26 per-game table and exits non-zero when the name
 * is absent, which is the right behaviour for a typo. These four have no row to
 * match anywhere — zero games — so every stat layer would find nothing and the
 * pool builder would reject them as unmatched.
 *
 * So they are carded from their LAST HEALTHY SEASON, through exactly the machinery
 * the Super Season set already uses for a historical year, and then given the
 * team they are on NOW. Damian Lillard is the case that makes the last part
 * necessary: his stat line is a Milwaukee season and his card is a Blazer.
 *
 * WHAT THIS DOES NOT DO: pretend the season is current. The card records the
 * season it was built from, so a reader can see that Haliburton's numbers are
 * 2024-25 rather than wondering why a man who played no games has a chart.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache } from './cache.js';
import { normalizeName } from './resolveTeams.js';

export const CARRY_FORWARD_FILE = path.join(REPO_ROOT, 'card-data', 'carry-forward-2026.json');

/** `[{ name, season, reason }]`, or an empty list when the file is absent. */
export function readCarryForward(file = CARRY_FORWARD_FILE) {
  if (!fs.existsSync(file)) return [];
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.entries(body.players ?? {}).map(([name, v]) => ({ name, ...v }));
}

/**
 * The team a carried-forward player is on NOW.
 *
 * The current season's EPM table still lists him with a team and zero games,
 * which is exactly the row needed: it is the only source that knows Lillard
 * moved. Falls back to the team he played the season FOR, which is wrong but
 * visible, rather than to nothing.
 */
export function currentTeam(name, season, { current, prior }) {
  const key = normalizeName(name);
  const now = current.find(r => normalizeName(r.name) === key);
  if (now?.team) return now.team;
  const then = prior.find(r => normalizeName(r.name) === key);
  return then?.team ?? null;
}

/** Load one season's API rows, regular season. */
export function seasonRows(season) {
  const cached = readCache(`dunksandthrees-api-season-epm-${season}-st2`);
  return Array.isArray(cached) ? cached : cached?.data ?? [];
}

/**
 * Resolve each named player to the stat rows a card needs.
 *
 * Returns `{ resolved, missing }`. A name that cannot be resolved is REPORTED
 * rather than skipped silently — the whole point of the file is that somebody
 * asked for these players by hand.
 */
export function resolveCarryForward(entries, { currentSeason = 2026 } = {}) {
  const current = seasonRows(currentSeason);
  const bySeason = new Map();
  const resolved = [];
  const missing = [];
  for (const e of entries) {
    if (!bySeason.has(e.season)) bySeason.set(e.season, seasonRows(e.season));
    const prior = bySeason.get(e.season);
    const key = normalizeName(e.name);
    const row = prior.find(r => normalizeName(r.name) === key);
    if (!row) { missing.push(`${e.name} (no ${e.season} row)`); continue; }
    resolved.push({
      ...e,
      row,
      team: currentTeam(e.name, e.season, { current, prior }),
      movedTeam: row.team !== currentTeam(e.name, e.season, { current, prior }),
    });
  }
  return { resolved, missing };
}

/**
 * Build the carried-forward cards, through the historical-season machinery.
 *
 * The same `buildSet` the Super Season cards use, because that is exactly what
 * these are: a card from a season that is not the current one. The only thing
 * added afterwards is the CURRENT team, which the stat line cannot know.
 *
 * `deps` is passed in rather than imported so this module stays free of the
 * generator's own import graph — generateCards already holds all of it.
 */
export function buildCarryForwardCards(resolved, deps) {
  const { buildSet, currentRows, calibration, biometrics, positionShares, advanced, perPoss } = deps;
  const selections = [];
  const meta = [];
  const missing = [];
  for (const r of resolved) {
    const key = `${normalizeName(r.name)}|${r.season}`;
    const adv = advanced.get(key);
    const pp = perPoss.get(key);
    if (!adv || !pp) { missing.push(`${r.name} (no ${r.season} Basketball-Reference row)`); continue; }
    selections.push({
      player: { name: r.name, pos: adv.pos },
      season: {
        ...adv, ...pp,
        season: r.season,
        playerId: adv.playerId,
        epm: r.row.epm,
        ewinsPerGame: r.row.ewinsPerGame,
      },
    });
    meta.push(r);
  }
  const cards = buildSet({ selections, currentRows, calibration, biometrics, positionShares });
  return {
    cards: cards.map((c, i) => ({
      ...c,
      team: meta[i].team ?? c.team,
      // Recorded so a reader can see WHY a man who played no games has a chart.
      carriedFrom: meta[i].season,
      carryReason: meta[i].reason,
    })),
    missing,
  };
}
