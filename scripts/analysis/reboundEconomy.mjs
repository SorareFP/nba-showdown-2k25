// WHAT A REBOUND IS WORTH AGAINST AN ASSIST — per game, AI vs AI.
//
//   node scripts/analysis/reboundEconomy.mjs [games] [--variant=name ...] [--seed=n]
//
// The user (2026-09-23): "assists can be fired for shot checks on an aggregate
// basis, while rebounding is nerfed because it is a net +/-. I'd like to make
// rebounding more important, close to equally important as assists are."
//
// Per team per game: how many of each the charts produce, how many points the
// spends of each turned into, how many were left at the final buzzer; and the
// part each currency plays in WINNING — a linear fit of the win on the chart
// points, rebounds and assists each side produced (the chart's own points are
// in the fit so that a big roll's rebounds are not credited with its points).
// The same seed deals the same rosters to every variant.
import { simulateGame } from '../../src/game/modes/simulate.js';
import { CARDS } from '../../src/game/cards.js';
import { CAP, RANDOM_MIN_SAL } from '../../src/game/teamRules.js';
import { REBOUND_RULES, SPEND_COSTS } from '../../src/game/engine.js';

/** The rule sets under test. `cost` is the rebound paint check's price in REB. */
export const VARIANTS = {
  current: { paintGate: 3, paintBonus: 0, oncePerSection: true, cost: 5 },
  plus3: { paintGate: 3, paintBonus: 3, oncePerSection: true, cost: 5 },
  open5: { paintGate: 0, paintBonus: 0, oncePerSection: false, cost: 5 },
  open6: { paintGate: 0, paintBonus: 0, oncePerSection: false, cost: 6 },
  open8: { paintGate: 0, paintBonus: 0, oncePerSection: false, cost: 8 },
  // Open at 6, and the section's glass winner (3+) takes its check at +2.
  hybrid: { paintGate: 0, paintBonus: 0, oncePerSection: false, cost: 6, leadBonus: 2, leadGate: 3 },
  // Priced like the assist paint check (5), the glass winner's first check at +2.
  hybrid5: { paintGate: 0, paintBonus: 0, oncePerSection: false, cost: 5, leadBonus: 2, leadGate: 3 },
  open4: { paintGate: 0, paintBonus: 0, oncePerSection: false, cost: 4 },
  // hybrid5, and the check needs a Rebound Track lead of its cost (2026-09-24).
  // Measured while the track was the difference of the banks (f5c522ee); since
  // the split the track is rebounds WON and a spend no longer lowers the lead,
  // so these now gate on a lead the spend leaves standing. hybrid5 IS the split.
  lead5: { paintGate: 0, paintBonus: 0, oncePerSection: false, cost: 5, leadBonus: 2, leadGate: 3, leadToSpend: true },
  lead4: { paintGate: 0, paintBonus: 0, oncePerSection: false, cost: 4, leadBonus: 2, leadGate: 3, leadToSpend: true },
  lead3: { paintGate: 0, paintBonus: 0, oncePerSection: false, cost: 3, leadBonus: 2, leadGate: 3, leadToSpend: true },
};

function rngFrom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function roster(rng, taken) {
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

/** Least squares by the normal equations (small k): returns the coefficients. */
function ols(X, y) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let r = 0; r < X.length; r += 1) {
    for (let i = 0; i < k; i += 1) {
      for (let j = 0; j < k; j += 1) A[i][j] += X[r][i] * X[r][j];
      A[i][k] += X[r][i] * y[r];
    }
  }
  for (let c = 0; c < k; c += 1) {
    let p = c;
    for (let r = c + 1; r < k; r += 1) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r += 1) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j <= k; j += 1) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row, i) => row[k] / row[i]);
}
const sd = xs => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };

export function measure(variant, games, seed) {
  const { cost, ...rules } = variant;
  const saved = { ...REBOUND_RULES };
  const savedCost = SPEND_COSTS.reboundPaint;
  Object.assign(REBOUND_RULES, { leadBonus: 0, leadGate: 3, leadToSpend: false, ...rules });
  SPEND_COSTS.reboundPaint = cost;
  const rng = rngFrom(seed);
  const sum = { ast: 0, reb: 0, astPts: 0, rebPts: 0, astLeft: 0, rebLeft: 0, score: 0, rebChecks: 0, teams: 0 };
  const X = []; const y = []; const dReb = []; const dAst = [];
  try {
    for (let i = 0; i < games; i += 1) {
      const taken = new Set();
      const res = simulateGame(roster(rng, taken), roster(rng, taken), { rng, keepGame: true });
      const g = res.game;
      for (const key of ['A', 'B']) {
        const t = key === 'A' ? g.teamA : g.teamB;
        const an = g.analytics?.[key] ?? {};
        sum.ast += an.assistsGenerated || 0;
        sum.reb += an.reboundsGenerated || 0;
        sum.astPts += an.assistSpendPts || 0;
        sum.rebPts += an.reboundBonusPts || 0;
        sum.astLeft += t.assists || 0;
        sum.rebLeft += t.rebounds || 0;
        sum.score += t.score || 0;
        sum.teams += 1;
      }
      for (const line of g.log ?? []) if (/^Rebound Paint Check/.test(line.msg)) sum.rebChecks += 1;
      const a = g.analytics.A; const b = g.analytics.B;
      const row = [1, a.chartPts - b.chartPts, a.reboundsGenerated - b.reboundsGenerated, a.assistsGenerated - b.assistsGenerated];
      X.push(row); dReb.push(row[2]); dAst.push(row[3]);
      y.push(g.teamA.score > g.teamB.score ? 1 : g.teamA.score < g.teamB.score ? 0 : 0.5);
    }
  } finally {
    Object.assign(REBOUND_RULES, saved);
    SPEND_COSTS.reboundPaint = savedCost;
  }
  const [, , bReb, bAst] = ols(X, y);
  const per = k => sum[k] / sum.teams;
  return {
    games,
    astProduced: per('ast'), rebProduced: per('reb'),
    astPts: per('astPts'), rebPts: per('rebPts'),
    astLeft: per('astLeft'), rebLeft: per('rebLeft'),
    rebChecks: per('rebChecks'), score: per('score'),
    // Win chance per unit out-produced, and per standard deviation of the gap.
    winPerReb: bReb, winPerAst: bAst,
    winPerRebSd: bReb * sd(dReb), winPerAstSd: bAst * sd(dAst),
  };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('reboundEconomy.mjs')) {
  const games = Number(process.argv.find(a => /^\d+$/.test(a)) ?? 300);
  const seed = Number((process.argv.find(a => a.startsWith('--seed=')) ?? '--seed=20260923').split('=')[1]);
  const picked = process.argv.filter(a => a.startsWith('--variant=')).map(a => a.split('=')[1]);
  const names = picked.length ? picked : Object.keys(VARIANTS);
  const f = (v, d = 2) => v.toFixed(d).padStart(7);
  console.log(`${games} games per variant, per team per game (seed ${seed})`);
  console.log('variant    REB made  AST made  REB pts  AST pts  REB left AST left REB chks   score  win/REBsd win/ASTsd');
  for (const name of names) {
    const t0 = Date.now();
    const r = measure(VARIANTS[name], games, seed);
    console.log(`${name.padEnd(9)} ${f(r.rebProduced, 1)}  ${f(r.astProduced, 1)}  ${f(r.rebPts)}  ${f(r.astPts)}  ${f(r.rebLeft, 1)}  ${f(r.astLeft, 1)}  ${f(r.rebChecks)}  ${f(r.score, 1)}  ${f(r.winPerRebSd, 3)}   ${f(r.winPerAstSd, 3)}   (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}
