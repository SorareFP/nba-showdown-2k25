// The Live Series' history (2026-10-28): what every Live card's numbers were,
// night by night, for the app's table of how they have moved.
import { describe, it, expect } from 'vitest';
import {
  HISTORY_FIELDS,
  emptyHistory,
  snapshotOf,
  recordNight,
  pruneCharts,
  parseBotCommits,
  fillFromGit,
  serializeHistory,
  updateHistory,
  readHistory,
} from './liveHistory.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const card = (id, salary, over = {}) => ({
  id, salary, speed: 9, power: 16, shotLine: 16, paintBoost: 2, threePtBoost: 1, defBoost: 2,
  chart: [{ lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 }, { lo: 3, hi: 99, pts: 2, reb: 1, ast: 1 }],
  live: { games: { real: 4 } },
  ...over,
});

describe('a night', () => {
  it('keeps each card\'s numbers in the field order and its chart packed', () => {
    expect(HISTORY_FIELDS).toEqual(['salary', 'speed', 'power', 'shotLine', 'paintBoost', 'threePtBoost', 'defBoost', 'games']);
    expect(snapshotOf(card('A', 910))).toEqual([910, 9, 16, 16, 2, 1, 2, 4]);
    const h = recordNight(emptyHistory(), { date: '2026-10-22', cards: [card('A', 910)] });
    expect(h.nights).toEqual(['2026-10-22']);
    expect(h.players.A.rows).toEqual([[910, 9, 16, 16, 2, 1, 2, 4]]);
    expect(h.players.A.charts).toEqual({ 0: [[1, 2, 0, 0, 0], [3, 99, 2, 1, 1]] });
  });

  it('replaces a night recorded twice on one date (a second run that day)', () => {
    let h = recordNight(emptyHistory(), { date: '2026-10-22', cards: [card('A', 910)] });
    h = recordNight(h, { date: '2026-10-22', cards: [card('A', 950)] });
    expect(h.nights).toEqual(['2026-10-22']);
    expect(h.players.A.rows).toEqual([[950, 9, 16, 16, 2, 1, 2, 4]]);
  });

  it('leaves a gap for a card missing that night, and nothing before a card arrives', () => {
    let h = recordNight(emptyHistory(), { date: '2026-10-22', cards: [card('A', 910)] });
    h = recordNight(h, { date: '2026-10-23', cards: [card('B', 500)] });
    expect(h.players.A.rows).toEqual([[910, 9, 16, 16, 2, 1, 2, 4], null]);
    expect(h.players.B.rows).toEqual([null, [500, 9, 16, 16, 2, 1, 2, 4]]);
    expect(Object.keys(h.players.B.charts)).toEqual(['1']);
  });

  it('slots an older night in where it belongs, rows and charts with it', () => {
    let h = recordNight(emptyHistory(), { date: '2026-10-22', cards: [card('A', 900)] });
    h = recordNight(h, { date: '2026-10-24', cards: [card('A', 920)] });
    h = recordNight(h, { date: '2026-10-23', cards: [card('A', 910, { chart: [{ lo: 1, hi: 99, pts: 1, reb: 0, ast: 0 }] })] });
    expect(h.nights).toEqual(['2026-10-22', '2026-10-23', '2026-10-24']);
    expect(h.players.A.rows.map(r => r[0])).toEqual([900, 910, 920]);
    expect(h.players.A.charts[1]).toEqual([[1, 99, 1, 0, 0]]);
    expect(h.players.A.charts[2]).toEqual([[1, 2, 0, 0, 0], [3, 99, 2, 1, 1]]);
  });
});

describe('the charts kept', () => {
  it('are the 21-day window\'s and each card\'s first', () => {
    let h = emptyHistory();
    const dates = ['2026-10-01', '2026-10-02', '2026-10-10', '2026-10-20', '2026-10-30'];
    for (const date of dates) h = recordNight(h, { date, cards: [card('A', 900)] });
    h = recordNight(h, { date: '2026-11-05', cards: [card('A', 900), card('B', 500)] });
    const kept = pruneCharts(h);
    // 11-05 less 21 days is 10-15: the window opens at 10-10 (index 2).
    expect(Object.keys(kept.players.A.charts).map(Number)).toEqual([0, 2, 3, 4, 5]);
    expect(Object.keys(kept.players.B.charts).map(Number)).toEqual([5]);
    // The numbers are all kept.
    expect(kept.players.A.rows.length).toBe(6);
  });
});

describe('filling from git', () => {
  const log = [
    'c3\tchore(live): the Live Series as of 2026-10-24',
    'c2\tfeat(live): something else',
    'c1\tchore(live): the Live Series as of 2026-10-22',
  ].join('\n');

  it('reads the bot\'s nightly commits, oldest first', () => {
    expect(parseBotCommits(log)).toEqual([{ sha: 'c1', date: '2026-10-22' }, { sha: 'c3', date: '2026-10-24' }]);
  });

  it('records the nights the history lacks, skipping a mirror build and nights it has', () => {
    const bodies = {
      c1: { live: { mode: 'season', asOf: '2026-10-22T14:00:00Z' }, cards: [card('A', 900)] },
      c3: { live: { mode: 'season', asOf: '2026-10-24T14:00:00Z' }, cards: [card('A', 950)] },
      c0: { live: { mode: 'mirror', asOf: '2026-10-21T14:00:00Z' }, cards: [card('A', 1)] },
    };
    const have = recordNight(emptyHistory(), { date: '2026-10-22', cards: [card('A', 905)] });
    const { history, added } = fillFromGit(have, {
      commits: [{ sha: 'c0', date: '2026-10-21' }, { sha: 'c1', date: '2026-10-22' }, { sha: 'c3', date: '2026-10-24' }],
      show: sha => bodies[sha],
    });
    expect(added).toEqual(['2026-10-24']);
    expect(history.nights).toEqual(['2026-10-22', '2026-10-24']);
    expect(history.players.A.rows.map(r => r[0])).toEqual([905, 950]);
  });
});

describe('the file', () => {
  it('writes a card to a line and reads back the same', () => {
    let h = recordNight(emptyHistory(), { date: '2026-10-22', cards: [card('A', 900), card('B', 500)] });
    h = recordNight(h, { date: '2026-10-23', cards: [card('A', 910)] });
    const text = serializeHistory(h);
    expect(JSON.parse(text)).toEqual(h);
    expect(text.split('\n').filter(l => l.startsWith('"A":') || l.startsWith('"B":')).length).toBe(2);
  });
});

describe("tonight's update", () => {
  it('records tonight even where git cannot be read', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-history-'));
    const file = path.join(dir, 'live-history.json');
    const lines = [];
    updateHistory({ file, date: '2026-10-29', cards: [card('A', 900)], cwd: dir, log: l => lines.push(l) });
    const h = readHistory(file);
    expect(h.nights).toEqual(['2026-10-29']);
    expect(h.players.A.rows[0][0]).toBe(900);
    expect(lines.join(' ')).toMatch(/could not read git/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
