// MATCHUP +/- — a player's points minus the points the man he guarded scored
// on him. The user, 2026-09-10: "can we start calculating and including
// matchup +/- (points conceded against direct matchup while on the floor)
// for each player?"
//
// The engine charges every point a player scores to the defender guarding
// him at that moment (creditAllowed). The strongest check is the identity it
// has to satisfy: across a whole game, one side's player points equal the
// other side's points allowed. A scoring site that forgot to charge anyone
// breaks it.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, getPS, creditAllowed } from './engine.js';
import { CARDS } from './cards.js';
import { cardKey } from './cardSets.js';
import { simulateGame } from './modes/simulate.js';
import { boxScoreFor } from './boxScore.js';
import { createSeason, recordResult, teamSeasonStats, seasonLeaders, roundFixtures } from './modes/season.js';
import { rostersOf } from './modes/seasonCore.js';

const seeded = (s = 5) => () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const sum = (xs, f) => xs.reduce((t, x) => t + (x[f] || 0), 0);

describe('creditAllowed', () => {
  it('charges the defender guarding the scorer, and follows a switched matchup', () => {
    const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
    getTeam(g, 'A').starters = getTeam(g, 'A').roster.slice(0, 5);
    getTeam(g, 'B').starters = getTeam(g, 'B').roster.slice(0, 5);
    const a = getTeam(g, 'A').starters, b = getTeam(g, 'B').starters;
    g.offMatchups = { A: [1, 0, 2, 3, 4], B: [0, 1, 2, 3, 4] };
    creditAllowed(g, 'A', 0, 3);                                // A's slot 0 is guarded by B's slot 1
    expect(getPS(g, 'B', b[1].id).alw).toBe(3);
    expect(getPS(g, 'B', b[0].id).alw).toBe(0);
    creditAllowed(g, 'A', a[2].id, 2);                          // by card id
    expect(getPS(g, 'B', b[2].id).alw).toBe(2);
    creditAllowed(g, 'A', 0, -5);                               // a reversal never goes below zero
    expect(getPS(g, 'B', b[1].id).alw).toBe(0);
    creditAllowed(g, 'B', 3, 4, a[4].id);                       // a named defender is used as given
    expect(getPS(g, 'A', a[4].id).alw).toBe(4);
  });
});

describe('every point is somebody\'s to allow', () => {
  it('across whole simulated games, one side\'s player points equal the other side\'s points allowed', () => {
    for (let i = 0; i < 12; i += 1) {
      const r = simulateGame(CARDS.slice(20 * i, 20 * i + 10), CARDS.slice(20 * i + 10, 20 * i + 20), { rng: seeded(100 + i), keepGame: true });
      const g = r.game;
      expect(g.done).toBe(true);
      for (const [att, def] of [['A', 'B'], ['B', 'A']]) {
        expect(sum(getTeam(g, def).stats, 'alw'), `game ${i}: points ${att} scored`).toBe(sum(getTeam(g, att).stats, 'pts'));
      }
    }
  });

  it('the box score carries it, and a team\'s matchup +/- sums to its player-points margin', () => {
    const r = simulateGame(CARDS.slice(40, 50), CARDS.slice(50, 60), { rng: seeded(7), keepGame: true });
    const g = r.game;
    const boxA = boxScoreFor(g, 'A');
    expect(boxA.every(l => Number.isInteger(l.alw) && l.alw >= 0)).toBe(true);
    const mpmA = boxA.reduce((t, l) => t + l.pts - l.alw, 0);
    // Players who never took the floor have no line, and no points or allowed either.
    expect(mpmA).toBe(sum(g.teamA.stats, 'pts') - sum(g.teamB.stats, 'pts'));
  });
});

describe('the season keeps it', () => {
  function season() {
    return createSeason({ id: 's', humans: [{ id: 'you', name: 'You', roster: CARDS.slice(0, 10) }], size: 4, length: 'short', rng: seeded() });
  }
  const L = (card, pts, alw) => ({ key: cardKey(card), pts, reb: 0, ast: 0, min: 12, tpm: 0, tpa: 0, ...(alw === undefined ? {} : { alw }) });

  it('folds points allowed, and counts matchup +/- only over games whose lines carried it', () => {
    let s = season();
    const f = roundFixtures(s)[0];
    const hr = rostersOf(s)[f.home], ar = rostersOf(s)[f.away];
    // A game from before the stat: no `alw` on its lines.
    s = recordResult(s, { fixtureId: f.id, home: f.home, away: f.away, homeScore: 20, awayScore: 10,
      homeBox: [L(hr[0], 20)], awayBox: [L(ar[0], 10)] });
    let me = teamSeasonStats(s, f.home)[0];
    expect(me.mg).toBe(0);
    expect(me.mpm).toBeNull();
    // A game with it.
    s.fixtures.push({ id: 'x2', round: s.round, home: f.home, away: f.away });
    s = recordResult(s, { fixtureId: 'x2', home: f.home, away: f.away, homeScore: 14, awayScore: 9,
      homeBox: [L(hr[0], 14, 6)], awayBox: [L(ar[0], 9, 14)] });
    me = teamSeasonStats(s, f.home)[0];
    expect(me).toMatchObject({ g: 2, pts: 34, alw: 6, mg: 1, mpts: 14, mpm: 8 });
    expect(teamSeasonStats(s, f.away)[0].mpm).toBe(-5);
    expect(seasonLeaders(s, { by: 'mpm' }).map(r => r.mpm)).toEqual([8, -5]);
  });

  it('adds to a row saved before the field existed without turning it into NaN', () => {
    let s = season();
    const f = roundFixtures(s)[0];
    const hr = rostersOf(s)[f.home];
    s.stats = [{ team: f.home, key: cardKey(hr[0]), g: 3, pts: 30, reb: 0, ast: 0, min: 36, tpm: 0, tpa: 0 }];
    s = recordResult(s, { fixtureId: f.id, home: f.home, away: f.away, homeScore: 5, awayScore: 0,
      homeBox: [L(hr[0], 5, 2)], awayBox: [] });
    const row = s.stats.find(r => r.key === cardKey(hr[0]));
    expect(row).toMatchObject({ g: 4, pts: 35, alw: 2, mg: 1, mpts: 5 });
    expect(teamSeasonStats(s, f.home)[0].mpm).toBe(3);
  });

  it('leaves players without matchup data out of the matchup leaders', () => {
    let s = season();
    const f = roundFixtures(s)[0];
    const hr = rostersOf(s)[f.home], ar = rostersOf(s)[f.away];
    s = recordResult(s, { fixtureId: f.id, home: f.home, away: f.away, homeScore: 30, awayScore: 3,
      homeBox: [L(hr[0], 30)], awayBox: [L(ar[0], 3, 1)] });
    expect(seasonLeaders(s, { by: 'mpm' }).map(r => r.key)).toEqual([cardKey(ar[0])]);
  });
});
