/**
 * The TRADED set: short or strange stays on teams a player is not known for.
 *
 *   node scripts/cardgen/generateTraded.js
 *
 * Karl Malone as a Laker, Hakeem as a Raptor, Rasheed Wallace's one game as a
 * Hawk. The roster is a NAMED LIST (card-data/traded.json), picked by hand off
 * the Weird Jersey List; this file only builds what was picked.
 *
 * ── THE SPLIT THAT MAKES THE SET WORK ───────────────────────────────────────
 *
 * The STAT LINE IS THE STINT'S: that team's own rows from the full-league
 * tables — per-100, usage, the rim profile — so a Hawk card scores like the
 * man scored as a Hawk. But the SKILL is the season's: Speed+Power trusts the
 * player's whole season of minutes (`trustMinutes`), and EPM comes from the
 * season table, because a one-game stint carries a real stat line and no
 * skill evidence at all. Without the split, Rasheed's Hawks card priced him
 * as a replacement player; with it he is the 2003-04 Rasheed Wallace who
 * happened to be wearing the wrong shirt.
 *
 * Two mechanical allowances for tiny stints, both display-honest: the chart
 * synthesis needs a sample (a percentile over one game is a point, not a
 * distribution), so it runs on at least MIN_SYNTH_GAMES synthetic games; and
 * synthesis minutes are capped at CAP_SYNTH_MPG so a 42-minute one-off does
 * not print a 42-minute-a-night chart. The card itself still says what
 * happened: real stint games and minutes, in `stint`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { buildSet, resolvePlayerIds } from './generateSpecialSets.js';
import { CALIBRATION_FILE } from './calibrateAttributes.js';
import { franchiseForSeason, canonicalTeam } from '../../src/cards/teams.js';
import { indexBiometrics, loadBiometrics } from './biometrics.js';
import { indexPositionShares, loadPositionShares } from './positionShares.js';
import * as PV from './playValue.js';
import * as A from './attributes.js';
import { buildApiEpmIndex } from './summerStandouts.js';

export const SET_ID = 'traded';
const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, `cards-${SET_ID}.json`);
export const TRADED_FILE = path.join(REPO_ROOT, 'card-data', 'traded.json');
const LAST_SEASON = 2026;

/** The chart synthesis needs a distribution; one game is a point. */
const MIN_SYNTH_GAMES = 20;
/** A 42-minute one-off must not print a 42-minute-a-night chart. */
const CAP_SYNTH_MPG = 38;

const seasonLabel = season => `${season - 1}-${String(season).slice(2)}`;

/** Every pick, flattened — one player may hold several strange jerseys. */
export function readTraded(file = TRADED_FILE) {
  if (!fs.existsSync(file)) return [];
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  const picks = [];
  for (const [name, v] of Object.entries(body.picks ?? {})) {
    for (const pick of Array.isArray(v) ? v : [v]) picks.push({ name, ...pick });
  }
  return picks;
}

/** One season's rows of one kind, raw — stint rows included. */
function seasonRows(season, kind) {
  let cached;
  try { cached = readCache(`bbref-${season}-${kind}-full`); } catch { return []; }
  const rows = Array.isArray(cached) ? cached : cached?.rows ?? cached?.data ?? [];
  return rows;
}

/** The row for one player's stint on one team, or null. */
function stintRow(rows, name, team) {
  return rows.find(
    r => normalizeName(r.name) === normalizeName(name) && r.team === team
  ) ?? null;
}

/** The player's SEASON-WIDE minutes — the aggregate row where one exists. */
function seasonMinutes(rows, name) {
  let best = 0;
  for (const r of rows) {
    if (normalizeName(r.name) !== normalizeName(name)) continue;
    if (/TM$/.test(r.team ?? '')) return r.minutes ?? best;
    best = Math.max(best, r.minutes ?? 0);
  }
  return best;
}

export function main({ log = console.log } = {}) {
  const picks = readTraded();
  if (picks.length === 0) throw new Error('card-data/traded.json names no picks.');

  const calibration = JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'));
  const archiveRows = readCache('bbref-history')?.data?.rows ?? readCache('bbref-history')?.rows ?? [];
  const pool = JSON.parse(
    fs.readFileSync(path.join(GEN_DIR, 'player-pool-2026.json'), 'utf8')
  );
  const biometrics = indexBiometrics(loadBiometrics());
  const positionShares = indexPositionShares(loadPositionShares());
  const apiEpm = buildApiEpmIndex();

  // The current pool's own season, the calibration basis for the pool-relative
  // shooting layer — assembled exactly as generateSpecialSets does.
  const currentByName = new Map();
  for (const row of archiveRows) {
    if (row.season !== LAST_SEASON) continue;
    const prev = currentByName.get(row.playerId);
    if (!prev || (row.games ?? 0) > (prev.games ?? 0)) currentByName.set(row.playerId, row);
  }
  const poolIds = new Set(resolvePlayerIds(pool, archiveRows).ids.values());
  const currentRows = [...currentByName.values()].filter(r => poolIds.has(r.playerId));

  const selections = [];
  const meta = [];
  const missing = [];
  for (const pick of picks) {
    const adv = seasonRows(pick.season, 'advanced');
    const pp = seasonRows(pick.season, 'perPoss');
    const shooting = seasonRows(pick.season, 'shooting');
    const advRow = stintRow(adv, pick.name, pick.team);
    const ppRow = stintRow(pp, pick.name, pick.team);
    if (!advRow || !ppRow) {
      missing.push(`${pick.name} ${pick.team} ${pick.season} (no stint rows)`);
      continue;
    }
    const rim = stintRow(shooting, pick.name, pick.team);
    const epm = apiEpm.get(`${normalizeName(pick.name)}|${pick.season}`);
    const realGames = advRow.games ?? 0;
    const realMpg = realGames > 0 ? (advRow.minutes ?? 0) / realGames : 0;
    const synthGames = Math.max(realGames, MIN_SYNTH_GAMES);
    const synthMpg = Math.min(realMpg, CAP_SYNTH_MPG);
    selections.push({
      player: { name: pick.name, pos: advRow.pos },
      season: {
        ...advRow, ...ppRow,
        playerId: advRow.playerId,
        season: pick.season,
        // The synthesis sample and pace — see MIN_SYNTH_GAMES / CAP_SYNTH_MPG.
        // The card's own record gets the real stint numbers stamped back on.
        games: synthGames,
        minutes: synthGames * synthMpg,
        // The rim profile of THE STINT, where the shooting table has one.
        rimPct: rim?.rimPct ?? null,
        rimShare: rim?.rimShare ?? null,
        // Season-wide skill: EPM from the season table, trust from the whole
        // season's minutes. The stint is the stat line, not the evidence.
        epm: epm?.epm ?? null,
        ewinsPerGame: epm?.ewinsPerGame ?? null,
        trustMinutes: seasonMinutes(adv, pick.name),
      },
    });
    meta.push({ ...pick, realGames, realMpg });
  }
  if (missing.length) {
    throw new Error(`TRADED stints missing:\n  ${missing.join('\n  ')}`);
  }

  const cards = buildSet({ selections, currentRows, calibration, biometrics, positionShares })
    .map((card, i) => ({
      ...card,
      team: franchiseForSeason(canonicalTeam(meta[i].team), meta[i].season),
      season: meta[i].season,
      seasonLabel: seasonLabel(meta[i].season),
      // What actually happened, stated plainly on the record.
      games: meta[i].realGames,
      mpg: Number(meta[i].realMpg.toFixed(1)),
      stint: { games: meta[i].realGames, note: meta[i].note ?? null },
    }));

  PV.priceAgainstBase(cards, { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX });

  fs.mkdirSync(GEN_DIR, { recursive: true });
  const body = {
    generatedAt: new Date().toISOString(),
    set: SET_ID,
    provisional: true,
    sources: {
      roster: 'card-data/traded.json — hand-picked off the Weird Jersey List',
      statLine: "the STINT's own rows from the full-league tables — that team only",
      skill: "season-wide: EPM from the season table, Speed+Power trust from the season's minutes",
      pricing: 'play value against the base set, like every special set',
    },
    cards,
  };
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(body, null, 1)}\n`);
  log(`TRADED: ${cards.length} cards.`);
  log(`  ${OUTPUT_FILE}`);
  return body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
