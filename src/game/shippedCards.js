// NBA Showdown 2K25 — the SHIPPED 2025-26 card set (306 players), frozen.
//
// This is the printed set the project started from ("Final Cards"
// spreadsheet), kept verbatim as the immutable reference: the studio's
// read-only 2025-26 source and the calibration/regression tests pin against
// it. The PLAYABLE set lives in cards.js and moves with the cardgen
// pipeline; this one must never move.
import rawCards from './rawCards.js';

export const SHIPPED_CARDS = rawCards.map(r => ({
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
