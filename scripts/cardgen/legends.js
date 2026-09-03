// The declared legends list: players force-included into the Super Season set.
//
// Super Season is built as "each CURRENT-POOL player's best season", which
// structurally excludes anyone who retired before the 2026-27 pool. Eleven of
// the shipped 2025-26 set's twenty-three retro cards had no path into any
// generated set at all — Jordan, Kareem, Magic, Bird, Erving, Kobe, Duncan,
// Nowitzki, Barkley, Robinson and Hill. This file is how they get back in,
// alongside a second group the archive surfaced as the strongest absent
// players of the modern era.
//
// Same file-not-constant reasoning as forceInclude.js: the list is curation,
// it will grow, and a data file with a reason per entry beats editing source.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './cache.js';

export const LEGENDS_FILE = path.join(REPO_ROOT, 'card-data', 'legends-2026.json');

/** `[{ name, season, reason }]`, or an empty list when the file is absent. */
export function readLegends(file = LEGENDS_FILE) {
  if (!fs.existsSync(file)) return [];
  const { _comment, ...entries } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.entries(entries).map(([name, v]) => ({ name, ...v }));
}
