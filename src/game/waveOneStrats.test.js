// Wave one of the strategy-card backlog (the user's docx designs, built
// 2026-09-06): every card's gate and its core effect, plus the two rules the
// wave introduced — an announced Paint check the defence can answer (Back to
// the Basket), and ONE answer per announced check.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { newGame, getTeam, doRoll } from './engine.js';
import { CARDS } from './cards.js';
import { execCard, resolvePendingShotCheck } from './execCard.js';
import { canPlayCard } from './canPlay.js';

const p = (name, speed, power, extra = {}) => ({
  ...CARDS[0], id: name, name, speed, power, defBoost: 0, salary: 800,
  threePtBoost: 0, paintBoost: 0, shotLine: 18, pos: 'SG', ...extra,
});
const five = (prefix, speed = 10, power = 10, extra = {}) =>
  [0, 1, 2, 3, 4].map(i => p(`${prefix}${i}`, speed, power, extra));

function game({ A, B, hand = [], phase = 'scoring', assists = 0, rebounds = 0 } = {}) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'A').starters = A || five('a');
  getTeam(g, 'B').starters = B || five('b');
  getTeam(g, 'A').hand = hand;
  getTeam(g, 'B').hand = [];
  getTeam(g, 'A').assists = assists;
  getTeam(g, 'A').rebounds = rebounds;
  g.phase = phase;
  if (phase === 'matchup_strats') g.matchupTurn = 'A'; else g.scoringTurn = 'A';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.rollResults = { A: [], B: [] };
  g.tempEff = {}; g.tempDefEff = {};
  return g;
}
const play = (g, id, opts = {}, team = 'A') => execCard(g, team, id, opts);
const log = (g, start) => g.log.filter(e => e.msg.startsWith(start));

afterEach(() => vi.restoreAllMocks());

// ── Matchup phase ──────────────────────────────────────────────────────────
describe('matchup-phase wave-one cards', () => {
  it('Spain Pick & Roll: the faster player gets +2 roll and an assist-on-score flag', () => {
    const A = five('a'); A[0] = p('fast', 14, 10);
    const g = game({ A, hand: ['spain_pick_roll'], phase: 'matchup_strats' });
    expect(canPlayCard(g, 'A', 'spain_pick_roll').canPlay).toBe(true);
    const r = play(g, 'spain_pick_roll', { playerIdx: 0 });
    expect(r.ok).toBe(true);
    expect(r.game.tempEff.A.r0).toBe(2);
    expect(r.game.tempEff.A.astOnScore0).toBe(1);
    expect(play(g, 'spain_pick_roll', { playerIdx: 1 }).ok).toBe(false);
  });

  it('Mismatch Hunter needs a +4 edge and gives +2 roll', () => {
    const A = five('a'); A[2] = p('big', 10, 14);
    const g = game({ A, hand: ['mismatch_hunter'], phase: 'matchup_strats' });
    expect(canPlayCard(g, 'A', 'mismatch_hunter').canPlay).toBe(true);
    expect(play(g, 'mismatch_hunter', { playerIdx: 2 }).game.tempEff.A.r2).toBe(2);
    expect(play(g, 'mismatch_hunter', { playerIdx: 1 }).ok).toBe(false);
    const g2 = game({ hand: ['mismatch_hunter'], phase: 'matchup_strats' });
    expect(canPlayCard(g2, 'A', 'mismatch_hunter').canPlay).toBe(false);
  });

  it('Strength in Numbers pays +3 AST only when all five have an edge', () => {
    const g = game({ A: five('a', 11, 10), hand: ['strength_in_numbers'], phase: 'matchup_strats', assists: 1 });
    expect(canPlayCard(g, 'A', 'strength_in_numbers').canPlay).toBe(true);
    const r = play(g, 'strength_in_numbers');
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').assists).toBe(4);
    const A = five('a', 11, 10); A[4] = p('flat', 10, 10);
    const g2 = game({ A, hand: ['strength_in_numbers'], phase: 'matchup_strats' });
    expect(canPlayCard(g2, 'A', 'strength_in_numbers').canPlay).toBe(false);
    expect(play(g2, 'strength_in_numbers').ok).toBe(false);
  });

  it('Energizer boosts a sub-$250 player on defense only', () => {
    const A = five('a'); A[3] = p('cheap', 10, 10, { salary: 200 });
    const g = game({ A, hand: ['energizer'], phase: 'matchup_strats' });
    const r = play(g, 'energizer', { playerIdx: 3 });
    expect(r.ok).toBe(true);
    expect(r.game.tempDefEff.A[3]).toMatchObject({ speedBoost: 3, powerBoost: 3 });
    expect(r.game.tempEff.A?.s3).toBeUndefined();
    expect(play(g, 'energizer', { playerIdx: 0 }).ok).toBe(false);
  });

  it('Defensive Identity needs three Defensive Bonuses and lifts all five', () => {
    const A = five('a'); [0, 1, 2].forEach(i => { A[i] = p(`db${i}`, 10, 10, { defBoost: 1 }); });
    const g = game({ A, hand: ['defensive_identity'], phase: 'matchup_strats' });
    expect(canPlayCard(g, 'A', 'defensive_identity').canPlay).toBe(true);
    const r = play(g, 'defensive_identity');
    expect(r.ok).toBe(true);
    for (let i = 0; i < 5; i += 1) expect(r.game.tempDefEff.A[i]).toMatchObject({ speedBoost: 2, powerBoost: 2 });
    const two = five('a'); [0, 1].forEach(i => { two[i] = p(`db${i}`, 10, 10, { defBoost: 1 }); });
    expect(canPlayCard(game({ A: two, hand: ['defensive_identity'], phase: 'matchup_strats' }), 'A', 'defensive_identity').canPlay).toBe(false);
  });

  it('Defensive Anchor doubles the defender's bonus this section: a +3 wall zeroes a +4 star, a +1 halves him', () => {
    const A = five('a'); A[0] = p('anchor', 10, 10, { defBoost: 3 });
    const B = five('b'); B[0] = p('star', 14, 14);
    const g = game({ A, B, hand: ['defensive_anchor'], phase: 'matchup_strats' });
    const r = play(g, 'defensive_anchor', { playerIdx: 0 });
    expect(r.ok).toBe(true);
    expect(r.game.tempDefEff.A[0].dbExtra).toBe(3);
    // The star is guarded by slot 0 of A: +4/+4 less a doubled +3 rolls with no bonus.
    const g2 = { ...r.game, phase: 'scoring', scoringTurn: 'B' };
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const rolled = doRoll(g2, 'B', 0);
    expect(rolled.rollResults.B[0].bonus).toBe(0);
    vi.restoreAllMocks();
    // Any positive bonus qualifies now; a +1 anchor takes the +4 edge to +2.
    const A1 = five('a'); A1[0] = p('lite', 10, 10, { defBoost: 1 });
    const g1 = game({ A: A1, B, hand: ['defensive_anchor'], phase: 'matchup_strats' });
    const r1 = play(g1, 'defensive_anchor', { playerIdx: 0 });
    expect(r1.ok).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(doRoll({ ...r1.game, phase: 'scoring', scoringTurn: 'B' }, 'B', 0).rollResults.B[0].bonus).toBe(2);
    // No bonus, no anchor.
    expect(play(g, 'defensive_anchor', { playerIdx: 1 }).ok).toBe(false);
  });

  it('Swarming Defense targets the highest salary; 11+ makes them keep the lower die', () => {
    const B = five('b'); B[3] = p('rich', 10, 10, { salary: 1200 });
    const g = game({ B, hand: ['swarming_defense'], phase: 'matchup_strats' });
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // d20 = 19
    const r = play(g, 'swarming_defense');
    expect(r.ok).toBe(true);
    expect(r.game.tempEff.B.dis3).toBe(1);
    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // d20 = 3
    const miss = play(g, 'swarming_defense');
    expect(miss.game.tempEff.B?.dis3).toBeUndefined();
    expect(log(miss.game, 'Swarming Defense')[0].msg).toContain('shakes it off');
  });
});

// ── Roll-time hooks ────────────────────────────────────────────────────────
describe('roll-time hooks', () => {
  it('Unsung Hero keeps the higher of two dice, Swarming keeps the lower', () => {
    const g = game();
    g.tempEff = { A: { adv0: 1, dis1: 1 } };
    const dice = [0.1, 0.9, 0.9, 0.1]; // slot 0: 3 then 19 → 19; slot 1: 19 then 3 → 3
    let k = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => dice[k++ % dice.length]);
    const r1 = doRoll(g, 'A', 0);
    expect(r1.rollResults.A[0].die).toBe(19);
    const r2 = doRoll(r1, 'A', 1);
    expect(r2.rollResults.A[1].die).toBe(3);
  });

  it('Post Domination doubles rebounds from the roll; Spain adds an assist on a score', () => {
    const g = game();
    g.tempEff = { A: { reb20: 1, astOnScore0: 1 } };
    vi.spyOn(Math, 'random').mockReturnValue(0.95); // die 20: the top of the chart
    const before = getTeam(g, 'A');
    const r = doRoll(g, 'A', 0);
    const res = r.rollResults.A[0];
    const plain = doRoll({ ...g, tempEff: {} }, 'A', 0).rollResults.A[0];
    expect(res.reb).toBe(plain.reb * 2);
    if (res.pts > 0) expect(getTeam(r, 'A').assists).toBe(before.assists + res.ast + 1);
    expect(r.lastRoll).toMatchObject({ teamKey: 'A', idx: 0, boxed: false });
  });
});

// ── Scoring phase: offense ─────────────────────────────────────────────────
describe('scoring-phase wave-one cards', () => {
  it('Five-Out: a 3PT shooter takes two checks at +1 instead of the roll', () => {
    const A = five('a'); A[1] = p('shooter', 10, 10, { threePtBoost: 2 });
    const g = game({ A, hand: ['five_out'] });
    expect(canPlayCard(g, 'A', 'five_out').canPlay).toBe(true);
    const r = play(g, 'five_out', { playerIdx: 1 });
    expect(r.ok).toBe(true);
    expect(log(r.game, 'Five-Out Offense')).toHaveLength(2);
    expect(r.game.rollResults.A[1].isReplaced).toBe(true);
    expect(play(g, 'five_out', { playerIdx: 0 }).ok).toBe(false);
  });

  it('Hammer Set: the non-shooter with a Speed edge takes a three (hit = +2 AST)', () => {
    const A = five('a'); A[0] = p('slasher', 13, 10); A[1] = p('sniper', 13, 10, { threePtBoost: 2 });
    const g = game({ A, hand: ['hammer_set'] });
    const r = play(g, 'hammer_set', { playerIdx: 0 });
    expect(r.ok).toBe(true);
    // Team B holds nothing, so the check resolves on the spot rather than
    // stopping the game — the user's rule, 2026-09-07.
    expect(r.game.pendingShotCheck).toBeNull();
    // Two lines: the announcement, then the result it resolved straight into.
    expect(log(r.game, 'Hammer Set')).toHaveLength(2);
    // Give the defence a Close Out and the same play stops for it.
    const armed = game({ A, hand: ['hammer_set'] });
    getTeam(armed, 'B').hand = ['close_out'];
    expect(play(armed, 'hammer_set', { playerIdx: 0 }).game.pendingShotCheck)
      .toMatchObject({ teamKey: 'A', playerIdx: 0, type: '3pt', bonus: 0, onHitAst: 2 });
    expect(play(g, 'hammer_set', { playerIdx: 1 }).ok).toBe(false);
  });

  it('Iso-Heavy: +3 for one, −2 for the other four', () => {
    const r = play(game({ hand: ['iso_heavy'] }), 'iso_heavy', { playerIdx: 2 });
    expect(r.ok).toBe(true);
    expect(r.game.tempEff.A.r2).toBe(3);
    [0, 1, 3, 4].forEach(i => expect(r.game.tempEff.A['r' + i]).toBe(-2));
  });

  it('Three-Point Barrage fires every shooter, plus one more for an assist', () => {
    const A = five('a'); [0, 1, 2].forEach(i => { A[i] = p(`s${i}`, 10, 10, { threePtBoost: 1 }); });
    const g = game({ A, hand: ['three_point_barrage'], assists: 1 });
    expect(log(play(g, 'three_point_barrage').game, 'Three-Point Barrage')).toHaveLength(3);
    const r = play(g, 'three_point_barrage', { extraShooterIdx: 0 });
    expect(log(r.game, 'Three-Point Barrage')).toHaveLength(4);
    expect(getTeam(r.game, 'A').assists).toBe(0);
    const two = five('a'); [0, 1].forEach(i => { two[i] = p(`s${i}`, 10, 10, { threePtBoost: 1 }); });
    expect(canPlayCard(game({ A: two, hand: ['three_point_barrage'] }), 'A', 'three_point_barrage').canPlay).toBe(false);
  });

  it('Crash and Kick spends 3 REB + 1 AST for a +2 three', () => {
    const g = game({ hand: ['crash_and_kick'], rebounds: 3, assists: 1 });
    getTeam(g, 'B').hand = ['close_out']; // an answer exists, so it pauses
    const r = play(g, 'crash_and_kick', { playerIdx: 4 });
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A')).toMatchObject({ rebounds: 0, assists: 0 });
    expect(r.game.pendingShotCheck).toMatchObject({ playerIdx: 4, type: '3pt', bonus: 2 });
    expect(canPlayCard(game({ hand: ['crash_and_kick'], rebounds: 2, assists: 1 }), 'A', 'crash_and_kick').canPlay).toBe(false);
  });

  it('Pick-and-Pop spends 2 AST for a +1 three that pays 2 back on a hit', () => {
    const A = five('a'); A[0] = p('pop', 10, 10, { threePtBoost: 1 });
    const g = game({ A, hand: ['pick_and_pop'], assists: 2 });
    getTeam(g, 'B').hand = ['close_out']; // an answer exists, so it pauses
    const r = play(g, 'pick_and_pop', { playerIdx: 0 });
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').assists).toBe(0);
    expect(r.game.pendingShotCheck).toMatchObject({ type: '3pt', bonus: 1, onHitAst: 2 });
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // die 20: a hit
    expect(getTeam(resolvePendingShotCheck(r.game), 'A').assists).toBe(2);
  });

  it('Extra Pass: any player, either check, no card bonus', () => {
    const g = game({ hand: ['extra_pass'], assists: 2 });
    const A = getTeam(g, 'B').starters; A[3] = p('stopper', 10, 10, { defBoost: 2 });
    getTeam(g, 'B').hand = ['drop_coverage']; // answers a paint check, so it pauses
    const r = play(g, 'extra_pass', { playerIdx: 3, checkType: 'paint' });
    expect(r.ok).toBe(true);
    expect(r.game.pendingShotCheck).toMatchObject({ playerIdx: 3, type: 'paint', bonus: 0, noCardBonus: true });
    expect(getTeam(r.game, 'A').assists).toBe(0);
  });

  it('Lob City discards a card and pays per 15+ player', () => {
    const A = five('a'); A[0] = p('flyer', 15, 10); A[1] = p('runner', 16, 10); A[2] = p('dunker', 10, 15);
    const g = game({ A, hand: ['lob_city', 'close_out'] });
    const r = play(g, 'lob_city', { discardId: 'close_out' });
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').assists).toBe(2);
    expect(getTeam(r.game, 'A').score).toBe(2);
    expect(getTeam(r.game, 'A').hand).toEqual([]);
    expect(canPlayCard(game({ A, hand: ['lob_city'] }), 'A', 'lob_city').canPlay).toBe(false);
  });

  it('Stretch Five: a big who shoots at 14 or lower, then a teammate\'s paint check', () => {
    const A = five('a'); A[4] = p('stretch', 10, 14, { pos: 'C', shotLine: 16, threePtBoost: 2 });
    const g = game({ A, hand: ['stretch_five'] });
    expect(canPlayCard(g, 'A', 'stretch_five').canPlay).toBe(true);
    expect(play(g, 'stretch_five', { playerIdx: 4 }).ok).toBe(false); // no teammate chosen
    const r = play(g, 'stretch_five', { playerIdx: 4, player2Idx: 0 });
    expect(r.ok).toBe(true);
    // Two checks, so two lines: his three, then the teammate's paint check.
    const lines = log(r.game, 'Stretch Five');
    expect(lines).toHaveLength(2);
    expect(lines[1].msg).toContain('paint at +2');
    expect(play(g, 'stretch_five', { playerIdx: 0, player2Idx: 1 }).ok).toBe(false);
  });

  it('Post Domination needs two Power 15+ bigs and doubles one of them', () => {
    const A = five('a'); A[0] = p('big1', 10, 15); A[1] = p('big2', 10, 16);
    const g = game({ A, hand: ['post_domination'] });
    expect(play(g, 'post_domination', { playerIdx: 1 }).game.tempEff.A.reb21).toBe(1);
    const one = five('a'); one[0] = p('big1', 10, 15);
    expect(canPlayCard(game({ A: one, hand: ['post_domination'] }), 'A', 'post_domination').canPlay).toBe(false);
  });

  it('Unsung Hero is for $400 or less', () => {
    const A = five('a'); A[2] = p('hero', 10, 10, { salary: 400 });
    const g = game({ A, hand: ['unsung_hero'] });
    expect(play(g, 'unsung_hero', { playerIdx: 2 }).game.tempEff.A.adv2).toBe(1);
    expect(play(g, 'unsung_hero', { playerIdx: 0 }).ok).toBe(false);
  });

  it('Transition Outlet spends 1 REB + 1 AST for a +2 check with a Speed edge', () => {
    const A = five('a'); A[0] = p('outlet', 15, 10);
    const g = game({ A, hand: ['transition_outlet'], rebounds: 1, assists: 1 });
    // A Defensive Bonus REDUCES the attacker's edge, so the outlet needs a
    // big enough one to still qualify with a stopper on him.
    getTeam(g, 'B').starters[0] = p('stopper', 10, 10, { defBoost: 2 });
    getTeam(g, 'B').hand = ['drop_coverage']; // answers a paint check, so it pauses
    const r = play(g, 'transition_outlet', { playerIdx: 0, checkType: 'paint' });
    expect(r.ok).toBe(true);
    expect(r.game.pendingShotCheck).toMatchObject({ type: 'paint', bonus: 2, onHitAst: 1 });
    expect(getTeam(r.game, 'A')).toMatchObject({ rebounds: 0, assists: 0 });
    expect(play(g, 'transition_outlet', { playerIdx: 1 }).ok).toBe(false);
  });

  it('Back to the Basket announces a Paint check the defence can answer', () => {
    const A = five('a'); A[0] = p('post', 10, 14, { paintBoost: 1 });
    // Nobody holding an answer: it resolves without stopping the game.
    const plain = play(game({ A, hand: ['back_to_basket'] }), 'back_to_basket', { playerIdx: 0 });
    expect(plain.ok).toBe(true);
    expect(plain.game.pendingShotCheck).toBeNull();
    // A defender with the power and a Rim Protector: it stops.
    const g = game({ A, hand: ['back_to_basket'] });
    getTeam(g, 'B').starters[0] = p('wall', 10, 13, { defBoost: 3 });
    getTeam(g, 'B').hand = ['rim_protector'];
    const r = play(g, 'back_to_basket', { playerIdx: 0 });
    expect(r.game.pendingShotCheck).toMatchObject({ teamKey: 'A', playerIdx: 0, type: 'paint' });
  });
});

// ── Reactions: offense ─────────────────────────────────────────────────────
describe('offensive reactions', () => {
  it('Find the Open Man answers a Double Team with +4 to someone not trapped', () => {
    const g = game({ hand: ['find_the_open_man'] });
    expect(canPlayCard(g, 'A', 'find_the_open_man').canPlay).toBe(false);
    g.lastDoubleTeam = { teamKey: 'B', targetIdx: 0 };
    expect(canPlayCard(g, 'A', 'find_the_open_man').canPlay).toBe(true);
    expect(play(g, 'find_the_open_man', { playerIdx: 0 }).ok).toBe(false);
    const r = play(g, 'find_the_open_man', { playerIdx: 3 });
    expect(r.game.tempEff.A.r3).toBe(4);
    expect(r.game.lastDoubleTeam).toBeNull();
  });

  it('Double Team leaves the record Find the Open Man reads', () => {
    const g = game({ B: five('b'), hand: [] });
    getTeam(g, 'B').hand = ['double_team'];
    g.scoringTurn = 'B';
    const r = execCard(g, 'B', 'double_team', { targetIdx: 2 });
    expect(r.ok).toBe(true);
    expect(r.game.lastDoubleTeam).toEqual({ teamKey: 'B', targetIdx: 2 });
  });

  it('Putback Specialist follows your own miss: −2 REB for a +3 paint check', () => {
    const g = game({ hand: ['putback_specialist'], rebounds: 2 });
    expect(canPlayCard(g, 'A', 'putback_specialist').canPlay).toBe(false);
    g.lastCheckMiss = { teamKey: 'A', type: '3pt', playerIdx: 0, claimed: false };
    expect(canPlayCard(g, 'A', 'putback_specialist').canPlay).toBe(true);
    getTeam(g, 'B').starters[1] = p('wall', 10, 13, { defBoost: 3 });
    getTeam(g, 'B').hand = ['rim_protector']; // an answer exists, so it pauses
    const r = play(g, 'putback_specialist', { playerIdx: 1 });
    expect(r.ok).toBe(true);
    expect(r.game.pendingShotCheck).toMatchObject({ playerIdx: 1, type: 'paint', bonus: 3 });
    expect(getTeam(r.game, 'A').rebounds).toBe(0);
    expect(r.game.lastCheckMiss.claimed).toBe(true);
  });
});

// ── Reactions: defense ─────────────────────────────────────────────────────
function announced(type, { shooter = {}, guard = {}, bonus = 0, hand = [] } = {}) {
  const A = five('a'); A[0] = p('shooter', 10, 10, shooter);
  const B = five('b'); B[0] = p('guard', 10, 10, guard);
  const g = game({ A, B });
  getTeam(g, 'B').hand = hand;
  g.pendingShotCheck = { teamKey: 'A', playerIdx: 0, type, bonus, cardLabel: 'Test' };
  return g;
}

describe('defensive reactions to an announced check', () => {
  it('Rim Protector: Power + DB of 15 → −4, and a miss is +2 REB for the defence', () => {
    const g = announced('paint', { guard: { power: 12, defBoost: 3 }, hand: ['rim_protector'] });
    expect(canPlayCard(g, 'B', 'rim_protector').canPlay).toBe(true);
    const r = play(g, 'rim_protector', {}, 'B');
    expect(r.ok).toBe(true);
    expect(r.game.pendingShotCheck).toMatchObject({ contest: -4, rimProtector: 'B', reacted: 'B' });
    vi.spyOn(Math, 'random').mockReturnValue(0); // die 1: a miss
    const done = resolvePendingShotCheck(r.game);
    expect(getTeam(done, 'B').rebounds).toBe(getTeam(g, 'B').rebounds + 2);
    const weak = announced('paint', { guard: { power: 11, defBoost: 3 }, hand: ['rim_protector'] });
    expect(canPlayCard(weak, 'B', 'rim_protector').canPlay).toBe(false);
    const three = announced('3pt', { guard: { power: 12, defBoost: 3 }, hand: ['rim_protector'] });
    expect(canPlayCard(three, 'B', 'rim_protector').canPlay).toBe(false);
  });

  it('Drop Coverage: a Defensive Bonus on the shooter → −2 on a paint check', () => {
    const g = announced('paint', { guard: { defBoost: 1 }, hand: ['drop_coverage'] });
    expect(play(g, 'drop_coverage', {}, 'B').game.pendingShotCheck.contest).toBe(-2);
    expect(canPlayCard(announced('paint', { hand: ['drop_coverage'] }), 'B', 'drop_coverage').canPlay).toBe(false);
  });

  it('Smothering Defense trims the card bonus to a floor of 0', () => {
    const g = announced('3pt', { guard: { defBoost: 1 }, bonus: 2, hand: ['smothering_defense'] });
    const r = play(g, 'smothering_defense', {}, 'B');
    expect(r.game.pendingShotCheck.smother).toBe(3);
    expect(canPlayCard(announced('3pt', { guard: { defBoost: 1 }, bonus: 0, hand: ['smothering_defense'] }), 'B', 'smothering_defense').canPlay).toBe(false);
  });

  it('Denial discards a card and takes 2 AST, or −3 when they have fewer', () => {
    const g = announced('3pt', { hand: ['denial', 'close_out'] });
    getTeam(g, 'A').assists = 3;
    const r = play(g, 'denial', { discardId: 'close_out' }, 'B');
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'B').hand).toEqual([]);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const done = resolvePendingShotCheck(r.game);
    expect(getTeam(done, 'A').assists).toBe(1);
    expect(done.log.some(e => e.msg.includes('loses 2 AST'))).toBe(true);
    const poor = announced('3pt', { hand: ['denial', 'close_out'] });
    const r2 = play(poor, 'denial', {}, 'B');
    const done2 = resolvePendingShotCheck(r2.game);
    expect(done2.log.some(e => e.msg.includes('the check is at −3'))).toBe(true);
  });

  it('Hustle Play: a cheap defender contests an $800+ shooter with their bonus', () => {
    const g = announced('3pt', { shooter: { salary: 900 }, hand: ['hustle_play'] });
    getTeam(g, 'B').starters[3] = p('hustler', 10, 10, { salary: 300, defBoost: 2 });
    expect(canPlayCard(g, 'B', 'hustle_play').canPlay).toBe(true);
    expect(play(g, 'hustle_play', {}, 'B').game.pendingShotCheck.contest).toBe(-2);
    const cheapShooter = announced('3pt', { shooter: { salary: 700 }, hand: ['hustle_play'] });
    getTeam(cheapShooter, 'B').starters[3] = p('hustler', 10, 10, { salary: 300, defBoost: 2 });
    expect(canPlayCard(cheapShooter, 'B', 'hustle_play').canPlay).toBe(false);
  });

  it('one answer per announced check, and Close Out is for threes only', () => {
    const g = announced('paint', { guard: { power: 12, defBoost: 3 }, hand: ['drop_coverage', 'rim_protector', 'close_out'] });
    expect(canPlayCard(g, 'B', 'close_out').canPlay).toBe(false);
    const r = play(g, 'drop_coverage', {}, 'B');
    expect(canPlayCard(r.game, 'B', 'rim_protector').canPlay).toBe(false);
    expect(canPlayCard(r.game, 'B', 'rim_protector').reason).toContain('already been answered');
    expect(play(r.game, 'rim_protector', {}, 'B').ok).toBe(false);
  });
});

describe('after-the-fact defensive reactions', () => {
  it('Glass Cleaner: +2 REB after their miss, +3 with a Power edge on the shooter', () => {
    const A = five('a'); A[0] = p('guard', 10, 13);
    const B = five('b'); B[0] = p('bricks', 10, 10);
    const g = game({ A, B, hand: ['glass_cleaner'] });
    expect(canPlayCard(g, 'A', 'glass_cleaner').canPlay).toBe(false);
    g.lastCheckMiss = { teamKey: 'B', type: 'paint', playerIdx: 0, claimed: false };
    const r = play(g, 'glass_cleaner');
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').rebounds).toBe(3);
    expect(r.game.lastCheckMiss.claimed).toBe(true);
    expect(canPlayCard(r.game, 'A', 'glass_cleaner').canPlay).toBe(false);
  });

  it('a resolved miss leaves the record, a hit clears it', () => {
    const g = announced('3pt', {});
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(resolvePendingShotCheck(g).lastCheckMiss).toMatchObject({ teamKey: 'A', type: '3pt', playerIdx: 0 });
    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    expect(resolvePendingShotCheck(announced('3pt', {})).lastCheckMiss).toBeNull();
  });

  it('Box Out cancels the rebounds of their last roll, one more with a Power edge', () => {
    const A = five('a'); A[0] = p('boxer', 10, 13);
    const g = game({ A, hand: ['box_out'] });
    getTeam(g, 'B').rebounds = 5;
    expect(canPlayCard(g, 'A', 'box_out').canPlay).toBe(false);
    g.lastRoll = { teamKey: 'B', idx: 0, reb: 2, pts: 4, boxed: false };
    expect(canPlayCard(g, 'A', 'box_out').canPlay).toBe(true);
    const r = play(g, 'box_out');
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'B').rebounds).toBe(2);
    expect(r.game.lastRoll.boxed).toBe(true);
    expect(canPlayCard(r.game, 'A', 'box_out').canPlay).toBe(false);
  });
});
