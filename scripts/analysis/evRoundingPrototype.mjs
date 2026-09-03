// PROTOTYPE — the role-player ratio-identity fix, measured before anyone
// ships it. Integer rounding at ×4 granularity flattens role players into
// identical 1p1r1a rows (the Dyson Daniels catch): a 3:1.3:1 wing and a true
// stat-stuffer print the same line, and design pillar 3 (player identity)
// loses. The candidate fix: EV-PRESERVING band rounding — instead of rounding
// each band independently, choose the monotone integer band values whose
// d20-weighted EV comes closest to the RAW (unrounded) EV, which naturally
// pushes a wing's assists into his top tiers instead of smearing 1s or 0s
// across the chart.
//
// Prints current vs proposed rows for the season's suspects. NOTHING is
// written; this is the run-by exhibit.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cardgen/cache.js';
import { loadAllRealGames } from '../cardgen/realGames.js';
import { percentileExc, roundDown } from '../cardgen/excelMath.js';

const CUTS = [0.1, 0.33, 0.5, 0.66, 0.9]; // bands.js's own quantiles
const cards = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'card-data/generated/cards-2026-27.json'), 'utf8')).cards;
const windows = loadAllRealGames();

const normalize = (stat, m) => (stat * (36 / m)) / m;

function rawBandValues(games, statKey) {
  const normalized = games.map(g => normalize(g[statKey], g.minutes));
  return CUTS.map(p => percentileExc(normalized, p) * 4);
}

/**
 * Monotone integer values minimizing |EV - rawEV| with equal band weights
 * (the exhibit's simplification; the real bands carry slot widths). Searches
 * the small lattice around the raw values.
 */
function evRound(raw) {
  const floor = raw.map(v => Math.max(0, Math.floor(v)));
  const options = raw.map((v, i) => [...new Set([floor[i], floor[i] + 1])]);
  const rawEv = raw.reduce((s, v) => s + v, 0);
  let best = null;
  const walk = (i, acc) => {
    if (i === raw.length) {
      const ev = acc.reduce((s, v) => s + v, 0);
      const err = Math.abs(ev - rawEv);
      if (!best || err < best.err) best = { err, values: [...acc] };
      return;
    }
    for (const v of options[i]) {
      if (acc.length && v < acc[acc.length - 1]) continue; // monotone
      acc.push(v);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return best?.values ?? raw.map(v => Math.round(roundDown(v, 1)));
}

const current = raw => raw.map(v => Math.round(roundDown(v, 1)));

for (const name of ['Dyson Daniels', 'Cason Wallace', 'Alex Caruso', 'Josh Hart', 'Draymond Green', 'Nikola Jokić']) {
  const card = cards.find(c => c.name === name);
  if (!card) continue;
  const games = windows.get(card.id);
  if (!games) continue;
  console.log(`\n${name}`);
  for (const stat of ['pts', 'reb', 'ast']) {
    const raw = rawBandValues(games, stat);
    console.log(
      `  ${stat}: raw [${raw.map(v => v.toFixed(2)).join(', ')}]  current [${current(raw).join(',')}]  ev-round [${evRound(raw).join(',')}]`
    );
  }
}
