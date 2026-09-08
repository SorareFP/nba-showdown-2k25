// A season keeps its players' totals — folded from every result's box score,
// played or simmed, solo or shared — and reads them back by team or as the
// league's leaders. The user (2026-09-08): "Player stats accumulated in a
// season should show within the season."
import { describe, it, expect } from 'vitest';
import { createSeason, recordResult, teamSeasonStats, seasonLeaders, resultFromPlayed, roundFixtures, PHASE } from './season.js';
import { simulateFixture } from './simulate.js';
import { rostersOf } from './seasonCore.js';
import { newLeague, entrantFor, addEntrant, startSeason, applyResult, scoresFromRoom, openFixtures, isHumanVsHumanFixture } from './league.js';
import { boxLinesFor, boxScoreFor } from '../boxScore.js';
import { dehydrate, hydrate } from '../../firebase/seasons.js';
import { CARDS } from '../cards.js';
import { cardKey } from '../cardSets.js';

const seeded = (s = 5) => () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const roster = n => CARDS.slice(n * 10, n * 10 + 10);
const line = (card, pts, reb = 1, ast = 1) => ({ key: cardKey(card), pts, reb, ast, min: 12, tpm: 0, tpa: 1 });

function season() {
  return createSeason({ id: 's', humans: [{ id: 'you', name: 'You', roster: roster(0) }], size: 4, length: 'short', rng: seeded() });
}

describe('recordResult folds the box scores', () => {
  it('adds each side\'s lines to the season\'s totals and keeps them out of the stored result', () => {
    let s = season();
    const f = roundFixtures(s)[0];
    const homeRoster = rostersOf(s)[f.home];
    const awayRoster = rostersOf(s)[f.away];
    s = recordResult(s, { fixtureId: f.id, home: f.home, away: f.away, homeScore: 90, awayScore: 80,
      homeBox: [line(homeRoster[0], 30, 5, 2), line(homeRoster[1], 10)], awayBox: [line(awayRoster[0], 22)] });
    expect(s.results[0].homeBox).toBeUndefined();
    expect(s.results[0].homeScore).toBe(90);
    const home = teamSeasonStats(s, f.home);
    expect(home.map(r => r.key)).toEqual([cardKey(homeRoster[0]), cardKey(homeRoster[1])]);
    expect(home[0]).toMatchObject({ g: 1, pts: 30, reb: 5, ast: 2, ppg: 30, rpg: 5, apg: 2 });
    // The same player in a second game accumulates; a new one appears.
    const f2 = { id: 'x2', home: f.home, away: f.away };
    s.fixtures.push({ id: 'x2', round: s.round, home: f.home, away: f.away });
    s = recordResult(s, { fixtureId: 'x2', home: f2.home, away: f2.away, homeScore: 70, awayScore: 75,
      homeBox: [line(homeRoster[0], 20, 3, 4)], awayBox: [line(awayRoster[2], 9)] });
    const again = teamSeasonStats(s, f.home)[0];
    expect(again).toMatchObject({ g: 2, pts: 50, reb: 8, ast: 6, ppg: 25 });
    expect(teamSeasonStats(s, f.away)).toHaveLength(2);
  });

  it('reads a season saved before stats existed as empty, and a result without boxes changes nothing', () => {
    let s = season();
    delete s.stats;
    const f = roundFixtures(s)[0];
    s = recordResult(s, { fixtureId: f.id, home: f.home, away: f.away, homeScore: 1, awayScore: 0 });
    expect(s.stats).toEqual([]);
    expect(teamSeasonStats(s, f.home)).toEqual([]);
    expect(seasonLeaders(s)).toEqual([]);
  });

  it('survives the key round trip to storage', () => {
    let s = season();
    const f = roundFixtures(s)[0];
    const r = simulateFixture(f, rostersOf(s), { rng: seeded(9) });
    expect(r.homeBox.length).toBeGreaterThan(0);
    expect(r.awayBox.length).toBeGreaterThan(0);
    s = recordResult(s, r);
    const back = hydrate(dehydrate(s));
    expect(back.stats).toEqual(s.stats);
    expect(teamSeasonStats(back, f.home).reduce((t, x) => t + x.pts, 0)).toBe(r.homeScore);
  });
});

describe('leaders', () => {
  it('rank by the per-game average across every team, with the total as the tie-break', () => {
    let s = season();
    const f = roundFixtures(s)[0];
    const hr = rostersOf(s)[f.home], ar = rostersOf(s)[f.away];
    s = recordResult(s, { fixtureId: f.id, home: f.home, away: f.away, homeScore: 50, awayScore: 40,
      homeBox: [line(hr[0], 30), line(hr[1], 12)], awayBox: [line(ar[0], 12), line(ar[1], 25)] });
    const top = seasonLeaders(s, { by: 'ppg', limit: 3 });
    expect(top[0]).toMatchObject({ team: f.home, key: cardKey(hr[0]), ppg: 30 });
    expect(top[1]).toMatchObject({ team: f.away, key: cardKey(ar[1]), ppg: 25 });
    expect(top[2].ppg).toBe(12);
    expect(seasonLeaders(s, { by: 'rpg' })[0].rpg).toBe(1);
  });
});

describe('a played fixture', () => {
  it('maps the human\'s boxes to home and away the same way as the scores', () => {
    const boxA = [{ key: 'a', pts: 1 }], boxB = [{ key: 'b', pts: 2 }];
    const asHome = resultFromPlayed({ fixtureId: 'f', home: 'you', away: 'ai', humanIsHome: true }, 88, 80, boxA, boxB);
    expect(asHome).toMatchObject({ homeScore: 88, awayScore: 80, homeBox: boxA, awayBox: boxB });
    const asAway = resultFromPlayed({ fixtureId: 'f', home: 'ai', away: 'you', humanIsHome: false }, 88, 80, boxA, boxB);
    expect(asAway).toMatchObject({ homeScore: 80, awayScore: 88, homeBox: boxB, awayBox: boxA });
  });
});

describe('a shared season', () => {
  it('folds a reported box and reads a PvP room\'s game into lines', () => {
    let l = newLeague({ id: 'L', kind: 'season', name: 'x', hostUid: 'u1', settings: { size: 4, fee: 0, length: 'short' },
      entrant: entrantFor('u1', { name: 'One', roster: roster(0).map(cardKey) }), joinCode: 'ABC123', now: 1 });
    l = addEntrant(l, entrantFor('u2', { name: 'Two', roster: roster(1).map(cardKey) }), 2);
    const humans = l.entrants.map(e => ({ id: e.id, name: e.name, uid: e.uid, roster: e.roster.map(k => CARDS.find(c => cardKey(c) === k)) }));
    l = startSeason(l, dehydrate(createSeason({ id: l.id, humans, size: 4, length: 'short', rng: seeded(3) })), { now: 3 });
    const f = openFixtures(l).find(x => !isHumanVsHumanFixture(l, x));
    const hydrated = hydrate(l.state);
    const r = simulateFixture({ id: f.id, home: f.home, away: f.away }, rostersOf(hydrated), { rng: seeded(4) });
    l = applyResult(l, { fixtureId: f.id, homeScore: r.homeScore, awayScore: r.awayScore, homeBox: r.homeBox, awayBox: r.awayBox, simulated: true }, { now: 5 }).league;
    expect(teamSeasonStats(l.state, f.home).length).toBeGreaterThan(0);
    expect(teamSeasonStats(l.state, f.home).reduce((t, x) => t + x.pts, 0)).toBe(r.homeScore);

    // A room's finished game: host coached A, host is the home side.
    const game = {
      done: true, hostIs: 'A',
      teamA: { score: 77, roster: roster(0), stats: roster(0).map((c, i) => ({ id: c.id, pts: i === 0 ? 77 : 0, reb: 0, ast: 0, totalMinutes: i < 5 ? 12 : 0 })) },
      teamB: { score: 60, roster: roster(1), stats: roster(1).map((c, i) => ({ id: c.id, pts: i === 0 ? 60 : 0, reb: 0, ast: 0, totalMinutes: i < 5 ? 12 : 0 })) },
    };
    const hh = { id: 'hh', home: 'h:u1', away: 'h:u2' };
    const sc = scoresFromRoom(l, hh, { meta: { hostUid: 'u1', guestUid: 'u2', status: 'active' }, game });
    expect(sc).toMatchObject({ homeScore: 77, awayScore: 60, forfeit: false });
    expect(sc.homeBox).toHaveLength(5);
    expect(sc.homeBox[0]).toMatchObject({ key: cardKey(roster(0)[0]), pts: 77 });
    expect(sc.awayBox[0]).toMatchObject({ key: cardKey(roster(1)[0]), pts: 60 });
    expect(boxLinesFor(game.teamA)).toEqual(boxScoreFor(game, 'A'));
  });
});
