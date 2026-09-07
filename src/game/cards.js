// NBA Showdown 2026 — the playable base set, re-exported from cardSets.js.
//
// MIGRATED 2026-09-03 off rawCards.js (the shipped 2025-26 "Final Cards"
// spreadsheet, 306 players) onto the generated 2026-27 real-log set (354).
// The generated JSON already carries the engine's exact field names, so no
// mapping layer survives. CARD_MAP spans EVERY set (keyed by cardKey) because
// packs and collections reach across sets; CARDS stays base-only because the
// engine, the team builder and the tutorial all mean "the current pool".
import { CARD_SETS, BASE_SET, ALL_CARDS, cardKey } from './cardSets.js';

export const CARDS = CARD_SETS[BASE_SET];

export const CARD_MAP = Object.fromEntries(ALL_CARDS.map(c => [cardKey(c), c]));

export const ALL_TEAMS = ['ALL', ...new Set(CARDS.map(c => c.team))].sort();

export function getCard(id) {
  return CARD_MAP[id];
}

export function lookupChart(card, roll) {
  const r = Math.min(Math.max(roll, 1), 99);
  for (const t of card.chart) {
    if (r >= t.lo && r <= t.hi) return t;
  }
  return card.chart[card.chart.length - 1];
}
