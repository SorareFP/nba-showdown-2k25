// The sheen's geometry is the template's geometry: these numbers are pinned
// against CardTemplate.module.css so a moved photo window moves the sheen.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_WIDTH, CARD_HEIGHT } from './CardTemplate.jsx';
import {
  FACE_W, FACE_H, PHOTO_POLYGON, BAND_POLYGON, FRAME_RING, clipPathFor, wearsGold, holoRegionsFor,
} from './faceRegions.js';
import { SUPER_SEASON_SET, WNBA_SUPER_SEASON_SET, ROOKIE_SET, BASE_SET } from './sets.js';

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'CardTemplate.module.css'), 'utf8');
const rule = (name, prop) => {
  const block = css.slice(css.indexOf(`.${name} {`));
  const m = block.slice(0, block.indexOf('}')).match(new RegExp(`${prop}:\\s*([\\d.]+)px`));
  return m ? Number(m[1]) : null;
};

describe('faceRegions', () => {
  it('measures the same face the template exports', () => {
    expect([FACE_W, FACE_H]).toEqual([CARD_WIDTH, CARD_HEIGHT]);
  });

  it('puts the photo window where .photoOuter is, cut at the sidebar', () => {
    const left = rule('photoOuter', 'left');
    const top = rule('photoOuter', 'top');
    const sidebar = rule('sidebarScrim', 'left');
    expect(left).toBe(150);
    expect(top).toBe(110);
    expect(sidebar).toBe(701);
    const xs = PHOTO_POLYGON.map(([x]) => x);
    const ys = PHOTO_POLYGON.map(([, y]) => y);
    expect(Math.min(...xs)).toBeCloseTo(left / FACE_W, 4);
    expect(Math.max(...xs)).toBeCloseTo(sidebar / FACE_W, 4);
    expect(Math.min(...ys)).toBeCloseTo(top / FACE_H, 4);
  });

  it('puts the gold band where .topBand is and the ring where the treatment frame is', () => {
    expect(BAND_POLYGON[2][1]).toBeCloseTo(rule('topBand', 'height') / FACE_H, 4);
    expect(FRAME_RING.inner[0][0]).toBeCloseTo(7 / FACE_W, 4);
    expect(css).toMatch(/\.treatmentFrame \{[^}]*border: 7px solid transparent/);
  });

  it('emits clip-paths in percentages, even-odd for the ring', () => {
    expect(clipPathFor('photo')).toMatch(/^polygon\(17\.79% 13\.04%, 23\.01% 9\.31%, 83\.16% 9\.31%/);
    expect(clipPathFor('band')).toBe('polygon(0.00% 0.00%, 100.00% 0.00%, 100.00% 9.48%, 0.00% 9.48%)');
    expect(clipPathFor('frame')).toMatch(/^polygon\(evenodd, 0\.00% 0\.00%, 100\.00% 0\.00%/);
    expect(clipPathFor('nope')).toBe('none');
  });

  it('gives the gold only to Super Season cards, by set, badge or origin', () => {
    expect(holoRegionsFor({ set: BASE_SET })).toEqual(['photo']);
    expect(holoRegionsFor({ set: ROOKIE_SET })).toEqual(['photo']);
    expect(holoRegionsFor({ set: SUPER_SEASON_SET })).toEqual(['photo', 'band', 'frame']);
    expect(holoRegionsFor({ set: WNBA_SUPER_SEASON_SET })).toEqual(['photo', 'band', 'frame']);
    expect(wearsGold({ set: 'set-rewards', migratedFrom: { set: SUPER_SEASON_SET } })).toBe(true);
    expect(wearsGold({ set: 'wnba-team-rewards', badges: ['super-season'] })).toBe(true);
    expect(wearsGold(null)).toBe(false);
  });
});
