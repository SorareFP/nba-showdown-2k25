// Fits the BPM equivalent on NBA data and writes it out for the WNBA to use.
//
//   node scripts/cardgen/wnba/fitBpmModel.js
//   node scripts/cardgen/wnba/fitBpmModel.js --force    (re-fetch the tables)
//
// Writes card-data/generated/wnba-bpm-model.json — coefficients, the feature
// list, and the whole validation report, so nobody has to re-run this to find
// out how good the model is or what it was fitted on.
//
// The argument for the approach is in bpmModel.js. This file is the mechanics:
// which seasons, which rows, how they are split, and what gets reported.
//
// ── WHY IT RE-FETCHES TABLES THAT ARE ALREADY CACHED ────────────────────────
//
// card-data/cache/bbref-{season}-advanced-full.json exists for 2000-2026 and
// is NOT usable here. fetchCalibrationData.js's `trimSeasonTable` keeps the
// columns the NBA generators need and drops ORB%, DRB%, TRB%, AST%, STL%,
// BLK%, TOV%, OWS and DWS — most of the feature set. ORtg and DRtg are on the
// per-100 table and were dropped from that trim too. So these go to their own
// cache keys (`bbref-wide-*`) with their own trim, and the existing caches are
// left exactly as they are: they belong to the NBA generators, which are being
// edited concurrently.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, writeCache, politeDelay, DEFAULT_REQUEST_SPACING_MS, REPO_ROOT } from '../cache.js';
import { fetchSeasonTable } from '../sources/basketballReference.js';
import {
  FEATURES,
  FEATURE_SETS,
  GAME_MINUTES,
  centringBasis,
  centredFeatures,
  fitRidge,
  positionGroup,
  predict,
  rSquared,
  rmse,
  RIDGE_LAMBDA,
} from './bpmModel.js';

export const MODEL_FILE = path.join(REPO_ROOT, 'card-data', 'generated', 'wnba-bpm-model.json');

/**
 * The NBA seasons the model is fitted on.
 *
 * Fifteen, ending at the season the current pool comes from. Long enough that
 * no single year's rule changes dominate, short enough that the league it
 * describes still plays roughly the game the WNBA plays now — a 2001 NBA
 * season would contribute a three-point rate neither league has any more.
 * BPM 2.0 is applied retroactively by Basketball-Reference, so the target is
 * one consistent definition across all of them.
 */
export const FIT_SEASONS = Array.from({ length: 15 }, (_, i) => 2012 + i);

/**
 * Seasons held out ENTIRELY, never seen during fitting.
 *
 * Two validations run, and they answer different questions. A random split
 * asks "does this generalise to another player"; a whole-season holdout asks
 * "does it generalise to another CONTEXT" — a league playing at a different
 * pace with a different shot profile from the ones fitted. The second is the
 * closer analogue of what is actually being asked of the model, which is to
 * generalise to a different league altogether, and it is the number to quote.
 */
export const HOLDOUT_SEASONS = [2025, 2026];

/** Minutes a player-season needs to be worth fitting on. */
export const MIN_FIT_MINUTES = 500;

/** The feature set that ships. One line to change; all four are reported. */
export const SHIPPED_FEATURE_SET = 'full';

export const TARGETS = ['bpm', 'obpm', 'dbpm'];

const num = v => {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * The NBA advanced table, trimmed to the WNBA-available columns PLUS the three
 * targets. Deliberately its own trim — see the header.
 */
export function trimAdvanced(rows) {
  return rows.map(r => {
    const c = r.cells;
    return {
      playerId: r.playerId,
      name: r.name,
      team: c.team_name_abbr ?? c.team_id ?? null,
      pos: c.pos ?? null,
      games: num(c.games),
      minutes: num(c.mp),
      per: num(c.per),
      tsPct: num(c.ts_pct),
      fg3aRate: num(c.fg3a_per_fga_pct),
      ftRate: num(c.fta_per_fga_pct),
      orbPct: num(c.orb_pct),
      trbPct: num(c.trb_pct),
      astPct: num(c.ast_pct),
      stlPct: num(c.stl_pct),
      blkPct: num(c.blk_pct),
      tovPct: num(c.tov_pct),
      usgPct: num(c.usg_pct),
      ows: num(c.ows),
      dws: num(c.dws),
      ws: num(c.ws),
      ws48: num(c.ws_per_48),
      // Targets.
      bpm: num(c.bpm),
      obpm: num(c.obpm),
      dbpm: num(c.dbpm),
    };
  });
}

/** The NBA per-100 table, trimmed the same way. ORtg/DRtg live here in the NBA. */
export function trimPerPoss(rows) {
  return rows.map(r => {
    const c = r.cells;
    return {
      playerId: r.playerId,
      team: c.team_name_abbr ?? c.team_id ?? null,
      games: num(c.games),
      efg: num(c.efg_pct),
      offRtg: num(c.off_rtg),
      defRtg: num(c.def_rtg),
      pts100: num(c.pts_per_poss),
      fga100: num(c.fga_per_poss),
      fg3a100: num(c.fg3a_per_poss),
      fta100: num(c.fta_per_poss),
      orb100: num(c.orb_per_poss),
      drb100: num(c.drb_per_poss),
      trb100: num(c.trb_per_poss),
      ast100: num(c.ast_per_poss),
      stl100: num(c.stl_per_poss),
      blk100: num(c.blk_per_poss),
      tov100: num(c.tov_per_poss),
      pf100: num(c.pf_per_poss),
    };
  });
}

/**
 * Returns `{ rows, fetched }` rather than just the rows, so the caller can
 * space out only the requests that actually went to the network. Delaying on
 * `force` alone would fire fifteen seasons back to back on the FIRST run, when
 * nothing is cached and the delay is most needed.
 */
async function wideTable(season, kind, { force }) {
  const key = `bbref-wide-${season}-${kind === 'advanced' ? 'advanced' : 'perposs'}`;
  const hit = force ? null : readCache(key);
  if (hit) return { rows: hit, fetched: false };
  const raw = await fetchSeasonTable(season, kind);
  const rows = kind === 'advanced' ? trimAdvanced(raw) : trimPerPoss(raw);
  writeCache(key, rows, {
    source: 'basketball-reference.com',
    season,
    kind,
    purpose: 'wnba-bpm-fit',
  });
  return { rows, fetched: true };
}

/** One row per player-season, aggregate rows preferred, both tables joined. */
export function joinNbaSeason(season, advanced, perPoss) {
  const rates = new Map(perPoss.map(r => [`${r.playerId}|${r.team}`, r]));
  const best = new Map();
  for (const a of advanced) {
    const prev = best.get(a.playerId);
    if (!prev || (a.games ?? 0) > (prev.games ?? 0)) best.set(a.playerId, a);
  }
  const out = [];
  for (const a of best.values()) {
    const p = rates.get(`${a.playerId}|${a.team}`);
    if (!p) continue;
    out.push(featureRow({ ...a, ...p, season, league: 'nba' }));
  }
  return out;
}

/**
 * The flat shape both leagues normalise into.
 *
 * Everything league-length-dependent is converted here and nowhere else:
 * `wsRate` is per 48 in the NBA and per 40 in the WNBA (see bpmModel.js for why
 * those are the same quantity), and `minShare` divides by that league's own
 * game length.
 */
export function featureRow(r) {
  const gameMinutes = GAME_MINUTES[r.league] ?? 48;
  const minutes = r.minutes ?? 0;
  const games = r.games ?? 0;
  const rate = total =>
    Number.isFinite(total) && minutes > 0 ? (total * gameMinutes) / minutes : null;
  return {
    ...r,
    posGroup: positionGroup(r.pos),
    minShare: games > 0 ? minutes / (games * gameMinutes) : null,
    wsRate: r.wsRate ?? (r.league === 'nba' ? r.ws48 : null) ?? rate(r.ws),
    owsRate: rate(r.ows),
    dwsRate: rate(r.dws),
  };
}

/**
 * A deterministic 0..1 hash of a key — the random split, without a seeded PRNG.
 *
 * The split must be REPRODUCIBLE across runs and machines, because the reported
 * R² is the justification for shipping this at all and a number that moves when
 * you re-run it justifies nothing.
 */
export function splitHash(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export const TEST_SHARE = 0.3;

/**
 * Fits one target on one feature set and scores it on both held-out sets.
 *
 * The centring basis is measured PER SEASON over that season's whole qualified
 * table, training and test alike — it is a property of the league, not of the
 * split, and withholding it from the test rows would be modelling a league
 * whose average nobody knows.
 */
export function fitAndScore({ rows, keys, target, lambda = RIDGE_LAMBDA }) {
  const bySeason = new Map();
  for (const r of rows) {
    if (!bySeason.has(r.season)) bySeason.set(r.season, []);
    bySeason.get(r.season).push(r);
  }
  const design = [];
  for (const [, seasonRows] of bySeason) {
    const basis = centringBasis(seasonRows, keys);
    for (const r of seasonRows) {
      design.push({ row: r, x: centredFeatures(r, basis, keys), y: FEATURES_TARGET(r, target) });
    }
  }

  const usable = design.filter(d => Number.isFinite(d.y));
  const heldSeason = usable.filter(d => HOLDOUT_SEASONS.includes(d.row.season));
  const fittable = usable.filter(d => !HOLDOUT_SEASONS.includes(d.row.season));
  const heldPlayer = fittable.filter(d => splitHash(`${d.row.playerId}`) < TEST_SHARE);
  const train = fittable.filter(d => splitHash(`${d.row.playerId}`) >= TEST_SHARE);

  const model = fitRidge(
    train.map(d => d.x),
    train.map(d => d.y),
    train.map(d => d.row.minutes),
    lambda
  );
  if (!model) return null;

  const score = set => {
    if (set.length === 0) return { n: 0, r2: null, rmse: null };
    const predicted = set.map(d => predict(model, d.x));
    const actual = set.map(d => d.y);
    const w = set.map(d => d.row.minutes);
    return {
      n: set.length,
      r2: Number(rSquared(actual, predicted, w).toFixed(4)),
      rmse: Number(rmse(actual, predicted, w).toFixed(4)),
    };
  };

  return {
    model: { intercept: model.intercept, coef: model.coef },
    inSample: score(train),
    heldOutPlayers: score(heldPlayer),
    heldOutSeasons: score(heldSeason),
  };
}

const FEATURES_TARGET = (row, target) => row[target];

export async function main({ force = false, log = console.log } = {}) {
  const rows = [];
  for (const season of FIT_SEASONS) {
    const advanced = await wideTable(season, 'advanced', { force });
    if (advanced.fetched) await politeDelay(DEFAULT_REQUEST_SPACING_MS);
    const perPoss = await wideTable(season, 'perPoss', { force });
    if (perPoss.fetched) await politeDelay(DEFAULT_REQUEST_SPACING_MS);
    const joined = joinNbaSeason(season, advanced.rows, perPoss.rows).filter(
      r => (r.minutes ?? 0) >= MIN_FIT_MINUTES
    );
    rows.push(...joined);
    log(
      `  ${season}: ${advanced.rows.length} rows -> ${joined.length} over ${MIN_FIT_MINUTES} ` +
        `minutes${advanced.fetched || perPoss.fetched ? '' : ' (cached)'}`
    );
  }
  log(`\n${rows.length} NBA player-seasons, ${FIT_SEASONS[0]}-${FIT_SEASONS.at(-1)}.`);
  log(
    `Held out: every player-season in ${HOLDOUT_SEASONS.join(' and ')} (context holdout), ` +
      `plus ${(100 * TEST_SHARE).toFixed(0)}% of players from the rest (player holdout).`
  );

  const results = {};
  log('\nOUT-OF-SAMPLE R² — the whole justification for the fitted path.');
  log('feature set    target   in-sample   held-out players   held-out SEASONS   rmse(seasons)');
  for (const [setName, keys] of Object.entries(FEATURE_SETS)) {
    results[setName] = {};
    for (const target of TARGETS) {
      const fit = fitAndScore({ rows, keys, target });
      results[setName][target] = fit;
      log(
        `  ${setName.padEnd(13)}${target.padEnd(8)}` +
          `${String(fit.inSample.r2).padStart(10)}` +
          `${String(fit.heldOutPlayers.r2).padStart(19)}` +
          `${String(fit.heldOutSeasons.r2).padStart(19)}` +
          `${String(fit.heldOutSeasons.rmse).padStart(15)}`
      );
    }
  }

  // A λ sweep, so the penalty is a reported choice rather than a magic number.
  //
  // The out-of-sample R² is not the only thing being read off this. `|coef|`
  // is the sum of absolute RAW coefficients, and it is the transfer-risk
  // column: a near-singular design (trb100 is orb100 plus drb100 to within a
  // rounding decimal; ws is ows plus dws the same way) lets an unpenalised fit
  // reach a better NBA score with enormous cancelling coefficients. Those
  // cancel reliably inside the league they were fitted on. Carrying them to a
  // different league is exactly where that stops being safe, which is why the
  // shipped λ is not simply the sweep's argmax.
  log(`\nRidge λ sweep on ${SHIPPED_FEATURE_SET} / bpm:`);
  log('  λ        held-out seasons R²   held-out players R²   sum |raw coef|');
  const sweep = {};
  for (const lambda of [0, 0.01, 0.1, 0.3, 1, 3, 10, 100]) {
    const fit = fitAndScore({ rows, keys: FEATURE_SETS[SHIPPED_FEATURE_SET], target: 'bpm', lambda });
    const size = fit ? fit.model.coef.reduce((s, c) => s + Math.abs(c), 0) : null;
    sweep[lambda] = { r2: fit?.heldOutSeasons.r2 ?? null, coefL1: size == null ? null : Number(size.toFixed(1)) };
    log(
      `  ${String(lambda).padEnd(9)}${String(sweep[lambda].r2).padStart(19)}` +
        `${String(fit?.heldOutPlayers.r2).padStart(22)}${String(sweep[lambda].coefL1).padStart(17)}`
    );
  }

  // What each ingredient is worth, in R² on the held-out seasons. This is the
  // honest accounting the report is supposed to carry.
  const r2 = (set, target) => results[set][target].heldOutSeasons.r2;
  log('\nWHAT EACH INGREDIENT IS WORTH (held-out seasons R² on bpm):');
  log(
    `  team context (ORtg/DRtg on top of a bare box score): ${r2('boxScore', 'bpm')} -> ` +
      `${r2('boxScoreTeam', 'bpm')}  (+${(r2('boxScoreTeam', 'bpm') - r2('boxScore', 'bpm')).toFixed(4)})`
  );
  log(
    `  Win Shares (added to everything else): ${r2('noWinShares', 'bpm')} -> ${r2('full', 'bpm')}` +
      `  (+${(r2('full', 'bpm') - r2('noWinShares', 'bpm')).toFixed(4)})`
  );
  for (const t of ['obpm', 'dbpm']) {
    log(
      `    same for ${t}: ${r2('noWinShares', t)} -> ${r2('full', t)}` +
        `  (+${(r2('full', t) - r2('noWinShares', t)).toFixed(4)})`
    );
  }
  log(
    `  the fitted model over the user's PER+WS fallback: ${r2('perWinShares', 'bpm')} -> ` +
      `${r2('full', 'bpm')}`
  );

  const keys = FEATURE_SETS[SHIPPED_FEATURE_SET];
  const shipped = results[SHIPPED_FEATURE_SET];
  const model = {
    generatedAt: new Date().toISOString(),
    what:
      'A BPM/OBPM/DBPM equivalent for the WNBA. Fitted on NBA player-seasons using ONLY the ' +
      "inputs Basketball-Reference's WNBA season tables also carry, with every input expressed " +
      'as a deviation from its own league-season minutes-weighted mean. See ' +
      'scripts/cardgen/wnba/bpmModel.js for what real BPM uses that this cannot, and for the ' +
      'league-context assumption the transfer rests on.',
    fittedOn: {
      league: 'nba',
      seasons: FIT_SEASONS,
      playerSeasons: rows.length,
      minMinutes: MIN_FIT_MINUTES,
      weight: 'minutes',
      ridgeLambda: RIDGE_LAMBDA,
    },
    validation: {
      heldOutSeasons: HOLDOUT_SEASONS,
      heldOutPlayerShare: TEST_SHARE,
      lambdaSweep: sweep,
      byFeatureSet: Object.fromEntries(
        Object.entries(results).map(([set, byTarget]) => [
          set,
          Object.fromEntries(
            Object.entries(byTarget).map(([t, f]) => [
              t,
              { inSample: f.inSample, heldOutPlayers: f.heldOutPlayers, heldOutSeasons: f.heldOutSeasons },
            ])
          ),
        ])
      ),
    },
    featureSet: SHIPPED_FEATURE_SET,
    features: keys,
    // What real BPM uses and this cannot. Machine-readable so it survives.
    missingVsRealBpm: [
      'the team adjustment (BPM forces a team\'s players to sum to its efficiency margin); proxied only by the player\'s own ORtg/DRtg',
      'DRB% as a percentage — the WNBA advanced page carries ORB% and TRB% only; defensive rebounds enter as drb100 = trb100 - orb100 instead',
      "Basketball-Reference's own estimated position and offensive role; only the listed position is available, and it is collapsed to G/F/C on both sides because the WNBA lists no more than that",
    ],
    targets: Object.fromEntries(
      TARGETS.map(t => [
        t,
        {
          intercept: shipped[t].model.intercept,
          coef: shipped[t].model.coef,
          heldOutSeasonsR2: shipped[t].heldOutSeasons.r2,
          heldOutPlayersR2: shipped[t].heldOutPlayers.r2,
        },
      ])
    ),
  };

  fs.mkdirSync(path.dirname(MODEL_FILE), { recursive: true });
  fs.writeFileSync(MODEL_FILE, `${JSON.stringify(model, null, 1)}\n`);
  log(`\nWrote ${path.relative(REPO_ROOT, MODEL_FILE)} (${SHIPPED_FEATURE_SET} feature set).`);

  log('\nThe shipped model, biggest coefficients first (raw units, per unit of the centred input):');
  const named = keys
    .map((k, i) => ({ k, c: shipped.bpm.model.coef[i] }))
    .sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
  for (const { k, c } of named.slice(0, 12)) log(`  ${k.padEnd(12)}${c.toFixed(4)}`);
  return model;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main({ force: process.argv.includes('--force') }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
