// THE DECK FITTER — which fifty an AI team plays, given the ten it fields.
//
// The user, 2026-09-16: "Deck-matched AI opponents are what I want, yes."
//
// ── WHY ─────────────────────────────────────────────────────────────────────
//
// Every AI team in every mode played the same fifty (defaultDeckWeights.js),
// and three measurements said what that cost (scripts/analysis/runHandSilt.js,
// runDeckFit.js, runDeckBuild.js): by the last section the coach held seven
// cards and could play a fifth of one; card legality swung a hundred points
// between roster archetypes (Back to the Basket is legal 100% of the time for
// a big team and 0% for a fast one); and a deck built for the roster was worth
// +6.23 a game to the roster the default misfits worst — and nothing at all
// to the rosters it already suits. That shape is the design: fit the misfits,
// leave everyone else on the fifty that was designed for them.
//
// ── HOW, CHEAPLY ────────────────────────────────────────────────────────────
//
// Learning what a roster can make legal takes two hundred games, which cannot
// happen when a season deals its teams. So the learning is offline
// (buildArchetypeDecks.js) and what ships is a table: a few archetypes, each
// with the deck the profile built for it and a centroid in roster-attribute
// space (archetypeDecks.js). Here a roster is reduced to the same five means,
// standardised by the pool's spread, and handed the nearest archetype's deck —
// or null, the default fifty, when nothing is within FIT_CUTOFF standard
// deviations. The cutoff is what keeps a roster that is merely a little quick
// off the FAST deck, which was built for a roster that cannot play Back to the
// Basket at all.
//
// ── SERVER-SAFE ─────────────────────────────────────────────────────────────
//
// This runs where the AI teams are built, which includes the Cloud Functions
// (a dynasty with friends deals its league on the server). Nothing here may
// reach the engine or canPlayCard; it reads card attributes and a table.
import { ARCHETYPE_DECKS, DECK_FIT_SCALE } from './archetypeDecks.js';

/** The roster attributes a deck's fit depends on — means over the ten. */
export const FEATURES = [
  { key: 'speed' },
  { key: 'power' },
  { key: 'threePtBoost' },
  { key: 'paintBoost' },
  { key: 'defBoost' },
];

/** How far, in pool standard deviations, a roster may sit from an archetype and still take its deck. */
export const FIT_CUTOFF = 1.0;

/** A roster's mean on each feature, in the pool's standard deviations. */
export function rosterFeatures(roster, scale = DECK_FIT_SCALE) {
  const cards = (roster ?? []).filter(Boolean);
  const out = {};
  for (const f of FEATURES) {
    const s = scale?.[f.key] ?? { mean: 0, sd: 1 };
    const mean = cards.length ? cards.reduce((t, c) => t + (c[f.key] ?? 0), 0) / cards.length : 0;
    out[f.key] = (mean - s.mean) / (s.sd || 1);
  }
  return out;
}

const distance = (a, b) => Math.sqrt(FEATURES.reduce((t, f) => t + ((a[f.key] ?? 0) - (b[f.key] ?? 0)) ** 2, 0));

/** The archetype this roster sits nearest, with the distance — or null with an empty table. */
export function nearestArchetype(roster, { table = ARCHETYPE_DECKS, scale = DECK_FIT_SCALE } = {}) {
  if (!table?.length || !roster?.length) return null;
  const at = rosterFeatures(roster, scale);
  let best = null;
  for (const arch of table) {
    const d = distance(at, arch.centroid);
    if (!best || d < best.distance) best = { id: arch.id, distance: d, deck: arch.deck };
  }
  return best;
}

/**
 * The deck an AI team should play with this roster: the nearest archetype's
 * fifty when it is close enough, else null — which every caller already reads
 * as "the default fifty" (engine.js buildDeck).
 */
export function fitDeck(roster, { cutoff = FIT_CUTOFF, table = ARCHETYPE_DECKS, scale = DECK_FIT_SCALE } = {}) {
  const near = nearestArchetype(roster, { table, scale });
  if (!near || near.distance > cutoff) return null;
  return { ...near.deck };
}
