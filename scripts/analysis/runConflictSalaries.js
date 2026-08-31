/**
 * Playoff card or Super Season card? Priced, for the players where it is a
 * genuine choice.
 *
 * Minting a Super Season for every uncarded playoff standout creates a
 * same-team collision for about half of them -- a lifelong Spur's best season
 * is almost always in San Antonio, so the rule that forbids two cards in one
 * uniform forbids his Spurs playoff card. Which one to keep is a judgement
 * call, and the number that informs it is what each card would COST.
 *
 * Both sides are built through the SHIPPED pipeline (`buildSet` ->
 * `buildHistoricalCard`) and priced through the shipped price
 * (`computePlayValue` against the base set), so the two salaries are
 * comparable with each other and with every card already in a set. A playoff
 * card here means exactly what it says: the same card builder, fed the
 * player's PLAYOFF stat line instead of his regular-season one.
 *
 * The per-75 to per-100 conversion is the only translation: the API publishes
 * playoff rates per 75 possessions and buildHistoricalCard reads per 100.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readCache, REPO_ROOT } from '../cardgen/cache.js';
import {
  buildSet, resolvePlayerIds, indexEpmSeasons, attachEpm,
} from '../cardgen/generateSpecialSets.js';
import { CALIBRATION_FILE } from '../cardgen/calibrateAttributes.js';
import { indexBiometrics, loadBiometrics } from '../cardgen/biometrics.js';
import { indexPositionShares, loadPositionShares } from '../cardgen/positionShares.js';
import { computePlayValue, priceSet, REFERENCE_SALARY } from '../cardgen/playValue.js';
import { roundSalary, SALARY_MIN, SALARY_MAX } from '../cardgen/attributes.js';
import { normalizeName } from '../cardgen/resolveTeams.js';
import { loadLeagueRows, pickCareer } from '../cardgen/standoutSuperSeasons.js';

const CONFLICTS = process.argv[2];
if (!CONFLICTS) {
  console.error('usage: node scripts/analysis/runConflictSalaries.js <conflicts.json>');
  process.exit(1);
}
const conflicts = JSON.parse(fs.readFileSync(CONFLICTS, 'utf8'));

const LAST_SEASON = 2026;
const P75_TO_P100 = 100 / 75;

const calibration = JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'));
const archiveRows = readCache('bbref-history')?.data?.rows ?? [];
const pool = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'card-data', 'generated', 'player-pool-2026.json'), 'utf8')
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

// Per-100 season rows for every player, from the cached full-league tables.
const perPoss = new Map();
const advanced = new Map();
for (let season = 2000; season <= LAST_SEASON; season += 1) {
  for (const [kind, target] of [['perPoss', perPoss], ['advanced', advanced]]) {
    let cached;
    try { cached = readCache(`bbref-${season}-${kind}-full`); } catch { continue; }
    const rows = Array.isArray(cached) ? cached : cached?.rows ?? cached?.data ?? [];
    for (const r of rows) target.set(`${r.playerId}|${season}`, { ...r, season });
  }
}
const league = loadLeagueRows();

/** The API's playoff row for one player-season. */
function playoffRow(name, season) {
  let cached;
  try { cached = readCache(`dunksandthrees-api-season-epm-${season}-st4`); } catch { return null; }
  const rows = cached?.data ?? cached ?? [];
  return (Array.isArray(rows) ? rows : rows.rows ?? []).find(
    r => normalizeName(r.name) === normalizeName(name)
  ) ?? null;
}

/** A playoff run, shaped as the season object buildHistoricalCard reads. */
function playoffSeason(row, fallbackPos) {
  const fga100 = (row.fgaPer75 ?? 0) * P75_TO_P100;
  const fg3a100 = (row.fga3Per75 ?? 0) * P75_TO_P100;
  return {
    season: row.season,
    playerId: null,
    team: row.team,
    pos: row.position ?? fallbackPos ?? 'SF',
    games: row.games,
    minutes: row.minutes,
    pts100: (row.pts75 ?? 0) * P75_TO_P100,
    trb100: (row.reb75 ?? 0) * P75_TO_P100,
    ast100: (row.ast75 ?? 0) * P75_TO_P100,
    fg2a100: Math.max(fga100 - fg3a100, 0),
    fg3a100,
    fgPct2: row.fgPct2,
    fgPct3: row.fgPct3,
    tsPct: row.tsPct,
    // DEF EPM in DBPM's slot: buildHistoricalCard rounds it the same way.
    dbpm: row.epmDef,
    epm: row.epm,
    ewinsPerGame: row.ewinsPerGame,
  };
}

/**
 * EPM for any player-season, from the API caches rather than the archive.
 *
 * `indexEpmSeasons(archiveRows)` only covers the 350-player pool, and EVERY
 * player here is outside it. Feeding that index gives them no EPM, which sends
 * `historicalComposite` to trust = 0 and prices the season at REPLACEMENT — the
 * first run of this script printed Speed+Power 14 for Jokic's 2022, the largest
 * composite in the archive, alongside 14 for every other Super Season. The
 * playoff side looked fine only because it carries its own EPM, so the
 * comparison was between a real card and a crippled one.
 */
function buildApiEpmIndex(first = 2002, last = LAST_SEASON) {
  const index = new Map();
  for (let season = first; season <= last; season += 1) {
    let cached;
    try { cached = readCache(`dunksandthrees-api-season-epm-${season}-st2`); } catch { continue; }
    const rows = cached?.data ?? cached ?? [];
    for (const r of Array.isArray(rows) ? rows : rows.rows ?? []) {
      index.set(`${normalizeName(r.name)}|${season}`, {
        epm: r.epm,
        ewinsPerGame: r.ewinsPerGame,
      });
    }
  }
  return index;
}
const epmIndex = buildApiEpmIndex();

const selections = [];
const meta = [];
for (const c of conflicts) {
  const careers = league.get(normalizeName(c.name));
  const rows = pickCareer(careers, { referenceSeason: c.ssSeason });
  const id = rows?.[0]?.playerId;
  const adv = advanced.get(`${id}|${c.ssSeason}`);
  const pp = perPoss.get(`${id}|${c.ssSeason}`);
  if (adv && pp) {
    selections.push({
      player: { name: c.name, pos: adv.pos },
      season: { ...adv, ...pp, playerId: id, season: c.ssSeason },
    });
    meta.push({ ...c, kind: 'super' });
  }
  const po = playoffRow(c.name, c.playoffSeason);
  if (po) {
    selections.push({
      player: { name: c.name, pos: po.position },
      season: playoffSeason(po, adv?.pos),
    });
    meta.push({ ...c, kind: 'playoff' });
  }
}

const joined = attachEpm(selections, epmIndex);
// A playoff season carries its own EPM already; attachEpm would blank it by
// looking the REGULAR season up, so restore what was set.
joined.selections.forEach((sel, i) => {
  if (meta[i].kind === 'playoff') {
    sel.season.epm = selections[i].season.epm;
    sel.season.ewinsPerGame = selections[i].season.ewinsPerGame;
  }
});

const cards = buildSet({
  selections: joined.selections,
  currentRows,
  calibration,
  biometrics,
  positionShares,
});

// Priced against the base set, on the base set's own value distribution — the
// same basis every other set uses.
const baseFile = path.join(REPO_ROOT, 'card-data', 'generated', 'cards-2026-27.json');
const field = JSON.parse(fs.readFileSync(baseFile, 'utf8')).cards;
const basis = computePlayValue(field, { field }).value;
const salaries = priceSet(cards, {
  field, basis, roundSalary, min: SALARY_MIN, max: SALARY_MAX,
});

const byPlayer = new Map();
cards.forEach((card, i) => {
  const m = meta[i];
  if (!byPlayer.has(m.name)) byPlayer.set(m.name, { name: m.name, ...m });
  byPlayer.get(m.name)[m.kind] = { card, salary: salaries[i] };
});

const pad = (s, w) => String(s).padEnd(w);
const num = (s, w) => String(s).padStart(w);
console.log(`\n${byPlayer.size} players where a Super Season and a playoff card collide on the same team`);
console.log(`(both built through buildSet, both priced against the base set — reference mean ${REFERENCE_SALARY.mean})\n`);
console.log(`  ${pad('player', 22)}${pad('SUPER SEASON', 26)}${pad('PLAYOFF CARD', 26)}${num('keep', 9)}`);
console.log(`  ${pad('', 22)}${pad('yr  tm   S+P   salary', 26)}${pad('yr  tm   S+P   salary', 26)}`);
const rows = [...byPlayer.values()].filter(r => r.super && r.playoff);
rows.sort((a, b) => Math.max(b.super.salary, b.playoff.salary) - Math.max(a.super.salary, a.playoff.salary));
for (const r of rows) {
  const s = r.super; const p = r.playoff;
  const sTxt = `${s.card.season}  ${pad(s.card.team, 4)} ${num(s.card.speed + s.card.power, 3)}   ${num(s.salary, 5)}`;
  const pTxt = `${p.card.season}  ${pad(p.card.team, 4)} ${num(p.card.speed + p.card.power, 3)}   ${num(p.salary, 5)}`;
  const keep = s.salary === p.salary ? 'tie' : s.salary > p.salary ? 'SUPER' : 'PLAYOFF';
  console.log(`  ${pad(r.name, 22)}${pad(sTxt, 26)}${pad(pTxt, 26)}${num(keep, 9)}`);
}
const missing = [...byPlayer.values()].filter(r => !r.super || !r.playoff);
if (missing.length) {
  console.log(`\n  could not build both sides for: ${missing.map(m => `${m.name} (${m.super ? 'no playoff' : 'no season'})`).join(', ')}`);
}
