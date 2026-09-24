// WHICH FACES ARE OLDER THAN THEIR PHOTOS (2026-09-24). The user: "New photos
// don't seem to be pushing to my cards." The game shows the exported face PNG
// (public/cards/{set}/{id}.png, and its thumb), never the photo itself, and a
// Studio upload writes only the photo. That day 32 photos had been dropped in
// since the last export, and every one of those cards still wore its old face.
//
// `npm run export:cards -- --all --stale` exports exactly those: a card whose
// photo is newer than its face, or that has a photo and no face at all.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, parse } from 'node:path';

/** The extensions the studio serves a photo under (src/cards/photo.js, the photoExt map). */
export const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.avif']);

/** Every card id with a photo in `photosDir`, mapped to its file's mtime. Subfolders (`_replaced/`) and non-images are not photos. */
export function photoTimes(photosDir) {
  const times = new Map();
  if (!existsSync(photosDir)) return times;
  for (const f of readdirSync(photosDir)) {
    const { name, ext } = parse(f);
    if (!PHOTO_EXTS.has(ext.toLowerCase())) continue;
    const st = statSync(join(photosDir, f));
    if (!st.isFile()) continue;
    times.set(name, Math.max(times.get(name) ?? 0, st.mtimeMs));
  }
  return times;
}

/**
 * Why `id`'s face is out of date, or null when it is current (or the card has
 * no photo, so nothing newer can exist). `faceFile` is the exported PNG.
 */
export function staleReason(photos, id, faceFile) {
  const photo = photos.get(id);
  if (photo == null) return null;
  if (!existsSync(faceFile)) return 'no face';
  return photo > statSync(faceFile).mtimeMs ? 'new photo' : null;
}
