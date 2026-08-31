// AWARD MARKS — the trophies a player won IN THE SEASON THIS CARD IS.
//
// The user's words: "I'm going to add some awards to [a folder], and I'd like
// to add them to the sidebar above the badges if a player won them. I'll label
// as MVP, MIP, DPOY, etc."
//
// ── WHAT AN AWARD MARK IS, AND WHY IT IS NOT A BADGE ────────────────────────
//
// A BADGE says what KIND of card this is — SUPER SEASON, ROOKIE — and exactly
// one prints, because the card is one kind of thing. An AWARD says what the
// player DID in the season the card's numbers came from, and a player can have
// done several: Shai Gilgeous-Alexander won MVP and Clutch Player of the Year
// in 2025-26, and a rule that printed one of those and swallowed the other
// would be throwing away the fact the mark exists to carry.
//
// So this is a LIST where badges.js is a choice. The two live in separate files
// for that reason and not merely for size: `pickBadge` resolves many ids down
// to one and `pickAwards` resolves many down to several, and folding them
// together would mean one of the two rules pretending to be the other.
//
// ── WHICH CODES QUALIFY, AND WHY THE SELECTIONS DO NOT ──────────────────────
//
// Basketball-Reference's season tables carry one `awards` string per player,
// and it mixes two different kinds of thing:
//
//   VOTED TROPHIES   MVP, DPOY, ROY, MIP, 6MOY, CPOY. One winner a season,
//                    and the suffix is the finishing position — `MVP-1` won,
//                    `MVP-4` came fourth. See AWARD_WIN_RANK.
//
//   SELECTIONS       AS (All-Star), NBA1/NBA2/NBA3 (All-NBA), DEF1/DEF2
//                    (All-Defensive). No rank suffix, because there is no
//                    single winner to rank against.
//
// THOSE TWELVE ARE ALL OF THEM. Every award token across the twenty seasons the
// generator reads (2004 and 2008-2026) is one of the twelve above — no Finals
// MVP, no championship mark, nothing else. Basketball-Reference's season tables
// are regular-season tables, and Finals MVP is a postseason award, so it never
// appears in this column; a card that wanted one would need a different source
// as well as a row here.
//
// Only the trophies qualify, and there are three reasons, of which the third is
// the one that would decide it on its own:
//
//   1. IT IS WHAT WAS ASKED FOR. "MVP, MIP, DPOY, etc." names the trophies.
//
//   2. THE PARSING RULE DOES NOT APPLY TO THEM. A mark is earned by finishing
//      FIRST, and a selection has no finishing position — so admitting one
//      would mean a second, differently-shaped rule for what counts as won.
//
//   3. THE VOLUME WOULD DESTROY THE MARK. 24+ players make an All-Star team
//      every season, 15 make an All-NBA team, 10 an All-Defensive team, and
//      across the twenty seasons this build reads there are 524 All-Star
//      selections against 260 MVP ballots and 20 MIP awards. The Super Season
//      set is 210 cards, each one somebody's CAREER-BEST year — precisely the
//      season a player is likeliest to have been selected in. Measured on the
//      generated data (card-data/generated/card-awards.json records both
//      numbers, so this one regenerates rather than rotting):
//
//        super-season   15 marked cards -> 77   (7% of the set -> 37%)
//        2026-27         5 marked cards -> 54   (1% -> 15%)
//        rookie         11 marked cards -> 70   (3% -> 22%)
//
//      A mark better than a third of a set carries is not a mark, it is a
//      background — the same argument SUPER_SEASON_MIN_SALARY was moved for,
//      one file over.
//
// ONE LINE TO CHANGE. AWARDS below is the whole declaration: adding NBA1 to it
// is adding a row, and everything downstream — the generator, the ordering, the
// cap, the studio — reads it from here.
import { pickInkFor } from './fieldTheme.js';

/**
 * The finishing position that IS a win.
 *
 * THE SINGLE MOST DANGEROUS NUMBER IN THIS FILE. Basketball-Reference writes a
 * voted award as `{CODE}-{PLACE}`, so `MVP-1` is the Most Valuable Player and
 * `MVP-4` is a player who finished fourth in the voting and won nothing. Ten to
 * fifteen players carry an `MVP-n` token every season; exactly one of them has
 * an MVP. Reading the code and ignoring the suffix would put a trophy on all of
 * them — Luka Dončić's 2025-26 card, `MVP-4`, is the case the test suite names.
 *
 * There is no second reading of the suffix to get wrong: it is a rank, it is
 * always present on a voted award, and 1 is first.
 */
export const AWARD_WIN_RANK = 1;

/**
 * A single token out of the `awards` string, parsed.
 *
 * Returns `{ code, rank }` with `rank` null for a token that carries no
 * position — the selections, which is how they are told apart from the
 * trophies without this file holding a second list of which is which.
 *
 * Anything that is not one of those two shapes returns null rather than
 * throwing. The string comes off a scraped page: a site change should cost a
 * card its mark, not take the generator down.
 */
const TOKEN = /^([A-Za-z0-9]+)(?:-(\d+))?$/;

export function parseAwardToken(token) {
  const m = TOKEN.exec(String(token ?? '').trim());
  if (!m) return null;
  return { code: m[1], rank: m[2] === undefined ? null : Number(m[2]) };
}

/**
 * Every award code in a Basketball-Reference `awards` string that was WON.
 *
 * "Won" is `rank === AWARD_WIN_RANK` and nothing else. A token with no rank is
 * a selection and is never a win — see the header — so `AS,NBA1,DEF1` yields
 * nothing at all, and `MVP-4,CPOY-8,AS,NBA1` yields nothing at all either.
 *
 * DELIBERATELY DOES NOT FILTER TO THE DECLARED SET. This answers "what did he
 * win", which is a fact; `pickAwards` and `awardsEarned` answer "what does the
 * card print", which is a decision. Keeping them apart is what lets the
 * generator record the whole truth in card-awards.json while the renderer
 * prints the part of it that earns a place — the same split card-badges.json
 * already makes between `applies` and `printed`.
 */
export function awardsWon(raw) {
  return codesIn(raw, parsed => parsed.rank === AWARD_WIN_RANK);
}

/**
 * Every code in the string that carries NO finishing position.
 *
 * The other half of the same fact, and equally declaration-free: `AS,NBA1,DEF1`
 * yields all three, `MVP-4` yields none. Nothing prints from this today — see
 * the header for why the selections are excluded — and it exists so that
 * admitting one is a row in AWARDS rather than a second parser.
 */
export function selectionsIn(raw) {
  return codesIn(raw, parsed => parsed.rank === null);
}

function codesIn(raw, keep) {
  if (typeof raw !== 'string') return [];
  const out = [];
  for (const token of raw.split(',')) {
    const parsed = parseAwardToken(token);
    if (parsed && keep(parsed) && !out.includes(parsed.code)) out.push(parsed.code);
  }
  return out;
}

/**
 * The award marks a card may print, IN PRIORITY ORDER.
 *
 * The order IS the rule, exactly as it is in badges.js: it decides which marks
 * survive MAX_CARD_AWARDS and which order they sit in, and there is no separate
 * priority table to keep in step.
 *
 * The order is the awards' own standing, which is not a matter of taste at the
 * ends and barely one in the middle:
 *
 *   MVP    the league's award. Nothing else on this list is argued about.
 *   DPOY   its defensive counterpart, and the only other award voted on the
 *          whole of a player's game rather than on a slice of it.
 *   ROY    a career fact as much as a season one, and unrepeatable — which is
 *          also why it sits above the two role awards a player can win twice.
 *   MIP    unrepeatable in practice for the same reason ROY is in principle.
 *   6MOY   a role award: it is about the bench, not about the league.
 *   CPOY   a role award over a slice of a season, and the newest of the six
 *          (first awarded 2022-23), so the fewest cards can carry it.
 *
 * `name` is not rendered anywhere on the card. It is here so that the studio,
 * the run report and this file's own tests say "Most Improved Player" instead
 * of making a reader expand the initialism themselves.
 *
 * ── ADDING ONE IS ADDING A ROW, INCLUDING A SELECTION ───────────────────────
 *
 * `selection: true` says this code is HELD rather than WON, and it is what
 * makes admitting All-Star or All-NBA a one-line change rather than a one-line
 * change plus a second parsing rule. With it:
 *
 *     { code: 'AS', name: 'All-Star', selection: true },
 *
 * `awardsEarned` stops requiring a `-1` for that code and takes the bare token
 * instead. Nothing else moves — not the generator, not the priority order, not
 * the cap, not the renderer. NOTHING DECLARES IT TODAY, and the header says
 * why: on the Super Season set the selections would take the marked cards from
 * 15 to 77. The flag is the door, not an invitation through it.
 *
 * The CODE IS THE FILENAME. `{code}.png` under public/awards/ — see
 * awardImagePath — so a row's code has to be spelled the way the art is, and
 * these six are spelled the way Basketball-Reference spells them, because that
 * is the side of the join that cannot be renamed.
 */
export const AWARDS = [
  { code: 'MVP', name: 'Most Valuable Player' },
  { code: 'DPOY', name: 'Defensive Player of the Year' },
  { code: 'ROY', name: 'Rookie of the Year' },
  { code: 'MIP', name: 'Most Improved Player' },
  { code: '6MOY', name: 'Sixth Man of the Year' },
  { code: 'CPOY', name: 'Clutch Player of the Year' },
];

const AWARDS_BY_CODE = new Map(AWARDS.map(a => [a.code, a]));

/** Just the codes, in priority order. */
export const AWARD_CODES = AWARDS.map(a => a.code);

/** The declared award with this code, or null. Own-property lookup, never a prototype hit. */
export function getAward(code) {
  return AWARDS_BY_CODE.get(code) ?? null;
}

/**
 * The DECLARED codes one awards string earns a card, in priority order.
 *
 * THE ONE PLACE THE TWO HALVES MEET. `awardsWon` and `selectionsIn` say what
 * the string contains and know nothing about what this build draws; AWARDS says
 * what this build draws and knows nothing about Basketball-Reference's syntax.
 * This is the join, and it is the only function that has to change if the
 * declaration ever admits a code of the other shape — which is what the
 * `selection` flag is for.
 *
 * A ranked award needs its `-1`. A declared selection needs only to be present.
 * Nothing else earns a mark.
 */
export function awardsEarned(raw) {
  const won = new Set(awardsWon(raw));
  const held = new Set(selectionsIn(raw));
  return AWARDS.filter(a => (a.selection ? held.has(a.code) : won.has(a.code))).map(a => a.code);
}

/**
 * How many marks one card prints.
 *
 * ── THE NUMBER IS THE BAR'S WIDTH, AND THE BAR IS 135px ────────────────────
 *
 * The sidebar column is 127px of usable width (see .badge — the bar is 135 and
 * the card's keyline takes 7 of them). A row of THREE 38px marks with two 6px
 * gaps measures 126. A fourth would not fit, and shrinking all four to make it
 * fit would cost every card with one mark the size of that mark.
 *
 * THREE IS ALSO MORE THAN THE DATA NEEDS, and that is deliberate rather than
 * lucky. Exactly ONE card in the three generated sets carries more than one
 * mark — Shai Gilgeous-Alexander's 2026-27 base card, MVP and Clutch Player of
 * the Year in the same season — so nothing is being dropped by anybody today.
 * A cap that only just fit the current maximum would silently start dropping
 * marks the first season somebody swept three, and a dropped trophy is the one
 * failure this feature cannot have; the doubles that are one vote away are all
 * plausible (MVP+DPOY was Giannis in 2019-20, MVP+CPOY has already happened).
 * `pickAwards` drops from the BOTTOM of the priority order when it must, so the
 * mark that goes is always the least of them.
 */
export const MAX_CARD_AWARDS = 3;

/**
 * The marks a card actually prints, from every code it carries.
 *
 * Filters to the declared set, deduplicates, sorts into AWARDS order and caps
 * at MAX_CARD_AWARDS. Unknown codes are ignored rather than throwing, for
 * badges.js's reason: a data file naming an award this build does not declare
 * should cost that card a mark, not take the studio down.
 *
 * Returns the AWARD OBJECTS, not the codes, so a caller cannot print a mark
 * without having gone through the declaration.
 */
export function pickAwards(codes) {
  if (!Array.isArray(codes)) return [];
  const wanted = new Set(codes.filter(c => typeof c === 'string'));
  return AWARDS.filter(a => wanted.has(a.code)).slice(0, MAX_CARD_AWARDS);
}

/**
 * The browser path for an award's art, or null for a code this build does not
 * declare.
 *
 * ROOT-RELATIVE AND BARE, exactly like a team's `logo` in teams.js: this is
 * plain data, read by Node as well as by the browser, so it must not depend on
 * a bundler's environment. CardTemplate runs it through `logoSrc` to pick up
 * the app's base path, the same way it does every other mark on the card.
 *
 * ── public/awards/, NOT card-art/logo-originals/Awards/ ─────────────────────
 *
 * The user named the second one, and it is the wrong home for the same reason
 * it would be for a team mark: card-art/logo-originals/ is the BACKUP store for
 * stripped originals and is not served or bundled. public/awards/ is parallel
 * to public/logos/, which is what actually reaches a card.
 *
 * THE FILES DO NOT EXIST YET. Every one of these paths 404s today and the card
 * falls back to the lettered chip — see AwardMark in CardTemplate.jsx. That is
 * the same state public/logos/ was in when TeamLogo's fallback was written, and
 * it is why the fallback is a real design rather than a placeholder.
 */
export function awardImagePath(code) {
  return getAward(code) ? `/awards/${code}.png` : null;
}

/**
 * The lettered chip's two colours: the fill and the type on it.
 *
 * ── NO NEW COLOUR IS INVENTED HERE, AND THAT IS THE WHOLE POINT ─────────────
 *
 * It is the BEST SEASON pill's pair, exactly: the team's `accentOnField`, which
 * `deriveFieldTheme` has already cleared against the field on all thirty-seven
 * franchises, with `pickInkFor` of it for the type. So the chip introduces no
 * surface the card did not already have a contrast argument for, and
 * treatments.test.js sweeps it over every franchise and every treatment
 * alongside the badges rather than exempting it.
 *
 * TAKES THE UNTREATED THEME, for badges.js's reason restated: an award is a
 * fact about a player's season, not about the set the card is in, so the green
 * treatment must not repaint it green and the foil must not repaint it gold.
 * CardTemplate passes `base` here exactly as it does to `badgeVars`.
 */
export function awardColors(theme) {
  if (!theme) return null;
  const fill = theme.accentOnField;
  return { fill, ink: pickInkFor(fill) };
}

/**
 * The chip's colours as CSS custom properties.
 *
 * NOTHING when the card prints no marks, so a card without awards carries no
 * award properties at all — the same contract badgeVars keeps, and for the same
 * reason: the `var(--award-fill, …)` fallbacks in the stylesheet then exist
 * only for a state this file makes possible and does not produce.
 */
export function awardVars(theme, awards) {
  if (!Array.isArray(awards) || awards.length === 0) return {};
  const colors = awardColors(theme);
  if (!colors) return {};
  return { '--award-fill': colors.fill, '--award-ink': colors.ink };
}
