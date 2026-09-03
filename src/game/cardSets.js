// src/game/cardSets.js — every published card set, loaded from the generated
// data the cardgen pipeline writes. This is the app's card SOURCE OF TRUTH:
// cards.js re-exports the base set from here for the engine, and the pack /
// collection layer reaches across all sets.
//
// KEYS. A card's collection key is its bare id for the base set ("Nikola_
// Jokic") and "<set>:<id>" for every other set ("super-season:Nikola_Jokic").
// Base ids stay bare so collections and decks saved before the sets existed
// keep resolving; the colon is legal in a Firestore doc id where "/" is not.
import base from '../../card-data/generated/cards-2026-27.json' with { type: 'json' };
import superSeason from '../../card-data/generated/cards-super-season.json' with { type: 'json' };
import rookie from '../../card-data/generated/cards-rookie.json' with { type: 'json' };
import standouts from '../../card-data/generated/cards-summer-standouts.json' with { type: 'json' };
import dissonance from '../../card-data/generated/cards-dissonance.json' with { type: 'json' };
import wnba from '../../card-data/generated/cards-wnba.json' with { type: 'json' };
import wnbaSuperSeason from '../../card-data/generated/cards-wnba-super-season.json' with { type: 'json' };
import wnbaRookie from '../../card-data/generated/cards-wnba-rookie.json' with { type: 'json' };

export const BASE_SET = '2026-27';

// Set id -> cards, each card annotated with its set. The set id doubles as
// the face directory under public/cards/<set>/<id>.png.
export const CARD_SETS = Object.fromEntries(
  [
    [BASE_SET, base],
    ['super-season', superSeason],
    ['rookie', rookie],
    ['summer-standouts', standouts],
    ['dissonance', dissonance],
    ['wnba', wnba],
    ['wnba-super-season', wnbaSuperSeason],
    ['wnba-rookie', wnbaRookie],
  ].map(([id, payload]) => [id, payload.cards.map(c => ({ ...c, set: id }))])
);

/** The collection key for a card (or for a bare set+id pair). */
export function cardKey(card) {
  return card.set === BASE_SET || !card.set ? card.id : `${card.set}:${card.id}`;
}

/** Every card across every set, keyed for collections. */
export const ALL_CARDS = Object.values(CARD_SETS).flat();

const BY_KEY = new Map(ALL_CARDS.map(c => [cardKey(c), c]));

/**
 * Resolve a collection key to its card, or undefined for a key from a card
 * that no longer exists (a player who left the pool between seasons) — the
 * collection UIs skip those rather than crash.
 */
export function getCardByKey(key) {
  return BY_KEY.get(key);
}
