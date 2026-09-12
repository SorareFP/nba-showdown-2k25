/**
 * HOW MUCH OF A BAD DEFENDER'S LIABILITY ACTUALLY HAPPENS?
 *
 *   node scripts/analysis/runDefenceWeight.js [games]
 *
 * The salary model prices three channels and every one of them is offensive
 * (playValue.js): it measures the roll bonus a card GETS when it attacks and
 * never asks what it CONCEDES. The user, 2026-09-12, on Will Riley: "he plays
 * as a 1 SPD/1 PWR on defense, so he's going to give up MASSIVE matchup
 * advantages ... I just want to make sure the weighting is right."
 *
 * The weight cannot be assumed, because a card's average liability against the
 * whole field is NOT what it costs you in a game. The placement snake lets a
 * coach hide his worst defender on the opponent's weakest attacker, and hiding
 * is a skill the game already rewards. So the question this answers is:
 *
 *     realised = what the man actually gave up, per defensive roll, in play
 *     field    = what he gives up against the whole field, on average
 *     delta    = realised / field
 *
 * delta is the weight. At 1 the average is the truth and hiding buys nothing;
 * at 0.6 a card only ever pays six tenths of its paper liability. Measured
 * from real simulated games through the engine's own `alw` counter — the
 * matchup plus-minus it already keeps — rather than from a model of a model.
 *
 * ONE CAVEAT ON THE ABSOLUTE NUMBER. `alw` counts every point the man he
 * guarded scored — scoring rolls, shot checks and card buckets alike — while
 * `paper` is the chart channel only, so the ratio runs above one and is not a
 * clean fraction. What decides the weight is whether the ratio is FLAT: if the
 * worst defenders realise the same share of their paper liability as the best,
 * then hiding does not rescue them and the weight is full.
 */
import { readFileSync } from 'node:fs';
import { evaluateMatchup } from './matchupMatrix.js';
import { expectedChartValue } from './scaleWidening.js';
import { simulateGame } from '../../src/game/modes/simulate.js';
import { CAP, RANDOM_MIN_SAL } from '../../src/game/teamRules.js';

// RANDOM_MIN_SAL is a floor on the TEAM's total spend, not on a card's price.

const GAMES = Number(process.argv[2] ?? 400);

const cards = JSON.parse(readFileSync('card-data/generated/cards-2026-27.json', 'utf8')).cards;

// ── What each card concedes against the whole field, per roll, in points ────
const evCache = new Map();
const ev = (card, b) => {
  const k = `${card.id}|${b}`;
  let v = evCache.get(k);
  if (v === undefined) { v = expectedChartValue(card, b, 'pts'); evCache.set(k, v); }
  return v;
};
const field = new Map();
for (const c of cards) {
  let allowed = 0;
  for (const o of cards) {
    if (o === c) continue;
    allowed += ev(o, evaluateMatchup(o, c).rollBonus);
  }
  field.set(c.id, allowed / (cards.length - 1));
}

// ── Random legal ten-card rosters, the way the duel harness builds them ─────
let seed = 0x51ed;
const rnd = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return ((seed >>> 0) % 1e6) / 1e6;
};
function roster(taken) {
  const pool = cards.filter(c => !taken.has(c.id));
  const picks = [];
  let spent = 0;
  const cheapest = pool.map(c => c.salary).sort((a, b) => a - b);
  while (picks.length < 10) {
    const reserve = cheapest.slice(0, 10 - picks.length - 1).reduce((s, x) => s + x, 0);
    const ok = pool.filter(c => !taken.has(c.id) && spent + c.salary + reserve <= CAP);
    if (!ok.length) break;
    const pick = ok[Math.floor(rnd() * ok.length)];
    taken.add(pick.id);
    picks.push(pick);
    spent += pick.salary;
  }
  // A team that came in under the league's minimum spend is not a team the
  // game would let you field; try again rather than measure a phantom.
  return spent >= RANDOM_MIN_SAL ? picks : null;
}

// ── Play, and read the engine's own points-allowed counter ──────────────────
const seen = new Map();   // id -> { alw, sections }
let played = 0;
for (let g = 0; g < GAMES; g += 1) {
  const taken = new Set();
  const a = roster(taken);
  const b = roster(taken);
  if (!a || !b || a.length < 10 || b.length < 10) continue;
  const res = simulateGame(a, b, { keepGame: true });
  played += 1;
  for (const key of ['A', 'B']) {
    const team = key === 'A' ? res.game.teamA : res.game.teamB;
    for (const ps of team.stats || []) {
      // ONE DEFENSIVE ROLL A SECTION. The placement snake gives each defender
      // exactly one man, so a section on the floor is one roll taken at him —
      // not five. `totalMinutes` counts four to a section.
      const rolls = (ps.totalMinutes || 0) / 4;
      if (rolls <= 0) continue;
      const row = seen.get(ps.id) ?? { alw: 0, rolls: 0 };
      row.alw += ps.alw || 0;
      row.rolls += rolls;
      seen.set(ps.id, row);
    }
  }
}

const rows = [];
for (const c of cards) {
  const row = seen.get(c.id);
  if (!row || row.rolls < 40) continue;
  rows.push({
    name: c.name, peak: Math.max(c.speed, c.power), salary: c.salary,
    realised: row.alw / row.rolls,
    paper: field.get(c.id),
    rolls: row.rolls,
  });
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const wMean = (a, key) => a.reduce((t, r) => t + r[key] * r.rolls, 0) / a.reduce((t, r) => t + r.rolls, 0);

console.log(`${played} games, ${rows.length} cards with enough floor time\n`);
console.log(`paper liability   (vs the whole field): ${wMean(rows, 'paper').toFixed(3)} pts / defensive roll`);
console.log(`realised liability (what actually happened): ${wMean(rows, 'realised').toFixed(3)}`);
console.log(`\nDELTA = ${(wMean(rows, 'realised') / wMean(rows, 'paper')).toFixed(3)}`
  + '   <- the share of paper liability a card actually pays');

// Does hiding help the WORST defenders more than the rest? If it does, the
// weight is not one number and the report should say so.
console.log('\nby paper liability, worst to best:');
const sorted = rows.slice().sort((a, b) => b.paper - a.paper);
const chunk = Math.ceil(sorted.length / 5);
for (let i = 0; i < sorted.length; i += chunk) {
  const g = sorted.slice(i, i + chunk);
  console.log(`   ${String(i + 1).padStart(3)}-${String(Math.min(i + chunk, sorted.length)).padStart(3)}`
    + `  paper ${wMean(g, 'paper').toFixed(3)}  realised ${wMean(g, 'realised').toFixed(3)}`
    + `  delta ${(wMean(g, 'realised') / wMean(g, 'paper')).toFixed(3)}`);
}

const named = ['Will Riley', 'Rickea Jackson', 'Stephen Curry', 'Damian Lillard', 'Victor Wembanyama'];
console.log('\nnamed cards:');
for (const n of named) {
  const r = rows.find(x => x.name === n);
  if (!r) { console.log(`   ${n.padEnd(22)} (not enough floor time)`); continue; }
  console.log(`   ${n.padEnd(22)} $${String(r.salary).padStart(4)}  paper ${r.paper.toFixed(2)}`
    + `  realised ${r.realised.toFixed(2)}  delta ${(r.realised / r.paper).toFixed(2)}`);
}
