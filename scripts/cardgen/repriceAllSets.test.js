// EVERY PRICED CARD FILE IS REPRICED (2026-10-14). repriceAllSets.mjs walks a
// hand-kept SPECIALS list, and a set left off it does not fail: the loop just
// prices the others, and that set sits on an older price line until someone
// notices (team rewards, the set rewards and the Throwbacks each did). Record
// Breakers was the next one, caught in review. This reads the list from the
// script, as functions/serverSafe.test.js reads prepare.mjs.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const script = readFileSync(fileURLToPath(new URL('./repriceAllSets.mjs', import.meta.url)), 'utf8');
const listed = new Set([...script.slice(script.indexOf('const SPECIALS = [')).matchAll(/'([\w-]+\.json)'/g)].map(m => m[1]));
const GEN = fileURLToPath(new URL('../../card-data/generated/', import.meta.url));

/** Priced elsewhere: the base set first in the same script, the Live Series nightly by generateLive.js. */
const EXEMPT = new Set(['cards-2026-27.json', 'cards-live.json']);

describe('the reprice covers every priced card file', () => {
  it('lists every generated cards file whose cards carry a salary', () => {
    const priced = readdirSync(GEN)
      .filter(f => /^cards-.*\.json$/.test(f) && !EXEMPT.has(f))
      .filter(f => (JSON.parse(readFileSync(`${GEN}${f}`, 'utf8')).cards ?? []).some(c => Number.isFinite(c.salary)));
    expect(priced.length).toBeGreaterThan(10);
    expect(priced.filter(f => !listed.has(f))).toEqual([]);
  });
});
