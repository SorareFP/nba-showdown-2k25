/**
 * IS A DECK BUILT FOR THE ROSTER WORTH ANYTHING?
 *
 *   node scripts/analysis/runDeckBuild.js [games]
 *
 * Every AI team in every mode plays the same fifty (defaultDeckWeights.js),
 * and three measurements now say that costs something:
 *
 *   runHandSilt.js   by the last section the coach holds 7.22 cards and can
 *                    play 0.23 of one; three cards are 74% of the silt.
 *   runDeckFit.js    legality swings a hundred points between archetypes —
 *                    Back to the Basket is 100% legal for a big team and 0%
 *                    for a fast one; twelve cards have a 15-point spread.
 *   runLeverLab.js   cycling dead cards is worth +1.9 win to a FAST roster and
 *                    -1.8 to a BIG one, which is the same finding from the
 *                    other end: the misfit is roster-specific.
 *
 * ── HOW THE FITTED DECK IS BUILT ────────────────────────────────────────────
 *
 * In two passes, because the legality of a card is a property of the ROSTER
 * and can only be found by playing:
 *
 *   1  PROFILE. Play the archetype with the default fifty and record, for
 *      every card, how often it was legal while it sat in hand. No modelling
 *      of card conditions — canPlayCard answering in real positions.
 *   2  BUILD. Weight the default fifty's copies by that legality and re-spend
 *      the fifty on what this roster can actually use.
 *
 * ── WHAT IT IS NOT ALLOWED TO DO ────────────────────────────────────────────
 *
 * The default fifty is a DESIGNED deck, not just a learned one: the switching
 * family has floors the user set deliberately (High Screen & Roll 4, Veer
 * Switch 3, Burned on the Switch 3, Go Under 2, Fight Over 2, Overhelp 2 —
 * card_design_steers). Those hold whatever the profile says, because a coach
 * that cannot contest a switch is not a coach playing badly, it is a different
 * game. Copy caps (5/4/3/1 by rarity) hold too.
 *
 * ── THE RESULT, 1,600 GAMES AN ARCHETYPE ────────────────────────────────────
 *
 *     FAST    61.7% +/-2.4   +6.23   cut Putback Dunk, Rimshaker, Back to the
 *                                    Basket, Desperation Press; more Bully
 *                                    Ball, Drive the Lane, Catch & Shoot
 *     BIG     49.4% +/-2.4   -0.49   cut Desperation Press
 *     STOPPY  51.4% +/-2.4   +0.12   cut Heat Check
 *
 * The shape is the point, not just the size. It cuts exactly the three cards
 * that are 74% of all silt, for the one roster that cannot play them, and it
 * does NOTHING for the rosters the default fifty already suits — those two
 * land on 50% because there was nothing to cut. So this is not "the default
 * fifty is wrong"; it is "the default fifty is one deck, and one deck cannot
 * fit every roster".
 *
 * +6.23 a game is the largest single effect measured in this whole round of
 * work — larger than the rotation planner (+3.82) and larger than the entire
 * Settler-to-Deity ladder (4.70). But it is the effect on the WORST-FITTED
 * roster, not on an average one: a league of AI teams is mostly built by
 * franchise (buildAiRoster), and how many of those are FAST enough to care is
 * not measured here.
 *
 * ── WHAT SHIPPING THIS WOULD NEED ───────────────────────────────────────────
 *
 * The profile pass is 200 games, which cannot run when a season deals its
 * teams. Two ways round it, neither built: precompute archetype decks offline
 * the way defaultDeckWeights.js is precomputed and classify a roster into one
 * at runtime, or approximate the profile from a handful of synthetic board
 * positions instead of real games — cheap, but its fidelity to the real
 * profile would have to be measured before it could be trusted.
 */
import { simulateGame } from '../../src/game/modes/simulate.js';
import * as ai from '../../src/game/ai.js';
import { CARDS } from '../../src/game/cards.js';
import { CAP } from '../../src/game/teamRules.js';
import { getTeam } from '../../src/game/engine.js';
import { canPlayCard } from '../../src/game/canPlay.js';
import { getStrat } from '../../src/game/strats.js';
import { DEFAULT_DECK_COPIES } from '../../src/game/defaultDeckWeights.js';
import { stratCopyCap } from '../../src/game/rarity.js';

const GAMES = Number(process.argv[2] ?? 400);
const DECK_SIZE = Object.values(DEFAULT_DECK_COPIES).reduce((a, b) => a + b, 0);

/** The switching family and its floors — the user's design steer, not a finding. */
const FLOORS = {
  high_screen_roll: 4, veer_switch: 3, burned_on_the_switch: 3,
  go_under: 2, fight_over: 2, overhelp: 2,
};

function archetype(want) {
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
  return out;
}

const TEAMS = {
  FAST: archetype(c => c.speed * 2 + (c.threePtBoost ?? 0) * 3),
  BIG: archetype(c => c.power * 2 + (c.paintBoost ?? 0) * 3),
  STOPPY: archetype(c => (c.defBoost ?? 0) * 5 + c.speed + c.power),
};

// ── PASS 1: profile ─────────────────────────────────────────────────────────
function profile(roster, foe, games) {
  const seen = new Map();
  const watcher = {
    ...ai,
    aiScoringDecision: (game, teamKey, opts = {}) => {
      for (const id of getTeam(game, teamKey).hand || []) {
        const r = seen.get(id) ?? { held: 0, legal: 0 };
        r.held += 1;
        if (canPlayCard(game, teamKey, id)?.canPlay) r.legal += 1;
        seen.set(id, r);
      }
      return ai.aiScoringDecision(game, teamKey, opts);
    },
  };
  for (let i = 0; i < games; i += 1) simulateGame(roster, foe, { brains: { A: watcher, B: ai } });
  return seen;
}

// ── PASS 2: build ───────────────────────────────────────────────────────────
//
// A REACTION CARD IS NOT JUDGED ON LEGALITY. It sits in hand unplayable by
// design and fires on a trigger, so the scoring-phase legality rate says
// nothing about it; it keeps whatever the default fifty gave it. Same for
// matchup-phase cards, which this probe never samples in their own phase.
const JUDGED = new Set(['scoring', 'pre_roll', 'post_roll']);

function fit(seen) {
  const want = {};
  let spent = 0;
  for (const [id, copies] of Object.entries(DEFAULT_DECK_COPIES)) {
    const strat = getStrat(id);
    const floor = FLOORS[id] ?? 0;
    if (!strat || !JUDGED.has(strat.phase) || floor) {
      want[id] = Math.max(copies, floor);
      spent += want[id];
      continue;
    }
    const r = seen.get(id);
    const rate = r && r.held >= 20 ? r.legal / r.held : 0.5;
    // A CARD THIS ROSTER CANNOT PLAY COMES OUT ALTOGETHER. The first version
    // floored every card at one copy, which sounds prudent and does nothing:
    // the default fifty gives most cards exactly one, so flooring at one meant
    // the fit could never cut anything and the "fitted" deck was the default
    // deck with a few extra copies. Back to the Basket is legal 0% of the time
    // for a fast team — one copy of it is one seat of the fifty that can never
    // do anything, and the fifty is the whole budget.
    const n = rate < 0.05 ? 0
      : rate < 0.15 ? 1
        : Math.max(1, Math.round(copies * (0.5 + rate)));
    want[id] = Math.min(n, stratCopyCap(id));
    spent += want[id];
  }
  // Re-spend the difference on the most legal cards, respecting the caps.
  const spendable = Object.keys(want)
    .filter(id => JUDGED.has(getStrat(id)?.phase) && !FLOORS[id])
    .sort((a, b) => {
      const ra = seen.get(a), rb = seen.get(b);
      return ((rb?.legal ?? 0) / Math.max(1, rb?.held ?? 1)) - ((ra?.legal ?? 0) / Math.max(1, ra?.held ?? 1));
    });
  let guard = 0;
  while (spent < DECK_SIZE && guard < 500) {
    guard += 1;
    let moved = false;
    for (const id of spendable) {
      if (spent >= DECK_SIZE) break;
      if (want[id] >= stratCopyCap(id)) continue;
      // A card cut to zero stays cut — the freed seats go to cards that work.
      if (want[id] === 0) continue;
      want[id] += 1; spent += 1; moved = true;
    }
    if (!moved) break;
  }
  while (spent > DECK_SIZE) {
    const id = [...spendable].reverse().find(x => want[x] > 1);
    if (!id) break;
    want[id] -= 1; spent -= 1;
  }
  return want;
}

// ── The duel: fitted deck against the default fifty, same roster both sides ─
console.log(`A DECK BUILT FOR THE ROSTER, against the default fifty — ${GAMES} games each\n`);
console.log('  roster    win%      95% CI    margin   size');
for (const [label, roster] of Object.entries(TEAMS)) {
  // MIRROR MATCH. The first version played the archetype against a DIFFERENT
  // archetype and printed a note claiming both benches were the same — so it
  // measured which roster is stronger (FAST beat BIG 78% of the time) and said
  // nothing whatever about decks. Same ten on both sides, and the deck is then
  // the only thing that differs.
  const foe = roster;
  const seen = profile(roster, foe, Math.max(20, Math.round(GAMES / 8)));
  const deck = fit(seen);
  const size = Object.values(deck).reduce((a, b) => a + b, 0);

  let wins = 0, margin = 0;
  for (let i = 0; i < GAMES; i += 1) {
    const mineIsA = i % 2 === 0;
    const res = simulateGame(mineIsA ? roster : foe, mineIsA ? foe : roster, {
      deckA: mineIsA ? deck : null,
      deckB: mineIsA ? null : deck,
    });
    const mine = mineIsA ? res.scoreA : res.scoreB;
    const theirs = mineIsA ? res.scoreB : res.scoreA;
    if (mine > theirs) wins += 1;
    margin += mine - theirs;
  }
  const p = wins / GAMES;
  const ci = 1.96 * Math.sqrt((p * (1 - p)) / GAMES) * 100;
  const cut = Object.entries(deck)
    .filter(([id, n]) => n < (DEFAULT_DECK_COPIES[id] ?? 0))
    .map(([id, n]) => `${getStrat(id)?.name ?? id} ${DEFAULT_DECK_COPIES[id]}->${n}`);
  const added = Object.entries(deck)
    .filter(([id, n]) => n > (DEFAULT_DECK_COPIES[id] ?? 0))
    .map(([id, n]) => `${getStrat(id)?.name ?? id} ${DEFAULT_DECK_COPIES[id]}->${n}`);
  console.log(`  ${label.padEnd(8)} ${(100 * p).toFixed(1).padStart(5)}%   ±${ci.toFixed(1).padStart(4)}   ${(margin / GAMES >= 0 ? '+' : '') + (margin / GAMES).toFixed(2).padStart(5)}   ${String(size).padStart(3)}`);
  console.log(`             cut  ${cut.slice(0, 4).join(', ') || 'NOTHING — a fit that cuts nothing is a bug, not a finding'}`);
  console.log(`             more ${added.slice(0, 4).join(', ') || '(none)'}`);
}

console.log('\nBoth benches field the SAME ten, so the deck is the only difference, and it');
console.log('A fitted deck that cannot beat the default fifty on its own archetype is not worth building.');
