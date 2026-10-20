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
//   extra              the cards a coach adds to its kit, floor by floor: extra=0,0,0,3,5,6
//   singles / bossextra / bossrares / home   the coach's deck and home court (2026-10-20)
//   start              your starting cap (the five you bring)
//   human              your side's iq (0..1; default 1, the coach's own play)
//
// The coach plays both sides (simulateGame). "You" are a simple drafter: a
// random five under $2,200, the playbook that fits, a random boon, a random
// open stop; takes the first strat that leans to the playbook while the deck
// is under 20, the priciest player offered, rests before the boss and when the
// starters' summed penalty is -12 or worse, and practises a kit card otherwise; never retires. A
// human should draft better, so the numbers here are a floor for you.
import {
  CLIMB, CLIMB_FIVE, newRun, chooseCamp, openStops, chooseStop, presetFor, recordResult, resultFromGame,
  pickStrat, pickPlayer, pickPerk, skipOffers, restDay, rosterCards, potPreview,
} from '../../src/game/modes/run.js';
import { climbRng, KIND_WEIGHTS, stopById } from '../../src/game/modes/climbMap.js';
import { leanOf } from '../../src/game/modes/climbKits.js';
import { PERKS, practicable, perkProblem, boostsOf, boostedCard } from '../../src/game/modes/climbPerks.js';
import { cardFit } from '../../src/game/cardFit.js';
import { fitsSystem } from '../../src/game/systemFit.js';
import { STRAT_MAP } from '../../src/game/strats.js';
import { simulateGame } from '../../src/game/modes/simulate.js';
import * as ai from '../../src/game/ai.js';
import { fatigueForMinutes } from '../../src/game/engine.js';
import { isPlus, PLUS } from '../../src/game/strats.js';
import { CARDS } from '../../src/game/cards.js';
import { cardKey } from '../../src/game/cardSets.js';
import { capSal } from '../../src/game/teamRules.js';

const args = process.argv.slice(2);
const positional = args.filter(a => !a.includes('='));
const overrides = Object.fromEntries(args.filter(a => a.includes('=')).map(a => a.split('=')).map(([k, v]) => [k, k === 'caps' ? v.split(',').map(Number) : k === 'policy' || k === 'extra' || k === 'rare' || k === 'drafter' ? v : Number(v)]));
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
// extra=0,0,0,3,5,6: the cards the coach adds to its kit, floor by floor.
// singles=0 (two of a kit's doubles), bossextra=9, bossrares=1, home=0 (always
// away): the coach's deck and home court as they were before 2026-10-20.
if (overrides.extra) {
  const extras = String(overrides.extra).split(',').map(Number);
  CLIMB.coachDeckExtra = f => extras[Math.min(extras.length, f) - 1];
}
if (overrides.singles != null) CLIMB.coachSingles = Boolean(overrides.singles);
if (overrides.bossextra != null) CLIMB.bossDeckExtra = overrides.bossextra;
if (overrides.bossrares != null) CLIMB.bossDeckRares = Boolean(overrides.bossrares);
if (overrides.home != null) CLIMB.homeKinds = overrides.home ? ['game'] : [];
// homeboss=1: the boss game at home too (measured 2026-10-20).
if (overrides.homeboss) CLIMB.homeKinds = [...CLIMB.homeKinds, 'boss'];
// The scaling dials (2026-10-19, "each move up the ladder should feel like a
// big step"): capstep=450 (cap per floor), rare=0.1,0.45 (rare chance floor 1
// to 7), playerg / playerr / perkg / perkr (drop chances), climbonly=0.5.
if (overrides.capstep != null) CLIMB.capPerFloor = overrides.capstep;
if (overrides.rare) { const [r1, r7] = String(overrides.rare).split(',').map(Number); CLIMB.rareChance = f => r1 + (r7 - r1) * (f - 1) / 6; }
if (overrides.playerg != null) CLIMB.drops.game.player = overrides.playerg;
if (overrides.playerr != null) CLIMB.drops.rivalry.player = overrides.playerr;
if (overrides.perkg != null) CLIMB.drops.game.perk = overrides.perkg;
if (overrides.perkr != null) CLIMB.drops.rivalry.perk = overrides.perkr;
if (overrides.climbonly != null) CLIMB.climbOnlyChance = overrides.climbonly;
if (overrides.rivpicks != null) CLIMB.rivalryPicks = overrides.rivpicks;
// system=0 turns In System off (systemFit.js, 2026-10-20), to measure what it adds.
if (overrides.system != null) CLIMB.system = !!overrides.system;
// start=2400: your starting cap (the five you bring)
if (overrides.start != null) { CLIMB.startCap = overrides.start; CLIMB_FIVE.cap = overrides.start; }
if (overrides.rec != null) CLIMB.recovery.base = overrides.rec;
if (overrides.rec10 != null) CLIMB.recovery.by10 = overrides.rec10;
if (overrides.rec20 != null) CLIMB.recovery.by20 = overrides.rec20;

// human=0.6: "you" play at this iq (aiLevels.js's first lever: the chance of
// the considered play), the coach at full strength. The default, 1, is the
// coach on both sides; a person misplays, so the simulated runs read easier
// than the user finds them (2026-10-19: "This game is very very hard to win").
const HUMAN_IQ = overrides.human ?? 1;
const humanBrain = HUMAN_IQ >= 1 ? null : {
  ...ai,
  aiPlacementPick: (g, k, o = {}) => ai.aiPlacementPick(g, k, { ...o, iq: HUMAN_IQ }),
  aiDraftPick: (g, k, o = {}) => ai.aiDraftPick(g, k, { ...o, iq: HUMAN_IQ }),
  aiTurn: (g, k, o = {}) => ai.aiTurn(g, k, { ...o, iq: HUMAN_IQ }),
  aiScoringDecision: (g, k, o = {}) => ai.aiScoringDecision(g, k, { ...o, iq: HUMAN_IQ }),
  aiSpendDecision: (g, k, o = {}) => ai.aiSpendDecision(g, k, { ...o, iq: HUMAN_IQ }),
  aiReactionDecision: (g, k, t, o = {}) => ai.aiReactionDecision(g, k, t, { ...o, iq: HUMAN_IQ }),
};

// THE COACH AT ITS RUNG (2026-10-19): the real game's coach searches
// samplesOf(rung) of your lineups (Prince 16, Deity 64); the sim used 16 at
// every rung, so Deity read easier than it plays.
const { samplesOf } = await import('../../src/game/aiLevels.js');
const coachBrain = { ...ai, aiPlacementPick: (g, k, o = {}) => ai.aiPlacementPick(g, k, { ...o, samples: samplesOf(RUNG) }) };

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

// ── THE DRAFTERS (2026-10-19, the user: skill should improve the odds "a ton",
// and skill is "roster building and deck scaling") ──────────────────────────
// drafter=careless  takes whatever is offered, at random; rests or practises at random
// drafter=plain     the simple drafter every earlier number was measured with
// drafter=careful   a focused deck (cards its team fits, its playbook's or any
//                   playbook's, the rarest first, skips the rest), cuts the cards
//                   nobody can use, perks on its star, Rivalries when fresh and
//                   Rest Days when worn
// The gap between careless and careful is how much skill moves the odds.
const DRAFTER = overrides.drafter ?? 'plain';
const deckCount = deck => Object.values(deck ?? {}).reduce((s, n) => s + n, 0);
const teamOf = run => { const b = boostsOf(run); return rosterCards(run).cards.map(c => boostedCard(c, b[c.id])); };
const painOf = run => [...rosterCards(run).cards].sort((a, b) => b.salary - a.salary).slice(0, 5).reduce((t, c) => t + fatigueForMinutes(run.fatigue[c.id] ?? 0), 0);
const fits = (run, id) => { const f = cardFit(id, teamOf(run)); return !f || f.ok; };
const onPlan = (run, id) => { const l = leanOf(id); return l == null || l === run.playbook; };
const RANK = { legendary: 4, rare: 3, uncommon: 2, common: 1 };
const worth = id => (RANK[STRAT_MAP[id]?.rarity] ?? 1) + (STRAT_MAP[id]?.climbOnly ? 0.5 : 0);
const starsFirst = run => [...rosterCards(run).cards].sort((a, b) => b.salary - a.salary).map(c => c.id);

function chooseRoute(run, rng) {
  const stops = openStops(run);
  if (DRAFTER !== 'careful') return pick(rng, stops);
  const pain = painOf(run);
  const want = pain <= -8 ? ['rest', 'game', 'rivalry'] : pain >= -4 ? ['rivalry', 'game', 'rest'] : ['game', 'rivalry', 'rest'];
  for (const kind of want) { const s = stops.find(x => x.kind === kind); if (s) return s; }
  return stops[0];
}

function restChoice(run, rng) {
  const prac = Object.keys(run.deck).filter(id => !isPlus(id) && PLUS[id]);
  const beforeBoss = stopById(run.map, run.restAt)?.floor === 7;
  if (DRAFTER === 'careless') {
    return rng() < 0.5 || !prac.length ? { choice: 'rest' } : { choice: 'practice', cardId: pick(rng, prac) };
  }
  if (DRAFTER === 'careful') {
    if (beforeBoss || painOf(run) <= -10) return { choice: 'rest' };
    const dead = Object.keys(run.deck).filter(id => run.deck[id] > 0 && (!fits(run, id) || !onPlan(run, id)));
    // cut=0: the careful drafter without cutting, to measure what the cut adds.
    if (overrides.cut !== 0 && dead.length && deckCount(run.deck) > 12) return { choice: 'cut', cardId: dead.sort((a, b) => worth(a) - worth(b))[0] };
    const good = prac.filter(id => fits(run, id) && onPlan(run, id)).sort((a, b) => worth(b) - worth(a));
    return good.length ? { choice: 'practice', cardId: good[0] } : { choice: 'rest' };
  }
  // plain: rest before the boss and when worn, else practise at random.
  const wantRest = POLICY === 'rest' || beforeBoss || !prac.length || (POLICY === 'mixed' && painOf(run) <= -12);
  return wantRest ? { choice: 'rest' } : { choice: 'practice', cardId: pick(rng, prac) };
}

function takeRewards(run, rng) {
  const ids = () => rosterCards(run).cards.map(c => c.id);
  if (DRAFTER === 'careless') {
    while (run.status === 'reward' && run.offers?.picks > 0 && run.offers.strats.length) run = pickStrat(run, pick(rng, run.offers.strats));
    if (run.status === 'reward' && run.offers?.players?.length) run = pickPlayer(run, pick(rng, run.offers.players));
    if (run.status === 'reward' && run.offers?.perks?.length) {
      const id = pick(rng, run.offers.perks);
      const options = PERKS[id].target === 'card' ? practicable(run.deck) : ids().filter(cid => !perkProblem(run, id, cid, ids()));
      run = options.length ? pickPerk(run, id, pick(rng, options)) : skipOffers(run, 'perks');
    }
    return run.status === 'reward' ? skipOffers(run) : run;
  }
  if (DRAFTER === 'careful') {
    while (run.status === 'reward' && run.offers?.picks > 0 && run.offers.strats.length) {
      const want = run.offers.strats.filter(id => fits(run, id) && onPlan(run, id)).sort((a, b) => worth(b) - worth(a));
      if (!want.length || deckCount(run.deck) >= 18) { run = skipOffers(run, 'strats'); break; }
      run = pickStrat(run, want[0]);
    }
    if (run.status === 'reward' && run.offers?.players?.length) {
      // In System first (when it is on), then the dearest.
      const card = k => rosterCards({ roster: [k] }).cards[0];
      const sys = k => (CLIMB.system && fitsSystem(run.playbook, card(k)) ? 1 : 0);
      const best = [...run.offers.players].sort((a, b) => sys(b) - sys(a) || (card(b)?.salary ?? 0) - (card(a)?.salary ?? 0))[0];
      run = pickPlayer(run, best);
    }
    if (run.status === 'reward' && run.offers?.perks?.length) {
      const order = ['extra_reps', 'gym_rat', 'signature_move', 'film_study'];
      const id = [...run.offers.perks].sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
      const target = PERKS[id].target === 'card'
        ? practicable(run.deck).filter(x => fits(run, x) && onPlan(run, x)).sort((a, b) => worth(b) - worth(a))[0] ?? practicable(run.deck)[0]
        : starsFirst(run).find(cid => !perkProblem(run, id, cid, ids()));
      run = target ? pickPerk(run, id, target) : skipOffers(run, 'perks');
    }
    return run.status === 'reward' ? skipOffers(run) : run;
  }
  return null;   // plain: the loop's own branch
}

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
      run = chooseStop(run, chooseRoute(run, rng).id);
    } else if (run.status === 'rest') {
      run = restDay(run, restChoice(run, rng));
    } else if (run.status === 'game') {
      const stop = stopById(run.map, run.game.stopId);
      const p = presetFor(run);
      if (stop.kind === 'boss') { reachedBoss += 1; bossSalaries.push(capSal(p.rosterA)); }
      const starters = [...p.rosterA].sort((a, b) => b.salary - a.salary).slice(0, 5);
      if (starters.some(c => fatigueForMinutes(run.fatigue[c.id] ?? 0) <= -6)) tiredOpens += 1;
      games += 1;
      ourSalary[stop.floor - 1].push(capSal(p.rosterA));
      const sim = simulateGame(p.rosterA, p.rosterB, { deckA: p.deckA, deckB: p.deckB, rng: climbRng(seed, 'game', stop.id), keepGame: true, gameOpts: p.gameOpts, brains: { ...(humanBrain ? { A: humanBrain } : {}), B: coachBrain } });
      const result = resultFromGame(sim.game, stop.id);
      const t = byKind[stop.kind];
      t.played += 1; byFloor[stop.floor - 1].played += 1;
      if (stop.kind === 'boss') bossGames.push({ salary: capSal(p.rosterA), won: result.won });
      if (result.won) { t.won += 1; byFloor[stop.floor - 1].won += 1; } else deaths[stop.floor] += 1;
      run = recordResult(run, result);
    } else if (run.status === 'reward' && DRAFTER !== 'plain') {
      run = takeRewards(run, rng);
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
      // A Rivalry's perk: the first offered, on the priciest player (or Film Study's first card).
      if (run.status === 'reward' && run.offers?.perks?.length) {
        const id = run.offers.perks[0];
        const target = PERKS[id].target === 'card'
          ? practicable(run.deck)[0]
          : [...rosterCards(run).cards].sort((a, b) => b.salary - a.salary).map(c => c.id).find(cid => !perkProblem(run, id, cid, rosterCards(run).cards.map(c => c.id)));
        run = target ? pickPerk(run, id, target) : skipOffers(run, 'perks');
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
console.log(`The Climb, ${RUNS} simulated runs at ${RUNG} (seed ${SEED}), drafter: ${DRAFTER}, Rest Day policy: ${POLICY}`);
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
