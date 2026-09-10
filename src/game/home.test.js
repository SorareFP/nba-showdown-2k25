// The home page's helpers (home.js): the news order, the closest collections,
// where you stand in each season, and your lifetime leaders.
import { describe, it, expect } from 'vitest';
import { NEWS, STARTER_NEWS, newsFor, packForGoal, closestGoals, seasonGlance, seasonsInProgress, careerLeaders, careerTotals } from './home.js';
import { GOALS_BY_ID } from './collections.js';
import { CARDS } from './cards.js';
import { cardKey, CARD_SETS } from './cardSets.js';
import { createSeason, recordResult, roundFixtures, PHASE } from './modes/season.js';

const seeded = (s = 5) => () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };

describe('news', () => {
  it('is newest first, and the unopened starter pack leads until it is opened', () => {
    const opened = newsFor({ starterOpened: true });
    expect(opened.map(n => n.date)).toEqual([...opened.map(n => n.date)].sort().reverse());
    expect(opened).not.toContain(STARTER_NEWS);
    expect(newsFor({ starterOpened: false })[0]).toBe(STARTER_NEWS);
  });

  it('carries Unethical Hoops, and every button goes somewhere the app knows', () => {
    expect(NEWS.some(n => n.id === 'unethical-hoops')).toBe(true);
    const places = ['play', 'season', 'shop', 'goals', 'collection', 'howtoplay', 'builder'];
    for (const n of [...NEWS, STARTER_NEWS]) {
      if (n.to) expect(places, n.id).toContain(n.to);
      if (n.to) expect(n.cta, n.id).toBeTruthy();
    }
  });
});

describe('closest collections', () => {
  const teamGoal = GOALS_BY_ID['nba-team-BOS'];

  it('names the pack that feeds a goal, and none for a set no pack sells', () => {
    expect(packForGoal(teamGoal).id).toBe('nba_booster');
    expect(packForGoal(GOALS_BY_ID['set-super-season'])).toMatchObject({ id: 'super_season', price: 300 });
    expect(packForGoal(GOALS_BY_ID['set-dissonance'])).toBeNull();
    expect(packForGoal(GOALS_BY_ID['wnba-set']).id).toBe('wnba_booster');
  });

  it('puts the goal with the fewest missing first, and a started goal ahead of an untouched one', () => {
    const owned = new Set(teamGoal.requires.slice(0, teamGoal.requires.length - 1));   // one short
    const rows = closestGoals(owned, { limit: 3 });
    expect(rows[0].id).toBe('nba-team-BOS');
    expect(rows[0].missingCount).toBe(1);
    expect(rows.every(r => !r.complete)).toBe(true);
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i - 1].owned > 0 && rows[i].owned > 0) expect(rows[i].missingCount).toBeGreaterThanOrEqual(rows[i - 1].missingCount);
    }
  });

  it('shows a complete goal as ready to claim until it is claimed', () => {
    const owned = new Set(teamGoal.requires);
    expect(closestGoals(owned)[0]).toMatchObject({ id: 'nba-team-BOS', ready: true });
    expect(closestGoals(owned, { claimed: new Set(['nba-team-BOS']) }).some(r => r.id === 'nba-team-BOS')).toBe(false);
  });

  it('still has something to show for an empty collection', () => {
    expect(closestGoals(new Set(), { limit: 2 })).toHaveLength(2);
  });
});

describe('seasons in progress', () => {
  function season() {
    const rng = seeded(9);
    return createSeason({ id: 's1', humans: [{ id: 'you', name: 'My Team', roster: CARDS.slice(0, 10) }], size: 4, length: 'short', rng });
  }

  it('gives the record, the place, and the next opponent home or away', () => {
    let s = season();
    const f = roundFixtures(s).find(x => x.home === 'you' || x.away === 'you');
    const iWin = f.home === 'you' ? { homeScore: 30, awayScore: 20 } : { homeScore: 20, awayScore: 30 };
    s = recordResult(s, { fixtureId: f.id, home: f.home, away: f.away, ...iWin });
    const g = seasonGlance(s, 'you');
    expect(g.record).toBe('1–0');
    expect(g.rank).toBe(1);
    expect(g.place).toBe('1st of 4');
    expect(g.gb).toBe(0);
    expect(g.next).toBeTruthy();
    expect(g.next.opponent).not.toBe('My Team');
    expect(g.stage).toMatch(/^Round \d+ of \d+$/);
  });

  it('counts games behind the leader', () => {
    let s = season();
    const f = roundFixtures(s).find(x => x.home === 'you' || x.away === 'you');
    const iLose = f.home === 'you' ? { homeScore: 10, awayScore: 20 } : { homeScore: 20, awayScore: 10 };
    s = recordResult(s, { fixtureId: f.id, home: f.home, away: f.away, ...iLose });
    expect(seasonGlance(s, 'you').gb).toBe(1);
  });

  it('lists solo seasons not yet done and live shared seasons, and skips the rest', () => {
    const s = season();
    const finished = { ...season(), id: 's2', phase: PHASE.done };
    const shared = { ...season(), id: 'L1', teams: season().teams.map(t => (t.human ? { ...t, id: 'h:u1' } : t)) };
    shared.fixtures = shared.fixtures.map(f => ({ ...f, home: f.home === 'you' ? 'h:u1' : f.home, away: f.away === 'you' ? 'h:u1' : f.away }));
    const rows = seasonsInProgress({
      solo: [s, finished],
      shared: [
        { league: { id: 'L1', kind: 'season', status: 'live', name: 'Our League' }, season: shared },
        { league: { id: 'L2', kind: 'season', status: 'lobby', name: 'Waiting' }, season: null },
      ],
      uid: 'u1',
    });
    expect(rows.map(r => [r.kind, r.id])).toEqual([['solo', 's1'], ['league', 'L1']]);
    expect(rows[0].title).toBe('Short season · 4 teams');
    expect(rows[1]).toMatchObject({ title: 'Our League', team: 'My Team', record: '0–0' });
    expect(rows[1].next).toBeTruthy();
  });
});

describe('career leaders', () => {
  const a = CARD_SETS['2026-27'][0], b = CARD_SETS['2026-27'][1];

  it('sorts by lifetime points, gives per-game lines, and skips cards that left the pool', () => {
    const stats = {
      [cardKey(a)]: { games: 4, wins: 3, pts: 40, reb: 8, ast: 12 },
      [cardKey(b)]: { games: 2, wins: 0, pts: 50, reb: 2, ast: 2 },
      Gone_Player: { games: 9, pts: 900 },
      [cardKey(CARD_SETS['2026-27'][2])]: { games: 0, pts: 0 },
    };
    const rows = careerLeaders(stats);
    expect(rows.map(r => r.key)).toEqual([cardKey(b), cardKey(a)]);
    expect(rows[1]).toMatchObject({ games: 4, wins: 3, ppg: 10, rpg: 2, apg: 3 });
    expect(careerTotals(stats)).toEqual({ cards: 3, pts: 990 });
  });

  it('is empty for an account that has not played', () => {
    expect(careerLeaders({})).toEqual([]);
    expect(careerLeaders(undefined)).toEqual([]);
  });
});
