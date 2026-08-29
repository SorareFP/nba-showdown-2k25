// Every pure operation the team template editor performs on the override map.
//
// Same split as crop.js: the arithmetic lives here so it can be tested, and
// TeamEditor.jsx only turns events into calls on it.
//
// WHAT THE MAP IS. `card-art/sets/{set}/team-overrides.json`, an object keyed
// by nba.com team abbreviation, each value naming only the fields that differ
// from src/cards/teams.js:
//
//   { "DEN": { "accent": "#FEC524" } }
//
// A team with no key follows teams.js entirely. That is the whole design:
// teams.js stays a faithful record of the OFFICIAL colors — verified against
// TruColor, and correctable upstream — while this file records the taste
// applied on top of it. Which is why removing a key is the reset, and writing
// the official value back in as an override is not: the second one freezes the
// team at today's official color and silently ignores tomorrow's correction.
import { canonicalTeam } from '../cards/teams.js';

/**
 * The fields the editor may set. `accent` is the one that matters — it has no
 * official value at all (the card computes it, see teams.js resolveAccent), so
 * an override is the ONLY way to choose it.
 */
export const THEME_FIELDS = ['primary', 'secondary', 'accent'];

const HEX6 = /^[0-9A-Fa-f]{6}$/;
const HEX3 = /^[0-9A-Fa-f]{3}$/;

/**
 * A pasted or typed color, as `#RRGGBB` — or null if it isn't one yet.
 *
 * Null is a normal answer, not an error: the hex box is a text field the user
 * types INTO, so it spends most of its keystrokes holding "#FEC5" and similar.
 * The caller keeps the draft on screen and only commits when this returns a
 * value, which is what stops a half-typed color from repainting every card on
 * the team mid-keystroke.
 *
 * Accepts a leading "#" or not (pasting from a color picker gives one, pasting
 * from a spreadsheet often doesn't) and expands the 3-digit shorthand. Upper-
 * cased on the way out so the file reads consistently no matter where a value
 * was pasted from — <input type="color"> hands back lowercase, TruColor's page
 * is uppercase.
 */
export function normalizeHex(input) {
  const raw = String(input ?? '').trim().replace(/^#/, '');
  if (HEX6.test(raw)) return `#${raw.toUpperCase()}`;
  if (HEX3.test(raw)) {
    const [r, g, b] = raw.toUpperCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

/** True when `input` is already a committable color. */
export function isValidHex(input) {
  return normalizeHex(input) !== null;
}

/**
 * True when `input` is a color that cannot still grow into a different one.
 *
 * The distinction matters only while someone is TYPING, and it is the whole
 * difference between a hex box that works and one that fights back. Six digits
 * are final — nothing can be appended that keeps it a color. Three digits are
 * not: "#008" is a perfectly valid color (#000088) AND a prefix of "#008080",
 * so committing it on the way past both repaints every card on the team the
 * wrong color and — because the field then shows the committed value — rewrites
 * what the user was halfway through typing. "#008080" becomes untypeable.
 *
 * So the editor auto-commits on this, and leaves the shorthand to Enter or
 * blur, when the user has said they are finished.
 */
export function isUnambiguousHex(input) {
  return HEX6.test(String(input ?? '').trim().replace(/^#/, ''));
}

/**
 * Only the fields of an override that actually override something.
 *
 * Blank strings, nulls and stray keys are dropped, so a team whose every value
 * has been cleared prunes down to nothing and disappears from the file.
 */
function cleanEntry(entry) {
  const out = {};
  if (!entry || typeof entry !== 'object') return out;
  for (const field of THEME_FIELDS) {
    const hex = normalizeHex(entry[field]);
    if (hex) out[field] = hex;
  }
  return out;
}

/**
 * The map as it should be written to disk: canonical keys, normalized colors,
 * no empty entries.
 *
 * The studio calls this immediately before POSTing, exactly as it calls
 * pruneCrops — the file is a record of decisions, and an empty `{ "DEN": {} }`
 * records nothing while still counting as a customised team in the UI.
 *
 * Keys come out sorted because this file is read by humans and diffed by git;
 * an override map whose key order depends on which team was edited first
 * produces a noisy diff for a one-color change.
 */
export function pruneTeamOverrides(overrides) {
  const out = {};
  for (const abbr of Object.keys(overrides ?? {}).sort()) {
    const entry = cleanEntry(overrides[abbr]);
    if (Object.keys(entry).length) out[canonicalTeam(abbr)] = entry;
  }
  return out;
}

/**
 * The map with one team's one color set.
 *
 * The key is canonicalized on the way IN as well as on the way out (teams.js
 * does the latter), so editing while a Basketball-Reference-spelled player is
 * selected writes "BKN" and not a second, shadow "BRK" entry that would then
 * lose to it.
 *
 * An invalid hex is a no-op rather than a write: the caller is free to pass
 * whatever is currently in the text box.
 */
export function setTeamColor(overrides, abbr, field, value) {
  const hex = normalizeHex(value);
  if (!hex || !THEME_FIELDS.includes(field)) return overrides ?? {};
  const key = canonicalTeam(abbr);
  return { ...(overrides ?? {}), [key]: { ...(overrides?.[key] ?? {}), [field]: hex } };
}

/**
 * The map with one field of one team's override removed — the accent's "back
 * to computed", as opposed to the whole team's "back to official".
 *
 * Removing rather than blanking, for the same reason clearTeamOverride removes
 * rather than writes: an accent set to "" is not an accent that follows
 * pickAccent, it is a card with no accent color at all.
 */
export function clearTeamColor(overrides, abbr, field) {
  const key = canonicalTeam(abbr);
  const entry = overrides?.[key];
  if (!entry) return overrides ?? {};
  const { [field]: _removed, ...rest } = entry;
  const next = { ...overrides };
  if (Object.keys(cleanEntry(rest)).length) next[key] = rest;
  else delete next[key];
  return next;
}

/**
 * The map with one team's override REMOVED — reset to official.
 *
 * Not "set back to the values in teams.js". The team has to end up with no
 * entry at all, so that if the official colors are ever corrected upstream
 * this team picks the correction up instead of being pinned to a snapshot of
 * what they used to be. This is the difference the reset button exists to make.
 */
export function clearTeamOverride(overrides, abbr) {
  const key = canonicalTeam(abbr);
  if (!overrides || !(key in overrides)) return overrides ?? {};
  const next = { ...overrides };
  delete next[key];
  return next;
}

/** True when this team is currently customised away from its official colors. */
export function hasTeamOverride(overrides, abbr) {
  return Object.keys(cleanEntry(overrides?.[canonicalTeam(abbr)])).length > 0;
}

/**
 * Every customised team, sorted — the "what have I changed" answer.
 *
 * These accumulate across sessions and are invisible on any card but the one
 * on screen, so the editor shows the count and this list behind it. Without
 * it, a color tuned three sessions ago is indistinguishable from an official
 * one that happens to look wrong.
 */
export function overriddenTeams(overrides) {
  return Object.keys(pruneTeamOverrides(overrides)).sort();
}
