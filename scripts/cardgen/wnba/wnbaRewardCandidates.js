// Who could be a WNBA franchise's completion reward.
//
//   node scripts/cardgen/wnba/wnbaRewardCandidates.js
//   node scripts/cardgen/wnba/wnbaRewardCandidates.js LVA SEA
//
// ── WHAT THIS IS AND IS NOT ─────────────────────────────────────────────────
//
// The NBA rewards are ranked by a PRICE, because the NBA candidate search can
// build and price a card for every candidate. This cannot, yet: pricing a WNBA
// card means cutting its chart from a real game log, and only the 216 pairs
// behind the current sets are cached. Fetching a few hundred more is a job for
// its own run, at the same polite spacing everything else uses.
//
// So this ranks by the thing that is available and is what the WNBA sets
// already select on: the FITTED BPM EQUIVALENT, with its VORP-per-game partner,
// exactly as generateWnbaLegends scores a season. That is a shortlist, not a
// price — the same relationship the NBA's per-100 pass has to its real-log one.
//
// ── THE SAME PICK RULE AS THE NBA SET ───────────────────────────────────────
//
// Absent from every other WNBA set, enough of a season to be worth a card, and
// among the in-band options the one most identified with the franchise. A
// relocated team's seasons reward the franchise that carries them today, which
// for the WNBA means the Shock's Detroit and Tulsa years belong to Dallas and
// the Comets belong to nobody — Houston folded and was not relocated.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from '../cache.js';
import { normalizeName } from '../resolveTeams.js';
import { loadArchive, rateArchive } from './generateWnbaLegends.js';
import { vorpPerGame } from './generateWnbaCards.js';
import { WNBA_GAME_MINUTES } from './constants.js';
import { CARD_SETS } from '../../../src/game/cardSets.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, 'wnba-reward-candidates.json');
const MODEL_FILE = path.join(GEN_DIR, 'wnba-bpm-model.json');

/** Enough of a season to card. A WNBA schedule is 34-44 games. */
export const MIN_GAMES = 20;
export const MIN_MPG = 20;

/**
 * Where a defunct or relocated WNBA team's seasons live today.
 *
 * THE SHOCK ARE ONE FRANCHISE THROUGH THREE CITIES — Detroit 1998-2009, Tulsa
 * 2010-2015, Dallas 2016- — so a Detroit Shock season rewards the Wings. The
 * COMETS ARE NOT HERE ON PURPOSE: Houston folded in 2008 and its players were
 * dispersed, so its four championships belong to no current roster and its
 * seasons are not a reward for anybody. Same for the Monarchs, Sting, Starzz,
 * Miracle, Fire and Silver Stars where the franchise ended rather than moved.
 */
export const RELOCATED = {
  DET: 'DAL', DET2: 'DAL', TUL: 'DAL', // Shock -> Wings
  UTA: 'LVA', SAS: 'LVA',              // Starzz -> Silver Stars -> Aces
  ORL: 'CON',                          // Miracle -> Sun
};

/**
 * Franchises that ENDED rather than moved. Their seasons reward nobody.
 *
 * The Sting were mapped to Connecticut here and that was wrong by this file's
 * own rule: Charlotte folded in 2006 and its players went to a dispersal draft,
 * exactly as Houston's did in 2008. The Sun are the Orlando MIRACLE relocated,
 * which is why ORL is above and CHA is not — a Sting jersey rewarding
 * Connecticut would be inventing a lineage the league does not recognise.
 */
export const FOLDED = new Set(['HOU', 'CHA', 'CHA2', 'SAC', 'CLE', 'MIA', 'PORF']);

// PORF, NOT POR. The 2000-2002 Portland Fire folded; the 2026 Fire is an
// expansion team that revived the name, not the same franchise coming back —
// so the old seasons reward nobody, while the live code stays free for a
// modern Portland card to use.

/** Codes that are era spellings of a live franchise, not a different one. */
const ERA_SUFFIX = /^(SEA|MIN|PHO|NYL|WAS|CON|ATL|LVA)\d*$/;

export function franchiseOf(team) {
  const code = String(team ?? '').toUpperCase();
  if (!code || /^(TOT|2TM|3TM)$/.test(code)) return null;
  if (FOLDED.has(code)) return null;
  if (Object.hasOwn(RELOCATED, code)) return RELOCATED[code];
  const era = ERA_SUFFIX.exec(code);
  if (era) return era[1];
  return code;
}

/** Names any other WNBA set already holds. */
export function alreadyCarded() {
  const names = new Set();
  for (const setId of ['wnba', 'wnba-super-season', 'wnba-rookie']) {
    for (const card of CARD_SETS[setId] ?? []) names.add(normalizeName(card.name));
  }
  return names;
}

export function main({ franchises = null, log = console.log } = {}) {
  const model = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
  const { loaded } = loadArchive();
  if (loaded.length === 0) {
    throw new Error('No cached WNBA seasons — run scripts/cardgen/wnba/fetchWnbaHistory.js first.');
  }
  const seasons = rateArchive(loaded, model);
  const carded = alreadyCarded();
  const want = franchises ? new Set(franchises) : null;

  const out = [];
  for (const [season, entry] of seasons) {
    for (const row of entry.rows ?? []) {
      const franchise = franchiseOf(row.team);
      if (!franchise) continue;
      if (want && !want.has(franchise)) continue;
      const games = row.games ?? 0;
      if (games < MIN_GAMES) continue;
      if ((row.mpg ?? (row.minutes ?? 0) / (games || 1)) < MIN_MPG) continue;
      if (carded.has(normalizeName(row.name))) continue;
      if (row.bpmHat == null) continue;

      out.push({
        franchise,
        name: row.name,
        playerId: row.playerId,
        season,
        team: row.team,
        games,
        mpg: Number((row.mpg ?? (row.minutes ?? 0) / games).toFixed(1)),
        bpmHat: Number(row.bpmHat.toFixed(2)),
        vorpPerGame: Number(vorpPerGame(row.bpmHat, row, WNBA_GAME_MINUTES).toFixed(4)),
      });
    }
  }

  // Best season first inside each franchise, one row per player-season. The
  // ranking key is bpmHat + VORP-per-game the way the Super Season set scores,
  // rather than bpmHat alone, so a huge rate in few minutes does not outrank a
  // season somebody actually played.
  const byFranchise = {};
  for (const r of out) (byFranchise[r.franchise] ??= []).push(r);
  for (const rows of Object.values(byFranchise)) {
    rows.sort((a, b) => b.bpmHat + b.vorpPerGame * 40 - (a.bpmHat + a.vorpPerGame * 40));
  }

  const body = {
    generatedAt: new Date().toISOString(),
    note:
      'Ranked by the fitted BPM equivalent, NOT priced. A WNBA card is priced off a real ' +
      'game log and only the current sets have those cached, so these are a shortlist to ' +
      'pick from and then price.',
    filters: { minGames: MIN_GAMES, minMpg: MIN_MPG },
    byFranchise,
  };
  fs.mkdirSync(GEN_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(body, null, 1)}\n`);
  log(`WNBA reward candidates: ${out.length} seasons across ${Object.keys(byFranchise).length} franchises.`);
  log(`  ${OUTPUT_FILE}`);
  return body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
  main({ franchises: args.length ? args : null });
}
