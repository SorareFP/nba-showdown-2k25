// The board's side of answering a defensive switch.
//
// The user (2026-09-10), after the coach played Switch Everything: Burned on
// the Switch said "there's no switch to react to". The engine was right — it
// reads lastDefSwitch, which Switch Everything records, and it lit the card —
// but the board's option builder prompted a SECOND time from an old block
// that checked lastMatchupCard, the offensive screen record, which a
// defensive switch never sets. It toasted and cancelled. Overhelp had the
// same leftover second prompt, over all five starters and labelled "+2".
//
// buildOpts routes every prompt through `openModal`, so these count them.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, burnedSlots } from '../../game/engine.js';
import { CARDS } from '../../game/cards.js';
import { execCard } from '../../game/execCard.js';
import { canPlayCard } from '../../game/canPlay.js';
import { buildOpts } from './CourtBoard.jsx';

const p = (name, speed, power, salary = 500) => ({ ...CARDS[0], id: name, name, speed, power, salary });

/** B (the coach) has just played Switch Everything; A holds both answers. */
function afterSwitchEverything() {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'A').starters = [p('A0', 12, 10), p('A1', 14, 8, 900), p('A2', 9, 12), p('A3', 11, 11), p('A4', 10, 9)];
  getTeam(g, 'B').starters = [p('Big', 8, 15), p('Fast', 15, 7), p('Wing', 12, 11), p('Slow', 6, 6), p('Mid', 10, 10)];
  getTeam(g, 'A').hand = ['overhelp', 'burned_switch'];
  getTeam(g, 'B').hand = ['switch_everything'];
  g.phase = 'scoring'; g.scoringTurn = 'B';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  const r = execCard(g, 'B', 'switch_everything', { assignments: [1, 3, 2, 0, 4] });
  expect(r.ok).toBe(true);
  return r.game;
}

/** A modal that records every prompt and answers with its first option. */
function recorder() {
  const prompts = [];
  const toasts = [];
  const openModal = async config => { prompts.push(config); return 0; };
  const ui = { toast: msg => toasts.push(msg), ask: async () => false };
  return { prompts, toasts, openModal, ui };
}

describe('answering a defensive switch from the board', () => {
  it('the switch left no offensive screen record — the thing the old block checked', () => {
    const g = afterSwitchEverything();
    expect(g.lastDefSwitch).not.toBeNull();
    expect(g.lastMatchupCard ?? null).toBeNull();
    expect(canPlayCard(g, 'A', 'burned_switch').canPlay).toBe(true);
  });

  it('Burned on the Switch prompts once, offers only the players who drew a weaker defender, and plays', async () => {
    const g = afterSwitchEverything();
    const { prompts, toasts, openModal, ui } = recorder();
    const opts = await buildOpts(g, 'A', 'burned_switch', {}, openModal, ui);
    expect(toasts).toEqual([]);
    expect(opts).not.toBeNull();
    expect(prompts).toHaveLength(1);
    const burned = burnedSlots(g, g.lastDefSwitch);
    expect(prompts[0].players.map(pl => pl.name)).toEqual(burned.map(i => getTeam(g, 'A').starters[i].name));
    expect(opts.playerIdx).toBe(burned[0]);
    const r = execCard(g, 'A', 'burned_switch', opts);
    expect(r.ok).toBe(true);
    expect(r.game.tempEff.A['r' + burned[0]]).toBe(3);
  });

  it('Overhelp prompts once, at +3, among players yet to roll, and plays', async () => {
    const g = afterSwitchEverything();
    g.rollResults.A = [{ pts: 2 }];                     // slot 0 has rolled
    const { prompts, toasts, openModal, ui } = recorder();
    const opts = await buildOpts(g, 'A', 'overhelp', {}, openModal, ui);
    expect(toasts).toEqual([]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].label).toMatch(/\+3/);
    expect(prompts[0].players.map(pl => pl.name)).toEqual(['A1', 'A2', 'A3', 'A4']);
    expect(opts.playerIdx).toBe(1);
    const r = execCard(g, 'A', 'overhelp', opts);
    expect(r.ok).toBe(true);
    expect(r.game.tempEff.A.r1).toBe(3);
  });
});
