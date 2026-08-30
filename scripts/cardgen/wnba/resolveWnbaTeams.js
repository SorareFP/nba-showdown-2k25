// Which franchise each WNBA card prints.
//
// The counterpart of scripts/cardgen/resolveTeams.js, and deliberately the same
// three-path shape, because it is the same problem: Basketball-Reference
// reports a mid-season move as the aggregate code `TOT`, which is not a team,
// has no colours and no logo, and renders a card on the neutral grey fallback.
//
// ── THREE PATHS, IN ORDER OF TRUST ──────────────────────────────────────────
//
//   roster      wnba.com lists her on a team RIGHT NOW. Best answer, and the
//               only one that can be right about a move the stat table has not
//               caught up with — DeWanna Bonner's every 2026 game is a Phoenix
//               game and she is an Atlanta Dream player today.
//   last stint  wnba.com cannot help (unsigned, or absent from the feed), so
//               the team she FINISHED the season on, off the split rows. See
//               resolveDisplayTeams in pool.js.
//   stat row    neither applies and her row already names a real franchise —
//               the overwhelming majority, and nothing to resolve.
//
// A player who reaches the end of that with an aggregate code is REPORTED, not
// guessed at: a wrong team puts the wrong logo and the wrong colours on a
// printed card, and looks perfectly fine while doing it.
//
// ── WHY THE ROSTER OVERRIDES A ROW THAT IS ALREADY A REAL TEAM ──────────────
//
// It is the same choice the NBA path makes, for the same stated reason, and it
// is a CHOICE rather than an oversight: these are current-season cards, and
// "current team" is what the base set means by team. Measured against the 2026
// WNBA pool it moves five players, of whom four have a TOT row; the fifth is
// Bonner, whose stat row is single-team and stale. Three more are on no roster
// at all and keep the team their stat row gives them.

import { canonicalWnbaTeam } from '../sources/wnbaRoster.js';
import { isAggregateTeam } from '../sources/wnbaReference.js';
import { resolveDisplayTeams } from './pool.js';

/**
 * Normalizes a name for cross-source matching.
 *
 * The same rule as resolveTeams.js's — diacritics folded, punctuation and case
 * dropped — MINUS the generational-suffix strip, which is an NBA problem
 * ("Bobby Portis Jr.", "Robert Williams III") that the WNBA does not have and
 * that can only collapse two real people onto one key. Verified 2026-08-30:
 * every one of the 108 pool players matches a wnba.com record under this rule,
 * and no two records collide.
 */
export function normalizeWnbaName(name) {
  return String(name ?? '')
    .normalize('NFD')
    // Escapes rather than literal combining marks: those are invisible in an
    // editor, and the first stray copy-paste silently breaks accent folding.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * Indexes a roster by normalized name, refusing any name two players share.
 *
 * A collision handed one player the other's team — a wrong card that looks
 * completely fine — so it is dropped from the index instead, which demotes both
 * players to the split-row path rather than guessing between them.
 */
export function indexRoster(roster = []) {
  const byName = new Map();
  const ambiguous = new Set();
  for (const record of roster) {
    const key = normalizeWnbaName(record.fullName);
    if (byName.has(key)) ambiguous.add(key);
    byName.set(key, record);
  }
  for (const key of ambiguous) byName.delete(key);
  return { byName, ambiguous };
}

/**
 * @param rows    the carded rows, each { name, playerId, team }
 * @param splits  the season's per-game table WITHOUT the dedup, so a moved
 *                player's individual stints are visible
 * @param roster  wnba.com records from sources/wnbaRoster.js, or [] to run on
 *                the split rows alone
 * @returns { teamOf, stats, changes, unresolved }
 *   teamOf      playerId -> the abbreviation to print
 *   changes     every player whose printed team is not what her stat row said,
 *               each with the path that decided it — this is the report
 *   unresolved  players still on an aggregate code, which is a failure
 */
export function resolveWnbaTeams({ rows = [], splits = [], roster = [] } = {}) {
  const lastStint = resolveDisplayTeams(splits);
  const { byName, ambiguous } = indexRoster(roster);

  const teamOf = new Map();
  const changes = [];
  const unresolved = [];
  const stats = { roster: 0, lastStint: 0, statRow: 0, unresolved: 0, ambiguous: 0 };

  for (const row of rows) {
    const key = normalizeWnbaName(row.name);
    if (ambiguous.has(key)) stats.ambiguous += 1;
    const match = byName.get(key);
    const statRow = row.team ?? null;

    // A record can exist and carry a NULL team — wnba.com lists unsigned
    // players that way. Finding her is not enough; stamping null onto a card as
    // if it were a franchise would be worse than keeping a real, stale team.
    let team = null;
    let path = null;
    if (match?.team) {
      team = canonicalWnbaTeam(match.team);
      path = 'roster';
    } else if (isAggregateTeam(statRow) || statRow == null) {
      team = lastStint.get(row.playerId) ?? null;
      path = team ? 'lastStint' : null;
    } else {
      team = statRow;
      path = 'statRow';
    }

    if (!team || isAggregateTeam(team)) {
      unresolved.push({ name: row.name, playerId: row.playerId, statRow });
      stats.unresolved += 1;
      // Kept on whatever the stat row said rather than dropped: a grey card is
      // a visible problem, and a missing player is not.
      teamOf.set(row.playerId, statRow);
      continue;
    }

    stats[path] += 1;
    teamOf.set(row.playerId, team);
    if (team !== statRow) {
      changes.push({
        name: row.name,
        playerId: row.playerId,
        from: statRow,
        to: team,
        path,
        // True when the stat row already named a real franchise, so the move is
        // one the stat table does not know about yet rather than a TOT being
        // unpacked. Worth separating in the report: they are different claims.
        offSeasonMove: path === 'roster' && !isAggregateTeam(statRow) && statRow != null,
      });
    }
  }

  changes.sort((a, b) => a.name.localeCompare(b.name));
  return { teamOf, stats, changes, unresolved };
}
