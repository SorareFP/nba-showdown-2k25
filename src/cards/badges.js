// CARD-TYPE BADGES — the pill in the sidebar that says what KIND of card this
// is: "SUPER SEASON", "ROOKIE".
//
// ── WHY THIS IS ITS OWN FILE, AND WHY THE BADGE IS A CARD PROPERTY ──────────
//
// It used to be a SET property, one string on each row of SETS, and that was
// the same shape as the rule it served: a player whose best season IS the most
// recent one was EXCLUDED from the Super Season set, and likewise for the
// Rookie set, so a badge could only ever appear on a card in one of those two
// sets. The exclusion threw the fact away — 149 players are known to have just
// had their best season and nothing on any card said so.
//
// The user's call: "if there is any overlap between 2026-27 cards, Super Season
// and Rookie Cards, you can combine them. If 2025-26 was a player's 'Super
// Season' and/or rookie season, add the badges to that player and pull
// prioritize in that order. If last year was their super season, keep the 26-27
// design and just add the badge."
//
// So the badge detaches from the set. A CARD carries a list of badge ids; a SET
// may declare one that every card in it carries (which is how the two special
// sets keep exactly the behaviour they had); and `pickBadge` resolves the union
// of the two down to the ONE that prints. Nothing here special-cases 2026-27 —
// the base set is simply the first set whose cards carry their own badges, and
// the next set that needs one needs no new mechanism.
//
// ── PRIORITY IS DECLARATION ORDER ───────────────────────────────────────────
//
// "pull prioritize in that order" — Super Season first, Rookie second. The
// order of BADGES below IS that rule, so there is no separate priority table to
// keep in step with the list. One badge prints, never two: the pill is 127px in
// a 135px bar and a second one would cost the sidebar a row it does not have.
//
// WORTH KNOWING BEFORE YOU CHANGE THE ORDER: on the current data the rookie
// badge never wins on a base card, and that is structural rather than a
// coincidence. A player whose FIRST season is the most recent one has only one
// season, so it is also his BEST one — every rookie-excluded player is
// therefore also super-season-excluded (33 of 33, checked). Swapping the two
// rows below would move all 33 to ROOKIE. It is one line, and it is a design
// decision rather than a bug, which is why this note is here rather than a
// carve-out in the code.
//
// ── THE COLOURS ARE DERIVED, NEVER WRITTEN DOWN ─────────────────────────────
//
// Same rule as everything else on the card: `fill` is a FUNCTION of the derived
// field theme, so a badge is measured against the field it lands on rather than
// hoping a fixed hex reads on thirty-seven of them. Both fills were already
// contrast-cleared before this file existed — the gold through `readableOn`,
// the team accent as `deriveFieldTheme` resolved it — and both are swept over
// every live and defunct franchise, on treated AND untreated fields, in
// src/cards/treatments.test.js.
import { MIN_ACCENT_CONTRAST, pickInkFor, readableOn } from './fieldTheme.js';
import { GOLD } from './treatments.js';

/**
 * The badge ids.
 *
 * They are spelled the same as the SET ids in sets.js on purpose — a Super
 * Season card is a Super Season card whether it got there by being in that set
 * or by carrying the badge on its base card — but they are a DIFFERENT
 * namespace, and nothing may join the two on string equality. A set declares
 * which badge its cards carry (see `badge` in SETS); that is the only link.
 */
export const SUPER_SEASON_BADGE = 'super-season';
export const ROOKIE_BADGE = 'rookie';

/**
 * Every badge, IN PRIORITY ORDER. See the header: this list is the rule.
 *
 * `fill` takes the UNTREATED field theme — `deriveFieldTheme`'s output, before
 * `applyTreatment` — and that is load-bearing for the Rookie badge. The green
 * treatment replaces `accentOnField` with its green, so a badge computed from
 * the treated theme would come out green on a rookie card and lose the one
 * thing that badge is for: "Rookie can just be secondary/accent team color", in
 * the user's words, because the card is about the franchise a player came into
 * the league with. CardTemplate passes the base theme for exactly this reason.
 */
export const BADGES = [
  {
    id: SUPER_SEASON_BADGE,
    // Uppercase in the DATA, not via text-transform: this is the string the
    // width budget in CardTemplate.test.js measures, and a transform would hide
    // the real one from it.
    text: 'SUPER SEASON',
    // "Super Season can be gold." The same GOLD the foil treatment is built on
    // — imported rather than restated, so the pill on an untreated 2026-27 card
    // and the pill on a foil Super Season card cannot drift apart — nudged only
    // as far as it must go to clear the field it sits on.
    fill: theme => readableOn(GOLD, theme.field, MIN_ACCENT_CONTRAST),
  },
  {
    id: ROOKIE_BADGE,
    text: 'ROOKIE',
    // The TEAM's accent, already cleared against the field by deriveFieldTheme.
    // Half the league falls back to cream, which makes a pale pill with
    // near-black type; that is a real team colour and it stays.
    fill: theme => theme.accentOnField,
  },
];

const BADGES_BY_ID = new Map(BADGES.map(b => [b.id, b]));

/** Just the ids, in priority order. */
export const BADGE_IDS = BADGES.map(b => b.id);

/** The declared badge with this id, or null. Own-property lookup, never a prototype hit. */
export function getBadge(id) {
  return BADGES_BY_ID.get(id) ?? null;
}

/**
 * The ONE badge that prints, from every badge id that applies to a card.
 *
 * Takes a list rather than a set/card pair so that this file never has to
 * import sets.js — the caller unions the set's declared badge with the card's
 * own. Unknown ids and nulls are ignored rather than throwing: a data file
 * naming a badge this build does not have should cost that card its pill, not
 * the whole studio.
 */
export function pickBadge(ids) {
  if (!Array.isArray(ids)) return null;
  const wanted = new Set(ids.filter(id => typeof id === 'string'));
  return BADGES.find(b => wanted.has(b.id)) ?? null;
}

/**
 * A badge's two colours on one field: the pill and the type on it.
 *
 * The ink is `pickInkFor` of the fill — picked against the pill, because that
 * is what the label is printed on — exactly as it was when this lived in
 * treatments.js.
 */
export function badgeColors(theme, badge) {
  if (!badge || !theme) return null;
  const fill = badge.fill(theme);
  return { fill, ink: pickInkFor(fill) };
}

/**
 * The badge's colours as CSS custom properties.
 *
 * NOTHING when there is no badge, so a card without one carries no badge
 * properties at all and `.badge`'s `var(--badge-fill, …)` fallbacks are never
 * reached in the sets that ship today. They exist for the case this file makes
 * possible and does not yet contain: a badge id in a data file that this build
 * does not declare.
 */
export function badgeVars(theme, badge) {
  const colors = badgeColors(theme, badge);
  if (!colors) return {};
  return { '--badge-fill': colors.fill, '--badge-ink': colors.ink };
}
