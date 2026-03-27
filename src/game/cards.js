// NBA Showdown 2K25 — Full card data (306 players)
// Generated from Final Cards spreadsheet
// Fields: id, name(n), team(t), speed(s), power(p), shotLine(l),
//         paintBoost(pb), threePtBoost(tb), defBoost(db), salary($), chart(c)
// chart entries: [lo, hi, pts, reb, ast]

import rawCards from './rawCards.js';

export const CARDS = rawCards.map(r => ({
  id: r.id,
  name: r.n,
  team: r.t,
  speed: r.s,
  power: r.p,
  shotLine: r.l,
  paintBoost: r.pb,
  threePtBoost: r.tb,
  defBoost: r.db,
  salary: r['$'],
  chart: r.c.map(t => ({ lo: t[0], hi: t[1], pts: t[2], reb: t[3], ast: t[4] })),
}));

export const CARD_MAP = Object.fromEntries(CARDS.map(c => [c.id, c]));

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
