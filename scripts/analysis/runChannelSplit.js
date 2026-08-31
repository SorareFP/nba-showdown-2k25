/**
 * Where do the points actually come from?
 *
 * The chart is not the only way a card scores, and the question that matters
 * for chart design is how much of a game the OTHER routes carry. Every one of
 * them runs through `shotCheck`, gated by the shot line less the relevant
 * boost:
 *
 *   chart      `doRoll` -> `score += result.pts`, ungated
 *   assists    4 AST -> a 3PT check (needs a 3PT boost)
 *              3 AST -> a paint check (needs a paint boost)
 *   rebounds   2 REB -> a putback, 3 REB -> a paint check
 *
 * If conversion is a third of the scoring, a good shooter's chart ceiling is
 * double-counting his upside and should come down. If it is a twentieth, the
 * chart is the whole game and nothing needs to move. Guessing either way would
 * be silly when the engine already instruments it: `analytics` tracks
 * `chartPts`, `assistSpendPts` and `reboundBonusPts` per team.
 *
 * SO THIS DRIVES THE REAL ENGINE rather than modelling it. Same `doRoll`, same
 * `shotCheck`, same `endSection`, same rebound-bonus rules. A reimplementation
 * would be measuring my own arithmetic instead of the game.
 *
 * WHAT IS DELIBERATELY LEFT OUT: strategy cards. They are a player-choice layer
 * and they never add points directly -- `score +=` appears in exactly five
 * places in the engine and all five are here -- so excluding them isolates the
 * chart-versus-conversion split, which is the question. It does mean the
 * absolute points per game run low against a real table, where cards add roll
 * bonuses. The SHARES are the output; the totals are not.
 *
 * The spending policy is the one judgement call, and it is deliberately greedy
 * and simple: spend whenever affordable, on whoever converts best. A real
 * player holds currency for leverage, so this is an UPPER bound on the
 * conversion share -- which is the right direction for the question being
 * asked, since a small number here settles it.
 */
import { readFileSync } from 'node:fs';
import {
  newGame, doRoll, endSection, spendAssist, spendReboundBonus, STARTERS,
} from '../../src/game/engine.js';
import { computePlayValue, hitProb } from '../cardgen/playValue.js';

const SET = process.argv[2] ?? 'card-data/generated/cards-2026-27.json';
const GAMES = Number(process.argv[3] ?? 400);
const SECTIONS = 12;
const CAP = 5500;
const ROSTER = 10;

const cards = JSON.parse(readFileSync(SET, 'utf8')).cards;
const { value } = computePlayValue(cards);

// Deterministic PRNG so a rerun on an unchanged set prints the same figures.
function rng(seed = 0x5eed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sorted = value.slice().sort((x, y) => x - y);
const replacement = sorted[Math.floor(sorted.length / 2)];

/** A cap-legal ten, picked by play value per dollar above the median card. */
function draft(random, exclude) {
  const ranked = cards
    .map((c, i) => ({ card: c, v: (value[i] - replacement) / Math.max(c.salary ?? 1, 1) }))
    .sort((a, b) => b.v - a.v);
  const cheapest = cards.map(c => c.salary ?? 0).sort((a, b) => a - b);
  const taken = new Set(exclude ?? []);
  const picks = [];
  let spent = 0;
  while (picks.length < ROSTER) {
    const reserve = cheapest.slice(0, ROSTER - picks.length - 1).reduce((s, x) => s + x, 0);
    const affordable = [];
    for (const r of ranked) {
      if (taken.has(r.card.id)) continue;
      if (spent + (r.card.salary ?? 0) + reserve > CAP) continue;
      affordable.push(r);
      if (affordable.length >= 10) break;
    }
    if (!affordable.length) break;
    const pick = affordable[Math.floor(random() * affordable.length)];
    taken.add(pick.card.id);
    picks.push(pick.card);
    spent += pick.card.salary ?? 0;
  }
  return { picks, taken };
}

/** Best index on the floor for a given spend, or -1 if nobody qualifies. */
function bestTarget(team, boostKey) {
  let best = -1;
  let bestP = 0;
  team.starters.forEach((p, i) => {
    if (!((p[boostKey] ?? 0) > 0)) return;
    const prob = hitProb(p, boostKey);
    if (prob > bestP) {
      bestP = prob;
      best = i;
    }
  });
  return best;
}

/**
 * Who received the conversion points, by shot line.
 *
 * The design question is whether a GOOD SHOOTER's chart ceiling double-counts
 * upside he already gets through conversion, so the split has to be attributed
 * per player, not just per team. The engine's analytics are team-level, so the
 * receiving player is recorded here by diffing the team score across the spend.
 */
export const received = new Map();
function credit(player, pts) {
  if (!(pts > 0)) return;
  const line = player.shotLine ?? 20;
  const cur = received.get(line) ?? { pts: 0, spends: 0 };
  cur.pts += pts;
  cur.spends += 1;
  received.set(line, cur);
}

/** Spend everything spendable, best converter first. */
function spendAll(g, key) {
  let ng = g;
  for (let guard = 0; guard < 12; guard += 1) {
    const team = key === 'A' ? ng.teamA : ng.teamB;
    let acted = false;

    const three = bestTarget(team, 'threePtBoost');
    if (team.assists >= 4 && three >= 0) {
      const before = (key === 'A' ? ng.teamA : ng.teamB).score;
      const r = spendAssist(ng, key, '3pt', three);
      if (r.ok) {
        credit(team.starters[three], (key === 'A' ? r.game.teamA : r.game.teamB).score - before);
        ng = r.game; acted = true;
      }
    }
    const paint = bestTarget(team, 'paintBoost');
    if (!acted && team.assists >= 3 && paint >= 0) {
      const before = (key === 'A' ? ng.teamA : ng.teamB).score;
      const r = spendAssist(ng, key, 'paint', paint);
      if (r.ok) {
        credit(team.starters[paint], (key === 'A' ? r.game.teamA : r.game.teamB).score - before);
        ng = r.game; acted = true;
      }
    }
    // Rebound spends are gated by what endSection published for this section.
    const bonuses = ng.reboundBonuses?.[key];
    if (!acted && team.rebounds >= 2 && bonuses?.putbackPlayers?.length) {
      const idx = bonuses.putbackPlayers[0].idx;
      const before = (key === 'A' ? ng.teamA : ng.teamB).score;
      const r = spendReboundBonus(ng, key, 'putback', idx);
      if (r.ok) {
        credit(team.starters[idx], (key === 'A' ? r.game.teamA : r.game.teamB).score - before);
        ng = r.game; acted = true;
      }
    }
    if (!acted && team.rebounds >= 3 && bonuses?.paintCheck && paint >= 0) {
      const before = (key === 'A' ? ng.teamA : ng.teamB).score;
      const r = spendReboundBonus(ng, key, 'paint_check', paint);
      if (r.ok) {
        credit(team.starters[paint], (key === 'A' ? r.game.teamA : r.game.teamB).score - before);
        ng = r.game; acted = true;
      }
    }
    if (!acted) break;
  }
  return ng;
}

const random = rng();
const totals = { chart: 0, assist: 0, rebound: 0, ft: 0, games: 0, checks: 0, hits: 0 };
const perGame = [];

for (let n = 0; n < GAMES; n += 1) {
  const a = draft(random);
  const b = draft(random, a.taken);
  if (a.picks.length < STARTERS || b.picks.length < STARTERS) continue;

  let g = newGame(a.picks, b.picks, null, null);
  g.phase = 'scoring';

  for (let s = 0; s < SECTIONS; s += 1) {
    // STARTERS ARE SET EVERY SECTION, and must be: endSection clears them to []
    // for the next matchup phase, so a sim that names them once silently rolls
    // nothing from section two onward.
    //
    // Rotation is not optional either. Fatigue is -12 to every roll at 16+
    // minutes, so five men cannot play twelve sections — they would spend two
    // thirds of the game clamped to the bottom of their charts. Bench first on
    // REST, then on value, which is what the ten-man roster and the recovery
    // table in endSection exist for.
    for (const key of ['A', 'B']) {
      const team = key === 'A' ? g.teamA : g.teamB;
      const byId = new Map(team.stats.map(p => [p.id, p]));
      const order = team.roster
        .map(c => ({ c, min: byId.get(c.id)?.minutes ?? 0, sal: c.salary ?? 0 }))
        .sort((x, y) => x.min - y.min || y.sal - x.sal);
      team.starters = order.slice(0, STARTERS).map(o => o.c);
    }
    for (const key of ['A', 'B']) {
      for (let i = 0; i < STARTERS; i += 1) g = doRoll(g, key, i);
    }
    for (const key of ['A', 'B']) g = spendAll(g, key);
    g = endSection(g);
    for (const key of ['A', 'B']) g = spendAll(g, key);
  }

  let gamePts = 0;
  for (const key of ['A', 'B']) {
    const an = g.analytics[key];
    totals.chart += an.chartPts;
    totals.assist += an.assistSpendPts;
    totals.rebound += an.reboundBonusPts;
    totals.ft += an.freeThrowPts;
    totals.checks += an.totalShotChecks;
    totals.hits += an.totalShotCheckHits;
    gamePts += (key === 'A' ? g.teamA : g.teamB).score;
  }
  perGame.push(gamePts / 2);
  totals.games += 1;
}

const scored = totals.chart + totals.assist + totals.rebound + totals.ft;
const teamGames = totals.games * 2;
const pct = x => `${((x / scored) * 100).toFixed(1)}%`;
const per = x => (x / teamGames).toFixed(1);

console.log(`\n${totals.games} games simulated on ${SET}`);
console.log(`  (strategy cards excluded — they add roll bonuses, never points, so the SHARES hold and the totals run low)\n`);
console.log(`  ${'channel'.padEnd(26)}${'pts/team/game'.padStart(14)}${'share'.padStart(9)}`);
console.log(`  ${'chart roll'.padEnd(26)}${per(totals.chart).padStart(14)}${pct(totals.chart).padStart(9)}`);
console.log(`  ${'assist spends (3PT/paint)'.padEnd(26)}${per(totals.assist).padStart(14)}${pct(totals.assist).padStart(9)}`);
console.log(`  ${'rebound spends (putback)'.padEnd(26)}${per(totals.rebound).padStart(14)}${pct(totals.rebound).padStart(9)}`);
console.log(`  ${'free throws'.padEnd(26)}${per(totals.ft).padStart(14)}${pct(totals.ft).padStart(9)}`);
console.log(`  ${'—'.repeat(26)}${'—'.repeat(14)}${'—'.repeat(9)}`);
console.log(`  ${'TOTAL'.padEnd(26)}${per(scored).padStart(14)}${'100%'.padStart(9)}`);
const conv = totals.assist + totals.rebound + totals.ft;
console.log(`\n  CONVERSION (everything shot-check gated): ${pct(conv)} of scoring, ${per(conv)} pts/team/game`);
console.log(`  shot checks: ${(totals.checks / teamGames).toFixed(1)} per team per game, ` +
  `${totals.checks ? ((totals.hits / totals.checks) * 100).toFixed(0) : 0}% hit`);
const mean = perGame.reduce((s, x) => s + x, 0) / (perGame.length || 1);
console.log(`  points per team per game: ${mean.toFixed(1)}`);

// ── Who the conversion points go to ────────────────────────
const byLine = [...received.entries()].sort((a, b) => a[0] - b[0]);
const convTotal = byLine.reduce((s2, [, v]) => s2 + v.pts, 0) || 1;
console.log(`\n  CONVERSION POINTS BY THE RECEIVING PLAYER'S SHOT LINE`);
console.log(`    ${'shot line'.padEnd(12)}${'pts/team/gm'.padStart(13)}${'share of conv'.padStart(15)}${'spends'.padStart(9)}`);
for (const [line, v] of byLine) {
  console.log(`    ${String(line).padEnd(12)}${(v.pts / teamGames).toFixed(2).padStart(13)}` +
    `${`${((v.pts / convTotal) * 100).toFixed(1)}%`.padStart(15)}${String(v.spends).padStart(9)}`);
}
