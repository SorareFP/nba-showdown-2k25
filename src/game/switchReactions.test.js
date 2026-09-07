// Overhelp and Burned on the Switch answer a DEFENSIVE switch — the card text.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, endSection, burnedSlots, recordDefSwitch } from './engine.js';
import { CARDS } from './cards.js';
import { canPlayCard } from './canPlay.js';
import { execCard } from './execCard.js';
import { aiBuildCardOpts, switchEverythingChanges, aiSetMatchups } from './ai.js';

const p = (name, speed, power, salary = 500) => ({ ...CARDS[0], id: name, name, speed, power, salary });

function game() {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'A').starters = [p('A0', 12, 10), p('A1', 14, 8, 900), p('A2', 9, 12), p('A3', 11, 11), p('A4', 10, 9)];
  getTeam(g, 'B').starters = [p('Big', 8, 15), p('Fast', 15, 7), p('Wing', 12, 11), p('Slow', 6, 6), p('Mid', 10, 10)];
  getTeam(g, 'A').hand = ['high_screen_roll', 'overhelp', 'burned_switch'];
  getTeam(g, 'B').hand = ['veer_switch', 'switch_everything', 'overhelp', 'burned_switch'];
  g.phase = 'matchup_strats'; g.placementStep = 10; g.matchupTurn = 'A';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  return g;
}

describe('a defensive switch is recorded', () => {
  it('Switch Everything leaves the changed slots, and Burned reads which got weaker', () => {
    const g = game();
    g.phase = 'scoring'; g.scoringTurn = 'B';
    // B guards A: slot 1 (A1, guarded by Fast 15/7) now gets Slow (6/6); slot 0 gets Fast.
    const r = execCard(g, 'B', 'switch_everything', { assignments: [1, 3, 2, 0, 4] });
    expect(r.ok).toBe(true);
    const sw = r.game.lastDefSwitch;
    expect(sw.teamKey).toBe('B');
    expect(sw.changes.map(c => c.slot)).toEqual([0, 1, 3]);
    // slot 0: Big (8/15) -> Fast (15/7): power fell -> burned. slot 1: Fast -> Slow: burned.
    // slot 3: Slow (6/6) -> Big (8/15): better on both -> not burned.
    expect(burnedSlots(r.game, sw)).toEqual([0, 1]);
  });

  it('nothing is recorded when the assignment changes nothing', () => {
    expect(recordDefSwitch('B', 'switch_everything', [0, 1, 2, 3, 4], [0, 1, 2, 3, 4])).toBeNull();
  });
});

describe('the offence answers', () => {
  function afterSwitch() {
    const g = game();
    g.phase = 'scoring'; g.scoringTurn = 'B';
    return execCard(g, 'B', 'switch_everything', { assignments: [1, 3, 2, 0, 4] }).game;
  }

  it('Overhelp and Burned light for A, not for B, and not before any switch', () => {
    expect(canPlayCard(game(), 'A', 'overhelp').canPlay).toBe(false);
    expect(canPlayCard(game(), 'A', 'burned_switch').canPlay).toBe(false);
    const g = afterSwitch();
    expect(canPlayCard(g, 'A', 'overhelp').canPlay).toBe(true);
    expect(canPlayCard(g, 'A', 'burned_switch').canPlay).toBe(true);
    expect(canPlayCard(g, 'B', 'overhelp').canPlay).toBe(false);
    expect(canPlayCard(g, 'B', 'burned_switch').canPlay).toBe(false);
  });

  it('Burned pays +3 on a burned slot only, and the AI picks one the engine accepts', () => {
    const g = afterSwitch();
    const bad = execCard(g, 'A', 'burned_switch', { playerIdx: 3 });   // slot 3 got a BETTER defender
    expect(bad.ok).toBe(true);                                           // falls back to the first burned slot
    expect(bad.game.tempEff.A.r0).toBe(3);
    const opts = aiBuildCardOpts(g, 'A', 'burned_switch');
    expect([0, 1]).toContain(opts.playerIdx);
    const ai = execCard(g, 'A', 'burned_switch', opts);
    expect(ai.ok).toBe(true);
    expect(ai.game.tempEff.A['r' + opts.playerIdx]).toBe(3);
    // Consumed: the same switch cannot be answered twice.
    expect(canPlayCard(ai.game, 'A', 'overhelp').canPlay).toBe(false);
  });

  it('Burned stays dark when every new defender is at least as good', () => {
    const g = game();
    g.phase = 'scoring'; g.scoringTurn = 'B';
    // slot 3: Slow (6/6) -> Big (8/15); slot 0: Big -> Slow... make only slot 3 change for the better.
    const r = execCard(g, 'B', 'switch_everything', { assignments: [0, 1, 2, 4, 3] }); // Mid (10/10) on slot 3, Slow on 4
    // slot 3: Slow -> Mid: better; slot 4: Mid -> Slow: burned. So use a case with no burn:
    const g2 = game();
    g2.phase = 'scoring'; g2.scoringTurn = 'B';
    getTeam(g2, 'B').starters[4] = p('Twin', 10, 10); // slot 4 swap Mid<->Twin is a wash
    const r2 = execCard(g2, 'B', 'switch_everything', { assignments: [0, 1, 2, 3, 4] });
    expect(r2.game.lastDefSwitch).toBeNull();
    expect(canPlayCard(r.game, 'A', 'burned_switch').canPlay).toBe(true);
    expect(canPlayCard(r2.game, 'A', 'burned_switch').canPlay).toBe(false);
    expect(canPlayCard(r2.game, 'A', 'overhelp').canPlay).toBe(false);
  });

  it('a Veer Switch records what it switched away from — the screened matchup', () => {
    const g = game();
    const hsr = execCard(g, 'A', 'high_screen_roll', { swapSlot1: 0, swapSlot2: 1 });
    expect(hsr.ok).toBe(true);
    // The screen put Fast (1) on A0 and Big (0) on A1. B keeps its original
    // pairing — the veer's "keep" — which switches both men back.
    const veer = execCard(hsr.game, 'B', 'veer_switch', { veerSwap: false });
    expect(veer.ok).toBe(true);
    const sw = veer.game.lastDefSwitch;
    expect(sw.cardId).toBe('veer_switch');
    expect(sw.changes).toEqual([{ slot: 0, origD: 1, newD: 0 }, { slot: 1, origD: 0, newD: 1 }]);
    // A0: Fast (15/7) -> Big (8/15), speed fell; A1: Big -> Fast, power fell. Both burned.
    expect(burnedSlots(veer.game, sw)).toEqual([0, 1]);
    expect(canPlayCard(veer.game, 'A', 'burned_switch').canPlay).toBe(true);
  });

  it('the record does not outlive the section', () => {
    const g = afterSwitch();
    expect(endSection(g).lastDefSwitch).toBeNull();
  });
});

describe('the AI does not Switch Everything into the defence it already has', () => {
  it('sees no change once the optimum is on the floor, and a change after a screen', () => {
    const g = game();
    g.phase = 'scoring'; g.scoringTurn = 'B';
    g.offMatchups.A = aiSetMatchups(g, 'B').matchups;        // B's optimum already applied
    expect(switchEverythingChanges(g, 'B')).toBe(false);
    const screened = { ...g, offMatchups: { ...g.offMatchups, A: [...g.offMatchups.A].reverse() } };
    expect(switchEverythingChanges(screened, 'B')).toBe(true);
    // And the option it builds is what execCard reads: `assignments`.
    expect(aiBuildCardOpts(screened, 'B', 'switch_everything').assignments).toHaveLength(5);
  });
});

describe('Veer Switch moves only the two screened defenders', () => {
  function screened() {
    const g = game();
    return execCard(g, 'A', 'high_screen_roll', { swapSlot1: 0, swapSlot2: 1 }).game;
  }
  it('refuses a third defender', () => {
    const r = execCard(screened(), 'B', 'veer_switch', { newDefender1: 3, newDefender2: 0 });
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/two defenders in the screen/);
  });
  it('accepts keep and trade, and nothing else moves', () => {
    const keep = execCard(screened(), 'B', 'veer_switch', { veerSwap: false }).game;
    expect(keep.offMatchups.A.slice(0, 2)).toEqual([0, 1]);
    const trade = execCard(screened(), 'B', 'veer_switch', { veerSwap: true }).game;
    expect(trade.offMatchups.A.slice(0, 2)).toEqual([1, 0]);
    expect(trade.offMatchups.A.slice(2)).toEqual([2, 3, 4]);
  });
  it('the AI picks one of the two legal arrangements', () => {
    const g = screened();
    const opts = aiBuildCardOpts(g, 'B', 'veer_switch');
    expect(typeof opts.veerSwap).toBe('boolean');
    expect(execCard(g, 'B', 'veer_switch', opts).ok).toBe(true);
  });
});
