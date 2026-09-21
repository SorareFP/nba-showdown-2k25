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
import { DPHASE, onClock, rosterKeys, waive, tradeProblems } from './dynasty.js';
import { packDynasty, unpackDynasty } from './seasonPack.js';
import { buildAiLeague } from './aiTeams.js';
import { PHASE, playoffGames } from './seasonCore.js';
import { cardKey } from '../cardSets.js';

const seeded = (s = 808) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const T0 = 1_800_000_000_000;
const tenEach = () => buildAiLeague(2, { rng: seeded(1) }).map(t => t.roster.map(cardKey));

function lobby(startMode = 'fantasy-full', rosters = [[], []], extra = {}) {
  const l = newLeague({
    id: 'dyn-1', kind: 'dynasty', name: 'Ours', hostUid: 'u1',
    settings: { size: 4, length: 'online', startMode, ...extra },
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
  it('asks nothing of a fantasy start, and ten each of an own start — shared players allowed', () => {
    expect(canStart(lobby())).toBeNull();
    expect(canStart(lobby('own'))).toMatch(/team of ten/);
    const [ra, rb] = tenEach();
    // Two coaches may bring the same player (the user, 2026-09-16); the
    // dynasty keys the second copy apart and merges it away if it ever goes
    // unsigned while the other is held (dynasty.js mergeDuplicate).
    expect(canStart(lobby('own', [ra, ra]))).toBeNull();
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
    // BUILT (2026-09-18): both coaches' books at 5 DP a man, so the one-for-
    // one swap is legal whatever the pool dealt them — one card changing
    // team had put it past an apron — and only the offer, the answer and the
    // veto are under test.
    const even = Object.fromEntries(Object.entries(l.state.contracts).map(([k, c]) => [k, c.teamId.startsWith('h:') ? { ...c, dp: 5 } : c]));
    l = { ...l, state: { ...l.state, contracts: even } };
    const d = unpackDynasty(l.state);
    const give = rosterKeys(d, 'h:u2')[0];
    const get = rosterKeys(d, 'h:u1')[0];
    expect(tradeProblems(d, { from: 'h:u2', to: 'h:u1', give: [give], get: [get] })).toEqual([]);
    expect(() => act(l, 'u2', 'tradeAi', { deal: { to: 'h:u1', give: [give], get: [get] } })).toThrow(/offer they answer/);
    l = act(l, 'u2', 'propose', { deal: { to: 'h:u1', give: [give], get: [get] } });
    // The coach's offer — the AI's own offers (2026-09-18) are in d.offers too.
    const id = l.state.offers.find(o => !o.ai).id;
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

  it('reports a playoff series game by game, each with its own home side', () => {
    let l = start(lobby('own', tenEach(), { series: [3] }));
    l = act(act(l, 'u1', 'ready'), 'u2', 'ready');
    const seen = [];
    let guard = 0;
    while (leagueSeason(l)?.phase !== PHASE.done && guard++ < 300) {
      const f = openFixtures(l)[0];
      if (f.playoff) {
        const g = playoffGames(leagueSeason(l)).find(x => x.id === f.id);
        expect([f.home, f.away]).toEqual([g.home, g.away]);
        seen.push(f.id);
      }
      const humanHome = f.home.startsWith('h:');
      const humanAway = f.away.startsWith('h:');
      const homeWins = humanHome || !humanAway;
      l = applyResult(l, { fixtureId: f.id, homeScore: homeWins ? 90 : 70, awayScore: homeWins ? 70 : 90, forfeit: humanHome && humanAway }, { now: 10 + guard }).league;
      // The same game twice is refused.
      if (f.playoff) expect(canReport(l, 'u1', f.id, { forfeit: true })).toMatch(/already has a result|No such fixture/);
    }
    expect(leagueSeason(l).phase).toBe(PHASE.done);
    expect(seen.some(id => /\.g2$/.test(id))).toBe(true);
  });
});

// ── WAIVERS WITH FRIENDS (the user, 2026-09-18) ────────────────────────────
// The same wire as alone (dynasty.test.js 'waivers'), through the server's
// moves: a coach waives, another claims with the 'claim' move, and the wire
// resolves when the phase moves on — or, in season, when a round turns in
// the league's own results (league.js applyResult → seasonTurn). The books
// and the standings are set by hand so priority does not ride on the pool.
describe('waivers with friends (2026-09-18)', () => {
  it('a coach\'s claim takes a waived contract at the phase turn, and an in-season claim resolves when the round turns', () => {
    let l = start(lobby('own', tenEach()));
    const d0 = unpackDynasty(l.state);
    const [u1, u2] = ['h:u1', 'h:u2'];
    const ai = d0.teams.filter(t => !t.human).map(t => t.id);
    // Both coaches' books at 1 DP a man; Bo trimmed to nine, so he has a
    // seat; Ann's best on a 1-DP, three-year deal; Bo last in the standings.
    const contracts = Object.fromEntries(Object.entries(d0.contracts).map(([k, c]) => [k, [u1, u2].includes(c.teamId) ? { ...c, dp: 1, years: 2 } : c]));
    delete contracts[rosterKeys(d0, u2)[0]];
    const key = rosterKeys(d0, u1)[0];
    contracts[key] = { ...contracts[key], years: 3 };
    const worstFirst = [u2, u1, ...ai];
    const table = worstFirst.map((id, i) => ({ id, w: i, l: 9 - i, rank: worstFirst.length - i }));
    l = { ...l, state: packDynasty({ ...d0, contracts, history: [{ year: 0, champion: null, runnerUp: null, playoffSeeds: [], table }] }) };

    l = act(l, 'u1', 'waive', { key });
    expect(l.state.waivers.map(w => w.key)).toEqual([key]);
    expect(() => act(l, 'u1', 'claim', { key })).toThrow(/you waived him/);
    l = act(l, 'u2', 'claim', { key });
    expect(l.state.waivers[0].claims).toEqual([u2]);
    // Nothing moves until the phase does: both ready, the season tips off.
    expect(l.state.contracts[key]).toBeUndefined();
    l = act(act(l, 'u1', 'ready'), 'u2', 'ready');
    expect(l.state.phase).toBe(DPHASE.season);
    expect(l.state.contracts[key]).toMatchObject({ teamId: u2, dp: 1, years: 3, how: 'waivers' });
    expect(l.state.dead.filter(m => m.teamId === u1)).toEqual([]);
    expect(l.state.waivers).toEqual([]);

    // IN SEASON: an AI team's man on the wire (as a deadline shed leaves
    // one), Ann — now worst — claims him, and a round of results turns it.
    const s0 = unpackDynasty(l.state);
    const from = ai[0];
    const shed = rosterKeys(s0, from)[0];
    const bargain = { ...s0, phase: DPHASE.preseason, contracts: { ...s0.contracts, [shed]: { ...s0.contracts[shed], dp: 1, years: 3 } } };
    const waived = waive(bargain, from, shed);
    const s1 = {
      ...waived,
      phase: DPHASE.season,
      history: [{ year: 0, champion: null, runnerUp: null, playoffSeeds: [], table: [u1, u2, ...ai].map((id, i, all) => ({ id, w: i, l: 9 - i, rank: all.length - i })) }],
      season: { ...waived.season, teams: waived.season.teams.map(t => (t.id === from ? { ...t, roster: t.roster.filter(c => cardKey(c) !== shed) } : t)) },
    };
    l = act({ ...l, state: packDynasty(s1) }, 'u1', 'claim', { key: shed });
    const round = leagueSeason(l).round;
    let guard = 0;
    while (leagueSeason(l).round === round && guard++ < 50) {
      expect(l.state.contracts[shed]).toBeUndefined();
      const f = openFixtures(l)[0];
      const humanHome = f.home.startsWith('h:');
      const humanAway = f.away.startsWith('h:');
      l = applyResult(l, { fixtureId: f.id, homeScore: 90, awayScore: 70, forfeit: humanHome && humanAway }, { now: 10 + guard }).league;
    }
    expect(leagueSeason(l).round).toBe(round + 1);
    expect(l.state.contracts[shed]).toMatchObject({ teamId: u1, dp: 1, years: 3, how: 'waivers' });
    expect(l.state.dead.filter(m => m.teamId === from && m.key === shed)).toEqual([]);
    // Stored packed: Ann's live roster, as keys, has him for the next round.
    const annRoster = l.state.season.teams.find(t => t.id === u1).roster;
    expect(annRoster.every(k => typeof k === 'string')).toBe(true);
    expect(annRoster).toContain(shed);
    expect(l.state.news.some(n => /claimed .* off waivers — his salary comes off/.test(n.text))).toBe(true);
  });
});
