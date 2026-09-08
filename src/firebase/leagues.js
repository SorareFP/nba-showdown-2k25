// LEAGUES on the client: reading them, watching one, and shaping what the
// lobby sends. Every change goes through the callables in serverWrites.js
// (createLeague, joinLeague, leaveLeague, cancelLeague, startLeague,
// attachLeagueRoom, reportLeagueResult, forfeitLeagueFixture); nothing here
// writes to Firestore, and the rules refuse it if something tried.
//
// A member's list comes from users/{uid}/leagues, the index the server keeps
// on every change — so no query over the shared documents is needed, and the
// per-document read is the one the rules allow a member.
import { doc, getDoc, getDocs, collection, onSnapshot } from 'firebase/firestore';
import { db } from './config.js';
import { cardKey, getCardByKey } from '../game/cardSets.js';
import { hydrate, dehydrate } from './seasons.js';
import { entrantFor } from '../game/modes/league.js';

export {
  summarizeLeague, fixtureOf, openFixtures, canReport, humanFor, teamOfUid, isHumanVsHumanFixture,
  earningsByUid, winsOf, canStart, isFull, roomHostFor, uidsByTeam, STATUS as LEAGUE_STATUS, teamIdFor,
} from '../game/modes/league.js';

/** The entrant the lobby sends: rosters travel as card keys. */
export function entrantFromTeam(uid, { name, roster = [], deck = null, deckName = null }) {
  return entrantFor(uid, { name, roster: roster.map(c => (typeof c === 'string' ? c : cardKey(c))), deck, deckName });
}

/** An entrant's roster as cards again (a card that left the pool is dropped). */
export function rosterOfEntrant(entrant) {
  return (entrant?.roster ?? []).map(k => getCardByKey(k)).filter(Boolean);
}

/** Every league this account is in, newest first. */
export async function listMyLeagues(uid) {
  if (!uid) return [];
  const idx = await getDocs(collection(db, 'users', uid, 'leagues'));
  const ids = idx.docs.map(d => d.id);
  const docs = await Promise.all(ids.map(id => getDoc(doc(db, 'leagues', id)).catch(() => null)));
  return docs.filter(d => d && d.exists()).map(d => d.data()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function readLeague(id) {
  const snap = await getDoc(doc(db, 'leagues', id));
  return snap.exists() ? snap.data() : null;
}

/** Live updates for one league; returns the unsubscribe. */
export function watchLeague(id, cb) {
  return onSnapshot(doc(db, 'leagues', id), snap => cb(snap.exists() ? snap.data() : null), () => cb(null));
}

/** A season league's season, with its rosters restored to cards. */
export function seasonOfLeague(league) {
  return league?.state ? hydrate(league.state) : null;
}

/** What startLeague expects for a season: the host's built season, rosters as keys. */
export function seasonForStart(season) {
  return dehydrate(season);
}
