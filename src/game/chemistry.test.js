// CHEMISTRY — the first Climb-only card (2026-10-19, approved "Go for it" from
// docs/plans/2026-10-19-the-climb-scaling-draft.md): "Stays in play this game:
// each screen card you play gives your next scoring roll +1 more than the
// last: +1, then +2, then +3."
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, doRoll, scoringRollModifier, buildDeck } from './engine.js';
import { execCard } from './execCard.js';
import { canPlayCard } from './canPlay.js';
import { STRATS, STRAT_MAP, SCREEN_CARDS } from './strats.js';
import { getStratsByRarity } from './rarity.js';
import { stratOffer } from './modes/run.js';
import { leanOf } from './modes/climbKits.js';
import { climbRng } from './modes/climbMap.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 12, power: 12,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 1, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
function board() {
  const roster = p => Array.from({ length: 5 }, (_, i) => mk(`${p}${i}`));
  const g = newGame(roster('a'), roster('b'));
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.phase = 'matchup_strats';
  g.matchupTurn = 'A';
  g.scoringTurn = 'A';
  for (const t of [g.teamA, g.teamB]) { t.assists = 6; t.rebounds = 6; }
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

describe('Chemistry', () => {
  it('is a Climb-only uncommon, set up in the matchup on your turn, once a game', () => {
    expect(STRAT_MAP.chemistry).toMatchObject({ climbOnly: true, rarity: 'uncommon', side: 'off' });
    const g = board();
    g.teamA.hand = ['chemistry'];
    expect(canPlayCard(g, 'A', 'chemistry').canPlay).toBe(true);
    g.phase = 'scoring';
    expect(canPlayCard(g, 'A', 'chemistry').canPlay).toBe(false);
    const after = play(board(), 'A', 'chemistry');
    after.teamA.hand = ['chemistry'];
    expect(canPlayCard(after, 'A', 'chemistry').canPlay).toBe(false);
  });

  it('counts the screens: +1, then +2, on the next roll, which spends it', () => {
    let g = play(board(), 'A', 'chemistry');
    g = play(g, 'A', 'high_screen_roll', { swapSlot1: 0, swapSlot2: 1 });
    expect(g.chem.A).toEqual({ count: 1, pending: 1 });
    g = play(g, 'A', 'high_screen_roll', { swapSlot1: 2, swapSlot2: 3 });
    expect(g.chem.A).toEqual({ count: 2, pending: 2 });
    // The readout carries it, on every roll it could land on.
    expect(scoringRollModifier(g, 'A', 4).chem).toBe(2);
    g.phase = 'scoring';
    const before = scoringRollModifier(g, 'A', 4).total;
    const rolled = doRoll(g, 'A', 4);
    expect(rolled.chem.A.pending).toBe(0);
    expect(rolled.chem.A.count).toBe(2);
    const line = rolled.log.find(l => /a4 🎲/.test(l.msg));
    expect(line.msg).toContain(`${before > 0 ? '+' : ''}${before}=`);
  });

  it('does nothing before it is played, and counts only the offence\'s screens', () => {
    const g = play(board(), 'A', 'high_screen_roll', { swapSlot1: 0, swapSlot2: 1 });
    expect(g.chem?.A).toBeUndefined();
    expect(scoringRollModifier(g, 'A', 0).chem).toBe(0);
    expect(SCREEN_CARDS).not.toContain('switch_the_screen');
    for (const id of SCREEN_CARDS) expect(STRAT_MAP[id], id).toBeTruthy();
  });

  it('loses the step a cancelled screen gave (Go Under)', () => {
    let g = play(board(), 'A', 'chemistry');
    g = play(g, 'A', 'high_screen_roll', { swapSlot1: 0, swapSlot2: 1 });
    g.matchupTurn = 'B';
    g.teamB.hand = ['go_under', 'turnover'];
    const r = execCard(g, 'B', 'go_under', {});
    expect(r.ok, r.msg).toBe(true);
    expect(r.game.chem.A).toEqual({ count: 0, pending: 0 });
  });

  it('never reaches a pack, a rarity list or the default deck', () => {
    expect(getStratsByRarity('uncommon').some(s => s.id === 'chemistry')).toBe(false);
    expect(buildDeck().includes('chemistry')).toBe(false);
  });

  it('is offered from the reward\'s "anywhere" slot some of the time, and not once it is in the deck', () => {
    const run = { playbook: 'speed', deck: { catch_and_shoot: 2 } };
    const stop = { kind: 'game', floor: 2 };
    let seen = 0;
    let chem = 0;
    for (let i = 0; i < 120; i += 1) {
      const o = stratOffer(run, stop, climbRng(i, 'offers'), climbRng(i, 'climb-only'));
      const own = o.filter(id => STRAT_MAP[id].climbOnly);
      if (own.length) {
        seen += 1;
        expect(o[2]).toBe(own[0]);
        // Your playbook's own, or one for any playbook: never Paint's or Defense's.
        expect([null, 'speed']).toContain(leanOf(own[0]));
      }
      if (o.includes('chemistry')) chem += 1;
    }
    expect(seen).toBeGreaterThan(20);
    expect(seen).toBeLessThan(70);
    expect(chem).toBeGreaterThan(0);
    const holding = { ...run, deck: { ...run.deck, chemistry: 1 } };
    for (let i = 0; i < 30; i += 1) expect(stratOffer(holding, stop, climbRng(i, 'offers'), climbRng(i, 'climb-only'))).not.toContain('chemistry');
    expect(STRATS.filter(s => s.climbOnly).length).toBe(9);
  });
});
