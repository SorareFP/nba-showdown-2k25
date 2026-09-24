// The studio's live Photo Hunt reads the same rule and search as the page.
import { describe, it, expect } from 'vitest';
import { huntRows } from './PhotoHuntPanel.jsx';

const sources = {
  ss: { key: 'ss', set: 'super-season', label: 'Super Season · 3 cards', players: [
    { id: 'Clint_Capela', name: 'Clint Capela', team: 'ATL', season: 2021, seasonLabel: '2020-21' },
    { id: 'Has_Photo', name: 'Has Photo', team: 'BOS', season: 2010, seasonLabel: '2009-10' },
  ] },
  live: { key: 'live', set: 'super-season', label: 'Same folder', players: [{ id: 'Clint_Capela', name: 'Clint Capela', team: 'ATL', season: 2021 }] },
  tb: { key: 'tb', set: 'throwbacks', label: 'Throwbacks', players: [{ id: 'Sleeper_2014', name: 'Sleeper', team: 'OKC', season: 2014 }] },
  strats: { key: 'strats', set: 'strats', template: 'strat', label: 'Strategy cards', players: [
    { id: 'blow_by', name: 'Blow-By', team: 'SCORING', pos: 'OFF', rarity: 'uncommon' },
  ] },
  ref: { key: 'ref', set: '2025-26', secondary: true, editable: false, players: [{ id: 'Old', name: 'Old', team: 'LAL' }] },
};

describe('the live Photo Hunt', () => {
  it('lists every owed card once, by the shared rule, with its search', () => {
    const groups = huntRows(sources, {
      allPhotos: { 'super-season': ['Has_Photo'], strats: ['blow_by'] },
      allPlaceholders: { strats: ['blow_by'] },
      dormantKeys: new Set(['throwbacks:Sleeper_2014']),
    });
    // Owed: Capela (once, though two sources share the folder) and the
    // placeholder strat. Done: Has_Photo. Never listed: the dormant Throwback
    // and the read-only reference set.
    expect(groups.map(g => [g.key, g.rows.map(r => r.id)])).toEqual([
      ['ss', ['Clint_Capela']],
      ['strats', ['blow_by']],
    ]);
    const capela = groups[0].rows[0];
    expect(capela.when).toBe('2020-21');
    expect(capela.url).toContain(encodeURIComponent('Clint Capela Atlanta Hawks 2021'));
    expect(groups[1].rows[0].state).toBe('placeholder');
  });
});
