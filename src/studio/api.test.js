import { describe, it, expect } from 'vitest';
import { stateUrl, cropsUrl, teamsUrl, photoUrl, isImageFile, saveCrops, saveTeams } from './api.js';
import { SET_IDS } from '../cards/sets.js';

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

describe('saveTeams', () => {
  /** Records the request instead of making one. */
  const capture = async fn => {
    const real = globalThis.fetch;
    let seen = null;
    globalThis.fetch = (url, init) => {
      seen = { url, init };
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    };
    try {
      await fn();
    } finally {
      globalThis.fetch = real;
    }
    return seen;
  };

  it('POSTs the whole override map to the teams route', async () => {
    const seen = await capture(() => saveTeams({ DEN: { accent: '#FEC524' } }));
    expect(seen.url).toBe(teamsUrl());
    expect(seen.init.method).toBe('POST');
    expect(JSON.parse(seen.init.body)).toEqual({ DEN: { accent: '#FEC524' } });
  });

  it('sends an empty map as {} — which is how a reset actually lands', () => {
    // The server replaces the file wholesale, so removing the last override
    // has to be expressible as "the file is now empty". A merge-on-write
    // endpoint could never delete a key.
    return capture(() => saveTeams({})).then(seen => {
      expect(seen.init.body).toBe('{}');
    });
  });

  it('writes crops and teams to different files', async () => {
    const crops = await capture(() => saveCrops({}));
    const teams = await capture(() => saveTeams({}));
    expect(crops.url).not.toBe(teams.url);
  });

  it('reports a failed write rather than resolving quietly', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve({ ok: false, status: 500 });
    await expect(saveTeams({})).rejects.toThrow('HTTP 500');
    globalThis.fetch = real;
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

describe('every route is scoped to a set', () => {
  it('carries the set on all four routes', () => {
    // THE CLAIM THE CURATION DEPENDS ON. Photos, crops and team colours all
    // live under card-art/sets/{id}/, and the sets derive player ids with the
    // same rule — so a request with no set on it is a photo dropped on a Super
    // Season card landing on top of the 2026-27 set's art for the same player.
    expect(stateUrl('rookie')).toBe('/__studio/state?set=rookie');
    expect(cropsUrl('rookie')).toBe('/__studio/crops?set=rookie');
    expect(teamsUrl('rookie')).toBe('/__studio/teams?set=rookie');
    expect(photoUrl('LeBron_James', 'super-season')).toBe(
      '/__studio/photo?playerId=LeBron_James&set=super-season'
    );
  });

  it('gives each set a distinct URL for the same player', () => {
    const urls = SET_IDS.map(id => photoUrl('LeBron_James', id));
    expect(new Set(urls).size).toBe(SET_IDS.length);
  });

  it('encodes the set, like the player id', () => {
    expect(photoUrl('X', 'a b&c')).toContain('set=a%20b%26c');
    expect(stateUrl('a b&c')).toBe('/__studio/state?set=a%20b%26c');
  });

  it('omits the parameter entirely when no set is named', () => {
    // The server then falls back to the set being built, which is what these
    // routes meant before there was more than one — so nothing that predates
    // set-scoping changes shape.
    expect(stateUrl()).toBe('/__studio/state');
    expect(photoUrl('X')).toBe('/__studio/photo?playerId=X');
  });

  it('still addresses the plugin on a bare, base-less path', () => {
    for (const url of [stateUrl('rookie'), cropsUrl('rookie'), teamsUrl('rookie'), photoUrl('X', 'rookie')]) {
      expect(url.startsWith('/__studio/')).toBe(true);
      expect(url).not.toContain('nba-showdown-2k25');
    }
  });
});
