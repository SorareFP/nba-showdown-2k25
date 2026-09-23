// HOW MANY CONTESTED SHOT CHECKS A PLAYER TAKES A SECTION, by his shooting.
//
//   node scripts/analysis/checkVolume.mjs [games]
//
// The placement search prices a defender's contest (2026-09-23): each point
// of Defensive Bonus takes 5% off every 3PT and paint check the man he guards
// takes. What that is worth depends on how many checks that man takes, which
// depends on how good a shooter he is — the coach and the cards route checks
// to the best chance on the floor. This plays AI-vs-AI games and reads, per
// player, his 3PT and paint check attempts per section on the floor against
// his uncontested make chance, so the pricing is fitted, not guessed. It also
// reports the spread of a section's margin, which the score-aware risk
// setting reads.
import { simulateGame } from '../../src/game/modes/simulate.js';
import { CARDS } from '../../src/game/cards.js';
import { CAP, RANDOM_MIN_SAL } from '../../src/game/teamRules.js';

const GAMES = Number(process.argv[2] ?? 300);
let seed = 20260923;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
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
const pHit = need => Math.min(1, Math.max(0, (21 - need) / 20));
const p3 = c => pHit((c.shotLine ?? 99) - (c.threePtBoost || 0));
const pP = c => pHit((c.shotLine ?? 99) - (c.paintBoost || 0));

const rows = [];
let sectionsTotal = 0;
let checksTotal = 0;
const margins = [];
const sectionMargins = [];
for (let i = 0; i < GAMES; i += 1) {
  const taken = new Set();
  const A = roster(taken);
  const B = roster(taken);
  const res = simulateGame(A, B, { rng, keepGame: true });
  margins.push(res.scoreA - res.scoreB);
  for (const s of res.game.sectionScores ?? []) sectionMargins.push((s.A ?? 0) - (s.B ?? 0));
  for (const [key, list] of [['teamA', A], ['teamB', B]]) {
    for (const s of res.game[key].stats) {
      const card = list.find(c => c.id === s.id);
      const secs = (s.totalMinutes || 0) / 4;
      if (!card || secs <= 0) continue;
      const three = s.threepa || 0;
      const paint = s.pnta || 0;
      rows.push({ p3: p3(card), pP: pP(card), secs, three, paint });
      sectionsTotal += secs;
      checksTotal += three + paint;
    }
  }
}
const bucket = (key, edges) => {
  for (let b = 0; b < edges.length - 1; b += 1) {
    const inB = rows.filter(r => r[key] >= edges[b] && r[key] < edges[b + 1]);
    const secs = inB.reduce((t, r) => t + r.secs, 0);
    const three = inB.reduce((t, r) => t + r.three, 0);
    const paint = inB.reduce((t, r) => t + r.paint, 0);
    console.log(`  ${key} ${edges[b].toFixed(2)}-${edges[b + 1].toFixed(2)}  player-games ${String(inB.length).padStart(5)}  3PT/section ${(three / secs || 0).toFixed(3)}  paint/section ${(paint / secs || 0).toFixed(3)}`);
  }
};
/** Checks of one type per section, grouped by that type's exact make chance. */
const exact = (key, count) => {
  const groups = new Map();
  for (const r of rows) {
    const p = Math.round(r[key] * 20) / 20;
    const g = groups.get(p) ?? { secs: 0, n: 0, players: 0 };
    g.secs += r.secs; g.n += r[count]; g.players += 1;
    groups.set(p, g);
  }
  for (const [p, g] of [...groups].sort((a, b) => a[0] - b[0])) {
    if (g.players < 30) continue;
    console.log(`  p ${p.toFixed(2)}  player-games ${String(g.players).padStart(5)}  per section ${(g.n / g.secs).toFixed(3)}`);
  }
};
console.log(`${GAMES} games: ${(checksTotal / sectionsTotal).toFixed(3)} contested checks per player-section (3PT + paint)`);
console.log('3PT checks by uncontested 3PT make chance:');
exact('p3', 'three');
console.log('paint checks by uncontested paint make chance:');
exact('pP', 'paint');
void bucket;
const sdOf = xs => {
  const m = xs.reduce((t, x) => t + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((t, x) => t + (x - m) ** 2, 0) / xs.length);
};
console.log(`final margin sd ${sdOf(margins).toFixed(1)} over ${GAMES} games (per section if independent: ${(sdOf(margins) / Math.sqrt(12)).toFixed(2)})`);
if (sectionMargins.length) console.log(`section margin sd ${sdOf(sectionMargins).toFixed(2)} over ${sectionMargins.length} sections`);
