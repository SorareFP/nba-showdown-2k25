// THE LIVE SERIES' EXPECTED NUMBERS from Basketball-Reference (2026-11-12).
import { describe, it, expect } from 'vitest';
import {
  seasonRows, fringeProfile, blendField, expectedTable, actualTable, fetchSeason,
  PRIOR_SEASON_WEIGHTS, PRIOR_SHRINK, CURRENT_K, ACTUAL_BRIDGE, EXPECTED_BRIDGE, SEASON_KINDS,
} from './liveExpected.js';
import { LIVE_ROW_FIELDS } from './generateLive.js';

const adv = (id, name, minutes, over = {}) => ({ playerId: id, name, team: 'DEN', games: Math.round(minutes / 30), minutes, usgPct: 20, tsPct: 0.58, obpm: 0, dbpm: 0, ...over });
const pp = (id, name, minutes, over = {}) => ({
  playerId: id, name, team: 'DEN', pos: 'SF', games: Math.round(minutes / 30), minutes,
  pts100: 20, ast100: 4, orb100: 2, drb100: 6, fga100: 17, fg2a100: 10, fg3a100: 7, fta100: 4,
  fgPct2: 0.53, fgPct3: 0.36, ftPct: 0.78, efg: 0.54, ...over,
});
const sh = (id, minutes, over = {}) => ({ playerId: id, name: id, games: Math.round(minutes / 30), minutes, rimShare: 0.3, rimPct: 0.68, ...over });
const pg = (id, name, team, games, mpg, over = {}) => ({ playerId: id, name, team, pos: 'SF', games, mpg, ...over });

/** A season of one star, one fringe player and one bench player. */
const season = (starOver = {}) => seasonRows({
  advanced: [adv('star', 'Star Player', 2500, { obpm: 6, dbpm: 2, ...starOver }), adv('frin', 'Fringe One', 400, { obpm: -3, dbpm: -1 }), adv('benc', 'Bench Guy', 1200, { obpm: -1, dbpm: 0 })],
  perPoss: [pp('star', 'Star Player', 2500, { pts100: 38, ast100: 8 }), pp('frin', 'Fringe One', 400, { pts100: 14, ast100: 3 }), pp('benc', 'Bench Guy', 1200)],
  shooting: [sh('star', 2500, { rimShare: 0.35, rimPct: 0.72 }), sh('frin', 400), sh('benc', 1200)],
  perGame: [pg('star', 'Star Player', 'DEN', 80, 31), pg('frin', 'Fringe One', 'DEN', 20, 20), pg('benc', 'Bench Guy', 'DEN', 40, 30)],
});

describe('a season of rows', () => {
  it('merges the four tables by id and keeps the last team a traded player was on', () => {
    const rows = seasonRows({
      advanced: [adv('trad', 'Traded Guy', 900), adv('trad', 'Traded Guy', 400)],
      perPoss: [pp('trad', 'Traded Guy', 900)],
      shooting: [sh('trad', 900)],
      perGame: [pg('trad', 'Traded Guy', '2TM', 30, 30), pg('trad', 'Traded Guy', 'CHO', 12, 28), pg('trad', 'Traded Guy', 'BRK', 18, 31)],
    });
    expect(rows.get('trad')).toMatchObject({ name: 'Traded Guy', team: 'BKN', minutes: 900, mpg: 30, pts100: 20 });
  });

  it('reads impact as theirs where the prior file has the player, and through the bridge otherwise', () => {
    const tables = { advanced: [adv('a', 'Has Theirs', 1000, { obpm: 4, dbpm: 1 }), adv('b', 'No Theirs', 1000, { obpm: 4, dbpm: 1 })], perPoss: [], shooting: [], perGame: [] };
    const rows = seasonRows(tables, new Map([['hastheirs', { epmOff: 2.5, epmDef: 3 }]]));
    expect(rows.get('a')).toMatchObject({ epmOff: 2.5, epmDef: 3 });
    expect(rows.get('b').epmOff).toBeCloseTo(ACTUAL_BRIDGE.epmOff[0] + ACTUAL_BRIDGE.epmOff[1] * 4);
    expect(rows.get('b').epmDef).toBeCloseTo(ACTUAL_BRIDGE.epmDef[0] + ACTUAL_BRIDGE.epmDef[1] * 1);
  });

  it('splits the field goals into rim, midrange and three, and backs the midrange percentage out of 2P%', () => {
    const r = seasonRows({ advanced: [adv('a', 'A', 1000)], perPoss: [pp('a', 'A', 1000)], shooting: [sh('a', 1000)], perGame: [] }).get('a');
    expect(r.rim100).toBeCloseTo(17 * 0.3);
    expect(r.mid100).toBeCloseTo(17 - 5.1 - 7);
    expect(r.midPct).toBeCloseTo((0.53 * 10 - 0.68 * 5.1) / 4.9);
  });
});

describe('the fringe player', () => {
  it('is the 100-700 minute players for a rate, and everyone for a percentage', () => {
    const f = fringeProfile(season());
    expect(f.pts100).toBe(14);
    expect(f.fgPct3).toBeGreaterThan(0.35);
  });
});

describe('a blended number', () => {
  const fringe = fringeProfile(season());
  const last = season().get('star');

  it('is the prior alone before the season, pulled a little toward the fringe', () => {
    const v = blendField('epmOff', [last, null, null], null, fringe);
    const w = PRIOR_SEASON_WEIGHTS[0] * 2500;
    expect(v).toBeCloseTo((last.epmOff * w + fringe.epmOff * PRIOR_SHRINK.minutes) / (w + PRIOR_SHRINK.minutes));
  });

  it('weighs the older seasons less', () => {
    const old = { ...last, epmOff: 0 };
    const v = blendField('epmOff', [last, old, null], null, fringe);
    const w1 = 2500;
    const w2 = PRIOR_SEASON_WEIGHTS[1] * 2500;
    expect(v).toBeCloseTo((last.epmOff * w1 + 0 * w2 + fringe.epmOff * PRIOR_SHRINK.minutes) / (w1 + w2 + PRIOR_SHRINK.minutes));
  });

  it('moves toward this season as its minutes come in', () => {
    const prior = blendField('epmOff', [last], null, fringe);
    const hot = { ...last, epmOff: 12, minutes: CURRENT_K.impact };
    expect(blendField('epmOff', [last], hot, fringe)).toBeCloseTo((prior + 12) / 2);
    expect(blendField('epmOff', [last], { ...hot, minutes: 10 }, fringe)).toBeCloseTo(prior, 0);
  });

  it('gives a player with no past the fringe figure, then their own', () => {
    expect(blendField('pts100', [null, null, null], null, fringe)).toBeCloseTo(14);
    const rookie = { pts100: 24, minutes: 4000 };
    expect(blendField('pts100', [null, null, null], rookie, fringe)).toBeGreaterThan(23);
  });

  it('needs more of this season to move defence than offence', () => {
    const hot = { ...last, epmOff: 12, epmDef: 12, minutes: CURRENT_K.impact };
    const off = blendField('epmOff', [last], hot, fringe) - blendField('epmOff', [last], null, fringe);
    const def = blendField('epmDef', [last], hot, fringe) - blendField('epmDef', [last], null, fringe);
    expect(CURRENT_K.impactDef).toBeGreaterThan(CURRENT_K.impact);
    expect(def / (12 - blendField('epmDef', [last], null, fringe))).toBeLessThan(off / (12 - blendField('epmOff', [last], null, fringe)));
  });

  it('weighs a percentage in attempts, so a few threes barely move it', () => {
    const prior = blendField('fgPct3', [last], null, fringe);
    const hotStart = { ...last, fgPct3: 0.6, fg3a100: 7, minutes: 60 };
    expect(blendField('fgPct3', [last], hotStart, fringe) - prior).toBeLessThan(0.01);
  });
});

describe('the expected table', () => {
  const current = seasonRows({
    advanced: [adv('star', 'Star Player', 300, { obpm: 9, dbpm: 3 }), adv('rook', 'Rookie Kid', 200, { obpm: -1 })],
    perPoss: [pp('star', 'Star Player', 300, { pts100: 42 }), pp('rook', 'Rookie Kid', 200)],
    shooting: [sh('star', 300), sh('rook', 200)],
    perGame: [pg('star', 'Star Player', 'LAL', 10, 30), pg('rook', 'Rookie Kid', 'DEN', 8, 25)],
  });
  const table = expectedTable({ current, priors: [season(), new Map(), new Map()] });
  const row = name => table.find(r => r.name === name);

  it('has every field a live card needs, on dunksandthrees\' scale', () => {
    const star = row('Star Player');
    for (const f of LIVE_ROW_FIELDS) expect(Number.isFinite(star[f]), f).toBe(true);
    expect(star.epm).toBeCloseTo(star.epmOff + star.epmDef);
    expect(star.epmOff).toBeCloseTo(EXPECTED_BRIDGE.epmOff[0] + EXPECTED_BRIDGE.epmOff[1] * blendField('epmOff', [season().get('star'), null, null], current.get('star'), fringeProfile(season())));
    expect(star.team).toBe('LAL');
    expect(star.fgaRimPer100).toBeGreaterThan(0);
    expect(star.basis).toEqual({ priorSeasons: 1, currentMinutes: 300 });
  });

  it('rows a rookie from the fringe and their games so far', () => {
    expect(row('Rookie Kid').basis).toEqual({ priorSeasons: 0, currentMinutes: 200 });
    expect(row('Rookie Kid').pts100).toBeGreaterThan(14);
    expect(row('Rookie Kid').pts100).toBeLessThan(20);
  });

  it('rows last season\'s players yet to play, on no team', () => {
    expect(row('Bench Guy')).toMatchObject({ team: null, basis: { priorSeasons: 1, currentMinutes: 0 } });
  });

  it('gives the counts in the actual page\'s shape', () => {
    expect(actualTable(current).find(r => r.name === 'Star Player')).toMatchObject({ games: 10, minutes: 300, mpg: 30, team: 'LAL' });
  });
});

describe('fetching a season', () => {
  it('reads the four tables, this season afresh', async () => {
    const asked = [];
    let waits = 0;
    const out = await fetchSeason(2027, { force: true, between: async () => { waits += 1; }, readCached: () => ['old'], fetchRows: async (s, kind, o) => { asked.push([s, kind, o.force]); return [kind]; } });
    expect(asked).toEqual(SEASON_KINDS.map(k => [2027, k, true]));
    expect(out.perGame).toEqual(['perGame']);
    expect(waits).toBe(4);
  });

  it('takes a finished season from the cache with no wait, and fetches only what is missing', async () => {
    const asked = [];
    let waits = 0;
    const out = await fetchSeason(2026, {
      between: async () => { waits += 1; },
      readCached: (s, kind) => (kind === 'shooting' ? null : [`${kind} cached`]),
      fetchRows: async (s, kind) => { asked.push(kind); return [`${kind} fetched`]; },
    });
    expect(asked).toEqual(['shooting']);
    expect(waits).toBe(1);
    expect(out.advanced).toEqual(['advanced cached']);
    expect(out.shooting).toEqual(['shooting fetched']);
  });

  it('reads the cache alone offline', async () => {
    const out = await fetchSeason(2026, { offline: true, readCached: () => null, fetchRows: async () => { throw new Error('no network'); } });
    expect(out).toEqual(Object.fromEntries(SEASON_KINDS.map(k => [k, []])));
  });
});
