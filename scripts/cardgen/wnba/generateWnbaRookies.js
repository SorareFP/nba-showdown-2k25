/**
 * The WNBA Rookie set: each current WNBA pool player's rookie season.
 *
 *   node scripts/cardgen/wnba/generateWnbaRookies.js
 *
 * "Can we also add rookie cards for all new players that don't already have
 * one? WNBA included?" — this is the WNBA half. The NBA half extends the
 * existing Rookie set inside generateSpecialSets.js; this league needed a set
 * of its own for the same reason every other WNBA set is its own file: a
 * different team table, a different league mark, and the fitted BPM bridge in
 * EPM's place.
 *
 * THE MACHINERY IS THE LEGENDS SET'S, imported rather than restated: the same
 * archive, the same rating pass, the same shooting layer calibrated on the
 * current WNBA pool, the same BPM-equivalent Speed+Power basis, the same card
 * builder. The one thing that differs is the SELECTION — each carded player's
 * FIRST archived season instead of a named legend's best one. The WNBA began
 * in 1997 and the archive covers it from 1997, so a career's first archived
 * season IS its rookie season; there is no truncation window to guard the way
 * the NBA side must.
 *
 * THE EXCLUSION RULE IS THE NBA ROOKIE SET'S: a player whose rookie season is
 * the current one gets no card here — her base WNBA card already is that
 * season. The excluded are listed in the output with the reason, exactly as
 * the NBA sets do it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, readCache } from '../cache.js';
import { CALIBRATION_FILE } from '../calibrateAttributes.js';
import * as PV from '../playValue.js';
import * as A from '../attributes.js';
import * as S from '../shooting.js';
import * as bpmArchive from './nbaBpmArchive.js';
import { PRINTED_SCALE, mapToReferenceScale } from '../speedPower.js';
import { leagueScaleTotals } from './constants.js';
import { WNBA_SEASON, WNBA_FIRST_SEASON, WNBA_GAME_MINUTES } from './constants.js';
import {
  loadArchive, rateArchive, careerOf, legendShootingInput, buildLegendCard,
} from './generateWnbaLegends.js';
import { MODEL_FILE } from './fitBpmModel.js';
import { vorpPerGame, COMPOSITE_WEIGHTS, composite } from './generateWnbaCards.js';
import { WNBA_SET } from '../../../src/cards/sets.js';
import { loadWnbaSeasonRealGames } from '../realGames.js';

const WNBA_CARDS_FILE = path.join(REPO_ROOT, 'card-data', 'generated', `cards-${WNBA_SET}.json`);

export const SET_ID = 'wnba-rookie';
const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, `cards-${SET_ID}.json`);

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * Does this WNBA rookie season deserve a card? See the NBA twin in
 * generateSpecialSets.js — same rule, this league's numbers.
 */
/**
 * How far back a rookie season must be to earn its own card.
 *
 * ── WHY RECENCY IS A BAR AT ALL ─────────────────────────────────────────────
 *
 * These are not thin seasons — Angel Reese's 2024 is 34 games at 32.5 MPG — so
 * the playing-time bar has nothing to say about them. The problem is that they
 * are nearly the SAME CARD as their owner's base card. A 2024 rookie season and
 * a 2026 base season are two years apart on a player who has barely changed,
 * and printing both spends two slots saying one thing.
 *
 * Three seasons back is where a rookie year starts to look like a different
 * player from the one on the base card. At WNBA_SEASON 2026 that keeps 2023 and
 * earlier and drops 2024 and 2025; 2026 itself was already excluded by the
 * older rule that a current-season rookie's base card IS that season.
 *
 * ── EXCEPT ROOKIE OF THE YEAR ───────────────────────────────────────────────
 *
 * The award is the thing that makes a rookie season worth its own card whatever
 * else is true of it — Caitlin Clark's 2024 and Paige Bueckers' 2025 are the
 * two that survive. The winner is read from Basketball-Reference's own cached
 * voting page rather than from a list kept here, so next year's winner is
 * exempt automatically and nobody has to remember to add her.
 */
export const WNBA_ROOKIE_MIN_SEASONS_BACK = 3;

/** The ROY winner's Basketball-Reference id for one season, from cache. */
export function royWinnerId(season) {
  try {
    const body = readCache(`wnba-${season}-awards-page`);
    const winners = body?.data ?? body ?? {};
    return winners?.ROY?.playerId ?? null;
  } catch {
    return null;
  }
}

/** Is this rookie season recent enough to be redundant with the base card? */
export function tooRecent(season, bbrefId, currentSeason = WNBA_SEASON) {
  if (currentSeason - season >= WNBA_ROOKIE_MIN_SEASONS_BACK) return false;
  return royWinnerId(season) !== bbrefId;
}

export const WNBA_ROOKIE_MIN_MPG = 16;
export const WNBA_ROOKIE_MIN_GAMES = 10;

export function wnbaRookieSeasonCounts(season) {
  const games = season?.games ?? 0;
  const minutes = season?.minutes ?? 0;
  if (games < WNBA_ROOKIE_MIN_GAMES) return false;
  return minutes / games >= WNBA_ROOKIE_MIN_MPG;
}

export function main({ log = console.log } = {}) {
  const calibration = readJson(CALIBRATION_FILE);
  const model = readJson(MODEL_FILE);

  const { loaded, missing: missingSeasons } = loadArchive();
  if (loaded.length === 0) {
    throw new Error(
      'No cached WNBA season tables — run `node scripts/cardgen/wnba/fetchWnbaHistory.js` first.'
    );
  }
  if (missingSeasons.length) {
    throw new Error(
      `${missingSeasons.length} season(s) are not cached: ${missingSeasons.join(', ')}. ` +
        'Run `node scripts/cardgen/wnba/fetchWnbaHistory.js`.'
    );
  }

  const seasons = rateArchive(loaded, model);
  const reference = seasons.get(WNBA_SEASON);
  if (!reference) {
    throw new Error(`The reference season ${WNBA_SEASON} is not cached.`);
  }

  // THE ROSTER IS THE CARDED SET, not the pool file: the set is "a rookie card
  // for every player who has a base card", and cards-wnba.json is exactly the
  // list of players who do.
  if (!fs.existsSync(WNBA_CARDS_FILE)) {
    throw new Error(
      'card-data/generated/cards-wnba.json is missing — run ' +
        '`node scripts/cardgen/wnba/generateWnbaCards.js` first.'
    );
  }
  const wnbaSet = readJson(WNBA_CARDS_FILE);

  const selections = [];
  const excluded = [];
  // Kept apart from `excluded`: that list is the badge-bearing one (her base
  // card IS her rookie season) and feeds the badge counts. A thin season is not
  // a fact worth printing on a card.
  const thin = [];
  // Kept apart again: a recency cut is not a judgement on the season, only on
  // whether a second card of it earns its slot.
  const recent = [];
  const unmatched = [];
  for (const card of wnbaSet.cards) {
    const career = careerOf(card.bbrefId, seasons);
    if (career.length === 0) { unmatched.push(card.name); continue; }
    const first = career.slice().sort((a, b) => a.season - b.season)[0];
    if (first.season === WNBA_SEASON) {
      excluded.push({ id: card.id, name: card.name, reason: 'rookie season is the current one — her base card already is that season' });
      continue;
    }
    // THE PLAYING-TIME BAR, mirroring the NBA rookie set's. The WNBA pool rule
    // is MPG >= 16 and G >= 20, so this takes its minutes half whole and halves
    // its games half — the same shape, for the same reason: minutes ask whether
    // she was playing, games ask whether there was a season, and a rookie year
    // ended early by injury should still get a card where a handful of
    // appearances should not. A 40-game WNBA season makes the halved floor 10.
    if (tooRecent(first.season, card.bbrefId)) {
      recent.push({
        id: card.id,
        name: card.name,
        season: first.season,
        reason: `rookie season is within ${WNBA_ROOKIE_MIN_SEASONS_BACK} seasons of the current one and she did not win ROY`,
      });
      continue;
    }
    if (!wnbaRookieSeasonCounts(first)) {
      thin.push({
        id: card.id,
        name: card.name,
        season: first.season,
        games: first.games ?? 0,
        mpg: first.games ? +((first.minutes ?? 0) / first.games).toFixed(1) : 0,
        reason: 'rookie season below the playing-time bar',
      });
      continue;
    }
    selections.push({ name: card.name, playerId: card.bbrefId, best: first });
  }
  // FORCED ROOKIE SEASONS (card-data/wnba-rookie-legends.json): players with no
  // base card, each with the rookie season named. Resolved by name inside that
  // season's own archive rows, then held to the same first-season and
  // playing-time bars as everyone else.
  const forcedFile = path.join(REPO_ROOT, 'card-data', 'wnba-rookie-legends.json');
  if (fs.existsSync(forcedFile)) {
    const plain = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
    const forced = Object.entries(readJson(forcedFile)).filter(([k, v]) => !k.startsWith('_') && Number.isFinite(v?.season));
    // A season that is already a WNBA Super Season card is that card's: the
    // legend wears the rookie pill instead (Super Season supersedes Rookie).
    const legendsFile = path.join(GEN_DIR, 'cards-wnba-super-season.json');
    const legendSeasons = new Set(
      fs.existsSync(legendsFile) ? readJson(legendsFile).cards.map(c => `${c.bbrefId}|${c.season}`) : []
    );
    for (const [name, spec] of forced) {
      const rows = seasons.get(spec.season)?.rows ?? [];
      const row = rows.find(r => plain(r.name) === plain(name));
      if (!row) { unmatched.push(`${name} (${spec.season}, forced)`); continue; }
      if (legendSeasons.has(`${row.playerId}|${spec.season}`)) {
        excluded.push({ id: row.playerId, name, reason: `her ${spec.season} is already her Super Season card — it wears the rookie badge there` });
        continue;
      }
      const career = careerOf(row.playerId, seasons);
      const first = career.slice().sort((a, b) => a.season - b.season)[0];
      if (!first || first.season !== spec.season) {
        thin.push({ id: row.playerId, name, season: spec.season, reason: `named season ${spec.season} is not her first archived season (${first?.season ?? 'none'})` });
        continue;
      }
      if (!wnbaRookieSeasonCounts(first)) {
        thin.push({ id: row.playerId, name, season: first.season, games: first.games ?? 0, mpg: first.games ? +((first.minutes ?? 0) / first.games).toFixed(1) : 0, reason: 'rookie season below the playing-time bar (forced)' });
        continue;
      }
      selections.push({ name, playerId: row.playerId, best: first, forced: true });
    }
  }

  if (unmatched.length) {
    throw new Error(`No archived rows for carded players: ${unmatched.join(', ')}`);
  }

  // ── The two pool-relative layers, exactly as the legends set does ─────────
  const cardedIds = new Set(wnbaSet.cards.map(c => c.bbrefId));
  const poolRows = reference.rows.filter(r => cardedIds.has(r.playerId));
  const shootingRows = [
    ...poolRows.map(r => ({
      tsPct: r.tsPct,
      paintPct: r.fgPct2,
      threePct: r.fgPct3,
      paintAttempts: r.fg2aTotal ?? 0,
      threeAttempts: r.fg3aTotal ?? 0,
      threeRate: r.fg3a100 ?? 0,
      paintRate: r.fg2a100 ?? 0,
    })),
    ...selections.map(s =>
      legendShootingInput(s.best, seasons.get(s.best.season).shooting, reference.shooting)
    ),
  ];
  const shooting = S.buildShootingLayer(shootingRows, {
    shotLineTarget: calibration.shotLine.target,
    paint: calibration.paintBoost,
    three: calibration.threePtBoost,
  });

  const spArchive = bpmArchive.requireArchive();
  const basis = bpmArchive.archiveBasis(spArchive);
  const spRows = selections.map(s => ({
    bpmHat: s.best.bpmHat,
    vorpPerGameHat: vorpPerGame(s.best.bpmHat, s.best, WNBA_GAME_MINUTES),
  }));
  const composites = spRows.map(r => composite(r, basis, COMPOSITE_WEIGHTS));
  // The league factor (constants.js) sits between the NBA-scale map and the split.
  const totals = leagueScaleTotals(mapToReferenceScale(composites, PRINTED_SCALE, {
    calibrateOn: spArchive.composites,
  }), { min: PRINTED_SCALE.min });

  const cards = selections.map((s, i) =>
    buildLegendCard({
      row: s.best,
      shooting: shooting.players[poolRows.length + i],
      speedPowerTotal: totals[i],
      calibration,
      realGames: loadWnbaSeasonRealGames(s.best.playerId, s.best.season),
    })
  );
  cards.sort((a, b) => a.name.localeCompare(b.name));

  PV.priceAgainstBase(cards, { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX });

  fs.mkdirSync(GEN_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    set: SET_ID,
    // Real-log charts where a rookie season clears the 10-game/300-minute
    // floor; the 21 that don't are flagged provisional per card.
    provisional: false,
    referenceSeason: WNBA_SEASON,
    firstSeason: WNBA_FIRST_SEASON,
    sources: {
      roster: 'cards-wnba.json — a rookie card for every player who has a base card',
      selection: "each player's first archived season; the archive reaches the league's own 1997, so it IS the rookie season",
      machinery: 'the WNBA legends pipeline: fitted BPM bridge, NBA BPM-equivalent archive, pool-calibrated shooting',
    },
    excluded,
    excludedCount: excluded.length,
    excludedThin: thin,
    excludedThinCount: thin.length,
    excludedRecent: recent,
    excludedRecentCount: recent.length,
    cards,
  };
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(payload, null, 1)}\n`);

  // The NBA rule, mirrored: an excluded current rookie's fact lands on her
  // BASE card as a badge instead of vanishing into a list. Joined by the
  // studio (players.js) exactly as the NBA's card-badges.json is.
  const badgeFile = path.join(GEN_DIR, 'wnba-card-badges.json');
  fs.writeFileSync(badgeFile, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    set: 'wnba',
    source: 'the WNBA Rookie exclusion list: a player whose rookie season is the current one gets no card there, so the fact prints on her base card',
    badges: excluded.map(e => ({ id: e.id, name: e.name, badges: ['rookie'] })),
  }, null, 1)}\n`);
  log(`WNBA Rookie: ${cards.length} cards (${excluded.length} excluded — each badged on her base card instead).`);
  log(`  ${OUTPUT_FILE}`);
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
