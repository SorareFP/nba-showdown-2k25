// THE CLIMB'S FIRST GAME-LONG CARDS BY PLAYBOOK (2026-10-19): Let It Fly and
// Pace and Space (Speed), Bruise Brothers and Weight Room (Paint), Conditioning
// and Shut the Door (Defense), Stay Hot and Ice Bath (any) — the last two the
// user's own ("carrying hot markers into next game ... or erasing fatigue after
// a game").
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, getPS, getFatigue, checkNeed, climbCheckParts, noteLastCheck } from './engine.js';
import { execCard } from './execCard.js';
import { canPlayCard } from './canPlay.js';
import { CLIMB_GAME_CARDS, STRAT_MAP } from './strats.js';
import { leanOf } from './modes/climbKits.js';
import { resultFromGame, recordResult, newRun, chooseCamp, chooseStop, openStops, presetFor } from './modes/run.js';
import { CARDS } from './cards.js';
import { cardKey } from './cardSets.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 12, power: 12,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
function board() {
  const roster = p => Array.from({ length: 5 }, (_, i) => mk(`${p}${i}`));
  const g = newGame(roster('a'), roster('b'));
  g.teamA.starters = g.teamA.roster.slice(0, 5).map(p => ({ ...p }));
  g.teamB.starters = g.teamB.roster.slice(0, 5).map(p => ({ ...p }));
  g.phase = 'matchup_strats';
  g.matchupTurn = 'A';
  g.teamB.hand = [];
  return g;
}
const play = (g, key, id, opts = {}) => {
  getTeam(g, key).hand = [id, 'turnover'];
  g.matchupTurn = key;
  const r = execCard(g, key, id, opts);
  expect(r.ok, r.msg).toBe(true);
  return r.game;
};

describe('the game-long Climb cards', () => {
  it('are seventeen Climb-only cards, each leaning to its playbook or to none', () => {
    expect(CLIMB_GAME_CARDS).toHaveLength(17);
    for (const id of CLIMB_GAME_CARDS) expect(STRAT_MAP[id], id).toMatchObject({ climbOnly: true });
    expect(['let_it_fly', 'pace_and_space', 'splash', 'ball_movement', 'up_tempo'].map(leanOf)).toEqual(['speed', 'speed', 'speed', 'speed', 'speed']);
    expect(['bruise_brothers', 'weight_room', 'wear_them_down', 'crash_every_board', 'play_through_contact'].map(leanOf)).toEqual(['paint', 'paint', 'paint', 'paint', 'paint']);
    expect(['conditioning', 'shut_the_door', 'get_stops', 'talk_on_defense', 'full_court_press'].map(leanOf)).toEqual(['defense', 'defense', 'defense', 'defense', 'defense']);
    expect(['stay_hot', 'ice_bath', 'on_fire', 'film_session', 'signature_set', 'leave_it_all', 'ride_your_star', 'two_a_days'].map(leanOf)).toEqual([null, null, null, null, null, null, null, null]);
  });

  it('are set up in the matchup, on your turn, once each a game', () => {
    const g = board();
    g.teamA.hand = ['let_it_fly'];
    expect(canPlayCard(g, 'A', 'let_it_fly').canPlay).toBe(true);
    g.phase = 'scoring';
    expect(canPlayCard(g, 'A', 'let_it_fly').canPlay).toBe(false);
    const after = play(board(), 'A', 'let_it_fly');
    after.teamA.hand = ['let_it_fly'];
    expect(canPlayCard(after, 'A', 'let_it_fly').canPlay).toBe(false);
  });

  it('Let It Fly, Bruise Brothers and Shut the Door move the checks, and the "needs" figure with them', () => {
    let g = play(board(), 'A', 'let_it_fly');
    g = play(g, 'A', 'bruise_brothers');
    g = play(g, 'B', 'shut_the_door');
    expect(climbCheckParts(g, 'A', '3pt')).toEqual([{ label: 'Let It Fly', n: 1 }]);
    expect(climbCheckParts(g, 'A', 'paint').map(p => p.n)).toEqual([1, -1]);
    expect(climbCheckParts(g, 'B', 'paint')).toEqual([]);
    expect(checkNeed(g, 'A', 0, '3pt').need).toBe(checkNeed(board(), 'A', 0, '3pt').need - 1);
  });

  it('Splash grows with the team’s made threes: +1 a pair, up to +3', () => {
    const g = play(board(), 'A', 'splash');
    expect(climbCheckParts(g, 'A', '3pt')).toEqual([]);
    const stats = getTeam(g, 'A').stats;
    stats[0].threepm = 2; stats[1].threepm = 1;
    expect(climbCheckParts(g, 'A', '3pt')).toEqual([{ label: 'Splash', n: 1 }]);
    expect(climbCheckParts(g, 'A', 'paint')).toEqual([]);
    stats[2].threepm = 9;
    expect(climbCheckParts(g, 'A', '3pt')).toEqual([{ label: 'Splash', n: 3 }]);
    expect(climbCheckParts(g, 'B', '3pt')).toEqual([]);
    expect(checkNeed(g, 'A', 0, '3pt').need).toBe(checkNeed(board(), 'A', 0, '3pt').need - 3);
  });

  it('On Fire lights a player after three makes in a row, +3 on his checks until he misses', () => {
    const g = play(board(), 'A', 'on_fire');
    const shoot = (idx, hit) => {
      const player = getTeam(g, 'A').starters[idx];
      noteLastCheck(g, { teamKey: 'A', playerIdx: idx, player, type: 'paint', result: { hit, pts: hit ? 2 : 0, die: 10, type: 'paint' } });
    };
    shoot(0, true); shoot(0, true);
    expect(climbCheckParts(g, 'A', 'paint', 0)).toEqual([]);
    shoot(0, true);
    expect(climbCheckParts(g, 'A', 'paint', 0)).toEqual([{ label: 'On Fire', n: 3 }]);
    expect(climbCheckParts(g, 'A', '3pt', 0)).toEqual([{ label: 'On Fire', n: 3 }]);
    expect(climbCheckParts(g, 'A', 'paint', 1)).toEqual([]);
    expect(checkNeed(g, 'A', 0, 'paint').need).toBe(checkNeed(board(), 'A', 0, 'paint').need - 3);
    shoot(0, false);
    expect(climbCheckParts(g, 'A', 'paint', 0)).toEqual([]);
    // Without the card, a streak is only a streak.
    const plain = board();
    for (let i = 0; i < 3; i += 1) noteLastCheck(plain, { teamKey: 'A', playerIdx: 0, player: plain.teamA.starters[0], type: 'paint', result: { hit: true, pts: 2, die: 10, type: 'paint' } });
    expect(getPS(plain, 'A', plain.teamA.starters[0].id).streak).toBe(3);
    expect(climbCheckParts(plain, 'A', 'paint', 0)).toEqual([]);
  });

  it('Pace and Space adds a Speed to every player once; Weight Room three Power to one', () => {
    let g = play(board(), 'A', 'pace_and_space');
    expect(g.teamA.starters.map(p => p.speed)).toEqual([13, 13, 13, 13, 13]);
    expect(g.teamA.roster.every(p => p.speed === 13)).toBe(true);
    g.teamA.hand = ['weight_room'];
    expect(execCard(g, 'A', 'weight_room', {}).ok).toBe(false);   // a chosen card refuses no choice
    g = play(g, 'A', 'weight_room', { playerIdx: 2 });
    expect(g.teamA.starters[2].power).toBe(15);
    expect(g.teamA.starters[1].power).toBe(12);
  });

  it('Conditioning makes fatigue cost nothing this game', () => {
    const g = board();
    getPS(g, 'A', 'a0').minutes = 20;
    expect(getFatigue(g, 'A', 0)).toBeLessThan(0);
    expect(getFatigue(play(g, 'A', 'conditioning'), 'A', 0)).toBe(0);
  });

  it('Stay Hot carries up to two hot markers into the next game, and only the next', () => {
    const g = play(board(), 'A', 'stay_hot');
    getPS(g, 'A', 'a0').hot = 3;
    getPS(g, 'A', 'a1').hot = 1;
    const res = resultFromGame(g, '1-0');
    expect(res.carryHot).toEqual({ a0: 2, a1: 1 });
    expect(resultFromGame(board(), '1-0').carryHot).toBeUndefined();
    const next = newGame([mk('a0'), mk('a1')], [mk('b0')], null, null, { hot: { A: res.carryHot } });
    expect(next.teamA.stats.find(s => s.id === 'a0').hot).toBe(2);
  });

  it('Ice Bath clears the run\'s fatigue after the game and leaves the deck', () => {
    const FIVE = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).slice(100, 105);
    const r0 = newRun({ id: 'r', seed: 3, rung: 'prince', rosterKeys: FIVE.map(cardKey), now: 1 });
    const r = chooseCamp(r0, { playbook: 'speed', boon: r0.camp.boons.find(b => b !== 'cut_two') });
    const stop = openStops(r).find(s => s.kind === 'game').id;
    const inGame = chooseStop({ ...r, deck: { ...r.deck, ice_bath: 1 } }, stop);
    const tired = Object.fromEntries(FIVE.map(c => [c.id, 12]));
    const plain = recordResult(inGame, { stopId: stop, won: true, margin: 2, endMinutes: tired });
    expect(Object.keys(plain.fatigue).length).toBeGreaterThan(0);
    const iced = recordResult(inGame, { stopId: stop, won: true, margin: 2, endMinutes: tired, iceBath: 'ice_bath' });
    expect(iced.fatigue).toEqual({});
    expect(iced.deck.ice_bath ?? 0).toBe(0);
    // Stay Hot's markers reach the next game's deal, then go.
    const hot = recordResult(inGame, { stopId: stop, won: true, margin: 2, endMinutes: tired, carryHot: { [FIVE[0].id]: 2 } });
    expect(hot.carryHot).toEqual({ [FIVE[0].id]: 2 });
    const nextStop = openStops({ ...hot, status: 'map', offers: null }).find(s => s.kind !== 'rest');
    if (nextStop) expect(presetFor(chooseStop({ ...hot, status: 'map', offers: null }, nextStop.id)).gameOpts.hot).toEqual({ A: { [FIVE[0].id]: 2 } });
  });
});
