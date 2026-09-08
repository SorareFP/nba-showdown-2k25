// A LEAGUE — a competition more than one account plays in: a tournament, or
// a season with other humans in it. This is its state machine, pure, shared
// by the browser (to show it) and the Cloud Functions (to change it).
//
// ── THE SHAPE ───────────────────────────────────────────────────────────────
//
//   {
//     id, kind: 'tournament' | 'season', name, hostUid,
//     status: 'lobby' | 'live' | 'done' | 'cancelled',
//     createdAt, startedAt, finishedAt, joinCode,
//     settings: { size, fee, length, seeding },
//     members: { [uid]: true },                 // who may read it
//     entrants: [{ id: 'h:<uid>', uid, name, roster: [cardKey], deck, deckName, paid }],
//     pool, payouts: [{ uid, coins, reason, at }],
//     bracket: null | <bracket.js>,             // tournament, once started
//     state:   null | <season, dehydrated>,     // season, once started
//     rooms:   { [fixtureId]: { code, hostUid, at } },
//   }
//
// ── WHO MAY CHANGE WHAT ──────────────────────────────────────────────────────
//
// Nothing here checks a signature; the server does that and then calls these.
// What is here is every rule about the league itself: who fits, when it can
// start, which fixture a result belongs to, what a result does to the table
// or the bracket, and what it pays — so the browser can predict exactly what
// the server will do, and the tests can pin it without a database.
//
// The user (2026-09-07, design doc): tournaments are fully PvP with an entry
// fee that forms the pool, half to the champion and half across every match
// win; a season's human-vs-human fixture waits for its PvP room; a stalled
// fixture is the commissioner's call — force a forfeit or a simulation.
import { makeBracket, reportMatch, champion as bracketChampion, winsFor, readyMatches } from './bracket.js';
import { LEAGUE_SIZES, LENGTHS } from './schedule.js';
import { TOURNAMENT_SIZES, ENTRY_FEES, tournamentPayouts } from './prizes.js';
import { PHASE, recordResult, advance, roundComplete, earningsFor, teamsById } from './seasonCore.js';
import { boxLinesFor } from '../boxScore.js';

export const STATUS = { lobby: 'lobby', live: 'live', done: 'done', cancelled: 'cancelled' };
export const KINDS = ['tournament', 'season'];
/** A forfeit is recorded as this score, so standings and brackets read it like any other game. */
export const FORFEIT_SCORE = { winner: 20, loser: 0 };

export const teamIdFor = uid => `h:${uid}`;

/** A human entrant, from what the lobby collected. Rosters travel as card keys. */
export function entrantFor(uid, { name, roster = [], deck = null, deckName = null } = {}) {
  return {
    id: teamIdFor(uid),
    uid,
    name: String(name ?? 'My Team').slice(0, 40),
    roster: roster.map(r => (typeof r === 'string' ? r : r?.key ?? r?.id)).filter(Boolean),
    deck: deck ?? null,
    deckName: deck ? (deckName ?? null) : null,
    paid: 0,
  };
}

function checkSettings(kind, settings) {
  if (!KINDS.includes(kind)) throw new Error(`league: unknown kind ${kind}`);
  const size = Number(settings?.size);
  if (kind === 'tournament' && !TOURNAMENT_SIZES.includes(size)) throw new Error(`league: a tournament is ${TOURNAMENT_SIZES.join('/')} teams`);
  if (kind === 'season' && !LEAGUE_SIZES.includes(size)) throw new Error(`league: a season is ${LEAGUE_SIZES.join('/')} teams`);
  const fee = Number(settings?.fee ?? 0);
  if (kind === 'tournament' && !ENTRY_FEES.includes(fee)) throw new Error(`league: the entry fee is one of ${ENTRY_FEES.join('/')}`);
  if (kind === 'season' && fee !== 0) throw new Error('league: a season has no entry fee');
  const length = kind === 'season' ? (settings?.length ?? 'regular') : null;
  if (kind === 'season' && !LENGTHS[length]) throw new Error('league: unknown season length');
  return { size, fee, length, seeding: 'random' };
}

/** A league in its lobby, with the host as its first entrant. */
export function newLeague({ id, kind, name, hostUid, settings, entrant, joinCode, now = Date.now() }) {
  if (!id || !hostUid || !joinCode) throw new Error('league: id, host and join code are required');
  if (!entrant || entrant.uid !== hostUid) throw new Error('league: the host enters first');
  const s = checkSettings(kind, settings);
  return {
    id,
    kind,
    name: String(name ?? (kind === 'tournament' ? 'Tournament' : 'Season')).slice(0, 60),
    hostUid,
    status: STATUS.lobby,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    joinCode,
    settings: s,
    members: { [hostUid]: true },
    entrants: [{ ...entrant, paid: s.fee }],
    pool: s.fee,
    payouts: [],
    bracket: null,
    state: null,
    rooms: {},
  };
}

export function isMember(league, uid) {
  return Boolean(league?.members?.[uid]);
}

export function isFull(league) {
  return league.entrants.length >= league.settings.size;
}

/** Add an entrant to the lobby. The fee they owe is `league.settings.fee`. */
export function addEntrant(league, entrant, now = Date.now()) {
  if (league.status !== STATUS.lobby) throw new Error('league: no longer open to join');
  if (!entrant?.uid) throw new Error('league: an entrant needs an account');
  if (isMember(league, entrant.uid)) throw new Error('league: already in it');
  if (isFull(league)) throw new Error('league: full');
  const fee = league.settings.fee;
  return {
    ...league,
    members: { ...league.members, [entrant.uid]: true },
    entrants: [...league.entrants, { ...entrant, paid: fee, joinedAt: now }],
    pool: league.pool + fee,
  };
}

/** Leave the lobby. Returns the league and what to refund. The host cancels instead. */
export function removeEntrant(league, uid) {
  if (league.status !== STATUS.lobby) throw new Error('league: it has started');
  if (uid === league.hostUid) throw new Error('league: the host cancels the league instead of leaving it');
  const e = league.entrants.find(x => x.uid === uid);
  if (!e) throw new Error('league: not in it');
  const members = { ...league.members };
  delete members[uid];
  return {
    league: { ...league, members, entrants: league.entrants.filter(x => x.uid !== uid), pool: league.pool - (e.paid || 0) },
    refund: e.paid ? { uid, coins: e.paid } : null,
  };
}

/** Cancel a lobby. Every fee comes back. */
export function cancelLeague(league, now = Date.now()) {
  if (league.status !== STATUS.lobby) throw new Error('league: only a lobby can be cancelled');
  return {
    league: { ...league, status: STATUS.cancelled, finishedAt: now, pool: 0 },
    refunds: league.entrants.filter(e => e.paid).map(e => ({ uid: e.uid, coins: e.paid })),
  };
}

export function canStart(league) {
  if (league.status !== STATUS.lobby) return 'It has already started';
  if (league.kind === 'tournament' && !isFull(league)) return `Needs ${league.settings.size - league.entrants.length} more`;
  if (league.entrants.some(e => (e.roster?.length ?? 0) < 5)) return 'Everyone needs a team of at least five';
  return null;
}

/** Deal the bracket. Random seeding — a PvP rating is the design's eventual seed. */
export function startTournament(league, { rng = Math.random, now = Date.now() } = {}) {
  const why = canStart(league);
  if (why) throw new Error(`league: ${why}`);
  if (league.kind !== 'tournament') throw new Error('league: not a tournament');
  const bracket = makeBracket(league.entrants.map(e => e.id), { random: true, rng });
  return { ...league, status: STATUS.live, startedAt: now, bracket };
}

/**
 * Start a season from the season the host built (createSeason, with every
 * entrant as a human team and AI teams filling the rest). Checked here: the
 * human teams are exactly the entrants, no more and no fewer, so nobody's
 * team is missing and nobody who never joined has one.
 */
export function startSeason(league, state, { now = Date.now() } = {}) {
  const why = canStart(league);
  if (why) throw new Error(`league: ${why}`);
  if (league.kind !== 'season') throw new Error('league: not a season');
  if (!state?.teams || !state.fixtures) throw new Error('league: no season to start');
  const humans = state.teams.filter(t => t.human);
  const want = new Set(league.entrants.map(e => e.id));
  const got = new Set(humans.map(t => t.id));
  if (want.size !== got.size || [...want].some(id => !got.has(id))) throw new Error('league: the season\'s human teams are not the entrants');
  if (state.teams.length !== league.settings.size) throw new Error('league: the season is the wrong size');
  if (state.length !== league.settings.length) throw new Error('league: the season is the wrong length');
  return { ...league, status: STATUS.live, startedAt: now, state: { ...state, id: league.id } };
}

/** The entrant playing as `teamId`, or null for an AI team. */
export function humanFor(league, teamId) {
  return league.entrants.find(e => e.id === teamId) ?? null;
}

export function teamOfUid(league, uid) {
  return isMember(league, uid) ? teamIdFor(uid) : null;
}

/**
 * A fixture in either kind, in one shape:
 *   { id, home, away, ready, played, winner, round, playoff }
 */
export function fixtureOf(league, fixtureId) {
  if (league.kind === 'tournament') {
    const m = league.bracket?.matches.find(x => x.id === fixtureId);
    if (!m) return null;
    return { id: m.id, home: m.a, away: m.b, ready: m.a != null && m.b != null, played: Boolean(m.winner), winner: m.winner, round: m.round, playoff: true };
  }
  const s = league.state;
  if (!s) return null;
  if (s.phase === PHASE.playoffs || s.phase === PHASE.done) {
    const m = s.bracket?.matches.find(x => x.id === fixtureId);
    if (m) return { id: m.id, home: m.a, away: m.b, ready: m.a != null && m.b != null, played: Boolean(m.winner), winner: m.winner, round: m.round, playoff: true };
  }
  const f = s.fixtures.find(x => x.id === fixtureId);
  if (!f) return null;
  return { id: f.id, home: f.home, away: f.away, ready: true, played: Boolean(f.result), winner: f.result?.winner ?? null, round: f.round, playoff: false, inRound: f.round === s.round };
}

/** Every fixture that is open right now — for the bracket view and the host's tools. */
export function openFixtures(league) {
  if (league.status !== STATUS.live) return [];
  if (league.kind === 'tournament') return readyMatches(league.bracket).map(m => fixtureOf(league, m.id));
  const s = league.state;
  if (s.phase === PHASE.playoffs) return readyMatches(s.bracket).filter(m => m.round === s.round).map(m => fixtureOf(league, m.id));
  if (s.phase === PHASE.regular) return s.fixtures.filter(f => f.round === s.round && !f.result).map(f => fixtureOf(league, f.id));
  return [];
}

export function isHumanVsHumanFixture(league, fixture) {
  return Boolean(fixture && humanFor(league, fixture.home) && humanFor(league, fixture.away));
}

/**
 * May `uid` report this result? Null when yes, else why not.
 *   simulated  — an AI-vs-AI fixture the host simulated (seasons only)
 *   forfeit    — the commissioner's call on a stalled fixture
 * A human-vs-human result must come with a room; the server reads it there.
 */
export function canReport(league, uid, fixtureId, { simulated = false, forfeit = false, roomCode = null } = {}) {
  if (league.status !== STATUS.live) return 'The league is not live';
  if (!isMember(league, uid)) return 'Not a member';
  const f = fixtureOf(league, fixtureId);
  if (!f) return 'No such fixture';
  if (!f.ready) return 'That fixture is not ready';
  if (f.played) return 'That fixture already has a result';
  if (league.kind === 'season' && !f.playoff && !f.inRound) return 'That fixture is not in the current round';
  const isHost = uid === league.hostUid;
  const mine = teamOfUid(league, uid);
  const inIt = mine === f.home || mine === f.away;
  if (forfeit) return isHost ? null : 'Only the commissioner can force a forfeit';
  if (simulated) {
    if (!isHost) return 'Only the commissioner can simulate';
    if (humanFor(league, f.home) || humanFor(league, f.away)) return 'A human\'s fixture is played, not simulated';
    return null;
  }
  if (!inIt) return 'Not your fixture';
  if (isHumanVsHumanFixture(league, f) && !(roomCode || league.rooms?.[fixtureId]?.code)) return 'A human-vs-human result comes from its room';
  return null;
}

/**
 * The scores of a finished PvP room, as the fixture sees them. The room's
 * game says which side the host coached (`hostIs`); the fixture says which
 * team is home. A forfeit room pays the winner FORFEIT_SCORE.
 */
export function scoresFromRoom(league, fixture, room) {
  const meta = room?.meta;
  const game = room?.game;
  if (!meta) throw new Error('league: no such room');
  const homeUid = humanFor(league, fixture.home)?.uid;
  const awayUid = humanFor(league, fixture.away)?.uid;
  if (!homeUid || !awayUid) throw new Error('league: that fixture is not two humans');
  const uids = new Set([meta.hostUid, meta.guestUid]);
  if (!uids.has(homeUid) || !uids.has(awayUid)) throw new Error('league: that room is not this fixture\'s');
  const hostIsHome = meta.hostUid === homeUid;
  if (meta.status === 'forfeit' && meta.winner) {
    const hostWon = meta.winner === 'host';
    const homeWon = hostWon === hostIsHome;
    return { homeScore: homeWon ? FORFEIT_SCORE.winner : FORFEIT_SCORE.loser, awayScore: homeWon ? FORFEIT_SCORE.loser : FORFEIT_SCORE.winner, forfeit: true };
  }
  if (!game?.done) throw new Error('league: that game is not over');
  const a = Number(game.teamA?.score ?? 0);
  const b = Number(game.teamB?.score ?? 0);
  const hostScore = game.hostIs === 'A' ? a : b;
  const guestScore = game.hostIs === 'A' ? b : a;
  // The box lines, for the season's player totals, mapped the same way.
  const hostBox = boxLinesFor(game.hostIs === 'A' ? game.teamA : game.teamB);
  const guestBox = boxLinesFor(game.hostIs === 'A' ? game.teamB : game.teamA);
  return {
    homeScore: hostIsHome ? hostScore : guestScore, awayScore: hostIsHome ? guestScore : hostScore, forfeit: false,
    homeBox: hostIsHome ? hostBox : guestBox, awayBox: hostIsHome ? guestBox : hostBox,
  };
}

/** A commissioner's forfeit, as scores. */
export function forfeitScores(fixture, loserTeamId) {
  if (loserTeamId !== fixture.home && loserTeamId !== fixture.away) throw new Error('league: that team is not in the fixture');
  const homeLoses = loserTeamId === fixture.home;
  return { homeScore: homeLoses ? FORFEIT_SCORE.loser : FORFEIT_SCORE.winner, awayScore: homeLoses ? FORFEIT_SCORE.winner : FORFEIT_SCORE.loser, forfeit: true };
}

/**
 * Apply a result. Returns the next league and the coins it pays:
 *   tournament — the winner's per-win share now, the champion's half at the end
 *   season     — nothing per game (games pay through claimGameReward as ever);
 *                title money to every human once the season is done
 * `result` = { fixtureId, homeScore, awayScore, simulated?, forfeit?, roomCode? }
 */
export function applyResult(league, result, { now = Date.now() } = {}) {
  const f = fixtureOf(league, result.fixtureId);
  if (!f) throw new Error(`league: no fixture ${result.fixtureId}`);
  if (f.played) throw new Error('league: already has a result');
  const homeScore = Number(result.homeScore);
  const awayScore = Number(result.awayScore);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore === awayScore) throw new Error('league: a result needs a winner');
  const winner = homeScore > awayScore ? f.home : f.away;
  const payouts = [];
  const pay = (teamId, coins, reason) => {
    const h = humanFor(league, teamId);
    if (h && coins > 0) payouts.push({ uid: h.uid, teamId, coins, reason, at: now });
  };

  if (league.kind === 'tournament') {
    const record = { homeScore, awayScore, simulated: Boolean(result.simulated), forfeit: Boolean(result.forfeit), roomCode: result.roomCode ?? null, at: now };
    const bracket = reportMatch(league.bracket, f.id, winner, record);
    const { perWin, champion: championShare } = tournamentPayouts(league.settings.size, league.settings.fee);
    pay(winner, perWin, `won ${f.id}`);
    let next = { ...league, bracket };
    const champ = bracketChampion(bracket);
    if (champ) {
      pay(champ, championShare, 'champion');
      next = { ...next, status: STATUS.done, finishedAt: now };
    }
    return { league: { ...next, payouts: [...league.payouts, ...payouts] }, payouts, winner };
  }

  // A season: record, then let the calendar move as far as it can.
  let state = recordResult(league.state, {
    fixtureId: f.id, home: f.home, away: f.away, homeScore, awayScore,
    simulated: Boolean(result.simulated), forfeit: Boolean(result.forfeit),
    homeBox: result.homeBox ?? null, awayBox: result.awayBox ?? null,
  });
  while (state.phase === PHASE.regular && roundComplete(state)) {
    const moved = advance(state);
    if (moved === state) break;
    state = moved;
  }
  let next = { ...league, state };
  if (state.phase === PHASE.done) {
    for (const e of league.entrants) pay(e.id, earningsFor(state, e.id).coins, earningsFor(state, e.id).label ?? 'season');
    next = { ...next, status: STATUS.done, finishedAt: now };
  }
  return { league: { ...next, payouts: [...league.payouts, ...payouts] }, payouts, winner };
}

/** What each entrant has earned so far, by uid. */
export function earningsByUid(league) {
  const out = {};
  for (const p of league.payouts ?? []) out[p.uid] = (out[p.uid] ?? 0) + p.coins;
  return out;
}

/** A tournament entrant's wins so far. */
export function winsOf(league, teamId) {
  return league.bracket ? winsFor(league.bracket, teamId) : 0;
}

/** The one-line card for a list: kind, name, status, where it stands. */
export function summarizeLeague(league, uid = null) {
  const mine = uid ? teamOfUid(league, uid) : null;
  let where = null;
  if (league.status === STATUS.lobby) where = `${league.entrants.length}/${league.settings.size} in`;
  else if (league.kind === 'tournament') where = league.status === STATUS.done ? 'final' : `round ${league.bracket ? Math.min(...league.bracket.matches.filter(m => !m.winner).map(m => m.round)) : 1}`;
  else if (league.state) where = league.state.phase === PHASE.done ? 'final' : league.state.phase === PHASE.playoffs ? 'playoffs' : `round ${league.state.round}`;
  const champion = league.kind === 'tournament' ? (league.bracket ? bracketChampion(league.bracket) : null) : (league.state?.champion ?? null);
  return {
    id: league.id, kind: league.kind, name: league.name, status: league.status, where,
    size: league.settings.size, fee: league.settings.fee, pool: league.pool,
    joinCode: league.joinCode, isHost: uid === league.hostUid, mine,
    champion, isChampion: Boolean(mine && champion === mine),
    earned: uid ? (earningsByUid(league)[uid] ?? 0) : 0,
  };
}

/** For a season league: the human teams' uids by team id, so the UI can label them. */
export function uidsByTeam(league) {
  return Object.fromEntries(league.entrants.map(e => [e.id, e.uid]));
}

/** Which entrant "hosts" a human-vs-human room: the home side. */
export function roomHostFor(league, fixture) {
  return humanFor(league, fixture.home)?.uid ?? null;
}

export { teamsById };
