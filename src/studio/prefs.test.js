import { describe, it, expect } from 'vitest';
import {
  SHOW_REFERENCE_SETS_KEY,
  readFlag,
  writeFlag,
  readShowReferenceSets,
  writeShowReferenceSets, hiddenSetKeys } from './prefs.js';

/** A localStorage stand-in. The real one does not exist in vitest's node env. */
function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    map,
  };
}

/** A store that throws on both operations, as a blocked-storage browser does. */
const hostileStore = {
  getItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem() {
    throw new DOMException('quota exceeded', 'QuotaExceededError');
  },
};

describe('readFlag', () => {
  it('returns the fallback when nothing has been stored', () => {
    expect(readFlag('k', false, fakeStore())).toBe(false);
    expect(readFlag('k', true, fakeStore())).toBe(true);
  });

  it('reads back exactly what writeFlag wrote', () => {
    const store = fakeStore();
    writeFlag('k', true, store);
    expect(readFlag('k', false, store)).toBe(true);
    writeFlag('k', false, store);
    expect(readFlag('k', true, store)).toBe(false);
  });

  it('falls back rather than coercing a value it did not write', () => {
    // The failure this prevents: a truthiness test on the raw string, so that
    // "0", "off" or a leftover JSON blob from an older build all read as `true`
    // and the studio comes up in a state nobody chose.
    for (const junk of ['1', '0', 'yes', 'off', '{"v":true}', '']) {
      expect(readFlag('k', false, fakeStore({ k: junk })), junk).toBe(false);
      expect(readFlag('k', true, fakeStore({ k: junk })), junk).toBe(true);
    }
  });

  it('survives a store that throws instead of taking the page down', () => {
    // Private windows and "block site data" settings throw on access rather
    // than returning null. A preference that cannot be read is the default,
    // not an error: the studio must still open.
    expect(readFlag('k', false, hostileStore)).toBe(false);
    expect(readFlag('k', true, hostileStore)).toBe(true);
    expect(writeFlag('k', true, hostileStore)).toBe(false);
  });

  it('treats an absent store as no preference at all', () => {
    // Explicit null rather than `undefined`, which would fall through to the
    // real global — this is the path taken under vitest and SSR.
    expect(readFlag('k', true, null)).toBe(true);
    expect(writeFlag('k', true, null)).toBe(false);
  });
});

describe('writeFlag', () => {
  it('reports whether the write actually landed', () => {
    expect(writeFlag('k', true, fakeStore())).toBe(true);
    expect(writeFlag('k', true, hostileStore)).toBe(false);
  });

  it('stores the two literals it parses, and nothing else', () => {
    const store = fakeStore();
    writeFlag('k', true, store);
    expect(store.map.get('k')).toBe('true');
    writeFlag('k', false, store);
    expect(store.map.get('k')).toBe('false');
  });
});

describe('the reference-set disclosure preference', () => {
  it('is collapsed until the user says otherwise', () => {
    // The point of the change: the finished reference set is out of the way on
    // a fresh profile, without anyone having to hide it first.
    expect(readShowReferenceSets(fakeStore())).toBe(false);
  });

  it('round-trips through one namespaced key', () => {
    const store = fakeStore();
    writeShowReferenceSets(true, store);
    expect(store.map.get(SHOW_REFERENCE_SETS_KEY)).toBe('true');
    expect(readShowReferenceSets(store)).toBe(true);

    writeShowReferenceSets(false, store);
    expect(readShowReferenceSets(store)).toBe(false);
  });

  it('namespaces the key to the studio', () => {
    // The dev server serves the game from this same origin. An unprefixed
    // "showReferenceSets" is one collision away from meaning something else.
    expect(SHOW_REFERENCE_SETS_KEY.startsWith('studio.')).toBe(true);
  });
});

describe('hiddenSetKeys — which sets leave the bar', () => {
  it('hides by hand and by completion, and lets a reveal override both', () => {
    // Manual only.
    expect([...hiddenSetKeys({ hidden: ['rookie'], autoHide: false })]).toEqual(['rookie']);
    // Auto-hide takes the finished ones too.
    expect([...hiddenSetKeys({ complete: ['wnba'], autoHide: true })]).toEqual(['wnba']);
    expect([...hiddenSetKeys({ complete: ['wnba'], autoHide: false })]).toEqual([]);
    // A revealed set comes back out even though it is complete — the override
    // that makes auto-hide safe when a photo needs re-cropping.
    expect([...hiddenSetKeys({ complete: ['wnba'], revealed: ['wnba'], autoHide: true })]).toEqual([]);
    // But a set hidden BY HAND stays hidden: the explicit choice wins.
    expect([...hiddenSetKeys({ hidden: ['wnba'], revealed: ['wnba'], autoHide: true })]).toEqual(['wnba']);
  });

  it('is empty by default and never throws on odd input', () => {
    expect([...hiddenSetKeys()]).toEqual([]);
    expect([...hiddenSetKeys({})]).toEqual([]);
  });
});
