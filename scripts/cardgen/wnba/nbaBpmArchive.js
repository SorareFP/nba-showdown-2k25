// THE NBA SIDE OF THE WNBA EQUALIZATION — a BPM-equivalent archive.
//
//   node scripts/cardgen/wnba/nbaBpmArchive.js
//
// Writes card-data/generated/nba-bpm-archive.json, which is COMMITTED and is
// what puts a WNBA card on the same Speed+Power scale as an NBA one.
//
// ── THE INSTRUCTION, AND EXACTLY WHAT IT COMMITS TO ─────────────────────────
//
// The user's words: "the WNBA players should just be equalized to players in
// that dataset by BPM."
//
// "That dataset" is the 2002-2026 EPM archive every other set is now priced
// against (scripts/cardgen/epmArchive.js). The WNBA cannot join it directly:
// EPM is an NBA product, dunksandthrees has no WNBA endpoint, and nothing
// resembling a possession-level plus/minus is published for the league. What
// does exist is scripts/cardgen/wnba/bpmModel.js — a BPM equivalent fitted on
// NBA player-seasons using only the columns Basketball-Reference's WNBA tables
// also carry, out-of-sample R² 0.945 on BPM.
//
// So BPM is the bridge, and this file is the NBA end of it: every cardable NBA
// player-season 2012-2026, rated BY THAT SAME FITTED MODEL, with the same
// composite shape the EPM side uses.
//
//     composite = z(BPM-hat) + 0.35 * z(VORP-per-game-hat)
//
// A WNBA player's composite is then z-scored against THIS distribution and
// pushed through the same `mapToReferenceScale` the NBA sets use, so she lands
// at the Speed+Power number an NBA player at the same position of the same
// distribution lands at.
//
// SAY PLAINLY WHAT THAT ASSUMES, because the data does not establish it. This
// places a WNBA player at the NBA-scale position of an NBA player WITH THE SAME
// BOX-SCORE PROFILE, each measured against her or his own league. It is a
// statement that dominating the WNBA by some margin is worth the same card as
// dominating the NBA by that margin. Nothing in any published data settles
// whether that is the right cross-league equivalence — the two leagues have
// never played each other — and this pipeline does not pretend it does. It is
// the design decision the user made, implemented exactly, and the alternative
// (a league-strength offset applied to one side) would be a different decision
// with just as little evidence behind it.
//
// ── WHY BOTH SIDES ARE PREDICTED, NEVER REAL BPM ────────────────────────────
//
// The NBA rows here are rated with the fitted model even though their REAL BPM
// is sitting in the same table. That is not laziness, it is the validity of the
// comparison: a fitted value is compressed toward the mean relative to the
// quantity it predicts, so scoring one league on real BPM and the other on
// predicted BPM would hand the WNBA a systematically narrower spread and a
// middle-heavy set. Both sides are predicted, so both are compressed
// identically and the compression cancels.
//
// ── WHY THE WINDOW IS 2012-2026 AND NOT 2002-2026 ───────────────────────────
//
// The model's inputs include per-possession columns Basketball-Reference only
// publishes in the "wide" season tables this repo caches from 2012 (see
// FIT_SEASONS in fitBpmModel.js — the same fifteen seasons the model was
// fitted on). Extending the window would mean fitting a second model on a
// smaller feature set, which trades a real loss in fit for a cosmetic gain in
// span.
//
// MEASURED, so the mismatch is a number rather than a worry: over the same
// window the predicted-BPM composite and the EPM composite land within 0.25 of
// each other at every decile and within 0.25 at the 99th percentile
// (p99 4.38 vs 4.29, p99.9 5.88 vs 5.47, max 6.50 vs 6.27), and they correlate
// 0.917 across the 4,717 player-seasons in both. Against the FULL 2002-2026 EPM
// archive the same quantiles are 4.12 / 5.48 / 6.27, so the 2012-2026 window
// runs a shade top-heavy — about a tenth of a Speed+Power point at the very top,
// and nothing at all below the 90th percentile.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from '../cache.js';
import { meanSd } from '../attributes.js';
import { POOL_RULE } from '../generatePool.js';
import { REFINEMENT_WEIGHT } from '../epmArchive.js';
import { applyModel } from './bpmModel.js';
import { FIT_SEASONS, MODEL_FILE, joinNbaSeason } from './fitBpmModel.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const ARCHIVE_FILE = path.join(GEN_DIR, 'nba-bpm-archive.json');

/** The seasons the fitted model can be applied to. See the header. */
export const ARCHIVE_SEASONS = FIT_SEASONS;

/** The same rule the EPM archive and the pool use, for the same reason. */
export const ARCHIVE_RULE = POOL_RULE;

/** An NBA game, in minutes — the denominator VORP-per-game divides by. */
export const NBA_GAME_MINUTES = 48;

/**
 * Replacement level, in BPM units. Basketball-Reference's own definition, and
 * therefore the point VORP is zero at.
 *
 * Duplicated from generateWnbaCards.js rather than imported, because importing
 * it would make this module depend on the generator that depends on it.
 */
export const REPLACEMENT_BPM = -2.0;

/** Value above replacement times time on the floor. Mirrors generateWnbaCards.js. */
export function vorpPerGame(bpm, { minutes, games }, gameMinutes = NBA_GAME_MINUTES) {
  if (!Number.isFinite(bpm) || !(games > 0) || !(minutes > 0)) return null;
  return (bpm - REPLACEMENT_BPM) * (minutes / games / gameMinutes);
}

/**
 * One season's whole league table, rated by the fitted model.
 *
 * CENTRED ON THE WHOLE TABLE, not on the cardable subset: the model's features
 * are deviations from a LEAGUE-SEASON mean, so the mean has to be the league's.
 * Returns null when that season's tables are not cached.
 */
export function ratedSeason(model, season) {
  const advanced = readCache(`bbref-wide-${season}-advanced`);
  const perPoss = readCache(`bbref-wide-${season}-perposs`);
  if (!advanced || !perPoss) return null;
  const league = joinNbaSeason(season, advanced, perPoss);
  const hats = applyModel({ features: model.features, targets: model.targets }, league);
  return league.map((row, i) => ({
    name: row.name,
    season,
    games: row.games ?? 0,
    minutes: row.minutes ?? 0,
    mpg: (row.games ?? 0) > 0 ? row.minutes / row.games : 0,
    bpmHat: hats[i].bpm,
    realBpm: row.bpm ?? null,
    vorpPerGameHat: vorpPerGame(hats[i].bpm, row),
  }));
}

/** The rule, as a predicate. Mirrors epmArchive.isCardable. */
export function isCardable(row, rule = ARCHIVE_RULE) {
  return (
    !!row &&
    row.mpg >= rule.minMpg &&
    row.games >= rule.minGames &&
    Number.isFinite(row.bpmHat) &&
    Number.isFinite(row.vorpPerGameHat)
  );
}

/** The composite, from an explicit basis. Same shape as the EPM side's. */
export function compositeFrom(row, basis, weight = REFINEMENT_WEIGHT) {
  const z = (v, s) => (Number.isFinite(v) && s?.sd > 0 ? (v - s.mean) / s.sd : 0);
  return z(row.bpmHat, basis.bpm) + weight * z(row.vorpPerGameHat, basis.vorpPerGame);
}

export function measureArchive(rows, { weight = REFINEMENT_WEIGHT, rule = ARCHIVE_RULE } = {}) {
  const cardable = (rows ?? []).filter(r => isCardable(r, rule));
  const basis = {
    bpm: meanSd(cardable.map(r => r.bpmHat)),
    vorpPerGame: meanSd(cardable.map(r => r.vorpPerGameHat)),
  };
  const scored = cardable.map(r => ({ row: r, composite: compositeFrom(r, basis, weight) }));
  const composites = scored.map(s => s.composite).sort((a, b) => a - b);
  const stats = meanSd(composites);
  return {
    rule,
    weight,
    seasons: [...new Set(cardable.map(r => r.season))].sort((a, b) => a - b),
    n: cardable.length,
    bpm: { mean: Number(basis.bpm.mean.toFixed(6)), sd: Number(basis.bpm.sd.toFixed(6)) },
    vorpPerGame: {
      mean: Number(basis.vorpPerGame.mean.toFixed(6)),
      sd: Number(basis.vorpPerGame.sd.toFixed(6)),
    },
    composite: { mean: Number(stats.mean.toFixed(6)), sd: Number(stats.sd.toFixed(6)) },
    top: scored
      .slice()
      .sort((a, b) => b.composite - a.composite)
      .slice(0, 25)
      .map(s => ({
        name: s.row.name,
        season: s.row.season,
        bpmHat: Number(s.row.bpmHat.toFixed(2)),
        realBpm: s.row.realBpm,
        composite: Number(s.composite.toFixed(4)),
      })),
    composites: composites.map(c => Number(c.toFixed(4))),
  };
}

export function loadArchive(file = ARCHIVE_FILE) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function requireArchive(file = ARCHIVE_FILE) {
  const archive = loadArchive(file);
  if (archive) return archive;
  throw new Error(
    `No NBA BPM-equivalent archive at ${path.relative(REPO_ROOT, file)}. Run \`node ` +
      'scripts/cardgen/wnba/nbaBpmArchive.js\` to build it. It is a committed file, so this ' +
      'should only happen mid-rebuild.'
  );
}

/** The input basis in the shape `compositeFrom` wants. */
export const archiveBasis = archive => ({ bpm: archive.bpm, vorpPerGame: archive.vorpPerGame });

export function main({ log = console.log } = {}) {
  const model = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
  const rows = [];
  const missing = [];
  for (const season of ARCHIVE_SEASONS) {
    const rated = ratedSeason(model, season);
    if (!rated) {
      missing.push(season);
      continue;
    }
    rows.push(...rated);
  }
  if (rows.length === 0) {
    throw new Error(
      'No cached bbref-wide tables. Run `node scripts/cardgen/wnba/fitBpmModel.js` first.'
    );
  }
  if (missing.length) log(`  ⚠ no cached wide table for ${missing.join(', ')}`);

  const archive = measureArchive(rows);
  const { composites, ...rest } = archive;
  const body = JSON.stringify(
    { generatedAt: new Date().toISOString(), ...rest, composites: '@@COMPOSITES@@' },
    null,
    1
  );
  fs.writeFileSync(ARCHIVE_FILE, `${body.replace('"@@COMPOSITES@@"', JSON.stringify(composites))}\n`);

  log(
    `${archive.n} cardable NBA player-seasons (${archive.seasons[0]}-` +
      `${archive.seasons[archive.seasons.length - 1]}, MPG>=${archive.rule.minMpg} & ` +
      `G>=${archive.rule.minGames}) of ${rows.length} rated -> ` +
      `${path.relative(REPO_ROOT, ARCHIVE_FILE)}`
  );
  log(
    `  BPM-hat mean ${archive.bpm.mean.toFixed(3)} sd ${archive.bpm.sd.toFixed(3)} | ` +
      `VORP/GP-hat mean ${archive.vorpPerGame.mean.toFixed(3)} sd ${archive.vorpPerGame.sd.toFixed(3)}`
  );
  log(`  composite mean ${archive.composite.mean.toFixed(4)} sd ${archive.composite.sd.toFixed(4)}`);
  log('  the ten best seasons the model sees:');
  for (const t of archive.top.slice(0, 10)) {
    log(
      `    ${t.composite.toFixed(3).padStart(6)}  ${t.season} ${t.name.padEnd(24)} ` +
        `BPM-hat ${String(t.bpmHat).padStart(5)} (real ${t.realBpm})`
    );
  }
  return archive;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
