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
import teamRewards from '../../card-data/generated/cards-team-rewards.json' with { type: 'json' };
import wnbaTeamRewards from '../../card-data/generated/cards-wnba-team-rewards.json' with { type: 'json' };
import setRewards from '../../card-data/generated/cards-set-rewards.json' with { type: 'json' };
import wnbaSetRewards from '../../card-data/generated/cards-wnba-set-rewards.json' with { type: 'json' };
import wnba from '../../card-data/generated/cards-wnba.json' with { type: 'json' };
import wnbaSuperSeason from '../../card-data/generated/cards-wnba-super-season.json' with { type: 'json' };
import wnbaRookie from '../../card-data/generated/cards-wnba-rookie.json' with { type: 'json' };
import freeAgents from '../../card-data/generated/cards-free-agents.json' with { type: 'json' };

export const BASE_SET = '2026-27';

/**
 * Cards that have MOVED into the team-rewards set, keyed by their old home.
 *
 * A team reward is not a copy. Twenty-seven of the NBA ones are cards lifted
 * out of Super Season, Rookie and Summer Standouts — the same card, re-badged —
 * so they have to LEAVE those sets or the game would hold two of each, one
 * winnable and one packable, and completing a roster would hand you a duplicate
 * of something you could already buy.
 *
 * BOTH reward sets feed this, because the WNBA set migrates too: Becky Hammon's
 * Super Season card is the Aces reward. Reading only the NBA set here would
 * leave her card in WNBA Super Season as well, which is the exact duplicate the
 * rule forbids — and it would look correct, because the WNBA reward set would
 * still hold its copy.
 *
 * The list is read off the reward cards themselves rather than kept beside
 * them, because the generator is what decides a migration and a second copy of
 * that decision is a second copy that can be wrong.
 */
const MIGRATED_OUT = new Set(
  // The set-completion rewards migrate the same way (generateSetRewards.js).
  [...teamRewards.cards, ...wnbaTeamRewards.cards, ...setRewards.cards, ...wnbaSetRewards.cards]
    .filter(c => c.migratedFrom)
    .map(c => `${c.migratedFrom.set}:${c.migratedFrom.id}`)
);

/**
 * Has this card been moved into the reward set and out of `setId`?
 *
 * Exported because the STUDIO reads the generated JSON files directly rather
 * than through CARD_SETS — it has to, since it edits cards a set has not
 * published yet — and a second copy of this rule there would be a second copy
 * that can disagree. It disagreed once already: the studio listed 225 Super
 * Season cards while the game listed 211.
 */
export function hasMigratedOut(setId, id) {
  return MIGRATED_OUT.has(`${setId}:${id}`);
}

const withoutMigrated = (setId, cards) => cards.filter(c => !hasMigratedOut(setId, c.id));

// Set id -> cards, each card annotated with its set. The set id doubles as
// the face directory under public/cards/<set>/<id>.png.
export const CARD_SETS = Object.fromEntries(
  [
    [BASE_SET, base],
    ['super-season', superSeason],
    ['rookie', rookie],
    ['summer-standouts', standouts],
    ['dissonance', dissonance],
    // EARNED, NOT PACKED. Registered so the reward cards can be looked up,
    // owned and shown like any other card; no pack in packEngine names this
    // pool, which is what keeps them unobtainable except by completing a team.
    ['team-rewards', teamRewards],
    ['set-rewards', setRewards],
    ['wnba', wnba],
    ['wnba-super-season', wnbaSuperSeason],
    ['wnba-rookie', wnbaRookie],
    // EARNED, NOT PACKED, exactly like the NBA reward set above.
    ['wnba-team-rewards', wnbaTeamRewards],
    ['wnba-set-rewards', wnbaSetRewards],
  ].map(([id, payload]) => [id, withoutMigrated(id, payload.cards).map(c => ({ ...c, set: id }))])
);

// FREE AGENTS: requested cards, built one at a time (buildFreeAgent.mjs) into
// their own file and merged into the set each was classified into — Rookie,
// Super Season, Summer Standouts. So a request joins that set's packs and its
// collection, as the user asked. Their own file so regenerating Rookie or
// Super Season can never wipe one.
export function joinFreeAgents(sets, cards) {
  for (const card of cards ?? []) {
    if (!card?.set) continue;
    (sets[card.set] ??= []).push({ ...card });
  }
  return sets;
}
joinFreeAgents(CARD_SETS, freeAgents.cards);

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
