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
import live from '../../card-data/generated/cards-live.json' with { type: 'json' };
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
// Curated Throwbacks (2026-09-22): generator-owned, never the requests file.
import throwbacks from '../../card-data/generated/cards-throwbacks.json' with { type: 'json' };
// …and the WNBA ones, the Super Seasons the value pick retired (2026-09-24).
import wnbaThrowbacks from '../../card-data/generated/cards-wnba-throwbacks.json' with { type: 'json' };
// The generator-owned Throwbacks with no photo (scripts/studio/dormantThrowbacks.mjs).
import dormant from '../../card-data/generated/dormant-throwbacks.json' with { type: 'json' };

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
  // And since the Super Season value pick (2026-09-24) a SUPER SEASON card can
  // absorb a requested or curated card of the same season: it records
  // `migratedFrom`, and the old copy leaves its set here just the same.
  [
    ...teamRewards.cards, ...wnbaTeamRewards.cards, ...setRewards.cards, ...wnbaSetRewards.cards,
    ...superSeason.cards, ...wnbaSuperSeason.cards,
  ]
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
    // The Live Series (2026-09-23): the base cards as the season moves them.
    // Registered so a live card can be owned, shown and played; whether any
    // pack deals one is LIVE_SERIES_ON (packEngine.js).
    ['live', live],
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
    // A joined card can migrate into a reward too (David Robinson's Spurs
    // reward comes from the Throwbacks since 2026-09-22): a move, not a copy.
    if (hasMigratedOut(card.set, card.id)) continue;
    (sets[card.set] ??= []).push({ ...card });
  }
  return sets;
}
joinFreeAgents(CARD_SETS, freeAgents.cards);

// CURATED THROWBACKS join the same way (2026-09-22). A reward that stops being
// the reward and qualifies for no other set becomes a Throwback — Bradley
// Beal's 2020-21, the Wizards reward until the Wall re-pick — and those cards
// are the GENERATOR'S (scripts/cardgen/generateCuratedCards.js writes
// cards-throwbacks.json from card-data/curated-cards-2026.json), never the
// user's requests file. Each card names its set, so the join is the same one.
//
// DORMANT THROWBACKS (2026-09-24). The user, on the retired seasons the Super
// Season value pick left without a photo: "hidden from packs and not occur
// until someone asks for them via free agents", and "Throwbacks WITHOUT photos
// should stay dormant." A dormant card joins no set, so no pack, list, market
// or checklist ever deals it, and the quote index (built from CARD_SETS) offers
// its season to Free Agents like any uncarded one. It still RESOLVES by key
// (DORMANT_CARDS, in BY_KEY below), so a copy someone already holds keeps its
// face. A request built for the season lands in cards-free-agents.json under
// the same key and is the card from then on: the generator's copy steps aside.
const REQUESTED = new Set((freeAgents.cards ?? []).map(c => `${c.set}:${c.id}`));
const GENERATED_THROWBACKS = [...(throwbacks.cards ?? []), ...(wnbaThrowbacks.cards ?? [])]
  .filter(c => c?.set && !REQUESTED.has(`${c.set}:${c.id}`));
export const DORMANT_KEYS = new Set(dormant.keys ?? []);
export const DORMANT_CARDS = GENERATED_THROWBACKS
  .filter(c => DORMANT_KEYS.has(`${c.set}:${c.id}`) && !hasMigratedOut(c.set, c.id))
  .map(c => ({ ...c }));
joinFreeAgents(CARD_SETS, GENERATED_THROWBACKS.filter(c => !DORMANT_KEYS.has(`${c.set}:${c.id}`)));

/** The collection key for a card (or for a bare set+id pair). */
export function cardKey(card) {
  return card.set === BASE_SET || !card.set ? card.id : `${card.set}:${card.id}`;
}

/** Every card across every set, keyed for collections. */
export const ALL_CARDS = Object.values(CARD_SETS).flat();

// Dormant cards resolve too; a live card of the same key wins.
const BY_KEY = new Map([...DORMANT_CARDS, ...ALL_CARDS].map(c => [cardKey(c), c]));

/**
 * OLD KEYS THAT STILL HAVE TO RESOLVE, literally and only these.
 *
 * A card's key is its set and id, and a card that changes set changes key.
 * Nobody had earned the Toronto reward when it was re-picked (the user,
 * 2026-09-18: "No one has them yet, it doesn't matter. But it should just
 * change face"), so the reward keys themselves need no alias — but dynasties
 * draft from every non-base card (dynasty.js draftClassCards), and
 * team-rewards:Anthony_Parker was Parker's ONLY card, so a saved or friends
 * dynasty holding him would silently lose him (salary 0) when the key stopped
 * resolving. His 2006-07 qualifies as his Super Season, which is where the
 * card now lives. Consulted only after a direct miss, so a live key is never
 * rerouted; canonicalKey folds an old-key copy in a collection onto the card
 * it is, so it still counts.
 */
export const KEY_ALIASES = Object.freeze({
  'team-rewards:Anthony_Parker': 'super-season:Anthony_Parker',
  // The Spurs reward's card kept its numbers and changed its id when its
  // season was demoted to a Throwback (2026-09-22, BEATEN_BY_ROOKIE).
  'team-rewards:David_Robinson': 'team-rewards:David_Robinson_1994',
  // THE SUPER SEASON VALUE PICK (2026-09-24) moved three Super Seasons a
  // franchise reward migrates from; each reward keeps its own season by
  // migrating from that season's retired Throwback, and changes id with it
  // (syncRewardsToSuperSeasons.py) — the Robinson precedent, three times.
  'team-rewards:Kobe_Bryant': 'team-rewards:Kobe_Bryant_2006',
  'team-rewards:Myles_Turner': 'team-rewards:Myles_Turner_2019',
  'team-rewards:John_Stockton': 'team-rewards:John_Stockton_2002',
});

/**
 * THE ALIASES THE CARDS THEMSELVES IMPLY (2026-09-24), beside the hand-kept
 * list above, read off the generated files so a move and its alias can never
 * disagree:
 *
 *   absorbed   a Super Season card that absorbed a requested or curated card
 *              of the same season (`migratedFrom`, the value pick): the old
 *              card's key resolves to the Super Season
 *   retired    a Throwback that WAS a player's Super Season (`demotedFrom`:
 *              the value pick moved it, or a Rookie or base card beat it):
 *              the old Super Season key resolves to the Throwback of the same
 *              season — used only once that key has stopped resolving (the
 *              player has no Super Season now, or a reward took it), so an
 *              owner keeps the card they had. The five 2026-09-22 demotions
 *              (Duncan, Yao, Kirilenko, Mitchell and David Robinson) had no
 *              alias until this; their old keys resolved to nothing.
 *
 * Like KEY_ALIASES, consulted only after a direct miss.
 */
const setOf = (card, fallback) => card.set ?? fallback;
export const DERIVED_ALIASES = new Map([
  ...[[superSeason.cards, 'super-season'], [wnbaSuperSeason.cards, 'wnba-super-season']].flatMap(([cards, set]) =>
    cards.filter(c => c.migratedFrom).map(c => [`${c.migratedFrom.set}:${c.migratedFrom.id}`, `${set}:${c.id}`])),
  ...[...throwbacks.cards, ...wnbaThrowbacks.cards]
    .filter(c => c.demotedFrom)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(c => [`${c.demotedFrom.set}:${c.demotedFrom.id}`, `${setOf(c, 'throwbacks')}:${c.id}`]),
].reverse().filter(([from], i, all) => all.findIndex(([f]) => f === from) === i));

/** The key an old key now stands for, or undefined: the hand-kept list first, then the derived one. */
const aliasOf = plain => KEY_ALIASES[plain] ?? DERIVED_ALIASES.get(plain);

/** The key a collection entry counts as: itself, unless it is an old key for a card that moved. */
export function canonicalKey(key) {
  const plain = baseKey(key);
  const alias = aliasOf(plain);
  // A derived alias only stands in for a key that no longer resolves.
  if (!alias || (!KEY_ALIASES[plain] && BY_KEY.has(plain))) return key;
  return String(key).replace(plain, alias);
}

/**
 * A SECOND COPY OF THE SAME CARD, in a league where two coaches brought it.
 *
 * The user, 2026-09-16: "It's ok if two users bring the same player." A
 * dynasty keys contracts, rights and history by card key, so two coaches
 * arriving with the same Saniya Rivers need two keys that resolve to one card:
 * the first keeps the plain key, the second is `key~2`, a third `key~3`.
 * getCardByKey strips the suffix, so every resolver in the app — the season,
 * the box score, every screen — reads a copy as the card it is. cardKey(card)
 * still gives the plain key, which is why the dynasty never round-trips a key
 * through a card object.
 */
const COPY = /~(\d+)$/;
export const baseKey = key => String(key).replace(COPY, '');
export const copyKey = (key, n) => (n > 1 ? `${baseKey(key)}~${n}` : baseKey(key));

/**
 * Resolve a collection key to its card, or undefined for a key from a card
 * that no longer exists (a player who left the pool between seasons) — the
 * collection UIs skip those rather than crash.
 */
export function getCardByKey(key) {
  // The alias is the LAST resort: a live key never goes through it.
  return BY_KEY.get(key) ?? BY_KEY.get(baseKey(key)) ?? BY_KEY.get(aliasOf(baseKey(key)));
}

