import { describe, it, expect } from 'vitest';
import { buildBiometrics, indexBiometrics, mode } from './biometrics.js';

const row = (name, season, inches, weight) => ({ name, season, inches, weight });

describe('mode', () => {
  it('picks the most common value', () => {
    expect(mode([79, 79, 80])).toBe(79);
  });

  it('breaks a tie towards the larger, so a listing that grew wins', () => {
    expect(mode([79, 80])).toBe(80);
  });
});

describe('buildBiometrics folds player-seasons into one row per player', () => {
  it('takes the modal height and the mean weight', () => {
    const [r] = buildBiometrics([
      row('Test Player', 2020, 79, 200),
      row('Test Player', 2021, 79, 210),
      row('Test Player', 2022, 80, 220),
    ]);
    expect(r).toMatchObject({
      name: 'Test Player',
      inches: 79,
      weight: 210,
      seasons: 3,
      firstSeason: 2020,
      lastSeason: 2022,
      weightRange: 20,
      heightVaries: true,
    });
  });

  it('drops a row with no height or no weight rather than averaging a hole in', () => {
    const [r] = buildBiometrics([
      row('Test Player', 2020, 79, 200),
      row('Test Player', 2021, null, 300),
      row('Test Player', 2022, 79, undefined),
    ]);
    expect(r.seasons).toBe(1);
    expect(r.weight).toBe(200);
  });

  it('returns nothing at all when no row carries both', () => {
    expect(buildBiometrics([row('Test Player', 2020, null, null)])).toEqual([]);
    expect(buildBiometrics([])).toEqual([]);
    expect(buildBiometrics(null)).toEqual([]);
  });

  // The name a card is looked up by is the CURRENT pool's spelling, so a player
  // whose listing gained a suffix has to come out under the newer one.
  it('keeps the most recent spelling of a name that changed', () => {
    const [r] = buildBiometrics([
      row('Ronald Holland', 2025, 79, 200),
      row('Ronald Holland II', 2026, 79, 200),
    ]);
    expect(r.name).toBe('Ronald Holland II');
    expect(r.seasons).toBe(2);
  });

  it('joins two spellings that normalise to the same key', () => {
    const records = buildBiometrics([
      row('Nikola Jokic', 2024, 83, 284),
      row('Nikola Jokić', 2025, 83, 284),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].seasons).toBe(2);
  });

  it('sorts by name so the committed file has a stable order', () => {
    const names = buildBiometrics([
      row('Zed', 2020, 79, 200),
      row('Abe', 2020, 79, 200),
      row('Moe', 2020, 79, 200),
    ]).map(r => r.name);
    expect(names).toEqual(['Abe', 'Moe', 'Zed']);
  });
});

describe('indexBiometrics', () => {
  const records = buildBiometrics([row('Nikola Jokić', 2025, 83, 284)]);

  // normalizeName folds accents, drops suffixes and strips every non-letter,
  // spaces included — so the key is one lowercase run.
  it('is keyed the way every other join in the tree is', () => {
    const index = indexBiometrics(records);
    expect(index.get('nikolajokic')).toEqual({ inches: 83, weight: 284 });
  });

  // A set with no biometrics — the WNBA — has to reach splitSpeedPower's
  // position-only path, not blow up on a null index.
  it('is an EMPTY map for a missing table, never null', () => {
    expect(indexBiometrics(null).size).toBe(0);
    expect(indexBiometrics(undefined).get('anyone')).toBeUndefined();
  });
});
