import { describe, it, expect } from 'vitest';
import { resolvePhotoUrl, DEFAULT_CROP, cropToStyle } from './photo.js';

describe('resolvePhotoUrl', () => {
  it('prefers a curated photo when one exists', () => {
    expect(resolvePhotoUrl({ playerId: 'Nikola_Jokic', hasPhoto: true, personId: 203999 }))
      .toBe('/card-art/photos/Nikola_Jokic.jpg');
  });

  it('falls back to the NBA headshot CDN when there is no curated photo', () => {
    expect(resolvePhotoUrl({ playerId: 'Nikola_Jokic', hasPhoto: false, personId: 203999 }))
      .toBe('https://cdn.nba.com/headshots/nba/latest/1040x760/203999.png');
  });

  it('returns null when there is neither a photo nor a person id', () => {
    expect(resolvePhotoUrl({ playerId: 'X', hasPhoto: false, personId: null })).toBeNull();
    expect(resolvePhotoUrl({ playerId: 'X' })).toBeNull();
  });

  it('does not crash when called with nothing', () => {
    expect(resolvePhotoUrl()).toBeNull();
  });
});

describe('cropToStyle', () => {
  it('translates crop metadata into CSS transform values', () => {
    const style = cropToStyle({ x: 10, y: -5, zoom: 1.5 });
    expect(style.transform).toContain('translate(10%, -5%)');
    expect(style.transform).toContain('scale(1.5)');
    expect(style.transformOrigin).toBe('center center');
  });

  it('uses the default crop when given nothing', () => {
    expect(cropToStyle()).toEqual(cropToStyle(DEFAULT_CROP));
    expect(cropToStyle().transform).toBe('translate(0%, 0%) scale(1)');
  });

  it('fills missing fields from the default crop', () => {
    expect(cropToStyle({ zoom: 2 }).transform).toBe('translate(0%, 0%) scale(2)');
    expect(cropToStyle({ x: 4 }).transform).toBe('translate(4%, 0%) scale(1)');
  });

  it('does not mutate the default crop', () => {
    cropToStyle({ x: 99, y: 99, zoom: 9 });
    expect(DEFAULT_CROP).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});
