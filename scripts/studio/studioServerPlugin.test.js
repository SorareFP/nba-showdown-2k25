import { describe, it, expect } from 'vitest';
import { photoExtMap, isSafePlayerId, requestedSet, STRATS_SCOPE, STUDIO_SCOPES } from './studioServerPlugin.js';
import {
  DEFAULT_PHOTO_EXT,
  IMAGE_EXTENSIONS,
  SET_IDS,
  isEditableSet,
  photoUrlPath,
  CURRENT_SET,
} from '../../src/cards/sets.js';

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
    const files = IMAGE_EXTENSIONS.map((ext, i) => `P${i}${ext}`);
    expect(Object.values(photoExtMap(files)).sort()).toEqual([...IMAGE_EXTENSIONS].sort());
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

describe('requestedSet — which set a request writes to', () => {
  it('reads the set out of the query string', () => {
    for (const id of SET_IDS) {
      expect(requestedSet(`/__studio/state?set=${id}`)).toBe(id);
    }
  });

  it('ALLOW-LISTS the value rather than trusting it', () => {
    // The set id is interpolated straight into card-art/sets/{set}/photos/, so
    // an unchecked parameter is a directory traversal with a photo upload
    // attached. Every one of these has to come back as the set being built.
    for (const attack of [
      '../../../public/cards/players',
      '..%2F..%2Fpublic%2Fcards%2Fplayers',
      '/etc',
      'C:\Windows',
      '2026-27/../2025-26',
      '__proto__',
      'constructor',
      'toString',
    ]) {
      expect(requestedSet(`/__studio/photo?set=${encodeURIComponent(attack)}`)).toBe(CURRENT_SET);
    }
  });

  it('allow-lists the strategy deck as a photo scope of its own', () => {
    // The studio's strats source composes faces and reads its art from
    // card-art/sets/strats/photos/. Before 2026-09-06 `?set=strats` fell back
    // to the set being built, so the 28 wave-one placeholders were invisible
    // and a dropped photo would have landed in the 2026-27 folder.
    expect(requestedSet(`/__studio/state?set=${STRATS_SCOPE}`)).toBe(STRATS_SCOPE);
    expect(STUDIO_SCOPES).toEqual([...SET_IDS, STRATS_SCOPE]);
  });

  it('falls back to the set being built when none is named', () => {
    // Which is exactly what an un-scoped request meant before the studio had
    // more than one set, so nothing that predates `?set=` changes behaviour.
    expect(requestedSet('/__studio/state')).toBe(CURRENT_SET);
    expect(requestedSet('/__studio/state?set=')).toBe(CURRENT_SET);
    expect(requestedSet(undefined)).toBe(CURRENT_SET);
  });

  it('ignores the other parameters on the photo route', () => {
    expect(requestedSet('/__studio/photo?playerId=LeBron_James&set=rookie')).toBe('rookie');
  });

  it('only ever answers with a set the tool declares', () => {
    for (const url of ['/x?set=rookie', '/x?set=nope', '/x', '/x?set=2025-26']) {
      expect(SET_IDS).toContain(requestedSet(url));
    }
  });
});

describe('which sets the server will write to', () => {
  it('refuses the finished set and accepts the three being curated', () => {
    // The server is the LAST of three checks — the row refuses the drag, the
    // client refuses the upload, and this refuses the request. Three because
    // the sets' id spaces overlap by design, so a drop that slipped through
    // would not error, it would silently overwrite another set's art.
    expect(isEditableSet(CURRENT_SET)).toBe(true);
    expect(isEditableSet('super-season')).toBe(true);
    expect(isEditableSet('rookie')).toBe(true);
    expect(isEditableSet('2025-26')).toBe(false);
  });
});
