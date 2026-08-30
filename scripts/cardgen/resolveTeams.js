// Merges the Basketball-Reference-derived player pool with nba.com's active
// roster to give every player a REAL current team.
//
// Two problems this solves:
//  1. Basketball-Reference reports mid-season-traded players under aggregate
//     codes "2TM"/"3TM" (46 of the 350 pool players). Those aren't teams: a
//     card for one has no colors and no logo, so it renders on the grey
//     fallback and looks broken.
//  2. The two sources disagree on three abbreviations (see TEAM_ALIASES).
//
// THREE RESOLUTION PATHS, in order of trust:
//   nba.com match  — the player is on an active roster right now. Best answer,
//                    and the only one that also yields a personId (which is
//                    what makes the NBA headshot fallback work for a player
//                    with no curated photo yet).
//   pool fallback  — nba.com can't help (retired, unsigned, or listed with a
//                    null team), but the pool's own team is a REAL team, just
//                    possibly stale. Keeping it beats dropping the player.
//   unresolved     — no roster match AND the pool team is itself an aggregate
//                    code. Reported, never guessed: a wrong team puts the wrong
//                    logo and colors on a printed card.

// Basketball-Reference -> nba.com abbreviations. ALREADY IMPLEMENTED in
// src/cards/teams.js, because card theming needs the same three pairs to avoid
// rendering 32 pool players on the grey fallback. Re-exported rather than
// redeclared — two copies of BRK/CHO/PHO drifting apart is a bug nobody would
// spot until a Nets card came out grey.
export { TEAM_ALIASES, canonicalTeam } from '../../src/cards/teams.js';
import { canonicalTeam } from '../../src/cards/teams.js';

const MULTI_TEAM_CODES = new Set(['2TM', '3TM', '4TM', 'TOT']);

/**
 * Generational suffixes, stripped only when they appear as the FINAL token.
 *
 * The two sources disagree about these constantly: "Bobby Portis" vs "Bobby
 * Portis Jr.", "Robert Williams" vs "Robert Williams III", "GG Jackson II" vs
 * "GG Jackson". Anchoring to the end is what keeps "Jrue Holiday" intact — a
 * bare /jr/ strip would maul it.
 */
const NAME_SUFFIXES = /\s+(jr|sr|ii|iii|iv|v)\.?$/i;

/**
 * Normalizes a player name for cross-source matching. Handles every
 * disagreement class observed between our pool and nba.com's feed:
 *
 *   diacritics   "Alperen Şengün"      vs "Alperen Sengun"
 *   case         "Tristan Da Silva"    vs "Tristan da Silva"
 *   punctuation  "A.J. Green"          vs "AJ Green"
 *   suffixes     "Robert Williams"     vs "Robert Williams III"
 *
 * nba.com is INCONSISTENT about diacritics — it serves "Jokić" accented but
 * "Sengun" and "Traore" stripped — so accent folding is required even though
 * many accented names do match exactly.
 *
 * Deliberately NOT the same as src/studio/players.js's playerIdFromName, which
 * shares the diacritic strip but keeps case and word breaks because its output
 * is a filename a human reads. This one is a lookup key nobody sees, so it can
 * be as lossy as matching requires.
 */
export function normalizeName(name) {
  return String(name ?? '')
    // Before punctuation stripping, while the space delimiter still exists.
    .replace(NAME_SUFFIXES, '')
    .normalize('NFD')
    // Escapes, not literal combining marks: those are invisible in an editor
    // and the first stray copy-paste silently breaks accent folding.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * @param pool     Array of { name, team, ... } from player-pool-2026.json
 * @param roster   Array of { fullName, team, personId } from nbaRoster.js
 * @param manual   { [playerName]: teamAbbr | null } from manual-teams.json
 * @returns { resolved, unresolved, stats } — `unresolved` is an array of player
 *          names with no real team from any source. `stats` counts each
 *          resolution path so a regression in one is visible instead of hidden
 *          inside a single total.
 */
export function resolvePlayerTeams(pool, roster, manual = {}) {
  // Suffix stripping can in principle collapse two real people onto one key
  // (an active "Gary Payton" and "Gary Payton II", say). Building the Map
  // naively would silently keep whichever came last and hand one player the
  // other's team — a wrong card that looks perfectly fine. Detect the collision
  // and refuse the match instead of guessing.
  const byName = new Map();
  const ambiguous = new Set();
  for (const record of roster) {
    const key = normalizeName(record.fullName);
    if (byName.has(key)) ambiguous.add(key);
    byName.set(key, record);
  }

  const resolved = [];
  const unresolved = [];
  const stats = { roster: 0, manual: 0, poolFallback: 0, unresolved: 0, ambiguous: 0 };

  for (const player of pool) {
    const key = normalizeName(player.name);
    const collided = ambiguous.has(key);
    if (collided) stats.ambiguous += 1;
    const match = collided ? null : byName.get(key);

    // A roster record can exist but carry a NULL team — nba.com lists unsigned
    // free agents that way (DeMar DeRozan, 201942, verified 2026-08-29). Merely
    // finding a record is not enough; stamping `null` onto the card as if it
    // were a team would be worse than keeping the pool's real, stale one.
    if (match && match.team) {
      resolved.push({ ...player, team: canonicalTeam(match.team), personId: match.personId });
      stats.roster += 1;
      continue;
    }

    const override = manual[player.name];
    if (override) {
      resolved.push({ ...player, team: canonicalTeam(override), personId: match?.personId ?? null });
      stats.manual += 1;
      continue;
    }

    // nba.com couldn't help. But the pool's OWN team is only wrong for the
    // multi-team aggregate codes; for everyone else it is a real team, just
    // possibly stale (their team as of the end of the season we pulled).
    if (!isMultiTeamCode(player.team)) {
      resolved.push({
        ...player,
        team: canonicalTeam(player.team),
        // Still worth carrying: a null-team roster record (the free-agent case)
        // has a perfectly good personId, and that is what the headshot fallback
        // needs.
        personId: match?.personId ?? null,
      });
      stats.poolFallback += 1;
      continue;
    }

    // Genuinely stuck: an aggregate code AND no real-team source anywhere.
    unresolved.push(player.name);
    stats.unresolved += 1;
  }

  return { resolved, unresolved, stats };
}

/** True if a pool team code is a Basketball-Reference multi-team aggregate. */
export function isMultiTeamCode(abbr) {
  return MULTI_TEAM_CODES.has(abbr);
}
