// The declared force-include list: players who join the pool regardless of the
// MPG/games rule.
//
// WHY IT IS A FILE AND NOT A CONSTANT. The list is not a fixed set of 18 injury
// exceptions that was decided once — the user has already appended a name to it
// (Ty Jerome, an individual pick with nothing to do with injuries) and will
// append more. A hardcoded array means editing a source file and re-reading a
// diff to find out who is on it; a data file with one line per player, reason
// included, means adding a line. So the list lives in card-data/, next to
// manual-teams.json, which it deliberately mirrors: a `_comment` documenting the
// file for whoever opens it next, and one `"Name": "why"` entry per player.
//
// IT COMPOSES, IT DOES NOT REPLACE. filterPlayerPool keeps everyone the
// MPG>=12 / G>=40 rule already admits and ADDS everyone named here — see
// sources/playerPool.js. A name that is already over both thresholds is
// therefore harmless (it changes nothing), and a name that matches no row in the
// source table at all is REPORTED rather than dropped, because a typo in a name
// is otherwise completely silent: the player simply never appears and nothing
// anywhere says why.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './cache.js';

export const FORCE_INCLUDE_FILE = path.join(REPO_ROOT, 'card-data', 'force-include-2026.json');

/**
 * The list as `{ name, reason }` records, in file order.
 *
 * `_comment` is documentation, not a player — dropped here so every consumer
 * sees a clean list rather than each of them remembering to skip it.
 *
 * A missing file is an empty list, not an error: the force-include list is a
 * curation input, and a checkout without one should still build the pool the
 * plain rule produces.
 */
export function readForceInclude(file = FORCE_INCLUDE_FILE) {
  if (!fs.existsSync(file)) return [];
  const { _comment, ...entries } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.entries(entries).map(([name, reason]) => ({ name, reason }));
}

/** Just the names — what the pool filter takes. */
export const forceIncludeNames = (file = FORCE_INCLUDE_FILE) =>
  readForceInclude(file).map(p => p.name);
