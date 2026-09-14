/**
 * WHY THE COACH STOPS PLAYING CARDS.
 *
 *   node scripts/analysis/runHandSilt.js [games]
 *
 * runCardValues.js turned up something nobody was looking for: the coach plays
 * 382 cards in section 1 and 98 in section 9, out of a fifty-card deck it
 * never exhausts. Something is stopping it, and the two candidates behave
 * completely differently:
 *
 *   IT RUNS OUT OF GOOD CARDS      the hand is full of playable cards that are
 *                                  merely worth less than passing. Nothing to
 *                                  fix; the coach is being choosy.
 *   THE HAND SILTS UP              the hand fills with cards it CANNOT play —
 *                                  a matchup-phase card during scoring, a
 *                                  crunch card in the first quarter, a
 *                                  condition its roster never meets — and
 *                                  because endSection only draws back up to
 *                                  seven, a hand of seven duds draws nothing
 *                                  and the coach is stuck with them all game.
 *
 * The second is a real defect with a free fix: returnCardToDeck puts a hand
 * card on the bottom of the deck "any time, at no cost in turns" (engine.js),
 * the hand refills at the section end, and ai.js has never called it once.
 *
 * This counts, per section, how much of the average hand is playable at all.
 */
import { simulateGame } from '../../src/game/modes/simulate.js';
import * as ai from '../../src/game/ai.js';
import { CARDS } from '../../src/game/cards.js';
import { CAP, RANDOM_MIN_SAL } from '../../src/game/teamRules.js';
import { getTeam } from '../../src/game/engine.js';
import { canPlayCard } from '../../src/game/canPlay.js';
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

// section -> { hands, cards, playable, reactions, stuck }
const bySec = new Map();
const stuckIds = new Map();

const watcher = {
  ...ai,
  aiScoringDecision: (game, teamKey, opts = {}) => {
    const t = getTeam(game, teamKey);
    const sec = (game.quarter - 1) * 3 + game.section;
    const row = bySec.get(sec) ?? { hands: 0, cards: 0, playable: 0, reactions: 0 };
    row.hands += 1;
    for (const id of t.hand || []) {
      row.cards += 1;
      const s = getStrat(id);
      if (s?.phase === 'reaction') { row.reactions += 1; continue; }
      if (canPlayCard(game, teamKey, id)?.canPlay) row.playable += 1;
      else stuckIds.set(id, (stuckIds.get(id) ?? 0) + 1);
    }
    bySec.set(sec, row);
    return ai.aiScoringDecision(game, teamKey, opts);
  },
};

const pairs = [];
for (let i = 0; i < 8; i += 1) { const t = new Set(); pairs.push([roster(t), roster(t)]); }
for (let i = 0; i < GAMES; i += 1) {
  const [r1, r2] = pairs[i % pairs.length];
  simulateGame(r1, r2, { brains: { A: watcher, B: watcher } });
}

console.log(`THE HAND, SECTION BY SECTION — ${GAMES} games\n`);
console.log('  sec   hand   playable now   held for a reaction   STUCK (neither)');
for (let s = 1; s <= 12; s += 1) {
  const r = bySec.get(s);
  if (!r || !r.hands) continue;
  const hand = r.cards / r.hands;
  const play = r.playable / r.hands;
  const react = r.reactions / r.hands;
  const stuck = hand - play - react;
  console.log(`  S${String(s).padStart(2)}   ${hand.toFixed(2)}       ${play.toFixed(2)}                ${react.toFixed(2)}            ${stuck.toFixed(2)}  ${'█'.repeat(Math.round(stuck * 6))}`);
}

console.log('\nThe cards most often sitting in hand unplayable (the silt):');
const worst = [...stuckIds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
const total = [...stuckIds.values()].reduce((a, b) => a + b, 0);
for (const [id, n] of worst) {
  const s = getStrat(id);
  console.log(`  ${(s?.name ?? id).padEnd(26)} ${String(n).padStart(7)}  ${(100 * n / total).toFixed(1)}%  [${s?.phase ?? '?'}]`);
}
