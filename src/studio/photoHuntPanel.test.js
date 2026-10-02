// The studio's live Photo Hunt reads the same rule and search as the page.
import { describe, it, expect } from 'vitest';
import { huntRows, flaggedRows } from './PhotoHuntPanel.jsx';
import { replacementTarget } from './photoSearch.js';

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

describe('a photo to replace', () => {
  const pool = { key: 'pool', set: '2026-27', label: '2026-27 set · 2 players', players: [
    { id: 'Aaron_Wiggins', name: 'Aaron Wiggins', team: 'ATL', pos: 'SG' },
  ] };
  const flag = { key: '2026-27:Aaron_Wiggins', set: '2026-27', sourceKey: 'pool', sourceLabel: '2026-27 set', id: 'Aaron_Wiggins', name: 'Aaron Wiggins', note: 'Thunder jersey, now ATL', flaggedAt: 1 };

  it('searches the new team\u2019s media day in the year the season opens', () => {
    const [row] = flaggedRows({ pool }, [flag]);
    expect(row.where).toBe('ATL');
    expect(row.note).toBe('Thunder jersey, now ATL');
    expect(row.url).toContain(encodeURIComponent('Aaron Wiggins Atlanta Hawks media day 2026'));
    // The same exclusions the hunt uses: no trading cards.
    expect(row.url).toContain(encodeURIComponent('-topps'));
  });

  it('a card with a season of its own searches as the hunt does: no media day', () => {
    const card = { id: 'Clint_Capela', name: 'Clint Capela', team: 'ATL', season: 2021, seasonLabel: '2020-21' };
    const t = replacementTarget('super-season', card);
    expect(t.url).toContain(encodeURIComponent('Clint Capela Atlanta Hawks 2021'));
    expect(t.url).not.toContain('media');
  });

  it('a WNBA card names the league and its own year', () => {
    const t = replacementTarget('wnba', { id: 'Angel_Reese', name: 'Angel Reese', team: 'ATL' });
    expect(t.url).toContain(encodeURIComponent('WNBA media day 2026'));
  });

  it('a flag whose card left the source keeps its row and loses only the search', () => {
    const [row] = flaggedRows({ pool }, [{ ...flag, id: 'Gone', key: '2026-27:Gone' }]);
    expect(row).toMatchObject({ id: 'Gone', url: null, where: '' });
  });
});
