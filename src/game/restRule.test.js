// TWELVE STRAIGHT IS THE LIMIT.
//
// The user, 2026-09-16: "AI is now playing Shai at fatigue -12 and he is
// getting shut out because he's played the opening 20 minutes of the game.
// That's not just negative EV, it's not really realistic. Guys will play 12
// minutes straight max, even in playoff games. Maybe they'd play the last 12
// minutes of the game and consecutive OT periods in the playoffs."
//
// Before this the board printed "MUST REST" at sixteen minutes and nothing
// enforced it — for the coach or for a person — and the rulebook said the
// penalty "does not stop". Now it is a rule of the game, the coach lives by
// it at every rung, and the fourth quarter and overtime lift it.
import { describe, it, expect } from 'vitest';
import {
  newGame, getTeam, getPS, STARTERS, MAX_STRAIGHT_MINUTES, mustRest, restRuleLifted, pickablePool,
} from './engine.js';
import * as ai from './ai.js';
const { aiDraftPick } = ai;
import { simulateGame } from './modes/simulate.js';
import { CARDS } from './cards.js';

const at = (g, quarter, section, overtime = 0) => ({ ...g, quarter, section, overtime });
const withMinutes = (g, key, id, minutes) => {
  const ps = getPS(g, key, id);
  ps.minutes = minutes;
  return g;
};

describe('mustRest', () => {
  const fresh = () => newGame(CARDS.slice(0, 10), CARDS.slice(20, 30), null, null);

  it('benches a player at twelve minutes in the first three quarters', () => {
    const g = withMinutes(fresh(), 'A', CARDS[0].id, MAX_STRAIGHT_MINUTES);
    for (const [q, s] of [[1, 1], [2, 3], [3, 1], [3, 3]]) {
      expect(mustRest(at(g, q, s), 'A', CARDS[0]), `Q${q} S${s}`).toBe(true);
    }
    expect(mustRest(at(g, 3, 3), 'A', CARDS[1])).toBe(false);          // 0 minutes
    expect(mustRest(at(withMinutes(fresh(), 'A', CARDS[0].id, 8), 1, 2), 'A', CARDS[0])).toBe(false);
  });

  it('lifts for the fourth quarter and every overtime', () => {
    const g = withMinutes(fresh(), 'A', CARDS[0].id, 20);
    expect(restRuleLifted(at(g, 4, 1))).toBe(true);
    expect(restRuleLifted(at(g, 4, 3, 2))).toBe(true);
    expect(restRuleLifted(at(g, 3, 3))).toBe(false);
    expect(mustRest(at(g, 4, 1), 'A', CARDS[0])).toBe(false);
    expect(mustRest(at(g, 4, 3, 1), 'A', CARDS[0])).toBe(false);
  });
});

describe('pickablePool', () => {
  it('drops the benched while five remain, and bends when they do not', () => {
    const g = newGame(CARDS.slice(0, 10), CARDS.slice(20, 30), null, null);
    const pool = getTeam(g, 'A').roster;
    // Three at the limit: seven rested, the three come out.
    for (const c of pool.slice(0, 3)) withMinutes(g, 'A', c.id, 12);
    const rested = pickablePool(at(g, 2, 1), 'A', pool);
    expect(rested).toHaveLength(7);
    expect(rested.some(p => pool.slice(0, 3).includes(p))).toBe(false);
    // Six at the limit: four rested, so the rule bends — everyone stays in,
    // least-tired first, and a five can be named.
    for (const c of pool.slice(3, 6)) withMinutes(g, 'A', c.id, 16);
    const bent = pickablePool(at(g, 2, 1), 'A', pool);
    expect(bent).toHaveLength(10);
    expect(bent.slice(0, 4).every(p => (getPS(g, 'A', p.id)?.minutes || 0) === 0)).toBe(true);
    expect(bent.length).toBeGreaterThanOrEqual(STARTERS);
  });
});

describe('the coach obeys it at every rung', () => {
  it('never names a benched player outside the fourth quarter', () => {
    const g = newGame(CARDS.slice(0, 10), CARDS.slice(20, 30), null, null);
    const star = g.draft.bPool[0];
    withMinutes(g, 'B', star.id, 12);
    for (const iq of [0, 0.5, 1]) {
      for (let i = 0; i < 30; i += 1) {
        const pick = aiDraftPick(at(g, 2, 2), 'B', { iq });
        expect(pick.playerId, `iq ${iq}`).not.toBe(star.id);
      }
    }
  });

  it('may name him in the fourth quarter', () => {
    // The RULE lifts; whether he is the pick is the planner's business (the
    // matchup edge can prefer a fresher body or a better matchup). So the
    // assertion is eligibility: he is on the menu, and Settler - which picks
    // at random from the menu - does name him.
    const g = newGame(CARDS.slice(0, 10), CARDS.slice(20, 30), null, null);
    const star = g.draft.bPool[0];
    withMinutes(g, 'B', star.id, 12);
    const q4 = at(g, 4, 1);
    expect(mustRest(q4, 'B', star)).toBe(false);
    expect(pickablePool(q4, 'B', g.draft.bPool)).toContain(star);
    const named = new Set();
    for (let i = 0; i < 80; i += 1) named.add(aiDraftPick(q4, 'B', { iq: 0 }).playerId);
    expect(named.has(star.id)).toBe(true);
  });
});

describe('a whole game under the rule', () => {
  it('sends nobody onto the floor with twelve minutes up before the fourth quarter', () => {
    let s = 4242;
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
    // The simulator's driver names each five through aiDraftPick. A brain
    // that watches every pick catches a violation at the moment it happens,
    // which the final box score cannot — by the end, Q4 and overtime have
    // legitimately put twenty-plus on a tracker.
    const violations = [];
    const watch = {
      ...ai,
      aiDraftPick: (g, key, opts) => {
        const pick = ai.aiDraftPick(g, key, opts);
        const player = getTeam(g, key).roster.find(p => p.id === pick?.playerId);
        if (player && mustRest(g, key, player)) {
          violations.push(`Q${g.quarter} S${g.section}: ${player.name} at ${getPS(g, key, player.id)?.minutes}m`);
        }
        return pick;
      },
    };
    for (let i = 0; i < 4; i += 1) {
      simulateGame(CARDS.slice(10 * i, 10 * i + 10), CARDS.slice(40 + 10 * i, 50 + 10 * i), { rng, brains: { A: watch, B: watch } });
    }
    expect(violations).toEqual([]);
  });
});
