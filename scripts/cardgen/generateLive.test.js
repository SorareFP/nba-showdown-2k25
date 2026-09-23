// The Live Series generator (2026-09-23): in mirror mode every base card
// again, the same id and numbers, in the live set with the LIVE pill and a
// stamp saying what it is; in season mode the same cards re-allocated from
// dunksandthrees' expected page and this season's game logs.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  EW_PER_GAME_MODEL,
  FULL_SEASON_GAMES,
  LIVE_SEASON,
  MODES,
  OUTPUT_FILE,
  BASE_FILE,
  buildSeason,
  ewinsPerGameFor,
  isLiveRow,
  liveActualRow,
  liveCard,
  main,
} from './generateLive.js';
import { liveRowsFromLog, WINDOW_GAMES } from './realGames.js';
import { LIVE_SET, CURRENT_SET, setBadge, setTreatment } from '../../src/cards/sets.js';
import { LIVE_BADGE } from '../../src/cards/badges.js';

describe('a live card', () => {
  it('is its base card with the set, the pill and a stamp changed, and nothing else', () => {
    const base = { id: 'X', name: 'X', team: 'BOS', salary: 900, speed: 12, power: 10, badges: ['super-season'] };
    const live = liveCard(base, { mode: 'mirror', asOf: '2026-09-23T09:00:00.000Z', source: 'cards-2026-27.json' });
    expect(live).toMatchObject({ ...base, set: LIVE_SET, badges: ['super-season', LIVE_BADGE] });
    expect(live.live).toEqual({ mode: 'mirror', asOf: '2026-09-23T09:00:00.000Z', source: 'cards-2026-27.json' });
    // Once is enough for the pill.
    expect(liveCard({ ...base, badges: [LIVE_BADGE] }, { mode: 'mirror', asOf: 'x', source: 'y' }).badges).toEqual([LIVE_BADGE]);
  });

  it('wears the blue trim and the LIVE pill by its set', () => {
    expect(setTreatment(LIVE_SET)).toBe('blue-accent');
    expect(setBadge(LIVE_SET)).toBe(LIVE_BADGE);
  });

  it('is played in the season the base set is named for', () => {
    expect(LIVE_SEASON).toBe(Number(`20${CURRENT_SET.slice(-2)}`));
    expect(LIVE_SEASON).toBe(2027);
  });
});

// A Jokić-shaped expected row (the /epm page through toSeasonRate).
const expectedRow = (over = {}) => ({
  name: 'Test Live', personId: 1, team: 'LAL', position: 'C', age: 31,
  epm: 7.34, epmOff: 6.39, epmDef: 0.94, minutesPer48: 34.5, teamPossPer48: 99.1, usage: 0.286, startedShare: 0.99,
  pts100: 35.5, ast100: 12.8, orb100: 3.45, drb100: 13.7, tov100: 4.8, stl100: 1.95, blk100: 1.07,
  tsPct: 0.648, efg: 0.6, fga2Per100: 17.3, fga3Per100: 6.1, ftaPer100: 9.0, fgaRimPer100: 7.32, fgaMidPer100: 9.83,
  fgPct2: 0.619, fgPct3: 0.365, fgPctRim: 0.702, fgPctMid: 0.548, ftPct: 0.819,
  ...over,
});

describe('the live row every layer but the chart reads', () => {
  it('models EW per game from EPM and minutes to the precision the season shows', () => {
    // Jokić 2025-26: EPM 8.11 at 34.85 minutes was 0.2657 EW a game.
    expect(ewinsPerGameFor({ epm: 8.113, mpg: 34.846 })).toBeCloseTo(0.2657, 2);
    expect(ewinsPerGameFor({ epm: null, mpg: 30 })).toBeNull();
    expect(ewinsPerGameFor({ epm: 2, mpg: undefined })).toBeNull();
    expect(Object.keys(EW_PER_GAME_MODEL)).toEqual(['epmMinutes', 'minutes', 'intercept']);
  });

  it('takes every rate from the expected page and every count from the actual one', () => {
    const row = liveActualRow(expectedRow(), { games: 3, minutes: 101, starts: 3, playoffGames: 0, epm: 1.0, tsPct: 0.5 });
    expect(row).toMatchObject({
      name: 'Test Live', team: 'LAL', games: 3, minutesPlayed: 101, starts: 3, mpg: 34.5,
      // The EXPECTED impact triple, not the actual page's.
      epm: 7.34, epmOff: 6.39, epmDef: 0.94,
      // The expected shooting splits, at per-75 attempt rates from the per-100 ones.
      tsPct: 0.648, fgPctRim: 0.702, fgPct3: 0.365, fga3Per75: 6.1 * 0.75, fgaRimPer75: 7.32 * 0.75,
      liveBasis: 'expected',
    });
    // A full season's volume behind the shrinkage, whatever October says.
    expect(row.minutes).toBe(34.5 * FULL_SEASON_GAMES);
    expect(row.ewinsPerGame).toBeCloseTo(ewinsPerGameFor({ epm: 7.34, mpg: 34.5 }), 10);
    expect(row.ewins).toBeCloseTo(row.ewinsPerGame * 3, 10);
    // No actual row at all — a player yet to appear — still composes.
    expect(liveActualRow(expectedRow()).games).toBe(0);
  });

  it('needs the impact triple, the chart anchor and minutes before a card is built', () => {
    expect(isLiveRow(expectedRow())).toBe(true);
    expect(isLiveRow(expectedRow({ epm: null }))).toBe(false);
    expect(isLiveRow(expectedRow({ pts100: undefined }))).toBe(false);
    expect(isLiveRow(null)).toBe(false);
  });
});

describe('the live window', () => {
  const log = {
    reg: [
      { date: '2026-10-22', opp: 'BOS', minutes: '34:10', pts: 27, reb: 12, ast: 9 },
      { date: '2026-10-24', opp: 'PHO', minutes: '31:00', pts: 18, reb: 10, ast: 11 },
      { date: '2026-10-26', opp: 'BRK', minutes: '3:00', pts: 2, reb: 1, ast: 0 },
    ],
    post: [],
  };

  it('takes the games up to the date, and has no floor', () => {
    expect(liveRowsFromLog(log, 2027, new Map(), { asOf: '2026-10-21' })).toBeNull();
    expect(liveRowsFromLog(log, 2027, new Map(), { asOf: '2026-10-22' }).length).toBe(1);
    // The three-minute cameo is under MPG_FLOOR and never counts.
    expect(liveRowsFromLog(log, 2027, new Map(), { asOf: '2026-10-26' }).length).toBe(2);
    expect(liveRowsFromLog(null, 2027, new Map(), {})).toBeNull();
  });

  it('caps at the last 82 once a season runs past it', () => {
    const long = { reg: Array.from({ length: 90 }, (_, i) => ({ date: `2026-${String(10 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, opp: 'BOS', minutes: '30:00', pts: 10, reb: 5, ast: 3 })), post: [] };
    expect(liveRowsFromLog(long, 2027, new Map(), {}).length).toBe(WINDOW_GAMES);
  });
});

describe('a season build', () => {
  const chart = [
    { lo: 1, hi: 8, pts: 0, reb: 0, ast: 0 }, { lo: 9, hi: 13, pts: 2, reb: 1, ast: 1 },
    { lo: 14, hi: 18, pts: 3, reb: 2, ast: 1 }, { lo: 19, hi: 99, pts: 4, reb: 2, ast: 2 },
  ];
  const baseCard = (id, name, over = {}) => ({
    id, name, team: 'DEN', pos: 'C', speed: 14, power: 14, shotLine: 12, paintBoost: 2, threePtBoost: 0, defBoost: 1,
    salary: 1000, chart, provisional: false, ...over,
  });
  const base = { cards: [baseCard('Test_Live', 'Test Live', { badges: ['super-season'] }), baseCard('Test_Mirror', 'Test Mirror')] };
  const log = {
    reg: [
      { date: '2026-10-22', opp: 'BOS', minutes: '34:10', pts: 27, reb: 12, ast: 9 },
      { date: '2026-10-24', opp: 'PHO', minutes: '31:00', pts: 18, reb: 10, ast: 11 },
      { date: '2026-10-26', opp: 'MIA', minutes: '33:00', pts: 30, reb: 14, ast: 8 },
    ],
    post: [],
  };
  const inputs = {
    season: 2027,
    expected: [expectedRow()],
    actual: [{ name: 'Test Live', personId: 1, games: 3, minutes: 98, mpg: 32.7, starts: 3, playoffGames: 0 }],
    defense: new Map(),
    teamEpm: 'cached',
    logs: new Map([['Test_Live', { playerId: 'testli01', known: 3, have: 3 }]]),
    logStatus: { current: 1, behind: 0, fetched: 0, failed: [], unmatched: ['Test Mirror'] },
  };
  const asOf = '2026-10-25T09:00:00.000Z';
  const body = buildSeason({
    base, inputs, asOf, log: () => {},
    loadRows: (playerId, season, defense, opts) => (playerId === 'testli01' ? liveRowsFromLog(log, season, defense, opts) : null),
  });
  const [live, mirror] = body.cards;

  it('keeps the base order and every card, and says what it built', () => {
    expect(body.set).toBe(LIVE_SET);
    expect(body.cards.map(c => c.id)).toEqual(['Test_Live', 'Test_Mirror']);
    expect(body.live).toMatchObject({ mode: 'season', season: 2027, asOf, built: 1, mirrored: 1, withRealGames: 1, fullWindows: 0 });
    expect(body.live.logs).toEqual(inputs.logStatus);
  });

  it('rebuilds a carded player from the expected page, his real games up to the date, and the team he is on now', () => {
    expect(live.set).toBe(LIVE_SET);
    expect(live.badges).toEqual(['super-season', LIVE_BADGE]);
    // Two of the three logged games fall on or before the as-of date.
    expect(live.live).toMatchObject({ mode: 'season', season: 2027, games: { real: 2, synthetic: WINDOW_GAMES - 2 } });
    expect(live.live.status).toBe(`2 real games, ${WINDOW_GAMES - 2} from the expected rates`);
    expect(live.provisional).toBe(true);
    expect(live.team).toBe('LAL');
    for (const f of ['speed', 'power', 'shotLine', 'paintBoost', 'threePtBoost', 'defBoost', 'salary']) {
      expect(Number.isFinite(live[f]), f).toBe(true);
    }
    expect(live.speed + live.power).toBeGreaterThanOrEqual(2);
    expect(live.defBoost).toBe(Math.round(0.94));
    expect(live.chart[live.chart.length - 1].hi).toBe(99);
    expect(live.chart.some(t => t.pts > 0)).toBe(true);
  });

  it('mirrors a base card whose player is not on the table, and says so', () => {
    expect(mirror.set).toBe(LIVE_SET);
    expect(mirror.badges).toEqual([LIVE_BADGE]);
    expect(mirror.live).toMatchObject({ mode: 'season', status: "not on this season's table", games: { real: 0, synthetic: 0 } });
    for (const f of ['speed', 'power', 'shotLine', 'paintBoost', 'threePtBoost', 'defBoost', 'chart', 'team']) {
      expect(mirror[f], f).toEqual(base.cards[1][f]);
    }
    // Repriced against the live field, so the number is his but not necessarily the base one.
    expect(Number.isFinite(mirror.salary)).toBe(true);
    // And the base record was not written on.
    expect(base.cards[1].salary).toBe(1000);
    expect(base.cards[1].set).toBeUndefined();
  });
});

describe('the committed file', () => {
  const live = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  const base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));

  it('mirrors the base set card for card until the season starts', () => {
    expect(live.set).toBe(LIVE_SET);
    expect(live.live.mode).toBe('mirror');
    expect(live.cards.map(c => c.id)).toEqual(base.cards.map(c => c.id));
    for (const [i, c] of live.cards.entries()) {
      const b = base.cards[i];
      expect([c.salary, c.speed, c.power, c.shotLine, c.team], c.id).toEqual([b.salary, b.speed, b.power, b.shotLine, b.team]);
      expect(c.badges).toContain(LIVE_BADGE);
      expect(c.live.source).toBe(`cards-${CURRENT_SET}.json`);
    }
  });

  it('names its modes and refuses any other', async () => {
    expect(MODES).toEqual(['mirror', 'season']);
    await expect(main({ mode: 'nope', log: () => {} })).rejects.toThrow(/no such mode/);
  });
});
