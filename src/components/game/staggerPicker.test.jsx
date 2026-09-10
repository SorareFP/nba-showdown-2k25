// Stagger Action's two picks on the board. The user (2026-09-10): "Sometimes
// stagger action just won't fire after selecting a second player." The engine
// takes every pair the board offers; what could go quiet was the board — the
// only 3PT shooter offered as the Speed half left the second list empty, and
// the picker cancelled with no word.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from '../../game/engine.js';
import { CARDS } from '../../game/cards.js';
import { execCard } from '../../game/execCard.js';
import { buildOpts } from './CourtBoard.jsx';

const p = (name, speed, threePtBoost) => ({ ...CARDS[0], id: name, name, speed, threePtBoost });

function board(starters) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'A').starters = starters;
  getTeam(g, 'B').starters = CARDS.slice(10, 15);
  getTeam(g, 'A').hand = ['stagger_action'];
  g.phase = 'matchup_strats'; g.placementStep = 10; g.matchupTurn = 'A';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.tempEff = { A: {}, B: {} };
  return g;
}
function recorder(answer = () => 0) {
  const prompts = [];
  const toasts = [];
  const openModal = async config => { prompts.push(config); return answer(config, prompts.length); };
  return { prompts, toasts, openModal, ui: { toast: m => toasts.push(m), ask: async () => false } };
}

describe('Stagger Action on the board', () => {
  it('never offers the only shooter as the Speed half, so the second list is never empty', () => {
    // Slot 0 is fast AND the only shooter; slot 1 is fast with no 3PT Bonus.
    const g = board([p('FastShooter', 14, 2), p('FastOnly', 15, 0), p('Big', 6, 0), p('Wing', 9, 0), p('Guard', 10, -1)]);
    const r = recorder();
    return buildOpts(g, 'A', 'stagger_action', {}, r.openModal, r.ui).then(opts => {
      expect(r.prompts[0].players.map(x => x.id)).toEqual(['FastOnly']);
      expect(r.prompts[1].players.map(x => x.id)).toEqual(['FastShooter']);
      expect(opts).toMatchObject({ playerIdx: 1, player2Idx: 0 });
      expect(execCard(g, 'A', 'stagger_action', opts).ok).toBe(true);
      expect(r.toasts).toEqual([]);
    });
  });

  it('says so instead of going quiet when no pair exists', async () => {
    const g = board([p('FastShooter', 14, 2), p('Big', 6, 0), p('Wing', 9, 0), p('Guard', 10, 0), p('C', 5, 0)]);
    const r = recorder();
    expect(await buildOpts(g, 'A', 'stagger_action', {}, r.openModal, r.ui)).toBeNull();
    expect(r.prompts).toHaveLength(0);
    expect(r.toasts[0]).toMatch(/Stagger Action needs/);
  });
});
