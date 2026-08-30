// The set model, and the one thing it must never do: change how the two sets
// that already exist behave.
//
// `hidesBlankTier` used to be `set === CURRENT_SET`. It is now a lookup in a
// declared list, which is a strictly more powerful rule and therefore a strictly
// better place to introduce a silent regression — the 2026-27 set losing its
// hidden row would push a sixth row into the photo frame on 350 cards, and the
// 2025-26 set gaining one would delete a real printed row from 66 finished
// cards. Both are pinned here, by set id, not by whatever the constants happen
// to hold.
import { describe, it, expect } from 'vitest';
import {
  ART_ROOT,
  CURRENT_SET,
  DEFAULT_PHOTO_EXT,
  FINISHED_SET,
  ROOKIE_SET,
  SETS,
  SET_IDS,
  SUPER_SEASON_SET,
  getSet,
  hidesBlankTier,
  isEditableSet,
  photoUrlPath,
  setPaths,
  setTreatment,
} from './sets.js';

describe('the declared set list', () => {
  it('holds the four sets the studio offers', () => {
    expect(SET_IDS).toEqual(['2026-27', '2025-26', 'super-season', 'rookie']);
  });

  it('names the season sets in the constants everything else imports', () => {
    expect(CURRENT_SET).toBe('2026-27');
    expect(FINISHED_SET).toBe('2025-26');
    expect(SUPER_SEASON_SET).toBe('super-season');
    expect(ROOKIE_SET).toBe('rookie');
  });

  it('gives every set an id, a name and an explicit treatment', () => {
    for (const set of SETS) {
      expect(set.id, JSON.stringify(set)).toBeTruthy();
      expect(set.name).toBeTruthy();
      // `null` rather than undefined: an absent treatment must be a decision on
      // the record, not a field somebody forgot.
      expect(set).toHaveProperty('treatment');
      expect(typeof set.editable).toBe('boolean');
      expect(typeof set.hidesBlankTier).toBe('boolean');
    }
  });

  it('has no duplicate ids — they are directory names', () => {
    expect(new Set(SET_IDS).size).toBe(SET_IDS.length);
  });

  it('uses ids that are safe as a path segment', () => {
    // Every id is interpolated into card-art/sets/{id}/ and public/cards/{id}/.
    for (const id of SET_IDS) expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it('returns null for a set it does not know, including prototype keys', () => {
    expect(getSet('nope')).toBeNull();
    expect(getSet('toString')).toBeNull();
    expect(getSet(undefined)).toBeNull();
  });
});

describe('hidesBlankTier', () => {
  it('hides the structural row on the set being built — unchanged', () => {
    expect(hidesBlankTier(CURRENT_SET)).toBe(true);
  });

  it('PRINTS it on the finished set, where 66 cards really have that row', () => {
    expect(hidesBlankTier(FINISHED_SET)).toBe(false);
  });

  it('hides it on both special sets, whose charts come out of the same generator', () => {
    expect(hidesBlankTier(SUPER_SEASON_SET)).toBe(true);
    expect(hidesBlankTier(ROOKIE_SET)).toBe(true);
  });

  it('prints everything for an unknown set — the fail-loud default', () => {
    // An unprinted row that should have shown is invisible; an extra row
    // overflows the chart into the photo frame and trips a test.
    expect(hidesBlankTier('who-knows')).toBe(false);
    expect(hidesBlankTier(undefined)).toBe(false);
    expect(hidesBlankTier('constructor')).toBe(false);
  });
});

describe('setTreatment', () => {
  it('leaves both season sets untreated, so they render as they always did', () => {
    expect(setTreatment(CURRENT_SET)).toBeNull();
    expect(setTreatment(FINISHED_SET)).toBeNull();
  });

  it('treats the two special sets', () => {
    expect(setTreatment(SUPER_SEASON_SET)).toBe('gold-foil');
    expect(setTreatment(ROOKIE_SET)).toBe('green-accent');
  });

  it('returns null for an unknown set rather than throwing', () => {
    expect(setTreatment('nope')).toBeNull();
  });
});

describe('isEditableSet', () => {
  it('allows the three sets being curated and refuses the finished one', () => {
    expect(isEditableSet(CURRENT_SET)).toBe(true);
    expect(isEditableSet(SUPER_SEASON_SET)).toBe(true);
    expect(isEditableSet(ROOKIE_SET)).toBe(true);
    expect(isEditableSet(FINISHED_SET)).toBe(false);
  });

  it('refuses anything it does not recognise', () => {
    // The server's photo route calls this before writing, so "unknown means no"
    // is load-bearing rather than tidy.
    expect(isEditableSet('nope')).toBe(false);
    expect(isEditableSet(undefined)).toBe(false);
  });
});

describe('every set owns a separate directory', () => {
  it('scopes photos, crops, team colours and exports by set id', () => {
    const seen = new Set();
    for (const id of SET_IDS) {
      const paths = setPaths(id);
      expect(paths.root).toBe(`${ART_ROOT}/sets/${id}`);
      expect(paths.photos).toContain(`/${id}/`);
      expect(paths.crops).toContain(`/${id}/`);
      expect(paths.teamOverrides).toContain(`/${id}/`);
      // NEVER public/cards/players/ — that is the finished set's hand-made art.
      expect(paths.cards).toBe(`public/cards/${id}`);
      expect(paths.cards).not.toBe('public/cards/players');
      for (const p of [paths.photos, paths.crops, paths.teamOverrides, paths.cards]) {
        expect(seen.has(p), `${id} collides on ${p}`).toBe(false);
        seen.add(p);
      }
    }
  });

  it('gives the same player a different photo URL in each set', () => {
    // The id spaces overlap BY DESIGN — every set derives ids with the same
    // rule — so the set is the only thing keeping one card's art off another's.
    const urls = SET_IDS.map(id => photoUrlPath('LeBron_James', id, DEFAULT_PHOTO_EXT));
    expect(new Set(urls).size).toBe(SET_IDS.length);
    for (const url of urls) expect(url).toContain('LeBron_James.jpg');
  });
});
