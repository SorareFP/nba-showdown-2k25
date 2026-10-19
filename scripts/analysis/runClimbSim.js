// THE CLIMB, SIMULATED — sets the numbers before anyone plays
// (docs/plans/2026-10-18-the-climb.md, Task 10).
//
//   node scripts/analysis/runClimbSim.js [runs=300] [rung=prince] [seed=1] [key=value ...]
//
// Keys override the starting values for one run of the script:
//   floor1, floor7     the Game cap at floor 1 and floor 7 (linear between)
//   caps               the Game cap floor by floor, seven numbers: caps=1700,1750,...
//   rivalry            a Rivalry's extra cap
//   boss               the boss's cap
//   rest, rivalryW     the kind weights for floors 2-6 (game takes the rest)
//   rec, rec10, rec20  minutes of recovery between games, by the win's margin
//   decks              the coach's deck size floor by floor, the boss last: decks=15,15,15,19,20,21,22,25
//   start              your starting cap (the five you bring)
//
// The coach plays both sides (simulateGame). "You" are a simple drafter: a
// random five under $2,200, the playbook that fits, a random boon, a random
// open stop; takes the first strat that leans to the playbook while the deck
// is under 20, the priciest player offered, rests before the boss and when the
// starters' summed penalty is -12 or worse, and practises a kit card otherwise; never retires. A
// human should draft better, so the numbers here are a floor for you.
import {
  CLIMB, CLIMB_FIVE, newRun, chooseCamp, openStops, chooseStop, presetFor, recordResult, resultFromGame,
  pickStrat, pickPlayer, skipOffers, restDay, rosterCards, potPreview,
} from '../../src/game/modes/run.js';
import { climbRng, KIND_WEIGHTS, stopById } from '../../src/game/modes/climbMap.js';
import { leanOf } from '../../src/game/modes/climbKits.js';
import { simulateGame } from '../../src/game/modes/simulate.js';
import { fatigueForMinutes } from '../../src/game/engine.js';
import { isPlus, PLUS } from '../../src/game/strats.js';
import { CARDS } from '../../src/game/cards.js';
import { cardKey } from '../../src/game/cardSets.js';
import { capSal } from '../../src/game/teamRules.js';

const args = process.argv.slice(2);
const positional = args.filter(a => !a.includes('='));
const overrides = Object.fromEntries(args.filter(a => a.includes('=')).map(a => a.split('=')).map(([k, v]) => [k, k === 'caps' ? v.split(',').map(Number) : k === 'policy' || k === 'decks' ? v : Number(v)]));
// policy=rest       rest at every Rest Day
// policy=practice   practise at every Rest Day but the one before the boss
// (default)         rest when worn (-12 or worse) or before the boss, else practise
const POLICY = overrides.policy ?? 'mixed';
const RUNS = Number(positional[0] ?? 300);
const RUNG = positional[1] ?? 'prince';
const SEED = Number(positional[2] ?? 1);

// ── The overrides, applied to the shared objects for this process only ─────
if (overrides.floor1 != null || overrides.floor7 != null) {
  const f1 = overrides.floor1 ?? CLIMB.floorCap(1);
  const f7 = overrides.floor7 ?? CLIMB.floorCap(7);
  CLIMB.floorCap = f => Math.round(f1 + (f - 1) * (f7 - f1) / 6);
}
if (overrides.caps) CLIMB.floorCap = f => overrides.caps[f - 1];
if (overrides.rivalry != null) CLIMB.rivalryExtra = overrides.rivalry;
if (overrides.boss != null) CLIMB.bossCap = overrides.boss;
if (overrides.rest != null || overrides.rivalryW != null) {
  KIND_WEIGHTS.rest = overrides.rest ?? KIND_WEIGHTS.rest;
  KIND_WEIGHTS.rivalry = overrides.rivalryW ?? KIND_WEIGHTS.rivalry;
  KIND_WEIGHTS.game = Math.max(0, 1 - KIND_WEIGHTS.rest - KIND_WEIGHTS.rivalry);
}
// decks=15,15,15,19,20,21,22,25: the coach's deck size floor by floor, the boss last
if (overrides.decks) {
  const sizes = String(overrides.decks).split(',').map(Number);
  CLIMB.coachDeckSize = f => sizes[Math.min(sizes.length, f) - 1];
}
// start=2400: your starting cap (the five you bring)
if (overrides.start != null) { CLIMB.startCap = overrides.start; CLIMB_FIVE.cap = overrides.start; }
if (overrides.rec != null) CLIMB.recovery.base = overrides.rec;
if (overrides.rec10 != null) CLIMB.recovery.by10 = overrides.rec10;
if (overrides.rec20 != null) CLIMB.recovery.by20 = overrides.rec20;

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/** A random five under the starting cap, one card a player. */
function startingFive(rng) {
  const pool = CARDS.filter(c => (c.salary ?? 0) <= 800);
  for (;;) {
    const five = [];
    const ids = new Set();
    while (five.length < 5) {
      const c = pick(rng, pool);
      if (ids.has(c.id)) continue;
      ids.add(c.id);
      five.push(c);
    }
    if (capSal(five) <= CLIMB.startCap && capSal(five) >= CLIMB.startCap - 300) return five.map(cardKey);
  }
}

const tally = () => ({ played: 0, won: 0 });
const byKind = { game: tally(), rivalry: tally(), boss: tally() };
const byFloor = Array.from({ length: 8 }, tally);
let reachedBoss = 0;
let wonAct = 0;
const bossSalaries = [];
const bossGames = [];
const pots = [];
let tiredOpens = 0;
let games = 0;
const deaths = Array(9).fill(0);
const ourSalary = Array.from({ length: 8 }, () => []);

for (let i = 0; i < RUNS; i += 1) {
  const seed = SEED * 100000 + i;
  const rng = climbRng(seed, 'sim');
  let run = newRun({ id: `sim${i}`, seed, rung: RUNG, rosterKeys: startingFive(rng), now: 0 });
  const boon = pick(rng, run.camp.boons);
  let cuts = [];
  if (boon === 'cut_two') cuts = ['switch_the_screen', 'burned_switch'];
  run = chooseCamp(run, { playbook: run.camp.fits, boon, cuts });

  for (let guard = 0; guard < 60; guard += 1) {
    if (run.status === 'map') {
      run = chooseStop(run, pick(rng, openStops(run)).id);
    } else if (run.status === 'rest') {
      const starters = rosterCards(run).cards.sort((a, b) => b.salary - a.salary).slice(0, 5);
      const pain = starters.reduce((t, c) => t + fatigueForMinutes(run.fatigue[c.id] ?? 0), 0);
      const practicable = Object.keys(run.deck).filter(id => !isPlus(id) && PLUS[id]);
      // Rest before the boss always (floor 7), and whenever the five are worn.
      const beforeBoss = stopById(run.map, run.restAt)?.floor === 7;
      const wantRest = POLICY === 'rest' || beforeBoss || !practicable.length || (POLICY === 'mixed' && pain <= -12);
      run = wantRest
        ? restDay(run, { choice: 'rest' })
        : restDay(run, { choice: 'practice', cardId: pick(rng, practicable) });
    } else if (run.status === 'game') {
      const stop = stopById(run.map, run.game.stopId);
      const p = presetFor(run);
      if (stop.kind === 'boss') { reachedBoss += 1; bossSalaries.push(capSal(p.rosterA)); }
      const starters = [...p.rosterA].sort((a, b) => b.salary - a.salary).slice(0, 5);
      if (starters.some(c => fatigueForMinutes(run.fatigue[c.id] ?? 0) <= -6)) tiredOpens += 1;
      games += 1;
      ourSalary[stop.floor - 1].push(capSal(p.rosterA));
      const sim = simulateGame(p.rosterA, p.rosterB, { deckA: p.deckA, deckB: p.deckB, rng: climbRng(seed, 'game', stop.id), keepGame: true, gameOpts: p.gameOpts });
      const result = resultFromGame(sim.game, stop.id);
      const t = byKind[stop.kind];
      t.played += 1; byFloor[stop.floor - 1].played += 1;
      if (stop.kind === 'boss') bossGames.push({ salary: capSal(p.rosterA), won: result.won });
      if (result.won) { t.won += 1; byFloor[stop.floor - 1].won += 1; } else deaths[stop.floor] += 1;
      run = recordResult(run, result);
    } else if (run.status === 'reward') {
      const o = run.offers;
      const size = Object.values(run.deck).reduce((s, n) => s + n, 0);
      const want = o.strats.find(id => leanOf(id) === run.playbook);
      if (want && size < 20 && o.picks > 0) run = pickStrat(run, want);
      else if (o.strats.length) run = skipOffers(run, 'strats');
      if (run.status === 'reward' && run.offers?.players?.length) {
        const best = [...run.offers.players].sort((a, b) => (rosterCards({ roster: [b] }).cards[0]?.salary ?? 0) - (rosterCards({ roster: [a] }).cards[0]?.salary ?? 0))[0];
        run = pickPlayer(run, best);
      }
      if (run.status === 'reward') run = skipOffers(run);
    } else {
      break;
    }
  }
  if (run.status === 'won') { wonAct += 1; pots.push(potPreview(run).coins); }
}

const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : '—');
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
console.log(`The Climb, ${RUNS} simulated runs at ${RUNG} (seed ${SEED}), Rest Day policy: ${POLICY}`);
console.log(`caps: floor 1 $${CLIMB.floorCap(1)} → floor 7 $${CLIMB.floorCap(7)}, rivalry +$${CLIMB.rivalryExtra}, boss $${CLIMB.bossCap}; recovery ${JSON.stringify(CLIMB.recovery)}; kinds ${JSON.stringify(KIND_WEIGHTS)}`);
for (const [k, t] of Object.entries(byKind)) console.log(`  ${k.padEnd(8)} won ${pct(t.won, t.played)} of ${t.played}`);
console.log(`  by floor: ${byFloor.map((t, f) => `${f + 1}:${pct(t.won, t.played)}(${t.played})`).join('  ')}`);
console.log(`  runs ending on floor: ${deaths.map((n, f) => (f ? `${f}:${n}` : '')).filter(Boolean).join(' ')}`);
console.log(`  reached the boss ${pct(reachedBoss, RUNS)}, won the act ${pct(wonAct, RUNS)} (${pct(wonAct, reachedBoss)} of boss games)`);
console.log(`  median roster salary at the boss $${median(bossSalaries)} → boss cap at x1.3: $${Math.round(median(bossSalaries) * 1.3)}`);
console.log(`  your roster salary at each floor (median): ${ourSalary.map((xs, f) => `${f + 1}:$${median(xs)}`).join('  ')}`);
{
  const mid = median(bossSalaries);
  const hi = bossGames.filter(g => g.salary > mid);
  const lo = bossGames.filter(g => g.salary <= mid);
  console.log(`  the boss: won ${pct(hi.filter(g => g.won).length, hi.length)} by teams above the median salary, ${pct(lo.filter(g => g.won).length, lo.length)} at or below`);
}
console.log(`  median pot of a won act ${median(pots)} coins; games a starter opened at -6 or worse ${pct(tiredOpens, games)}`);
