/**
 * THE AI DUEL: the shipped brain against another, same rosters, sides swapped.
 *
 *   node scripts/analysis/runAiDuel.js [games] --old=src/game/ai.legacy.local.js [--only=placement|cards]
 *
 * An AI change is not an improvement because it reads better; it is one if
 * it wins. This plays `games` matches between two ten-card rosters drawn
 * inside the salary band, the current ai.js on one side and the module named
 * by --old on the other, and swaps the sides every game so neither the A
 * chair's first placement nor B's last answer tilts the count. It reports the
 * new brain's win rate with a 95% interval and the mean margin.
 *
 * --only=placement puts the new placement pick on an otherwise-old brain;
 * --only=cards the new card judgement on an old placement — so a gain can be
 * attributed to the change that made it.
 *
 * The old module is a plain copy of a previous ai.js dropped beside it
 * (`git show <sha>:src/game/ai.js > src/game/ai.legacy.local.js`) so its
 * relative imports resolve. Do not commit the copy.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { simulateGame } from '../../src/game/modes/simulate.js';
import * as fresh from '../../src/game/ai.js';
import { CARDS } from '../../src/game/cards.js';
import { CAP, RANDOM_MIN_SAL } from '../../src/game/teamRules.js';

const GAMES = Number(process.argv[2] ?? 300);
const OLD = (process.argv.find(a => a.startsWith('--old=')) ?? '--old=src/game/ai.legacy.local.js').split('=')[1];
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '--only=').split('=')[1] || null;

let seed = Number((process.argv.find(a => a.startsWith('--seed=')) ?? '--seed=20260908').split('=')[1]);
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

/** A legal ten-card team inside the salary band, drawn with the duel's rng. */
function roster(taken) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const target = RANDOM_MIN_SAL + Math.floor(rng() * (CAP - RANDOM_MIN_SAL + 1));
    const pool = CARDS.filter(c => !taken.has(c.id)).sort(() => rng() - 0.5);
    const out = [];
    let sal = 0;
    for (const c of pool) {
      if (out.length >= 10) break;
      const left = 9 - out.length;
      if (sal + c.salary > CAP) continue;
      if (left > 0 && sal + c.salary + left * 80 > CAP) continue;
      if (out.length === 9 && sal + c.salary < RANDOM_MIN_SAL) continue;
      out.push(c); sal += c.salary;
    }
    if (out.length === 10 && sal >= RANDOM_MIN_SAL && sal <= CAP && Math.abs(sal - target) < 400) {
      for (const c of out) taken.add(c.id);
      return out;
    }
  }
  throw new Error('could not draw a roster');
}

const old = await import(pathToFileURL(path.resolve(OLD)).href);
const newBrain = ONLY === 'placement' ? { ...old, aiPlacementPick: fresh.aiPlacementPick }
  : ONLY === 'cards' ? { ...fresh, aiPlacementPick: old.aiPlacementPick }
    : fresh;
const oldBrain = old;

let wins = 0, losses = 0, ties = 0, margin = 0;
const t0 = Date.now();
for (let i = 0; i < GAMES; i += 1) {
  const taken = new Set();
  const r1 = roster(taken);
  const r2 = roster(taken);
  const newIsA = i % 2 === 0;
  const res = simulateGame(r1, r2, { rng, brains: newIsA ? { A: newBrain, B: oldBrain } : { A: oldBrain, B: newBrain } });
  const newScore = newIsA ? res.scoreA : res.scoreB;
  const oldScore = newIsA ? res.scoreB : res.scoreA;
  if (newScore > oldScore) wins += 1; else if (newScore < oldScore) losses += 1; else ties += 1;
  margin += newScore - oldScore;
  if ((i + 1) % 50 === 0) process.stdout.write(`  ${i + 1} games… new ${wins}-${losses}-${ties}\n`);
}
const n = wins + losses;
const p = n ? wins / n : 0;
const ci = n ? 1.96 * Math.sqrt(p * (1 - p) / n) : 0;
console.log(`\nnew${ONLY ? ` (${ONLY} only)` : ''} vs old (${path.basename(OLD)}), ${GAMES} games, sides swapped each game`);
console.log(`  new wins ${wins}, old wins ${losses}, ties ${ties}`);
console.log(`  new win rate ${(100 * p).toFixed(1)}% ± ${(100 * ci).toFixed(1)} (95%)   mean margin ${(margin / GAMES).toFixed(2)} pts`);
console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
