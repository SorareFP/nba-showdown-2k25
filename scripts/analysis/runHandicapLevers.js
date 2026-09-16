/**
 * HOW HARD DOES A MATERIAL ADVANTAGE MAKE THE COACH?
 *
 *   node scripts/analysis/runHandicapLevers.js [games]
 *
 * The user, 2026-09-16: "I think the midpoint should be the 1x payout, with
 * Deity being the 1.5x or whatever. Although I think for that, the actual
 * difficulty would be tilted toward losing. i.e. it should be really hard to
 * win on Deity."
 *
 * The ladder today is Civilization's names on one dial — how often the coach
 * plays its considered answer — and its top rung is the full search, which
 * against an equal roster is a FAIR game. Measured, the whole dial is worth
 * about 4.7 points a game (aiLevels.js), so "really hard to win" cannot come
 * from smarter play: perfect play on symmetric terms is 50%. Civilization's
 * own answer above its fair rung is not a smarter AI but a richer one.
 *
 * This measures that kind of advantage in points, so the top rungs can be set
 * to a target win rate rather than a guess. Every row is the full-search coach
 * on both benches; only the ADVANTAGED side's roster differs:
 *
 *   cap+10 / cap+20     its ten are drawn to a salary cap 10% / 20% higher —
 *                       better players, the same rules
 *   attr+1 / attr+2     its ten are the SAME cards with Speed and Power raised
 *                       by 1 / 2 — a mirror match where one side is a step
 *                       quicker and stronger everywhere
 *
 * The advantaged side's win rate is the tilt. 50% is the control (both plain).
 * Nothing here touches the dice or the cards in hand: an advantage a player
 * can SEE on the card is one they can plan against; a hidden one is a cheat.
 *
 * ── THE RULE THIS SERVES ────────────────────────────────────────────────────
 *
 * The user, 2026-09-16: "when I turn up the difficulty, players on my team get
 * stupid to an unrealistic level and that's how the difficulty is raised. I
 * hate that. What I want when the difficulty goes up is for the opposing team
 * to be better/smarter." So every lever here is on the COACH'S side, and the
 * human's cards, dice, fatigue and judgement are never touched by a rung.
 *
 * The attr+N rows are a MEASURE OF MAGNITUDE, not a candidate: a Shai printed
 * at Speed 16 is a fake card. What can ship is the cap — the coach simply has
 * better real players, which a person can see and plan against — and the
 * smarter dials that already exist (placement samples have no ceiling).
 */
import { simulateGame } from '../../src/game/modes/simulate.js';
import { CARDS } from '../../src/game/cards.js';
import { CAP, RANDOM_MIN_SAL } from '../../src/game/teamRules.js';

const GAMES = Number(process.argv.find(a => /^\d+$/.test(a)) ?? 800);

let seed = 0x7a11;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

/** A cap-legal ten at `cap`, drawn from cards not in `taken`. */
function roster(taken, cap = CAP) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const pool = CARDS.filter(c => !taken.has(c.id)).sort(() => rng() - 0.5);
    const out = [];
    let sal = 0;
    for (const c of pool) {
      if (out.length >= 10) break;
      const left = 9 - out.length;
      if (sal + c.salary > cap) continue;
      if (left > 0 && sal + c.salary + left * 80 > cap) continue;
      out.push(c); sal += c.salary;
    }
    // Spend the cap: a richer draw that lands on the same salary is no
    // advantage at all, so the advantaged side must reach past the plain cap.
    if (out.length === 10 && sal >= Math.max(RANDOM_MIN_SAL, cap - 600)) {
      for (const c of out) taken.add(c.id);
      return out;
    }
  }
  throw new Error('no roster');
}

const bump = (team, n) => team.map(c => ({ ...c, speed: c.speed + n, power: c.power + n }));

// --caps 1.05,1.12   measure exactly these cap multipliers instead of the
//                    default set — how a chosen rung is verified.
const capsArg = process.argv.includes('--caps') ? process.argv[process.argv.indexOf('--caps') + 1] : null;
const LEVERS = capsArg
  ? Object.fromEntries([
    ['control', () => { const t = new Set(); return [roster(t), roster(t)]; }],
    ...capsArg.split(',').map(Number).map(m => [`cap x${m}`, () => { const t = new Set(); return [roster(t, Math.round(CAP * m)), roster(t)]; }]),
  ])
  : {
    control: () => { const t = new Set(); return [roster(t), roster(t)]; },
    'cap+10': () => { const t = new Set(); return [roster(t, Math.round(CAP * 1.10)), roster(t)]; },
    'cap+20': () => { const t = new Set(); return [roster(t, Math.round(CAP * 1.20)), roster(t)]; },
    'attr+1': () => { const t = new Set(); const r = roster(t); return [bump(r, 1), r]; },
    'attr+2': () => { const t = new Set(); const r = roster(t); return [bump(r, 2), r]; },
  };

console.log(`A MATERIAL ADVANTAGE, IN POINTS — full-search coach both sides, ${GAMES} games a lever\n`);
console.log('  lever      win%     95% CI    margin    (the advantaged side)');
for (const [name, draw] of Object.entries(LEVERS)) {
  let wins = 0, margin = 0;
  for (let i = 0; i < GAMES; i += 1) {
    const [strong, plain] = draw();
    const strongIsA = i % 2 === 0;
    const res = simulateGame(strongIsA ? strong : plain, strongIsA ? plain : strong);
    const mine = strongIsA ? res.scoreA : res.scoreB;
    const theirs = strongIsA ? res.scoreB : res.scoreA;
    if (mine > theirs) wins += 1;
    margin += mine - theirs;
  }
  const p = wins / GAMES;
  const ci = 1.96 * Math.sqrt((p * (1 - p)) / GAMES) * 100;
  console.log(`  ${name.padEnd(9)} ${(100 * p).toFixed(1).padStart(5)}%   ±${ci.toFixed(1).padStart(4)}    ${(margin / GAMES >= 0 ? '+' : '') + (margin / GAMES).toFixed(2)}`);
}
