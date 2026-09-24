// WHICH SET A SEASON BELONGS TO — the one classifier every card that is not
// built by a set's own generator is judged by.
//
// The user, 2026-09-18: "If a card does not qualify for super season or
// rookie (or dissonance), 26-27, they should be throwbacks. Sweep current
// cards for this." A reward card keeps being the reward but WEARS a real
// identity (the `wears` field, honoured by cardTreatment); this module is the
// judge that says which. The Free Agents quote index was already asking the
// same question of every archived season (freeAgentQuotes.js), so the rule
// moved HERE and freeAgentQuotes re-exports it: one copy, because a second
// copy of a rule is a second copy that can disagree — which is exactly how
// Anthony Parker's Toronto reward came to print a false ROOKIE pill (2026-09-22,
// the reward sweep): generateTeamRewards' own builtBadges rebuilt his career
// from the 2002+ tables only, and "first cached season" is not "first season"
// when the tables open after the debut.
//
// This module must not import generateTeamRewards.js (freeAgentQuotes does,
// for NEVER_CARD, and generateTeamRewards imports this — a cycle would leave
// one side reading uninitialised bindings).
import fs from 'node:fs';
import path from 'node:path';
import { readCache, REPO_ROOT } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { careerSeasons, bestSeason, BEST_SEASON_MIN_GAMES, BEST_SEASON_MIN_MINUTES } from './history.js';
import { seasonDistribution } from './fetchHistory.js';
import { rookieSeasonCounts } from './generateSpecialSets.js';
import { SUPER_SEASON_MIN_SALARY } from '../../src/cards/badges.js';
import { bestLegendSeason } from './wnba/legends.js';
import { wnbaRookieSeasonCounts } from './wnba/generateWnbaRookies.js';

/** The archive's span: 1976, 1977, then 1985 on. The base set's season closes it. */
export const ARCHIVE_FIRST = 1976;
export const ARCHIVE_LAST = 2026;

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
 * Which set a REGULAR season lands in, by the rules the existing sets use.
 * Rookie outranks Super Season, as it does on the badges.
 *
 * `career` is careerSeasons() for the player; `distributions` maps season to
 * seasonDistribution(); `unprovable` comes from unprovableDebutSeasons().
 */
/**
 * THE SEASON EACH PLAYER'S SUPER SEASON CARD CARRIES (2026-09-24).
 *
 * Since the value pick (superSeasonValue.js) a Super Season is the player's
 * most VALUABLE season, which the box-score rule below cannot see: only a
 * built, priced card can. So a player who HAS a Super Season card — in either
 * league's set, including one a reward has migrated out, or a requested one —
 * is judged against the season that card carries, and the box-score rule is
 * the fallback for everyone else. Read from the generated files, which the
 * Super Season generators write before any step that classifies.
 */
export function superSeasonMap(genDir = path.join(REPO_ROOT, 'card-data', 'generated')) {
  const out = new Map();
  const cardsOf = f => {
    const file = path.join(genDir, f);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).cards ?? [] : [];
  };
  for (const f of ['cards-super-season.json', 'cards-wnba-super-season.json']) {
    for (const c of cardsOf(f)) if (c.bbrefId && Number.isFinite(c.season)) out.set(c.bbrefId, c.season);
  }
  for (const c of cardsOf('cards-free-agents.json')) {
    if ((c.set === 'super-season' || c.set === 'wnba-super-season') && c.bbrefId && !out.has(c.bbrefId)) {
      out.set(c.bbrefId, c.season);
    }
  }
  return out;
}

/** The season a player's Super Season card pins, or undefined when he has none. */
const pinnedSuperSeason = (superSeasonOf, career, playerId) => {
  const id = playerId ?? career.find(r => r?.playerId)?.playerId;
  return id != null ? superSeasonOf?.get(id) : undefined;
};

/** Is `season` the player's best — his Super Season card's, or else the box-score best? */
export function isBestSeason(career, season, top, { superSeasonOf = null, playerId = null } = {}) {
  const pinned = pinnedSuperSeason(superSeasonOf, career, playerId);
  if (pinned != null) return pinned === season;
  return top?.best?.season === season && top.eligibility !== 'none';
}

export function classifySeason(career, season, { distributions, unprovable = new Set(), superSeasonOf = null, playerId = null }) {
  const first = career[0];
  if (first && first.season === season && !unprovable.has(first.season) && rookieSeasonCounts(first)) {
    return 'rookie';
  }
  const pinned = pinnedSuperSeason(superSeasonOf, career, playerId);
  if (pinned != null) return pinned === season ? 'super-season' : 'throwbacks';
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

/** Where a WNBA season lands: the WNBA sets' twins of the NBA three. */
export const WNBA_SETS = { rookie: 'wnba-rookie', best: 'wnba-super-season', other: 'wnba-throwbacks' };

/**
 * Which WNBA set a season lands in, the NBA order: a rookie year first, then
 * the career's best season, then Throwbacks. A rookie year that is also her
 * best goes gold through settleTwin, as a legend's does in the shipped set
 * (buildWnbaCards: "one gold card wearing the rookie pill too"). `career` is
 * careerOf(playerId, rateArchive(...)) from generateWnbaLegends.js.
 */
export function classifyWnbaSeason(career, season, { superSeasonOf = null, playerId = null } = {}) {
  const first = career[0];
  if (first && first.season === season && wnbaRookieSeasonCounts(first)) return WNBA_SETS.rookie;
  const pinned = pinnedSuperSeason(superSeasonOf, career, playerId);
  if (pinned != null) return pinned === season ? WNBA_SETS.best : WNBA_SETS.other;
  const { best, eligibility } = bestLegendSeason(career);
  if (best && best.season === season && eligibility !== 'none') return WNBA_SETS.best;
  return WNBA_SETS.other;
}

/**
 * What a MIGRATED reward wears: the set it came from — with one exception.
 * A Super Season card the badge audit has flagged as NOT that player's best
 * season (John Stockton's 2001-02; his 1994-95 is) wears THROWBACKS. The
 * user's ruling (2026-09-18, after the pre-flight): it "wears the THROWBACK
 * look (TEAM REWARD + THROWBACK pills), not gold-no-pill" — a dropped claim
 * is not an identity to wear. The source card carries `notBestSeason` because
 * auditSuperSeasonBadges --fix runs BEFORE the reward generators
 * (cardgen_pipeline_order), so the flag is read straight off it. The WNBA
 * Super Season set has no flagged card today; the rule covers it the same way.
 */
export function wornByMigrated(source, set) {
  if ((set === 'super-season' || set === 'wnba-super-season') && source.notBestSeason) {
    return set === 'super-season' ? 'throwbacks' : WNBA_SETS.other;
  }
  return set;
}

function tableRows(season, kind) {
  let cached;
  try { cached = readCache(`bbref-${season}-${kind}-full`); } catch { return []; }
  return Array.isArray(cached) ? cached : cached?.rows ?? cached?.data ?? [];
}

/**
 * THE WHOLE CAREER OF EVERY PLAYER THE ARCHIVE HOLDS, 1976-2026, and the
 * league distributions each season is scored against — what classifySeason
 * needs to answer honestly for a retired player.
 *
 * Built from the full season tables rather than bbref-history (which holds
 * only the current pool's careers) and from the WHOLE window rather than
 * 2002+ (which is where builtBadges' false ROOKIE came from). Loaded once per
 * run; the caller keeps the result. `careerOf(playerId)` returns the
 * careerSeasons rows in season order, or [] for an id the archive never saw.
 */
export function nbaCareerContext({ first = ARCHIVE_FIRST, last = ARCHIVE_LAST } = {}) {
  const seasons = [];
  const distributions = {};
  const rows = new Map();
  for (let s = first; s <= last; s += 1) {
    const adv = tableRows(s, 'advanced');
    if (!adv.length) continue;
    seasons.push(s);
    distributions[s] = seasonDistribution(adv);
    for (const r of adv) {
      const id = r.playerId ?? normalizeName(r.name);
      (rows.get(id) ?? rows.set(id, []).get(id)).push({ ...r, season: s });
    }
  }
  const careers = new Map();
  const careerOf = playerId => {
    if (!careers.has(playerId)) careers.set(playerId, careerSeasons(rows.get(playerId) ?? []));
    return careers.get(playerId);
  };
  return {
    seasons, distributions, unprovable: unprovableDebutSeasons(seasons), careerOf,
    // The value pick's Super Seasons (2026-09-24), which classifySeason reads first.
    superSeasonOf: superSeasonMap(),
  };
}

/**
 * The identity a BUILT NBA reward wears, and whether that season was also
 * the career's best — the input settleTwin wants once the salary is known.
 */
export function nbaIdentityFor(ctx, playerId, season) {
  const career = ctx.careerOf(playerId);
  if (career.length === 0) return { wears: 'throwbacks', alsoBest: false, trusted: false };
  const set = classifySeason(career, season, { ...ctx, playerId });
  const top = bestSeason(career, ctx.distributions);
  const line = career.find(s => s.season === season);
  return {
    wears: set,
    alsoBest: isBestSeason(career, season, top, { superSeasonOf: ctx.superSeasonOf, playerId }),
    // The gold line trusts a season, not a career: the same test the quote
    // index applies to the line it is pricing.
    trusted: (line?.games ?? 0) >= BEST_SEASON_MIN_GAMES && (line?.minutes ?? 0) >= BEST_SEASON_MIN_MINUTES,
  };
}
