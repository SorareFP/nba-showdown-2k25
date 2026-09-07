// WHERE THINGS ARE ON A PRINTED FACE, as fractions of the 843 x 1181 export.
//
// The app shows a card as a flat PNG, so anything that wants to sit on one
// part of it — the holographic sheen (src/components/HoloSheen.jsx) — needs
// the template's geometry restated in fractions. These come straight from
// CardTemplate.module.css and CardTemplate.jsx (CARD_WIDTH / CARD_HEIGHT) and
// must move with them: a change to `.photoOuter` or `.topBand` is a change
// here. faceRegions.test.js pins the numbers against the stylesheet's own.
//
// The user (2026-09-06): "can it just be added to the photo area of the card,
// as well as the gold parts of the super season styling?" So: the PHOTO for
// every card that gets a sheen, and on a Super Season card also the two gold
// surfaces the gilded treatment paints — the top band and the frame ring.
// The field's own faint diagonal sheen is a shimmer over the team colour, not
// a gold part, and is left alone.
import { SUPER_SEASON_SET, WNBA_SUPER_SEASON_SET } from './sets.js';
import { SUPER_SEASON_BADGE } from './badges.js';

export const FACE_W = 843;
export const FACE_H = 1181;

const fx = x => x / FACE_W;
const fy = y => y / FACE_H;

/**
 * The photo window as the viewer sees it: `.photoOuter` (150,110, 683 x 806)
 * with its chamfer polygon, cut on the right at 701 where the sidebar scrim
 * covers it. The bottom-right diagonal runs (833,754) -> (612,900); at x=701
 * that line is at y=841.
 */
export const PHOTO_POLYGON = [
  [fx(150), fy(154)], [fx(194), fy(110)], [fx(701), fy(110)],
  [fx(701), fy(841)], [fx(612), fy(900)], [fx(150), fy(900)],
];

/** `.topBand`: the full-width header, 112px tall, where the gold foil lives. */
export const BAND_POLYGON = [[0, 0], [1, 0], [1, fy(112)], [0, fy(112)]];

/** `.treatmentFrame`: a 7px ring around the whole face. Drawn even-odd: outer box, then inner box. */
export const FRAME_RING = {
  outer: [[0, 0], [1, 0], [1, 1], [0, 1]],
  inner: [[fx(7), fy(7)], [1 - fx(7), fy(7)], [1 - fx(7), 1 - fy(7)], [fx(7), 1 - fy(7)]],
};

const pct = v => `${(v * 100).toFixed(2)}%`;
const points = poly => poly.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(', ');

/** The CSS clip-path for a named region, in percentages of the face box. */
export function clipPathFor(region) {
  switch (region) {
    case 'photo': return `polygon(${points(PHOTO_POLYGON)})`;
    case 'band': return `polygon(${points(BAND_POLYGON)})`;
    case 'frame': return `polygon(evenodd, ${points(FRAME_RING.outer)}, ${points(FRAME_RING.inner)})`;
    default: return 'none';
  }
}

/** Whether a card wears the gilded Super Season treatment (by set, badge, or origin). */
export function wearsGold(card) {
  if (!card) return false;
  const sets = [card.set, card.migratedFrom?.set];
  if (sets.some(s => s === SUPER_SEASON_SET || s === WNBA_SUPER_SEASON_SET)) return true;
  return Array.isArray(card.badges) && card.badges.includes(SUPER_SEASON_BADGE);
}

/** The regions the sheen covers on this card: the photo, plus the gold on a Super Season. */
export function holoRegionsFor(card) {
  return wearsGold(card) ? ['photo', 'band', 'frame'] : ['photo'];
}
