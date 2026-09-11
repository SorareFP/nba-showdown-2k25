// A DYNASTY WITH FRIENDS on its league, end to end without a database: the
// lobby, the server's start, moves made the way dynastyAct makes them
// (unpack, move, settle, pack), a season played through the league's
// fixtures, and the year's money landing on both coaches.
import { describe, it, expect } from 'vitest';
import {
  newLeague, entrantFor, addEntrant, canStart, startDynastyLeague, settleDynasty, openFixtures, applyResult,
  leagueSeason, canReport, summarizeLeague, STATUS,
} from './league.js';
import { createFriendsDynasty, friendsAct } from './dynastyFriends.js';
import { DPHASE, onClock, rosterKeys } from './dynasty.js';
import { packDynasty, unpackDynasty } from './seasonPack.js';
import { buildAiLeague } from './aiTeams.js';
import { PHASE } from './seasonCore.js';
import { cardKey } from '../cardSets.js';

const seeded = (s = 808) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const T0 = 1_800_000_000_000;
const tenEach = () => buildAiLeague(2, { rng: seeded(1) }).map(t => t.roster.map(cardKey));

function lobby(startMode = 'fantasy-full', rosters = [[], []]) {
  const l = newLeague({
    id: 'dyn-1', kind: 'dynasty', name: 'Ours', hostUid: 'u1',
    settings: { size: 4, length: 'online', startMode },
    entrant: entrantFor('u1', { name: 'Ann', roster: rosters[0] }), joinCode: 'DYN123', now: 1,
  });
  return addEntrant(l, entrantFor('u2', { name: 'Bo', roster: rosters[1] }), 2);
}

/** What startLeague does for a dynasty. */
const start = l => startDynastyLeague(l, packDynasty(createFriendsDynasty(l, { rng: seeded(3), now: T0 })), { now: 3 });

let offerN = 0;
/** What dynastyAct does: unpack, move, settle, pack. */
function act(l, uid, op, args = {}) {
  const out = friendsAct(unpackDynasty(l.state), `h:${uid}`, op, args, {
    rng: seeded(7), now: T0, isHost: uid === l.hostUid, id: `o${(offerN += 1)}`,
  });
  return settleDynasty(l, packDynasty(out.dynasty), { now: T0 }).league;
}

describe('the lobby', () => {
  it('asks nothing of a fantasy start, and ten each — no player twice — of an own start', () => {
    expect(canStart(lobby())).toBeNull();
    expect(canStart(lobby('own'))).toMatch(/team of ten/);
    const [ra, rb] = tenEach();
    expect(canStart(lobby('own', [ra, ra]))).toMatch(/same player/);
    expect(canStart(lobby('own', [ra, rb]))).toBeNull();
    expect(() => newLeague({
      id: 'x', kind: 'dynasty', hostUid: 'u1', settings: { size: 4, length: 'online', startMode: 'nope' },
      entrant: entrantFor('u1', {}), joinCode: 'X', now: 1,
    })).toThrow(/unknown way/);
  });
});

describe('starting it', () => {
  it('starts from the dynasty the server builds, stored packed, on a coach\'s clock', () => {
    const l = start(lobby());
    expect(l.status).toBe(STATUS.live);
    expect([...l.state.humans].sort()).toEqual(['h:u1', 'h:u2']);
    const d = unpackDynasty(l.state);
    expect(d.phase).toBe(DPHASE.draft);
    expect(['h:u1', 'h:u2']).toContain(onClock(d).teamId);
    expect(d.draft.clockAt).toBe(T0);
    expect(summarizeLeague(l).where).toMatch(/year 1/);
  });

  it('refuses a dynasty whose coaches are not the entrants', () => {
    const l = lobby();
    const d = packDynasty(createFriendsDynasty(l, { rng: seeded(3), now: T0 }));
    expect(() => startDynastyLeague(l, { ...d, humans: ['h:u1'] })).toThrow(/coaches/);
  });
});

describe('moves', () => {
  it('only the coach on the clock picks; a stranger and a non-commissioner are refused', () => {
    const l = start(lobby());
    const d = unpackDynasty(l.state);
    const c = onClock(d);
    const mine = c.teamId.slice(2);
    const other = mine === 'u1' ? 'u2' : 'u1';
    const key = d.draft.pool.find(k => !d.draft.picks.some(p => p.key === k));
    expect(() => act(l, other, 'pick', { key })).toThrow(/not on the clock/);
    expect(() => act(l, 'u9', 'tick')).toThrow(/not a coach/);
    expect(() => act(l, 'u2', 'force')).toThrow(/commissioner/);
    const after = unpackDynasty(act(l, mine, 'pick', { key }).state);
    expect(after.draft.picks.find(p => p.key === key).teamId).toBe(c.teamId);
    expect(() => act(l, 'u1', 'jump')).toThrow(/no such move/);
  });

  it('trades between coaches go through offers the commissioner can veto', () => {
    let l = start(lobby('own', tenEach()));
    const d = unpackDynasty(l.state);
    const give = rosterKeys(d, 'h:u2')[0];
    const get = rosterKeys(d, 'h:u1')[0];
    expect(() => act(l, 'u2', 'tradeAi', { deal: { to: 'h:u1', give: [give], get: [get] } })).toThrow(/offer they answer/);
    l = act(l, 'u2', 'propose', { deal: { to: 'h:u1', give: [give], get: [get] } });
    const id = l.state.offers[0].id;
    l = act(l, 'u1', 'respond', { id, accept: true });
    expect(l.state.contracts[give].teamId).toBe('h:u1');
    expect(() => act(l, 'u2', 'veto', { id })).toThrow(/commissioner/);
    l = act(l, 'u1', 'veto', { id });
    expect(l.state.contracts[give].teamId).toBe('h:u2');
  });

  it('sets a coach\'s deck', () => {
    const l = act(start(lobby('own', tenEach())), 'u1', 'setDeck', { deck: { zone: 2 }, deckName: 'Mine' });
    expect(l.state.teams.find(t => t.id === 'h:u1')).toMatchObject({ deck: { zone: 2 }, deckName: 'Mine' });
  });
});

describe('a year through the league', () => {
  it('plays the season on the league\'s fixtures, then pays both coaches as the year goes in the book', () => {
    let l = start(lobby('own', tenEach()));
    expect(l.state.phase).toBe(DPHASE.preseason);
    l = act(act(l, 'u1', 'ready'), 'u2', 'ready');
    expect(l.state.phase).toBe(DPHASE.season);
    // Stored packed: the live season's rosters are keys, and come back as cards.
    expect(typeof l.state.season.teams[0].roster[0]).toBe('string');
    expect(unpackDynasty(l.state).season.teams[0].roster[0].name).toBeTruthy();

    let guard = 0;
    while (leagueSeason(l)?.phase !== PHASE.done && guard++ < 300) {
      const f = openFixtures(l)[0];
      const humanHome = f.home.startsWith('h:');
      const humanAway = f.away.startsWith('h:');
      if (!humanHome && !humanAway) expect(canReport(l, 'u1', f.id, { simulated: true })).toBeNull();
      const homeWins = humanHome || !humanAway;
      l = applyResult(l, { fixtureId: f.id, homeScore: homeWins ? 90 : 70, awayScore: homeWins ? 70 : 90, forfeit: humanHome && humanAway }, { now: 10 + guard }).league;
    }
    expect(leagueSeason(l).phase).toBe(PHASE.done);
    expect(l.status).toBe(STATUS.live);
    expect(l.payouts).toHaveLength(0);
    // A season still being played cannot be forced on; a finished one moves when both are ready.
    l = act(act(l, 'u1', 'ready'), 'u2', 'ready');
    expect(l.state.phase).not.toBe(DPHASE.season);
    expect(l.state.history).toHaveLength(1);
    const paid = new Set(l.payouts.map(p => p.uid));
    expect(paid.has('u1') && paid.has('u2')).toBe(true);
    expect(l.payouts.every(p => p.coins > 0 && /Year 1/.test(p.reason))).toBe(true);
    // Settling the same state again pays nothing twice.
    expect(settleDynasty(l, l.state).payouts).toHaveLength(0);
  });
});
