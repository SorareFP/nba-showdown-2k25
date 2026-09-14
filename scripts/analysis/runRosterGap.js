/**
 * HOW MUCH OF A BLOWOUT IS THE ROSTER, AND HOW MUCH IS THE COACH?
 *
 *   node scripts/analysis/runRosterGap.js [games]
 *
 * The user, 2026-09-14: "I'm currently dusting most teams I play in dynasty,
 * like 40-50 point wins each time." The difficulty ladder cannot explain that.
 * Measured at 2,500 games a rung, Deity beats Settler by 4.70 points a game
 * and King by 0.53 — every lever on it is a `misplays(iq)` dial, a chance to
 * do the dumb thing, and at Deity the coach never takes it. The whole ladder
 * is worth about five points. Forty is somewhere else.
 *
 * The suspect is buildAiRoster. It fills a franchise's ten from ITS OWN
 * PLAYERS FIRST, best-first by salary and jittered by ±15%, and only then
 * reaches for the rest of the league. A human under the same cap picks from
 * every card in the game with no franchise to honour. This measures that gap
 * three ways:
 *
 *   VALUE   total play value (playValue.js) of an AI roster against an
 *           unconstrained cap-legal one, in points per scoring roll
 *   MARGIN  the same two rosters played out, both sides coached at Deity, so
 *           the only difference left is who is on the floor
 *   LADDER  the best roster against the AI roster at each rung, to show what
 *           turning the difficulty dial actually buys against a strong team
 */
import { readFileSync } from 'node:fs';
import { computePlayValue } from '../cardgen/playValue.js';
import { buildAiRoster } from '../../src/game/modes/aiTeams.js';
import { simulateGame } from '../../src/game/modes/simulate.js';
import { CAP, RANDOM_MIN_SAL } from '../../src/game/teamRules.js';
import { AI_LEVELS, iqOf } from '../../src/game/aiLevels.js';
import * as brain from '../../src/game/ai.js';

const GAMES = Number(process.argv[2] ?? 300);
const cards = JSON.parse(readFileSync('card-data/generated/cards-2026-27.json', 'utf8')).cards;

// Play value per card, computed once against the whole field.
const { value } = computePlayValue(cards);
const valueOf = new Map(cards.map((c, i) => [c.id, value[i]]));
const worth = roster => roster.reduce((t, c) => t + (valueOf.get(c.id) ?? 0), 0);
const spend = roster => roster.reduce((t, c) => t + (c.salary ?? 0), 0);

/**
 * What a player who reads the whole set actually fields: the best cards in the
 * game that fit the cap, with no franchise to honour. Ranked by VALUE, not by
 * value per dollar — the cap binds at ten cards and only five play at once, so
 * the question is "how good is my best five", not "how much value per coin".
 * The first version of this ranked per-dollar, filled up on cheap cards and
 * lost by eighteen; that was the heuristic being wrong, not the AI being good.
 */
function bestRoster(taken = new Set()) {
  const free = cards.filter(c => !taken.has(c.id));
  const ranked = [...free].sort((a, b) => (valueOf.get(b.id) ?? 0) - (valueOf.get(a.id) ?? 0));
  const cheap = [...free].sort((a, b) => (a.salary ?? 0) - (b.salary ?? 0));
  const out = [];
  const ids = new Set();
  let sal = 0;
  for (const c of ranked) {
    if (out.length >= 10) break;
    if (ids.has(c.id)) continue;
    const after = 10 - out.length - 1;
    let reserve = 0, n = 0;
    for (const x of cheap) {
      if (n >= after) break;
      if (ids.has(x.id) || x.id === c.id) continue;
      reserve += x.salary ?? 0; n += 1;
    }
    if (n < after || sal + (c.salary ?? 0) + reserve > CAP) continue;
    out.push(c); ids.add(c.id); sal += c.salary ?? 0;
  }
  return out;
}

// ── VALUE ───────────────────────────────────────────────────────────────────
let seed = 0x9e37;
const rng = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 1e6) / 1e6; };

const ai = [];
for (let i = 0; i < 12; i += 1) {
  const taken = new Set();
  ai.push(buildAiRoster(['BOS', 'LAL', 'MIA', 'DEN', 'PHI', 'NYK', 'GSW', 'MIL', 'DAL', 'PHX', 'OKC', 'CLE'][i], { cards, taken, rng }));
}
const best = bestRoster();
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

console.log('VALUE — total play value of a ten-card roster (points per scoring roll)\n');
console.log(`  a human's best cap-legal ten : ${worth(best).toFixed(2)}   spend $${spend(best)}`);
console.log(`  an AI franchise's ten        : ${mean(ai.map(worth)).toFixed(2)}   spend $${Math.round(mean(ai.map(spend)))}`);
console.log(`  gap                          : ${(worth(best) - mean(ai.map(worth))).toFixed(2)} per roll across ten cards`);
console.log(`  (cap ${CAP}, league minimum spend ${RANDOM_MIN_SAL})\n`);

// ── MARGIN, both sides coached the same ─────────────────────────────────────
const play = (a, b, iqA = 1, iqB = 1) => {
  const wrap = iq => ({
    ...brain,
    aiPlacementPick: (g, k) => brain.aiPlacementPick(g, k, { iq }),
    aiScoringDecision: (g, k, o) => brain.aiScoringDecision(g, k, { ...o, iq }),
    aiReactionDecision: (g, k, t, o) => brain.aiReactionDecision(g, k, t, { ...o, iq }),
    aiSpendDecision: (g, k, o) => brain.aiSpendDecision(g, k, { ...o, iq }),
  });
  let margin = 0, wins = 0;
  for (let i = 0; i < GAMES; i += 1) {
    const flip = i % 2 === 1;
    const res = simulateGame(flip ? b : a, flip ? a : b, {
      brains: { A: wrap(flip ? iqB : iqA), B: wrap(flip ? iqA : iqB) },
    });
    const mine = flip ? res.scoreB : res.scoreA;
    const theirs = flip ? res.scoreA : res.scoreB;
    margin += mine - theirs;
    if (mine > theirs) wins += 1;
  }
  return { margin: margin / GAMES, win: wins / GAMES };
};

const foe = ai[0];
const same = play(best, foe);
console.log(`MARGIN — best roster vs an AI franchise, BOTH coached at Deity, ${GAMES} games`);
console.log(`  ${same.margin >= 0 ? '+' : ''}${same.margin.toFixed(1)} points a game, ${(100 * same.win).toFixed(0)}% wins\n`);

// ── What the dial buys against that roster ──────────────────────────────────
console.log(`LADDER — the same best roster vs the same AI roster, coach's rung varied`);
for (const lvl of AI_LEVELS) {
  const r = play(best, foe, 1, iqOf(lvl.id));
  console.log(`  vs ${lvl.label.padEnd(10)} ${r.margin >= 0 ? '+' : ''}${r.margin.toFixed(1)} pts, ${(100 * r.win).toFixed(0)}% wins`);
}
