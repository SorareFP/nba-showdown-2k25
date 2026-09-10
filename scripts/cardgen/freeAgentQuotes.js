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
import { SUPER_SEASON_MIN_SALARY } from '../../src/cards/badges.js';
import { seasonDistribution } from './fetchHistory.js';
import { rookieSeasonCounts, REPLACEMENT_EPM } from './generateSpecialSets.js';
import { buildApiEpmIndex, buildBpmBridge, playoffSeason } from './summerStandouts.js';
import { archiveBasis, requireArchive } from './epmArchive.js';
import { priceCandidates } from './teamRewardCandidates.js';
import { NEVER_CARD } from './generateTeamRewards.js';
import * as A from './attributes.js';
import { CARD_SETS } from '../../src/game/cardSets.js';
import { loadArchive as loadWnbaArchive, rateArchive as rateWnbaArchive, careerOf as wnbaCareerOf } from './wnba/generateWnbaLegends.js';
import { bestLegendSeason } from './wnba/legends.js';
import { wnbaRookieSeasonCounts } from './wnba/generateWnbaRookies.js';
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
 * The seasons a debut cannot be PROVEN in: the first of every contiguous run
 * the archive holds. 1976 opens the archive, and 1985 follows the 1978-84
 * gap, so a player first seen there may have debuted unseen.
 */
export function unprovableDebutSeasons(seasons) {
  const have = new Set(seasons);
  return new Set(seasons.filter(s => !have.has(s - 1)));
}

/**
 * Which set a requested REGULAR season lands in, by the rules the existing
 * sets use. Rookie outranks Super Season, as it does on the badges.
 *
 * `career` is careerSeasons() for the player; `distributions` maps season to
 * seasonDistribution(); `unprovable` comes from unprovableDebutSeasons().
 */
export function classifySeason(career, season, { distributions, unprovable = new Set() }) {
  const first = career[0];
  if (first && first.season === season && !unprovable.has(first.season) && rookieSeasonCounts(first)) {
    return 'rookie';
  }
  const { best, eligibility } = bestSeason(career, distributions);
  if (best && best.season === season && eligibility !== 'none') return 'super-season';
  return 'throwbacks';
}

/**
 * THE TWIN RULE, the shipped sets' own (generateSpecialSets' same-season
 * twins; the user, 2026-09-06: "If it qualifies as a super season, leave it a
 * super season ... If it's just a best season like Wells, make it a rookie
 * card"). A rookie year that is also the career's best stays SUPER SEASON only
 * if it would print gold: a trusted season at SUPER_SEASON_MIN_SALARY or more.
 * Settled after pricing, because gold is a salary line.
 */
export function settleTwin(set, { alsoBest, trusted, salary }, { rookie = 'rookie', best = 'super-season' } = {}) {
  if (set === rookie && alsoBest && trusted && salary >= SUPER_SEASON_MIN_SALARY) return best;
  return set;
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

/** Where a requested WNBA season lands: the WNBA sets' twins of the NBA three. */
export const WNBA_SETS = { rookie: 'wnba-rookie', best: 'wnba-super-season', other: 'wnba-throwbacks' };

/** The WNBA salary fit's inputs, from one rated season and its league's bpmHat spread. */
export function wnbaFeatures(row, distribution) {
  const mpg = (row.minutes ?? 0) / Math.max(row.games ?? 1, 1);
  const z = distribution?.sd > 0 ? (row.bpmHat - distribution.mean) / distribution.sd : 0;
  return [
    z, row.obpmHat ?? 0, mpg, z * Math.min(mpg, 34),
    row.pts100 ?? 0, row.trb100 ?? 0, row.ast100 ?? 0, row.usgPct ?? 0, row.tsPct ?? 0, row.stl100 ?? 0, row.blk100 ?? 0,
  ];
}

/**
 * Which WNBA set a requested season lands in, the NBA order: a rookie year
 * first, then the career's best season, then Throwbacks. A rookie year that
 * is also her best goes gold through settleTwin, as a legend's does in the
 * shipped set (buildWnbaCards: "one gold card wearing the rookie pill too").
 */
export function classifyWnbaSeason(career, season) {
  const first = career[0];
  if (first && first.season === season && wnbaRookieSeasonCounts(first)) return WNBA_SETS.rookie;
  const { best, eligibility } = bestLegendSeason(career);
  if (best && best.season === season && eligibility !== 'none') return WNBA_SETS.best;
  return WNBA_SETS.other;
}

/** Every uncarded WNBA season worth a card, quoted by the ridge fit. */
export function wnbaQuotes({ carded, log = console.log } = {}) {
  const model = JSON.parse(fs.readFileSync(WNBA_MODEL_FILE, 'utf8'));
  const seasons = rateWnbaArchive(loadWnbaArchive().loaded, model);
  const targets = realLogTargets(['wnba', 'wnba-super-season', 'wnba-rookie', 'wnba-team-rewards']);
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
        playerId, line, features, set: classifyWnbaSeason(career, line.season),
        // For the twin rule: her best season, and one that met the WNBA
        // Super Season floors (70% of the schedule, 20 minutes a game).
        alsoBest: top.best?.season === line.season && top.eligibility !== 'none',
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

export function main({ first = 1976, last = BASE_SEASON, write = true, wnba = true, log = console.log } = {}) {
  const t0 = Date.now();
  const { seasons, advanced, perPoss, shooting } = loadArchiveTables({ first, last });
  const unprovable = unprovableDebutSeasons(seasons);
  const distributions = {};
  for (const s of seasons) distributions[s] = seasonDistribution(advanced.filter(r => r.season === s));
  const careers = new Map();
  for (const r of advanced) (careers.get(r.playerId) ?? careers.set(r.playerId, []).get(r.playerId)).push(r);
  const carded = cardedIndex(CARD_SETS);
  const targets = realLogTargets(['super-season', 'rookie', 'team-rewards', 'summer-standouts']);
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
        set: classifySeason(career, line.season, { distributions, unprovable }),
        // For the twin rule: the career's best, in a season the gold line trusts.
        alsoBest: top.best?.season === line.season && top.eligibility !== 'none',
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
    batch.forEach((c, i) => { if (c.target != null) pairs.push([priced[i].salary, c.target]); });
    const fit = fitLine(pairs);
    log(`  ${label}: priced ${batch.length} in ${((Date.now() - t) / 1000).toFixed(1)}s; own fit ${describe(fit)}`);
    return { batch, priced, fit };
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
  return body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const arg = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 ? Number(argv[i + 1]) : dflt; };
  main({ first: arg('--from', 1976), last: arg('--to', BASE_SEASON), write: !argv.includes('--dry') });
}
