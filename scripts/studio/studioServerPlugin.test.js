import { describe, it, expect } from 'vitest';
import { photoExtMap, isSafePlayerId } from './studioServerPlugin.js';
import { DEFAULT_PHOTO_EXT, PHOTO_EXTENSIONS, photoUrlPath, CURRENT_SET } from '../../src/cards/sets.js';

describe('photoExtMap', () => {
  it('reports the real extension for every listed photo', () => {
    expect(
      photoExtMap(['A_J_Green.jpeg', 'LeBron_James.jpg', 'Luka_Doncic.png', 'Zion_Williamson.avif'])
    ).toEqual({
      A_J_Green: '.jpeg',
      LeBron_James: '.jpg',
      Luka_Doncic: '.png',
      Zion_Williamson: '.avif',
    });
  });

  it('feeds photoUrlPath a URL that names the file that exists', () => {
    // The whole point of the map, stated end to end: a photo saved by hand as
    // .jpeg was listed as present and then requested as .jpg. These two
    // functions are the only things between the directory and the <img> src.
    const map = photoExtMap(['A_J_Green.jpeg']);
    expect(photoUrlPath('A_J_Green', CURRENT_SET, map.A_J_Green)).toBe(
      `/card-art/sets/${CURRENT_SET}/photos/A_J_Green.jpeg`
    );
  });

  it('lower-cases the extension, so SAVED.JPEG is still served', () => {
    expect(photoExtMap(['X.JPEG'])).toEqual({ X: '.jpeg' });
  });

  it('prefers the studio default when one player has two files', () => {
    // Nothing stops a hand-saved X.png and a dropped X.jpg from coexisting.
    // They are one player, only one can be shown, and the .jpg is the one the
    // studio itself wrote most recently — so it wins either way round, rather
    // than depending on the order readdir happened to return.
    expect(photoExtMap(['X.png', 'X.jpg']).X).toBe(DEFAULT_PHOTO_EXT);
    expect(photoExtMap(['X.jpg', 'X.png']).X).toBe(DEFAULT_PHOTO_EXT);
  });

  it('is deterministic when neither file is the default', () => {
    expect(photoExtMap(['X.webp', 'X.png']).X).toBe(photoExtMap(['X.png', 'X.webp']).X);
  });

  it('keeps ids containing dots intact, stripping only the last segment', () => {
    // Real ids are letters, digits and underscores (isSafePlayerId), but the
    // id derivation is a regex on a filename and a greedy one would eat half
    // the name.
    expect(photoExtMap(['A.J._Green.jpg'])).toEqual({ 'A.J._Green': '.jpg' });
  });

  it('returns an empty map for an empty directory', () => {
    expect(photoExtMap([])).toEqual({});
  });

  it('covers every extension the URL builder is willing to emit', () => {
    const files = PHOTO_EXTENSIONS.map((ext, i) => `P${i}${ext}`);
    expect(Object.values(photoExtMap(files)).sort()).toEqual([...PHOTO_EXTENSIONS].sort());
  });
});

describe('isSafePlayerId', () => {
  it('accepts the ids the photo files are actually named with', () => {
    expect(isSafePlayerId('Nikola_Jokic')).toBe(true);
    expect(isSafePlayerId('A_J_Green')).toBe(true);
  });

  it('refuses anything that could walk out of the photos directory', () => {
    expect(isSafePlayerId('../secrets')).toBe(false);
    expect(isSafePlayerId('a/b')).toBe(false);
    expect(isSafePlayerId('')).toBe(false);
    expect(isSafePlayerId(null)).toBe(false);
  });
});
