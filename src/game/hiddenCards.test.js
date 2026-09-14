// WHAT EACH SIDE IS ALLOWED TO KNOW.
//
// The user, 2026-09-14: "human should not be able to see AI's strategy cards,
// and AI should not know or make decision off of the opposing team's strategy
// cards in hand or deck."
//
// Two halves, and only one of them was ever broken. The coach has never read
// the opponent's hand or deck — this pins that so it stays true, because the
// tempting version of almost every card heuristic in ai.js is "what are they
// holding". The other half was broken in the UI and is fixed in CourtBoard: a
// solo game is not PvP, so every `pvpMode && ...` gate let the coach's seven
// cards render face-up.
//
// The test that matters here is the SOURCE one. A behavioural test ("the coach
// plays the same card whatever the opponent holds") passes trivially today and
// would keep passing if someone added a peek tomorrow with a jitter in front
// of it. Reading the file is the check that actually holds the rule.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newGame, STARTERS } from './engine.js';
import { CARDS } from './cards.js';
import * as ai from './ai.js';

const SRC = readFileSync(fileURLToPath(new URL('./ai.js', import.meta.url)), 'utf8');
/** ai.js with comments stripped — a rule about code, not about prose. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the coach never looks at the opponent\'s cards', () => {
  it('reads .hand and .deck only off its own team', () => {
    // Every line that touches a hand or a deck, with the receiver it reads
    // from. `team` and `myT` are getTeam(game, teamKey) — the coach's own.
    const OWN = new Set(['team', 'myT', 'nt', 't']);
    const bad = [];
    for (const line of CODE.split('\n')) {
      for (const m of line.matchAll(/(\w+)(?:\?)?\.(hand|deck)\b/g)) {
        if (!OWN.has(m[1])) bad.push(`${m[1]}.${m[2]} — ${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('holds an opponent binding, so the rule above is testing something real', () => {
    // The coach DOES bind the other team — through getOpp, and through
    // getTeam with a flipped key. Both are legitimate: what it reads off them
    // is the floor. If neither existed the rule above would pass vacuously.
    const bound = [...CODE.matchAll(/const\s+(\w+)\s*=\s*(?:getOpp\(|getTeam\(\s*\w+\s*,\s*opp)/g)].map(m => m[1]);
    expect(bound.length).toBeGreaterThan(0);

    // And none of those bindings is ever asked for cards.
    for (const name of new Set(bound)) {
      expect(CODE, `${name} is the opponent — it must not be asked for cards`)
        .not.toMatch(new RegExp(`\\b${name}(?:\\?)?\\.(hand|deck|discard)\\b`));
    }
  });

  it('reads off the opponent only what the board shows anyone', () => {
    // The fields the coach takes from the other side, and the reason the
    // OppStatusPanel exists: every one of them is public — who is on the
    // floor, their minutes and markers, the rolls already made, the current
    // assignments, the score. The human can now see the same set.
    const opp = [...CODE.matchAll(/\b(?:oppT|opp)(?:\?)?\.(\w+)/g)].map(m => m[1]);
    const PUBLIC = new Set(['starters', 'roster', 'score', 'name', 'stats', 'assists', 'rebounds', 'length', 'map', 'filter', 'some', 'find', 'slice', 'forEach', 'indexOf', 'reduce']);
    for (const f of new Set(opp)) expect(PUBLIC.has(f), `opponent.${f} is not public board state`).toBe(true);
  });
});

describe('the decision does not move when the opponent\'s hand does', () => {
  // The behavioural half. Weaker than the source check — it cannot prove a
  // peek is absent — but it catches an indirect read through a helper.
  const roster = n => CARDS.slice(n, n + 10);
  const start = () => {
    let g = newGame(roster(0), roster(40), null, null);
    g = { ...g, phase: 'scoring', scoringTurn: 'B' };
    g.teamA.starters = g.teamA.roster.slice(0, STARTERS);
    g.teamB.starters = g.teamB.roster.slice(0, STARTERS);
    return g;
  };

  it('picks the same roll whatever the other side is holding', () => {
    const a = start();
    const b = start();
    b.teamA.hand = ['high_screen_roll', 'double_team', 'this_is_my_house'];
    b.teamA.deck = ['switch_everything', 'close_out'];
    expect(ai.aiRollDecision(b, 'B')).toEqual(ai.aiRollDecision(a, 'B'));
  });

  it('sets the same defence whatever the other side is holding', () => {
    const a = start();
    const b = start();
    b.teamA.hand = ['switch_everything', 'turnover', 'green_light'];
    expect(ai.aiSetMatchups(b, 'B')).toEqual(ai.aiSetMatchups(a, 'B'));
  });
});
