// A league's state machine, pinned without a database: lobby, start, results,
// payouts, and the two ways a stalled fixture gets resolved.
import { describe, it, expect } from 'vitest';
import {
  newLeague, entrantFor, addEntrant, removeEntrant, cancelLeague, canStart,
  startTournament, startSeason, fixtureOf, openFixtures, canReport, applyResult,
  scoresFromRoom, forfeitScores, summarizeLeague, earningsByUid, STATUS, FORFEIT_SCORE,
} from './league.js';
import { tournamentPayouts } from './prizes.js';
import { createSeason } from './season.js';
import { CARDS } from '../cards.js';

const roster = n => CARDS.slice(n * 10, n * 10 + 10);
const keys = n => roster(n).map(c => c.id);
const entrant = (uid, n) => entrantFor(uid, { name: `Team ${uid}`, roster: keys(n) });
const seeded = (s = 7) => () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };

function lobby(kind = 'tournament', size = 4, fee = 100) {
  const settings = kind === 'tournament' ? { size, fee } : { size, fee: 0, length: 'short' };
  return newLeague({ id: 'L1', kind, name: 'Test', hostUid: 'u1', settings, entrant: entrant('u1', 0), joinCode: 'ABC123', now: 1000 });
}

describe('the lobby', () => {
  it('opens with the host paid in, fills, and refuses a fifth', () => {
    let l = lobby();
    expect(l.status).toBe(STATUS.lobby);
    expect(l.pool).toBe(100);
    expect(l.entrants[0].paid).toBe(100);
    l = addEntrant(l, entrant('u2', 1));
    l = addEntrant(l, entrant('u3', 2));
    expect(canStart(l)).toMatch(/1 more/);
    l = addEntrant(l, entrant('u4', 3));
    expect(l.pool).toBe(400);
    expect(canStart(l)).toBe(null);
    expect(() => addEntrant(l, entrant('u5', 4))).toThrow(/full/);
    expect(() => addEntrant(l, entrant('u2', 1))).toThrow(/already/);
  });

  it('refunds a leaver, and refunds everyone on cancel', () => {
    let l = addEntrant(lobby(), entrant('u2', 1));
    const left = removeEntrant(l, 'u2');
    expect(left.refund).toEqual({ uid: 'u2', coins: 100 });
    expect(left.league.pool).toBe(100);
    expect(left.league.members.u2).toBeUndefined();
    expect(() => removeEntrant(l, 'u1')).toThrow(/cancels/);
    const c = cancelLeague(l);
    expect(c.league.status).toBe(STATUS.cancelled);
    expect(c.refunds).toEqual([{ uid: 'u1', coins: 100 }, { uid: 'u2', coins: 100 }]);
  });

  it('checks the settings', () => {
    expect(() => lobby('tournament', 6)).toThrow(/4\/8\/16/);
    expect(() => lobby('tournament', 4, 77)).toThrow(/entry fee/);
    expect(() => newLeague({ id: 'x', kind: 'season', name: 's', hostUid: 'u1', settings: { size: 8, fee: 50, length: 'short' }, entrant: entrant('u1', 0), joinCode: 'Q' })).toThrow(/no entry fee/);
  });
});

describe('a tournament', () => {
  function live() {
    let l = lobby();
    for (const [uid, n] of [['u2', 1], ['u3', 2], ['u4', 3]]) l = addEntrant(l, entrant(uid, n));
    return startTournament(l, { rng: seeded(), now: 2000 });
  }

  it('deals a bracket of the entrants and opens the first round', () => {
    const l = live();
    expect(l.status).toBe(STATUS.live);
    expect(l.bracket.size).toBe(4);
    const open = openFixtures(l);
    expect(open).toHaveLength(2);
    expect(open.every(f => f.ready && !f.played)).toBe(true);
    expect(new Set(open.flatMap(f => [f.home, f.away]))).toEqual(new Set(['h:u1', 'h:u2', 'h:u3', 'h:u4']));
  });

  it('pays a match win to the winner, and the champion the half, through the bracket', () => {
    let l = live();
    const { perWin, champion } = tournamentPayouts(4, 100);
    const [m1, m2] = openFixtures(l);
    let r = applyResult(l, { fixtureId: m1.id, homeScore: 60, awayScore: 55 }, { now: 3000 });
    expect(r.payouts).toEqual([{ uid: r.winner.slice(2), teamId: r.winner, coins: perWin, reason: `won ${m1.id}`, at: 3000 }]);
    l = r.league;
    expect(l.status).toBe(STATUS.live);
    r = applyResult(l, { fixtureId: m2.id, homeScore: 40, awayScore: 70 });
    l = r.league;
    const final = openFixtures(l);
    expect(final).toHaveLength(1);
    r = applyResult(l, { fixtureId: final[0].id, homeScore: 80, awayScore: 79 }, { now: 4000 });
    l = r.league;
    expect(l.status).toBe(STATUS.done);
    expect(r.payouts.map(p => p.coins).sort((a, b) => a - b)).toEqual([perWin, champion].sort((a, b) => a - b));
    const earned = earningsByUid(l);
    expect(Object.values(earned).reduce((a, b) => a + b, 0)).toBe(400);   // the whole pool, paid out
    expect(summarizeLeague(l, r.winner.slice(2)).isChampion).toBe(true);
  });

  it('refuses a second result, a result from a stranger, and a tie', () => {
    const l = live();
    const [m1] = openFixtures(l);
    expect(canReport(l, 'u9', m1.id)).toMatch(/Not a member/);
    const outsider = ['u1', 'u2', 'u3', 'u4'].find(u => `h:${u}` !== m1.home && `h:${u}` !== m1.away);
    expect(canReport(l, outsider, m1.id)).toMatch(/Not your fixture/);
    expect(canReport(l, m1.home.slice(2), m1.id)).toMatch(/comes from its room/);
    expect(canReport(l, m1.home.slice(2), m1.id, { roomCode: 'ROOM1' })).toBe(null);
    const done = applyResult(l, { fixtureId: m1.id, homeScore: 60, awayScore: 55 }).league;
    expect(canReport(done, m1.home.slice(2), m1.id, { roomCode: 'ROOM1' })).toMatch(/already/);
    expect(() => applyResult(l, { fixtureId: m1.id, homeScore: 50, awayScore: 50 })).toThrow(/winner/);
  });

  it('reads a finished room the way the fixture sees it, and a forfeit as 20–0', () => {
    const l = live();
    const [m1] = openFixtures(l);
    const homeUid = m1.home.slice(2), awayUid = m1.away.slice(2);
    // The home human hosted the room and coached team B; the guest (away) coached A.
    const room = { meta: { hostUid: homeUid, guestUid: awayUid, status: 'active' }, game: { done: true, hostIs: 'B', teamA: { score: 71 }, teamB: { score: 64 } } };
    expect(scoresFromRoom(l, m1, room)).toEqual({ homeScore: 64, awayScore: 71, forfeit: false });
    const flipped = { meta: { hostUid: awayUid, guestUid: homeUid }, game: { done: true, hostIs: 'A', teamA: { score: 71 }, teamB: { score: 64 } } };
    expect(scoresFromRoom(l, m1, flipped)).toEqual({ homeScore: 64, awayScore: 71, forfeit: false });
    expect(() => scoresFromRoom(l, m1, { meta: { hostUid: homeUid, guestUid: 'zzz' }, game: { done: true } })).toThrow(/not this fixture/);
    expect(() => scoresFromRoom(l, m1, { meta: room.meta, game: { done: false } })).toThrow(/not over/);
    const forfeit = { meta: { hostUid: homeUid, guestUid: awayUid, status: 'forfeit', winner: 'guest' } };
    expect(scoresFromRoom(l, m1, forfeit)).toEqual({ homeScore: FORFEIT_SCORE.loser, awayScore: FORFEIT_SCORE.winner, forfeit: true });
    expect(forfeitScores(m1, m1.home)).toEqual({ homeScore: 0, awayScore: 20, forfeit: true });
    expect(canReport(l, 'u1', m1.id, { forfeit: true })).toBe(null);
    expect(canReport(l, 'u2', m1.id, { forfeit: true })).toMatch(/commissioner/);
  });
});

describe('a season with humans', () => {
  function live() {
    let l = lobby('season', 4, 0);
    l = addEntrant(l, entrant('u2', 1));
    const state = createSeason({
      id: 'L1', size: 4, length: 'short', rng: seeded(3),
      humans: l.entrants.map(e => ({ id: e.id, uid: e.uid, name: e.name, roster: e.roster.map(k => CARDS.find(c => c.id === k)) })),
    });
    return { l: startSeason(l, state, { now: 2000 }), state };
  }

  it('starts only from a season whose human teams are exactly the entrants', () => {
    const { l } = live();
    expect(l.status).toBe(STATUS.live);
    expect(l.state.teams.filter(t => t.human).map(t => t.id).sort()).toEqual(['h:u1', 'h:u2']);
    const wrong = createSeason({ size: 4, length: 'short', rng: seeded(), humans: [{ id: 'h:u1', uid: 'u1', name: 'x', roster: roster(0) }] });
    expect(() => startSeason(lobby('season', 4, 0), wrong)).not.toThrow();   // one human, the host alone: fine
    expect(() => startSeason(addEntrant(lobby('season', 4, 0), entrant('u2', 1)), wrong)).toThrow(/human teams are not the entrants/);
  });

  it('lets the host simulate AI fixtures, makes the humans play theirs, and advances the round on its own', () => {
    let { l } = live();
    const round1 = openFixtures(l);
    const ai = round1.filter(f => !f.home.startsWith('h:') && !f.away.startsWith('h:'));
    const mine = round1.filter(f => f.home === 'h:u1' || f.away === 'h:u1');
    for (const f of ai) {
      expect(canReport(l, 'u1', f.id, { simulated: true })).toBe(null);
      expect(canReport(l, 'u2', f.id, { simulated: true })).toMatch(/commissioner/);
      l = applyResult(l, { fixtureId: f.id, homeScore: 50, awayScore: 44, simulated: true }).league;
    }
    for (const f of mine) {
      expect(canReport(l, 'u1', f.id, { simulated: true })).toMatch(/played, not simulated/);
      expect(canReport(l, 'u1', f.id)).toBe(null);
    }
    // Everything else in the round, so it can turn over.
    for (const f of openFixtures(l)) {
      const hh = f.home.startsWith('h:') && f.away.startsWith('h:');
      l = applyResult(l, { fixtureId: f.id, homeScore: 55, awayScore: 50, ...(hh ? { roomCode: 'R' } : {}) }).league;
    }
    expect(l.state.round).toBe(2);
    expect(openFixtures(l).every(f => f.round === 2)).toBe(true);
  });

  it('plays the whole calendar through and pays the title money at the end', () => {
    let { l } = live();
    let guard = 0;
    while (l.status === STATUS.live && guard < 200) {
      const open = openFixtures(l);
      if (!open.length) break;
      const f = open[0];
      l = applyResult(l, { fixtureId: f.id, homeScore: 60, awayScore: 58, roomCode: 'R' }).league;
      guard += 1;
    }
    expect(l.status).toBe(STATUS.done);
    expect(l.state.phase).toBe('done');
    expect(l.state.champion).toBeTruthy();
    const champ = l.entrants.find(e => e.id === l.state.champion);
    if (champ) expect(earningsByUid(l)[champ.uid]).toBeGreaterThan(0);
    expect(l.payouts.every(p => ['u1', 'u2'].includes(p.uid))).toBe(true);
  });
});
