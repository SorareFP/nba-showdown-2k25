// `export:cards --stale` re-exports a face only when its photo moved on
// (staleFaces.mjs). Real files in a temp folder, since the rule is mtimes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { photoTimes, staleReason } from './staleFaces.mjs';

let dir;
const at = (file, secondsAgo) => {
  const t = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(file, t, t);
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stale-faces-'));
  mkdirSync(join(dir, 'photos', '_replaced'), { recursive: true });
  mkdirSync(join(dir, 'faces'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('a stale face', () => {
  it('is a face older than the photo dropped in after it', () => {
    const photo = join(dir, 'photos', 'Pau_Gasol.avif');
    const face = join(dir, 'faces', 'Pau_Gasol.png');
    writeFileSync(photo, 'p'); writeFileSync(face, 'f');
    at(face, 3600); at(photo, 60);
    expect(staleReason(photoTimes(join(dir, 'photos')), 'Pau_Gasol', face)).toBe('new photo');
    at(face, 10);
    expect(staleReason(photoTimes(join(dir, 'photos')), 'Pau_Gasol', face)).toBeNull();
  });

  it('is a missing face for a card that has a photo, and never a card with no photo', () => {
    writeFileSync(join(dir, 'photos', 'Kobe_Bryant.jpg'), 'p');
    const photos = photoTimes(join(dir, 'photos'));
    expect(staleReason(photos, 'Kobe_Bryant', join(dir, 'faces', 'Kobe_Bryant.png'))).toBe('no face');
    expect(staleReason(photos, 'Nobody', join(dir, 'faces', 'Nobody.png'))).toBeNull();
  });

  it('reads only images at the top of the folder: not _replaced/, not _placeholders.json', () => {
    writeFileSync(join(dir, 'photos', '_replaced', 'Old_Photo.jpg'), 'p');
    writeFileSync(join(dir, 'photos', '_placeholders.json'), '[]');
    writeFileSync(join(dir, 'photos', 'Tina_Charles.JPEG'), 'p');
    expect([...photoTimes(join(dir, 'photos')).keys()]).toEqual(['Tina_Charles']);
    expect(photoTimes(join(dir, 'nowhere')).size).toBe(0);
  });
});
