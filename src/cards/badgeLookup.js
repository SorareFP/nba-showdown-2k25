// THE BADGES A CARD WEARS, looked up the way the print looks them up.
//
// A base-set card's badges are not on the card object: they live in
// card-data/generated/card-badges.json (and wnba-card-badges.json), the file
// the Super Season generator writes for every base player it EXCLUDED because
// his best season is the current one. The studio merges that file onto its
// cards before rendering (src/studio/players.js, `badgesById`), so the printed
// face of a $900+ base card with the pill wears the gold foil — and the app,
// which only had `card.badges` (absent on every base card), could not tell.
// The user, 2026-09-06: "Not seeing the sheen on the gold/gilded parts of
// super seasons in the base set."
//
// Same import.meta.glob treatment as the studio, for the same reason: the
// files are generated, and a checkout without them must still run — with no
// badges, which is the same answer a card with none gives.
import { CURRENT_SET, WNBA_SET } from './sets.js';

const nbaModules = import.meta.glob('../../card-data/generated/card-badges.json', { eager: true });
const wnbaModules = import.meta.glob('../../card-data/generated/wnba-card-badges.json', { eager: true });

function mapOf(modules, set) {
  const file = Object.values(modules)[0]?.default ?? null;
  const rows = file?.set === set && Array.isArray(file.badges) ? file.badges : [];
  return new Map(rows.map(b => [b.id, b.badges ?? []]));
}

const BY_SET = new Map([
  [CURRENT_SET, mapOf(nbaModules, CURRENT_SET)],
  [WNBA_SET, mapOf(wnbaModules, WNBA_SET)],
]);

/**
 * The badges for a card: its own `badges` field when it carries one (the
 * special sets and the migrated rewards do), else the base-set file's row for
 * its id, else none.
 */
export function badgesFor(card) {
  if (!card) return [];
  if (Array.isArray(card.badges)) return card.badges;
  return BY_SET.get(card.set)?.get(card.id) ?? [];
}
