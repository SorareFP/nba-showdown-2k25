/**
 * WHAT A GAME PAYS, RUNG BY RUNG.
 *
 *   node scripts/analysis/runDifficultyPay.js [games]
 *
 * The user, 2026-09-14: "make sure we're scaling coin earnings based on
 * difficulty too."
 *
 * The reason that is not just a nicety: the win bonus already scales with the
 * MARGIN (coinRewards.js WIN_BY_MARGIN, 20 coins at +1 rising to 100 at +50),
 * and an easier coach loses by more. So today the ladder pays BACKWARDS —
 * the easiest opponent is the most profitable one, and grinding Settler is
 * the optimal coin strategy. This measures the size of that inversion so the
 * correction can be sized against it rather than guessed.
 *
 * MIRROR MATCHES: the same ten on both benches, so the rung is the ONLY
 * difference and the pay gap it produces is coaching and nothing else. Roster
 * strength is a separate lever with its own rules (dynasty's aiCapDp), and
 * mixing the two here would price one as the other.
 *
 * The claim is priced exactly as the server prices it, with the daily
 * counters pre-spent so neither the milestone cap nor the once-a-day first
 * win confounds the per-game number.
 *
 * TWO PRICES A GAME (2026-09-18). `coins/game` is the claim with no rung —
 * the inversion this script was written to size. `paid now` is the same claim
 * at the rung under today's rules (coinRewards.js gamePayFactor): the rung's
 * factor on a WIN, at most 1x on a loss — the user: "Loss 1x, win 1.5x —
 * losing pays the same at every rung; only a win takes the rung's
 * multiplier" — and priced as if the coach drew its own team at the rung
 * (rungDraw true), since a mirror match is a stand-in for that draw. A real
 * custom game (Team Builder Rosters, Quick Match above Prince) pays at most
 * 1x; the farm numbers are in the 2026-09-18 report, not here.
 */
import { readFileSync } from 'node:fs';
import { computePlayValue } from '../cardgen/playValue.js';
import { buildAiRoster } from '../../src/game/modes/aiTeams.js';
import { simulateGame } from '../../src/game/modes/simulate.js';
import { CAP } from '../../src/game/teamRules.js';
import { AI_LEVELS, iqOf } from '../../src/game/aiLevels.js';
import { settleGameReward, detectMilestones, DAILY_MILESTONE_CAP } from '../../src/game/coinRewards.js';
import { boxScoreFor } from '../../src/game/boxScore.js';
import * as brain from '../../src/game/ai.js';

const GAMES = Number(process.argv[2] ?? 500);
const cards = JSON.parse(readFileSync('card-data/generated/cards-2026-27.json', 'utf8')).cards;
const { value } = computePlayValue(cards);
const valueOf = new Map(cards.map((c, i) => [c.id, value[i]]));

/** The best cap-legal ten in the game — what a collector actually fields. */
function bestRoster() {
  const ranked = [...cards].sort((a, b) => (valueOf.get(b.id) ?? 0) - (valueOf.get(a.id) ?? 0));
  const cheap = [...cards].sort((a, b) => (a.salary ?? 0) - (b.salary ?? 0));
  const out = []; const ids = new Set(); let sal = 0;
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

let seed = 0x9e37;
const rng = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 1e6) / 1e6; };

const best = bestRoster();
const foe = buildAiRoster('BOS', { cards, taken: new Set(), rng });
// Both benches are the same ten — see the header.
const MINE = best, THEIRS = best;
void foe;

const wrap = iq => ({
  ...brain,
  aiPlacementPick: (g, k) => brain.aiPlacementPick(g, k, { iq }),
  aiScoringDecision: (g, k, o) => brain.aiScoringDecision(g, k, { ...o, iq }),
  aiReactionDecision: (g, k, t, o) => brain.aiReactionDecision(g, k, t, { ...o, iq }),
  aiSpendDecision: (g, k, o) => brain.aiSpendDecision(g, k, { ...o, iq }),
});

// The counters as a player who has already won once and spent the milestone
// cap today: what the NEXT game is worth on the margin.
const spent = { date: '2026-09-14', coins: DAILY_MILESTONE_CAP, firstWin: true };

console.log(`WHAT ONE GAME PAYS, by the coach's rung — ${GAMES} games each`);
console.log('(the same ten on both benches - you at Deity, the coach at the rung named)\n');
console.log('  rung        margin    win%    coins/game   vs Deity   paid now');
const rows = [];
for (const lvl of AI_LEVELS) {
  const them = wrap(iqOf(lvl.id));
  const us = wrap(1);
  let margin = 0, wins = 0, coins = 0, now = 0;
  for (let i = 0; i < GAMES; i += 1) {
    const flip = i % 2 === 1;
    const res = simulateGame(flip ? THEIRS : MINE, flip ? MINE : THEIRS, {
      brains: { A: flip ? them : us, B: flip ? us : them }, keepGame: true,
    });
    const myKey = flip ? 'B' : 'A';
    const mine = flip ? res.scoreB : res.scoreA;
    const theirs = flip ? res.scoreA : res.scoreB;
    margin += mine - theirs;
    if (mine > theirs) wins += 1;
    const claim = {
      won: mine > theirs, pvp: false, margin: mine - theirs,
      ...detectMilestones(res.game, myKey),
      box: boxScoreFor(res.game, myKey),
    };
    coins += settleGameReward(claim, spent, '2026-09-14').coins;
    now += settleGameReward({ ...claim, aiLevel: lvl.id, rungDraw: true }, spent, '2026-09-14').coins;
  }
  rows.push({ lvl, margin: margin / GAMES, win: wins / GAMES, coins: coins / GAMES, now: now / GAMES });
}
const deity = rows[rows.length - 1].coins;
for (const r of rows) {
  console.log(`  ${r.lvl.label.padEnd(10)} ${(r.margin >= 0 ? '+' : '') + r.margin.toFixed(1).padStart(6)}   ${(100 * r.win).toFixed(0).padStart(3)}%   ${r.coins.toFixed(1).padStart(8)}   ${(r.coins / deity).toFixed(3).padStart(6)}×   ${r.now.toFixed(1).padStart(8)}`);
}
console.log('\nTO FLATTEN — the factor that makes every rung pay what Deity pays:');
for (const r of rows) console.log(`  ${r.lvl.id.padEnd(10)} ${(deity / r.coins).toFixed(3)}`);
