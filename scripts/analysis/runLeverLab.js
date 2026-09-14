/**
 * THE LEVER LAB — one variant of the coach against the shipped one.
 *
 *   node scripts/analysis/runLeverLab.js [games] [--only=name,name]
 *
 * The user, 2026-09-14, on the four judgements the coach makes the same way at
 * every rung: "These are all great. Let's tune these." Each one is a POLICY,
 * not a bug, so the only thing that settles it is whether it wins. This plays
 * each named variant against the shipped brain over the same drawn rosters,
 * swapping sides every game.
 *
 * ── WHAT THIS HARNESS IS FOR, AND WHAT IT CANNOT ANSWER ─────────────────────
 *
 * It answers "does this policy beat the current one, against the current one".
 * It CANNOT answer a question where both sides share the assumption being
 * tested — the trap the placement work fell into (2026-09-14): aiDraftPick
 * takes the top five by lineupValue and guessRemaining predicted the top five
 * by lineupValue, so in AI-vs-AI the guess was the truth by construction and
 * the measurement said a real gain was a loss. Before trusting a number here,
 * ask whether the opponent's behaviour is independent of the thing being
 * varied. If it is not, this harness is the wrong instrument.
 *
 * ── AND IT PRINTS A CONTROL, ALWAYS ─────────────────────────────────────────
 *
 * `control` is the shipped brain on both sides. It should read 50% and +0.0.
 * A control off 50% means the harness is tilted and every other row is
 * suspect. Nothing under a couple of thousand games a variant says anything
 * (see aiLevels.js — one game's dice outweigh the whole difficulty ladder).
 */
import { simulateGame } from '../../src/game/modes/simulate.js';
import * as ai from '../../src/game/ai.js';
import { CARDS } from '../../src/game/cards.js';
import { CAP, RANDOM_MIN_SAL } from '../../src/game/teamRules.js';
import { getTeam, getOpp, getPS, getFatigue, calcAdv } from '../../src/game/engine.js';

const GAMES = Number(process.argv[2] ?? 400);
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '--only=').split('=')[1] || null;

let seed = Number((process.argv.find(a => a.startsWith('--seed=')) ?? '--seed=20260914').split('=')[1]);
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

/** A legal ten-card team inside the salary band — runAiDuel's draw. */
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

// ── LEVER 3: THE ROLL ORDER ─────────────────────────────────────────────────
//
// The shipped coach rolls the best matchup first, always. Three reasons that
// might be wrong, and they pull in opposite directions:
//
//   SPENDS   assists and rebounds banked by an early roll are spendable on a
//            later one (SPEND_COSTS: 1 AST is +1 on the next shot check, 5 is
//            a whole three). Rolling the chart that PAYS in assists first and
//            the scorer last turns those into points; best-first banks them
//            after everyone has already shot.
//   ANSWERS  the opponent answers announced checks from a hand that empties.
//            Rolling your weakest first draws the answers out before the roll
//            that matters.
//   RISK     the greedy read may simply be right — points banked are points.
//
/** What a card's chart pays in assists a roll, at the bonus it carries. */
function assistYield(card, mod) {
  const chart = card?.chart;
  if (!Array.isArray(chart) || !chart.length) return 0;
  let total = 0;
  for (let die = 1; die <= 20; die += 1) {
    // Tiers are { lo, hi, pts, reb, ast } and the roll is NOT clamped to 20 —
    // the top tier runs to 99 precisely so a bonus can reach it.
    const r = die + mod;
    const tier = chart.find(t => r >= t.lo && r <= t.hi) ?? (r < chart[0].lo ? chart[0] : chart[chart.length - 1]);
    total += tier?.ast || 0;
  }
  return total / 20;
}

/** The candidates aiRollDecision is choosing between, rebuilt so a variant can re-order them. */
function rollCandidates(game, teamKey) {
  const myT = getTeam(game, teamKey);
  const oppT = getOpp(game, teamKey);
  const out = [];
  for (let i = 0; i < (myT.starters || []).length; i += 1) {
    const p = myT.starters[i];
    if (!p) continue;
    const rolled = (game.rollResults?.[teamKey] || [])[i];
    const blocked = (game.blockedRolls?.[teamKey] || {})[i];
    if (rolled !== undefined && rolled !== null) continue;
    if (blocked) continue;
    const di = (game.offMatchups?.[teamKey] || [])[i] ?? i;
    const dp = oppT.starters[di];
    const adv = dp ? calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i) : { rollBonus: 0 };
    const ps = getPS(game, teamKey, p.id) || {};
    const mrk = ((ps.hot || 0) - (ps.cold || 0)) * 2;
    out.push({ idx: i, player: p, bonus: adv.rollBonus + getFatigue(game, teamKey, i) + mrk });
  }
  return out;
}

/**
 * Re-order the shipped decision. `rank` is called on each candidate and the
 * highest wins. The CLUTCH branch is left to the shipped function untouched:
 * it is a different decision (which player spends the extra dice) and varying
 * two things at once would make the number unattributable.
 */
const reorderRolls = rank => (game, teamKey) => {
  const shipped = ai.aiRollDecision(game, teamKey);
  if (!shipped || shipped.clutch) return shipped;
  const cands = rollCandidates(game, teamKey);
  if (cands.length < 2) return shipped;
  let best = cands[0];
  let bestR = rank(cands[0]);
  for (const c of cands.slice(1)) {
    const r = rank(c);
    if (r > bestR) { best = c; bestR = r; }
  }
  return { ...shipped, playerIdx: best.idx };
};

const VARIANTS = {
  control: ai,

  // Worst matchup first: the answers come out on the rolls that matter least.
  roll_worst_first: { ...ai, aiRollDecision: reorderRolls(c => -c.bonus) },

  // Assist charts first, so the bank is full when the scorers roll.
  roll_assists_first: {
    ...ai,
    aiRollDecision: reorderRolls(c => assistYield(c.player, c.bonus) * 10 + c.bonus * 0.01),
  },

  // The best CHART last, rather than the best matchup bonus last.
  roll_best_chart_last: {
    ...ai,
    aiRollDecision: reorderRolls(c => -ai.expectedOutput(c.player, c.bonus)),
  },
};

// ── The duel ────────────────────────────────────────────────────────────────
const names = ONLY ? ONLY.split(',') : Object.keys(VARIANTS);
const pairs = [];
for (let i = 0; i < Math.max(8, Math.ceil(GAMES / 8)); i += 1) {
  const taken = new Set();
  pairs.push([roster(taken), roster(taken)]);
}

console.log(`THE LEVER LAB — each variant against the shipped brain, ${GAMES} games\n`);
console.log('  variant                 win%      95% CI    margin');
for (const name of names) {
  const brain = VARIANTS[name];
  if (!brain) { console.log(`  ${name}: no such variant`); continue; }
  let wins = 0, margin = 0;
  for (let i = 0; i < GAMES; i += 1) {
    // FOUR WAYS ROUND, and both halves matter. The first version swapped only
    // the CHAIR and left the variant holding roster r1 every game, so the
    // control read 65% — it was measuring which roster got drawn first, not
    // which brain played. The variant now takes each roster in each chair an
    // equal number of times, so roster strength and the snake's B-leads-first
    // advantage both cancel.
    const [r1, r2] = pairs[Math.floor(i / 4) % pairs.length];
    const mineIsR1 = i % 4 < 2;      // which roster the VARIANT holds
    const mineIsA = i % 2 === 0;     // which chair the VARIANT sits in
    const mineRoster = mineIsR1 ? r1 : r2;
    const theirRoster = mineIsR1 ? r2 : r1;
    const res = simulateGame(mineIsA ? mineRoster : theirRoster, mineIsA ? theirRoster : mineRoster, {
      brains: { A: mineIsA ? brain : ai, B: mineIsA ? ai : brain },
    });
    const mine = mineIsA ? res.scoreA : res.scoreB;
    const theirs = mineIsA ? res.scoreB : res.scoreA;
    if (mine > theirs) wins += 1;
    margin += mine - theirs;
  }
  const p = wins / GAMES;
  const ci = 1.96 * Math.sqrt((p * (1 - p)) / GAMES) * 100;
  console.log(`  ${name.padEnd(22)} ${(100 * p).toFixed(1).padStart(5)}%   ±${ci.toFixed(1).padStart(4)}    ${(margin / GAMES >= 0 ? '+' : '') + (margin / GAMES).toFixed(2)}`);
}
