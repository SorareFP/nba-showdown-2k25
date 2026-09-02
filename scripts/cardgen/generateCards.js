// Builds the whole 2026-27 card set: every stat on every card, for all 350
// players in the pool.
//
//   node scripts/cardgen/generateCards.js
//
// Writes card-data/generated/cards-2026-27.json, which the studio picks up
// automatically. Needs no network — the stat snapshot is in card-data/cache/ and
// the fitted parameters are in card-data/generated/card-calibration.json, both
// committed. Re-run scripts/cardgen/fetchCalibrationData.js to refresh the
// snapshot and scripts/cardgen/calibrateAttributes.js to refit.
//
// EVERY VALUE IT PRODUCES IS PROVISIONAL, and the file says so on every record.
// The layers come from different places and are of different qualities, which is
// worth knowing before trusting any single number:
//
// "THE ACTUAL SEASON" below means the regular season AND THE PLAYOFFS, folded
// into a single sample per player by scripts/cardgen/poolSeasons.js — each stat
// weighted by the volume it is actually a rate over, so those games count as
// additional data rather than as a second set to average against. A player whose
// team missed the playoffs keeps his regular-season figures exactly.
//
// AND FOR NINETEEN PLAYERS IT MEANS 2024-25 TOO. The force-include list puts
// eighteen injury-shortened stars and Ty Jerome in the pool despite the G>=40
// rule, and several of them played under twenty games; their previous season is
// folded in by the same volume weighting
// (scripts/cardgen/priorSeasonBlend.js). WHICH LAYERS THAT REACHES, exactly:
// the Speed/Power budget, the shooting three and Def Boost, all of which read
// the actual row. NOT the scoring chart, which reads the PREDICTED per-100
// leaderboard — and that is the right place for it to stop rather than an
// oversight, because those rates are dunksandthrees' own stabilized estimates,
// already regressed toward a prior for exactly the small samples in question.
//
//   Speed / Power   From the ACTUAL season's OFF / DEF / EPM / EW-per-game
//                   (scripts/cardgen/speedPower.js), mapped onto the finished
//                   set's own distribution by magnitude. All that happens here
//                   is the positional split from
//                   memory/speed_power_methodology.md, using shares measured off
//                   the finished cards.
//
//   Shooting        From the ACTUAL season's TS%, rim FG% and 3P%, by the rule
//                   in scripts/cardgen/shooting.js: a player misses at his real
//                   miss rate, compressed onto the range the finished cards
//                   occupy. This is the layer that changed most — it used to be
//                   a regression against those cards.
//
//   Def Boost       The ACTUAL season's DEF EPM, rounded. The user's own
//                   recorded proposal, followed literally.
//
//   Scoring chart   THE ONE THING STILL ON PREDICTED DATA, and the weakest
//                   layer. A chart needs per-100 PTS / REB / AST, and the actual
//                   page reports rebounds and assists as rate percentages that
//                   cannot be inverted without team and opponent totals. (Points
//                   alone could be recovered — TS% is defined as
//                   PTS / (2 * (FGA + 0.44 * FTA)) and both attempt rates are on
//                   the page — but a chart built from actual points and
//                   predicted rebounds would be worse than one built
//                   consistently.) A real per-game distribution is not available
//                   for this pool either, so the spread comes from a fitted
//                   model of 30 real game logs and the size from the finished
//                   card set; the band logic itself is the untouched, validated
//                   computeStatBands.
//
//   Salary          Prices the FINISHED card by WHAT IT PRODUCES IN PLAY
//                   (scripts/cardgen/playValue.js) rather than by a linear fit
//                   on its attributes, so it moves whenever any of the above
//                   does AND responds to chart shape, which the old fit could
//                   not see: Speed+Power moved the old price across 1094 points
//                   and chart expected points across 32. Measured against the
//                   whole field through the engine's own matchup rule, then
//                   expressed on the finished 2025-26 set's salary mean and
//                   spread so the 5500 cap keeps its meaning.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { computeStatBands, delayUpperBands, effectiveRollCdf, placeBandsOnCdf, usageAccessShift } from './bands.js';
import { reconcileBandsByRoll, shapeChart, MAX_CHART_TIERS, MAX_PRINTED_ROWS } from './generate.js';
import { isBlankTier } from './zeroFloor.js';
import { applyOverrides } from './overrides.js';
import * as V from './variance.js';
import * as A from './attributes.js';
import * as PV from './playValue.js';
import * as S from './shooting.js';
import { poolingSummary } from './poolSeasons.js';
import { indexBiometrics, loadBiometrics } from './biometrics.js';
import { loadAllRealGames } from './realGames.js';
import * as ARCH from './archetypes.js';
import { readBlendedActual, reportBlend, PRIOR_STATS_SEASON } from './priorSeasonBlend.js';
import { trb100 } from './sources/dunksAndThrees.js';
import { CALIBRATION_FILE } from './calibrateAttributes.js';
import { CURRENT_STATS_SEASON } from './fetchCalibrationData.js';
import { indexPositionShares, loadPositionShares } from './positionShares.js';
import { readCarryForward, resolveCarryForward, buildCarryForwardCards } from './carryForward.js';
import { buildSet, resolvePlayerIds } from './generateSpecialSets.js';
import { playerIdFromName } from '../../src/cards/playerId.js';
import { calcAdv } from '../../src/game/engine.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, 'cards-2026-27.json');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * Cut chart bands on each card's own EFFECTIVE roll distribution rather than on
 * a bare d20. Measured, built, and not yet finished — see the note at the call
 * site for the two steps that still fight it.
 */
export const CDF_BANDS = process.env.CDF_BANDS !== '0';

/**
 * Names the stat source spells differently from the pool.
 *
 * Kept as an explicit list rather than a fuzzy matcher: a fuzzy match that is
 * wrong gives a player somebody else's stat line, and nothing downstream would
 * ever notice. One entry today.
 */
export const STAT_NAME_ALIASES = {
  // dunksandthrees lists Detroit's rookie under his full legal name.
  'Ron Holland': 'Ronald Holland II',
};

export function indexByName(rows, keyOf = r => r.name) {
  const m = new Map();
  for (const r of rows ?? []) {
    const k = normalizeName(keyOf(r));
    const prev = m.get(k);
    if (!prev || (r.games ?? 0) > (prev.games ?? 0)) m.set(k, r);
  }
  return m;
}

const lookup = (index, name) =>
  index.get(normalizeName(STAT_NAME_ALIASES[name] ?? name)) ?? index.get(normalizeName(name)) ?? null;

/**
 * The shooting inputs for one player, from his ACTUAL season row.
 *
 * Rim FG% is the paint signal — the location the Paint Boost is about — rather
 * than overall 2P%, which blends the rim with the midrange and so understates
 * exactly the players the boost exists to mark. `attemptsFromPer75` reconstructs
 * the volume behind each percentage, which gates how far it is trusted.
 *
 * `rate` is a POOLED row (regular season plus playoffs), and that is what makes
 * the volume gate behave correctly across the fold: the attempt rate is
 * possession-weighted and `minutes` is a pooled total, so their product is
 * exactly regular-season attempts plus playoff attempts. A player with a deep
 * run therefore arrives at the shrinkage with a genuinely larger sample and is
 * shrunk less — pooled before shrinking, not after. See poolSeasons.js.
 */
export function actualShootingInput(rate) {
  return {
    tsPct: rate?.tsPct ?? null,
    paintPct: rate?.fgPctRim ?? null,
    threePct: rate?.fgPct3 ?? null,
    paintAttempts: S.attemptsFromPer75(rate?.fgaRimPer75, rate?.minutes),
    threeAttempts: S.attemptsFromPer75(rate?.fga3Per75, rate?.minutes),
    // Per 100 possessions, the signal for WHETHER HE SHOOTS AT ALL — see the
    // volume prior in fitShrinkage. per-75 to per-100 is * 100/75.
    threeRate: (rate?.fga3Per75 ?? 0) * (100 / 75),
  };
}

/**
 * Builds one card.
 *
 * The shooting values arrive already computed, because the rule that produces
 * them is pool-relative and cannot be evaluated one player at a time — see
 * generateCards below. SALARY is now pool-relative too, and for the same kind
 * of reason: it prices the finished card (design philosophy point 8) by what
 * that card produces against a field, so it is filled in by generateCards after
 * every card exists rather than here.
 */
export function buildCard({
  player,
  rate,
  actual,
  shooting,
  speedPowerTotal,
  size,
  positionShares,
  calibration,
  rollCdf = null,
  // Real last-82 game-log rows ({minutes, pts, reb, ast}, already opponent-
  // adjusted and minutes-damped by realGames.js). When present they replace
  // the synthetic distribution entirely; everything downstream — band cuts,
  // CDF placement, usage gate, spine reconciliation, shot-line shaping — is
  // identical. Null falls back to the provisional synthesis.
  realGames = null,
  // Archetype shaping (archetypes.js): when true, the speed/power split
  // exaggerates away from balance along its existing lean — the override
  // group's attackable hole. The budget change arrives via speedPowerTotal.
  exaggerateSplit = false,
}) {
  const per100 = {
    pts: rate?.pts100 ?? 0,
    reb: rate ? trb100(rate) : 0,
    ast: rate?.ast100 ?? 0,
  };
  // The positional MIX sets the centre of the split and SIZE bends it away from
  // that centre — see A.SPLIT_RULE for which of the four statements of this rule
  // is active, and why it is not the best-fitting one. Both inputs are optional
  // and independent: a player the biometric table or the play-by-play table does
  // not carry falls back a step rather than being dropped.
  let { speed, power } = A.splitFromCalibration(speedPowerTotal, {
    pos: player.pos,
    size,
    positionShares,
    calibration,
  });
  if (exaggerateSplit) {
    ({ speed, power } = ARCH.exaggerateSplit(speed, power));
  }

  const { shotLine, paintBoost, threePtBoost } = shooting;
  const defBoost = A.defBoostFromEpm(actual?.epmDef);

  // Each stat gets its own corrected level (see fitChartLevel), so the three
  // columns are synthesized separately and then reconciled onto one spine.
  //
  // `rollCdf` is this card's OWN distribution of effective rolls, and it is
  // what stops a band cut as a 5% event being reached 45% of the time. It can
  // be computed here because the roll bonus depends only on Speed, Power and
  // Def Boost, all of which are settled before a chart is cut.
  const bands = {};
  for (const stat of V.CHART_STATS) {
    const fit = { level: calibration.chart.levels[stat], shape: calibration.chart.shape };
    const games = realGames ?? V.synthesizeGames({
      per100: { [stat]: per100[stat] },
      mpg: player.mpg,
      games: player.games,
      fit,
      // The shot profile, for the points event model. Rebounds and assists need
      // none of it — their event is worth exactly one.
      mix: rate
        ? {
            fga2: rate.fga2Per100,
            fga3: rate.fga3Per100,
            fta: rate.ftaPer100,
            pct2: rate.fgPct2,
            pct3: rate.fgPct3,
            pctFt: rate.ftPct,
          }
        : null,
    });
    const placed = rollCdf
      ? placeBandsOnCdf(computeStatBands(games, stat), rollCdf)
      : computeStatBands(games, stat);
    // The usage gate touches the SCORING spine only. Boards and assists never
    // needed the ball; reconcileBandsByRoll reads them at their own ungated
    // positions, so the variance the gate would have dragged along survives.
    bands[stat] = stat === 'pts' ? delayUpperBands(placed, usageAccessShift(rate?.usage)) : placed;
  }
  // The shot line is an INPUT to the chart's shape, not just a number printed
  // beside it: the chart is made to break exactly there so the card's one arrow
  // has a real dividing line to sit on. See forceBandBoundary.
  const chart = shapeChart(reconcileBandsByRoll(bands), {
    shotLine,
    // CDF placement already prices the ceiling at its earned frequency; the
    // fixed +2 delay on top of that would punish it twice.
    ceilingDelay: rollCdf ? 0 : undefined,
  });

  const card = {
    id: playerIdFromName(player.name),
    name: player.name,
    team: player.team,
    pos: player.pos,
    speed,
    power,
    shotLine,
    paintBoost,
    threePtBoost,
    defBoost,
    salary: null,
    // The top tier is open-ended, matching src/game/rawCards.js's convention and
    // what CardTemplate's formatRollRange renders as "20+".
    chart: chart.map((t, i) => ({
      lo: t.lo,
      hi: i === chart.length - 1 ? 99 : t.hi,
      pts: t.pts,
      reb: t.reb,
      ast: t.ast,
    })),
    // A chart cut from real game logs is no longer provisional — that flag
    // has always meant "synthetic distribution stands in for real games".
    provisional: !realGames,
  };

  // Salary is deliberately NOT set here. It used to be, and could be, while the
  // price was a linear function of this card's own eight features. Play value is
  // measured against a FIELD, so it cannot be known until every card exists —
  // `generateCards` fills it in as a post-pass. Leaving it null rather than
  // guessing means a card that somehow escapes that pass is obviously broken
  // instead of quietly cheap.
  return card;
}

/** Expected value per face of a d20, the measure the finished set is priced on. */
export function expectedValuePerRoll(chart, stat, faces = 20) {
  let total = 0;
  for (let roll = 1; roll <= faces; roll += 1) {
    const tier = chart.find(t => roll >= t.lo && roll <= t.hi);
    total += tier?.[stat] ?? 0;
  }
  return total / faces;
}

export function generateCards({
  pool: poolPlayers,
  teams,
  speedPower,
  rates,
  actual,
  calibration,
  // Name -> { inches, weight }. Absent for a checkout that has not built
  // card-data/generated/player-biometrics.json, and every split falls back to
  // position alone.
  biometrics = new Map(),
  // Name -> the five positional shares for the current season. Absent for a
  // checkout that has not built card-data/generated/position-shares.json, and
  // every split falls back to the position label.
  positionShares = null,
  overrides = {},
  // Built by the caller, which owns the Basketball-Reference season tables the
  // historical builder needs. Absent in tests, which exercise the pool path.
  carryForwardCards = null,
}) {
  // The carried-forward players are IN THE POOL, because the studio takes its
  // identity from the pool and a card nobody can find has no use. But their
  // stats do not exist for this season, so the normal build must skip them —
  // they are built from their last healthy season instead. See carryForward.js.
  const carriedNames = new Set(
    (carryForwardCards?.cards ?? []).map(c => normalizeName(c.name))
  );
  const teamIndex = indexByName(teams);
  const spIndex = indexByName(speedPower);
  const rateIndex = indexByName(rates);
  const actualIndex = indexByName(actual);

  const resolved = poolPlayers
    .filter(p => !carriedNames.has(normalizeName(p.name)))
    .map(p => {
      const team = teamIndex.get(normalizeName(p.name));
      return { ...p, team: team?.team ?? p.team, pos: team?.pos ?? p.pos };
    });

  // The shooting layer is a POOL operation, not a per-player one: the
  // compression scale, the shrinkage strength and the centre of each boost are
  // all measured across these 350 players, so it has to run once over all of
  // them before any single card can be built.
  const actualRows = resolved.map(p => lookup(actualIndex, p.name));
  const shooting = S.buildShootingLayer(actualRows.map(actualShootingInput), {
    shotLineTarget: calibration.shotLine.target,
    paint: calibration.paintBoost,
    three: calibration.threePtBoost,
  });

  const cards = [];
  const missingRates = [];
  const missingActual = [];
  const missingSize = [];
  const missingShares = [];
  // Per-4-minute production, per card, in card order. Carried out of the build
  // because it is what a chart is SUPPOSED to integrate to, and the run report
  // cannot check that without it. See reportChartFit.
  // THE FIELD, BEFORE ANY CHART EXISTS. The roll bonus is a function of Speed,
  // Power and Def Boost only, and all three are settled before a chart is cut —
  // Speed+Power arrives from speedPower.js and Def Boost from the actual row. So
  // every card's own distribution of EFFECTIVE rolls is knowable here, which is
  // what lets a band be placed where the player actually reaches it instead of
  // where a bare d20 would.
  // ── Archetype shaping (archetypes.js) ────────────────────────────────────
  // Assigned BEFORE the field stubs so the shaped bodies are what the
  // effective-roll CDFs see: the override group — real offensive engines
  // without positive defense — gets a def-led budget and an exaggerated
  // split, so their defensive value in the matchup game deflates to what
  // DEF EPM says it should be.
  const archRows = resolved
    .map((p, i) => {
      const a = actualRows[i];
      return a && a.epmDef != null && a.epmOff != null
        ? { name: normalizeName(p.name), epmOff: a.epmOff, epmDef: a.epmDef }
        : null;
    })
    .filter(Boolean);
  const archetypes = ARCH.assignArchetypes(archRows);
  let shapedCount = 0;
  // The budget is NOT cut for shaped players — the box-score sim showed a
  // def-led budget starving their charts through roll penalties. The hole
  // comes from the split alone (exaggerateSplit keeps the lean axis whole).
  const shapingFor = (player, i) => {
    const arch = archetypes.get(normalizeName(player.name));
    const a = actualRows[i];
    const shaped = Boolean(arch?.override && a?.epmDef != null);
    return { shaped, total: lookup(spIndex, player.name)?.speedPowerTotal ?? 0 };
  };

  const fieldStubs = resolved.map((player, i) => {
    const { shaped, total } = shapingFor(player, i);
    const shares = positionShares?.forName(player.name, CURRENT_STATS_SEASON) ?? null;
    let { speed, power } = A.splitFromCalibration(total, {
      pos: player.pos,
      size: biometrics.get(normalizeName(player.name)) ?? null,
      positionShares: shares,
      calibration,
    });
    if (shaped) ({ speed, power } = ARCH.exaggerateSplit(speed, power));
    return { speed, power, defBoost: A.defBoostFromEpm(actualRows[i]?.epmDef) };
  });
  // The blend in placeBandsOnCdf anchors the floor (a pure-CDF placement made
  // Giannis Antetokounmpo blank on anything under 14, which no one would read
  // as the best card in the set) and ramps to the CDF at the ceiling. See
  // scripts/analysis/runRollDistribution.js for the measurement behind it.
  const rollCdfs = CDF_BANDS
    ? fieldStubs.map(c => effectiveRollCdf(c, fieldStubs, calcAdv))
    : fieldStubs.map(() => null);

  // Real last-82 game logs (opponent-adjusted, minutes-damped), keyed by card
  // id. Empty map when the fetch job hasn't run — every card then falls back
  // to the provisional synthesis, exactly as before.
  const realGamesById = loadAllRealGames();
  let realCount = 0;

  const targets = [];
  resolved.forEach((player, i) => {
    const rate = lookup(rateIndex, player.name);
    if (!rate) missingRates.push(player.name);
    if (!actualRows[i]) missingActual.push(player.name);
    const sp = spIndex.get(normalizeName(player.name));
    const size = lookup(biometrics, player.name);
    if (!size) missingSize.push(player.name);
    const shares = positionShares?.forName(player.name, CURRENT_STATS_SEASON) ?? null;
    if (!shares) missingShares.push(player.name);
    targets.push({
      pts: V.per4MinFromPer100(rate?.pts100 ?? 0),
      reb: V.per4MinFromPer100(rate ? trb100(rate) : 0),
      ast: V.per4MinFromPer100(rate?.ast100 ?? 0),
    });
    const realGames = realGamesById.get(playerIdFromName(player.name)) ?? null;
    if (realGames) realCount += 1;
    const { shaped, total } = shapingFor(player, i);
    if (shaped) shapedCount += 1;
    cards.push(
      buildCard({
        player,
        rate,
        actual: actualRows[i],
        shooting: shooting.players[i],
        speedPowerTotal: total,
        size,
        positionShares: shares,
        calibration,
        rollCdf: rollCdfs[i],
        realGames,
        exaggerateSplit: shaped,
      })
    );
  });
  console.log(`Charts from real game logs: ${realCount} of ${resolved.length}`);
  console.log(`Archetype-shaped physical profiles: ${shapedCount}`);

  // CARRIED-FORWARD PLAYERS, appended before pricing so they are valued against
  // the same field as everyone else. These are men who appear in NO 2025-26
  // table at all — Haliburton, Irving, Lillard, VanVleet — so the pool rule and
  // the force-include list both have nothing to match. See carryForward.js.
  const carried = carryForwardCards ?? { cards: [], missing: [] };
  const cards2 = [...cards, ...carried.cards];

  // Salary is a POST-PASS, and has to be: play value is measured against a
  // field, so it does not exist until every card in that field has its
  // attributes. Overrides are applied FIRST so that a hand-tuned chart is
  // priced as the card actually prints, not as the generator first drew it.
  const byId = Object.fromEntries(cards2.map(c => [c.id, c]));
  const overridden = applyOverrides(byId, overrides);
  const priced = cards2.map(c => overridden[c.id]);
  // One non-finite chart cell NaN-poisons the whole field's pricing (it
  // spreads through every card's defence term), and JSON serialization
  // launders NaN to null so the written file looks innocent. Fail loudly
  // instead — a 0:00 game slipping past realGames' minutes floor did exactly
  // this once.
  const dirty = priced.filter(c => c?.chart?.some(t => ![t.pts, t.reb, t.ast, t.lo, t.hi].every(Number.isFinite)));
  if (dirty.length) {
    throw new Error(
      `non-finite chart cells on ${dirty.length} card(s): ${dirty.slice(0, 5).map(c => c.name).join(', ')}`
    );
  }
  const salaries = PV.priceSet(priced, {
    roundSalary: A.roundSalary,
    min: A.SALARY_MIN,
    max: A.SALARY_MAX,
  });
  priced.forEach((c, i) => {
    c.salary = salaries[i];
  });

  return {
    cards: priced,
    missingRates,
    missingActual,
    missingSize,
    missingShares,
    shooting,
    targets,
    // How much of the pool's stat line is postseason. Zero for a pool built off
    // regular-season-only rows, which is what makes this safe to report always.
    pooling: poolingSummary(actualRows.filter(Boolean)),
    names: resolved.map(p => p.name),
  };
}

/** min / median / max plus a value histogram, for the run report. */
export function summarize(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return { n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return {
    n: v.length,
    min: v[0],
    p10: v[Math.floor(0.1 * (v.length - 1))],
    median: v[Math.floor(0.5 * (v.length - 1))],
    p90: v[Math.floor(0.9 * (v.length - 1))],
    max: v[v.length - 1],
    mean: Number(mean.toFixed(2)),
  };
}

/**
 * Value counts, in ascending numeric order, as PAIRS.
 *
 * Not a plain object: JavaScript orders an object's integer-like keys
 * numerically but keeps every other key in insertion order, and "-1" is not an
 * integer index. So an object histogram of boosts prints as
 * `0 1 2 3 4 -3 -2 -1` — the negatives exiled to the end, which in a report
 * about a stat whose whole point is that it can be negative reads as a bug in
 * the data rather than in the printing.
 */
export function histogram(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * The shooting layer, RAW against COMPRESSED, side by side.
 *
 * The raw column is the rule applied literally — a player's Shot Line is the
 * roll at which he misses at his real TS% miss rate, and a boost is the distance
 * from there to what he really shoots at that spot. It is printed on every run
 * because it is the thing being traded away: raw lines are three to seven rolls
 * easier than any card the game has ever printed, which would roughly double
 * shot-check success and undo the balance pass in
 * docs/plans/2026-03-31-scoring-balance-design.md. Seeing both is how that trade
 * stays a decision rather than a default.
 */
export function reportShooting({ cards, shooting, names, calibration, log }) {
  const players = shooting.players;
  const line = (label, values) => {
    const v = summarize(values);
    log(
      `  ${label.padEnd(22)}${String(v.min).padStart(6)}${String(v.p10).padStart(6)}` +
        `${String(v.median).padStart(6)}${String(v.p90).padStart(6)}${String(v.max).padStart(6)}` +
        `${String(v.mean).padStart(8)}`
    );
  };

  log('SHOOTING — the rule raw, and compressed onto the finished set');
  log('                            min   p10   med   p90   max    mean');
  line('shot line RAW (TS%)', players.map(p => p.literal.shotLine));
  line('shot line COMPRESSED', cards.map(c => c.shotLine));
  line('paint boost RAW', players.map(p => p.literal.paintGap));
  line('paint boost COMPRESSED', cards.map(c => c.paintBoost));
  // The 3PT column is the player's own three-point LINE, not a gap: the boost is
  // absolute three-point ability re-centred on the pool, not a distance from the
  // Shot Line. See scripts/cardgen/shooting.js.
  line('3PT line RAW (3P%)', players.map(p => p.literal.threeLine));
  line('3PT boost COMPRESSED', cards.map(c => c.threePtBoost));
  log(
    `  d20 success rate at the median line: raw ${(
      100 * S.successRateForLine(summarize(players.map(p => p.literal.shotLine)).median)
    ).toFixed(0)}%, compressed ${(
      100 * S.successRateForLine(summarize(cards.map(c => c.shotLine)).median)
    ).toFixed(0)}%`
  );

  log('');
  log('  a spread of players, raw -> compressed');
  // One player per compressed line, and within each the one with the biggest
  // Speed+Power budget — spanning the range while naming players a reader can
  // actually check, rather than eight names nobody recognises.
  const byLine = new Map();
  names.forEach((name, i) => {
    const line = cards[i].shotLine;
    const best = byLine.get(line);
    const budget = cards[i].speed + cards[i].power;
    if (!best || budget > best.budget) byLine.set(line, { name, i, budget });
  });
  const num = v => (v == null ? '  -' : String(v).padStart(3));
  for (const [, { name, i }] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    const p = players[i];
    const c = cards[i];
    log(
      `    ${name.padEnd(24)} line ${String(p.literal.shotLine).padStart(2)} -> ${String(c.shotLine).padStart(2)}` +
        `   paint ${num(p.literal.paintGap)} -> ${String(c.paintBoost).padStart(2)}` +
        `   3PT line ${num(p.literal.threeLine)} -> boost ${String(c.threePtBoost).padStart(2)}`
    );
  }

  log('');
  log('  boost distribution vs the finished cards it was calibrated against');
  for (const key of ['paintBoost', 'threePtBoost']) {
    const real = calibration[key].quality.realHistogram;
    const realTotal = Object.values(real).reduce((a, b) => a + b, 0);
    const asShare = h =>
      Object.entries(h)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([k, v]) => `${k}:${((100 * v) / (h === real ? realTotal : cards.length)).toFixed(0)}%`)
        .join(' ');
    const produced = Object.fromEntries(histogram(cards.map(c => c[key])));
    log(`    ${key} produced  ${asShare(produced)}`);
    log(`    ${' '.repeat(key.length)} real      ${asShare(real)}`);
  }

  // The chart is now MADE to break at the shot line, so the card's one arrow has
  // a real dividing line to sit on (see forceBandBoundary). This is the check
  // that it actually did: anything short of every card is a bug, not a statistic.
  const breaks = cards.filter(c => c.chart.some(t => t.lo === c.shotLine)).length;
  // ...and the break has to fall BETWEEN two printed rows. Tier 0 is the blank
  // tier, which is not drawn, so the first PRINTED row is tier 1 — a break at
  // its start would be the table's top frame, not a rule, and carry no arrow.
  const printable = cards.filter(c => c.chart.findIndex(t => t.lo === c.shotLine) > 1).length;
  log('');
  log(
    `  charts that break exactly at the shot line: ${breaks}/${cards.length}` +
      `  (between two printed rows: ${printable}/${cards.length})`
  );
  if (breaks < cards.length || printable < cards.length) {
    log(
      `  *** ${cards.length - printable} charts have no rule for the shot-line arrow to sit on: ` +
        cards
          .filter(c => c.chart.findIndex(t => t.lo === c.shotLine) <= 1)
          .map(c => `${c.id}(L${c.shotLine})`)
          .join(', ')
    );
  }
}

/**
 * Does the chart still add up to the player the statistics describe?
 *
 * THE REQUIREMENT THIS CHECKS, in the user's words: "I want a player's standard
 * per-4 minute numbers to occur naturally based on the remaining rolls above 1
 * or 2." Blanking rolls 1-2 and moving a boundary onto the shot line both take
 * production off the card, and neither announces itself — the chart still looks
 * like a chart. So the run measures it.
 *
 * The measure is the chart's expected value per d20 roll over the player's own
 * per-4-minute rate. It is a RATIO rather than a difference because the level
 * the charts are built at is itself a fitted multiple of that rate (see
 * variance.js): what matters is that the restructure did not move it, not that
 * it equals one. A pool median that drifts from the finished 2025-26 set's is
 * the failure mode — every card quietly weaker or stronger than the set it
 * shares a table with.
 *
 * Rolls above 20 are excluded by construction: expectedValuePerRoll walks a
 * d20, so a top band starting at 21 contributes nothing here. That is the point
 * of putting one there.
 */
export function reportChartFit({ cards, targets, log }) {
  // Measured off the finished 2025-26 set with this same ratio, for the pool
  // players who have one. Committed here rather than recomputed because it is a
  // property of cards that are done, and this is the line the new set is held to.
  const REFERENCE = { pts: 1.0, reb: 1.16, ast: 0.88 };
  log('');
  log('chart expected value per roll, over the player\'s per-4-minute rate');
  log('  (1.00 = the chart pays exactly his real rate; the 2025-26 set sits at');
  log('   pts 1.00 / reb 1.16 / ast 0.88, and matching that is the requirement)');
  for (const stat of V.CHART_STATS) {
    const ratios = cards
      .map((c, i) => {
        const target = targets[i]?.[stat] ?? 0;
        return target > 0 ? expectedValuePerRoll(c.chart, stat) / target : null;
      })
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (ratios.length === 0) continue;
    const at = p => ratios[Math.floor(p * (ratios.length - 1))];
    const median = at(0.5);
    const drift = median - REFERENCE[stat];
    log(
      `  ${stat}  p10 ${at(0.1).toFixed(2)}  median ${median.toFixed(2)}  p90 ${at(0.9).toFixed(2)}` +
        `   vs 2025-26 ${REFERENCE[stat].toFixed(2)} -> ${drift >= 0 ? '+' : ''}${drift.toFixed(3)}` +
        `${Math.abs(drift) > 0.05 ? '  *** DRIFTED' : ''}`
    );
  }
}


/**
 * Cards for players with no 2025-26 row at all, built from their last healthy
 * season. See carryForward.js for why this is not the force-include list.
 */
function buildCarried({ calibration, log }) {
  const entries = readCarryForward();
  if (entries.length === 0) return { cards: [], missing: [] };
  const { resolved, missing: unresolved } = resolveCarryForward(entries);

  // Basketball-Reference season rows, for the seasons actually named.
  const advanced = new Map();
  const perPoss = new Map();
  for (const season of [...new Set(resolved.map(r => r.season))]) {
    for (const [kind, target] of [['advanced', advanced], ['perPoss', perPoss]]) {
      const rows = readCache(`bbref-${season}-${kind}-full`) ?? [];
      for (const row of rows) target.set(`${normalizeName(row.name)}|${season}`, { ...row, season });
    }
  }

  // The current pool's own season, the shooting layer's calibration basis —
  // assembled the way generateSpecialSets does.
  const history = readCache('bbref-history');
  const archiveRows = history?.data?.rows ?? history?.rows ?? [];
  const byId = new Map();
  for (const row of archiveRows) {
    if (row.season !== Number(String(CURRENT_STATS_SEASON).slice(-4))) continue;
    const prev = byId.get(row.playerId);
    if (!prev || (row.games ?? 0) > (prev.games ?? 0)) byId.set(row.playerId, row);
  }
  const pool = readJson(path.join(GEN_DIR, 'player-pool-2026.json'));
  const poolIds = new Set(resolvePlayerIds(pool, archiveRows).ids.values());
  const currentRows = [...byId.values()].filter(r => poolIds.has(r.playerId));

  const built = buildCarryForwardCards(resolved, {
    buildSet,
    currentRows,
    calibration,
    biometrics: indexBiometrics(loadBiometrics()),
    positionShares: indexPositionShares(loadPositionShares()),
    advanced,
    perPoss,
  });
  const bad = [...unresolved, ...built.missing];
  log(
    `Carried forward: ${built.cards.length} of ${entries.length} — ` +
      built.cards.map(c => `${c.name} (${c.carriedFrom}, ${c.team})`).join(', ') +
      (bad.length ? ` | UNRESOLVED: ${bad.join(', ')}` : '')
  );
  return built;
}

export function main({ log = console.log } = {}) {
  const calibration = readJson(CALIBRATION_FILE);
  const rates = readCache(`dunksandthrees-epm-${CURRENT_STATS_SEASON}`);
  if (!rates) {
    throw new Error(
      `No cached dunksandthrees rates for ${CURRENT_STATS_SEASON} — run ` +
        'scripts/cardgen/fetchCalibrationData.js first.'
    );
  }
  // Regular season and playoffs folded into one sample per player — see
  // scripts/cardgen/poolSeasons.js for which volume each stat pools on — and
  // then the PRIOR SEASON folded in on top for the nineteen force-included
  // players, by the same arithmetic. See scripts/cardgen/priorSeasonBlend.js.
  const blend = readBlendedActual(CURRENT_STATS_SEASON);
  if (!blend) {
    throw new Error(
      `No cached dunksandthrees ACTUAL rates for ${CURRENT_STATS_SEASON} — run ` +
        'scripts/cardgen/fetchCalibrationData.js first.'
    );
  }
  const actual = blend.rows;
  const overridesFile = path.join(REPO_ROOT, 'scripts', 'cardgen', 'overrides.json');
  const {
    cards,
    missingRates,
    missingActual,
    missingSize,
    missingShares,
    shooting,
    pooling,
    names,
    targets,
  } = generateCards({
    carryForwardCards: buildCarried({ calibration, log }),
    pool: readJson(path.join(GEN_DIR, 'player-pool-2026.json')),
    teams: readJson(path.join(GEN_DIR, 'player-teams-2026.json')),
    speedPower: readJson(path.join(GEN_DIR, 'speed-power-totals-2026.json')),
    biometrics: indexBiometrics(loadBiometrics()),
    positionShares: indexPositionShares(loadPositionShares()),
    rates,
    actual,
    calibration,
    overrides: fs.existsSync(overridesFile) ? readJson(overridesFile) : {},
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    provisional: false,
    set: '2026-27',
    statsSeason: CURRENT_STATS_SEASON,
    calibratedAgainst: calibration.referenceSeason,
    note:
      'REAL-LOG REBUILD. Charts are cut from each player’s LAST 82 GAMES ' +
      '(Basketball-Reference logs, regular season AND playoffs), opponent-adjusted by the ' +
      "opposing team's dated DEF EPM and minutes-damped to the published sizing convention " +
      '(scripts/cardgen/realGames.js); the per-card provisional flag survives only where a log ' +
      'could not serve (carried-forward players). Shot Line, Paint Boost, 3PT Boost, Def Boost ' +
      "and the Speed/Power budget come from dunksandthrees' ACTUAL 2025-26 season page, regular " +
      `season and playoffs pooled by volume; the ${blend.blended.length} force-included players ` +
      `also fold in ${PRIOR_STATS_SEASON - 1}-${String(PRIOR_STATS_SEASON % 100).padStart(2, '0')}. ` +
      'ARCHETYPE SHAPING (scripts/cardgen/archetypes.js): players below the Good-defender tier ' +
      'with a real offensive engine carry a def-led Speed+Power budget and an exaggerated split ' +
      '— their offense lives in the chart, their defense in Def Boost (round(DEF EPM), ' +
      'neutralize-only). See card-data/generated/card-calibration.json.',
    cards,
  };
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(payload, null, 1)}\n`);

  log(`${cards.length} cards -> ${path.relative(REPO_ROOT, OUTPUT_FILE)}`);
  if (missingRates.length) {
    log(`  no predicted stat line for ${missingRates.length}: ${missingRates.join(', ')}`);
  }
  if (missingActual.length) {
    log(`  no ACTUAL stat line for ${missingActual.length}: ${missingActual.join(', ')}`);
  }
  log(
    missingSize.length
      ? `  no height/weight for ${missingSize.length} (unsized split): ${missingSize.join(', ')}`
      : `  height and weight for all ${cards.length} — every split carries its size term`
  );
  log(
    missingShares.length
      ? `  no positional shares for ${missingShares.length} (position-LABEL split): ${missingShares.join(', ')}`
      : `  positional shares for all ${cards.length} — no card falls back to its label`
  );
  log(`  active split rule: ${A.SPLIT_RULE.name} (see SPLIT_RULE in scripts/cardgen/attributes.js)`);
  log(
    `  playoffs folded in: ${pooling.gained}/${pooling.players} players gained games ` +
      `(${pooling.playoffGames} playoff games total, median ${pooling.medianPlayoffGames}, ` +
      `max ${pooling.maxPlayoffGames}); the other ${pooling.players - pooling.gained} are unchanged`
  );
  reportBlend(blend, log);
  log('');
  const fields = ['speed', 'power', 'shotLine', 'paintBoost', 'threePtBoost', 'defBoost', 'salary'];
  log('field         n   min   p10   med   p90   max   mean');
  for (const f of fields) {
    const s = summarize(cards.map(c => c[f]));
    log(
      `${f.padEnd(13)}${String(s.n).padStart(3)}${String(s.min).padStart(6)}${String(s.p10).padStart(6)}` +
        `${String(s.median).padStart(6)}${String(s.p90).padStart(6)}${String(s.max).padStart(6)}${String(s.mean).padStart(7)}`
    );
  }
  log('');
  for (const f of ['shotLine', 'paintBoost', 'threePtBoost', 'defBoost']) {
    log(`${f.padEnd(13)} ${histogram(cards.map(c => c[f])).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  }
  log('');
  log('chart expected value per d20 roll');
  for (const stat of V.CHART_STATS) {
    const s = summarize(cards.map(c => Number(expectedValuePerRoll(c.chart, stat).toFixed(2))));
    log(`  ${stat}  min ${s.min}  median ${s.median}  p90 ${s.p90}  max ${s.max}  mean ${s.mean}`);
  }
  const blank = cards.filter(c => isBlankTier(c.chart[0]));
  const noScoring = cards.filter(c => c.chart.length > 1 && c.chart[1].pts === 0);
  // Tier 2 is meant to READ differently from tier 1 — "they don't score", not
  // "nothing happens". Where the bottom decile's rebounds and assists both
  // round to zero it cannot, and that is worth counting rather than hiding:
  // those cards print a bottom row of straight zeros, which is the truth about
  // a low-usage player rather than a defect.
  const alsoBlank = noScoring.filter(c => c.chart[1].reb === 0 && c.chart[1].ast === 0);
  log(`  blank 1-2 tier (not printed) : ${blank.length}/${cards.length}`);
  log(`  second non-scoring tier      : ${noScoring.length}/${cards.length}`);
  log(`    of those, also 0 reb and 0 ast : ${alsoBlank.length}`);
  log(
    `  PRINTED rows per card        : ${histogram(cards.map(c => c.chart.length - 1))
      .map(([k, v]) => `${k}:${v}`)
      .join(' ')}  (the blank tier is not drawn; the table holds ${MAX_PRINTED_ROWS})`
  );
  const tooTall = cards.filter(c => c.chart.length > MAX_CHART_TIERS);
  if (tooTall.length) {
    log(`  *** ${tooTall.length} CHARTS ARE TOO TALL TO PRINT: ${tooTall.map(c => c.id).join(', ')}`);
  }
  reportChartFit({ cards, targets, log });
  log(`  speed+power sums to budget : ${cards.every(c => c.speed >= 1 && c.power >= 1) ? 'all >= 1 each' : 'CHECK'}`);
  log('');
  reportShooting({ cards, shooting, names, calibration, log });
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
