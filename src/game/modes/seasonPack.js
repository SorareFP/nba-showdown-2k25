// A SEASON OR A DYNASTY AS IT IS STORED — pure, so the browser's stores
// (firebase/seasons.js, firebase/dynasties.js) and the Cloud Functions (a
// dynasty with friends lives on its league document) pack and unpack the
// same way.
//
// A season holds its rosters as card objects in play and as card KEYS at
// rest: a whole card in Firestore goes stale the moment a set is regenerated,
// and the key is the only part that is really the season's. A dynasty is
// already all keys except its live season. Firestore refuses `undefined`, so
// a packed dynasty goes through a JSON round trip that strips any strays.
import { cardKey, getCardByKey } from '../cardSets.js';

const keyOf = c => (typeof c === 'string' ? c : cardKey(c));

/** A season with its rosters flattened to keys. Already-flat rosters pass through. */
export function packSeason(season) {
  return {
    ...season,
    teams: (season.teams ?? []).map(t => ({ ...t, roster: (t.roster ?? []).map(keyOf) })),
  };
}

/**
 * A stored season with its cards restored. A card that no longer exists (a set
 * was regenerated under a running season — the rookie trim did exactly this)
 * is dropped rather than left as `undefined`, and that team plays a man short
 * rather than the season failing to open.
 */
export function unpackSeason(stored) {
  if (!stored) return null;
  return {
    ...stored,
    teams: (stored.teams ?? []).map(t => ({
      ...t,
      roster: (t.roster ?? []).map(k => (typeof k === 'string' ? getCardByKey(k) : k)).filter(Boolean),
    })),
  };
}

/** What a dynasty stores: the live season's rosters as keys, and no `undefined`. */
export function packDynasty(d) {
  return JSON.parse(JSON.stringify({ ...d, season: d.season ? packSeason(d.season) : null }));
}

/** A stored dynasty with its live season's cards restored. */
export function unpackDynasty(stored) {
  if (!stored) return null;
  return { ...stored, season: stored.season ? unpackSeason(stored.season) : null };
}
