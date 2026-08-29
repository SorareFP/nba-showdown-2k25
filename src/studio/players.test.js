import { describe, it, expect } from 'vitest';
import {
  playerIdFromName,
  POOL_PLAYERS,
  SOURCES,
  photoProgress,
  filterPlayers,
  stepSelection,
} from './players.js';
import { isSafePlayerId } from '../../scripts/studio/studioServerPlugin.js';

const P = (id, name, team, pos) => ({ id, name, team, pos });

const SAMPLE = [
  P('Tyrese_Maxey', 'Tyrese Maxey', 'PHI', 'PG'),
  P('Kevin_Durant', 'Kevin Durant', 'HOU', 'SF'),
  P('Luka_Don_i_', 'Luka Dončić', 'LAL', 'PG'),
];

describe('playerIdFromName', () => {
  it('joins name parts with underscores', () => {
    expect(playerIdFromName('Kevin Durant')).toBe('Kevin_Durant');
  });

  it('collapses runs of punctuation into a single underscore', () => {
    expect(playerIdFromName("De'Aaron Fox")).toBe('De_Aaron_Fox');
    expect(playerIdFromName('Jabari Smith Jr.')).toBe('Jabari_Smith_Jr_');
  });

  it('collapses non-ASCII letters, which is ugly but must stay stable', () => {
    // This id is the photo filename. Changing the scheme to strip diacritics
    // properly ("Luka_Doncic") would orphan every photo already curated, so it
    // is locked here on purpose.
    expect(playerIdFromName('Luka Dončić')).toBe('Luka_Don_i_');
    expect(playerIdFromName('Nikola Jokić')).toBe('Nikola_Joki_');
  });

  it('survives a missing name instead of throwing', () => {
    expect(playerIdFromName(undefined)).toBe('');
  });
});

describe('the 2025-26 pool', () => {
  it('loads all 331 players', () => {
    expect(POOL_PLAYERS).toHaveLength(331);
  });

  it('gives every player a unique id', () => {
    const ids = new Set(POOL_PLAYERS.map(p => p.id));
    expect(ids.size).toBe(POOL_PLAYERS.length);
  });

  it('produces ids the studio server will accept as filenames', () => {
    // The upload route rejects any id outside [A-Za-z0-9_.-]; an id it refuses
    // is a player whose photo can never be saved.
    const rejected = POOL_PLAYERS.filter(p => !isSafePlayerId(p.id)).map(p => p.name);
    expect(rejected).toEqual([]);
  });

  it('carries name, team and position and no generated stats', () => {
    const maxey = POOL_PLAYERS.find(p => p.name === 'Tyrese Maxey');
    expect(maxey).toMatchObject({ id: 'Tyrese_Maxey', team: 'PHI', pos: 'PG' });
    expect(maxey.chart).toBeUndefined();
    expect(maxey.salary).toBeUndefined();
  });
});

describe('SOURCES', () => {
  it('offers the new pool and the shipped card set', () => {
    expect(SOURCES.pool.players).toHaveLength(331);
    expect(SOURCES.cards.players).toHaveLength(306);
  });

  it('sorts both by name so the list order is predictable', () => {
    for (const source of Object.values(SOURCES)) {
      const names = source.players.map(p => p.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
  });

  it('gives the shipped set full stats, unlike the pool', () => {
    expect(SOURCES.cards.players[0].chart.length).toBeGreaterThan(0);
  });
});

describe('photoProgress', () => {
  it('counts how many of the active set have a photo', () => {
    expect(photoProgress(SAMPLE, ['Kevin_Durant'])).toEqual({
      withPhoto: 1,
      total: 3,
      missing: 2,
    });
  });

  it('ignores photos belonging to players outside the active set', () => {
    // card-art/photos/ accumulates files from both sources; counting the
    // shipped-card photos against the 331-player pool would inflate progress.
    expect(photoProgress(SAMPLE, ['08_09_LeBron_James', 'Kevin_Durant'])).toMatchObject({
      withPhoto: 1,
      total: 3,
    });
  });

  it('handles an empty set and missing photo data', () => {
    expect(photoProgress([], [])).toEqual({ withPhoto: 0, total: 0, missing: 0 });
    expect(photoProgress(SAMPLE, undefined)).toMatchObject({ withPhoto: 0, missing: 3 });
  });

  it('accepts a Set as well as an array', () => {
    expect(photoProgress(SAMPLE, new Set(['Kevin_Durant'])).withPhoto).toBe(1);
  });
});

describe('filterPlayers', () => {
  it('returns everyone with no filter', () => {
    expect(filterPlayers(SAMPLE, {})).toHaveLength(3);
  });

  it('matches on name, case-insensitively', () => {
    expect(filterPlayers(SAMPLE, { query: 'duran' }).map(p => p.name)).toEqual(['Kevin Durant']);
  });

  it('matches on team and position too', () => {
    expect(filterPlayers(SAMPLE, { query: 'PHI' }).map(p => p.name)).toEqual(['Tyrese Maxey']);
    expect(filterPlayers(SAMPLE, { query: 'pg' })).toHaveLength(2);
  });

  it('matches accented names by their accented spelling', () => {
    expect(filterPlayers(SAMPLE, { query: 'dončić' })).toHaveLength(1);
  });

  it('narrows to players still missing a photo', () => {
    const out = filterPlayers(SAMPLE, { missingOnly: true, photoIds: ['Kevin_Durant'] });
    expect(out.map(p => p.name)).toEqual(['Tyrese Maxey', 'Luka Dončić']);
  });

  it('combines the text filter with missing-only', () => {
    const out = filterPlayers(SAMPLE, {
      query: 'PG',
      missingOnly: true,
      photoIds: ['Tyrese_Maxey'],
    });
    expect(out.map(p => p.name)).toEqual(['Luka Dončić']);
  });
});

describe('stepSelection', () => {
  const ids = SAMPLE.map(p => p.id);

  it('moves down and up the list', () => {
    expect(stepSelection(SAMPLE, ids[0], 1)).toBe(ids[1]);
    expect(stepSelection(SAMPLE, ids[1], -1)).toBe(ids[0]);
  });

  it('clamps at both ends rather than wrapping', () => {
    expect(stepSelection(SAMPLE, ids[0], -1)).toBe(ids[0]);
    expect(stepSelection(SAMPLE, ids[2], 1)).toBe(ids[2]);
  });

  it('resumes from where a filtered-out selection was, not from the top', () => {
    // The workflow this exists for: "needs photo" is on, a photo is dropped on
    // the player at index 1, they leave the list, and the next keypress must
    // land on whoever took their place — not back at row 0.
    expect(stepSelection(SAMPLE, 'Gone_Player', 1, 1)).toBe(ids[1]);
    expect(stepSelection(SAMPLE, 'Gone_Player', -1, 1)).toBe(ids[0]);
  });

  it('clamps a stale anchor to the list it is given', () => {
    expect(stepSelection(SAMPLE, 'Gone_Player', 1, 99)).toBe(ids[2]);
    expect(stepSelection(SAMPLE, 'Gone_Player', -1, 0)).toBe(ids[0]);
  });

  it('falls to the first entry when there is no anchor to resume from', () => {
    expect(stepSelection(SAMPLE, 'Nobody_At_All', 1)).toBe(ids[0]);
  });

  it('returns null for an empty list', () => {
    expect(stepSelection([], 'x', 1)).toBeNull();
    expect(stepSelection([], 'x', 1, 3)).toBeNull();
  });
});
