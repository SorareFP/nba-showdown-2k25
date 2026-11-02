// The one rule the Photo Hunt and the Card Studio read (2026-09-24, the user:
// "Photo hunt and card studio aren't matching").
import { describe, it, expect } from 'vitest';
import { photoState, needsPhoto, notPlayedNames, huntable } from './photoNeeds.js';
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

  // LeBron James 2022-23 was the first wanted card; his photo landed and the
  // card moved to Record Breakers the same day (2026-10-14), so it is neither.
  it('keeps LeBron James 2022-23 live in Record Breakers once its photo landed', async () => {
    const { DORMANT_KEYS, PHOTO_WANTED_KEYS, getCardByKey } = await import('../game/cardSets.js');
    expect(DORMANT_KEYS.has('record-breakers:LeBron_James_2023')).toBe(false);
    expect(PHOTO_WANTED_KEYS.has('throwbacks:LeBron_James_2023')).toBe(false);
    expect(getCardByKey('record-breakers:LeBron_James_2023')?.record?.number).toBe('38,388');
  });
});

// The user, 2026-11-02: "remove any live-series rookies from the photo hunt if
// they have not played any regular season minutes yet."
describe('a Live rookie who has not played', () => {
  const liveFile = { live: { logs: { unmatched: ['Tyler Nickel', 'Ben Simmons'] } } };

  it('reads the names off the nightly job, and nothing with no file', () => {
    expect([...notPlayedNames(liveFile)]).toEqual(['Tyler Nickel', 'Ben Simmons']);
    expect(notPlayedNames(null).size).toBe(0);
  });

  it('is not hunted until they play', () => {
    const notPlayed = notPlayedNames(liveFile);
    expect(huntable({ name: 'Tyler Nickel', liveRookie: true }, notPlayed)).toBe(false);
    expect(huntable({ name: 'AJ Dybantsa', liveRookie: true }, notPlayed)).toBe(true);
  });

  it('is only a rookie: a veteran who has not played is still owed a photo', () => {
    expect(huntable({ name: 'Ben Simmons' }, notPlayedNames(liveFile))).toBe(true);
  });
});
