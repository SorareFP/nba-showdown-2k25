/**
 * THE ARCHETYPE DECKS — the runtime-cheap form of the deck fitter.
 *
 *   node scripts/analysis/buildArchetypeDecks.js [games] [--emit]
 *
 * The user, 2026-09-16: "Deck-matched AI opponents are what I want, yes."
 *
 * runDeckBuild.js proved a deck built for a roster is worth +6.23 a game to
 * the roster the default fifty misfits worst and nothing to the rosters it
 * already suits. It did that by PLAYING two hundred games per roster to learn
 * which cards the roster can make legal — which cannot happen when a season
 * deals its teams. So the profiling moves offline, here, and what ships is a
 * TABLE: a handful of archetypes, each with the deck the profile built for it
 * and a centroid in roster-attribute space, plus the pool's spread on each
 * attribute so distances mean something. At runtime deckFit.js measures a
 * roster against the centroids and hands it the nearest archetype's deck —
 * or the default fifty when nothing is near enough, which is the case the
 * measurement said to leave alone.
 *
 * ── THE FEATURES ────────────────────────────────────────────────────────────
 *
 * Five per roster, each the mean over its ten cards: speed, power, 3PT boost,
 * paint boost, defensive boost. Standardised by the whole card pool's standard
 * deviation so a point of speed and a point of paint boost are comparable.
 * Means rather than maxima because the legality that matters (runDeckFit.js)
 * is roster-wide — Back to the Basket needs a big body on the floor most
 * sections, not one big body on the bench.
 *
 * ── WHAT IT MUST NOT DO ─────────────────────────────────────────────────────
 *
 * The switching floors are the user's design, not a finding, and hold
 * whatever the profile says (High Screen & Roll 4, Veer Switch 3, Burned on
 * the Switch 3, Go Under 2, Fight Over 2, Overhelp 2). Copy caps hold. And the
 * emitted module must stay IMPORT-FREE of the engine: aiTeams.js and the
 * season live in the server bundle (prepare.mjs), and a deck table that
 * reached for canPlayCard would cold-start the functions into the DOM.
 *
 * --emit writes src/game/archetypeDecks.js. Without it, prints the table.
 */
import { writeFileSync } from 'node:fs';
import { simulateGame } from '../../src/game/modes/simulate.js';
import * as ai from '../../src/game/ai.js';
import { CARDS } from '../../src/game/cards.js';
import { CAP } from '../../src/game/teamRules.js';
import { getTeam } from '../../src/game/engine.js';
import { canPlayCard } from '../../src/game/canPlay.js';
import { getStrat, CRUNCH_CARDS } from '../../src/game/strats.js';
import { DEFAULT_DECK_COPIES } from '../../src/game/defaultDeckWeights.js';
import { stratCopyCap } from '../../src/game/rarity.js';
import { FEATURES, rosterFeatures } from '../../src/game/deckFit.js';

const GAMES = Number(process.argv.find(a => /^\d+$/.test(a)) ?? 160);
const EMIT = process.argv.includes('--emit');
const DECK_SIZE = Object.values(DEFAULT_DECK_COPIES).reduce((a, b) => a + b, 0);

// THE SWITCHING FLOORS, read off the designed fifty itself rather than typed
// here. The first version keyed Burned on the Switch as `burned_on_the_switch`
// — the card's id is `burned_switch` — so that floor silently never applied
// and every emitted deck carried it at 2. The rule the user set
// (card_design_steers) is that the switching family keeps its designed copies
// whatever the profile says; the designed copies are DEFAULT_DECK_COPIES, so
// that is where the floors come from, and an id typo cannot lose one again.
const SWITCHING = ['high_screen_roll', 'veer_switch', 'burned_switch', 'go_under', 'fight_over', 'overhelp'];
const FLOORS = Object.fromEntries(SWITCHING.map(id => [id, DEFAULT_DECK_COPIES[id] ?? 0]));
for (const id of SWITCHING) if (!(id in DEFAULT_DECK_COPIES)) throw new Error(`switching floor: ${id} is not in the default fifty`);
const JUDGED = new Set(['scoring', 'pre_roll', 'post_roll']);
// A CRUNCH-ONLY CARD IS NEVER JUDGED. It is illegal outside Crunch Time by
// design (drawCards bottoms it; the timeout searches for it), so its legality
// rate in a scoring-window sample is near zero for EVERY roster — and the
// first table cut Reset and Fresh Legs from two archetypes on exactly that
// reading. Same trap as the matchup-phase cards, same fix: exempt by kind.
const judged = id => JUDGED.has(getStrat(id)?.phase) && !CRUNCH_CARDS.includes(id);

/** Ten cards under the cap maximising `want` — a deliberate archetype. */
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

// The archetypes. FAST is the one the measurement was about; BIG and STOPPY
// cut almost nothing and are here so a roster near them gets a deck that is
// honestly its own rather than FAST's by default.
const ARCHETYPES = {
  fast: archetype(c => c.speed * 2 + (c.threePtBoost ?? 0) * 3),
  big: archetype(c => c.power * 2 + (c.paintBoost ?? 0) * 3),
  stoppy: archetype(c => (c.defBoost ?? 0) * 5 + c.speed + c.power),
};

/** The pool's spread on each feature, so a distance is in standard deviations. */
function poolScale() {
  const scale = {};
  for (const f of FEATURES) {
    const xs = CARDS.map(c => c[f.key] ?? 0);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) || 1;
    scale[f.key] = { mean, sd };
  }
  return scale;
}

// ── Pass 1: profile — how often each card is legal in this roster's hand ────
function profile(roster, games) {
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
  // Mirror matches: the roster against itself, so the profile is the roster's
  // own and not a reaction to one particular opponent.
  for (let i = 0; i < games; i += 1) simulateGame(roster, roster, { brains: { A: watcher, B: ai } });
  return seen;
}

// ── Pass 2: fit — runDeckBuild's rule, verbatim ──────────────────────────────
function fit(seen) {
  const want = {};
  let spent = 0;
  for (const [id, copies] of Object.entries(DEFAULT_DECK_COPIES)) {
    const strat = getStrat(id);
    const floor = FLOORS[id] ?? 0;
    if (!strat || !judged(id) || floor) {
      want[id] = Math.max(copies, floor);
      spent += want[id];
      continue;
    }
    const r = seen.get(id);
    const rate = r && r.held >= 20 ? r.legal / r.held : 0.5;
    const n = rate < 0.05 ? 0 : rate < 0.15 ? 1 : Math.max(1, Math.round(copies * (0.5 + rate)));
    want[id] = Math.min(n, stratCopyCap(id));
    spent += want[id];
  }
  const spendable = Object.keys(want)
    .filter(id => judged(id) && !FLOORS[id])
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
      if (want[id] >= stratCopyCap(id) || want[id] === 0) continue;
      want[id] += 1; spent += 1; moved = true;
    }
    if (!moved) break;
  }
  while (spent > DECK_SIZE) {
    const id = [...spendable].reverse().find(x => want[x] > 1);
    if (!id) break;
    want[id] -= 1; spent -= 1;
  }
  for (const id of Object.keys(want)) if (want[id] === 0) delete want[id];
  return want;
}

// ── Build the table ─────────────────────────────────────────────────────────
const scale = poolScale();
const table = [];
for (const [id, roster] of Object.entries(ARCHETYPES)) {
  process.stderr.write(`profiling ${id} over ${GAMES} games…\n`);
  const deck = fit(profile(roster, GAMES));
  const size = Object.values(deck).reduce((a, b) => a + b, 0);
  if (size !== DECK_SIZE) throw new Error(`${id}: deck came to ${size}, not ${DECK_SIZE}`);
  const cut = Object.keys(DEFAULT_DECK_COPIES).filter(k => !deck[k]);
  table.push({ id, centroid: rosterFeatures(roster, scale), deck, cut });
}

const banner = `// GENERATED by scripts/analysis/buildArchetypeDecks.js ${GAMES} --emit — do not edit.
//
// The deck fitter's table (deckFit.js): a few roster archetypes, each with
// the fifty a two-hundred-game legality profile built for it, and where it
// sits in roster-attribute space. Regenerate after a strategy-card change or
// a default-deck change:
//   node scripts/analysis/buildArchetypeDecks.js ${GAMES} --emit
//
// Each archetype's centroid is in the pool's standard deviations on each
// feature (\`scale\`); deckFit.js measures a roster the same way. The switching
// floors are hard constraints in the builder, so every deck here keeps them.
`;
const body = `export const DECK_FIT_SCALE = ${JSON.stringify(scale, null, 2)};

export const ARCHETYPE_DECKS = ${JSON.stringify(table.map(t => ({ id: t.id, centroid: t.centroid, deck: t.deck })), null, 2)};
`;

for (const t of table) {
  console.log(`${t.id.toUpperCase()}  cut: ${t.cut.map(k => getStrat(k)?.name ?? k).join(', ') || 'nothing'}`);
  console.log(`      centroid: ${FEATURES.map(f => `${f.key} ${t.centroid[f.key].toFixed(2)}`).join('  ')}`);
}
if (EMIT) {
  writeFileSync(new URL('../../src/game/archetypeDecks.js', import.meta.url), banner + body);
  console.log('\nwrote src/game/archetypeDecks.js');
} else {
  console.log('\n(run with --emit to write src/game/archetypeDecks.js)');
}
