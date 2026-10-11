// PICK UP FULL COURT, ONCE A PLAYER A SECTION (the user, 2026-10-11: "Pick
// up full-court should not be able to be played on the same player twice in
// a session"). The section's effects clear at its end, so the same player can
// be hounded again in the next one — Green Light's rule.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, getPS, endSection } from './engine.js';
import { canPlayCard, pickUpTargets } from './canPlay.js';
import { execCard } from './execCard.js';
import { aiBuildCardOpts } from './ai.js';
import { CARDS } from './cards.js';

const p = (name, over = {}) => ({
  ...CARDS[0], id: name, name, speed: 10, power: 10, defBoost: 0, salary: 500,
  threePtBoost: 0, paintBoost: 0, shotLine: 15, pos: 'F', ...over,
});
function game() {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  for (const k of ['A', 'B']) {
    getTeam(g, k).starters = [0, 1, 2, 3, 4].map(i => p(`${k}${i}`));
    for (const s of getTeam(g, k).starters) getTeam(g, k).stats.push({ id: s.id, pts: 0, reb: 0, ast: 0, minutes: 0 });
  }
  getTeam(g, 'A').hand = ['pick_up_full_court', 'pick_up_full_court'];
  g.phase = 'matchup_strats';
  g.placementStep = 10;
  g.matchupTurn = 'A';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.rollResults = { A: [], B: [] };
  g.tempEff = {}; g.tempDefEff = {};
  return g;
}
const hound = (g, idx) => {
  const r = execCard(g, 'A', 'pick_up_full_court', { targetIdx: idx });
  if (r.ok) r.game.matchupTurn = 'A';   // keep it A's turn for the next try
  return r;
};

describe('Pick Up Full Court, once a player a section', () => {
  it('refuses a second press on the same player', () => {
    const once = hound(game(), 2);
    expect(once.ok).toBe(true);
    expect(getPS(once.game, 'B', 'B2').minutes).toBe(4);
    const twice = hound(once.game, 2);
    expect(twice.ok).toBe(false);
    expect(twice.msg).toMatch(/already been hounded this section/);
    expect(pickUpTargets(once.game, 'A')).toEqual([0, 1, 3, 4]);
  });

  it('still lets you press someone else', () => {
    const once = hound(game(), 2);
    expect(hound(once.game, 3).ok).toBe(true);
  });

  it('is not playable once all five have been hounded', () => {
    let g = game();
    getTeam(g, 'A').hand = Array(6).fill('pick_up_full_court');
    for (const i of [0, 1, 2, 3, 4]) g = hound(g, i).game;
    expect(canPlayCard(g, 'A', 'pick_up_full_court').canPlay).toBe(false);
  });

  it('the coach picks only someone not hounded yet', () => {
    let g = game();
    for (const i of [0, 1, 2, 3]) g = hound(g, i).game;
    const opts = aiBuildCardOpts(g, 'A', 'pick_up_full_court');
    expect(opts.targetIdx).toBe(4);
  });

  it('comes back at the next section', () => {
    const once = hound(game(), 2);
    const next = endSection({ ...once.game, phase: 'scoring' });
    // The next placement puts the same five back out.
    getTeam(next, 'B').starters = getTeam(once.game, 'B').starters;
    expect(pickUpTargets(next, 'A')).toContain(2);
  });
});
