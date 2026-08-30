// A player's stable id, derived from their name.
//
// IT LIVES ALONE IN ITS OWN MODULE because three different things must agree on
// it or curated work is orphaned: the studio (which names photo files and keys
// crops.json by it), the batch export (which finds those photos again), and the
// Node card generators (which write it into
// card-data/generated/cards-2026-27.json so the studio can join stats to the
// player it already has a photo for). The generators run in plain Node and
// cannot import src/studio/players.js — that module pulls in JSON imports and
// import.meta.glob — so without this file the rule would have to be written
// twice, and a second copy of the rule that NAMES FILES is a second chance to
// orphan a season of photographs.
//
// Diacritics are stripped before punctuation is collapsed, so accented names
// survive as readable ASCII ("Luka Doncic", accents and all, becomes
// "Luka_Doncic") rather than collapsing to "Luka_Don_i_". That is this repo's
// existing convention, not a new one: the shipped art is named `Vit_Krejci.png`
// and the shipped ids in src/game/rawCards.js are `Alperen_Sengun`,
// `Nikola_Jokic`.
//
// Unlike the cross-source matching key in scripts/cardgen/resolveTeams.js, this
// PRESERVES case and word separators — it is a filename, meant to be read by a
// human scrolling a set's photos/, so "Luka_Doncic" and not "lukadoncic".
//
// Leading and trailing underscores are trimmed, so "Jabari Smith Jr." is
// `Jabari_Smith_Jr` rather than `Jabari_Smith_Jr_` — again matching the shipped
// ids. Interior punctuation still collapses to one underscore ("De'Aaron Fox"
// -> "De_Aaron_Fox"). Verified collision-free across all 350 pool names and all
// 306 shipped cards, and inside the character set the studio server's path
// guard accepts.
//
// The class is BUILT FROM CODE POINTS rather than typed as a literal character
// range: combining marks are invisible in an editor, so a literal one is
// impossible to review and the first stray copy-paste silently breaks accent
// folding without changing anything anyone can see.
const FIRST_COMBINING_MARK = 0x0300;
const LAST_COMBINING_MARK = 0x036f;
const COMBINING_MARKS = new RegExp(
  `[${String.fromCharCode(FIRST_COMBINING_MARK)}-${String.fromCharCode(LAST_COMBINING_MARK)}]`,
  'g'
);

export function playerIdFromName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
