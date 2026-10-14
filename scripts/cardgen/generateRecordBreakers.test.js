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
