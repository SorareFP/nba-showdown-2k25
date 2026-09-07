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
import { cardTreatment } from './sets.js';
import { badgesFor } from './badgeLookup.js';
import { getPlayerRarity } from '../game/rarity.js';

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

/**
 * Whether a card's PRINTED face wears the gold foil — asked of the same rule
 * the template asks (`cardTreatment`): the two Super Season sets declare it,
 * and a base card with the Super Season pill at $900 and up earns it (the
 * Brandon Miller case, 2026-09-02). Base cards do not carry their badges, so
 * the lookup goes through badgeLookup.js, which reads the generator's file
 * exactly as the studio does before it renders. The user, 2026-09-06: "Not
 * seeing the sheen on the gold/gilded parts of super seasons in the base set."
 */
export function wearsGold(card) {
  if (!card) return false;
  return cardTreatment(card.set, card.salary, badgesFor(card)) === 'gold-foil';
}

/**
 * The regions the sheen covers on this card — and, by being empty, whether it
 * gets one at all. Two triggers, two places:
 *
 *   legendary  → the PHOTO (the original ask: "a holographic sheen on
 *                legendary cards")
 *   gilded     → the gold BAND and FRAME, at any rarity. The user, seeing
 *                LaMelo Ball, Jaylen Brown and Stephon Castle — gilded base
 *                cards at $1,030-1,170, super-rare — with nothing: "I still
 *                don't see any sheen on some base set super seasons". The
 *                foil IS the Super Season styling, so every face that prints
 *                it shimmers on it.
 *
 * A legendary Super Season gets all three; a plain common gets none.
 */
export function holoRegionsFor(card) {
  if (!card) return [];
  const regions = [];
  if (getPlayerRarity(card) === 'legendary') regions.push('photo');
  if (wearsGold(card)) regions.push('band', 'frame');
  return regions;
}
