/**
 * The Summer Standouts set: deep playoff runs, carded.
 *
 * Writes card-data/generated/cards-summer-standouts.json from the named roster
 * in card-data/summer-standouts.json — players who ran to Game 6 of the
 * Conference Finals or later and are either off the team they are known for,
 * role players, or legends the other sets do not cover. The user picked every
 * run on the list; this file only builds what was picked.
 *
 * THE BUILD IS THE SHIPPED PIPELINE, deliberately. `buildSet` ->
 * `buildHistoricalCard`, exactly as the Super Season set — the one difference
 * is the stat line: dunksandthrees' playoff table (st4) instead of a regular
 * season, per-75 restated per-100 by summerStandouts.js. A playoff run carries
 * its own real EPM and DEF EPM, so unlike the Super Seasons nothing here
 * borrows DBPM. Priced against the base set like every other special set.
 *
 * A name the caches cannot resolve FAILS THE RUN rather than being skipped —
 * the roster is hand-picked, so an absent row is a data problem to fix, not a
 * player to drop silently.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from './cache.js';
import {
  buildSet, resolvePlayerIds,
} from './generateSpecialSets.js';
import { CALIBRATION_FILE } from './calibrateAttributes.js';
import { franchiseForSeason } from '../../src/cards/teams.js';
import { loadLeagueRows, pickCareer } from './standoutSuperSeasons.js';
import { normalizeName } from './resolveTeams.js';
import { indexBiometrics, loadBiometrics } from './biometrics.js';
import { indexPositionShares, loadPositionShares } from './positionShares.js';
import * as PV from './playValue.js';
import * as A from './attributes.js';
import {
  readSummerStandouts, playoffRow, playoffSeason,
} from './summerStandouts.js';

export const SET_ID = 'summer-standouts';
const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, `cards-${SET_ID}.json`);
const LAST_SEASON = 2026;

const seasonLabel = season => `${season - 1}-${String(season).slice(2)}`;

export function main({ log = console.log } = {}) {
  const { playoffCards } = readSummerStandouts();
  const names = Object.keys(playoffCards);
  if (names.length === 0) throw new Error('card-data/summer-standouts.json names no playoff cards.');

  const calibration = JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'));
  const archiveRows = readCache('bbref-history')?.data?.rows ?? readCache('bbref-history')?.rows ?? [];
  const pool = JSON.parse(
    fs.readFileSync(path.join(GEN_DIR, 'player-pool-2026.json'), 'utf8')
  );
  const biometrics = indexBiometrics(loadBiometrics());
  const positionShares = indexPositionShares(loadPositionShares());

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

  // Basketball-Reference ids, so the awards generator can join a champion's
  // roster and a Finals MVP onto these cards — the API's playoff rows carry no
  // BBRef id, and without one every trophy join comes back empty.
  const league = loadLeagueRows();

  const selections = [];
  const meta = [];
  const missing = [];
  for (const name of names) {
    const pick = playoffCards[name];
    const row = playoffRow(name, pick.season);
    if (!row) { missing.push(`${name} (no ${pick.season} playoff row)`); continue; }
    const careerRows = pickCareer(league.get(normalizeName(name)), { referenceSeason: pick.season });
    const season = playoffSeason(row, pick.pos);
    season.playerId = careerRows?.[0]?.playerId ?? null;
    if (!season.playerId) { missing.push(`${name} (no Basketball-Reference id)`); continue; }
    selections.push({
      player: { name, pos: row.position ?? pick.pos ?? 'SF' },
      // A playoff row carries its own EPM and DEF EPM, so no attachEpm join —
      // that helper looks the REGULAR season up and would blank both.
      season,
    });
    meta.push({ name, ...pick });
  }
  if (missing.length) {
    throw new Error(`Summer Standouts rows missing:\n  ${missing.join('\n  ')}`);
  }

  const cards = buildSet({ selections, currentRows, calibration, biometrics, positionShares })
    .map((card, i) => ({
      ...card,
      // The roster's team is the DECIDED one; the API row agrees today, but the
      // decision file is what the conflict rule was applied to, so it wins —
      // routed through franchiseForSeason so a 2009 Nugget wears powder blue
      // and a 2003 Net is a NEW JERSEY Net.
      team: franchiseForSeason(meta[i].team ?? card.team, meta[i].season),
      season: meta[i].season,
      seasonLabel: seasonLabel(meta[i].season),
      playoffRun: true,
    }));

  // Priced against the base set, like every special set: a 51-card list of
  // playoff peaks standardised on its own spread would call its weakest card
  // replacement level, when every card in it is somebody's signature run.
  PV.priceAgainstBase(cards, { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX });

  fs.mkdirSync(GEN_DIR, { recursive: true });
  const body = {
    generatedAt: new Date().toISOString(),
    set: SET_ID,
    provisional: true,
    sources: {
      roster: 'card-data/summer-standouts.json — hand-picked; conflict calls in card-data/standout-conflict-decisions.json',
      statLine: 'dunksandthrees season-epm seasonType st4 (playoffs), per-75 restated per-100',
      defBoost: 'real playoff DEF EPM — no DBPM substitute on this set',
      pricing: 'play value against the base set, like every special set',
    },
    firstSeason: Math.min(...meta.map(m => m.season)),
    lastSeason: Math.max(...meta.map(m => m.season)),
    cards,
  };
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(body, null, 1)}\n`);
  log(`Summer Standouts: ${cards.length} playoff cards, ${body.firstSeason}-${body.lastSeason}.`);
  log(`  ${OUTPUT_FILE}`);
  return body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
