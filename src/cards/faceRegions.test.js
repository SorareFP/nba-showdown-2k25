// The sheen's geometry is the template's geometry: these numbers are pinned
// against CardTemplate.module.css so a moved photo window moves the sheen.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_WIDTH, CARD_HEIGHT } from './CardTemplate.jsx';
import {
  FACE_W, FACE_H, PHOTO_POLYGON, BAND_POLYGON, FRAME_RING, NAME_SLOT, clipPathFor, wearsGold, holoRegionsFor,
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

  it('gives the photo to a legendary and the four gold surfaces to every gilded face', () => {
    const keys = card => holoRegionsFor(card).map(r => r.key);
    // A legendary Super Season gets the photo and the gold; a super-rare one only the gold.
    // (These synthetic cards have no measurement, so the name falls back to its slot and there is no pill.)
    expect(keys({ set: SUPER_SEASON_SET, salary: 1200 })).toEqual(['photo', 'band', 'frame', 'name']);
    expect(keys({ set: WNBA_SUPER_SEASON_SET, salary: 1200 })).toEqual(['photo', 'band', 'frame', 'name']);
    expect(keys({ set: SUPER_SEASON_SET, salary: 950 })).toEqual(['band', 'frame', 'name']);
    // A plain legendary gets the photo; a plain rookie or common gets nothing.
    expect(keys({ set: BASE_SET, id: 'Nobody', salary: 1300 })).toEqual(['photo']);
    expect(keys({ set: ROOKIE_SET, salary: 1300 })).toEqual(['photo']);
    expect(keys({ set: BASE_SET, id: 'Nobody', salary: 400 })).toEqual([]);
    expect(holoRegionsFor(null)).toEqual([]);
    // The user's three: gilded base cards under the legendary line get the gold.
    expect(keys({ set: BASE_SET, salary: 1170, badges: ['super-season'] })).toEqual(['band', 'frame', 'name']);
    // Every region carries its own clip.
    for (const r of holoRegionsFor({ set: SUPER_SEASON_SET, salary: 1200 })) expect(r.clip).toMatch(/^polygon\(/);
    // A base card wearing the Super Season pill is gilded at $900 and up (the
    // badge is on the card here; base cards in the app get it from the file).
    expect(wearsGold({ set: BASE_SET, salary: 1200, badges: ['super-season'] })).toBe(true);
    expect(wearsGold({ set: BASE_SET, salary: 850, badges: ['super-season'] })).toBe(false);
    expect(wearsGold({ set: BASE_SET, salary: 1200, badges: ['super-season', 'rookie'] })).toBe(false);
    // A capstone migrated from Super Season prints in the reward set's bronze, not gold.
    expect(wearsGold({ set: 'set-rewards', salary: 1400, badges: ['super-season', 'set-reward'], migratedFrom: { set: SUPER_SEASON_SET } })).toBe(false);
    expect(wearsGold(null)).toBe(false);
  });

  it('reads the exporter\'s measurements: a name box on every measured face, a pill box on every gilded one', async () => {
    const { measuredFor } = await import('./faceRegions.js');
    const { CARD_SETS } = await import('../game/cardSets.js');
    const { CURRENT_SET } = await import('./sets.js');
    const base = CARD_SETS[CURRENT_SET];
    const measured = base.map(c => ({ c, m: measuredFor(c) })).filter(x => x.m);
    // The measuring pass (export.js --measure) covered the whole base set.
    expect(measured.length).toBe(base.length);
    for (const { c, m } of measured) {
      expect(m.name, c.name).toHaveLength(4);
      // The name lives in its slot: the left column, above the chart.
      expect(m.name[0]).toBeGreaterThanOrEqual(0);
      expect(m.name[0] + m.name[2]).toBeLessThanOrEqual(NAME_SLOT[0] + NAME_SLOT[2] + 0.01);
      if (wearsGold(c)) expect(m.badge, `${c.name} pill`).toHaveLength(4);
    }
    // LaMelo: gilded, super-rare, the card the user pointed at — name, pill, and all five regions but the photo.
    const lamelo = base.find(c => c.name === 'LaMelo Ball');
    expect(measuredFor(lamelo).badge).toHaveLength(4);
    expect(holoRegionsFor(lamelo).map(r => r.key)).toEqual(['band', 'frame', 'name', 'badge']);
  });

  it('finds a base card\'s badges in the generator\'s file, the way the studio does', async () => {
    const { badgesFor } = await import('./badgeLookup.js');
    const { CARD_SETS } = await import('../game/cardSets.js');
    // The pool the app plays and the badge file describe CURRENT_SET (2026-27);
    // sets.js's BASE_SET is the shipped 2025-26 set.
    const { CURRENT_SET } = await import('./sets.js');
    const base = CARD_SETS[CURRENT_SET];
    // Every base card whose best season is this one carries the pill in the
    // file and none of them carries it on the object.
    const gilded = base.filter(c => wearsGold(c));
    expect(base.some(c => Array.isArray(c.badges))).toBe(false);
    expect(gilded.length).toBeGreaterThan(0);
    for (const c of gilded) {
      expect(badgesFor(c)).toContain('super-season');
      expect(c.salary).toBeGreaterThanOrEqual(900);
    }
    // And the top of the base set, whose best season is now, is among them.
    expect(gilded.map(c => c.name)).toContain('Victor Wembanyama');
  });
});
