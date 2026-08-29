import { describe, it, expect } from 'vitest';
import { stateUrl, cropsUrl, teamsUrl, photoUrl, isImageFile } from './api.js';

describe('studio route paths', () => {
  it('addresses the dev-server plugin on bare, base-less paths', () => {
    // The plugin's middlewares are registered before Vite's base middleware, so
    // they only ever see the unprefixed path. Prefixing these with
    // '/nba-showdown-2k25/' silently returns the SPA's HTML instead.
    for (const url of [stateUrl(), cropsUrl(), teamsUrl(), photoUrl('X')]) {
      expect(url.startsWith('/__studio/')).toBe(true);
      expect(url).not.toContain('nba-showdown-2k25');
    }
  });

  it('encodes the player id it puts in the query string', () => {
    expect(photoUrl('Jabari_Smith_Jr_')).toBe('/__studio/photo?playerId=Jabari_Smith_Jr_');
    expect(photoUrl('a b&c')).toBe('/__studio/photo?playerId=a%20b%26c');
  });
});

describe('isImageFile', () => {
  const file = (name, type) => ({ name, type });

  it('accepts images by MIME type', () => {
    expect(isImageFile(file('kd.jpg', 'image/jpeg'))).toBe(true);
    expect(isImageFile(file('kd.png', 'image/png'))).toBe(true);
    expect(isImageFile(file('kd.webp', 'image/webp'))).toBe(true);
  });

  it('rejects anything else, because the server stores whatever it is given', () => {
    // A dropped PDF would otherwise be written as {playerId}.jpg and render as
    // a broken image with no explanation.
    expect(isImageFile(file('scouting.pdf', 'application/pdf'))).toBe(false);
    expect(isImageFile(file('notes.txt', 'text/plain'))).toBe(false);
    expect(isImageFile(null)).toBe(false);
    expect(isImageFile(undefined)).toBe(false);
  });

  it('falls back to the extension when the drag source reports no MIME type', () => {
    expect(isImageFile(file('kd.JPEG', ''))).toBe(true);
    expect(isImageFile(file('kd.pdf', ''))).toBe(false);
    expect(isImageFile(file('', ''))).toBe(false);
  });
});
