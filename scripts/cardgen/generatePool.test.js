import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './cache.js';
import { readForceInclude, FORCE_INCLUDE_FILE } from './forceInclude.js';
import { normalizeName } from './resolveTeams.js';
import { buildPool, byMinutesDescending, POOL_RULE, OUTPUT_FILE } from './generatePool.js';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const committedPool = readJson(OUTPUT_FILE);

describe('readForceInclude', () => {
  it('reads the committed list as name/reason pairs, without the _comment', () => {
    const list = readForceInclude();
    expect(list.length).toBeGreaterThan(0);
    expect(list.map(p => p.name)).not.toContain('_comment');
    // The reason is the point of the file: a name with no explanation is a name
    // nobody can later decide to remove.
    for (const entry of list) expect(entry.reason).toBeTruthy();
  });

  it('treats a missing file as an empty list rather than an error', () => {
    expect(readForceInclude(path.join(REPO_ROOT, 'card-data', 'no-such-file.json'))).toEqual([]);
  });
});

describe('buildPool', () => {
  const league = [
    { name: 'Rule Passer', team: 'BOS', pos: 'SF', games: 70, mpg: 33 },
    { name: 'Hurt Star', team: 'MIL', pos: 'PF', games: 36, mpg: 28.9 },
    { name: 'Low Minutes', team: 'UTA', pos: 'C', games: 60, mpg: 8 },
  ];

  it('adds the named players to whoever the rule already admits', () => {
    const { pool, byRule, forced } = buildPool(league, {
      forceInclude: [{ name: 'Hurt Star', reason: 'injury-shortened' }],
    });
    expect(byRule).toBe(1);
    expect(forced.map(p => p.name)).toEqual(['Hurt Star']);
    expect(pool.map(p => p.name)).toEqual(['Rule Passer', 'Hurt Star']);
  });

  it('reports a name that matches no row', () => {
    const { unmatched } = buildPool(league, { forceInclude: [{ name: 'Nobody At All' }] });
    expect(unmatched).toEqual(['Nobody At All']);
  });

  it('accepts bare name strings as well as records', () => {
    expect(buildPool(league, { forceInclude: ['Hurt Star'] }).pool.map(p => p.name)).toEqual([
      'Rule Passer',
      'Hurt Star',
    ]);
  });
});

describe('byMinutesDescending', () => {
  it('sorts by MPG descending and leaves ties in source order', () => {
    const rows = [
      { name: 'A', mpg: 30 },
      { name: 'B', mpg: 34 },
      { name: 'C', mpg: 30 },
    ];
    expect(byMinutesDescending(rows).map(p => p.name)).toEqual(['B', 'A', 'C']);
  });
});

// The end-to-end guarantee, and the one that would actually have caught the bug
// this work fixes: the list was DECIDED and then never made it into the file the
// studio reads. These assert the two committed artefacts agree with each other.
describe('the committed pool honours the committed force-include list', () => {
  const poolKeys = new Set(committedPool.map(p => normalizeName(p.name)));

  it('contains every force-included player', () => {
    const missing = readForceInclude()
      .map(p => p.name)
      .filter(name => !poolKeys.has(normalizeName(name)));
    expect(missing).toEqual([]);
  });

  it('is otherwise exactly the threshold rule', () => {
    const forcedKeys = new Set(readForceInclude().map(p => normalizeName(p.name)));
    const unexplained = committedPool.filter(
      p =>
        !(p.mpg >= POOL_RULE.minMpg && p.games >= POOL_RULE.minGames) &&
        !forcedKeys.has(normalizeName(p.name))
    );
    expect(unexplained).toEqual([]);
  });

  it('holds the rule-passers plus the force-includes, and nobody else', () => {
    const forcedInPool = committedPool.filter(
      p => !(p.mpg >= POOL_RULE.minMpg && p.games >= POOL_RULE.minGames)
    );
    // The CARRIED-FORWARD players are in the pool too and pass no rule at all —
    // they have no 2025-26 row to test. They are identified by the field the
    // generator stamps on them rather than by name, so adding one to
    // card-data/carry-forward-2026.json does not break this test.
    // Counted SEPARATELY, because they pass the rule on their carried season's
    // games and minutes and so never appear in `forcedInPool` — they are in the
    // pool for a third reason entirely.
    const carried = committedPool.filter(p => p.carriedFrom != null);
    expect(carried.length).toBeGreaterThan(0);
    // 330, not 331: Russell Westbrook retired and is on the retired list, which
    // removes him after the rule admitted him. See retired.js.
    expect(committedPool).toHaveLength(330 + forcedInPool.length + carried.length);
  });

  it('would lose a player if his name were removed from the list', () => {
    // Not a mutation of the real file — the same composition the generator does,
    // run twice over the committed pool's own records with one name held back.
    const dropped = readForceInclude()
      .map(p => p.name)
      .filter(n => normalizeName(n) !== normalizeName('Zach Edey'));
    const { pool } = buildPool(committedPool, { forceInclude: dropped });
    expect(pool.map(p => p.name)).not.toContain('Zach Edey');
    expect(pool).toHaveLength(committedPool.length - 1);
  });
});

describe('the force-include file itself', () => {
  it('documents what it is for whoever opens it next', () => {
    expect(readJson(FORCE_INCLUDE_FILE)._comment).toMatch(/force-include|regardless/i);
  });
});
