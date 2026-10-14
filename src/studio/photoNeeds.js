// ONE ANSWER TO "DOES THIS CARD STILL NEED A PHOTO?" (2026-09-24).
//
// The Photo Hunt (scripts/studio/photoHunt.mjs) and the Card Studio both ask
// it, and while each answered on its own they disagreed — the user: "Photo
// hunt and card studio aren't matching." The studio counted the dormant
// Throwbacks as missing and an MS-Paint placeholder as a photo; the hunt read
// a hand-kept list of "composed" strategy cards that had gone stale (every
// strat face has been composed by the studio since the full export of
// 2026-09-06, and 94 of them wear placeholder art). Both now read this.
//
//   'photo'        a real photo is on disk
//   'placeholder'  the file is placeholder art (a strat's MS-Paint doodle,
//                  listed in card-art/sets/<set>/photos/_placeholders.json):
//                  the card has a face, but the real photo is still wanted
//   'missing'      no photo at all
//   'dormant'      a generator-owned Throwback with no photo, sitting out of
//                  every pack until someone requests it (dormantThrowbacks.mjs):
//                  a photo would wake it, but none is owed — the user (same
//                  day): "This is just too many new photos to find"
//                  UNLESS ITS PHOTO IS WANTED (2026-10-14, the user: "add
//                  Lebron to Photo Hunt plz"): a curated Throwback marked
//                  `photoWanted` still sits out of the packs until it has one,
//                  but it is 'missing', so the hunt lists it
//
// Pure: the caller brings the photo ids, the placeholder ids, the dormant keys
// and the wanted keys (`set:id`), so Node and the browser read it the same way.

/** The state of one card's photo. */
export function photoState(setId, id, { photoIds = new Set(), placeholders = new Set(), dormantKeys = new Set(), wantedKeys = new Set() } = {}) {
  if (photoIds.has(id)) return placeholders.has(id) ? 'placeholder' : 'photo';
  const key = `${setId}:${id}`;
  if (dormantKeys.has(key) && !wantedKeys.has(key)) return 'dormant';
  return 'missing';
}

/** Owed a photo: the hunt lists it and the studio counts it as to go. */
export const needsPhoto = state => state === 'missing' || state === 'placeholder';
