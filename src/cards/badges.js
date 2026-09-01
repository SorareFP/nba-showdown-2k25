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
// The order of BADGES below IS the priority rule, so there is no separate
// priority table to keep in step with the list. One badge prints, never two:
// the pill is 127px in a 135px bar and a second one would cost the sidebar a
// row it does not have.
//
// ROOKIE IS FIRST, AND THE OVERLAP IS THE WHOLE ARGUMENT. 33 base cards carry
// both badges, and it is 33 for a structural reason rather than by chance: a
// player whose FIRST season is the most recent one has exactly one season, so
// that season is also his BEST one. Every card where the two badges compete is,
// definitionally, a rookie's. And on such a card "this was his best season" is
// trivially true — a superlative over a set of one — while "this is his rookie
// season" is the fact a reader could not have worked out for himself. The badge
// that wins is the one that says something.
//
// THIS IS NOT A GENERAL RANKING OF THE TWO. It does not claim that a debut
// outranks a career year; it observes that the only cards forced to choose are
// rookie cards. A future badge whose overlap with Super Season is not nested
// like this needs its own argument, not a place in this list.
//
// The user's call, on seeing Cooper Flagg's card: "If players were rookies in
// 25-26, you can replace that badge with a '25-26 Rookie' badge similar to what
// is on the rookie card page."
//
// It ran the other way first, on a reading of "pull prioritize in that order",
// and the consequence was recorded here as a structural fact: the ROOKIE badge
// could not print on any base card, because all 33 players it was true of wore
// the gold pill instead. The fact was real. It was also the bug.
//
// ── THE ROOKIE PILL CARRIES ITS SEASON WHEN THE CARD DOES NOT ───────────────
//
// A card in the Rookie SET prints its season on its own line directly under the
// pill (showsSeason in sets.js), so there the pill only has to say ROOKIE. A
// base-set card prints no season anywhere — deliberately, because every card in
// that set is the same season and naming it would be noise — which leaves the
// pill as the only place a year can appear. So it appears there: "25-26 ROOKIE"
// on Cooper Flagg's 2026-27 card, "ROOKIE" on a Rookie-set card that dates
// itself one line lower. Same badge, same colour, same pill; the label picks up
// the season exactly when nothing else on the card will.
//
// THE YEAR IS NEVER WRITTEN DOWN. `badgeLabel` is handed the season the card's
// numbers came from — setStatsSeason in sets.js, which is '2025-26' for the
// 2026-27 set — and shortens it. Next season's set prints "26-27 ROOKIE" with
// nothing edited here, the same way nothing else in the tree spells a season.
//
// SUPER SEASON DOES NOT DATE ITSELF, and the asymmetry is a decision:
//   - It does not fit. "25-26 SUPER SEASON" is 18 characters in a pill that
//     holds 12 at 13px. "25-26 ROOKIE" is exactly 12 — the same width as the
//     label it sits beside, which is also why the dated pill looks deliberate
//     rather than padded. CardTemplate.test.js measures every label a badge can
//     produce, dated ones included.
//   - It has less to say. The Super Season pill is a superlative ABOUT the
//     numbers printed beneath it, and those numbers are the exhibit; which year
//     they belong to changes nothing a reader can act on. A rookie year is a
//     date in a career, and it is the one thing the Rookie set judged worth
//     printing beside its own pill.
//
// ── ONE BADGE HAS TWO TIERS, AND THE SALARY PICKS BETWEEN THEM ─────────────
//
// SUPER SEASON is the only badge that makes a claim rather than stating a fact,
// and a claim can be overstated. Below SUPER_SEASON_MIN_SALARY the same card
// prints BEST SEASON in the team's accent and gives up the gold foil with it.
// See SUPER_SEASON_MIN_SALARY and `tierBadge` below for the whole rule; the
// treatment half of it is `cardTreatment` in sets.js, which asks `tierBadge`
// the same question rather than re-deriving the answer.
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
export const BEST_SEASON_BADGE = 'best-season';
export const ROOKIE_BADGE = 'rookie';
export const SUMMER_STANDOUT_BADGE = 'summer-standout';

/**
 * The salary at which a best season is a SUPER season.
 *
 * ── WHY THE SET TIERS AT ALL ────────────────────────────────────────────────
 *
 * The user's call: "re: Super Season, I think we can just put 'Best Season' and
 * not make the tab gold for anyone under 700 salary."
 *
 * Every card in the Super Season set is somebody's best year, and until now
 * every one of them got the identical gold foil and the identical gold pill —
 * Alex Sarr's $10 2024-25 and Stephen Curry's $1500 2015-16 as the same rare
 * object. Gold that every card has is not a distinction, it is a background.
 * So the set splits in two: the gold marks the seasons worth the word SUPER,
 * and the rest print the plainer, truer claim.
 *
 * ── ONE DECLARED NUMBER, NOT A DERIVED ONE ──────────────────────────────────
 *
 * It is NOT a quantile, and never was. Salary is a stated value on the face of
 * the card, so the line between the tiers is drawn on that value and stays
 * where it is put; pinning it to a quantile would mean the boundary MOVED every
 * time the pool was regenerated, and a player's card could lose its gold
 * because somebody else got a raise.
 *
 * ── WHY IT MOVED FROM 700 TO 900 ────────────────────────────────────────────
 *
 * Because 700 was the median, and a median is a coin flip rather than a
 * distinction. Of the 210 NBA Super Season cards, 104 fell below 700 and 106 did
 * not — the split the first version of this rule was measured at, and almost
 * exactly the thing the tier was introduced to stop being. "Gold that every card
 * has is not a distinction" is the argument above, and gold that half the cards
 * have is barely a better one.
 *
 * The user named 900 on being shown that. What it actually buys, across the
 * three sets that can print this badge:
 *
 *   super-season          55 gold / 155 best   (was 106 / 104)
 *   2026-27 base cards    13 gold /  94 best   (was  41 /  66)
 *   wnba-super-season     15 gold /   1 best   (was  16 /   0)
 *
 * — 83 gilded cards out of 333, a touch under a quarter. Note the last row: the
 * WNBA set is no longer unanimous. Tina Charles' 2016 at $860 is the first card
 * in it to print BEST SEASON, which is the rule working rather than the rule
 * misfiring, and it is why `cardTreatment` in sets.js was written to ask this
 * question of every set instead of a list of set ids.
 *
 * INCLUSIVE AT THE LINE, because "under 700" was what was asked for the first
 * time and nothing about moving the number changes which side of it the line
 * falls on: 900 itself is gold. One Super Season card sits exactly there (Jonas
 * Valančiūnas' 2020-21) and two base cards do (Brandon Miller, Cam Spencer);
 * all three are gilded.
 */
export const SUPER_SEASON_MIN_SALARY = 900;

/**
 * The badge id a card actually prints, given what it costs.
 *
 * THE ONE PLACE THE TIER IS DECIDED. Both consequences of the split run through
 * this function and nothing else computes the comparison: the LABEL and the
 * PILL COLOUR follow from which badge comes back (see BADGES below), and the
 * GOLD FOIL follows from `cardTreatment` in sets.js asking this same question
 * and withholding the set's treatment when the answer has changed. Two rules
 * that must agree, expressed once.
 *
 * ONLY THE SUPER SEASON BADGE TIERS. The Rookie badge is a fact about a career,
 * not a claim about quality, and a cheap rookie card is not an overstatement;
 * the green treatment is untouched at every salary.
 *
 * AN UNKNOWN SALARY STAYS GOLD. Every generated card in every set carries a
 * real salary today, but the studio's whole contract is that a half-built
 * record renders rather than breaking, and the two failure directions are not
 * symmetric: a missing number that demoted the card would strip the gold off a
 * whole set the moment a generator had not been run yet, and would look like
 * the feature had broken. Demotion requires EVIDENCE — a finite number below
 * the line — so anything else keeps the card exactly as it rendered before this
 * tier existed.
 */
export function tierBadge(id, salary) {
  if (id !== SUPER_SEASON_BADGE) return id;
  if (Number.isFinite(salary) && salary < SUPER_SEASON_MIN_SALARY) return BEST_SEASON_BADGE;
  return id;
}

/**
 * A season label as the rest of the tree spells one: "2025-26".
 *
 * The gate on dating a pill at all. `setStatsSeason` hands back whatever its
 * row declares, and two of those rows hold prose ('career-best season') while
 * the WNBA's holds a single year ('2026') — none of which shortens to anything
 * a reader would take for a season. Anything that does not match this stays
 * undated rather than being interpolated into a label.
 */
const SEASON_LABEL = /^\d{4}-\d{2}$/;

/**
 * "2025-26" -> "25-26". The PILL's abbreviation, and only the pill's.
 *
 * The season LINE prints its season in full, measured against the 23 finished
 * legend cards (see .season in CardTemplate.module.css). The pill abbreviates
 * because it has 127px and a label to fit beside — and, usefully, because the
 * two forms then cannot be mistaken for each other: a card reading "25-26" in
 * a pill is not claiming to be a 2025-26 card.
 */
const shortSeason = season => season.slice(2);

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
    id: ROOKIE_BADGE,
    // Uppercase in the DATA, not via text-transform: this is the string the
    // width budget in CardTemplate.test.js measures, and a transform would hide
    // the real one from it.
    text: 'ROOKIE',
    // The dated form, for a card that prints no season of its own. See the
    // header: the season arrives from the caller, never from a literal here.
    datedText: season => `${shortSeason(season)} ROOKIE`,
    // The TEAM's accent, already cleared against the field by deriveFieldTheme.
    // Half the league falls back to cream, which makes a pale pill with
    // near-black type; that is a real team colour and it stays.
    fill: theme => theme.accentOnField,
  },
  {
    id: SUPER_SEASON_BADGE,
    text: 'SUPER SEASON',
    // NO `datedText` — see the header. The pill has no room for a year and
    // nothing to gain from one.
    //
    // "Super Season can be gold." The same GOLD the foil treatment is built on
    // — imported rather than restated, so the pill on an untreated 2026-27 card
    // and the pill on a foil Super Season card cannot drift apart — nudged only
    // as far as it must go to clear the field it sits on.
    fill: theme => readableOn(GOLD, theme.field, MIN_ACCENT_CONTRAST),
  },
  {
    // THE UNGILDED TIER OF THE ONE ABOVE IT — see SUPER_SEASON_MIN_SALARY and
    // `tierBadge`. Its position in this list is unobservable and deliberately
    // so: `tierBadge` is a FUNCTION of the salary, so it maps every occurrence
    // of `super-season` on a card to the same answer and no card can ever carry
    // both ids at once. What its position DOES have to respect is Rookie, which
    // still outranks it for exactly the reason it outranks the gilded form: a
    // player whose first season is his best has had one season, and the
    // superlative over a set of one is the less interesting of the two facts.
    id: BEST_SEASON_BADGE,
    // The SAME FACT, stated without the superlative. "Best" is a comparison
    // inside one career and is exactly as true of a $10 card as of a $1500 one;
    // "super" ranks the season against every other season in the set, and that
    // is the claim the cheap end could not support. The demoted pill does not
    // say less than it means — it stops saying more.
    text: 'BEST SEASON',
    // No dated form, for both of SUPER SEASON's reasons: every set that can
    // print this badge prints a season line of its own one row below it, and
    // the pill has no width to spare. 11 characters against a 12-character
    // budget — one shorter than the label it replaces, so it is not even the
    // binding case in CardTemplate.test.js's measurement.
    //
    // ── THE TEAM'S ACCENT, WHICH IS HALF THE POINT OF THE SPLIT ─────────────
    //
    // "not make the tab gold" settles what the pill is NOT; this settles what
    // it is. A gold pill on a card with no other gold on it would read as the
    // one surface the change forgot — a bug, not a tier. A neutral grey would
    // be a third colour invented for one badge and measurable against nothing.
    //
    // The team's accent is neither. It is the pill the ROOKIE badge already
    // takes ("Rookie can just be secondary/accent team color"), already cleared
    // against all thirty-seven fields by deriveFieldTheme, and it makes the two
    // Super Season tiers a legible PAIR: a gold pill means a gold card, a
    // team-coloured pill means a team-coloured card. The colour says which tier
    // this is before the word has been read, which is what the split is for.
    fill: theme => theme.accentOnField,
  },
  {
    // The Summer Standouts set's pill — a deep playoff run, carded. Worn by
    // every card in that set (a SET badge, like Rookie's role on its set),
    // never by a base-set record, so its position here decides nothing today.
    // 'SUMMER' rather than 'SUMMER STANDOUT' — the user's word for the set,
    // and the pill's width budget has no room for fifteen characters anyway.
    id: SUMMER_STANDOUT_BADGE,
    text: 'SUMMER',
    // The team's accent, like Rookie and Best Season: a fourth colour invented
    // for one pill would be measurable against nothing.
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
 *
 * ── THE SALARY IS THE TIER, AND IT IS APPLIED BEFORE THE PRIORITY ───────────
 *
 * `super-season` on a card under SUPER_SEASON_MIN_SALARY resolves to
 * `best-season` — see `tierBadge` — and the mapping happens on the way IN, so
 * the priority order below decides between whatever the card really prints
 * rather than between the ids the data happened to name. Nothing downstream has
 * to know a tier exists: it gets a badge, and the badge carries its own text
 * and its own fill as every badge always has.
 *
 * OMITTING THE SALARY MEANS GOLD, which is what keeps every caller that
 * predates the tier behaving exactly as it did. See `tierBadge` for why the
 * unknown case resolves that way rather than the other.
 */
export function pickBadge(ids, salary) {
  if (!Array.isArray(ids)) return null;
  const wanted = new Set(
    ids.filter(id => typeof id === 'string').map(id => tierBadge(id, salary))
  );
  return BADGES.find(b => wanted.has(b.id)) ?? null;
}

/**
 * The string the pill actually prints.
 *
 * `season` is THE SEASON THIS CARD HAS NOWHERE ELSE TO PRINT — the caller
 * passes one only when the card draws no season line of its own, which is the
 * single condition under which a badge folds the year into its label. Pass null
 * (or anything that is not a "2025-26"-shaped label) and every badge prints its
 * plain `text`, which is what the two special sets do: their cards date
 * themselves one row lower.
 *
 * Structured like `fill` on purpose. Nothing about a badge's presentation is
 * written down twice — the colour is a function of the field it lands on, and
 * the label is a function of what the rest of the card already says.
 */
export function badgeLabel(badge, season = null) {
  if (!badge) return null;
  if (typeof badge.datedText !== 'function') return badge.text;
  if (typeof season !== 'string' || !SEASON_LABEL.test(season)) return badge.text;
  return badge.datedText(season);
}

/**
 * Every label a badge can ever print, for the width budget to measure.
 *
 * The pill is a fixed 127px and `text` is no longer the whole story, so a test
 * that measured only `text` would have stopped measuring the longest thing on
 * the card the moment `datedText` arrived. Given the seasons a build can
 * actually hand `badgeLabel`, this returns the full set — deduplicated, because
 * every badge that cannot date itself contributes the same string twice.
 */
export function badgeLabels(seasons = []) {
  const tried = [null, ...seasons];
  return [...new Set(BADGES.flatMap(b => tried.map(s => badgeLabel(b, s))))];
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
