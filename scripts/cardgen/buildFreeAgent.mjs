// BUILD ONE REQUESTED CARD (Free Agents, docs/plans/2026-09-10-free-agents-design.md).
//
//   node scripts/cardgen/buildFreeAgent.mjs '{"bbrefId":"surabo01","season":1996,"playoffs":false,"set":"rookie","requestId":"abc"}'
//
// Builds the card and writes it into cards-free-agents.json, then prints ONE
// JSON line: the card's summary, or { error }. With "write": false it writes
// nothing and prints the card too — that is how the Card Studio's Build
// button runs it (studioServerPlugin.js), because writing the file makes Vite
// reload the Studio, so the Studio records the request as built first and
// commits the file last.
//
// ── WHAT IT DOES ────────────────────────────────────────────────────────────
//
// NBA: reads the season's rows from the cached full tables (a playoff run
// from the dunksandthrees playoff table), EPM from the API index or, before
// 2002, the BPM bridge — the quote index's own inputs — and builds through
// the team-reward pipeline (buildCandidateCards).
//
// WNBA: rates the archive with the fitted BPM model, takes the season from
// her career, and builds through buildWnbaCards, the WNBA Super Season set's
// own path, priced against the same base.
//
// Either way the season's game log is fetched from Basketball-Reference if it
// is not cached, so the chart is cut from the REAL games, the way every
// shipped set is built. src/game/cardSets.js merges the file's cards into the
// set each names. A rebuild of the same request replaces its card.
//
// The set is the one the request was classified into when it was quoted.
// Throwbacks (both leagues) wears one look (the `throwback` treatment), and
// its card ids always carry the season.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, writeCache, REPO_ROOT } from './cache.js';
import { fetchGameLogFull, fetchWnbaGameLogFull } from './sources/basketballReference.js';
import { normalizeName } from './resolveTeams.js';
import { careerSeasons } from './history.js';
import { REPLACEMENT_EPM, seasonLabel } from './generateSpecialSets.js';
import { buildApiEpmIndex, buildBpmBridge, playoffSeason } from './summerStandouts.js';
import { archiveBasis, requireArchive } from './epmArchive.js';
import { buildCandidateCards } from './teamRewardCandidates.js';
import { readFreeAgents, saveFreeAgent } from './freeAgentFile.js';
import { CALIBRATION_FILE } from './calibrateAttributes.js';
import * as PV from './playValue.js';
import * as A from './attributes.js';
import { loadArchive as loadWnbaArchive, rateArchive as rateWnbaArchive, careerOf as wnbaCareerOf, buildWnbaCards } from './wnba/generateWnbaLegends.js';
import { WNBA_SEASON } from './wnba/constants.js';
import { franchiseForSeason } from '../../src/cards/teams.js';
import { playerIdFromName } from '../../src/cards/playerId.js';
import { isNeverCard, AUTO_REJECT_MESSAGE } from '../../src/game/neverCard.js';
import { invoiceFor } from '../../src/game/freeAgents.js';
import { CARD_SETS } from '../../src/game/cardSets.js';

/** Every set a request can land in. Dissonance stays an admin call, never a build. */
export const BUILDABLE_SETS = [
  'rookie', 'super-season', 'summer-standouts', 'throwbacks',
  'wnba-rookie', 'wnba-super-season', 'wnba-throwbacks',
];

const WNBA_MODEL_FILE = path.join(REPO_ROOT, 'card-data', 'generated', 'wnba-bpm-model.json');
const tryCache = key => { try { return readCache(key); } catch { return null; } };
const tableRows = (season, kind) => {
  const cached = tryCache(`bbref-${season}-${kind}-full`);
  return Array.isArray(cached) ? cached : cached?.rows ?? cached?.data ?? [];
};
const mostGames = rows => rows.reduce((best, r) => (!best || (r.games ?? 0) > (best.games ?? 0) ? r : best), null);

/**
 * The card's id: the player's, with the season added when that set already
 * holds the id. A THROWBACKS id always carries its season — one player can
 * have many Throwbacks seasons, and the art is named that way
 * (card-art/sets/throwbacks/photos/Jawad_Williams_2011.jpg).
 */
export function freeAgentCardId(name, season, set, taken) {
  const base = playerIdFromName(name);
  if (/throwbacks$/.test(set)) return `${base}_${season}`;
  return taken.has(`${set}:${base}`) ? `${base}_${season}` : base;
}

/** Fetch and cache one game log unless it is cached already. True when it was fetched. */
async function ensureLog(key, fetchLog) {
  if (tryCache(key)) return false;
  writeCache(key, await fetchLog());
  return true;
}

function regularCandidate(bbrefId, season) {
  const adv = tableRows(season, 'advanced').filter(r => r.playerId === bbrefId).map(r => ({ ...r, season }));
  if (!adv.length) throw new Error(`No ${seasonLabel(season)} row for ${bbrefId} in the archive`);
  const [line] = careerSeasons(adv);
  const name = line.name;
  const same = r => r.playerId === bbrefId || (!r.playerId && normalizeName(r.name) === normalizeName(name));
  const pp = mostGames(tableRows(season, 'perPoss').filter(same));
  if (!pp) throw new Error(`No ${seasonLabel(season)} per-possession row for ${name}`);
  const sh = mostGames(tableRows(season, 'shooting').filter(same));
  const games = line.games ?? 0;
  const api = season >= 2002 ? buildApiEpmIndex().get(`${normalizeName(name)}|${season}`) : null;
  const bridge = buildBpmBridge(archiveBasis(requireArchive()));
  return {
    name, season, team: line.team, games,
    mpg: Number(((line.minutes ?? 0) / Math.max(games, 1)).toFixed(1)),
    advRow: { ...line, playerId: bbrefId }, ppRow: pp, shRow: sh,
    epm: api?.epm ?? bridge.epmFromBpm(line.bpm) ?? REPLACEMENT_EPM,
    ewinsPerGame: api?.ewinsPerGame ?? bridge.ewinsPerGameFromVorp(line.vorp, games),
    trustMinutes: line.minutes ?? 0,
  };
}

function playoffCandidate(bbrefId, season) {
  const name = tableRows(season, 'advanced').find(r => r.playerId === bbrefId)?.name;
  const cached = tryCache(`dunksandthrees-api-season-epm-${season}-st4`);
  const raw = cached?.data ?? cached ?? [];
  const row = (Array.isArray(raw) ? raw : raw.rows ?? []).find(r => normalizeName(r.name) === normalizeName(name));
  if (!row) throw new Error(`No ${season} playoff row for ${name ?? bbrefId}`);
  const run = { ...playoffSeason({ ...row, season }), playerId: bbrefId };
  const games = row.games ?? 0;
  return {
    name: row.name, season, team: row.team, games,
    mpg: Number(((row.minutes ?? 0) / Math.max(games, 1)).toFixed(1)),
    advRow: run, ppRow: {}, shRow: { rimPct: run.rimPct, rimShare: run.rimShare },
    // run.playoffRun rides in on advRow, which is what makes buildSet cut
    // the chart from the playoff games only.
    epm: run.epm ?? REPLACEMENT_EPM, ewinsPerGame: run.ewinsPerGame, trustMinutes: row.minutes ?? 0,
  };
}

async function nbaCard({ bbrefId, season, playoffs }) {
  const candidate = playoffs ? playoffCandidate(bbrefId, season) : regularCandidate(bbrefId, season);
  if (isNeverCard(candidate.name)) throw new Error(AUTO_REJECT_MESSAGE);
  const fetchedLog = await ensureLog(`gamelog-full-${bbrefId}-${season}`, () => fetchGameLogFull(bbrefId, season));
  const [card] = buildCandidateCards([candidate], { log: () => {}, useRealGames: true });
  return {
    name: candidate.name, fetchedLog,
    card: {
      ...card,
      team: franchiseForSeason(candidate.team, season),
      seasonLabel: seasonLabel(season),
      ...(playoffs ? { playoffRun: true } : {}),
    },
  };
}

async function wnbaCard({ bbrefId, season, set }) {
  const model = JSON.parse(fs.readFileSync(WNBA_MODEL_FILE, 'utf8'));
  const seasons = rateWnbaArchive(loadWnbaArchive().loaded, model);
  const reference = seasons.get(WNBA_SEASON);
  if (!reference) throw new Error(`The WNBA reference season ${WNBA_SEASON} is not cached`);
  const career = wnbaCareerOf(bbrefId, seasons);
  const best = career.find(c => c.season === season);
  if (!best) throw new Error(`No ${season} WNBA row for ${bbrefId} in the archive`);
  if (isNeverCard(best.name)) throw new Error(AUTO_REJECT_MESSAGE);
  const fetchedLog = await ensureLog(`gamelog-wnba-${bbrefId}-${season}`, () => fetchWnbaGameLogFull(bbrefId, season));
  const calibration = JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'));
  const [card] = buildWnbaCards({ selections: [{ name: best.name, playerId: bbrefId, best, career }], seasons, reference, calibration });
  PV.priceAgainstBase([card], { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX });
  // buildWnbaCards gives a first-season card the rookie pill for the Super
  // Season twin; a card IN the Rookie set does not need telling.
  if (set === 'wnba-rookie' && card.badges) {
    card.badges = card.badges.filter(b => b !== 'rookie');
    if (!card.badges.length) delete card.badges;
  }
  return { name: best.name, fetchedLog, card };
}

export async function buildFreeAgent({ bbrefId, season, playoffs = false, set, requestId = null, write = true }) {
  if (!BUILDABLE_SETS.includes(set)) {
    throw new Error(`Cannot build into "${set}"`);
  }
  const { name, card, fetchedLog } = set.startsWith('wnba-')
    ? await wnbaCard({ bbrefId, season, set })
    : await nbaCard({ bbrefId, season, playoffs });

  const mine = c => requestId && c.requestId === requestId;
  const taken = new Set([
    ...Object.entries(CARD_SETS).flatMap(([setId, cards]) => cards.filter(c => !mine(c)).map(c => `${setId}:${c.id}`)),
    ...(readFreeAgents(REPO_ROOT).cards ?? []).filter(c => !mine(c)).map(c => `${c.set}:${c.id}`),
  ]);
  const id = freeAgentCardId(name, season, set, taken);
  const built = {
    ...card,
    id,
    name,
    set,
    season,
    bbrefId,
    requested: true,
    requestId,
    builtAt: new Date().toISOString(),
  };
  if (write) saveFreeAgent(REPO_ROOT, built);

  const invoice = invoiceFor(built);
  return {
    requestId, cardKey: `${set}:${id}`, id, name, season, playoffs: Boolean(playoffs), set, team: built.team,
    salary: invoice.salary, rarity: invoice.rarity, price: invoice.price, fetchedLog,
    provisional: Boolean(built.provisional),
    ...(write ? {} : { card: built }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = JSON.parse(process.argv[2] ?? '{}');
    const out = await buildFreeAgent({ ...args, season: Number(args.season) });
    process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (e) {
    process.stdout.write(`${JSON.stringify({ error: e?.message ?? String(e) })}\n`);
    process.exitCode = 1;
  }
}
