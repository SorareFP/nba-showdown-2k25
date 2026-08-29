import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PHOTO_WINDOW,
  ZOOM_MIN,
  ZOOM_MAX,
  normalizeCrop,
  clampZoom,
  panCrop,
  setZoom,
  zoomByWheel,
  resetCrop,
  isDefaultCrop,
  pruneCrops,
} from './crop.js';
import { DEFAULT_CROP, cropToStyle } from '../cards/photo.js';

describe('PHOTO_WINDOW', () => {
  // The drag overlay is positioned with these numbers and every pan is a
  // percentage of them, so if the stylesheet moves the photo window and this
  // does not, dragging silently acts on the wrong region. Read the real CSS.
  const css = readFileSync(new URL('../cards/CardTemplate.module.css', import.meta.url), 'utf-8');

  const rule = name => {
    const match = css.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`));
    if (!match) throw new Error(`CardTemplate.module.css has no .${name} rule`);
    return match[1];
  };
  const px = (name, prop) => {
    const match = rule(name).match(new RegExp(`(?:^|[;\\s])${prop}:\\s*(-?[\\d.]+)px`));
    if (!match) throw new Error(`.${name} has no ${prop} in px`);
    return Number(match[1]);
  };

  it('matches the photo window in CardTemplate.module.css', () => {
    expect(PHOTO_WINDOW).toEqual({
      left: px('photoOuter', 'left') + px('photoWindow', 'left'),
      top: px('photoOuter', 'top') + px('photoWindow', 'top'),
      width: px('photoWindow', 'width'),
      height: px('photoWindow', 'height'),
    });
  });
});

describe('normalizeCrop', () => {
  it('fills in the default for anything missing', () => {
    expect(normalizeCrop()).toEqual(DEFAULT_CROP);
    expect(normalizeCrop({ x: 5 })).toEqual({ x: 5, y: 0, zoom: 1 });
  });

  it('replaces non-finite values rather than propagating NaN into the CSS', () => {
    expect(normalizeCrop({ x: NaN, y: undefined, zoom: 'big' })).toEqual(DEFAULT_CROP);
  });

  it('produces a crop cropToStyle can consume', () => {
    expect(cropToStyle(normalizeCrop({ x: 10, y: -5, zoom: 1.5 })).transform).toBe(
      'translate(10%, -5%) scale(1.5)'
    );
  });
});

describe('clampZoom', () => {
  it('holds the zoom inside its range', () => {
    expect(clampZoom(0.2)).toBe(ZOOM_MIN);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom(1.75)).toBe(1.75);
  });

  it('falls back to the default for a non-number', () => {
    expect(clampZoom(undefined)).toBe(DEFAULT_CROP.zoom);
  });
});

describe('panCrop', () => {
  it('converts a screen-pixel drag into a percentage of the photo window', () => {
    // At 1:1, dragging the full width of the window is a 100% shift.
    expect(panCrop(DEFAULT_CROP, { dx: PHOTO_WINDOW.width, scale: 1 }).x).toBe(100);
    expect(panCrop(DEFAULT_CROP, { dy: PHOTO_WINDOW.height, scale: 1 }).y).toBe(100);
  });

  it('divides by the preview scale so the photo tracks the cursor', () => {
    // THE bug this module exists to prevent: the preview is shown at ~half
    // size, so 100px of mouse travel is 200px of card. Without the division
    // the photo moves at half the cursor's speed and the tool feels broken.
    const halfSize = panCrop(DEFAULT_CROP, { dx: 100, scale: 0.5 });
    const fullSize = panCrop(DEFAULT_CROP, { dx: 200, scale: 1 });
    expect(halfSize.x).toBe(fullSize.x);
    expect(halfSize.x).toBeCloseTo((200 / PHOTO_WINDOW.width) * 100, 1);
  });

  it('moves the same distance at every zoom level', () => {
    // translate(x%, y%) scale(z) composes as translate-then-scale, so the
    // translation is in the card's own space and is not multiplied by zoom.
    // Dividing by zoom here would make zoomed-in drags lag the cursor.
    const at1 = panCrop({ ...DEFAULT_CROP, zoom: 1 }, { dx: 100, scale: 1 });
    const at3 = panCrop({ ...DEFAULT_CROP, zoom: 3 }, { dx: 100, scale: 1 });
    expect(at1.x).toBe(at3.x);
  });

  it('is applied once from the drag origin, not accumulated per event', () => {
    // This is how CropEditor drives it: it holds the crop as of pointerdown and
    // passes the TOTAL delta on every move. Applying one 800px delta and
    // applying eight 100px ones must land in the same place, and only the
    // from-origin form is exact — see the rounding-drift case below.
    const total = panCrop(DEFAULT_CROP, { dx: 800, dy: 400, scale: 1 });
    expect(total).toEqual(panCrop(DEFAULT_CROP, { dx: 400, dy: 200, scale: 0.5 }));
  });

  it('drifts only within rounding when applied incrementally', () => {
    let crop = DEFAULT_CROP;
    for (let i = 0; i < 8; i += 1) crop = panCrop(crop, { dx: 100, dy: 50, scale: 1 });
    const once = panCrop(DEFAULT_CROP, { dx: 800, dy: 400, scale: 1 });
    expect(crop.x).toBeCloseTo(once.x, 1);
    expect(crop.y).toBeCloseTo(once.y, 1);
  });

  it('preserves zoom while panning', () => {
    expect(panCrop({ x: 0, y: 0, zoom: 2.4 }, { dx: 10, scale: 1 }).zoom).toBe(2.4);
  });

  it('stops a runaway drag from flinging the photo out of reach', () => {
    const far = panCrop(DEFAULT_CROP, { dx: 99999, dy: -99999, scale: 1 });
    expect(far.x).toBe(200);
    expect(far.y).toBe(-200);
  });

  it('treats a zero or missing scale as 1 instead of dividing by zero', () => {
    expect(panCrop(DEFAULT_CROP, { dx: 100, scale: 0 }).x).toBe(
      panCrop(DEFAULT_CROP, { dx: 100, scale: 1 }).x
    );
    expect(Number.isFinite(panCrop(DEFAULT_CROP, { dx: 100 }).x)).toBe(true);
  });

  it('rounds to two decimals so crops.json stays readable', () => {
    expect(String(panCrop(DEFAULT_CROP, { dx: 7, scale: 0.37 }).x)).toMatch(/^-?\d+(\.\d{1,2})?$/);
  });
});

describe('setZoom and zoomByWheel', () => {
  it('sets an absolute zoom without disturbing the pan', () => {
    expect(setZoom({ x: 12, y: -3, zoom: 1 }, 2.5)).toEqual({ x: 12, y: -3, zoom: 2.5 });
  });

  it('zooms in when the wheel scrolls up', () => {
    expect(zoomByWheel(DEFAULT_CROP, -100).zoom).toBeGreaterThan(1);
  });

  it('cannot be scrolled past either limit', () => {
    expect(zoomByWheel({ x: 0, y: 0, zoom: ZOOM_MAX }, -1000).zoom).toBe(ZOOM_MAX);
    expect(zoomByWheel({ x: 0, y: 0, zoom: ZOOM_MIN }, 1000).zoom).toBe(ZOOM_MIN);
  });
});

describe('resetCrop and isDefaultCrop', () => {
  it('returns a fresh copy, not the shared default object', () => {
    const reset = resetCrop();
    expect(reset).toEqual(DEFAULT_CROP);
    expect(reset).not.toBe(DEFAULT_CROP);
  });

  it('recognises an untouched crop', () => {
    expect(isDefaultCrop(undefined)).toBe(true);
    expect(isDefaultCrop({ x: 0, y: 0, zoom: 1 })).toBe(true);
    expect(isDefaultCrop({ x: 0.01, y: 0, zoom: 1 })).toBe(false);
    expect(isDefaultCrop({ x: 0, y: 0, zoom: 1.2 })).toBe(false);
  });
});

describe('pruneCrops', () => {
  it('drops default entries so crops.json records decisions, not visits', () => {
    expect(
      pruneCrops({
        Kevin_Durant: { x: 4, y: 0, zoom: 1 },
        Tyrese_Maxey: { x: 0, y: 0, zoom: 1 },
      })
    ).toEqual({ Kevin_Durant: { x: 4, y: 0, zoom: 1 } });
  });

  it('normalizes what it keeps and survives an empty map', () => {
    expect(pruneCrops({ A: { x: 3 } })).toEqual({ A: { x: 3, y: 0, zoom: 1 } });
    expect(pruneCrops(undefined)).toEqual({});
  });
});
