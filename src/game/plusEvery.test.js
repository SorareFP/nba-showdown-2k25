// A "+" FOR EVERY CARD A RUN CAN OFFER (The Climb, approved 2026-10-20: "I
// think you can just push all of the + cards and I'll let you know if any need
// buffed/nerfed/reworked"). The seventy-nine beyond the kits, from
// docs/plans/2026-10-20-the-climb-plus-every-card.md. The plain-number ones
// are one line each in execCard; these are the ones with machinery: the two
// new riders (Run It Back, Innate), the effects that outlive the card
// (Dogged, Conditioning, Ice Bath, Stay Hot), and the ones that changed a rule
// rather than a number.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, getPS, getFatigue, calcAdv, climbCheckParts, noteLastCheck, applyLingering, creditPaintScore } from './engine.js';
import { execCard } from './execCard.js';
import { canPlayCard } from './canPlay.js';
import { STRATS, PLUS, plusId, isPlus } from './strats.js';
import { resultFromGame, recordResult, newRun, chooseCamp, chooseStop, openStops, presetFor } from './modes/run.js';
import { simulateGame } from './modes/simulate.js';
import { climbRng } from './modes/climbMap.js';
import { kitDeck } from './modes/climbKits.js';
import { ARCHETYPE_DECKS } from './archetypeDecks.js';
import { CARDS } from './cards.js';
import { cardKey } from './cardSets.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 12, power: 12,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
function board(phase = 'matchup_strats') {
  const roster = p => Array.from({ length: 5 }, (_, i) => mk(`${p}${i}`));
  const g = newGame(roster('a'), roster('b'));
  g.teamA.starters = g.teamA.roster.slice(0, 5).map(p => ({ ...p }));
  g.teamB.starters = g.teamB.roster.slice(0, 5).map(p => ({ ...p }));
  g.phase = phase;
  g.matchupTurn = 'A';
  g.scoringTurn = 'A';
  g.teamB.hand = [];
  return g;
}
const play = (g, key, id, opts = {}, hand = [id, 'turnover']) => {
  getTeam(g, key).hand = hand;
  g.matchupTurn = key;
  g.scoringTurn = key;
  const r = execCard(g, key, id, opts);
  expect(r.ok, r.msg).toBe(true);
  return r.game;
};

describe('the two new riders', () => {
  it('Run It Back: Extra Pass+ goes back into the deck after the play, and the plain one does not', () => {
    const g = board('scoring');
    g.teamA.assists = 4;
    g.teamA.deck = ['turnover', 'turnover'];
    const after = play(g, 'A', 'extra_pass+', { playerIdx: 0, checkType: '3pt' });
    expect(after.teamA.deck.filter(id => id === 'extra_pass+')).toHaveLength(1);
    expect(after.teamA.deck).toHaveLength(3);
    expect(after.teamA.hand).not.toContain('extra_pass+');
    const g2 = board('scoring');
    g2.teamA.assists = 4;
    const plain = play(g2, 'A', 'extra_pass', { playerIdx: 0, checkType: '3pt' });
    expect(plain.teamA.deck).not.toContain('extra_pass');
  });

  it('Innate: Chemistry+ always starts the game in the opening hand', () => {
    const roster = p => Array.from({ length: 5 }, (_, i) => mk(`${p}${i}`));
    for (let i = 0; i < 10; i += 1) {
      const g = newGame(roster('a'), roster('b'), { 'chemistry+': 1, turnover: 40 });
      expect(g.teamA.hand).toContain('chemistry+');
      expect(g.teamA.hand).toHaveLength(7);
    }
    expect(PLUS.chemistry.innate).toBe(true);
    expect(PLUS.extra_pass.runItBack).toBe(true);
  });
});

describe('the "+" that outlive the card', () => {
  it('Dogged+ is −3/−3 and stays −3 until benched', () => {
    const g = board('scoring');
    getPS(g, 'B', 'b0').minutes = 20;
    const after = play(g, 'A', 'dogged+', { playerIdx: 0 });
    expect(after.tempEff.B.s0).toBe(-3);
    expect(after.tempEff.B.p0).toBe(-3);
    after.tempEff.B = {};
    applyLingering(after);
    expect(after.tempEff.B.s0).toBe(-3);
    // The plain card is still −2.
    const g2 = board('scoring');
    getPS(g2, 'B', 'b0').minutes = 20;
    const plain = play(g2, 'A', 'dogged', { playerIdx: 0 });
    plain.tempEff.B = {};
    applyLingering(plain);
    expect(plain.tempEff.B.s0).toBe(-2);
  });

  it('Conditioning+ covers this game and the next; the plain copy is refused while it does', () => {
    const g = play(board(), 'A', 'conditioning+');
    getPS(g, 'A', 'a0').minutes = 20;
    expect(getFatigue(g, 'A', 0)).toBe(0);
    expect(resultFromGame(g, '1-0').conditioned).toBe(true);
    expect(resultFromGame(play(board(), 'A', 'conditioning'), '1-0').conditioned).toBeUndefined();
    const next = newGame([mk('a0')], [mk('b0')], null, null, { buffs: { A: { conditioning_carry: true } } });
    next.teamA.starters = next.teamA.roster.slice();
    getPS(next, 'A', 'a0').minutes = 20;
    expect(getFatigue(next, 'A', 0)).toBe(0);
    next.phase = 'matchup_strats';
    next.matchupTurn = 'A';
    next.teamA.hand = ['conditioning', 'conditioning+'];
    expect(canPlayCard(next, 'A', 'conditioning').canPlay).toBe(false);
    expect(canPlayCard(next, 'A', 'conditioning+').canPlay).toBe(true);
  });

  it('the run carries Conditioning+ one game, and Ice Bath+ clears fatigue and stays in the deck', () => {
    const FIVE = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).slice(100, 105);
    const r0 = newRun({ id: 'r', seed: 3, rung: 'prince', rosterKeys: FIVE.map(cardKey), now: 1 });
    const r = chooseCamp(r0, { playbook: 'speed', boon: r0.camp.boons.find(b => b !== 'cut_two') });
    const stop = openStops(r).find(s => s.kind === 'game').id;
    const inGame = chooseStop({ ...r, deck: { ...r.deck, 'ice_bath+': 1 } }, stop);
    const tired = Object.fromEntries(FIVE.map(c => [c.id, 12]));
    const iced = recordResult(inGame, { stopId: stop, won: true, margin: 2, endMinutes: tired, iceBath: 'ice_bath+', conditioned: true });
    expect(iced.fatigue).toEqual({});
    expect(iced.deck['ice_bath+']).toBe(1);
    expect(iced.conditioned).toBe(true);
    const back = { ...iced, status: 'map', offers: null };
    const nextStop = openStops(back).find(s => !['rest', 'event'].includes(s.kind));
    if (nextStop) expect(presetFor(chooseStop(back, nextStop.id)).gameOpts.buffs).toEqual({ A: { conditioning_carry: true } });
    // ...and only that one game.
    expect(recordResult(inGame, { stopId: stop, won: true, margin: 2, endMinutes: tired }).conditioned).toBe(false);
  });

  it('Stay Hot+ carries up to three markers', () => {
    const g = play(board(), 'A', 'stay_hot+');
    getPS(g, 'A', 'a0').hot = 4;
    expect(resultFromGame(g, '1-0').carryHot).toEqual({ a0: 3 });
  });
});

describe('the Climb-only "+" numbers', () => {
  it('Let It Fly+ / Bruise Crew+ are +2, Shut the Door+ is −2 on the other side', () => {
    let g = play(board(), 'A', 'let_it_fly+');
    g = play(g, 'A', 'bruise_brothers+');
    g = play(g, 'A', 'shut_the_door+');
    expect(climbCheckParts(g, 'A', '3pt')).toEqual([{ label: 'Let It Fly', n: 2 }]);
    expect(climbCheckParts(g, 'A', 'paint')).toEqual([{ label: 'Bruise Crew', n: 2 }]);
    expect(climbCheckParts(g, 'B', 'paint')).toEqual([{ label: 'Shut the Door', n: -2 }]);
  });

  it('reads a game saved with the old `true` flag as the plain card', () => {
    const g = board();
    g.buffs = { A: { let_it_fly: true, splash: true }, B: {} };
    g.teamA.stats[0].threepm = 4;
    expect(climbCheckParts(g, 'A', '3pt')).toEqual([{ label: 'Let It Fly', n: 1 }, { label: 'Splash', n: 2 }]);
  });

  it('Splash+ is +1 a three, still up to +3; On Fire+ lights after two makes', () => {
    const g = play(board(), 'A', 'splash+');
    g.teamA.stats[0].threepm = 2;
    expect(climbCheckParts(g, 'A', '3pt')).toEqual([{ label: 'Splash', n: 2 }]);
    g.teamA.stats[1].threepm = 5;
    expect(climbCheckParts(g, 'A', '3pt')).toEqual([{ label: 'Splash', n: 3 }]);
    const f = play(board(), 'A', 'on_fire+');
    const shoot = hit => noteLastCheck(f, { teamKey: 'A', playerIdx: 0, player: f.teamA.starters[0], type: 'paint', result: { hit, pts: hit ? 2 : 0, die: 10, type: 'paint' } });
    shoot(true);
    expect(climbCheckParts(f, 'A', 'paint', 0)).toEqual([]);
    shoot(true);
    expect(climbCheckParts(f, 'A', 'paint', 0)).toEqual([{ label: 'On Fire', n: 3 }]);
  });

  it('Pace and Space+ adds two Speed; Weight Room+ five Power', () => {
    let g = play(board(), 'A', 'pace_and_space+');
    expect(g.teamA.starters.map(p => p.speed)).toEqual([14, 14, 14, 14, 14]);
    g = play(g, 'A', 'weight_room+', { playerIdx: 1 });
    expect(g.teamA.starters[1].power).toBe(17);
  });
});

describe('the "+" that change a rule', () => {
  it('Switch Everything+: opponent advantages grow by half (rounded down), not double', () => {
    const off = mk('o', { speed: 17, power: 15 });
    const def = mk('d', { speed: 12, power: 12 });
    expect(calcAdv(off, def, { halfAdv: true }, 0)).toMatchObject({ speedAdv: 7, powerAdv: 4 });
    expect(calcAdv(off, def, { doubleAdv: true }, 0)).toMatchObject({ speedAdv: 10, powerAdv: 6 });
    const after = play(board(), 'A', 'switch_everything+', {});
    expect(after.tempEff.B).toMatchObject({ halfAdv: true });
    expect(after.tempEff.B.doubleAdv).toBeUndefined();
  });

  it('Short-Roll Playmaker+: any teammate\'s paint make is an assist, credited to the playmaker', () => {
    const g = play(board(), 'A', 'short_roll_playmaker+', { playerIdx: 1 });
    const before = g.teamA.assists;
    expect(creditPaintScore(g, 'A', 3, g.teamA.starters[3])).toBe(1);
    expect(g.teamA.assists).toBe(before + 1);
    expect(getPS(g, 'A', 'a1').ast).toBe(1);
    expect(getPS(g, 'A', 'a3').ast || 0).toBe(0);
    expect(g.lastPaintAstBy).toBe('a1');
    // The plain card pays only the playmaker's own makes.
    const p = play(board(), 'A', 'short_roll_playmaker', { playerIdx: 1 });
    expect(creditPaintScore(p, 'A', 3, p.teamA.starters[3])).toBe(0);
    expect(creditPaintScore(p, 'A', 1, p.teamA.starters[1])).toBe(1);
  });

  it('the no-discard family plays from an otherwise empty hand', () => {
    const g = board('scoring');
    g.teamA.starters[0].power = 15;
    g.teamA.hand = ['lob_city+'];
    expect(canPlayCard(g, 'A', 'lob_city+').canPlay).toBe(true);
    g.teamA.hand = ['lob_city'];
    expect(canPlayCard(g, 'A', 'lob_city').canPlay).toBe(false);
    const after = play(g, 'A', 'lob_city+', {}, ['lob_city+']);
    expect(after.teamA.score).toBe(2);
    for (const id of ['outside_pick', 'pin_down_screen', 'denial']) {
      const r = execCard({ ...board('scoring'), teamA: { ...board('scoring').teamA, hand: [plusId(id)] } }, 'A', plusId(id), { playerIdx: 0 });
      if (!r.ok) expect(r.msg, id).not.toMatch(/discard/i);
    }
  });

  it('Fresh Legs+ rests three; Ice the Hot Hand+ ices two', () => {
    const g = board('scoring');
    g.timeoutActive = 'A';
    for (const id of ['a0', 'a1', 'a2']) getPS(g, 'A', id).minutes = 10;
    const fl = play(g, 'A', 'fresh_legs+', { playerIdx: 0, player2Idx: 1, player3Idx: 2 });
    expect(['a0', 'a1', 'a2'].map(id => getPS(fl, 'A', id).minutes)).toEqual([6, 6, 6]);
    const plain = play(g, 'A', 'fresh_legs', { playerIdx: 0, player2Idx: 1, player3Idx: 2 });
    expect(['a0', 'a1', 'a2'].map(id => getPS(plain, 'A', id).minutes)).toEqual([6, 6, 10]);
    getPS(g, 'B', 'b0').hot = 2;
    getPS(g, 'B', 'b3').hot = 1;
    const ice = play(g, 'A', 'ice_the_hot_hand+', { targetIdx: 0, target2Idx: 3 });
    expect([getPS(ice, 'B', 'b0').hot, getPS(ice, 'B', 'b3').hot]).toEqual([0, 0]);
  });

  it('Putback Dunk+ and Rimshaker+ open at Power 12', () => {
    const g = board('scoring');
    g.teamA.rebounds = 5;
    g.teamB.rebounds = 0;
    g.teamA.reboundsWon = 5;
    g.teamA.hand = ['putback_dunk+', 'putback_dunk'];
    const plus = canPlayCard(g, 'A', 'putback_dunk+');
    const plain = canPlayCard(g, 'A', 'putback_dunk');
    expect(plain.canPlay).toBe(false);
    if (!plus.canPlay) expect(plus.reason ?? plus.msg ?? '').not.toMatch(/Power 1[24]/);
    getPS(g, 'A', 'a0').hot = 1;
    const rs = play(g, 'A', 'rimshaker+', { playerIdx: 0 });
    expect(rs.teamA.score).toBe(2);
    g.teamA.hand = ['rimshaker'];
    expect(execCard(g, 'A', 'rimshaker', { playerIdx: 0 }).ok).toBe(false);
  });
});

// THE SMOKE TEST: decks of nothing but "+" copies, every card the fitted
// fifties carry, play whole seeded games through the coach on both sides
// without a refusal loop or a throw, and the "+" effects show in the log.
describe('a deck of "+" copies', () => {
  it('plays seeded games to the end on both sides', () => {
    const deck = {};
    for (const arch of ARCHETYPE_DECKS) {
      for (const [id, n] of Object.entries(arch.deck)) if (PLUS[id]) deck[plusId(id)] = Math.max(deck[plusId(id)] ?? 0, n);
    }
    expect(Object.keys(deck).length).toBeGreaterThan(30);
    expect(Object.keys(deck).every(isPlus)).toBe(true);
    const a = CARDS.slice(0, 8);
    const b = CARDS.slice(8, 16);
    let plusLines = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const res = simulateGame(a, b, { deckA: deck, deckB: kitDeck('paint'), rng: climbRng(seed, 'plus-smoke'), keepGame: true, gameOpts: { startQuarter: 4 } });
      expect(res.game.done, `seed ${seed}`).toBe(true);
      plusLines += res.game.log.filter(l => /\w\+[: ]/.test(l.msg)).length;
    }
    expect(plusLines).toBeGreaterThan(0);
  });
});

// EVERY "+" THROUGH ITS DOORS: on a busy board, a "+" copy the board calls
// playable is played with the coach's own choices, and nothing throws. The
// simulation swallows a throw (tryPlay), so this is where one would show.
describe('every "+" copy, played on a busy board', () => {
  it('never throws, and plays whenever the coach is told it can', async () => {
    const { aiBuildCardOpts } = await import('./ai.js');
    const busy = (phase, extra = {}) => {
      const g = board(phase);
      g.teamA.assists = 6; g.teamA.rebounds = 8; g.teamA.reboundsWon = 8;
      g.teamB.assists = 6; g.teamB.rebounds = 0;
      g.teamA.starters.forEach((p, i) => { p.speed = 15; p.power = 15; p.defBoost = 2; p.threePtBoost = 2; p.salary = i < 2 ? 240 : 900; p.pos = i === 4 ? 'C' : 'PG'; });
      g.teamA.roster.forEach((p, i) => Object.assign(p, g.teamA.starters[i] ?? {}));
      for (const p of g.teamA.starters) { getPS(g, 'A', p.id).hot = 1; getPS(g, 'A', p.id).minutes = 10; getPS(g, 'A', p.id).cold = 1; }
      for (const p of g.teamB.starters) { getPS(g, 'B', p.id).hot = 1; getPS(g, 'B', p.id).minutes = 14; getPS(g, 'B', p.id).cold = 1; }
      return Object.assign(g, extra);
    };
    const crunch = () => ({ active: true, margin: 4, used: {}, extra: {}, timeoutUsed: {}, searched: {} });
    const trailing = busy('scoring', { timeoutActive: 'A', crunch: crunch() });
    trailing.teamB.score = 6;
    const boards = [busy('matchup_strats'), busy('scoring'), busy('scoring', { timeoutActive: 'A' }), busy('pre_roll'), trailing, busy('matchup_strats', { crunch: crunch() })];
    const refused = [];
    const played = new Set();
    for (const s of STRATS.filter(x => PLUS[x.id])) {
      const id = plusId(s.id);
      for (const base of boards) {
        const g = JSON.parse(JSON.stringify(base));
        g.teamA.hand = [id, 'turnover', 'close_out'];
        if (!canPlayCard(g, 'A', id).canPlay) continue;
        const opts = aiBuildCardOpts(g, 'A', id) ?? {};
        let r;
        expect(() => { r = execCard(g, 'A', id, opts); }, `${id} in ${g.phase}`).not.toThrow();
        if (!r.ok) refused.push(`${id} (${g.phase}${g.timeoutActive ? ', timeout' : ''}): ${r.msg}`);
        else played.add(id);
      }
    }
    expect(refused).toEqual([]);
    expect(played.size).toBeGreaterThan(65);
  });
});

it('every card a run can offer has a "+" text', () => {
  for (const s of STRATS.filter(x => !x.promo && x.rarity !== 'legendary')) expect(PLUS[s.id]?.desc, s.id).toBeTruthy();
});
