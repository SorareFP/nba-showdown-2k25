// SWITCH THE SCREEN IS THE DEFENCE'S CHOICE. The user (2026-10-19): it
// "automatically settles when it should be a user decision on who switches".
// The board had no picker for it, so it sent no pair and the engine fell back
// to the coach's rule (switch the two worst-beaten defenders). Now the board
// asks for the two attackers whose defenders trade, and the engine swaps
// exactly those.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from '../../game/engine.js';
import { CARDS } from '../../game/cards.js';
import { execCard } from '../../game/execCard.js';
import { buildOpts } from './CourtBoard.jsx';

const p = (name, speed, power, salary = 500) => ({ ...CARDS[0], id: name, name, speed, power, salary });

/** A defends; B's five are on the floor, each guarded by A's man in the same slot. */
function defending(hand = ['switch_the_screen']) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'A').starters = [p('A0', 12, 10), p('A1', 14, 8), p('A2', 9, 12), p('A3', 11, 11), p('A4', 10, 9)];
  getTeam(g, 'B').starters = [p('Big', 8, 15), p('Fast', 15, 7), p('Wing', 12, 11), p('Slow', 6, 6), p('Mid', 10, 10)];
  getTeam(g, 'A').hand = hand;
  g.phase = 'scoring'; g.scoringTurn = 'B';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  return g;
}

/** A modal that records every prompt and answers from a script. */
function scripted(answers) {
  const prompts = [];
  const openModal = async config => { prompts.push(config); return answers.length ? answers.shift() : null; };
  return { prompts, openModal, ui: { toast: () => {}, ask: async () => false } };
}

describe('Switch the Screen from the board', () => {
  it('asks for the two attackers to switch, from their five, and swaps exactly those', async () => {
    const g = defending();
    const { prompts, openModal, ui } = scripted([3, 1]);
    const opts = await buildOpts(g, 'A', 'switch_the_screen', {}, openModal, ui);
    expect(prompts).toHaveLength(2);
    for (const pr of prompts) expect(pr.players.map(pl => pl.name)).toEqual(['Big', 'Fast', 'Wing', 'Slow', 'Mid']);
    expect(prompts[0].extraInfo[3]).toMatch(/A3/);          // who guards him now
    expect(prompts[1].extraInfo[0]).toMatch(/If switched/); // what the swap would do
    expect(opts.slots).toEqual([3, 1]);
    const r = execCard(g, 'A', 'switch_the_screen', opts);
    expect(r.ok).toBe(true);
    expect(r.game.offMatchups.B).toEqual([0, 3, 2, 1, 4]);
  });

  it('asks the same of a practiced copy', async () => {
    const g = defending(['switch_the_screen+']);
    const { prompts, openModal, ui } = scripted([0, 4]);
    const opts = await buildOpts(g, 'A', 'switch_the_screen+', {}, openModal, ui);
    expect(prompts).toHaveLength(2);
    expect(opts.slots).toEqual([0, 4]);
  });

  it('will not switch a player with himself, and a cancel plays nothing', async () => {
    const g = defending();
    const again = scripted([2, 2, 0]);
    expect((await buildOpts(g, 'A', 'switch_the_screen', {}, again.openModal, again.ui)).slots).toEqual([2, 0]);
    expect(again.prompts).toHaveLength(3);
    const cancel = scripted([null]);
    expect(await buildOpts(g, 'A', 'switch_the_screen', {}, cancel.openModal, cancel.ui)).toBeNull();
  });
});
