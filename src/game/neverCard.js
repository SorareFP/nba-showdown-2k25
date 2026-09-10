// PLAYERS WHO NEVER GET A CARD, in any set, by any route: the generators,
// the Free Agent quote index, and the request form all read this one list.
//
// Enes Kanter / Enes Freedom: a standing rule. Royce White and the message
// came with the request form (the user, 2026-09-10: "auto-reject any entries
// of Enes Kanter, Enes Freedom, Enes Kanter Freedom, or Royce White, and have
// it say 'That guys sucks, he's not getting a card.'").
//
// No imports on purpose: the card scripts and the server bundle both load it.

export const NEVER_CARD_NAMES = ['Enes Kanter', 'Enes Freedom', 'Enes Kanter Freedom', 'Royce White'];

/** Word for word, the user's. */
export const AUTO_REJECT_MESSAGE = "That guys sucks, he's not getting a card.";

/** Accents off, letters only, lower case: how the card scripts compare names. */
export function normName(name) {
  return String(name ?? '')
    .normalize('NFD')
    // Escapes, not literal combining marks, which are invisible in an editor.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

const NEVER = new Set(NEVER_CARD_NAMES.map(normName));

export function isNeverCard(name) {
  return NEVER.has(normName(name));
}

/**
 * When the search box has said enough to mean one of them: the first name
 * and the surname's first letter (the user, 2026-09-10: wait until the field
 * says "Enes F", "Enes K" and "Royce W"). Matching four letters of any of
 * them fired on "Enes" alone, and on "white" and "free", which blocked
 * searching for Coby White or Hassan Whiteside. The two surnames nobody else
 * carries count on their own; "White" does not.
 */
const NEVER_PREFIXES = ['Enes F', 'Enes K', 'Royce W'].map(normName);
const NEVER_SURNAMES = ['Kanter', 'Freedom'].map(normName);

export function searchHitsNeverCard(text) {
  const q = normName(text);
  return NEVER_PREFIXES.some(p => q.startsWith(p)) || NEVER_SURNAMES.some(s => q.includes(s));
}
