// The Live Series table (2026-10-28; the user: "a live series dashboard that
// shows how players' card details have changed over time … 'latest changes,'
// 7-21 day windows, since start of season").
import { describe, it, expect } from 'vitest';
import {
  LIVE_WINDOWS,
  anchorIndex,
  moveRows,
  chartChanges,
  sortMoves,
  nextSort,
  filterMoves,
} from './liveMoves.js';

const NIGHTS = ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-30', '2026-11-12', '2026-11-13'];

describe('the windows', () => {
  it('are the latest night, 7 days, 21 days and the season', () => {
    expect(LIVE_WINDOWS.map(w => w.label)).toEqual(['Latest night', '7 days', '21 days', 'Season']);
  });

  it('start the latest night at the night before, and the season at the first', () => {
    expect(anchorIndex(NIGHTS, 'latest')).toBe(4);
    expect(anchorIndex(NIGHTS, 'season')).toBe(0);
  });

  it('start a day window at the last night at least that many days old', () => {
    // 11-13 less 7 days is 11-06: the last night on or before it is 10-30.
    expect(anchorIndex(NIGHTS, '7')).toBe(3);
    // 11-13 less 21 days is 10-23.
    expect(anchorIndex(NIGHTS, '21')).toBe(1);
  });

  it('start a window longer than the history at the first night', () => {
    expect(anchorIndex(['2026-10-22', '2026-10-27'], '21')).toBe(0);
    expect(anchorIndex(['2026-10-22'], 'latest')).toBe(0);
    expect(anchorIndex([], '7')).toBe(0);
  });
});

// [salary, speed, power, shotLine, paintBoost, threePtBoost, defBoost, games]
const card = (over = {}) => ({
  id: 'A_One', name: 'A One', team: 'MIA', pos: 'C', set: 'live',
  salary: 910, speed: 9, power: 16, shotLine: 16, paintBoost: 2, threePtBoost: 1, defBoost: 2,
  chart: [{ lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 }, { lo: 3, hi: 9, pts: 0, reb: 1, ast: 1 }, { lo: 10, hi: 99, pts: 2, reb: 1, ast: 1 }],
  live: { games: { real: 4 } },
  ...over,
});
const history = {
  nights: ['2026-10-22', '2026-10-23', '2026-10-24'],
  fields: ['salary', 'speed', 'power', 'shotLine', 'paintBoost', 'threePtBoost', 'defBoost', 'games'],
  players: {
    A_One: {
      rows: [[1430, 10, 16, 16, 3, 2, 3, 0], [1290, 10, 16, 16, 3, 2, 3, 0], [910, 9, 16, 16, 2, 1, 2, 4]],
      charts: { 0: [[1, 2, 0, 0, 0], [3, 8, 0, 1, 0], [9, 99, 3, 2, 1]] },
    },
    B_Two: { rows: [null, null, [500, 8, 6, 15, -1, 1, 0, 3]], charts: { 2: [[1, 99, 1, 0, 0]] } },
  },
};

describe('a row', () => {
  it('holds today\'s numbers, the window\'s first night, the move and the salary line', () => {
    const [row] = moveRows(history, [card()], 'season');
    expect(row.key).toBe('live:A_One');
    expect(row.now).toMatchObject({ salary: 910, speed: 9, defBoost: 2, games: 4 });
    expect(row.then).toMatchObject({ salary: 1430, speed: 10, defBoost: 3 });
    expect(row.delta).toMatchObject({ salary: -520, speed: -1, power: 0, defBoost: -1 });
    expect(row.line).toEqual([1430, 1290, 910]);
    expect(row.rarityThen).toBe('legendary');
    expect(row.rarityNow).toBe('rare');
    expect(row.then.chart[1]).toEqual({ lo: 3, hi: 8, pts: 0, reb: 1, ast: 0 });
    expect(row.since).toBe('2026-10-22');
  });

  it('compares a player who joined after the window opened from their first night', () => {
    const [row] = moveRows(history, [card({ id: 'B_Two', salary: 500, speed: 8, power: 6, shotLine: 15, paintBoost: -1, threePtBoost: 1, defBoost: 0 })], 'season');
    expect(row.since).toBe('2026-10-24');
    expect(row.delta.salary).toBe(0);
    expect(row.line).toEqual([500]);
  });

  it('shows no move for a card the history has never seen', () => {
    const [row] = moveRows(history, [card({ id: 'C_New' })], '7');
    expect(row.then).toMatchObject({ salary: 910, speed: 9 });
    expect(row.delta.salary).toBe(0);
    expect(row.line).toEqual([910]);
    expect(row.since).toBeNull();
  });

  it('reads with no history at all', () => {
    const [row] = moveRows(null, [card()], 'latest');
    expect(row.delta.salary).toBe(0);
  });

  it('falls back to today\'s chart when the window\'s first night kept none', () => {
    const [row] = moveRows(history, [card()], 'latest');
    expect(row.then.salary).toBe(1290);
    expect(row.then.chart).toEqual(card().chart);
  });
});

describe('the chart change', () => {
  const then = [{ lo: 3, hi: 8, pts: 0, reb: 1, ast: 0 }, { lo: 9, hi: 99, pts: 3, reb: 2, ast: 1 }];
  const now = [{ lo: 3, hi: 9, pts: 0, reb: 1, ast: 1 }, { lo: 10, hi: 15, pts: 2, reb: 1, ast: 0 }, { lo: 16, hi: 99, pts: 3, reb: 2, ast: 1 }];

  it('compares roll for roll, since the rows move', () => {
    const out = chartChanges(then, now);
    // Roll 3 paid 0/1/0 and now pays 0/1/1.
    expect(out[0].cells).toEqual({ pts: null, reb: null, ast: 'up' });
    // Roll 10 paid 3/2/1 (the 9+ row) and now pays 2/1/0.
    expect(out[1].cells).toEqual({ pts: 'down', reb: 'down', ast: 'down' });
    expect(out[2].cells).toEqual({ pts: null, reb: null, ast: null });
  });

  it('marks a row whose range is new', () => {
    expect(chartChanges(then, now).map(r => r.moved)).toEqual([true, true, true]);
    expect(chartChanges(now, now).map(r => r.moved)).toEqual([false, false, false]);
  });
});

describe('the sort', () => {
  const row = (id, salary, dSalary, dShot, name = id) => ({
    id, card: { name }, now: { salary }, delta: { salary: dSalary, shotLine: dShot }, rarityNow: 'rare',
  });
  const rows = [row('a', 900, -50, 0), row('b', 1200, 300, -2), row('c', 600, -400, 1), row('d', 500, 0, 0)];

  it('opens on the biggest salary move either way', () => {
    expect(sortMoves(rows, { key: 'salary', dir: 'abs' }).map(r => r.id)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('sorts a column by its gain, then by its drop', () => {
    expect(sortMoves(rows, { key: 'salary', dir: 'up' }).map(r => r.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(sortMoves(rows, { key: 'salary', dir: 'down' }).map(r => r.id)).toEqual(['c', 'a', 'd', 'b']);
  });

  it('counts a lower shot line as the gain', () => {
    expect(sortMoves(rows, { key: 'shotLine', dir: 'up' })[0].id).toBe('b');
  });

  it('sorts the player column by name', () => {
    const named = [row('x', 1, 0, 0, 'Zed'), row('y', 1, 0, 0, 'Abe')];
    expect(sortMoves(named, { key: 'name', dir: 'up' }).map(r => r.id)).toEqual(['y', 'x']);
  });

  it('flips a column on a second click, and starts a new one at its gain', () => {
    expect(nextSort({ key: 'salary', dir: 'abs' }, 'salary')).toEqual({ key: 'salary', dir: 'up' });
    expect(nextSort({ key: 'salary', dir: 'up' }, 'salary')).toEqual({ key: 'salary', dir: 'down' });
    expect(nextSort({ key: 'salary', dir: 'down' }, 'salary')).toEqual({ key: 'salary', dir: 'up' });
    expect(nextSort({ key: 'salary', dir: 'down' }, 'speed')).toEqual({ key: 'speed', dir: 'up' });
  });
});

describe('the filter', () => {
  const rows = [
    { key: 'live:A_One', card: { name: 'Bam Adebayo', team: 'MIA' } },
    { key: 'live:B_Two', card: { name: 'Luguentz Dort', team: 'ATL' } },
  ];
  it('finds a player by name or team, accents and case aside', () => {
    expect(filterMoves(rows, { query: 'ADEB' }).length).toBe(1);
    expect(filterMoves(rows, { query: 'atl' })[0].key).toBe('live:B_Two');
  });
  it('keeps only your cards when asked', () => {
    expect(filterMoves(rows, { onlyMine: true, owned: new Set(['live:B_Two']) }).map(r => r.key)).toEqual(['live:B_Two']);
  });
});
