// The one rule the Photo Hunt and the Card Studio read (2026-09-24, the user:
// "Photo hunt and card studio aren't matching").
import { describe, it, expect } from 'vitest';
import { photoState, needsPhoto } from './photoNeeds.js';
import { photoProgress, filterPlayers } from './players.js';

const opts = {
  photoIds: new Set(['has', 'doodle']),
  placeholders: new Set(['doodle']),
  dormantKeys: new Set(['throwbacks:sleeper']),
};

describe('does this card still need a photo', () => {
  it('names the four states, and owes a photo for two of them', () => {
    expect(photoState('strats', 'has', opts)).toBe('photo');
    expect(photoState('strats', 'doodle', opts)).toBe('placeholder');
    expect(photoState('strats', 'none', opts)).toBe('missing');
    expect(photoState('throwbacks', 'sleeper', opts)).toBe('dormant');
    // Dormant is by set: the same id elsewhere is simply missing.
    expect(photoState('super-season', 'sleeper', opts)).toBe('missing');
    expect(['photo', 'placeholder', 'missing', 'dormant'].map(needsPhoto)).toEqual([false, true, true, false]);
  });

  it('is what the studio counts and filters by', () => {
    const players = ['has', 'doodle', 'none', 'sleeper'].map(id => ({ id, name: id }));
    const stateOf = id => photoState('throwbacks', id, opts);
    expect(photoProgress(players, opts.photoIds, { stateOf }))
      .toEqual({ withPhoto: 1, total: 3, missing: 2, dormant: 1, placeholder: 1 });
    expect(filterPlayers(players, { missingOnly: true, photoIds: opts.photoIds, stateOf }).map(p => p.id))
      .toEqual(['doodle', 'none']);
    // Without the rule the old answer stands, for the callers that pass none.
    expect(photoProgress(players, opts.photoIds)).toEqual({ withPhoto: 2, total: 4, missing: 2 });
  });
});

// A WANTED PHOTO (2026-10-14, the user: "add Lebron to Photo Hunt plz"): a
// curated Throwback marked photoWanted is dormant (out of the packs) until its
// photo lands, but the hunt owes it one.
describe('a dormant card whose photo is wanted', () => {
  it('is missing, so the hunt lists it; without the mark it stays dormant', () => {
    const wanted = { ...opts, wantedKeys: new Set(['throwbacks:sleeper']) };
    expect(photoState('throwbacks', 'sleeper', wanted)).toBe('missing');
    expect(needsPhoto(photoState('throwbacks', 'sleeper', wanted))).toBe(true);
    expect(photoState('throwbacks', 'sleeper', opts)).toBe('dormant');
  });

  it('is a photo like any other once one lands', () => {
    const landed = { ...opts, photoIds: new Set(['sleeper']), wantedKeys: new Set(['throwbacks:sleeper']) };
    expect(photoState('throwbacks', 'sleeper', landed)).toBe('photo');
  });

  it('is LeBron James 2022-23, dormant and wanted', async () => {
    const { DORMANT_KEYS, PHOTO_WANTED_KEYS } = await import('../game/cardSets.js');
    expect(PHOTO_WANTED_KEYS.has('throwbacks:LeBron_James_2023')).toBe(true);
    expect(DORMANT_KEYS.has('throwbacks:LeBron_James_2023')).toBe(true);
  });
});
