// THE CLIMB'S WAVE TWO (2026-10-20, the user: "I love 'em, go for all"). The
// seven Climb-only cards from the "+" draft (Powers that pay on a trigger, a
// card that grows across the run, a one-shot) and the six Grind cards, whose
// price is minutes on the tracker, added at the end of the section. And the
// Rivalry that always offers a player ("no card reward for a rivalry game is
// insane ... It's impossible to win without it").
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, getPS, endSection, noteLastCheck } from './engine.js';
import { execCard } from './execCard.js';
import { canPlayCard } from './canPlay.js';
import { STRAT_MAP, PLUS } from './strats.js';
import { resultFromGame, recordResult, newRun, chooseCamp, chooseStop, openStops, presetFor, rollDrops, takeFreePractice, SIGNATURE_MAX } from './modes/run.js';
import { CARDS } from './cards.js';
import { cardKey } from './cardSets.js';

const WAVE_TWO = ['get_stops', 'talk_on_defense', 'ball_movement', 'wear_them_down', 'film_session', 'signature_set', 'leave_it_all',
  'up_tempo', 'ride_your_star', 'full_court_press', 'crash_every_board', 'play_through_contact', 'two_a_days'];

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 12, power: 12,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
function board(phase = 'matchup_strats') {
  const roster = p => Array.from({ length: 5 }, (_, i) => mk(`${p}${i}`, { salary: 500 + i * 10 }));
  const g = newGame(roster('a'), roster('b'));
  g.quarter = 2; g.section = 1;
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.phase = phase;
  g.matchupTurn = 'A';
  g.scoringTurn = 'A';
  g.teamB.hand = [];
  return g;
}
const play = (g, id, opts = {}, hand = [id, 'turnover']) => {
  g.teamA.hand = hand;
  g.matchupTurn = 'A';
  g.scoringTurn = 'A';
  const r = execCard(g, 'A', id, opts);
  expect(r.ok, r.msg).toBe(true);
  return r.game;
};
const check = (g, idx, type, hit = true) => noteLastCheck(g, {
  teamKey: 'A', playerIdx: idx, player: g.teamA.starters[idx], type, result: { hit, pts: hit ? (type === '3pt' ? 3 : 2) : 0, die: 12, type },
});
function climbRun() {
  const FIVE = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).slice(100, 105);
  const r0 = newRun({ id: 'r', seed: 3, rung: 'prince', rosterKeys: FIVE.map(cardKey), now: 1 });
  const r = chooseCamp(r0, { playbook: 'speed', boon: r0.camp.boons.find(b => b !== 'cut_two') });
  const stop = openStops(r).find(s => s.kind === 'game').id;
  return { FIVE, r, stop };
}

describe('the thirteen cards', () => {
  it('are Climb-only, each with a "+" that differs from its card', () => {
    for (const id of WAVE_TWO) {
      expect(STRAT_MAP[id], id).toMatchObject({ climbOnly: true });
      expect(PLUS[id]?.desc, id).toBeTruthy();
      expect(PLUS[id].desc, id).not.toBe(STRAT_MAP[id].desc);
    }
    expect(PLUS.ball_movement.innate && PLUS.film_session.innate).toBe(true);
  });
});

describe('the Powers', () => {
  it('Get Stops: every defense card after it is a Rebound (two for the "+"), and it does not pay itself', () => {
    let g = play(board(), 'get_stops');
    expect(g.teamA.rebounds).toBe(0);
    g = play(g, 'full_court_press');
    expect(g.teamA.rebounds).toBe(1);
    let p = play(board(), 'get_stops+');
    p = play(p, 'full_court_press');
    expect(p.teamA.rebounds).toBe(2);
  });

  it('Talk on Defense: a switching card is +1 Speed on defense for the five this section (+2)', () => {
    let g = play(board(), 'talk_on_defense+');
    g = play(g, 'switch_the_screen', {});
    expect([0, 1, 2, 3, 4].map(i => g.tempDefEff.A[i].speedBoost)).toEqual([2, 2, 2, 2, 2]);
    // A card that is not a switch pays nothing.
    const cheap = board();
    cheap.teamA.starters[0].salary = 200;
    const h = play(play(cheap, 'talk_on_defense'), 'energizer', { playerIdx: 0 });
    expect(h.tempDefEff.A?.[1]?.speedBoost ?? 0).toBe(0);
  });

  it('Ball Movement: a made three is an Assist for the teammate who passes most, kept on the check record', () => {
    const g = play(board(), 'ball_movement');
    getPS(g, 'A', 'a2').ast = 3;
    const before = g.teamA.assists;
    check(g, 0, '3pt');
    expect(g.teamA.assists).toBe(before + 1);
    expect(getPS(g, 'A', 'a2').ast).toBe(4);
    expect(g.lastShotCheck.astPaid).toEqual([{ playerId: 'a2', n: 1 }]);
    check(g, 0, 'paint');
    check(g, 0, '3pt', false);
    expect(g.teamA.assists).toBe(before + 1);
  });

  it('Wear Them Down: a made paint check costs the defender a Power for the game, three at most (five for the "+")', () => {
    const g = play(board(), 'wear_them_down');
    const def = () => g.teamB.starters[g.offMatchups.A[0] ?? 0];
    const start = def().power;
    for (let i = 0; i < 5; i += 1) check(g, 0, 'paint');
    expect(def().power).toBe(start - 3);
    expect(g.teamB.roster.find(p => p.id === def().id).power).toBe(start - 3);
    const p = play(board(), 'wear_them_down+');
    const dp = () => p.teamB.starters[p.offMatchups.A[0] ?? 0];
    for (let i = 0; i < 7; i += 1) check(p, 0, 'paint');
    expect(dp().power).toBe(start - 5);
  });

  it('Film Session: one card more as each section opens, past the seven', () => {
    const g = play(board('scoring'), 'film_session');
    g.teamA.hand = [];
    g.teamA.deck = Array.from({ length: 20 }, () => 'turnover');
    const ng = endSection(g);
    expect(ng.teamA.hand).toHaveLength(8);
    expect(ng.log.some(l => /Film Session/.test(l.msg))).toBe(true);
  });
});

describe('Signature Set grows across the run', () => {
  it('is +2 to a chosen player still to roll, and the run grows it to +6', () => {
    const g = play(board('scoring'), 'signature_set', { playerIdx: 3 });
    expect(g.tempEff.A.r3).toBe(2);
    expect(resultFromGame(g, '1-0').signatureStep).toBe(1);
    expect(resultFromGame(play(board('scoring'), 'signature_set+', { playerIdx: 1 }), '1-0').signatureStep).toBe(2);
    g.teamA.hand = ['signature_set'];
    expect(execCard(g, 'A', 'signature_set', {}).ok).toBe(false);   // a chosen card refuses no choice
    const grown = board('scoring');
    grown.signatureBonus = { A: 5 };
    expect(play(grown, 'signature_set', { playerIdx: 0 }).tempEff.A.r0).toBe(5);

    const { r, stop } = climbRun();
    const inGame = chooseStop(r, stop);
    let after = recordResult(inGame, { stopId: stop, won: true, margin: 2, signatureStep: 2 });
    expect(after.signature).toBe(2);
    after = recordResult({ ...inGame, signature: 3 }, { stopId: stop, won: true, margin: 2, signatureStep: 2 });
    expect(after.signature).toBe(SIGNATURE_MAX - 2);
    const back = { ...after, status: 'map', offers: null };
    const next = openStops(back).find(s => s.kind !== 'rest');
    if (next) expect(presetFor(chooseStop(back, next.id)).gameOpts.signatureBonus).toEqual({ A: 6 });
  });
});

describe('the one-shots', () => {
  it('Leave It All Out There: +3 to every roll this section (+4), and the run takes the copy out', () => {
    const g = play(board(), 'leave_it_all+');
    expect([0, 1, 2, 3, 4].map(i => g.tempEff.A['r' + i])).toEqual([4, 4, 4, 4, 4]);
    expect(resultFromGame(g, '1-0').leaves).toEqual(['leave_it_all+']);
    const { r, stop } = climbRun();
    const inGame = chooseStop({ ...r, deck: { ...r.deck, 'leave_it_all+': 1 } }, stop);
    expect(recordResult(inGame, { stopId: stop, won: true, margin: 2, leaves: ['leave_it_all+'] }).deck['leave_it_all+'] ?? 0).toBe(0);
  });

  it('Two-a-Days: four more minutes on every tracker (two for the "+"), a practice from the map, and it leaves', () => {
    const g = play(board(), 'two_a_days');
    expect(resultFromGame(g, '1-0')).toMatchObject({ twoADays: 4, leaves: ['two_a_days'] });
    expect(resultFromGame(play(board(), 'two_a_days+'), '1-0').twoADays).toBe(2);
    const { FIVE, r, stop } = climbRun();
    const inGame = chooseStop({ ...r, deck: { ...r.deck, two_a_days: 1 } }, stop);
    const after = recordResult(inGame, { stopId: stop, won: true, margin: 2, endMinutes: {}, twoADays: 4, leaves: ['two_a_days'] });
    expect(FIVE.map(c => after.fatigue[c.id])).toEqual([4, 4, 4, 4, 4]);
    expect(after.deck.two_a_days ?? 0).toBe(0);
    expect(after.freePractice).toBe(1);
    const onMap = { ...after, status: 'map', offers: null };
    const practised = takeFreePractice(onMap, 'catch_and_shoot');
    expect(practised.deck['catch_and_shoot+']).toBe((onMap.deck['catch_and_shoot+'] ?? 0) + 1);
    expect(practised.freePractice).toBe(0);
    expect(() => takeFreePractice(practised, 'catch_and_shoot')).toThrow();
  });
});

describe('the Grind cards: minutes at the end of the section', () => {
  it('Up-Tempo draws two (three) and costs every starter a minute', () => {
    const g = board('scoring');
    g.teamA.deck = Array.from({ length: 10 }, () => 'turnover');
    const after = play(g, 'up_tempo+', {}, ['up_tempo+']);
    expect(after.teamA.hand).toHaveLength(3);
    expect(after.teamA.starters.map(p => getPS(after, 'A', p.id).extraMinutes)).toEqual([1, 1, 1, 1, 1]);
    const ng = endSection(after);
    expect(getPS(ng, 'A', 'a0').minutes).toBe(5);
    expect(getPS(ng, 'A', 'a0').extraMinutes).toBeUndefined();
  });

  it('Ride Your Star: the highest-paid starter still to roll, +4, three minutes (two for the "+")', () => {
    const g = play(board('scoring'), 'ride_your_star+');
    expect(g.tempEff.A.r4).toBe(4);
    expect(getPS(g, 'A', 'a4').extraMinutes).toBe(2);
    const rolled = board('scoring');
    rolled.rollResults.A[4] = { die: 10, pts: 2 };
    rolled.teamA.hand = ['ride_your_star'];
    expect(canPlayCard(rolled, 'A', 'ride_your_star').canPlay).toBe(false);
  });

  it('Full-Court Press: the five +3 Speed on defense (+4), two minutes each', () => {
    const g = play(board(), 'full_court_press');
    expect([0, 1, 2, 3, 4].map(i => g.tempDefEff.A[i].speedBoost)).toEqual([3, 3, 3, 3, 3]);
    expect(g.teamA.starters.map(p => getPS(g, 'A', p.id).extraMinutes)).toEqual([2, 2, 2, 2, 2]);
  });

  it('Crash Every Board: +3 Rebounds (+4) to the two biggest, two minutes each', () => {
    const b = board('scoring');
    b.teamA.starters[1].power = 16;
    b.teamA.starters[3].power = 15;
    const g = play(b, 'crash_every_board');
    expect(g.teamA.rebounds).toBe(3);
    expect([getPS(g, 'A', 'a1').reb, getPS(g, 'A', 'a3').reb]).toEqual([2, 1]);
    expect([getPS(g, 'A', 'a1').extraMinutes, getPS(g, 'A', 'a3').extraMinutes, getPS(g, 'A', 'a0').extraMinutes]).toEqual([2, 2, undefined]);
  });

  it('Play Through Contact: a Power edge, a Paint check at +3 (+5) with a hot marker on a hit, three minutes', () => {
    const b = board('scoring');
    b.teamA.starters[2].power = 16;
    b.teamA.hand = ['play_through_contact'];
    expect(canPlayCard(b, 'A', 'play_through_contact').canPlay).toBe(true);
    expect(execCard(b, 'A', 'play_through_contact', { playerIdx: 0 }).ok).toBe(false);   // no Power edge
    // Written down, not rolled (the picker's preview), so the check itself can be read.
    b.previewChecks = [];
    const g = play(b, 'play_through_contact+', { playerIdx: 2 });
    expect(g.previewChecks[0]).toMatchObject({ playerIdx: 2, type: 'paint', bonus: 5, onHitHot: true });
    expect(getPS(g, 'A', 'a2').extraMinutes).toBe(3);
    const flat = board('scoring');
    flat.teamA.hand = ['play_through_contact'];
    expect(canPlayCard(flat, 'A', 'play_through_contact').canPlay).toBe(false);
  });
});

describe('a Rivalry always offers a player', () => {
  it('even when the smoothing has fallen to its floor, and the smoothing stays put', () => {
    const run = { seed: 7, dropOdds: { player: -0.4, perk: 0 } };
    for (let i = 0; i < 20; i += 1) {
      const d = rollDrops(run, { kind: 'rivalry' }, `3-${i}`, ['p1', 'p2', 'p3'], ['gym_rat']);
      expect(d.players).toEqual(['p1', 'p2', 'p3']);
      expect(d.dropOdds.player).toBe(-0.4);
    }
    // A Game is still a chance.
    const games = Array.from({ length: 40 }, (_, i) => rollDrops(run, { kind: 'game' }, `2-${i}`, ['p1'], []).players.length);
    expect(games.some(n => n === 0)).toBe(true);
    // Nobody fits: nothing to offer.
    expect(rollDrops(run, { kind: 'rivalry' }, '3-0', [], []).players).toEqual([]);
  });
});
