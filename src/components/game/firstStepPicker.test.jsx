// FIRST STEP CHOOSES ITS PLAYER (2026-10-20). The user: "First step does not
// allow you to actually choose a player. It just assigns it to the first
// player." The board had a picker for Power Move and none for its Speed twin,
// so no player was sent and the engine took slot 0.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from '../../game/engine.js';
import { CARDS } from '../../game/cards.js';
import { execCard } from '../../game/execCard.js';
import { buildOpts } from './CourtBoard.jsx';

const p = (name, speed, power) => ({ ...CARDS[0], id: name, name, speed, power, salary: 500 });

function scoring(hand) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'A').starters = [p('A0', 10, 10), p('A1', 12, 8), p('A2', 9, 12), p('A3', 11, 11), p('A4', 10, 9)];
  getTeam(g, 'B').starters = [p('B0', 10, 10), p('B1', 10, 10), p('B2', 10, 10), p('B3', 10, 10), p('B4', 10, 10)];
  getTeam(g, 'A').hand = hand;
  g.phase = 'scoring'; g.scoringTurn = 'A';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.rollResults = { A: [], B: [] };
  return g;
}
function scripted(answers) {
  const prompts = [];
  const openModal = async config => { prompts.push(config); return answers.length ? answers.shift() : null; };
  return { prompts, openModal, ui: { toast: () => {}, ask: async () => false } };
}

describe('First Step from the board', () => {
  it('asks which player, among those still to roll, and gives that one the Speed', async () => {
    const g = scoring(['first_step']);
    g.rollResults.A[0] = { pts: 2 };   // A0 has rolled: not offered
    const { prompts, openModal, ui } = scripted([2]);   // the third offered: A3
    const opts = await buildOpts(g, 'A', 'first_step', {}, openModal, ui);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].players.map(pl => pl.name)).toEqual(['A1', 'A2', 'A3', 'A4']);
    expect(opts.playerIdx).toBe(3);
    const r = execCard(g, 'A', 'first_step', opts);
    expect(r.ok, r.msg).toBe(true);
    expect(r.game.tempEff.A.s3).toBe(2);
    expect(r.game.tempEff.A.s0).toBeUndefined();
  });

  it('a practiced copy asks too, and prints its own +4', async () => {
    const g = scoring(['first_step+']);
    const { prompts, openModal, ui } = scripted([1]);
    const opts = await buildOpts(g, 'A', 'first_step+', {}, openModal, ui);
    expect(prompts[0].extraInfo[1]).toMatch(/Speed \+2 → \+6/);
    expect(opts.playerIdx).toBe(1);
  });

  it('the engine refuses a player who has rolled, rather than boosting slot 0', () => {
    const g = scoring(['first_step', 'power_move']);
    g.rollResults.A[2] = { pts: 1 };
    expect(execCard(g, 'A', 'first_step', { playerIdx: 2 }).ok).toBe(false);
    expect(execCard(g, 'A', 'power_move', { playerIdx: 2 }).ok).toBe(false);
  });

  // Found beside it: Point God said "Choose a player" and had no picker either.
  it('Point God asks too, offering only players with a Speed edge still to roll', async () => {
    const g = scoring(['point_god']);
    const { prompts, openModal, ui } = scripted([1]);
    const opts = await buildOpts(g, 'A', 'point_god', {}, openModal, ui);
    const names = prompts[0].players.map(pl => pl.name);
    expect(names).toContain('A1');
    expect(names).not.toContain('A0');   // Speed 10 against 10: no edge
    const pick = prompts[0].players[1];
    const r = execCard(g, 'A', 'point_god', opts);
    expect(r.ok, r.msg).toBe(true);
    expect(r.game.tempEff.A[`ast2${opts.playerIdx}`]).toBe(1);
    expect(getTeam(r.game, 'A').starters[opts.playerIdx].name).toBe(pick.name);
  });
});
