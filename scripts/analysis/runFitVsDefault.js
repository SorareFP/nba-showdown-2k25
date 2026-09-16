/**
 * THE SHIPPED FITTER, MEASURED THE HONEST WAY.
 *
 *   node scripts/analysis/runFitVsDefault.js [games] [--cutoff 1.0]
 *
 * runDeckBuild.js measured a deck profiled FOR a roster on that same roster —
 * +6.23 a game for FAST. What shipped is different: a CLASSIFIER (deckFit.js)
 * that hands a random roster the nearest archetype's deck when it is within
 * FIT_CUTOFF standard deviations, and the default fifty otherwise. Whether
 * that pays over rosters nobody profiled is the question this answers.
 *
 * Mirror matches over random cap-legal tens: the same roster on both benches,
 * one side on fitDeck(roster), the other on the default fifty. Rosters the
 * classifier leaves on the default are a genuine 50/50 (both sides identical)
 * and are counted separately, so the row that matters is the FITTED one: the
 * rosters the classifier actually acted on, and whether acting helped.
 *
 * `--cutoff` overrides FIT_CUTOFF so the dial can be set by measurement rather
 * than by the round number it started at.
 */
import { simulateGame } from '../../src/game/modes/simulate.js';
import { CARDS } from '../../src/game/cards.js';
import { CAP, RANDOM_MIN_SAL } from '../../src/game/teamRules.js';
import { fitDeck, nearestArchetype, FIT_CUTOFF } from '../../src/game/deckFit.js';

const GAMES = Number(process.argv.find(a => /^\d+$/.test(a)) ?? 800);
const args = process.argv.slice(2);
const cutoff = args.includes('--cutoff') ? Number(args[args.indexOf('--cutoff') + 1]) : FIT_CUTOFF;

let seed = 0x5eed1;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

function roster() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const pool = [...CARDS].sort(() => rng() - 0.5);
    const out = [];
    let sal = 0;
    for (const c of pool) {
      if (out.length >= 10) break;
      const left = 9 - out.length;
      if (sal + c.salary > CAP) continue;
      if (left > 0 && sal + c.salary + left * 80 > CAP) continue;
      out.push(c); sal += c.salary;
    }
    if (out.length === 10 && sal >= RANDOM_MIN_SAL) return out;
  }
  throw new Error('no roster');
}

const rows = { fitted: { n: 0, wins: 0, margin: 0, by: {} }, default: { n: 0, wins: 0, margin: 0 } };
for (let i = 0; i < GAMES; i += 1) {
  const r = roster();
  const deck = fitDeck(r, { cutoff });
  const near = nearestArchetype(r);
  const row = deck ? rows.fitted : rows.default;
  const mineIsA = i % 2 === 0;
  const res = simulateGame(r, r, { deckA: mineIsA ? deck : null, deckB: mineIsA ? null : deck });
  const mine = mineIsA ? res.scoreA : res.scoreB;
  const theirs = mineIsA ? res.scoreB : res.scoreA;
  row.n += 1;
  if (mine > theirs) row.wins += 1;
  row.margin += mine - theirs;
  if (deck && near) {
    const b = row.by[near.id] ?? (row.by[near.id] = { n: 0, wins: 0, margin: 0 });
    b.n += 1; if (mine > theirs) b.wins += 1; b.margin += mine - theirs;
  }
}

const line = (label, r) => {
  if (!r.n) return `  ${label.padEnd(14)} (none)`;
  const p = r.wins / r.n;
  const ci = 1.96 * Math.sqrt((p * (1 - p)) / r.n) * 100;
  return `  ${label.padEnd(14)} n=${String(r.n).padStart(4)}   ${(100 * p).toFixed(1).padStart(5)}%  ±${ci.toFixed(1).padStart(4)}   ${(r.margin / r.n >= 0 ? '+' : '') + (r.margin / r.n).toFixed(2)}`;
};
console.log(`THE SHIPPED FITTER vs THE DEFAULT FIFTY — ${GAMES} random rosters, mirror matches, cutoff ${cutoff}\n`);
console.log('  rosters        games     win%    95% CI   margin');
console.log(line('fitted', rows.fitted));
for (const [id, r] of Object.entries(rows.fitted.by)) console.log(line(`  as ${id}`, r));
console.log(line('left default', rows.default) + '   <- both benches identical: a control, should read 50%');
console.log(`\n  the classifier acted on ${(100 * rows.fitted.n / GAMES).toFixed(0)}% of random rosters at cutoff ${cutoff}`);
