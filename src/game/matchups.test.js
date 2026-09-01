import { describe, it, expect } from 'vitest';
import { newGame, applyMatchups, doRoll, endSection } from './engine.js';
import { aiSetMatchups, aiTurn } from './ai.js';

/** Five cards distinguishable by their attributes, so a mis-assignment shows. */
const card = (id, speed, power, extra = {}) => ({
  id, name: id, team: 'XXX', speed, power,
  shotLine: 14, paintBoost: 0, threePtBoost: 0, defBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 }, { lo: 3, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...extra,
});
const roster = prefix =>
  Array.from({ length: 10 }, (_, i) => card(`${prefix}${i}`, 5 + i, 20 - i));

function started() {
  const g = newGame(roster('a'), roster('b'), null, null);
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.phase = 'matchup_strats';
  return g;
}

describe('applyMatchups', () => {
  it('writes the OPPONENT\'s array, because that is the one doRoll reads', () => {
    // THE INVERSION THIS EXISTS TO GET RIGHT. doRoll(g, teamKey, idx) looks up
    // `offMatchups[teamKey][idx]` and indexes the OPPOSING bench with it. So the
    // team choosing how to DEFEND is writing the attacking team's array. Setting
    // its own would rearrange who guards ITS attackers and still look plausible.
    const g = applyMatchups(started(), 'B', [4, 3, 2, 1, 0]);
    expect(g.offMatchups.A).toEqual([4, 3, 2, 1, 0]);
    expect(g.offMatchups.B).toEqual([0, 1, 2, 3, 4]); // untouched
  });

  it('actually changes who a scoring roll is resolved against', () => {
    const base = started();
    // A's slot 0 (speed 5, power 20) normally faces B's slot 0.
    const before = doRoll(base, 'A', 0);
    const after = doRoll(applyMatchups(base, 'B', [4, 1, 2, 3, 0]), 'A', 0);
    const named = g => g.log[g.log.length - 1].msg;
    expect(named(before)).not.toBe(named(after));
  });

  it('marks the DEFENDER as having chosen, and endSection clears it', () => {
    const g = applyMatchups(started(), 'B', [1, 0, 2, 3, 4]);
    expect(g.matchupsSet.B).toBe(true);
    expect(g.matchupsSet.A).toBeUndefined();
    expect(endSection(g).matchupsSet).toEqual({});
  });

  it('ignores an empty assignment rather than blanking the mapping', () => {
    const g = started();
    expect(applyMatchups(g, 'B', []).offMatchups).toEqual(g.offMatchups);
    expect(applyMatchups(g, 'B', null).offMatchups).toEqual(g.offMatchups);
  });
});

describe('the AI assigns defence', () => {
  it('returns a matchup assignment before it considers cards', () => {
    // The regression this guards: aiSetMatchups existed from the start and was
    // reachable only from the `switch_everything` card, so an AI team left the
    // identity mapping in place every section and guarded whoever shared its
    // slot index. Worth ~13 points per team per game.
    const action = aiTurn(started(), 'B');
    expect(action?.type).toBe('set_matchups');
    expect(action.matchups).toHaveLength(5);
    expect([...action.matchups].sort()).toEqual([0, 1, 2, 3, 4]); // a permutation
  });

  it('does not assign twice in one section', () => {
    const g = applyMatchups(started(), 'B', aiSetMatchups(started(), 'B').matchups);
    const next = aiTurn(g, 'B');
    expect(next?.type).not.toBe('set_matchups');
  });
});
