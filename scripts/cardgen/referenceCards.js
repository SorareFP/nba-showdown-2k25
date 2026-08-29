// The finished 306-card set, read back as DATA to calibrate against.
//
// `card-data/source-recovered/Final Cards.csv` is the literal spreadsheet the
// shipped cards were exported from. It is gitignored (the repo is public, this
// file is not), so everything here degrades to `null` when it is absent rather
// than throwing: a checkout without it must still be able to run the
// generators, just without the fit-quality numbers.
//
// WHAT IT IS FOR. memory/shooting_attributes_methodology.md is explicit that the
// raw-stat -> Shot Line / boost conversion was hand-calibrated and is NOT
// recoverable as a formula, and warns against inventing one and presenting it as
// recovered. This module is what makes the honest alternative possible: rather
// than guessing the old rules, fit NEW ones against 283 real finished cards and
// report how closely they reproduce them. That is a refit with a measured error,
// not a recovered formula, and the distinction is kept in the language
// everywhere it surfaces.
//
// The 23 legend cards are excluded from every reading here. Their stats come
// from peak historical seasons that no current-season table contains, so they
// cannot be joined to a stat source and would only add unmatchable rows. They
// are recognised by the "08-09 " season prefix the spreadsheet gives them.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './cache.js';

export const FINAL_CARDS_CSV = path.join(
  REPO_ROOT,
  'card-data',
  'source-recovered',
  'Final Cards.csv'
);

/** A legend card's name is prefixed with its season, e.g. "08-09 LeBron James". */
const LEGEND_PREFIX = /^\d{2}-\d{2}\s/;

/** RFC-4180-ish: handles the quoted `"2,1,1"` tuple cells this file is full of. */
export function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      fields.push(field);
      field = '';
    } else field += ch;
  }
  fields.push(field);
  return fields;
}

const num = v => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
};

/** `"1-3"` / `"21+"` -> `{ lo, hi }`, with `hi: null` for an open top tier. */
export function parseRollRange(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const plus = t.match(/^(\d+)\s*\+$/);
  if (plus) return { lo: Number(plus[1]), hi: null };
  const range = t.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) return { lo: Number(range[1]), hi: Number(range[2]) };
  const one = t.match(/^(\d+)$/);
  return one ? { lo: Number(one[1]), hi: Number(one[1]) } : null;
}

/** `"2,1,1"` -> `{ pts, reb, ast }`. */
export function parseOutcome(text) {
  const parts = String(text ?? '')
    .split(',')
    .map(p => num(p));
  if (parts.length < 3 || parts.some(p => p === null)) return null;
  return { pts: parts[0], reb: parts[1], ast: parts[2] };
}

export function parseFinalCardsCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const cards = [];
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    const name = f[0]?.trim();
    if (!name || LEGEND_PREFIX.test(name)) continue;
    const chart = [];
    // Columns 7..16 are five (range, "pts,reb,ast") pairs.
    for (let i = 0; i < 5; i += 1) {
      const range = parseRollRange(f[7 + i * 2]);
      const outcome = parseOutcome(f[8 + i * 2]);
      if (range && outcome) chart.push({ ...range, ...outcome });
    }
    cards.push({
      name,
      speed: num(f[1]),
      power: num(f[2]),
      shotLine: num(f[3]),
      paintBoost: num(f[4]),
      threePtBoost: num(f[5]),
      defBoost: num(f[6]),
      salary: num(f[17]),
      adjustedSalary: num(f[18]),
      chart,
    });
  }
  return cards;
}

/** The finished non-legend cards, or `null` when the gitignored CSV is absent. */
export function loadReferenceCards(file = FINAL_CARDS_CSV) {
  if (!fs.existsSync(file)) return null;
  return parseFinalCardsCsv(fs.readFileSync(file, 'utf8'));
}

/**
 * A card's expected value per roll of a d20.
 *
 * Weighted by how many of the twenty faces land in each tier, NOT by the tier's
 * printed width: the top tier reads "21+" and a d20 cannot reach it unaided, so
 * counting it would overstate every card. This is the quantity
 * memory/provisional_chart_data_idea.md checked the per-100 normalization
 * against (Jokic: REB 1.43 modeled vs 1.40 on the card), so it is the quantity
 * any later comparison has to use to be comparable.
 */
export function chartExpectedValue(chart, stat, faces = 20) {
  let total = 0;
  let counted = 0;
  for (let roll = 1; roll <= faces; roll += 1) {
    const tier = chart.find(t => roll >= t.lo && (t.hi == null ? true : roll <= t.hi));
    if (!tier) continue;
    total += tier[stat] ?? 0;
    counted += 1;
  }
  return counted === 0 ? null : total / counted;
}
