// Two 2026-09-09 play-test rules:
//   - the AI's Coach's Challenge answers a MAKE, never a miss (a re-roll of a
//     miss can only turn it into a make — it did, for three)
//   - Double Team is once per section
import { describe, it, expect, vi } from 'vitest';
import { newGame, getTeam, spendReboundBonus, spendAssist } from './engine.js';
import { execCard } from './execCard.js';
import { canPlayCard } from './canPlay.js';
import { aiScoringDecision, aiReactionDecision } from './ai.js';
import { getStrat } from './strats.js';

const mk = (id, speed = 10, power = 10) => ({
  id, name: id, team: 'TST', pos: 'PG', speed, power, defBoost: 0, salary: 500,
  shotLine: 14, paintBoost: 1, threePtBoost: 1,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
});
const five = pre => Array.from({ length: 5 }, (_, i) => mk(`${pre}${i}`));
const filler = (pre, n) => Array.from({ length: n }, (_, i) => mk(`${pre}f${i}`));

function scoring({ bHand = [] } = {}) {
  const A = five('a'), B = five('b');
  const g = newGame([...A, ...filler('a', 5)], [...B, ...filler('b', 5)]);
  getTeam(g, 'A').starters = A;
  getTeam(g, 'B').starters = B;
  getTeam(g, 'B').hand = bHand;
  g.phase = 'scoring'; g.scoringTurn = 'B'; g.scoringPasses = 0; g.placementStep = 10;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.tempEff = { A: {}, B: {} };
  g.rollResults = { A: [], B: [] };
  return g;
}

describe("the AI's Coach's Challenge", () => {
  const lastCheck = hit => ({ teamKey: 'A', playerIdx: 0, playerId: 'a0', type: '3pt', result: { hit, pts: hit ? 3 : 0, die: 9 }, pts: hit ? 3 : 0, cardLabel: 'x' });

  it('is never spent on a miss', () => {
    const g = scoring({ bHand: ['coaches_challenge'] });
    g.lastShotCheck = lastCheck(false);
    expect(canPlayCard(g, 'B', 'coaches_challenge').canPlay).toBe(true);   // the rule allows it; the coach declines
    expect(aiScoringDecision(g, 'B').type).toBe('pass');
    expect(aiReactionDecision(g, 'B', 'opp_scored')).toBeNull();
  });

  it('is spent on a make', () => {
    const g = scoring({ bHand: ['coaches_challenge'] });
    g.lastShotCheck = lastCheck(true);
    const d = aiScoringDecision(g, 'B');
    expect(d).toMatchObject({ type: 'play_card', cardId: 'coaches_challenge' });
    expect(aiReactionDecision(g, 'B', 'opp_scored')).toMatchObject({ type: 'play_card', cardId: 'coaches_challenge' });
  });

  it('never challenges its own check', () => {
    const g = scoring({ bHand: ['coaches_challenge'] });
    g.lastShotCheck = { ...lastCheck(true), teamKey: 'B' };
    expect(aiScoringDecision(g, 'B').type).toBe('pass');
  });
});

// THE CHECK A CHALLENGE REACHES (the user, 2026-09-18): Mouhamed Gueye's
// Rebound Paint Check went in, and the Challenge re-rolled Kyle Anderson's
// OLDER Bully Ball miss into a make — the spend checks never recorded
// themselves as the latest check. Every route now does (noteLastCheck).
describe("the check a Coach's Challenge reaches", () => {
  const staleMiss = { teamKey: 'B', playerIdx: 1, playerId: 'b1', type: 'paint', result: { hit: false, pts: 0, die: 5, type: 'paint' }, pts: 0, cardLabel: 'Bully Ball paint #2', bonus: -1, pool: 'card' };
  const forced = (g, fn, rand) => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(rand);
    try { return fn(g); } finally { spy.mockRestore(); }
  };

  it('is the Rebound Paint Check that just went in, not an older card miss — and the Challenge takes back its points', () => {
    const g = scoring();
    getTeam(g, 'B').rebounds = 6;
    g.reboundBonuses = { B: { diff: 3, paintCheck: true } };   // B won the last section's glass
    getTeam(g, 'A').hand = ['coaches_challenge'];
    g.lastShotCheck = staleMiss;
    const before = getTeam(g, 'B').score;
    const spent = forced(g, x => spendReboundBonus(x, 'B', 'paint_check', 3), 0.99);   // a 20: in
    expect(spent.ok).toBe(true);
    const made = spent.game;
    expect(getTeam(made, 'B').score).toBe(before + 2);
    expect(made.lastShotCheck).toMatchObject({ teamKey: 'B', playerIdx: 3, cardLabel: 'Rebound Paint Check', pool: 'reboundBonus', pts: 2 });
    expect(made.lastShotCheck.result.hit).toBe(true);
    // The prompt names what is about to be re-rolled.
    made.phase = 'scoring';
    const can = canPlayCard(made, 'A', 'coaches_challenge');
    expect(can.canPlay).toBe(true);
    expect(can.reason ?? can.msg ?? '').toMatch(/b3's Rebound Paint Check \(a make, 2 pts\)/);
    const shotPtsBefore = made.analytics?.B?.shotCheckPts;
    const reb = made.analytics?.B?.reboundBonusPts;
    const ch = forced(made, x => execCard(x, 'A', 'coaches_challenge', {}), 0);           // a 1: out
    expect(ch.ok).toBe(true);
    expect(getTeam(ch.game, 'B').score).toBe(before);                                   // the 2 came off
    expect(ch.game.log.at(-1).msg).toMatch(/Coach's Challenge: b3's Rebound Paint Check re-rolled/);
    expect(ch.game.log.at(-1).msg).not.toMatch(/Bully Ball/);
    if (made.analytics?.B) {
      expect(ch.game.analytics.B.reboundBonusPts).toBe(reb - 2);                        // taken back where it was booked
      expect(ch.game.analytics.B.shotCheckPts).toBe(shotPtsBefore);                     // the card tallies untouched
    }
    expect(ch.game.lastShotCheck).toBeNull();
  });

  it('is the 5-AST 3PT check too, and a challenge of it moves the 3PT line both ways', () => {
    const g = scoring();
    getTeam(g, 'B').assists = 6;
    g.lastShotCheck = staleMiss;
    const spent = forced(g, x => spendAssist(x, 'B', '3pt', 2), 0.99);
    expect(spent.ok).toBe(true);
    expect(spent.game.lastShotCheck).toMatchObject({ teamKey: 'B', playerIdx: 2, type: '3pt', pool: 'assistSpend', pts: 3 });
    const ps = s => s.find(x => x.id === 'b2');
    expect(ps(getTeam(spent.game, 'B').stats)).toMatchObject({ threepa: 1, threepm: 1 });
    getTeam(spent.game, 'A').hand = ['coaches_challenge'];
    spent.game.phase = 'scoring';
    const ch = forced(spent.game, x => execCard(x, 'A', 'coaches_challenge', {}), 0);
    expect(ch.ok).toBe(true);
    expect(ps(getTeam(ch.game, 'B').stats)).toMatchObject({ threepa: 1, threepm: 0 });  // one attempt, now a miss
  });

  it('is written by every route that rolls a check', async () => {
    const { readFileSync } = await import('node:fs');
    // Every line that rolls a check in the two files is followed, within a
    // few lines, by a noteLastCheck — the Challenge's own re-roll excepted.
    // A fifth route that forgets it fails here by name.
    const missing = [];
    for (const file of ['./engine.js', './execCard.js']) {
      const lines = readFileSync(new URL(file, import.meta.url), 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (!/(?:_shotCheck|\bshotCheck)\(/.test(code)) return;
        if (/function shotCheck|const _shotCheck|lsc\.type/.test(code)) return; // definitions; the re-roll itself
        // The wrapper's body — a few lines since it learned to write a
        // preview's check down instead of rolling it (cardPreview.js).
        if (lines.slice(Math.max(0, i - 8), i).some(l => /const _shotCheck/.test(l))) return;
        // Up to the next roll (or 60 lines): applyShotCheck notes its check at the end.
        let end = i + 1;
        while (end < lines.length && end < i + 60 && !/(?:_shotCheck|\bshotCheck)\(/.test(lines[end].replace(/\/\/.*$/, ''))) end += 1;
        if (!/noteLastCheck\(/.test(lines.slice(i, end).join('\n'))) missing.push(`${file}:${i + 1}`);
      });
    }
    expect(missing).toEqual([]);
  });
});

describe('Double Team', () => {
  it('is once per section, and the card says so', () => {
    expect(getStrat('double_team').desc).toMatch(/Once per section/);
    const g = scoring({ bHand: ['double_team', 'double_team'] });
    expect(canPlayCard(g, 'B', 'double_team').canPlay).toBe(true);
    const r = execCard(g, 'B', 'double_team', { targetIdx: 0, playerIdx: 0 });
    expect(r.ok).toBe(true);
    expect(r.game.tempEff.B.doubleTeamUsed).toBe(true);
    const again = canPlayCard(r.game, 'B', 'double_team');
    expect(again.canPlay).toBe(false);
    expect(again.reason ?? again.msg ?? '').toMatch(/once per section/i);
    expect(execCard(r.game, 'B', 'double_team', { targetIdx: 1, playerIdx: 1 }).ok).toBe(false);
  });
});
