// The declared retired list: players the source table still carries a row for,
// but who have retired and must not appear in the set.
//
// The exact mirror of forceInclude.js, and deliberately a separate file rather
// than a flag on that one: the two answer opposite questions. Force-include
// asks "who does the MPG/games rule wrongly EXCLUDE"; this asks "who does it
// wrongly KEEP". A player can never be on both lists meaningfully, and keeping
// them apart means each file reads as a single clear intent.
//
// Removal happens in buildPool, AFTER the rule and the force-include list have
// both run, so a retired player is removed no matter which of them admitted
// him. Like force-include, an unmatched name is REPORTED rather than dropped
// silently — a typo here would otherwise leave a retired player in the set with
// nothing anywhere saying why the removal did not take.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './cache.js';

export const RETIRED_FILE = path.join(REPO_ROOT, 'card-data', 'retired-2026.json');

/**
 * The list as `{ name, reason }` records, in file order. A missing file is an
 * empty list — a checkout without one still builds the pool the rule produces.
 */
export function readRetired(file = RETIRED_FILE) {
  if (!fs.existsSync(file)) return [];
  const { _comment, ...entries } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.entries(entries).map(([name, reason]) => ({ name, reason }));
}

/** Just the names — what the pool filter takes. */
export const retiredNames = (file = RETIRED_FILE) => readRetired(file).map(p => p.name);
