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
import { REPO_ROOT } from '../cache.js';
import { CALIBRATION_FILE } from '../calibrateAttributes.js';
import * as PV from '../playValue.js';
import * as A from '../attributes.js';
import * as S from '../shooting.js';
import * as bpmArchive from './nbaBpmArchive.js';
import { PRINTED_SCALE, mapToReferenceScale } from '../speedPower.js';
import { WNBA_SEASON, WNBA_FIRST_SEASON, WNBA_GAME_MINUTES } from './constants.js';
import {
  loadArchive, rateArchive, careerOf, legendShootingInput, buildLegendCard,
} from './generateWnbaLegends.js';
import { MODEL_FILE } from './fitBpmModel.js';
import { vorpPerGame, COMPOSITE_WEIGHTS, composite } from './generateWnbaCards.js';
import { WNBA_SET } from '../../../src/cards/sets.js';

const WNBA_CARDS_FILE = path.join(REPO_ROOT, 'card-data', 'generated', `cards-${WNBA_SET}.json`);

export const SET_ID = 'wnba-rookie';
const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, `cards-${SET_ID}.json`);

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

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
  const unmatched = [];
  for (const card of wnbaSet.cards) {
    const career = careerOf(card.bbrefId, seasons);
    if (career.length === 0) { unmatched.push(card.name); continue; }
    const first = career.slice().sort((a, b) => a.season - b.season)[0];
    if (first.season === WNBA_SEASON) {
      excluded.push({ id: card.id, name: card.name, reason: 'rookie season is the current one — her base card already is that season' });
      continue;
    }
    selections.push({ name: card.name, playerId: card.bbrefId, best: first });
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
  const totals = mapToReferenceScale(composites, PRINTED_SCALE, {
    calibrateOn: spArchive.composites,
  });

  const cards = selections.map((s, i) =>
    buildLegendCard({
      row: s.best,
      shooting: shooting.players[poolRows.length + i],
      speedPowerTotal: totals[i],
      calibration,
    })
  );
  cards.sort((a, b) => a.name.localeCompare(b.name));

  PV.priceAgainstBase(cards, { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX });

  fs.mkdirSync(GEN_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    set: SET_ID,
    provisional: true,
    referenceSeason: WNBA_SEASON,
    firstSeason: WNBA_FIRST_SEASON,
    sources: {
      roster: 'cards-wnba.json — a rookie card for every player who has a base card',
      selection: "each player's first archived season; the archive reaches the league's own 1997, so it IS the rookie season",
      machinery: 'the WNBA legends pipeline: fitted BPM bridge, NBA BPM-equivalent archive, pool-calibrated shooting',
    },
    excluded,
    excludedCount: excluded.length,
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
