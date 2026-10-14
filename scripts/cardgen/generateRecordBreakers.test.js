// RECORD BREAKERS (2026-10-14, docs/plans/2026-10-14-record-breakers-design.md):
// the generator that turns card-data/record-breakers.json into the set.
import { describe, it, expect } from 'vitest';
import { recordCard, checkRecord, recordsIndex, SET_ID } from './generateRecordBreakers.js';

describe('the Record Breakers generator', () => {
  const built = { id: 'LeBron_James_2023', name: 'LeBron James', set: 'throwbacks', season: 2023, requested: true, requestId: null, builtAt: 'x', salary: 1970 };
  const row = { bbrefId: 'jamesle01', name: 'LeBron James', season: 2023, record: { number: '38,388', label: 'ALL-TIME PTS' }, earn: 'career-points', why: 'w' };

  it('relabels a built Throwback into the set, season in the id, request fields gone', () => {
    const card = recordCard(built, row);
    expect(card).toMatchObject({ id: 'LeBron_James_2023', set: SET_ID, record: row.record, earn: 'career-points', why: 'w' });
    for (const f of ['requested', 'requestId', 'builtAt']) expect(card).not.toHaveProperty(f);
  });

  it('refuses a season record the numbers do not support', () => {
    const log = { reg: [{ ast: 600 }, { ast: 564 }] };
    expect(() => checkRecord({ ...row, check: { source: 'log', stat: 'ast', total: 1164 } }, { log })).not.toThrow();
    expect(() => checkRecord({ ...row, check: { source: 'log', stat: 'ast', total: 1165 } }, { log })).toThrow(/1,?165/);
    const perPoss = { ftPct: 0.981 };
    expect(() => checkRecord({ ...row, check: { source: 'perPoss', field: 'ftPct', value: 0.981 } }, { perPoss })).not.toThrow();
    expect(() => checkRecord({ ...row, check: { source: 'perPoss', field: 'ftPct', value: 0.99 } }, { perPoss })).toThrow();
  });

  it('indexes every plaque by set and id, the plaque-only rows included', () => {
    const idx = recordsIndex([recordCard(built, row)], [{ card: 'super-season:Stephen_Curry', record: { number: '402', label: '3PM' } }]);
    expect(idx).toEqual({
      'record-breakers:LeBron_James_2023': { number: '38,388', label: 'ALL-TIME PTS' },
      'super-season:Stephen_Curry': { number: '402', label: '3PM' },
    });
  });
});

describe('the committed awards file', () => {
  it('carries the season marks of the Record Breakers cards (LeBron 2022-23 was an All-Star)', async () => {
    const { readFileSync } = await import('node:fs');
    const awards = JSON.parse(readFileSync(new URL('../../card-data/generated/card-awards.json', import.meta.url), 'utf8'));
    const lebron = (awards.sets['record-breakers'] ?? []).find(r => r.id === 'LeBron_James_2023');
    expect(lebron?.awards).toContain('AS');
  });
});

describe('the committed Record Breakers', () => {
  const read = async rel => {
    const { readFileSync } = await import('node:fs');
    return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
  };

  it('holds the twelve, every one with a plaque, a season in its id, and a photo wanted', async () => {
    const file = await read('../../card-data/generated/cards-record-breakers.json');
    const { records } = await read('../../card-data/generated/card-records.json');
    expect(file.cards).toHaveLength(12);
    for (const c of file.cards) {
      expect(c.id).toMatch(/_\d{4}$/);
      expect(c.record?.number, c.id).toBeTruthy();
      expect(records[`record-breakers:${c.id}`]).toEqual(c.record);
      expect(c.photoWanted, c.id).toBe(true);
    }
  });

  // ON THE CARD THAT IS ACTUALLY HELD: Curry's 2015-16 Super Season moved into
  // the set rewards (2026-09-30), and its old key only redirects there, so a
  // plaque under the old key would never be drawn. Every plaque key must be a
  // card its own set still holds.
  it('puts the plaque on the three existing record seasons, where each card lives', async () => {
    const { records } = await read('../../card-data/generated/card-records.json');
    const { CARD_SETS } = await import('../../src/game/cardSets.js');
    for (const key of ['set-rewards:Stephen_Curry', 'super-season:Russell_Westbrook', 'super-season:John_Stockton']) {
      expect(records[key], key).toBeTruthy();
    }
    for (const key of Object.keys(records)) {
      const [set, id] = key.split(':');
      expect((CARD_SETS[set] ?? []).some(c => c.id === id) || set === 'record-breakers', key).toBe(true);
    }
  });

  it('deals four by packs and earns eight by feats', async () => {
    const file = await read('../../card-data/generated/cards-record-breakers.json');
    expect(file.cards.filter(c => c.earn === 'pack')).toHaveLength(4);
    expect(file.cards.filter(c => c.earn !== 'pack')).toHaveLength(8);
  });
});

// A ROW MUST SAY HOW ITS CARD IS EARNED (the final review, 2026-10-14):
// isFeatCard treats a card with no `earn` as a pack card, so a forgotten field
// would quietly put a feat card into the boosters. The builder refuses it.
describe('a row\'s earn', () => {
  it('is "pack" or a career-/season- feat id, and nothing else', async () => {
    const { validateRow } = await import('./generateRecordBreakers.js');
    const row = { bbrefId: 'x01', name: 'X', season: 2000, record: { number: '1', label: 'A' } };
    expect(() => validateRow({ ...row, earn: 'pack' })).not.toThrow();
    expect(() => validateRow({ ...row, earn: 'career-points' })).not.toThrow();
    expect(() => validateRow({ ...row, earn: 'season-ft-pct' })).not.toThrow();
    expect(() => validateRow({ ...row })).toThrow(/earn/);
    expect(() => validateRow({ ...row, earn: '' })).toThrow(/earn/);
    expect(() => validateRow({ ...row, earn: 'packs' })).toThrow(/earn/);
    // A plaque-only row names an existing card and earns nothing.
    expect(() => validateRow({ card: 'super-season:X', record: { number: '1', label: 'A' } })).not.toThrow();
  });
});
