/**
 * IS A DECK WORTH FITTING TO A ROSTER?
 *
 *   node scripts/analysis/runDeckFit.js [games]
 *
 * The AI plays the same fifty in every game (defaultDeckWeights.js), and
 * runHandSilt.js showed what that costs: by the last section the coach holds
 * seven cards and can play a fifth of one, clogged by Rimshaker, Putback Dunk
 * and Back to the Basket — cards whose conditions its roster keeps failing.
 *
 * Before writing a deck builder, the question is whether the answer actually
 * DIFFERS by roster. If every roster finds the same cards dead, the default
 * fifty is simply wrong for everyone and the fix is to re-learn it once. If
 * rosters disagree, the fix is a builder, and the spread here says how much it
 * could be worth.
 *
 * So: play real games with several deliberately different teams, and for every
 * card count the fraction of the times it sat in hand that it was actually
 * legal to play. No modelling of card conditions — canPlayCard is the engine's
 * own answer, asked in real positions.
 */
import { simulateGame } from '../../src/game/modes/simulate.js';
import * as ai from '../../src/game/ai.js';
import { CARDS } from '../../src/game/cards.js';
import { CAP } from '../../src/game/teamRules.js';
import { getTeam } from '../../src/game/engine.js';
import { canPlayCard } from '../../src/game/canPlay.js';
import { getStrat } from '../../src/game/strats.js';

const GAMES = Number(process.argv[2] ?? 40);

/** Ten cards under the cap, chosen to maximise `want` — a deliberate archetype. */
function build(want, label) {
  const ranked = [...CARDS].sort((a, b) => want(b) - want(a));
  const cheap = [...CARDS].sort((a, b) => (a.salary ?? 0) - (b.salary ?? 0));
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
  return { label, roster: out };
}

const TEAMS = [
  build(c => c.power * 2 + (c.paintBoost ?? 0) * 3, 'BIG    (power + paint)'),
  build(c => c.speed * 2 + (c.threePtBoost ?? 0) * 3, 'FAST   (speed + three)'),
  build(c => (c.defBoost ?? 0) * 5 + c.speed + c.power, 'STOPPY (defence first)'),
  build(c => (c.salary ?? 0), 'STARS  (most expensive)'),
];

// team label -> card id -> { held, legal }
const seen = new Map();

function watcherFor(label) {
  const row = seen.get(label) ?? new Map();
  seen.set(label, row);
  return {
    ...ai,
    aiScoringDecision: (game, teamKey, opts = {}) => {
      const t = getTeam(game, teamKey);
      for (const id of t.hand || []) {
        const r = row.get(id) ?? { held: 0, legal: 0 };
        r.held += 1;
        if (canPlayCard(game, teamKey, id)?.canPlay) r.legal += 1;
        row.set(id, r);
      }
      return ai.aiScoringDecision(game, teamKey, opts);
    },
  };
}

for (const me of TEAMS) {
  for (const them of TEAMS) {
    if (me === them) continue;
    for (let i = 0; i < GAMES; i += 1) {
      simulateGame(me.roster, them.roster, { brains: { A: watcherFor(me.label), B: ai } });
    }
  }
}

console.log(`LEGALITY RATE BY ROSTER — ${GAMES} games a pairing\n`);
console.log('How often a card in hand could actually be played, by the team holding it.\n');

const labels = TEAMS.map(t => t.label);
const rate = (label, id) => {
  const r = seen.get(label)?.get(id);
  return r && r.held >= 30 ? r.legal / r.held : null;
};

// The cards whose legality varies MOST between rosters — the ones a builder
// could act on. A card every team can play, or no team can, is not a lever.
const rows = [];
for (const strat of new Set([...seen.values()].flatMap(m => [...m.keys()]))) {
  const rs = labels.map(l => rate(l, strat)).filter(x => x !== null);
  if (rs.length < labels.length) continue;
  rows.push({ id: strat, rs, spread: Math.max(...rs) - Math.min(...rs), mean: rs.reduce((a, b) => a + b, 0) / rs.length });
}
rows.sort((a, b) => b.spread - a.spread);

console.log(`  ${'card'.padEnd(24)} ${labels.map(l => l.slice(0, 6).padStart(7)).join('')}   spread`);
for (const r of rows.slice(0, 16)) {
  const name = getStrat(r.id)?.name ?? r.id;
  console.log(`  ${name.slice(0, 23).padEnd(24)} ${r.rs.map(x => `${(100 * x).toFixed(0)}%`.padStart(7)).join('')}   ${(100 * r.spread).toFixed(0)} pts`);
}

console.log('\nDEAD FOR EVERYONE (legal under 10% of the time for every roster):');
const dead = rows.filter(r => Math.max(...r.rs) < 0.10).sort((a, b) => a.mean - b.mean);
for (const r of dead.slice(0, 14)) {
  console.log(`  ${(getStrat(r.id)?.name ?? r.id).padEnd(26)} ${(100 * r.mean).toFixed(1)}%`);
}
if (!dead.length) console.log('  (none)');

const spreads = rows.map(r => r.spread);
console.log(`\n  cards measured: ${rows.length}`);
console.log(`  mean spread across rosters: ${(100 * spreads.reduce((a, b) => a + b, 0) / spreads.length).toFixed(1)} pts`);
console.log(`  cards where the spread is 15+ points: ${spreads.filter(x => x >= 0.15).length}`);
