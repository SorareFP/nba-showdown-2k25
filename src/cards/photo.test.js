import { describe, it, expect } from 'vitest';
import { resolvePhotoUrl, DEFAULT_CROP, cropToStyle, PHOTO_WINDOW } from './photo.js';
import { CURRENT_SET } from './sets.js';

describe('resolvePhotoUrl', () => {
  it('prefers a curated photo when one exists', () => {
    expect(resolvePhotoUrl({ playerId: 'Nikola_Jokic', hasPhoto: true, personId: 203999 }))
      .toBe(`/card-art/sets/${CURRENT_SET}/photos/Nikola_Jokic.jpg`);
  });

  it('scopes the photo to the set, so one season cannot read another', () => {
    expect(resolvePhotoUrl({ playerId: 'Nikola_Jokic', hasPhoto: true, set: '2025-26' }))
      .toBe('/card-art/sets/2025-26/photos/Nikola_Jokic.jpg');
  });

  it('appends a cache-busting token so a replaced photo is re-fetched', () => {
    // THE bug: replacing a photo rewrites {id}.jpg in place, so without this
    // the browser re-shows the bytes it already has and the new image never
    // appears. Two different tokens must produce two different URLs.
    const a = resolvePhotoUrl({ playerId: 'Nikola_Jokic', hasPhoto: true, version: 1712000000000 });
    const b = resolvePhotoUrl({ playerId: 'Nikola_Jokic', hasPhoto: true, version: 1712000000001 });
    expect(a).toBe(`/card-art/sets/${CURRENT_SET}/photos/Nikola_Jokic.jpg?v=1712000000000`);
    expect(a).not.toBe(b);
  });

  it('omits the token when there is none, keeping the export URL clean', () => {
    const bare = `/card-art/sets/${CURRENT_SET}/photos/X.jpg`;
    expect(resolvePhotoUrl({ playerId: 'X', hasPhoto: true })).toBe(bare);
    expect(resolvePhotoUrl({ playerId: 'X', hasPhoto: true, version: null })).toBe(bare);
    expect(resolvePhotoUrl({ playerId: 'X', hasPhoto: true, version: '' })).toBe(bare);
  });

  it('never tokenizes the headshot fallback, which is not rewritten in place', () => {
    expect(resolvePhotoUrl({ playerId: 'X', hasPhoto: false, personId: 203999, version: 7 }))
      .toBe('https://cdn.nba.com/headshots/nba/latest/1040x760/203999.png');
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
  /** The px number inside the Nth `calc(50% ± Npx)` of an object-position. */
  const offsets = style =>
    [...style.objectPosition.matchAll(/calc\(50% ([+-]) ([\d.]+)px\)/g)].map(
      m => (m[1] === '-' ? -1 : 1) * Number(m[2])
    );

  it('uses the default crop when given nothing', () => {
    expect(cropToStyle()).toEqual(cropToStyle(DEFAULT_CROP));
    expect(cropToStyle().transform).toBe('translate(0px, 0px) scale(1)');
    expect(cropToStyle().objectPosition).toBe(
      'clamp(100%, calc(50% + 0px), 0%) clamp(100%, calc(50% + 0px), 0%)'
    );
    expect(cropToStyle().transformOrigin).toBe('center center');
  });

  it('bounds object-position to the image, so a pan can never reveal emptiness', () => {
    // `clamp(100%, V, 0%)` is deliberate, not a typo: with object-fit cover the
    // content is wider than the box, so the percentage axis runs opposite to
    // the offset. This is the whole safety property — the browser resolves
    // those percentages against the real source dimensions, which this module
    // never sees, and refuses to move the image past its own edge.
    const style = cropToStyle({ x: 50, y: 50, zoom: 1 });
    expect(style.objectPosition).toMatch(/^clamp\(100%, calc\(50% .+\), 0%\) clamp\(100%, /);
  });

  it('spends the whole pan on object-position at zoom 1', () => {
    // At zoom 1 the element is exactly the window: it has no overhang to move
    // into, so every pixel of the pan has to happen inside the cover crop.
    const style = cropToStyle({ x: 10, y: -5, zoom: 1 });
    expect(style.transform).toBe('translate(0px, 0px) scale(1)');
    // Two decimals — the CSS is rounded to keep it readable, see round().
    expect(offsets(style)[0]).toBeCloseTo((10 / 100) * PHOTO_WINDOW.width, 2);
    expect(offsets(style)[1]).toBeCloseTo((-5 / 100) * PHOTO_WINDOW.height, 2);
  });

  it('spends the pan on the element first once zoom creates overhang', () => {
    // At zoom 2 the element overhangs the window by half of it each way, so a
    // pan inside that range moves the element and leaves the cover crop alone.
    const style = cropToStyle({ x: 25, y: 25, zoom: 2 });
    expect(style.transform).toBe(
      `translate(${(25 / 100) * PHOTO_WINDOW.width}px, ${(25 / 100) * PHOTO_WINDOW.height}px) scale(2)`
    );
    expect(offsets(style)).toEqual([0, 0]);
  });

  it('hands the remainder to object-position once the overhang is used up', () => {
    // 60% of the window at zoom 2, where the overhang covers only 50%.
    const style = cropToStyle({ x: 60, y: 0, zoom: 2 });
    const overhang = (PHOTO_WINDOW.width * (2 - 1)) / 2;
    expect(style.transform).toBe(`translate(${overhang}px, 0px) scale(2)`);
    // Divided by zoom: object-position is in the element's own pre-scale
    // pixels, which the scale(2) then doubles back to the intended distance.
    expect(offsets(style)[0]).toBeCloseTo(((60 / 100) * PHOTO_WINDOW.width - overhang) / 2, 2);
  });

  it('moves the visible photo the same on-screen distance at every zoom', () => {
    // The property the studio's 1:1 cursor tracking rests on: x is a shift of
    // the VISIBLE photo in card pixels, so however cropToStyle splits it
    // between the element and the cover crop, the two parts must always add
    // back up to the same number.
    const travel = (x, zoom) => {
      const style = cropToStyle({ x, y: 0, zoom });
      const tx = Number(style.transform.match(/translate\((-?[\d.]+)px/)[1]);
      return tx + offsets(style)[0] * zoom;
    };
    const expected = (30 / 100) * PHOTO_WINDOW.width;
    // Precision 1, not exact: the emitted CSS is rounded to two decimals, and
    // the object-position half of it is then multiplied back up by the zoom.
    for (const zoom of [1, 1.4, 2, 3]) expect(travel(30, zoom)).toBeCloseTo(expected, 1);
  });

  it('fills missing fields from the default crop', () => {
    expect(cropToStyle({ zoom: 2 }).transform).toBe('translate(0px, 0px) scale(2)');
    expect(offsets(cropToStyle({ x: 4 }))).toEqual([(4 / 100) * PHOTO_WINDOW.width, 0]);
  });

  it('writes a negative offset as a subtraction, not calc(50% + -8px)', () => {
    expect(cropToStyle({ x: -1.24 }).objectPosition).toContain('calc(50% - 8.35px)');
  });

  it('falls back rather than emitting NaN into the CSS', () => {
    const style = cropToStyle({ x: NaN, y: undefined, zoom: 0 });
    expect(style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(style.objectPosition).not.toContain('NaN');
  });

  it('does not mutate the default crop', () => {
    cropToStyle({ x: 99, y: 99, zoom: 9 });
    expect(DEFAULT_CROP).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});
