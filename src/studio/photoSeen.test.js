import { describe, it, expect } from 'vitest';
import {
  FIRST_RUN_LOOKBACK_MS,
  SEEN_KEY,
  freshSeen,
  markAllSeen,
  markSeen,
  readSeen,
  unseenPhotos,
  writeSeen,
} from './photoSeen.js';

const memoryStore = (initial = {}) => {
  const data = { ...initial };
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
};

const SOURCES = {
  pool: { key: 'pool', set: '2026-27', label: '2026-27 set · 3 players', players: [
    { id: 'Stephen_Curry', name: 'Stephen Curry' },
    { id: 'Luka_Doncic', name: 'Luka Doncic' },
    { id: 'Jalen_Brunson', name: 'Jalen Brunson' },
  ] },
  throwbacks: { key: 'throwbacks', set: 'throwbacks', label: 'Throwbacks · 1 card', players: [
    { id: 'Antawn_Jamison_2005', name: 'Antawn Jamison' },
  ] },
  strats: { key: 'strats', set: 'strats', label: 'Strategy cards · 1', players: [{ id: 'green_light', name: 'Green Light' }] },
  cards: { key: 'cards', set: '2025-26', secondary: true, editable: false, players: [{ id: 'Stephen_Curry', name: 'Stephen Curry' }] },
};

const NOW = Date.parse('2026-09-30T20:00:00Z');
const HOUR = 60 * 60 * 1000;

describe('unseenPhotos', () => {
  it('lists a photo newer than the last time its card was on screen, newest first', () => {
    const record = { since: NOW - 48 * HOUR, at: { '2026-27:Luka_Doncic': NOW - 2 * HOUR } };
    const unseen = unseenPhotos({
      record,
      sources: SOURCES,
      allPhotoTimes: {
        '2026-27': { Stephen_Curry: NOW - 3 * HOUR, Luka_Doncic: NOW - 1 * HOUR, Jalen_Brunson: NOW - 30 * HOUR },
        throwbacks: { Antawn_Jamison_2005: NOW - 10 * 60 * 1000 },
      },
    });
    expect(unseen.map(u => u.id)).toEqual(['Antawn_Jamison_2005', 'Luka_Doncic', 'Stephen_Curry', 'Jalen_Brunson']);
    expect(unseen[0]).toMatchObject({ set: 'throwbacks', sourceKey: 'throwbacks', sourceLabel: 'Throwbacks', name: 'Antawn Jamison' });
  });

  it('drops a card once it has been opened after its photo arrived', () => {
    const times = { '2026-27': { Stephen_Curry: NOW - HOUR } };
    const before = freshSeen(NOW);
    expect(unseenPhotos({ record: before, sources: SOURCES, allPhotoTimes: times })).toHaveLength(1);
    const after = markSeen(before, '2026-27', 'Stephen_Curry', NOW);
    expect(unseenPhotos({ record: after, sources: SOURCES, allPhotoTimes: times })).toEqual([]);
  });

  it('flags the card again when a newer photo replaces the one that was seen', () => {
    const record = markSeen(freshSeen(NOW), '2026-27', 'Stephen_Curry', NOW - HOUR);
    const unseen = unseenPhotos({ record, sources: SOURCES, allPhotoTimes: { '2026-27': { Stephen_Curry: NOW } } });
    expect(unseen.map(u => u.id)).toEqual(['Stephen_Curry']);
  });

  it('treats photos older than the first-run look-back as seen', () => {
    const record = freshSeen(NOW);
    const old = NOW - FIRST_RUN_LOOKBACK_MS - HOUR;
    expect(unseenPhotos({ record, sources: SOURCES, allPhotoTimes: { '2026-27': { Stephen_Curry: old } } })).toEqual([]);
  });

  it('skips placeholder art and the read-only reference set', () => {
    const record = freshSeen(NOW);
    const unseen = unseenPhotos({
      record,
      sources: SOURCES,
      allPhotoTimes: { strats: { green_light: NOW - HOUR }, '2025-26': { Stephen_Curry: NOW - HOUR } },
      allPlaceholders: { strats: ['green_light'] },
    });
    expect(unseen).toEqual([]);
  });

  it('marks everything listed seen at once', () => {
    const times = { '2026-27': { Stephen_Curry: NOW - HOUR, Luka_Doncic: NOW - HOUR } };
    const record = freshSeen(NOW);
    const unseen = unseenPhotos({ record, sources: SOURCES, allPhotoTimes: times });
    const cleared = markAllSeen(record, unseen, NOW);
    expect(unseenPhotos({ record: cleared, sources: SOURCES, allPhotoTimes: times })).toEqual([]);
  });
});

describe('the stored record', () => {
  it('round-trips through storage', () => {
    const store = memoryStore();
    const record = markSeen(freshSeen(NOW), 'throwbacks', 'Antawn_Jamison_2005', NOW);
    expect(writeSeen(record, store)).toBe(true);
    expect(readSeen(NOW + HOUR, store)).toEqual(record);
  });

  it('starts fresh, looking back two days, when nothing or garbage is stored', () => {
    expect(readSeen(NOW, memoryStore())).toEqual({ since: NOW - FIRST_RUN_LOOKBACK_MS, at: {} });
    expect(readSeen(NOW, memoryStore({ [SEEN_KEY]: '{not json' }))).toEqual(freshSeen(NOW));
    expect(readSeen(NOW, memoryStore({ [SEEN_KEY]: '{"since":"x","at":{}}' }))).toEqual(freshSeen(NOW));
  });

  it('never throws when storage does', () => {
    const hostile = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(readSeen(NOW, hostile)).toEqual(freshSeen(NOW));
    expect(writeSeen(freshSeen(NOW), hostile)).toBe(false);
    expect(readSeen(NOW, null)).toEqual(freshSeen(NOW));
  });

  it('never moves a seen time backwards', () => {
    const record = markSeen(freshSeen(NOW), '2026-27', 'Luka_Doncic', NOW);
    expect(markSeen(record, '2026-27', 'Luka_Doncic', NOW - HOUR)).toBe(record);
  });
});
