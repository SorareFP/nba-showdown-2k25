// The WNBA set's declared constants — every number that is a DECISION rather
// than a measurement, in one place, each one a one-line edit.
//
// ── WHY A 40-MINUTE GAME CHANGES EVERY NUMBER ON EVERY CARD ─────────────────
//
// A Showdown card's scoring chart pays out per FOUR-MINUTE SECTION, and the
// whole pipeline is anchored on how many possessions a section is worth.
// memory/provisional_chart_data_idea.md verified the NBA anchor: at a pace of
// 100 possessions per 48-minute game, a 4-minute section is
//
//     100 * 4/48 = 8.33 possessions
//
// and scripts/cardgen/variance.js encodes it as `PER_100_TO_PER_4MIN = 4/48`.
//
// A WNBA GAME IS 40 MINUTES — ten four-minute sections, not twelve — AND THE
// WNBA PLAYS SLOWER. Both halves of that matter and they pull in opposite
// directions. Re-deriving from the same sentence:
//
//     possessions per section = pace * 4 / 40
//
// with `pace` measured off Basketball-Reference's own WNBA team table rather
// than assumed, because unlike the NBA's round 100 there is no conventional
// figure to fall back on. The 2026 league pace is 79.24 possessions per 40
// minutes — the mean of the FIFTEEN teams, and Basketball-Reference's own
// League Average row reads 79.2 — so
//
//     79.24 * 4 / 40 = 7.92 possessions in a WNBA four-minute section
//
// against the NBA's 8.33: five percent FEWER, not more. Both halves of the
// difference matter and they pull opposite ways. The 40-vs-48 game alone would
// have said 20 percent more possessions per section; the slower league takes
// all of that back and a little besides, because the two leagues play at almost
// the same rate PER MINUTE (79.24/40 = 1.98 against 100/48 = 2.08). Anyone who
// corrected only for the shorter game would have printed every WNBA chart 26
// percent too big — a whole extra point on a star's top band.
//
// ── HOW THAT REACHES synthesizeGames WITHOUT EDITING IT ─────────────────────
//
// variance.js's `PER_100_TO_PER_4MIN` is a module constant, and variance.js is
// the NBA sets' file. Rather than parameterise it — a change in a shared file,
// during a concurrent edit, for one caller's benefit — the conversion happens
// on the way IN: a WNBA per-100 rate is turned into per-4-minute production
// with the WNBA constant, and then into the NBA-CONVENTION per-100 that
// produces that same per-4-minute figure under variance.js's own arithmetic.
//
//     per4  = per100_wnba * PACE / 1000
//     input = per4 * 12                       (so input * 4/48 == per4)
//
// It is exact, and it is exact for the second covariate too: variance.js also
// reads `per36FromPer100 = per100 * 36/48`, and `input * 36/48` is `per4 * 9`,
// which is per-36 production by definition in either league. So both the level
// anchor and the shape covariate come out right from one substitution, with no
// shared file touched. See toNbaConventionPer100.

/** The season the WNBA set is built from. Basketball-Reference's `2026` pages. */
export const WNBA_SEASON = 2026;

/**
 * The league's FIRST season, and the earliest year the archive can reach.
 *
 * 1997 is not a choice — it is the first WNBA season there was. Basketball-
 * Reference publishes it in full: 99 players, and the advanced table already
 * carries PER, TS%, USG%, ORtg/DRtg and the Win Shares family, the same columns
 * 2026 does. See scripts/cardgen/wnba/fetchWnbaHistory.js.
 *
 * Nothing here claims the MODEL reaches that far — that is a separate question
 * about whether the columns are populated and whether an NBA-fitted exchange
 * rate holds in a 1997 league, and generateWnbaLegends.js measures it rather
 * than assuming either way.
 */
export const WNBA_FIRST_SEASON = 1997;

/**
 * The last season the ARCHIVE covers, which is one behind the set's own season.
 *
 * The legends set is historical: every player in it is retired, and the most
 * recent of them (Diana Taurasi, Tina Charles) last played in 2024. Fetching
 * 2025 and 2026 through this path would be redundant anyway — fetchWnba.js
 * already caches both for the current set.
 */
export const WNBA_LAST_ARCHIVED_SEASON = 2024;

/**
 * The season blended in for the force-included six.
 *
 * THIS IS POSSIBLE HERE AND IS NOT POSSIBLE FOR THE NBA SETS, which is worth
 * stating because the NBA pool has the identical problem and cannot solve it:
 * dunksandthrees paywalls prior seasons, so the NBA's injury force-includes are
 * carded on their short season alone (see memory/new_season_player_pool.md).
 * Basketball-Reference publishes WNBA 2025 in full and for free, so the same
 * blend that is blocked there is a straight pooling job here.
 */
export const WNBA_BLEND_SEASON = 2025;

/**
 * THE POOL BAR. Chosen for a 44-game season the way MPG>=12 / G>=40 was chosen
 * for an 82-game one: a minutes floor that means "real rotation player" and a
 * games floor that means "played enough of the season to measure".
 *
 * Produces 101 players out of the 230 in the 2026 table, plus the seven named
 * in card-data/wnba-force-include-2026.json — 108 cards.
 */
export const WNBA_POOL_RULE = { minMpg: 16, minGames: 20 };

/** Minutes in a WNBA game. The NBA's is 48. Nothing here assumes either. */
export const WNBA_GAME_MINUTES = 40;

/** Minutes a Showdown chart pays out over. The same in both leagues. */
export const SECTION_MINUTES = 4;

/** Ten sections in a WNBA game, twelve in an NBA one. */
export const SECTIONS_PER_GAME = WNBA_GAME_MINUTES / SECTION_MINUTES;

/**
 * League pace — possessions per 40 minutes — MEASURED, per season.
 *
 * Refreshed by `node scripts/cardgen/wnba/fetchWnba.js`, which reads
 * Basketball-Reference's WNBA team advanced table and writes the measured
 * figure into the cache. These committed values are the fallback for a
 * checkout with no cache, exactly as REFERENCE_TOTALS and POSITION_SPEED_SHARE
 * are elsewhere in this pipeline.
 */
export const WNBA_LEAGUE_PACE = {
  // 13 teams in 2025; 15 in 2026 — Portland and Toronto joined Golden State's
  // 2025 expansion, so a WNBA table written from a 2024 memory would be two
  // franchises short.
  2025: 77.3154,
  2026: 79.24,
};

/** The pace a season is scaled by, falling back to the set's own season. */
export function leaguePace(season, measured = WNBA_LEAGUE_PACE) {
  return measured?.[season] ?? measured?.[WNBA_SEASON] ?? WNBA_LEAGUE_PACE[WNBA_SEASON];
}

/**
 * Possessions in one four-minute section, at a given pace. THE number this
 * whole module exists to state: `pace * 4 / 40`.
 */
export function possessionsPerSection(pace) {
  return (pace * SECTION_MINUTES) / WNBA_GAME_MINUTES;
}

/** A per-100-possession rate as production per four-minute section. */
export function per4MinFromPer100(per100, season = WNBA_SEASON) {
  return ((per100 ?? 0) * possessionsPerSection(leaguePace(season))) / 100;
}

/**
 * variance.js's NBA constant, so the substitution below can be read against it.
 * Deliberately re-declared rather than imported: this file must be able to
 * state what it is converting TO without depending on the NBA generator.
 */
export const NBA_PER_100_TO_PER_4MIN = 4 / 48;

/**
 * A WNBA per-100 rate, restated in the NBA's per-100 convention.
 *
 * The value that, pushed through variance.js's `per100 * 4/48`, yields the
 * player's real WNBA per-four-minute production. See the header — this is the
 * one substitution that carries the whole 40-minute correction, and it also
 * happens to give variance.js the correct per-36 covariate for free.
 */
export function toNbaConventionPer100(per100, season = WNBA_SEASON) {
  return nbaConventionPer100(per4MinFromPer100(per100, season));
}

/**
 * Per-four-minute production, restated in the NBA's per-100 convention.
 *
 * THE ONE THE CARDS ACTUALLY USE, because the WNBA source publishes season
 * TOTALS and per-four-minute production is therefore `4 * total / minutes` —
 * arithmetic, with no pace in it at all. `toNbaConventionPer100` above is the
 * same bridge for the case where only a per-100 rate is available, which is
 * what the NBA pipeline is stuck with; it carries each player's own team pace
 * as error and this does not. See pool.js's per4MinFromTotals.
 *
 * The pace measurement still matters and is still reported: it is the answer to
 * "how many possessions is a WNBA four-minute section", it is the weight every
 * cross-season pooling uses, and it is what any per-100 figure has to be read
 * against. It is simply not in the path from a box score to a chart.
 */
export function nbaConventionPer100(per4Min) {
  return (per4Min ?? 0) / NBA_PER_100_TO_PER_4MIN;
}

/**
 * Total minutes as possessions, at that season's WNBA pace.
 *
 * Used only as a POOLING WEIGHT, where the pace constant cancels between
 * numerator and denominator — the same property scripts/cardgen/poolSeasons.js
 * relies on and states. It is spelled out anyway so a reader can see that the
 * 40-minute game was not forgotten here either.
 */
export function possessionsFromMinutes(minutes, season = WNBA_SEASON) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return (minutes / WNBA_GAME_MINUTES) * leaguePace(season);
}

/** Where the generated WNBA files live, relative to card-data/. */
export const WNBA_SET = 'wnba';

/**
 * The shot profile in NBA-convention per-100, for the points event model.
 *
 * `synthesizeGames` multiplies its rates by the NBA's 8.333 possessions per
 * four-minute section, and a WNBA rate is per 100 WNBA possessions across a
 * 7.92-possession section. So the attempt VOLUMES go through the same unit
 * change the points, rebounds and assists rates already use. The make rates are
 * PROBABILITIES and are deliberately not rescaled -- a 38% three is 38% in
 * either league.
 */
export function mixNbaConvention(row, season = WNBA_SEASON) {
  return {
    fga2: toNbaConventionPer100(row.fg2a100 ?? 0, season),
    fga3: toNbaConventionPer100(row.fg3a100 ?? 0, season),
    fta: toNbaConventionPer100(row.fta100 ?? 0, season),
    pct2: row.fgPct2,
    pct3: row.fgPct3,
    pctFt: row.ftPct,
  };
}

/**
 * THE LEAGUE FACTOR ON SPEED+POWER — 0.88, the user's call (2026-09-06,
 * "let's go to about .87-.9").
 *
 * The WNBA budget comes off a fitted BPM-equivalent that puts a WNBA season
 * with NBA-like box-score features on the NBA scale, so a WNBA MVP landed
 * where an NBA MVP does: the current set's median Speed+Power was 18 against
 * the NBA base's 16, the legends' median 27 against the NBA Super Season's 22,
 * and 34 of 36 legends sat at or above the NBA base's 90th percentile. The
 * user, holding Sylvia Fowles at Power 24 for $1,270 next to Jokić at Power 20
 * for $1,260: "Some of these WNBA cards are still so overpowered."
 *
 * This multiplies every WNBA Speed+Power TOTAL after the map to the printed
 * scale and before the size split. At 0.88 the best WNBA season prints about
 * 26 where an NBA MVP prints 30 — an All-NBA-level card, not the top of the
 * pool — and the legends' median lands near the NBA Super Season's. Salaries
 * follow on their own: every WNBA set is priced against the base set's own
 * value distribution (priceAgainstBase), so a smaller card costs less.
 *
 * Speed and Power are then CAPPED at the NBA maxima (20 and 21) in
 * wnbaSize.js — a factor alone still let a 6'6" center's power share print
 * above anything the NBA scale produces.
 */
export const WNBA_LEAGUE_FACTOR = 0.88;

/**
 * The printed totals with the league factor applied; rounding happens at the
 * split. Clamped at the printed FLOOR: the factor is about the top of the
 * pool, and a bench player at the NBA minimum of 6 is already as small as a
 * card prints — 6 × 0.88 would have been the only 5 in the game.
 */
export function leagueScaleTotals(totals, { factor = WNBA_LEAGUE_FACTOR, min = 6 } = {}) {
  return totals.map(t => (Number.isFinite(t) ? Math.max(min, t * factor) : t));
}
