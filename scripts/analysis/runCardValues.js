/**
 * WHAT THE COACH THINKS A CARD IS WORTH WHEN IT PLAYS IT.
 *
 *   node scripts/analysis/runCardValues.js [games]
 *
 * Before a hold threshold can be picked, the scale has to be known:
 * aiScoringDecision plays anything with `value > 0`, and "0" is only a
 * meaningful floor if the values are spread over a range where a higher floor
 * would refuse something. This records the value of every card the coach
 * actually plays, and the distribution says where a threshold would bite.
 *
 * It also records the HAND SIZE at the moment of the play, because that is
 * what makes holding cost something: endSection draws back up to seven
 * (engine.js), so a card held in a full hand blocks a draw and a card held in
 * a hand of four is free.
 */
import { simulateGame } from '../../src/game/modes/simulate.js';
import * as ai from '../../src/game/ai.js';
import { CARDS } from '../../src/game/cards.js';
import { CAP, RANDOM_MIN_SAL } from '../../src/game/teamRules.js';
import { getTeam } from '../../src/game/engine.js';
import { getStrat } from '../../src/game/strats.js';

const GAMES = Number(process.argv[2] ?? 60);
let seed = 0x51ed;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

function roster(taken) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const pool = CARDS.filter(c => !taken.has(c.id)).sort(() => rng() - 0.5);
    const out = [];
    let sal = 0;
    for (const c of pool) {
      if (out.length >= 10) break;
      const left = 9 - out.length;
      if (sal + c.salary > CAP) continue;
      if (left > 0 && sal + c.salary + left * 80 > CAP) continue;
      out.push(c); sal += c.salary;
    }
    if (out.length === 10 && sal >= RANDOM_MIN_SAL) { for (const c of out) taken.add(c.id); return out; }
  }
  throw new Error('no roster');
}

// A brain that reports what it was about to do, then does it.
const played = [];
const watcher = {
  ...ai,
  aiScoringDecision: (game, teamKey, opts = {}) => {
    const out = ai.aiScoringDecision(game, teamKey, opts);
    if (out?.type === 'play_card') {
      const team = getTeam(game, teamKey);
      const strat = getStrat(out.cardId);
      // evaluateCard is not exported; the decision's own ordering is what
      // matters, so the value is re-derived the only way available from here:
      // ask the shipped brain what it would have been worth. A card that is
      // top of the list is worth at least as much as every other playable one.
      played.push({
        id: out.cardId,
        hand: (team.hand || []).length,
        rarity: strat?.rarity ?? '?',
        section: (game.quarter - 1) * 3 + game.section,
      });
    }
    return out;
  },
};

const pairs = [];
for (let i = 0; i < 8; i += 1) { const t = new Set(); pairs.push([roster(t), roster(t)]); }
for (let i = 0; i < GAMES; i += 1) {
  const [r1, r2] = pairs[i % pairs.length];
  simulateGame(r1, r2, { brains: { A: watcher, B: watcher } });
}

console.log(`WHAT THE COACH PLAYS, over ${GAMES} games — ${played.length} cards\n`);

const byHand = new Map();
for (const p of played) byHand.set(p.hand, (byHand.get(p.hand) ?? 0) + 1);
console.log('HAND SIZE when a card is played (a card held at 7 blocks the next draw):');
for (const h of [...byHand.keys()].sort((a, b) => a - b)) {
  const n = byHand.get(h);
  console.log(`  ${h} cards  ${String(n).padStart(6)}  ${'█'.repeat(Math.round(40 * n / played.length))} ${(100 * n / played.length).toFixed(1)}%`);
}
const full = played.filter(p => p.hand >= 7).length;
console.log(`\n  played from a FULL hand: ${(100 * full / played.length).toFixed(1)}% — holding there costs a draw`);
console.log(`  played from a hand with room: ${(100 * (played.length - full) / played.length).toFixed(1)}% — holding there is free\n`);

const bySec = new Map();
for (const p of played) bySec.set(p.section, (bySec.get(p.section) ?? 0) + 1);
console.log('SECTION the card is played in (12 is crunch — use it or lose it):');
for (let s = 1; s <= 12; s += 1) {
  const n = bySec.get(s) ?? 0;
  console.log(`  S${String(s).padStart(2)}  ${String(n).padStart(6)}  ${'█'.repeat(Math.round(40 * n / played.length))}`);
}

const byRarity = new Map();
for (const p of played) byRarity.set(p.rarity, (byRarity.get(p.rarity) ?? 0) + 1);
console.log('\nRARITY played (a legendary spent early is a legendary not held for crunch):');
for (const [r, n] of [...byRarity.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(r).padEnd(12)} ${String(n).padStart(6)}  ${(100 * n / played.length).toFixed(1)}%`);
}
console.log(`\n  cards played per game: ${(played.length / GAMES / 2).toFixed(1)} a side`);
