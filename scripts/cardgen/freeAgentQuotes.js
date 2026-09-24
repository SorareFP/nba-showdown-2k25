// THE FREE AGENT QUOTE INDEX: every archived player-season, priced ahead of
// time, so the site can quote a requested card instantly.
//
//   node scripts/cardgen/freeAgentQuotes.js                  # the whole archive
//   node scripts/cardgen/freeAgentQuotes.js --from 2010 --to 2012 --dry
//
// Design: docs/plans/2026-09-10-free-agents-design.md. The user (2026-09-10):
// "The person requesting would just set the player, and the season, our algo
// would run on site, return only a salary, rarity and an invoice cost." The
// generator cannot run on the site (a 325 MB archive, Basketball-Reference
// game logs, an API key), so it runs HERE, over everything, and the site gets
// the answers: card-data/generated/quote-index.json.
//
// ── WHAT A ROW SAYS ─────────────────────────────────────────────────────────
//
// Which set the card lands in (classifySeason), and its estimated salary. The
// price is not stored: src/game/freeAgents.js derives it from salary and set
// with the live packs, on the site and on the server alike.
//
// ── THE ESTIMATE, AND HOW HONEST IT IS ──────────────────────────────────────
//
// Priced through the SAME pipeline as the team-reward shortlist
// (teamRewardCandidates.priceCandidates), from per-100 season rates, because
// a game log for 25,000 seasons is not a thing to fetch. Per-100 runs high,
// most of all for stars, so the batch is calibrated. Every season that
// already has a card built from real game logs is priced in the same batch,
// a straight line is fitted from its per-100 price to its shipped price, and
// that line corrects every quote. The fit (n, r, residual sd) is written into
// the file. The invoice is the FINISHED card's price (the user's call), so an
// estimate that misses costs nobody anything.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { careerSeasons, bestSeason, BEST_SEASON_MIN_GAMES, BEST_SEASON_MIN_MINUTES } from './history.js';
import { seasonDistribution } from './fetchHistory.js';
import { REPLACEMENT_EPM } from './generateSpecialSets.js';
// THE CLASSIFIER LIVES IN rewardIdentity.js SINCE 2026-09-22: the reward
// generators judge a built reward's identity by the same rule a request is
// quoted by (the user: "If a card does not qualify for super season or rookie
// (or dissonance), 26-27, they should be throwbacks"), and they cannot import
// it from here without a cycle (this file imports generateTeamRewards for
// NEVER_CARD). Re-exported so every caller and test keeps its import.
import { unprovableDebutSeasons, classifySeason, settleTwin, classifyWnbaSeason, WNBA_SETS, superSeasonMap, isBestSeason } from './rewardIdentity.js';
export { unprovableDebutSeasons, classifySeason, settleTwin, classifyWnbaSeason, WNBA_SETS };
import { buildApiEpmIndex, buildBpmBridge, playoffSeason } from './summerStandouts.js';
import { archiveBasis, requireArchive } from './epmArchive.js';
import { priceCandidates } from './teamRewardCandidates.js';
import { NEVER_CARD } from './generateTeamRewards.js';
import * as A from './attributes.js';
import { CARD_SETS } from '../../src/game/cardSets.js';
import { loadArchive as loadWnbaArchive, rateArchive as rateWnbaArchive, careerOf as wnbaCareerOf } from './wnba/generateWnbaLegends.js';
import { bestLegendSeason } from './wnba/legends.js';
import { fitRidge, predict } from './wnba/bpmModel.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
const WNBA_MODEL_FILE = path.join(GEN_DIR, 'wnba-bpm-model.json');
export const QUOTE_FILE = path.join(GEN_DIR, 'quote-index.json');

/** Enough of a season to card at all. The chart's trust curve handles the thin end. */
export const QUOTE_MIN_GAMES = 10;
export const QUOTE_MIN_MINUTES = 150;
/** A playoff run: a series, at least. */
export const PLAYOFF_MIN_GAMES = 4;
export const PLAYOFF_MIN_MINUTES = 100;
/** The first playoff table (dunksandthrees st4) and the base set's season. */
export const FIRST_PLAYOFF_SEASON = 2002;
export const BASE_SEASON = 2026;

// ── Pure pieces (tested) ─────────────────────────────────────────────────────

/** Enes Kanter / Enes Freedom are never carded, in any set (permanent rule). */
export function isNeverCard(name) {
  return NEVER_CARD.has(normalizeName(name));
}

/**
 * Which set already holds a player-season: `id|season` and `name|season`
 * (the base set prints no Basketball-Reference id), with `|po` for a playoff
 * run, so a regular season and a playoff run of the same year are different
 * cards.
 */
export function cardedIndex(cardSets, { baseSet = '2026-27', baseSeason = BASE_SEASON } = {}) {
  const index = new Map();
  for (const [setId, cards] of Object.entries(cardSets)) {
    for (const card of cards) {
      const season = card.season ?? (setId === baseSet ? baseSeason : null);
      if (season == null) continue;
      const sfx = card.playoffRun ? '|po' : '';
      if (card.bbrefId) index.set(`${card.bbrefId}|${season}${sfx}`, setId);
      index.set(`${normalizeName(card.name)}|${season}${sfx}`, setId);
    }
  }
  return index;
}

export function cardedFor(index, { bbrefId, name, season, playoffs = false }) {
  const sfx = playoffs ? '|po' : '';
  return index.get(`${bbrefId}|${season}${sfx}`) ?? index.get(`${normalizeName(name)}|${season}${sfx}`) ?? null;
}

/** Ordinary least squares, y = a + b·x, with the correlation and the residual sd. */
export function fitLine(pairs) {
  const n = pairs.length;
  if (n < 2) return null;
  const mx = pairs.reduce((t, [x]) => t + x, 0) / n;
  const my = pairs.reduce((t, [, y]) => t + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  const b = sxx > 0 ? sxy / sxx : 0;
  const a = my - b * mx;
  const resid = pairs.reduce((t, [x, y]) => t + (y - (a + b * x)) ** 2, 0);
  return {
    n, a, b,
    r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0,
    sd: Math.sqrt(resid / Math.max(n - 2, 1)),
  };
}

/** A per-100 price, corrected by the fit and put back on the salary grid. */
export function calibrated(per100, fit, { round = A.roundSalary, min = A.SALARY_MIN, max = A.SALARY_MAX } = {}) {
  const y = fit ? fit.a + fit.b * per100 : per100;
  return Math.min(max, Math.max(min, round(y)));
}

// ── The archive ──────────────────────────────────────────────────────────────

function tableRows(season, kind) {
  let cached;
  try { cached = readCache(`bbref-${season}-${kind}-full`); } catch { return []; }
  return Array.isArray(cached) ? cached : cached?.rows ?? cached?.data ?? [];
}

/** One row per player-season, the max-games (aggregate) row: the season-wide line. */
function byPlayerSeason(rows, season) {
  const out = new Map();
  for (const r of rows) {
    const key = `${r.playerId ?? normalizeName(r.name)}|${season}`;
    const prev = out.get(key);
    if (!prev || (r.games ?? 0) > (prev.games ?? 0)) out.set(key, r);
  }
  return out;
}

function loadArchiveTables({ first, last }) {
  const seasons = [];
  const advanced = [];
  const perPoss = new Map();
  const shooting = new Map();
  for (let s = first; s <= last; s += 1) {
    const adv = tableRows(s, 'advanced');
    if (!adv.length) continue;
    seasons.push(s);
    for (const r of adv) advanced.push({ ...r, season: s });
    for (const [k, v] of byPlayerSeason(tableRows(s, 'perPoss'), s)) perPoss.set(k, v);
    for (const [k, v] of byPlayerSeason(tableRows(s, 'shooting'), s)) shooting.set(k, v);
  }
  return { seasons, advanced, perPoss, shooting };
}

/** Shipped cards built from real game logs: the calibration's targets. */
function realLogTargets(sets) {
  const out = new Map();
  for (const setId of sets) {
    for (const card of CARD_SETS[setId] ?? []) {
      if (card.provisional || !card.bbrefId || card.season == null) continue;
      out.set(`${card.bbrefId}|${card.season}${card.playoffRun ? '|po' : ''}`, card.salary);
    }
  }
  return out;
}

// ── WNBA ─────────────────────────────────────────────────────────────────────
//
// A WNBA card is priced off its real game log, and only the logs behind the
// shipped sets are cached, so the per-100 card pass the NBA quotes run has
// nothing to stand on here. The WNBA quote is a RIDGE FIT instead: from the
// rated season (the fitted BPM equivalent every WNBA set selects on, as a
// z-score in its own league, plus the box rates) to the salaries of the 200
// real-log WNBA cards. Ten-fold cross-validated, 2026-09-10: r 0.96, sd $98,
// level with the NBA pass. The invoice is the finished card's own price
// either way.
//
// The archive opens with the league itself (1997), so a first season IS a
// rookie season, with none of the NBA's unprovable debuts.

/** The WNBA salary fit's inputs, from one rated season and its league's bpmHat spread. */
export function wnbaFeatures(row, distribution) {
  const mpg = (row.minutes ?? 0) / Math.max(row.games ?? 1, 1);
  const z = distribution?.sd > 0 ? (row.bpmHat - distribution.mean) / distribution.sd : 0;
  return [
    z, row.obpmHat ?? 0, mpg, z * Math.min(mpg, 34),
    row.pts100 ?? 0, row.trb100 ?? 0, row.ast100 ?? 0, row.usgPct ?? 0, row.tsPct ?? 0, row.stl100 ?? 0, row.blk100 ?? 0,
  ];
}

/** Every uncarded WNBA season worth a card, quoted by the ridge fit. */
export function wnbaQuotes({ carded, log = console.log, superSeasonOf = superSeasonMap() } = {}) {
  const model = JSON.parse(fs.readFileSync(WNBA_MODEL_FILE, 'utf8'));
  const seasons = rateWnbaArchive(loadWnbaArchive().loaded, model);
  const targets = realLogTargets(['wnba', 'wnba-super-season', 'wnba-rookie', 'wnba-team-rewards', 'wnba-throwbacks']);
  const ids = new Set([...seasons.values()].flatMap(e => (e.rows ?? []).map(r => r.playerId)));

  const X = [];
  const y = [];
  const candidates = [];
  for (const playerId of ids) {
    const career = wnbaCareerOf(playerId, seasons);
    const top = bestLegendSeason(career);
    for (const line of career) {
      const features = wnbaFeatures(line, seasons.get(line.season)?.distribution);
      const target = targets.get(`${playerId}|${line.season}`);
      if (target != null) { X.push(features); y.push(target); }
      if (isNeverCard(line.name)) continue;
      if ((line.games ?? 0) < QUOTE_MIN_GAMES || (line.minutes ?? 0) < QUOTE_MIN_MINUTES) continue;
      // By id only: a WNBA name can match an NBA card's name in the same year.
      if (carded.has(`${playerId}|${line.season}`)) continue;
      candidates.push({
        playerId, line, features, set: classifyWnbaSeason(career, line.season, { superSeasonOf, playerId }),
        // For the twin rule: her best season (her Super Season card's, since
        // the value pick), and one that met the WNBA Super Season floors.
        alsoBest: isBestSeason(career, line.season, top, { superSeasonOf, playerId }),
        trusted: top.eligibility === 'both',
      });
    }
  }
  const model2 = fitRidge(X, y, null, 0.1);
  const pred = X.map(x => predict(model2, x));
  const inSample = fitLine(pred.map((p, i) => [p, y[i]]));
  const fit = { n: X.length, intercept: model2.intercept, coef: model2.coef, r: inSample?.r ?? null, sd: inSample?.sd ?? null };
  log(`  wnba: ${candidates.length} seasons; ridge on ${fit.n} real-log cards, in-sample r=${fit.r?.toFixed(2)}, sd=$${fit.sd?.toFixed(0)}`);

  const rows = candidates.map(c => {
    const salary = calibrated(predict(model2, c.features), null);
    const set = settleTwin(c.set, { ...c, salary }, { rookie: WNBA_SETS.rookie, best: WNBA_SETS.best });
    return [c.playerId, c.line.name, c.line.season, 'r', c.line.team, salary, set];
  });
  const years = [...seasons.keys()].sort((a, b) => a - b);
  return { rows, fit, seasons: [years[0], years.at(-1)] };
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function main({ first = 1976, last = BASE_SEASON, write = true, wnba = true, debug = false, log = console.log } = {}) {
  // The season each player's Super Season card carries (the value pick,
  // 2026-09-24): a requested season is his Super Season only if it is THAT one.
  const superSeasonOf = superSeasonMap();
  const t0 = Date.now();
  const { seasons, advanced, perPoss, shooting } = loadArchiveTables({ first, last });
  const unprovable = unprovableDebutSeasons(seasons);
  const distributions = {};
  for (const s of seasons) distributions[s] = seasonDistribution(advanced.filter(r => r.season === s));
  const careers = new Map();
  for (const r of advanced) (careers.get(r.playerId) ?? careers.set(r.playerId, []).get(r.playerId)).push(r);
  const carded = cardedIndex(CARD_SETS);
  // The requested cards themselves calibrate the next quotes (2026-09-21):
  // a built free agent is a real-log card in exactly the price zone the
  // requests come from, and the throwbacks set is where most of them land.
  const targets = realLogTargets(['super-season', 'rookie', 'team-rewards', 'summer-standouts', 'throwbacks']);
  const apiEpm = buildApiEpmIndex();
  const bridge = buildBpmBridge(archiveBasis(requireArchive()));
  log(`Archive ${seasons[0]}-${seasons.at(-1)}: ${seasons.length} seasons, ${careers.size} players, ${advanced.length} rows.`);

  // ── Regular seasons ────────────────────────────────────────────────────────
  const regular = [];
  let skippedCarded = 0;
  for (const [playerId, rows] of careers) {
    const career = careerSeasons(rows);
    const top = bestSeason(career, distributions);
    for (const line of career) {
      const name = line.name;
      if (isNeverCard(name)) continue;
      const games = line.games ?? 0;
      if (games < QUOTE_MIN_GAMES || (line.minutes ?? 0) < QUOTE_MIN_MINUTES) continue;
      const key = `${playerId}|${line.season}`;
      const already = cardedFor(carded, { bbrefId: playerId, name, season: line.season });
      const target = targets.get(key);
      if (already && target == null) { skippedCarded += 1; continue; }
      const pp = perPoss.get(key);
      if (!pp) continue;
      const sh = shooting.get(key) ?? null;
      const api = line.season >= FIRST_PLAYOFF_SEASON ? apiEpm.get(`${normalizeName(name)}|${line.season}`) : null;
      const epm = api?.epm ?? bridge.epmFromBpm(line.bpm) ?? REPLACEMENT_EPM;
      const ewinsPerGame = api?.ewinsPerGame ?? bridge.ewinsPerGameFromVorp(line.vorp, games);
      regular.push({
        name, season: line.season, team: line.team, games,
        mpg: Number(((line.minutes ?? 0) / games).toFixed(1)),
        advRow: { ...line, playerId }, ppRow: pp, shRow: sh,
        epm, ewinsPerGame, trustMinutes: line.minutes ?? 0,
        bbrefId: playerId,
        set: classifySeason(career, line.season, { distributions, unprovable, superSeasonOf, playerId }),
        // For the twin rule: the career's best (his Super Season card's since
        // the value pick), in a season the gold line trusts.
        alsoBest: isBestSeason(career, line.season, top, { superSeasonOf, playerId }),
        trusted: games >= BEST_SEASON_MIN_GAMES && (line.minutes ?? 0) >= BEST_SEASON_MIN_MINUTES,
        carded: already, target,
      });
    }
  }
  log(`Regular seasons: ${regular.length} to price (${skippedCarded} already carded without a real-log target).`);

  // ── Playoff runs (2002+, the dunksandthrees playoff table) ────────────────
  const nameToId = new Map();
  for (const r of advanced) nameToId.set(`${normalizeName(r.name)}|${r.season}`, r.playerId);
  const playoffs = [];
  for (let s = Math.max(first, FIRST_PLAYOFF_SEASON); s <= last; s += 1) {
    let cached;
    try { cached = readCache(`dunksandthrees-api-season-epm-${s}-st4`); } catch { continue; }
    const raw = cached?.data ?? cached ?? [];
    for (const row of Array.isArray(raw) ? raw : raw.rows ?? []) {
      if (isNeverCard(row.name)) continue;
      if ((row.games ?? 0) < PLAYOFF_MIN_GAMES || (row.minutes ?? 0) < PLAYOFF_MIN_MINUTES) continue;
      const bbrefId = nameToId.get(`${normalizeName(row.name)}|${s}`);
      if (!bbrefId) continue;
      const already = cardedFor(carded, { bbrefId, name: row.name, season: s, playoffs: true });
      const target = targets.get(`${bbrefId}|${s}|po`);
      if (already && target == null) continue;
      const season = { ...playoffSeason({ ...row, season: s }), playerId: bbrefId };
      const games = row.games ?? 0;
      playoffs.push({
        name: row.name, season: s, team: row.team, games,
        mpg: Number(((row.minutes ?? 0) / games).toFixed(1)),
        advRow: season, ppRow: {}, shRow: { rimPct: season.rimPct, rimShare: season.rimShare },
        epm: season.epm ?? REPLACEMENT_EPM, ewinsPerGame: season.ewinsPerGame, trustMinutes: row.minutes ?? 0,
        bbrefId, set: 'summer-standouts', carded: already, target,
      });
    }
  }
  log(`Playoff runs: ${playoffs.length} to price.`);

  // ── Price, calibrate, write ────────────────────────────────────────────────
  const describe = fit => (fit
    ? `n=${fit.n}, real ≈ ${fit.a.toFixed(0)} + ${fit.b.toFixed(3)} × per100, r=${fit.r.toFixed(2)}, sd=$${fit.sd.toFixed(0)}`
    : 'none');
  // Price a batch, and fit its own line from the pairs inside it.
  const price = (batch, label) => {
    if (!batch.length) return { batch, priced: [], fit: null };
    const t = Date.now();
    const priced = priceCandidates(batch, { log: () => {} });
    const pairs = [];
    // The calibration pairs with the season behind each, for the diagnostics
    // a `debug` run returns (2026-09-21: the user's Korver 2010-11 was quoted
    // $790 and built $570, and the question was whether that miss has a shape).
    const detail = [];
    batch.forEach((c, i) => {
      if (c.target == null) return;
      pairs.push([priced[i].salary, c.target]);
      detail.push({ name: c.name, season: c.season, set: c.set, games: c.games, mpg: c.mpg, epm: Number(c.epm.toFixed(2)), per100: priced[i].salary, real: c.target });
    });
    const fit = fitLine(pairs);
    log(`  ${label}: priced ${batch.length} in ${((Date.now() - t) / 1000).toFixed(1)}s; own fit ${describe(fit)}`);
    return { batch, priced, fit, detail };
  };
  // Quotes only: a carded season was in the batch as a calibration pair.
  const quoteRows = ({ batch, priced }, kind, fit) => {
    const rows = [];
    batch.forEach((c, i) => {
      if (c.carded) return;
      const salary = calibrated(priced[i].salary, fit);
      rows.push([c.bbrefId, c.name, c.season, kind, c.team, salary, settleTwin(c.set, { ...c, salary })]);
    });
    return rows;
  };
  const regPriced = price(regular, 'regular');
  const poPriced = price(playoffs, 'playoffs');
  // A playoff fit needs enough real-log Standouts to stand on; below that the
  // runs are corrected by the regular-season line instead.
  const poFit = poPriced.fit && poPriced.fit.n >= 15 ? poPriced.fit : regPriced.fit;
  if (poFit !== poPriced.fit) log('  playoffs: too few real-log Standouts for their own line, so the regular-season line corrects them.');
  const reg = { rows: quoteRows(regPriced, 'r', regPriced.fit), fit: regPriced.fit };
  const po = { rows: quoteRows(poPriced, 'p', poFit), fit: poFit };

  const wn = wnba ? wnbaQuotes({ carded, log }) : { rows: [], fit: null, seasons: null };

  const rows = [...reg.rows, ...po.rows, ...wn.rows].sort((x, y) => x[1].localeCompare(y[1]) || x[2] - y[2]);
  const bySet = rows.reduce((t, r) => ({ ...t, [r[6]]: (t[r[6]] ?? 0) + 1 }), {});
  const body = {
    generatedAt: new Date().toISOString(),
    note: 'Estimated salary and landing set for every archived player-season without a card. ' +
      'Row: [bbrefId, name, season, kind r|p, team, salary, set]. Price comes from src/game/freeAgents.js. ' +
      'WNBA rows carry a Basketball-Reference WNBA id (ending in w) and a wnba-* set.',
    seasons: [seasons[0], seasons.at(-1)],
    wnbaSeasons: wn.seasons,
    calibration: { regular: reg.fit, playoffs: po.fit, wnba: wn.fit },
    counts: { rows: rows.length, bySet },
    rows,
  };
  log(`Quote index: ${rows.length} rows ${JSON.stringify(bySet)} in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  if (write) {
    fs.mkdirSync(GEN_DIR, { recursive: true });
    fs.writeFileSync(QUOTE_FILE, `${JSON.stringify(body)}\n`);
    log(`  ${QUOTE_FILE}`);
  }
  // Never in the file: the calibration pairs, for a probe to study the misses.
  if (debug) body.debug = { regular: regPriced.detail, playoffs: poPriced.detail };
  return body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const arg = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 ? Number(argv[i + 1]) : dflt; };
  main({ first: arg('--from', 1976), last: arg('--to', BASE_SEASON), write: !argv.includes('--dry') });
}
