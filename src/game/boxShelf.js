// THE BOX SHELF (2026-10-21). The user: "The packs earned from the Climb show
// up as booster box packs, not the actual kind of pack they are." Every box
// on the shelf read "A booster box", and opening one dealt a reveal named
// "Booster Box" — but a Climb pot pays its bosses' packs (a Booster, a Rare
// Deluxe, a Mega Deluxe) as boxes of one (functions/index.js climbBank). A box
// is named by what is in it, and a box of one opens as that pack.
import { PACK_TYPES } from './packEngine.js';

const packsIn = box => (box?.left ?? 0) + (box?.bonusLeft ?? 0);

/** What a box on the shelf says: `title`, and the line under it. */
export function boxShelfLine(box) {
  const n = packsIn(box);
  const name = PACK_TYPES[box?.packType]?.name ?? 'Pack';
  if (box?.boughtAs === 'climb') {
    return { title: n === 1 ? `${name} to open` : `${n} packs to open`, line: `From The Climb's pot: ${n === 1 ? 'a' : 'each'} ${name}, rolled when you open it.` };
  }
  if (box?.boughtAs === 'booster_box' || n > 1) {
    return { title: `${n} packs still to open`, line: 'A booster box on the shelf. Each pack is rolled when you open it — nothing is decided yet.' };
  }
  return { title: `${name} to open`, line: 'On the shelf, rolled when you open it.' };
}

/**
 * The reveal for a box's first pack, from the server's answer (`first`:
 * `{ cards, packType, left, bonusLeft }`). A box with more to come opens as a
 * box — the Booster Box's flow, put-down included — its cards carrying their
 * own pack's name for the wrapper; a box of one opens as that pack.
 */
export function boxReveal(box, first) {
  const more = (first?.left ?? 0) + (first?.bonusLeft ?? 0) > 0;
  if (!more && box?.boughtAs !== 'booster_box') {
    return { cards: first.cards, packType: first.packType, options: {} };
  }
  return {
    cards: tagPack(first.cards, 0, first.packType),
    packType: 'booster_box',
    options: {},
    box: { id: box.id, left: first.left, bonusLeft: first.bonusLeft },
  };
}

/** A box's pack of cards, numbered and named for the reveal. */
export function tagPack(cards, packIndex, packType) {
  return (cards ?? []).map(c => ({ ...c, packIndex, packType: c.packType ?? packType }));
}
