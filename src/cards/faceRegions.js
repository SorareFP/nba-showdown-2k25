// WHERE THINGS ARE ON A PRINTED FACE, as fractions of the 843 x 1181 export.
//
// The app shows a card as a flat PNG, so anything that wants to sit on one
// part of it — the holographic sheen (src/components/HoloSheen.jsx) — needs
// the template's geometry restated in fractions. The FIXED surfaces come
// straight from CardTemplate.module.css and CardTemplate.jsx (CARD_WIDTH /
// CARD_HEIGHT) and must move with them: a change to `.photoOuter` or
// `.topBand` is a change here; faceRegions.test.js pins the numbers against
// the stylesheet's own. The MOVABLE ones — the rotated name, whose length is
// the player's, and the Super Season pill, which stacks under whatever marks
// the sidebar holds — are measured per face at export time
// (scripts/studio/export.js) into card-data/generated/face-regions.json and
// read here, with the name's slot as the fallback when a face was never
// measured.
//
// ── WHAT THE SHEEN COVERS (the user, 2026-09-06) ────────────────────────────
//
//   "just the photo area of the card, as well as the gold parts of the super
//    season styling" — then, on seeing LaMelo, Jaylen Brown and Stephon
//   Castle bare: "make the gilded sheen (for super seasons only) work for
//   anyone who isn't legendary, we just won't make the photo box holographic"
//   — then: "the name and super season badge to be holographic too, because
//   they are made gold by the super season styling."
//
// So: the PHOTO on a legendary; on any face the print gilds, the four gold
// surfaces — the top band, the frame ring, the name, the Super Season pill.
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

/** `.nameSlot`: the column the rotated name is centred in — the fallback when a face has no measurement. */
export const NAME_SLOT = [fx(0), fy(118), fx(148), fy(900)];

const pct = v => `${(v * 100).toFixed(2)}%`;
const points = poly => poly.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(', ');
const rectPolygon = ([x, y, w, h]) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

/** The CSS clip-path for a fixed region, in percentages of the face box. */
export function clipPathFor(region) {
  switch (region) {
    case 'photo': return `polygon(${points(PHOTO_POLYGON)})`;
    case 'band': return `polygon(${points(BAND_POLYGON)})`;
    case 'frame': return `polygon(evenodd, ${points(FRAME_RING.outer)}, ${points(FRAME_RING.inner)})`;
    case 'name': return `polygon(${points(rectPolygon(NAME_SLOT))})`;
    default: return 'none';
  }
}

/** A clip-path for a measured box [x, y, w, h] in face fractions, padded a hair so glyph edges are inside it. */
export function clipPathForBox(box, pad = 0.004) {
  const [x, y, w, h] = box;
  return `polygon(${points(rectPolygon([x - pad, y - pad, w + 2 * pad, h + 2 * pad]))})`;
}

// ── The measurements ────────────────────────────────────────────────────────
// Same import.meta.glob treatment as badgeLookup.js: the file is generated,
// and a checkout without it must still run — with the name's slot and no pill.
const regionModules = import.meta.glob('../../card-data/generated/face-regions.json', { eager: true });
const MEASURED = Object.values(regionModules)[0]?.default?.faces ?? {};

/** The measured boxes for a card's face, or null when it was never measured. */
export function measuredFor(card) {
  if (!card?.set || !card?.id) return null;
  return MEASURED[`${card.set}/${card.id}`] ?? null;
}

/**
 * Whether a card's PRINTED face wears the gold foil — asked of the same rule
 * the template asks (`cardTreatment`): the two Super Season sets declare it,
 * and a base card with the Super Season pill at $900 and up earns it (the
 * Brandon Miller case, 2026-09-02). Base cards do not carry their badges, so
 * the lookup goes through badgeLookup.js, which reads the generator's file
 * exactly as the studio does before it renders.
 */
export function wearsGold(card) {
  if (!card) return false;
  return cardTreatment(card.set, card.salary, badgesFor(card)) === 'gold-foil';
}

/**
 * The regions the sheen covers on this card, as `{ key, clip }` — and, by
 * being empty, whether it gets one at all. A legendary Super Season gets all
 * five; a plain common gets none.
 */
export function holoRegionsFor(card) {
  if (!card) return [];
  const out = [];
  if (getPlayerRarity(card) === 'legendary') out.push({ key: 'photo', clip: clipPathFor('photo') });
  if (wearsGold(card)) {
    const m = measuredFor(card);
    out.push({ key: 'band', clip: clipPathFor('band') });
    out.push({ key: 'frame', clip: clipPathFor('frame') });
    out.push({ key: 'name', clip: m?.name ? clipPathForBox(m.name) : clipPathFor('name') });
    if (m?.badge) out.push({ key: 'badge', clip: clipPathForBox(m.badge) });
  }
  return out;
}
