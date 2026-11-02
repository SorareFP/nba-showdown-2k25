// YOUR PLAYERS' ACT (2026-11-02; the user, of the act-win screen: "showing stats
// of your players on that act would be good"). Each game's box score folds into
// the run, act by act.
import { describe, it, expect } from 'vitest';
import { newRun, chooseCamp, chooseStop, recordResult, resultFromGame, bossTeam, addGameStats, actStats, runStats } from './run.js';
import { CARDS } from '../cards.js';
import { cardKey } from '../cardSets.js';

const FIVE = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).slice(100, 105);
const KEYS = FIVE.map(cardKey);
const fresh = () => newRun({ id: 'r1', seed: 42, rung: 'prince', rosterKeys: KEYS, now: 1 });
const camped = () => ({ ...chooseCamp(fresh(), { playbook: 'speed', boon: fresh().camp.boons[0] }), dropOdds: { player: -1, perk: -1 } });
const line = (key, pts, reb = 0, ast = 0, min = 12) => ({ key, pts, reb, ast, min });

describe('the act totals', () => {
  it('add each game to its act, a game a player sat out not counting', () => {
    let stats = addGameStats(undefined, 1, [line('a', 10, 2, 1), line('b', 4)]);
    stats = addGameStats(stats, 1, [line('a', 6, 1, 3, 10)]);
    stats = addGameStats(stats, 2, [line('b', 8)]);
    expect(stats[1].a).toEqual({ g: 2, min: 22, pts: 16, reb: 3, ast: 4 });
    expect(stats[1].b).toEqual({ g: 1, min: 12, pts: 4, reb: 0, ast: 0 });
    expect(stats[2].b.pts).toBe(8);
  });

  it('leave the run alone when a game carries no box score', () => {
    expect(addGameStats(undefined, 1, [])).toBeUndefined();
    const stats = addGameStats(undefined, 1, [line('a', 2)]);
    expect(addGameStats(stats, 1, undefined)).toBe(stats);
  });

  it('list an act best first, by what each player put up', () => {
    const run = { act: 1, stats: { 1: { a: { g: 1, min: 12, pts: 4, reb: 1, ast: 0 }, b: { g: 1, min: 12, pts: 9, reb: 3, ast: 2 } } } };
    expect(actStats(run).map(r => r.key)).toEqual(['b', 'a']);
    expect(actStats(run)[0]).toEqual({ key: 'b', g: 1, min: 12, pts: 9, reb: 3, ast: 2 });
  });

  it('read an earlier act, and nothing for a run from before them', () => {
    const run = { act: 2, stats: { 1: { a: { g: 1, min: 12, pts: 4, reb: 1, ast: 0 } } } };
    expect(actStats(run, 1).length).toBe(1);
    expect(actStats(run).length).toBe(0);
    expect(actStats({ act: 1 })).toEqual([]);
  });

  it('total the whole climb across the acts', () => {
    const run = { act: 3, stats: { 1: { a: { g: 2, min: 20, pts: 10, reb: 1, ast: 1 } }, 3: { a: { g: 1, min: 12, pts: 5, reb: 2, ast: 0 }, b: { g: 1, min: 6, pts: 1, reb: 0, ast: 0 } } } };
    expect(runStats(run)).toEqual([
      { key: 'a', g: 3, min: 32, pts: 15, reb: 3, ast: 1 },
      { key: 'b', g: 1, min: 6, pts: 1, reb: 0, ast: 0 },
    ]);
  });
});

describe('a game result', () => {
  const game = {
    teamA: {
      score: 30,
      roster: [FIVE[0], FIVE[1]],
      stats: [{ id: FIVE[0].id, minutes: 12, totalMinutes: 12, pts: 14, reb: 3, ast: 2 }, { id: FIVE[1].id, minutes: 0, totalMinutes: 0, pts: 0 }],
    },
    teamB: { score: 20 },
    buffs: {},
  };

  it('carries the box score of who played', () => {
    expect(resultFromGame(game, '1-0').box).toEqual([{ key: KEYS[0], pts: 14, reb: 3, ast: 2, min: 12 }]);
  });

  it('lands in the run, in the act it was played', () => {
    const r = recordResult(chooseStop(camped(), '1-0'), resultFromGame(game, '1-0'));
    expect(actStats(r)[0]).toMatchObject({ key: KEYS[0], g: 1, pts: 14 });
  });

  it('counts the game of a run that ends on it', () => {
    const r = recordResult(chooseStop(camped(), '1-0'), { ...resultFromGame(game, '1-0'), won: false });
    expect(r.status).toBe('lost');
    expect(actStats(r).length).toBe(1);
  });
});

describe('the bosses', () => {
  it('name the next act before it is played, the same one it will field', () => {
    const run = camped();
    const next = bossTeam(run, 2);
    expect(next.abbr).toBeTruthy();
    expect(next).toEqual(bossTeam({ ...run, act: 2 }));
    expect(next.abbr).not.toBe(bossTeam(run).abbr);
  });
});
